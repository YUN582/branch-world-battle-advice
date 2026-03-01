// ============================================================
// Branch World Battle Roll - 메인 컨트롤러 (Content Script)
// 전투 상태 머신, 채팅 감시, 자동 처리 오케스트레이션
// ============================================================

(function () {
  'use strict';

  // ── 전역 상태 ────────────────────────────────────────────

  /** 전투 흐름 상태 */
  const STATE = {
    IDLE: 'IDLE',
    COMBAT_STARTED: 'COMBAT_STARTED',
    ROUND_HEADER_SENT: 'ROUND_HEADER_SENT',
    WAITING_ATTACKER_RESULT: 'WAITING_ATTACKER_RESULT',
    WAITING_DEFENDER_RESULT: 'WAITING_DEFENDER_RESULT',
    PROCESSING_RESULT: 'PROCESSING_RESULT',
    COMBAT_END: 'COMBAT_END',
    PAUSED: 'PAUSED',
    SPECTATING: 'SPECTATING',
    // 전투 보조 모드 상태
    TURN_COMBAT: 'TURN_COMBAT'
  };

  let config = null;        // 현재 설정
  let engine = null;        // BattleRollEngine (합 처리)
  let combatEngine = null;  // CombatEngine (전투 보조)
  let chat = null;          // CocoforiaChatInterface
  let overlay = null;       // BattleRollOverlay
  let flowState = STATE.IDLE;
  let enabled = true;
  let resultTimeoutId = null;
  let paused = false;
  let _pauseRequested = false;
  let _stateBeforePause = null;
  let _spectatorAtkRollSeen = false;
  let _spectatorDefRollSeen = false;
  let _spectatorDedup = new Map();  // key → timestamp (중복 메시지 방지)
  let _lastTurnAdvanceTime = 0;     // 차례 종료 디바운스용 (중복 방지)
  let _turnTrackingActive = false;  // 관전자용 턴 추적 활성화 여부
  let _characterCache = new Map();  // 캐릭터 이름 → { iconUrl, ... }
  let _currentTrackedTurn = null;   // 관전자용 현재 차례 정보
  let _spectatorFromTurnCombat = false; // 합 관전이 TURN_COMBAT에서 시작되었는지
  let _spectatorStartTime = 0;           // 관전 시작 시각 (premature end 방지용)
  let _activeCombatFromTurnCombat = false; // 능동 합 진행이 TURN_COMBAT에서 시작되었는지
  let _userMessagePendingPromise = null; // 사용자 메시지 도착 대기 프라미스 (메시지 순서 보장)
  let triggerEngine = null; // TriggerEngine 인스턴스 (범용 트리거 시스템)
  let _cachedSpeakerName = null; // 현재 발화(선택) 캐릭터 이름

  // Redux speaking 캐릭터 변경 감시 (redux-injector.js의 store.subscribe에서 push)
  document.addEventListener('bwbr-speaker-changed', () => {
    const name = document.documentElement.getAttribute('data-bwbr-speaker-name');
    if (name) _cachedSpeakerName = name;
  });

  // char-shortcut.js Alt+숫자 전환 시 캐시 선행 갱신 (Redux 반영 전)
  window.addEventListener('bwbr-switch-character', (e) => {
    const name = e.detail?.name;
    if (name) _cachedSpeakerName = name;
  });

  // ── 초기화 ───────────────────────────────────────────────

  async function init() {
    try {
    alwaysLog('확장 프로그램 초기화 시작...');

    // 설정 로드
    config = await loadConfig();

    // 모듈 초기화
    engine = new window.BattleRollEngine(config);
    combatEngine = new window.CombatEngine(config);
    chat = new window.CocoforiaChatInterface(config);
    overlay = new window.BattleRollOverlay(config);
    overlay.preloadRollSounds();

    // Redux Store 가져오기 (전투 보조용 캐릭터 데이터 접근)
    setupReduxStore();

    enabled = config.general.enabled;

    // 자동완성 초기화
    if (window.BWBR_AutoComplete) {
      window.BWBR_AutoComplete.setEnabled(config.general.autoComplete !== false);
    }

    // 패널 이벤트
    overlay.onCancel(() => cancelCombat());
    overlay.onPause(() => togglePause());
    overlay.setActionClickCallback(async (type, index, action) => {
      // 행동 슬롯 클릭 → 실제 캐릭터 스탯 변경 (Firestore 경유)
      const current = combatEngine.getState()?.currentCharacter;
      if (!current) return;
      const statLabel = type === 'main' ? '주 행동🔺' : '보조 행동🔹';

      // 수정 전 스탯 조회 (요약 메시지용)
      const preStats = _extractActionStats(current);

      let result;
      if (action === 'use') {
        result = await _modifyCharStat(current.name, statLabel, '-', 1, true);
      } else if (action === 'restore') {
        result = await _modifyCharStat(current.name, statLabel, '+', 1, true);
      } else if (action === 'add') {
        // 현재 값만 +1 (최대치 초과 허용, max는 변경하지 않음)
        result = await _modifyCharStat(current.name, statLabel, '+', 1, true);
      }

      // 요약 시스템 메시지 전송
      if (result && result.success) {
        const mainStr = type === 'main'
          ? `🔺주 행동 ${result.oldVal} → ${result.newVal}개`
          : `🔺주 행동 ${preStats.mainActions}개`;
        const subStr = type === 'sub'
          ? `🔹보조 행동 ${result.oldVal} → ${result.newVal}개`
          : `🔹보조 행동 ${preStats.subActions}개`;
        const msg = `〔 ${current.name}의 차례 〕\n${mainStr}, ${subStr} | 이동거리 ${current.movement}`;
        chat.sendSystemMessage(msg);
      }

      // 즉시 UI 갱신
      _scheduleStatRefreshUI(100);
    });
    overlay.setStatus(enabled ? 'idle' : 'disabled', enabled ? '대기 중' : '비활성');

    // DOM 요소 탐색 (코코포리아 로드 대기)
    log('코코포리아 채팅 DOM 탐색 중...');
    const found = await chat.waitForElements(60000, 2000);
    if (!found) {
      alwaysLog('채팅 DOM 요소를 찾을 수 없습니다. 수동 선택자 설정이 필요할 수 있습니다.');
      overlay.setStatus('error', 'DOM 탐색 실패');
      overlay.addLog('채팅 DOM 요소를 찾을 수 없습니다. 확장 프로그램 설정에서 선택자를 확인해주세요.', 'error');
      return;
    }

    alwaysLog('채팅 DOM 발견! 채팅 관찰 시작...');
    overlay.addLog('코코포리아 연결 완료', 'success');

    // 로그 추출 메뉴 삽입 (톱니바퀴 메뉴에 항목 추가)
    setupLogExportMenu();

    // 범용 트리거 엔진 초기화
    if (window.TriggerEngine) {
      triggerEngine = new window.TriggerEngine();
      triggerEngine.init({
        chat: chat,
        getFlowState: () => flowState,
        awaitUserMessage: () => _awaitUserMessage(),
        getCurrentCombatCharName: () => {
          const s = combatEngine.getState();
          return s && s.currentCharacter ? s.currentCharacter.name : null;
        },
        getSpeakerName: () => _cachedSpeakerName
      });
      await triggerEngine.load();
      alwaysLog('범용 트리거 엔진 초기화 완료 (' + triggerEngine.getTriggers().length + '개 트리거)');

      // 트리거 관리 UI 초기화
      if (window.BWBR_TriggerUI) {
        window.BWBR_TriggerUI.init(triggerEngine);
      }
    }

    // 채팅 관찰 시작 - Redux 기반 (DOM 대신 Redux store.subscribe 사용)
    // 탭 전환, DOM 갱신에 영향받지 않아 100% 메시지 감지율을 보장합니다.
    chat.observeReduxMessages(onNewMessage);

    // 입력 훅 설정 (합 개시 트리거 감지용 — 사용자가 Enter 눌러 전송할 때)
    chat.hookInputSubmit(onInputSubmit);

    // 메시지 리스너 (popup ↔ content 통신)
    if (chrome.runtime?.id) {
      chrome.runtime.onMessage.addListener(onExtensionMessage);
    }

    // 사이트 음량 적용 (site-volume.js에서 이미 API 패치 완료)
    applySiteVolume(config.general.siteVolume ?? 1.0);

    // 사이트 UI에 음량 슬라이더 주입
    injectSiteVolumeSlider();

    // 저장된 턴 전투 상태 복원 시도 (새로고침 후)
    const restored = await _tryRestoreTurnCombat();
    if (restored) {
      alwaysLog('턴 전투 상태 복원 완료 — 전투 보조 모드 재개');
    }

    alwaysLog('초기화 완료! 트리거 대기 중...');
    log(`트리거 정규식: ${config.patterns.triggerRegex}`);
    } catch (err) {
      console.error('[BWBR] 초기화 실패:', err);
      alwaysLog('초기화 실패: ' + (err.message || err));
    }
  }

  // ── 설정 로드 ────────────────────────────────────────────

  async function loadConfig() {
    return new Promise((resolve) => {
      // 확장 컨텍스트 무효화 대비: 타임아웃 후 기본값 사용
      const fallbackTimer = setTimeout(() => {
        alwaysLog('설정 로드 타임아웃 → 기본값 사용');
        resolve(JSON.parse(JSON.stringify(window.BWBR_DEFAULTS)));
      }, 5000);
      try {
        chrome.storage.sync.get('bwbr_config', (result) => {
          clearTimeout(fallbackTimer);
          if (chrome.runtime.lastError) {
            alwaysLog('설정 로드 오류: ' + chrome.runtime.lastError.message + ' → 기본값 사용');
            resolve(JSON.parse(JSON.stringify(window.BWBR_DEFAULTS)));
            return;
          }
          if (result.bwbr_config) {
            // 저장된 설정과 기본값 병합 (새 키 추가 대응)
            const merged = deepMerge(window.BWBR_DEFAULTS, result.bwbr_config);
            // 정규식, 템플릿은 항상 최신 기본값을 사용 (이전 버전 호환)
            merged.patterns = JSON.parse(JSON.stringify(window.BWBR_DEFAULTS.patterns));
            merged.templates = JSON.parse(JSON.stringify(window.BWBR_DEFAULTS.templates));
            // 효과음: 구 형식(single) → 신 형식(array) 마이그레이션
            migrateSounds(merged.sounds);
            alwaysLog('저장된 설정 로드 (패턴/템플릿은 기본값 사용)');
            resolve(merged);
          } else {
            alwaysLog('기본 설정 사용');
            resolve(JSON.parse(JSON.stringify(window.BWBR_DEFAULTS)));
          }
        });
      } catch (e) {
        clearTimeout(fallbackTimer);
        alwaysLog('chrome.storage 접근 실패: ' + e.message + ' → 기본값 사용');
        resolve(JSON.parse(JSON.stringify(window.BWBR_DEFAULTS)));
      }
    });
  }

  /** 깊은 병합 */
  function deepMerge(defaults, overrides) {
    const result = JSON.parse(JSON.stringify(defaults));
    for (const key of Object.keys(overrides)) {
      if (
        overrides[key] &&
        typeof overrides[key] === 'object' &&
        !Array.isArray(overrides[key]) &&
        result[key] &&
        typeof result[key] === 'object'
      ) {
        result[key] = deepMerge(result[key], overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }
    return result;
  }

  // ── 사용자 메시지 도착 대기 ───────────────────────

  /** 설정된 사운드 배열에서 무작위 하나를 @sound 형식으로 반환. 비어있으면 빈 문자열. */
  function _pickCutin(soundsKey) {
    const arr = config?.sounds?.[soundsKey];
    if (!arr || arr.length === 0) return '';
    return ' @' + arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * 사용자의 트리거 메시지가 Firestore/Redux에 도착할 때까지 대기.
   * onInputSubmit은 keydown(Enter) 시점에 발동하므로, 실제 메시지가
   * Firestore에 기록되기 전에 시스템 메시지가 먼저 전송되는 것을 방지.
   * @param {number} maxWait - 최대 대기 시간 (ms). 기본 1500ms.
   */
  function waitForUserMessageDelivery(maxWait = 1500) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('bwbr-new-chat-message', handler);
        resolve();
      };
      const handler = () => finish();
      window.addEventListener('bwbr-new-chat-message', handler);
      setTimeout(finish, maxWait);
    });
  }

  /**
   * 시스템 메시지 전송 전에 호출: 사용자 메시지가 먼저 도착하도록 대기.
   * onInputSubmit 경유 시에만 실제 대기하고, onNewMessage 경유 시에는 즉시 통과.
   */
  async function _awaitUserMessage() {
    if (_userMessagePendingPromise) {
      await _userMessagePendingPromise;
      _userMessagePendingPromise = null;
    }
  }

  // ── 사용자 입력 감지 (Enter 키) ───────────────────

  function onInputSubmit(text) {
    if (!enabled) return;
    // @ 컷인 명령은 무시 (절대 전투 트리거가 아님)
    if (text.startsWith('@')) return;
    log(`[입력 감지] "${text.substring(0, 80)}"`);  // 디버그 모드에서만

    // _cachedSpeakerName는 Redux subscription(bwbr-speaker-changed) + bwbr-switch-character로 실시간 갱신됨

    // ★ 사용자 메시지가 Firestore에 도착할 때까지 대기할 프라미스 생성
    // 시스템 메시지(턴 안내, 행동 소비 등)가 사용자 메시지 이후에 전송되도록 보장
    _userMessagePendingPromise = waitForUserMessageDelivery();

    // 전투 보조 시스템 트리거는 항상 먼저 체크 (범용 트리거와 독립 실행)
    if (flowState === STATE.IDLE || flowState === STATE.TURN_COMBAT) {
      checkForCombatAssistTrigger(text);
    }

    // 범용 트리거 엔진 매칭
    if (triggerEngine) {
      const match = triggerEngine.check(text, 'input');
      if (match) {
        triggerEngine.execute(match.trigger, match.params, true);
        // 트리거 매칭 후에도 합 개시 체크는 수행 (《합 개시》 등은 트리거와 별개)
        if (flowState === STATE.IDLE || flowState === STATE.TURN_COMBAT) {
          checkForTrigger(text);
        }
        checkForCancel(text);
        return;
      }
    }

    // 합 개시: IDLE 또는 TURN_COMBAT에서 능동 합 진행 시작
    if (flowState === STATE.IDLE || flowState === STATE.TURN_COMBAT) {
      checkForTrigger(text);
    }
    checkForCancel(text);
  }

  // ── 채팅 로그 메시지 처리 ───────────────────────

  function onNewMessage(text, element, senderName) {
    if (!enabled) return;

    log(`[상태: ${flowState}] 메시지 수신: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

    // 범용 트리거 엔진 매칭 (source = 'message')
    if (triggerEngine) {
      const diceValue = chat.parseDiceResult(text);
      // 주사위 결과 대기 중이면 캡처 (동작 체인 내 dice 액션용)
      if (diceValue != null) {
        triggerEngine.resolvePendingDice(diceValue);
      }
      const match = triggerEngine.check(text, 'message', diceValue, senderName);
      if (match) {
        triggerEngine.execute(match.trigger, match.params, false);
      }
    }

    // 전투 보조 관전 추적 (전투 진행자가 아닌 경우)
    if (flowState !== STATE.TURN_COMBAT) {
      processTurnCombatTracking(text).catch(e => {
        alwaysLog(`[관전 추적] 에러: ${e.message}`);
      });
    }

    switch (flowState) {
      case STATE.IDLE:
        // 합 개시 트리거는 입력 훅(onInputSubmit)에서 감지
        // 다른 사용자가 전송한 합 개시 메시지 → 관전 모드
        checkForSpectatorTrigger(text);
        checkForCancel(text);
        break;

      case STATE.TURN_COMBAT:
        // 전투 보조 모드: 차례 종료, 주 행동 감지
        processCombatAssistMessage(text, senderName);
        // 합 개시 감지 (전투 중 합 → 합 관전 모드로 전환)
        checkForSpectatorTriggerFromTurnCombat(text);
        break;

      case STATE.SPECTATING:
        processSpectatorMessage(text);
        break;

      case STATE.WAITING_ATTACKER_RESULT:
        checkForAttackerResult(text);
        checkForCancel(text);
        break;

      case STATE.WAITING_DEFENDER_RESULT:
        checkForDefenderResult(text);
        checkForCancel(text);
        break;

      case STATE.PAUSED:
        // 일시정지 중에도 취소는 가능
        checkForCancel(text);
        break;

      default:
        // ROUND_HEADER_SENT, PROCESSING_RESULT, COMBAT_END 등은 타이머로 처리
        checkForCancel(text);
        break;
    }
  }

  // ══════════════════════════════════════════════════════════
  // 전투 보조 시스템 (턴 관리)
  // ══════════════════════════════════════════════════════════

  /** 전투 보조 개시/종료 트리거 감지 */
  async function checkForCombatAssistTrigger(text) {
    // 전투 개시 감지: 《 전투개시 》 또는 《 전투개시 》 @전투
    if (combatEngine.parseCombatStartTrigger(text)) {
      log('[전투 보조] 전투개시 트리거 감지!');
      startCombatAssist();
      return;
    }

    // 전투 종료 감지: 《 전투종료 》
    if (combatEngine.parseCombatEndTrigger && combatEngine.parseCombatEndTrigger(text)) {
      endCombatAssist();
      return;
    }

    // 차례 종료 감지: 《 차례 종료 》 또는 《 차례종료 》
    if (flowState === STATE.TURN_COMBAT && combatEngine.parseTurnEndTrigger(text)) {
      const now = Date.now();
      if (now - _lastTurnAdvanceTime < 1000) {
        log('[전투 보조] 차례 종료 중복 감지 — 무시');
        return;
      }
      _lastTurnAdvanceTime = now;
      log('[전투 보조] 차례종료 트리거 감지!');
      advanceTurn();
      return;
    }

    // ── 행동 소비: 전투 중 《...》 또는 【...】 감지 ──
    if (flowState === STATE.TURN_COMBAT) {
      const mainMatch = /《[^》]+》/.test(text);
      const subMatch = /【[^】]+】/.test(text);

      if (mainMatch || subMatch) {
        const statLabel = mainMatch ? '주 행동🔺' : '보조 행동🔹';
        const emoji = mainMatch ? '🔺' : '🔹';
        const actionType = mainMatch ? '주' : '보조';
        // 행동 소비 대상: 발화(선택) 캐릭터 (입력한 캐릭터)
        const speakerName = _cachedSpeakerName;

        if (!speakerName) {
          log(`[전투 보조] 화자 이름 없음 — 행동 소비 생략`);
          return;
        }

        log(`[전투 보조] ${actionType} 행동 소비 감지: ${speakerName}`);

        // 사용자 메시지 도착 대기 후 스탯 차감 (silent: 개별 메시지 억제)
        await _awaitUserMessage();
        const result = await _modifyCharStat(speakerName, statLabel, '-', 1, true);

        if (result && result.success) {
          // 묶인 메시지 전송
          let msg = `〔 ${emoji}${actionType} 행동 소비 〕`;
          msg += `\n[ ${speakerName} ] ${statLabel} : ${result.oldVal} → ${result.newVal}`;
          chat.sendSystemMessage(msg);

          // 오버레이 UI 갱신
          _scheduleStatRefreshUI();
        } else {
          alwaysLog(`[전투 보조] 행동 소비 실패: ${result ? result.error : '타임아웃'}`);
        }
      }
    }
  }

  /** MAIN 월드에서 캐릭터 전투 스탯 조회 (DOM 속성 브릿지) */
  function _fetchCharStatsFromMain(name) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        window.removeEventListener('bwbr-char-stats-result', handler);
        resolve(null);
      }, 3000);
      function handler() {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-char-stats-result', handler);
        const raw = document.documentElement.getAttribute('data-bwbr-char-stats-result');
        document.documentElement.removeAttribute('data-bwbr-char-stats-result');
        if (raw) { try { resolve(JSON.parse(raw)); return; } catch (e) {} }
        resolve(null);
      }
      window.addEventListener('bwbr-char-stats-result', handler);
      document.documentElement.setAttribute('data-bwbr-get-char-stats', name);
      window.dispatchEvent(new CustomEvent('bwbr-get-char-stats'));
    });
  }

  /** 전투 보조 모드에서 채팅 메시지 처리 (onNewMessage 경유)
   *  주/보조 행동 소모는 트리거 시스템이 담당하므로 여기서는 차례 종료만 감지합니다. */
  function processCombatAssistMessage(text, senderName) {
    if (flowState !== STATE.TURN_COMBAT) return;

    // 차례 종료 감지: 《 차례 종료 》
    if (combatEngine.parseTurnEndTrigger(text)) {
      // 디바운스: 1초 내 중복 호출 방지
      const now = Date.now();
      if (now - _lastTurnAdvanceTime < 1000) {
        log('[전투 보조] 차례 종료 중복 감지 — 무시');
        return;
      }
      _lastTurnAdvanceTime = now;
      advanceTurn();
      return;
    }

    // 스탯 변경 알림에 의한 UI 자동 갱신
    // 행동 소비/추가 시스템 메시지 감지 시 UI 갱신 (〔〕 및 《》 모두 지원)
    if (/[《〔].*행동\s*(소비|추가)[》〕]/.test(text) || /\]\s*주 행동🔺/.test(text) || /\]\s*보조 행동🔹/.test(text)) {
      _scheduleStatRefreshUI();
    }
  }

  /** 스탯 변경 후 UI 자동 갱신 (디바운스)
   *  @param {number} [ms=800] 대기 시간 (ms) */
  let _statRefreshTimer = null;
  function _scheduleStatRefreshUI(ms) {
    clearTimeout(_statRefreshTimer);
    _statRefreshTimer = setTimeout(async () => {
      // Firestore 반영 대기 후 최신 데이터로 오버레이 갱신
      await _refreshCharacterOriginalData();
      await refreshTurnUI();
    }, ms != null ? ms : 800);
  }

  /** 전투 보조 시작 */
  async function startCombatAssist() {
    alwaysLog('🎲 전투 보조 모드 시작!');
    
    overlay.show();
    overlay.addLog('캐릭터 데이터 로딩 중...', 'info');

    // 페이지 컨텍스트에서 캐릭터 데이터 요청
    const characters = await requestCharacterData();
    
    if (!characters || characters.length === 0) {
      overlay.addLog('전투 보조 시작 실패 — 캐릭터 데이터를 찾을 수 없습니다.', 'error');
      return;
    }

    // 캐릭터 데이터를 Combat Engine에 전달
    combatEngine.setCharacterData(characters);
    
    _doStartCombatAssist();
  }

  async function _doStartCombatAssist() {
    const result = combatEngine.startCombat();
    if (!result.success) {
      alwaysLog(`전투 보조 시작 실패: ${result.message}`);
      overlay.show();
      overlay.addLog(`전투 보조 시작 실패 — ${result.message || '캐릭터 데이터를 찾을 수 없습니다.'}`, 'error');
      return;
    }

    flowState = STATE.TURN_COMBAT;
    
    overlay.show();
    overlay.addLog('🎲 전투 보조 모드 시작!', 'success');
    overlay.setStatus('active', '전투 보조 중');

    // 턴 순서 표시
    const state = combatEngine.getState();
    const turnOrder = state.turnOrder.map((c, i) => 
      `${i + 1}. ${c.name} (행동력: ${c.initiative})`
    ).join('\n');
    log(`턴 순서:\n${turnOrder}`);

    // 전체 행동력 초기화 (silent: 개별 메시지 억제) + 묶인 메시지 전송
    await _resetAllActionStats('⚔️ 전투 개시');

    // 첫 턴 시작 (currentTurnIndex를 -1에서 0으로)
    combatEngine.nextTurn();

    // 상태 저장
    _saveTurnCombatState();

    // 첫 턴 시작 메시지 전송
    sendTurnStartMessage();

    // 전투 개시 컷인 (있으면)
    const startCutin = _pickCutin('battleStartSounds');
    if (startCutin) {
      chat.sendSystemMessage(startCutin);
    }
  }

  /** 전체 캐릭터 행동력 초기화 → 묶인 시스템 메시지 전송
   *  @param {string} headerText - 메시지 헤더 (예: '⚔️ 전투 개시', '🏳️ 전투 종료') */
  async function _resetAllActionStats(headerText) {
    await _modifyAllCharStat('취약💥', '=', 0, true);
    await _modifyAllCharStat('주 행동🔺', '=max', 0, true);
    await _modifyAllCharStat('보조 행동🔹', '=max', 0, true);

    let msg = `〔 ${headerText} 〕`;
    msg += `\n모든 캐릭터의 행동력이 초기화되었습니다.`;
    chat.sendSystemMessage(msg);
  }

  /** 다음 턴으로 이동 */
  function advanceTurn() {
    if (flowState !== STATE.TURN_COMBAT) return;

    const nextChar = combatEngine.nextTurn();
    if (!nextChar) {
      // 모든 캐릭터 턴 완료 → 다시 첫 번째로
      log('모든 캐릭터 턴 완료, 처음으로 돌아감');
    }

    // 턴 시작 메시지 + 스탯 리셋은 sendTurnStartMessage에서 처리
    sendTurnStartMessage();
  }

  // ── 스탯 변경 헬퍼 ──────────────────────────────

  /** 개별 캐릭터 스탯 변경 이벤트 발송 (Promise 반환, silent 지원) */
  function _modifyCharStat(characterName, statLabel, operation, value, silent) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        window.removeEventListener('bwbr-modify-status-result', handler);
        resolve(null);
      }, 5000);
      function handler() {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-modify-status-result', handler);
        const raw = document.documentElement.getAttribute('data-bwbr-modify-status-result');
        document.documentElement.removeAttribute('data-bwbr-modify-status-result');
        let result = null;
        if (raw) { try { result = JSON.parse(raw); } catch (e) {} }
        resolve(result);
      }
      window.addEventListener('bwbr-modify-status-result', handler);
      const detail = {
        targetName: characterName,
        statusLabel: statLabel,
        operation: operation,
        value: value,
        valueType: 'value',
        silent: !!silent
      };
      document.documentElement.setAttribute('data-bwbr-modify-status', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-status', { detail: detail }));
    });
  }

  /** 전체 캐릭터 스탯 일괄 변경 (Promise 반환, silent 지원)
   *  반환: { success, affected, label, changes: [{name, oldVal, newVal}] } */
  function _modifyAllCharStat(statLabel, operation, value, silent) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        window.removeEventListener('bwbr-modify-status-all-result', handler);
        resolve(null);
      }, 5000);
      function handler() {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-modify-status-all-result', handler);
        const raw = document.documentElement.getAttribute('data-bwbr-modify-status-all-result');
        document.documentElement.removeAttribute('data-bwbr-modify-status-all-result');
        let result = null;
        if (raw) { try { result = JSON.parse(raw); } catch (e) {} }
        resolve(result);
      }
      window.addEventListener('bwbr-modify-status-all-result', handler);
      const detail = {
        statusLabel: statLabel,
        operation: operation,
        value: value,
        valueType: 'value',
        silent: !!silent
      };
      document.documentElement.setAttribute('data-bwbr-modify-status-all', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-status-all', { detail: detail }));
    });
  }

  /** 간단한 딜레이 유틸 */
  function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 턴 전투 UI 갱신 */
  /** 캐릭터 originalData에서 의지/장갑/이명 정보 추출 */
  function _extractCharInfo(current) {
    let willValue = null;
    let willMax = null;
    const willStatus = combatEngine.getStatusValue(current.originalData, '의지');
    if (willStatus) {
      willValue = willStatus.value;
      willMax = willStatus.max;
    } else {
      const paramWill = combatEngine.getParamValue(current.originalData, '의지');
      if (paramWill !== null) {
        willValue = paramWill;
        willMax = paramWill;
      }
    }

    let armorValue = null;
    const armorStatus = combatEngine.getStatusValue(current.originalData, '장갑');
    if (armorStatus !== null) {
      armorValue = armorStatus.value;
    } else {
      const paramArmor = combatEngine.getParamValue(current.originalData, '장갑');
      if (paramArmor !== null) armorValue = paramArmor;
    }

    const aliasValue = combatEngine.getParamValue(current.originalData, '이명');

    return { willValue, willMax, armorValue, aliasValue };
  }

  /** Redux에서 최신 캐릭터 데이터를 가져와 엔진의 originalData를 갱신합니다. */
  async function _refreshCharacterOriginalData() {
    try {
      const characters = await requestCharacterData();
      if (characters && characters.length > 0) {
        combatEngine.refreshOriginalData(characters);
      }
    } catch (e) {
      alwaysLog(`[전투 보조] 캐릭터 데이터 갱신 실패: ${e.message}`);
    }
  }

  // ── 턴 전투 상태 영속성 (새로고침 복원) ──────────────────

  /** 현재 턴 전투 상태를 chrome.storage.session에 저장합니다. */
  function _saveTurnCombatState() {
    if (flowState !== STATE.TURN_COMBAT) return;
    try {
      const data = combatEngine.serializeTurnCombat();
      if (data) {
        chrome.storage.session.set({ bwbr_turnCombat: data });
        log('[턴 전투] 상태 저장됨');
      }
    } catch (e) {
      alwaysLog(`[턴 전투] 상태 저장 실패: ${e.message}`);
    }
  }

  /** chrome.storage.session에서 턴 전투 상태를 삭제합니다. */
  function _clearTurnCombatState() {
    try {
      chrome.storage.session.remove('bwbr_turnCombat');
      log('[턴 전투] 저장된 상태 삭제');
    } catch (e) {
      // 무시
    }
  }

  /**
   * 새로고침 후 저장된 턴 전투 상태를 복원합니다.
   * init() 말미에서 호출됩니다.
   */
  async function _tryRestoreTurnCombat() {
    try {
      const result = await chrome.storage.session.get('bwbr_turnCombat');
      const data = result?.bwbr_turnCombat;
      if (!data) return false;

      // 10분 이상 지난 상태는 폐기
      if (data.savedAt && Date.now() - data.savedAt > 10 * 60 * 1000) {
        alwaysLog('[턴 전투] 저장된 상태가 10분 초과 — 폐기');
        _clearTurnCombatState();
        return false;
      }

      // 엔진에 상태 복원
      const restored = combatEngine.restoreTurnCombat(data);
      if (!restored) {
        alwaysLog('[턴 전투] 엔진 복원 실패');
        _clearTurnCombatState();
        return false;
      }

      // Redux에서 최신 캐릭터 데이터로 originalData 채우기
      await _refreshCharacterOriginalData();

      // 흐름 상태 & 오버레이 복원
      flowState = STATE.TURN_COMBAT;
      overlay.show();
      overlay.setStatus('active', '전투 보조 중');
      overlay.addLog('🔄 전투 보조 복원됨 (새로고침)', 'success');

      // 현재 턴 UI 표시
      await refreshTurnUI();

      // HP 데이터가 비어있으면 재시도 (Redux 인젝터 초기화 지연 대응)
      _retryRefreshIfMissingHP();

      log('[턴 전투] 상태 복원 완료!');
      return true;
    } catch (e) {
      alwaysLog(`[턴 전투] 복원 실패: ${e.message}`);
      return false;
    }
  }

  /**
   * 복원 후 HP 정보가 비어있으면 재시도합니다.
   * Redux 인젝터가 아직 준비되지 않았을 수 있으므로 지연 재시도합니다.
   */
  function _retryRefreshIfMissingHP() {
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    if (!current) return;

    const { willValue } = _extractCharInfo(current);
    if (willValue !== null && willValue !== undefined) return; // 이미 있음

    log('[턴 전투] HP 데이터 없음 — 재시도 예약');
    let retries = 0;
    const maxRetries = 5;
    const timer = setInterval(async () => {
      retries++;
      try {
        await _refreshCharacterOriginalData();
        const { willValue: w } = _extractCharInfo(combatEngine.getState().currentCharacter);
        if (w !== null && w !== undefined) {
          log(`[턴 전투] HP 데이터 획득 성공 (${retries}회차)`);
          await refreshTurnUI();
          clearInterval(timer);
        } else if (retries >= maxRetries) {
          alwaysLog('[턴 전투] HP 데이터 재시도 한도 초과');
          clearInterval(timer);
        }
      } catch (e) {
        if (retries >= maxRetries) clearInterval(timer);
      }
    }, 2000);
  }

  /** 캐릭터의 실제 스탯에서 주 행동/보조 행동 값 추출 */
  function _extractActionStats(current) {
    const mainStatus = combatEngine.getStatusValue(current.originalData, '주 행동');
    const subStatus = combatEngine.getStatusValue(current.originalData, '보조 행동');
    return {
      mainActions: mainStatus ? parseInt(mainStatus.value) || 0 : current.mainActions,
      mainActionsMax: mainStatus ? parseInt(mainStatus.max) || 0 : current.mainActionsMax,
      subActions: subStatus ? parseInt(subStatus.value) || 0 : current.subActions,
      subActionsMax: subStatus ? parseInt(subStatus.max) || 0 : current.subActionsMax
    };
  }

  async function refreshTurnUI() {
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    if (!current) return;

    // Redux에서 최신 캐릭터 데이터 가져와 originalData 갱신
    await _refreshCharacterOriginalData();

    const { willValue, willMax, armorValue, aliasValue } = _extractCharInfo(current);
    const actionStats = _extractActionStats(current);

    overlay.updateTurnInfo({
      name: current.name,
      iconUrl: current.iconUrl,
      will: willValue,
      willMax: willMax,
      armor: armorValue,
      alias: aliasValue,
      mainActions: actionStats.mainActions,
      mainActionsMax: actionStats.mainActionsMax,
      subActions: actionStats.subActions,
      subActionsMax: actionStats.subActionsMax
    });
  }

  /** 턴 시작 메시지 전송 + 해당 캐릭터의 주/보조 행동 stat을 최대치로 리셋 */
  async function sendTurnStartMessage() {
    // 사용자 트리거 메시지가 먼저 도착하도록 대기
    await _awaitUserMessage();
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    
    if (!current) {
      log('현재 차례 캐릭터 없음');
      return;
    }

    // 차례 시작 시: 현재 캐릭터의 주 행동/보조 행동을 최대치로 리셋 (silent)
    const r1 = await _modifyCharStat(current.name, '주 행동🔺', '=max', 0, true);
    const r2 = await _modifyCharStat(current.name, '보조 행동🔹', '=max', 0, true);

    // Firestore 반영 대기 후 최신 데이터 가져오기
    await _delay(400);
    await _refreshCharacterOriginalData();

    const { willValue, willMax, armorValue, aliasValue } = _extractCharInfo(current);
    const actionStats = _extractActionStats(current);

    // 묶인 턴 시작 메시지
    let turnMsg = `〔 ${current.name}의 차례 〕`;
    turnMsg += `\n🔺주 행동 ${actionStats.mainActions}개, 🔹보조 행동 ${actionStats.subActions}개 | 이동거리 ${current.movement}`;
    const cutin = _pickCutin('turnStartSounds');
    if (cutin) turnMsg += cutin;
    
    log(`턴 메시지: ${turnMsg}`);
    overlay.addLog(`🎯 ${current.name}의 차례`, 'success');

    overlay.updateTurnInfo({
      name: current.name,
      iconUrl: current.iconUrl,
      will: willValue,
      willMax: willMax,
      armor: armorValue,
      alias: aliasValue,
      mainActions: actionStats.mainActions,
      mainActionsMax: actionStats.mainActionsMax,
      subActions: actionStats.subActions,
      subActionsMax: actionStats.subActionsMax
    });

    // 채팅으로 전송
    chat.sendSystemMessage(turnMsg);
  }

  /** 전투 보조 모드 종료 */
  async function endCombatAssist() {
    if (flowState !== STATE.TURN_COMBAT) return;

    alwaysLog('🎲 전투 보조 모드 종료');

    // 전체 행동력 초기화 + 묶인 메시지 전송
    await _resetAllActionStats('🏳️ 전투 종료');

    // 전투 종료 컷인 (있으면)
    const endCutin = _pickCutin('battleEndSounds');
    if (endCutin) {
      chat.sendSystemMessage(endCutin);
    }

    combatEngine.endCombat();
    flowState = STATE.IDLE;

    _clearTurnCombatState();

    overlay.updateTurnInfo(null);  // 턴 정보 패널 숨김
    overlay.addLog('🎲 전투 보조 모드 종료', 'warning');
    overlay.setStatus('idle', '대기 중');
  }

  // ══════════════════════════════════════════════════════════
  // 전투 보조 관전 추적 (진행자가 아닌 사용자용)
  // ══════════════════════════════════════════════════════════

  /** 전투 보조 메시지를 파싱하여 관전자 UI 업데이트 */
  async function processTurnCombatTracking(text) {
    // 1. 전투 개시 감지 → 캐릭터 캐시 업데이트
    if (combatEngine.parseCombatStartTrigger(text)) {
      log('[관전 추적] 전투 개시 감지!');
      _turnTrackingActive = true;
      await updateCharacterCache();
      overlay.show();  // 오버레이 표시
      overlay.setTurnTrackingMode(true);  // 턴 추적 모드 활성화 → 슬롯 클릭 비활성화
      overlay.addLog('👁️ 전투 관전 모드', 'info');
      overlay.setStatus('active', '👁 전투 관전 중');
      return;
    }

    // 2. 전투 종료 감지 → 추적 종료
    if (combatEngine.parseCombatEndTrigger(text)) {
      if (_turnTrackingActive) {
        log('[관전 추적] 전투 종료 감지');
        _turnTrackingActive = false;
        _currentTrackedTurn = null;
        overlay.setTurnTrackingMode(false);  // 턴 추적 모드 비활성화
        overlay.updateTurnInfo(null);
        overlay.addLog('전투 종료', 'warning');
        overlay.setStatus('idle', '대기 중');
      }
      return;
    }

    // 추적이 활성화되지 않았으면 무시
    if (!_turnTrackingActive) return;

    // 3. 차례 시작 메시지 파싱
    const turnStart = combatEngine.parseTurnStartMessage(text);
    log(`[관전 추적] 차례 시작 파싱 결과: ${JSON.stringify(turnStart)}`);
    if (turnStart) {
      log(`[관전 추적] 차례 시작: ${turnStart.name}`);
      
      // 캐시가 비어있으면 업데이트 기다림
      if (_characterCache.size === 0) {
        log(`[관전 추적] 캐시 비어있음 - 업데이트 대기`);
        await updateCharacterCache();
      }
      
      _currentTrackedTurn = {
        ...turnStart,
        iconUrl: getCharacterIconUrl(turnStart.name)
      };
      updateTrackedTurnUI();
      return;
    }

    // 4. 행동 소비 메시지 파싱
    const actionConsumed = combatEngine.parseActionConsumedMessage(text);
    if (actionConsumed && _currentTrackedTurn) {
      log(`[관전 추적] ${actionConsumed.actionType} 행동 소비: ${actionConsumed.name}`);
      // 현재 차례 캐릭터와 같은지 확인
      if (_currentTrackedTurn.name === actionConsumed.name) {
        _currentTrackedTurn.mainActions = actionConsumed.mainActions;
        _currentTrackedTurn.subActions = actionConsumed.subActions;
        _currentTrackedTurn.movement = actionConsumed.movement;
        updateTrackedTurnUI();
      }
      return;
    }

    // 5. 행동 추가 메시지 파싱
    const actionAdded = combatEngine.parseActionAddedMessage(text);
    if (actionAdded && _currentTrackedTurn) {
      log(`[관전 추적] ${actionAdded.actionType} 행동 추가: ${actionAdded.name}`);
      // 현재 차례 캐릭터와 같은지 확인
      if (_currentTrackedTurn.name === actionAdded.name) {
        _currentTrackedTurn.mainActions = actionAdded.mainActions;
        _currentTrackedTurn.subActions = actionAdded.subActions;
        // max 값 업데이트 (추가된 경우 max가 늘어남)
        if (actionAdded.actionType === '주') {
          _currentTrackedTurn.mainActionsMax = Math.max(
            _currentTrackedTurn.mainActionsMax || 0, 
            actionAdded.mainActions
          );
        } else {
          _currentTrackedTurn.subActionsMax = Math.max(
            _currentTrackedTurn.subActionsMax || 0, 
            actionAdded.subActions
          );
        }
        updateTrackedTurnUI();
      }
      return;
    }
  }

  /** 캐릭터 캐시 업데이트 (Redux에서 가져옴) */
  async function updateCharacterCache() {
    try {
      const characters = await requestCharacterData();
      if (characters && characters.length > 0) {
        _characterCache.clear();
        for (const char of characters) {
          _characterCache.set(char.name, {
            iconUrl: char.iconUrl || null,
            params: char.params || [],
            status: char.status || []
          });
        }
        log(`[관전 추적] 캐릭터 캐시 업데이트: ${_characterCache.size}명`);
      }
    } catch (e) {
      alwaysLog(`[관전 추적] 캐릭터 캐시 업데이트 실패: ${e.message}`);
    }
  }

  /** 캐릭터 이름으로 iconUrl 가져오기 */
  function getCharacterIconUrl(name) {
    const cached = _characterCache.get(name);
    return cached?.iconUrl || null;
  }

  /** 관전 추적 UI 업데이트 */
  function updateTrackedTurnUI() {
    if (!_currentTrackedTurn) return;

    const cached = _characterCache.get(_currentTrackedTurn.name);
    
    // 의지, 장갑, 이명 정보 가져오기 시도
    let willValue = null;
    let willMax = null;
    let armorValue = null;
    let aliasValue = null;

    if (cached) {
      // status에서 의지 찾기
      const willStatus = cached.status?.find(s => s.label === '의지' || s.label?.includes('의지'));
      if (willStatus) {
        willValue = willStatus.value;
        willMax = willStatus.max;
      } else {
        // params에서 의지 찾기
        const willParam = cached.params?.find(p => p.label === '의지' || p.label?.includes('의지'));
        if (willParam) {
          willValue = willParam.value;
          willMax = willParam.value;
        }
      }

      // 장갑 찾기
      const armorStatus = cached.status?.find(s => s.label === '장갑' || s.label?.includes('장갑'));
      if (armorStatus) {
        armorValue = armorStatus.value;
      } else {
        const armorParam = cached.params?.find(p => p.label === '장갑' || p.label?.includes('장갑'));
        if (armorParam) armorValue = armorParam.value;
      }

      // 이명 찾기
      const aliasParam = cached.params?.find(p => p.label === '이명');
      if (aliasParam) aliasValue = aliasParam.value;
    }

    overlay.updateTurnInfo({
      name: _currentTrackedTurn.name,
      iconUrl: _currentTrackedTurn.iconUrl,
      will: willValue,
      willMax: willMax,
      armor: armorValue,
      alias: aliasValue,
      mainActions: _currentTrackedTurn.mainActions,
      mainActionsMax: _currentTrackedTurn.mainActionsMax,
      subActions: _currentTrackedTurn.subActions,
      subActionsMax: _currentTrackedTurn.subActionsMax
    });
  }

  // ══════════════════════════════════════════════════════════
  // 합 (근접전) 시스템
  // ══════════════════════════════════════════════════════════

  // ── 합 개시 트리거 감지 ──────────────────────────────────

  function checkForTrigger(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;

    alwaysLog(`✅ 합 개시 감지! ⚔️${triggerData.attacker.name}(${triggerData.attacker.dice}) vs 🛡️${triggerData.defender.name}(${triggerData.defender.dice})`);

    // TURN_COMBAT에서 합 시작 시: 공격자가 현재 차례자이면 주 행동 스탯 소모
    if (flowState === STATE.TURN_COMBAT) {
      const currentChar = combatEngine.getState().currentCharacter;
      if (currentChar && currentChar.name === triggerData.attacker.name) {
        _modifyCharStat(currentChar.name, '주 행동🔺', '-', 1);
        _scheduleStatRefreshUI();
      }
    }

    // TURN_COMBAT에서 시작한 경우: 합 종료 후 복귀 플래그 설정
    if (flowState === STATE.TURN_COMBAT) {
      _activeCombatFromTurnCombat = true;
      log('⚔️ 전투 보조 중 능동 합 시작 → 합 종료 후 전투 보조로 복귀 예정');
    } else if (_turnTrackingActive) {
      // 관전 추적 중 능동 합 시작 (비호스트)
      _activeCombatFromTurnCombat = true;
      log('⚔️ 전투 관전 중 능동 합 시작 → 합 종료 후 관전 모드로 복귀 예정');
    } else {
      _activeCombatFromTurnCombat = false;
    }

    // 전투 시작
    engine.startCombat(triggerData.attacker, triggerData.defender);
    flowState = STATE.COMBAT_STARTED;

    overlay.clearLog();
    overlay.addLog('전투 개시!', 'success');
    overlay.updateCombatState(engine.getState());
    overlay.setStatus('active', '전투 진행 중');

    // 첫 라운드 시작
    startNextRound();
  }

  // ── 전투 중지 감지 ───────────────────────────────────────

  function checkForCancel(text) {
    if (engine.parseCancelTrigger(text)) {
      cancelCombat();
    }
  }

  function cancelCombat() {
    // 관전 추적 모드(비호스트)에서 취소
    if (_turnTrackingActive) {
      alwaysLog('👁️ 관전 추적 수동 종료');
      _turnTrackingActive = false;
      _currentTrackedTurn = null;
      overlay.setTurnTrackingMode(false);
      overlay.updateTurnInfo(null);
      overlay.addLog('관전 종료', 'warning');
      overlay.setStatus('idle', '대기 중');
      return;
    }

    if (flowState === STATE.IDLE) return;

    if (flowState === STATE.SPECTATING) {
      endSpectating('cancel_combat');
      return;
    }

    log('전투 중지');
    clearTimeout(resultTimeoutId);
    overlay.hideManualInput();
    overlay.hideH0Prompt();

    // 일시정지 상태 해제
    paused = false;
    _pauseRequested = false;
    overlay.setPaused(false);

    _stateBeforePause = null;
    engine.reset();
    overlay.addLog('전투가 중지되었습니다.', 'warning');

    // TURN_COMBAT에서 시작한 합이면 전투 보조 모드로 복귀
    if (_activeCombatFromTurnCombat && combatEngine && combatEngine.inCombat) {
      log('⚔️ 합 중지 → 전투 보조 모드로 복귀');
      _activeCombatFromTurnCombat = false;
      flowState = STATE.TURN_COMBAT;
      overlay.setStatus('active', '전투 보조 중');
      overlay.smoothTransition(() => refreshTurnUI());
      return;
    }

    // 관전 추적 중이었으면 관전 UI 복귀 (비호스트)
    if (_activeCombatFromTurnCombat && _turnTrackingActive) {
      log('⚔️ 합 중지 → 전투 관전 모드로 복귀');
      _activeCombatFromTurnCombat = false;
      flowState = STATE.IDLE;
      overlay.setTurnTrackingMode(true);
      overlay.setStatus('active', '👁 전투 관전 중');
      overlay.smoothTransition(() => updateTrackedTurnUI());
      return;
    }

    _activeCombatFromTurnCombat = false;
    flowState = STATE.IDLE;
    overlay.setStatus('idle', '대기 중');
    overlay.updateCombatState(engine.getState());
  }

  // ── 관전 모드 ────────────────────────────────────────────

  function checkForSpectatorTrigger(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;
    // 관전 추적 중이면 fromTurnCombat=true로 설정 (합 종료 후 관전 UI 복귀)
    startSpectating(triggerData, _turnTrackingActive);
  }

  /** 전투 보조 모드에서 합 개시 감지 (TURN_COMBAT → SPECTATING) */
  function checkForSpectatorTriggerFromTurnCombat(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;
    startSpectating(triggerData, true);
  }

  function startSpectating(triggerData, fromTurnCombat = false) {
    alwaysLog(`👁️ 관전 모드 시작! ⚔️${triggerData.attacker.name}(${triggerData.attacker.dice}) vs 🛡️${triggerData.defender.name}(${triggerData.defender.dice})`);

    // TURN_COMBAT에서 시작했는지 기록 (합 종료 후 복귀용)
    _spectatorFromTurnCombat = fromTurnCombat;

    engine.startCombat(triggerData.attacker, triggerData.defender);
    engine.round = 1;
    flowState = STATE.SPECTATING;
    _spectatorStartTime = Date.now();
    _spectatorAtkRollSeen = false;
    _spectatorDefRollSeen = false;

    overlay.show();
    overlay.clearLog();
    overlay.addLog('👁️ 관전 모드 — 합 진행을 감지합니다.', 'success');
    overlay.updateCombatState(engine.getState());
    overlay.setStatus('active', '👁 관전 중');
    overlay.setSpectatorMode(true);
  }

  /**
   * 관전 모드에서 채팅 메시지를 분석하여 오버레이에 반영합니다.
   * GM의 확장 프로그램이 보내는 메시지 패턴을 감지해 애니메이션을 재생합니다.
   */
  function processSpectatorMessage(text) {
    const state = engine.getState();
    if (!state?.combat) {
      // 관전 시작 후 3초 이내라면 engine.combat이 null이 되는 것은 비정상 — 무시
      if (_spectatorStartTime > 0 && Date.now() - _spectatorStartTime < 3000) {
        log(`[SPEC] ⚠️ engine.combat=null but within 3s grace period — ignoring (text="${text.substring(0,50)}")`);
        return;
      }
      endSpectating('no_combat_state');
      return;
    }

    // 중복 메시지 방지 (2초 내 같은 텍스트 무시)
    const now = Date.now();
    const dedupKey = text.substring(0, 80);
    if (_spectatorDedup.has(dedupKey) && now - _spectatorDedup.get(dedupKey) < 2000) return;
    _spectatorDedup.set(dedupKey, now);
    if (_spectatorDedup.size > 50) {
      for (const [k, t] of _spectatorDedup) { if (now - t > 5000) _spectatorDedup.delete(k); }
    }

    // 1. 합 중지
    if (engine.parseCancelTrigger(text)) {
      overlay.addLog('전투가 중지되었습니다.', 'warning');
      endSpectating('cancel_trigger');
      return;
    }

    // 2. 합 승리 / 종료
    if (text.includes('《합 승리》') || text.includes('《합 종료》')) {
      const cleanText = text.replace(/@\S+/g, '').trim();
      if (text.includes('⚔')) overlay.playVictory('attacker');
      else if (text.includes('🛡')) overlay.playVictory('defender');
      overlay.addLog(cleanText, 'success');
      overlay.setStatus('idle', '전투 종료');
      setTimeout(() => endSpectating('victory_timeout'), 2000);
      return;
    }

    // 3. 라운드 헤더: 《N합》| ⚔️ name dice : 🛡️ name dice @sound
    const roundMatch = text.match(/《(\d+)합》/);
    if (roundMatch) {
      const roundNum = parseInt(roundMatch[1], 10);
      engine.round = roundNum;

      // 헤더에서 양측 주사위 수를 파싱하여 상태 동기화
      const atkNameEsc = state.combat.attacker.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const defNameEsc = state.combat.defender.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const diceRegex = new RegExp(atkNameEsc + '\\s+(\\d+)\\s*:.*?' + defNameEsc + '\\s+(\\d+)');
      const diceMatch = text.match(diceRegex);
      if (diceMatch && engine.combat) {
        engine.combat.attacker.dice = parseInt(diceMatch[1], 10);
        engine.combat.defender.dice = parseInt(diceMatch[2], 10);
      }

      _spectatorAtkRollSeen = false;
      _spectatorDefRollSeen = false;

      overlay.updateCombatState(engine.getState());
      overlay.playClash();
      overlay.addLog(`── 제 ${roundNum}합 ──`, 'info');
      return;
    }

    // 4. 주사위 결과 (공격자)
    if (!_spectatorAtkRollSeen) {
      const atkValue = extractDiceValue(text, state.combat.attacker.name, '⚔');
      if (atkValue !== null) {
        _spectatorAtkRollSeen = true;
        const logType = atkValue >= state.combat.attacker.critThreshold ? 'crit'
          : atkValue <= state.combat.attacker.fumbleThreshold ? 'fumble' : 'info';
        overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${atkValue}`, logType);
        overlay.animateDiceValue('attacker', atkValue);
        overlay.playAttack('attacker');
        if (logType === 'crit') overlay.playCrit('attacker');
        else if (logType === 'fumble') overlay.playFumble('attacker');
        overlay.playParrySound();
        return;
      }
    }

    // 5. 주사위 결과 (방어자)
    if (!_spectatorDefRollSeen) {
      const defValue = extractDiceValue(text, state.combat.defender.name, '🛡');
      if (defValue !== null) {
        _spectatorDefRollSeen = true;
        const logType = defValue >= state.combat.defender.critThreshold ? 'crit'
          : defValue <= state.combat.defender.fumbleThreshold ? 'fumble' : 'info';
        overlay.addLog(`🛡️ ${state.combat.defender.name}: ${defValue}`, logType);
        overlay.animateDiceValue('defender', defValue);
        overlay.playAttack('defender');
        if (logType === 'crit') overlay.playCrit('defender');
        else if (logType === 'fumble') overlay.playFumble('defender');
        overlay.playParrySound();
        return;
      }
    }

    // 6. 특성 / 결과 메시지 (로그에 표시)
    const cleanText = text.replace(/@\S+/g, '').trim();

    if (text.includes('인간 특성 발동')) {
      overlay.addLog(cleanText, 'crit');
      return;
    }
    if (text.includes('피로 새겨진 역사') && text.includes('초기화')) {
      overlay.addLog(cleanText, 'info');
      return;
    }
    if (text.includes('피로 새겨진 역사')) {
      overlay.addLog(cleanText, 'warning');
      return;
    }
    if (text.includes('인간 특성 초기화')) {
      overlay.addLog(cleanText, 'info');
      return;
    }
    // 연격 (N0)
    if (text.includes('연격') && text.includes('초기화')) {
      overlay.addLog(cleanText, 'info');
      return;
    }
    if (text.includes('연격')) {
      overlay.addLog(cleanText, 'warning');
      return;
    }
    // 대성공
    if (text.includes('대성공') && (text.includes('→') || text.includes('파괴'))) {
      overlay.addLog(cleanText, 'crit');
      return;
    }
    // 대실패
    if (text.includes('대실패') && (text.includes('→') || text.includes('파괴'))) {
      overlay.addLog(cleanText, 'fumble');
      return;
    }
    // 쌍방
    if (text.includes('쌍방')) {
      overlay.addLog(cleanText, text.includes('대성공') ? 'crit' : 'fumble');
      return;
    }
    // 무승부 / 재굴림
    if (text.includes('무승부') || text.includes('재굴림')) {
      overlay.playTie();
      overlay.addLog(cleanText, 'warning');
      return;
    }
    // 일반 승리
    if (text.includes('→') && text.includes('승리')) {
      // 승자 파악
      if (text.includes('⚔')) overlay.playRoundWin('attacker');
      else if (text.includes('🛡')) overlay.playRoundWin('defender');
      overlay.addLog(cleanText, 'info');
      return;
    }
  }

  function endSpectating(reason = 'unknown') {
    alwaysLog(`👁️ 관전 모드 종료 (reason=${reason}, flowState=${flowState})`);

    // 이미 SPECTATING이 아니면 무시 (중복 호출 방지)
    if (flowState !== STATE.SPECTATING) {
      log(`👁️ endSpectating 무시: flowState=${flowState}`);
      return;
    }
    
    engine.reset();
    _spectatorDedup.clear();
    _spectatorStartTime = 0;
    overlay.setSpectatorMode(false);

    // TURN_COMBAT에서 시작했고, 전투가 아직 진행 중이면 턴 UI로 복귀
    if (_spectatorFromTurnCombat && combatEngine && combatEngine.inCombat) {
      log('👁️ 합 종료 → 전투 보조 모드로 복귀');
      flowState = STATE.TURN_COMBAT;
      _spectatorFromTurnCombat = false;
      overlay.addLog('합 종료 — 전투 보조 모드로 복귀', 'info');
      overlay.setStatus('active', '전투 보조 중');
      overlay.smoothTransition(() => refreshTurnUI());
      return;
    }

    // 관전 추적 중이었으면 추적 UI 복귀 (비호스트 사용자)
    if (_spectatorFromTurnCombat && _turnTrackingActive) {
      log('👁️ 합 종료 → 전투 관전 모드로 복귀');
      flowState = STATE.IDLE;
      _spectatorFromTurnCombat = false;
      overlay.setTurnTrackingMode(true);
      overlay.addLog('합 종료 — 전투 관전 모드로 복귀', 'info');
      overlay.setStatus('active', '👁 전투 관전 중');
      overlay.smoothTransition(() => updateTrackedTurnUI());
      return;
    }

    // 일반 관전 종료
    flowState = STATE.IDLE;
    _spectatorFromTurnCombat = false;
    overlay.addLog('관전 종료', 'info');
    overlay.setStatus('idle', '대기 중');
    setTimeout(() => overlay.updateCombatState(engine.getState()), 5000);
  }

  // ── 일시정지/재개 ──────────────────────────────────

  function togglePause() {
    if (paused || _pauseRequested) {
      resumeCombat();
    } else {
      pauseCombat();
    }
  }

  /**
   * 일시정지 — 주사위 굴림(WAITING) 상태에서만 실제 멈춤.
   * 합 결과나 라운드 헤더 중이면 예약만 걸고, 굴림까지 진행 후 멈춤.
   */
  function pauseCombat() {
    if (flowState === STATE.IDLE || flowState === STATE.COMBAT_END || flowState === STATE.SPECTATING || paused || _pauseRequested) return;

    // 이미 주사위 대기 상태면 즉시 멈춤
    if (flowState === STATE.WAITING_ATTACKER_RESULT || flowState === STATE.WAITING_DEFENDER_RESULT) {
      _applyPause();
      return;
    }

    // 그 외 상태(헤더, 결과처리 등)는 예약만 → 굴림까지 진행 후 자동 멈춤
    _pauseRequested = true;
    log('⏸ 일시정지 예약 (주사위 굴림 후 적용)');
    overlay.setPaused(true);
    overlay.setStatus('active', '주사위 굴림 후 일시정지...');
    overlay.addLog('주사위 굴림 후 일시정지됩니다.', 'warning');
  }

  /** 실제 일시정지 적용 (내부용) */
  function _applyPause() {
    paused = true;
    _pauseRequested = false;
    _stateBeforePause = flowState;
    flowState = STATE.PAUSED;
    clearTimeout(resultTimeoutId);

    alwaysLog('⏸ 전투 일시정지');
    overlay.setPaused(true);
    overlay.setStatus('paused', '일시정지');
    overlay.addLog('전투가 일시정지되었습니다.', 'warning');
  }

  /**
   * 재개 — 즉시 수동 입력창을 띄워서 결과를 받음.
   * 채팅 인식이 일시정지 후 동작하지 않으므로 수동 입력으로 바로 전환.
   */
  function resumeCombat() {
    // 예약만 걸려있었다면 예약 취소
    if (_pauseRequested && !paused) {
      _pauseRequested = false;
      overlay.setPaused(false);
      overlay.setStatus('active', '전투 진행 중');
      overlay.addLog('일시정지가 취소되었습니다.', 'info');
      return;
    }

    if (!paused) return;

    paused = false;
    _pauseRequested = false;
    const restoreState = _stateBeforePause;
    _stateBeforePause = null;

    alwaysLog(`▶ 전투 재개 (복원: ${restoreState})`);
    overlay.setPaused(false);
    overlay.addLog('전투가 재개되었습니다.', 'success');

    flowState = restoreState;

    // 주사위 대기 상태였으면 → 즉시 수동 입력창 표시
    if (restoreState === STATE.WAITING_ATTACKER_RESULT || restoreState === STATE.WAITING_DEFENDER_RESULT) {
      _showManualInputNow(restoreState);
    } else {
      overlay.setStatus('active', '전투 진행 중');
    }
  }

  /**
   * 재개 시 즉시 수동 입력창 표시 (타임아웃 없이 바로)
   */
  async function _showManualInputNow(waitingState) {
    const state = engine.getState();
    if (!state?.combat) return;

    let who, emoji, playerName;
    if (waitingState === STATE.WAITING_ATTACKER_RESULT) {
      who = '공격자';
      emoji = '⚔️';
      playerName = state.combat.attacker.name;
    } else {
      who = '방어자';
      emoji = '🛡️';
      playerName = state.combat.defender.name;
    }

    overlay.setStatus('waiting', `${who} 결과 입력 대기...`);
    overlay.addLog(`${who} 결과를 입력해주세요.`, 'warning');

    const manualValue = await overlay.showManualInput(who, emoji, playerName);
    if (manualValue === null) {
      log('수동 입력: 취소됨');
      return;
    }

    log(`수동 입력 (재개): ${who} = ${manualValue}`);
    overlay.addLog(`${emoji} ${playerName}: ${manualValue} (수동 입력)`, 'info');

    if (flowState === STATE.WAITING_ATTACKER_RESULT) {
      flowState = STATE.PROCESSING_RESULT;
      engine.setAttackerRoll(manualValue);
      const logType = manualValue >= state.combat.attacker.critThreshold ? 'crit'
        : manualValue <= state.combat.attacker.fumbleThreshold ? 'fumble' : 'info';
      overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${manualValue}`, logType);
      overlay.animateDiceValue('attacker', manualValue);
      overlay.playAttack('attacker');
      if (logType === 'crit') overlay.playCrit('attacker');
      else if (logType === 'fumble') overlay.playFumble('attacker');
      setTimeout(() => rollForDefender(), config.timing.betweenRolls);
    } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
      flowState = STATE.PROCESSING_RESULT;
      engine.setDefenderRoll(manualValue);
      const logType = manualValue >= state.combat.defender.critThreshold ? 'crit'
        : manualValue <= state.combat.defender.fumbleThreshold ? 'fumble' : 'info';
      overlay.addLog(`🛡️ ${state.combat.defender.name}: ${manualValue}`, logType);
      overlay.animateDiceValue('defender', manualValue);
      overlay.playAttack('defender');
      if (logType === 'crit') overlay.playCrit('defender');
      else if (logType === 'fumble') overlay.playFumble('defender');
      setTimeout(() => processRoundResult(), config.timing.beforeRoundResult);
    }
  }

  // ── 라운드 진행 ──────────────────────────────────────────

  async function startNextRound() {
    engine.incrementRound();
    const state = engine.getState();
    overlay.updateCombatState(state);

    // 충돌 애니메이션 재생
    overlay.playClash();

    // 라운드 헤더 전송
    const headerMsg = engine.getRoundHeaderMessage();
    log(`라운드 ${state.round} 헤더 전송`);
    overlay.addLog(`── 제 ${state.round}합 ──`, 'info');

    flowState = STATE.ROUND_HEADER_SENT;
    await chat.sendSystemMessage(headerMsg);

    // 대기 후 공격자 굴림
    await delay(config.general.manualMode ? 0 : config.timing.beforeFirstRoll);
    rollForAttacker();
  }

  async function rollForAttacker() {
    flowState = STATE.WAITING_ATTACKER_RESULT;
    overlay.setStatus('waiting', '공격자 결과 대기 중...');

    if (config.general.manualMode) {
      // 수동 모드: 채팅에 굴림 메시지를 보내지 않고 바로 수동 입력
      log('수동 모드: 공격자 주사위 결과 입력 대기');
      overlay.playParrySound();
      await processManualDiceInput('공격자');
    } else {
      const state = engine.getState();
      const bonus = engine.combat?.attacker?.n0Bonus || 0;
      const notation = bonus > 0 ? `1D${config.rules.diceType}+${bonus}` : `1D${config.rules.diceType}`;
      const charName = state.combat.attacker.name;
      const label = `⚔️ ${charName}`;
      log(`공격자 주사위 굴림: ${notation} ${label} (${charName} 캐릭터로 직접 전송)`);

      chat.sendDiceAsCharacter(notation, label, charName);
      overlay.playParrySound();

      // 일시정지 예약이 있으면 여기서 멈춤
      if (_pauseRequested) {
        _applyPause();
        return;
      }

      // 빠른 응답으로 이미 결과가 처리된 경우 타임아웃 설정 불필요
      if (flowState === STATE.WAITING_ATTACKER_RESULT) {
        setResultTimeout('공격자');
      }
    }
  }

  /**
   * 주사위 결과 값 추출 (이름 기반 패턴)
   * 그룹된 메시지(textContent에 다른 메시지도 포함)에서도 정확히 추출
   * - "이름: 숫자" 패턴을 우선 매칭 (라운드 헤더의 "이름 숫자 :" 패턴과 혼동 방지)
   */
  function extractDiceValue(text, playerName, emoji) {
    const nameEsc = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emojiEsc = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // N0 연격 보너스로 인해 결과가 diceType을 초과할 수 있음
    const maxDiceVal = config.rules.diceType + 10;

    // Pattern 1: "이름: 숫자" 또는 "이름： 숫자" (코코포리아 주사위 결과 표시)
    const p1 = new RegExp(nameEsc + '\\s*[：:]\\s*(\\d{1,2})');
    const m1 = text.match(p1);
    if (m1) {
      const v = parseInt(m1[1], 10);
      if (v >= 1 && v <= maxDiceVal) return v;
    }

    // Pattern 2: "1D20[+N] [이모지/이름] ... > 숫자" — 이름 또는 이모지가 1D20과 결과값 사이에 있어야 함
    const p2 = new RegExp('1[Dd]20(?:\\+\\d+)?[^>＞→]*(?:' + emojiEsc + '|' + nameEsc + ')[^>＞→]*[→＞>]\\s*(\\d{1,2})');
    const m2 = text.match(p2);
    if (m2) {
      const v = parseInt(m2[1], 10);
      if (v >= 1 && v <= maxDiceVal) return v;
    }

    // Pattern 3: "[이모지/이름]... (1D20[+N]) > 숫자" — 이모지/이름이 1D20 앞에 나오는 패턴
    const p3 = new RegExp('(?:' + emojiEsc + '|' + nameEsc + ')[^>＞→]*\\(1[Dd]20(?:\\+\\d+)?\\)[^>＞→]*[→＞>]\\s*(\\d{1,2})');
    const m3 = text.match(p3);
    if (m3) {
      const v = parseInt(m3[1], 10);
      if (v >= 1 && v <= maxDiceVal) return v;
    }

    // Pattern 4: "결과: 숫자" (이모지 또는 이름 포함 시 — fallback)
    if (text.includes(emoji) || text.includes(playerName)) {
      const m4 = text.match(/결과\s*[：:]\s*(\d{1,2})/);
      if (m4) {
        const v = parseInt(m4[1], 10);
        if (v >= 1 && v <= maxDiceVal) return v;
      }
    }

    return null;
  }

  function checkForAttackerResult(text) {
    const state = engine.getState();
    if (!state?.combat) return;

    const value = extractDiceValue(text, state.combat.attacker.name, '⚔');
    if (value === null) return;

    // 즉시 상태 전환 → 중복 감지 차단
    flowState = STATE.PROCESSING_RESULT;
    clearTimeout(resultTimeoutId);
    overlay.hideManualInput(); // 채팅에서 인식되면 수동입력 숨김
    log(`공격자 결과: ${value}`);
    engine.setAttackerRoll(value);

    // N0 연격 보너스 포함된 결과 → 원본 주사위 값으로 크리/펌블 판정
    const atkN0 = state.combat.attacker.n0Bonus || 0;
    const atkRaw = value - atkN0;
    const logType = atkRaw >= state.combat.attacker.critThreshold ? 'crit'
      : atkRaw <= state.combat.attacker.fumbleThreshold ? 'fumble' : 'info';
    overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${value}${atkN0 > 0 ? ` (${atkRaw}+${atkN0})` : ''}`, logType);
    overlay.animateDiceValue('attacker', value);

    // 공격 모션 + 이펙트
    overlay.playAttack('attacker');

    // 크리/펌블 애니메이션
    if (logType === 'crit') overlay.playCrit('attacker');
    else if (logType === 'fumble') overlay.playFumble('attacker');

    // 대기 후 방어자 굴림
    setTimeout(() => rollForDefender(), config.timing.betweenRolls);
  }

  async function rollForDefender() {
    flowState = STATE.WAITING_DEFENDER_RESULT;
    overlay.setStatus('waiting', '방어자 결과 대기 중...');

    if (config.general.manualMode) {
      // 수동 모드: 채팅에 굴림 메시지를 보내지 않고 바로 수동 입력
      log('수동 모드: 방어자 주사위 결과 입력 대기');
      overlay.playParrySound();
      await processManualDiceInput('방어자');
    } else {
      const state = engine.getState();
      const bonus = engine.combat?.defender?.n0Bonus || 0;
      const notation = bonus > 0 ? `1D${config.rules.diceType}+${bonus}` : `1D${config.rules.diceType}`;
      const charName = state.combat.defender.name;
      const label = `🛡️ ${charName}`;
      log(`방어자 주사위 굴림: ${notation} ${label} (${charName} 캐릭터로 직접 전송)`);

      chat.sendDiceAsCharacter(notation, label, charName);
      overlay.playParrySound();

      // 일시정지 예약이 있으면 여기서 멈춤
      if (_pauseRequested) {
        _applyPause();
        return;
      }

      // 빠른 응답으로 이미 결과가 처리된 경우 타임아웃 설정 불필요
      if (flowState === STATE.WAITING_DEFENDER_RESULT) {
        setResultTimeout('방어자');
      }
    }
  }

  function checkForDefenderResult(text) {
    const state = engine.getState();
    if (!state?.combat) return;

    const value = extractDiceValue(text, state.combat.defender.name, '🛡');
    if (value === null) return;

    // 즉시 상태 전환 → 중복 감지 차단
    flowState = STATE.PROCESSING_RESULT;
    clearTimeout(resultTimeoutId);
    overlay.hideManualInput(); // 채팅에서 인식되면 수동입력 숨김
    log(`방어자 결과: ${value}`);
    engine.setDefenderRoll(value);

    // N0 연격 보너스 포함된 결과 → 원본 주사위 값으로 크리/펌블 판정
    const defN0 = state.combat.defender.n0Bonus || 0;
    const defRaw = value - defN0;
    const logType = defRaw >= state.combat.defender.critThreshold ? 'crit'
      : defRaw <= state.combat.defender.fumbleThreshold ? 'fumble' : 'info';
    overlay.addLog(`🛡️ ${state.combat.defender.name}: ${value}${defN0 > 0 ? ` (${defRaw}+${defN0})` : ''}`, logType);
    overlay.animateDiceValue('defender', value);

    // 공격 모션 + 이펙트
    overlay.playAttack('defender');

    // 크리/펌블 애니메이션
    if (logType === 'crit') overlay.playCrit('defender');
    else if (logType === 'fumble') overlay.playFumble('defender');

    // 대기 후 결과 처리
    setTimeout(() => processRoundResult(), config.timing.beforeRoundResult);
  }

  // ── 라운드 결과 처리 ─────────────────────────────────────

  async function processRoundResult() {
    flowState = STATE.PROCESSING_RESULT;
    overlay.setStatus('active', '결과 처리 중...');

    try {
      const result = engine.processRoundResult(config.general.manualMode);
      if (!result) {
        // 중복 호출로 이미 처리된 경우 → 상태 변경 없이 무시
        log('⚠️ processRoundResult: 이미 처리됨 (중복 호출 무시)');
        return;
      }

      // 결과 메시지 전송 (승자+패자 한 줄씩 묶어서 전송)
      if (result.description) {
        overlay.addLog(result.description, getResultLogType(result));

        if (result.winner) {
          const st = engine.getState();
          const wKey = result.winner;
          const lKey = wKey === 'attacker' ? 'defender' : 'attacker';
          const wIcon = wKey === 'attacker' ? '⚔️' : '🛡️';
          const lIcon = lKey === 'attacker' ? '⚔️' : '🛡️';
          const wName = st.combat[wKey].name;
          const lName = st.combat[lKey].name;
          const wVal = wKey === 'attacker' ? result.attackerRoll : result.defenderRoll;
          const lVal = lKey === 'attacker' ? result.attackerRoll : result.defenderRoll;
          const wCrit = wKey === 'attacker' ? result.attackerCrit : result.defenderCrit;
          const lFumble = lKey === 'attacker' ? result.attackerFumble : result.defenderFumble;
          const wDice = wKey === 'attacker' ? result.atkDiceChange : result.defDiceChange;
          const lDice = lKey === 'attacker' ? result.atkDiceChange : result.defDiceChange;

          let winMsg = `${wIcon} ${wName}【${wVal}】`;
          if (wCrit) winMsg += ' 💥 대성공!';
          if (wDice > 0) winMsg += ` 주사위 +${wDice}`;
          winMsg += ' → 승리!';

          let loseMsg = `${lIcon} ${lName}【${lVal}】`;
          if (lFumble) loseMsg += ' 💀 대실패!';
          if (lDice < 0) loseMsg += ` 주사위 ${lDice}`;

          // 승자+패자 묶어서 한 번에 전송
          await chat.sendSystemMessage(winMsg + '\n' + loseMsg);
        } else {
          // 동점 / 쌍방 대성공/대실패 → 기본 색상
          await chat.sendSystemMessage(result.description);
        }
      }

      // 특성 이벤트 로그 + 채팅 전송 (비대화형 이벤트는 묶어서 전송)
      let manualH0ExtraRound = false;  // 수동 모드 H40/H400 추가 합 플래그
      const traitChatLines = [];       // 묶어서 보낼 특성 메시지 모음
      if (result.traitEvents && result.traitEvents.length > 0) {
        for (const te of result.traitEvents) {
          const icon = te.who === 'attacker' ? '⚔️' : '🛡️';
          let logMsg = '';
          let logType = 'info';
          let chatMsg = '';

          if (['H0', 'H00', 'H40', 'H400'].includes(te.trait) && te.event === 'resurrect') {
            const snd = '발도' + (Math.floor(Math.random() * 3) + 1);
            logMsg = `🔥 ${te.name}: 인간 특성 발동! 주사위 +1 부활`;
            chatMsg = `🔥 인간 특성 발동! | ${icon} ${te.name} 부활! 주사위 +1 @${snd}`;
            logType = 'crit';
          } else if (['H0', 'H00', 'H40', 'H400'].includes(te.trait) && te.event === 'reset') {
            const snd = '발도' + (Math.floor(Math.random() * 3) + 1);
            logMsg = `✨ ${te.name}: 인간 특성 초기화 (재사용 가능)`;
            chatMsg = `✨ 인간 특성 초기화 | ${icon} ${te.name} 재사용 가능 @${snd}`;
          } else if (te.trait === 'H4' && te.event === 'stack') {
            const snd = '위험' + (Math.floor(Math.random() * 3) + 1);
            logMsg = `📜 ${te.name}: 피로 새겨진 역사 +${te.bonus} (대성공 ${te.threshold}+)`;
            chatMsg = `📜 피로 새겨진 역사 | ${icon} ${te.name} 대성공 범위 +${te.bonus} (${te.threshold}+) @${snd}`;
            logType = 'warning';
          } else if (te.trait === 'H4' && te.event === 'reset') {
            logMsg = `📜 ${te.name}: 피로 새겨진 역사 초기화`;
            chatMsg = `📜 피로 새겨진 역사 초기화 | ${icon} ${te.name}`;
          } else if ((te.trait === 'H40' || te.trait === 'H400') && te.event === 'h0_extra_round') {
            const snd = '발도' + (Math.floor(Math.random() * 3) + 1);
            logMsg = `🔥📜 ${te.name}: 인간 특성 발동! 역사(+${te.bonus}) 유지, 추가 합 진행`;
            chatMsg = `🔥📜 인간 특성 발동! | ${icon} ${te.name} 역사(+${te.bonus}) 유지 → 추가 합! @${snd}`;
            logType = 'crit';
          }
          // ── N0 특성: 연격 보너스 ──
          else if (te.trait === 'N0' && te.event === 'stack') {
            logMsg = `⚡ ${te.name}: 연격! 다음 판정 보너스 +${te.bonus}`;
            chatMsg = `⚡ 연격 | ${icon} ${te.name} 다음 판정 +${te.bonus}`;
            logType = 'warning';
          } else if (te.trait === 'N0' && te.event === 'reset') {
            logMsg = `⚡ ${te.name}: 연격 보너스 초기화`;
            chatMsg = `⚡ 연격 초기화 | ${icon} ${te.name}`;
          }
          // ── 수동 모드: H0 발동 사용자 확인 ──
          else if (te.event === 'h0_available') {
            // 대화형 → 묶지 않고 즉시 처리
            if (traitChatLines.length > 0) {
              await chat.sendSystemMessage(traitChatLines.join('\n'));
              traitChatLines.length = 0;
            }
            overlay.addLog(`❓ ${te.name}: 인간 특성 발동 가능 — 확인 대기 중`, 'warning');
            const confirmed = await overlay.showH0Prompt(te.who, te.name);
            if (confirmed) {
              const h0Result = engine.applyManualH0(te.who);
              if (h0Result) {
                const snd = '발도' + (Math.floor(Math.random() * 3) + 1);
                logMsg = `🔥 ${te.name}: 인간 특성 발동! 주사위 +1 부활`;
                chatMsg = `🔥 인간 특성 발동! | ${icon} ${te.name} 부활! 주사위 +1 @${snd}`;
                logType = 'crit';
              }
            } else {
              logMsg = `⚫ ${te.name}: 인간 특성 미발동`;
            }
          }
          // ── 수동 모드: H40/H400 발동 사용자 확인 ──
          else if (te.event === 'h40_h0_available') {
            // 대화형 → 묶지 않고 즉시 처리
            if (traitChatLines.length > 0) {
              await chat.sendSystemMessage(traitChatLines.join('\n'));
              traitChatLines.length = 0;
            }
            overlay.addLog(`❓ ${te.name}: 인간 특성 발동 가능 (역사+${te.bonus} 유지) — 확인 대기 중`, 'warning');
            const confirmed = await overlay.showH0Prompt(te.who, te.name, true);
            if (confirmed) {
              const h40Result = engine.applyManualH40H0(te.who);
              if (h40Result) {
                const snd = '발도' + (Math.floor(Math.random() * 3) + 1);
                logMsg = `🔥📜 ${te.name}: 인간 특성 발동! 역사(+${te.bonus}) 유지, 추가 합 진행`;
                chatMsg = `🔥📜 인간 특성 발동! | ${icon} ${te.name} 역사(+${te.bonus}) 유지 → 추가 합! @${snd}`;
                logType = 'crit';
                manualH0ExtraRound = true;
              }
            } else {
              engine.declineH40H0(te.who);
              logMsg = `📜 ${te.name}: 피로 새겨진 역사 초기화 (인간 특성 미발동)`;
              chatMsg = `📜 피로 새겨진 역사 초기화 | ${icon} ${te.name}`;
            }
          }

          if (logMsg) overlay.addLog(logMsg, logType);
          if (chatMsg) traitChatLines.push(chatMsg);
        }
        // 남은 특성 메시지 묶어서 전송
        if (traitChatLines.length > 0) {
          await chat.sendSystemMessage(traitChatLines.join('\n'));
        }
      }

      // 상태 업데이트 (DOM 갱신 먼저, 애니메이션은 그 다음)
      overlay.updateCombatState(engine.getState());

      // 합 결과 애니메이션: 승리/동점 (DOM 갱신 후 재생해야 클래스가 유지됨)
      if (result.type === 'tie') {
        overlay.playTie();
      } else if (result.winner) {
        overlay.playRoundWin(result.winner);
      }

      // 동점 재굴림 처리 (재굴림도 합 1회로 카운트)
      if (result.needsReroll) {
        overlay.addLog('동점! 재굴림합니다.', 'warning');
        await delay(config.general.manualMode ? 0 : config.timing.beforeNextRound);
        await startNextRound();
        return;
      }

      // H40/H400 추가 합 처리 (인간 특성 발동으로 H4 유지, 합 1회 추가)
      if (manualH0ExtraRound || result.traitEvents?.some(te => (te.trait === 'H40' || te.trait === 'H400') && te.event === 'h0_extra_round')) {
        overlay.addLog('인간 특성 발동! 추가 합 진행...', 'crit');
        await delay(config.general.manualMode ? 0 : config.timing.beforeNextRound);
        await startNextRound();
        return;
      }

      // 승리 확인
      if (engine.isVictory()) {
        await delay(config.general.manualMode ? 0 : config.timing.beforeVictory);
        await announceVictory();
        return;
      }

      // 다음 라운드
      await delay(config.general.manualMode ? 0 : config.timing.beforeNextRound);
      await startNextRound();

    } catch (e) {
      console.error('[BWBR] 결과 처리 오류:', e);
      overlay.addLog(`오류: ${e.message}`, 'error');
      overlay.setStatus('error', '처리 오류');
      flowState = STATE.IDLE;
    }
  }

  function getResultLogType(result) {
    switch (result.type) {
      case 'crit': return 'crit';
      case 'fumble': return 'fumble';
      case 'bothCrit': return 'crit';
      case 'bothFumble': return 'fumble';
      case 'critVsFumble': return 'warning';
      case 'tie': return 'warning';
      default: return 'info';
    }
  }

  // ── 승리 선언 ────────────────────────────────────────────

  async function announceVictory() {
    flowState = STATE.COMBAT_END;
    const victoryMsg = engine.getVictoryMessage();
    const winner = engine.getWinner();

    log(`전투 종료! 승자: ${winner}`);
    await chat.sendSystemMessage(victoryMsg);

    // 승리/패배 애니메이션
    if (winner === 'attacker' || winner === 'defender') {
      overlay.playVictory(winner);
    }

    overlay.addLog(victoryMsg, 'success');
    overlay.setStatus('idle', '전투 종료');

    // 상태 초기화
    engine.reset();

    // TURN_COMBAT에서 시작한 합이면 전투 보조 모드로 복귀
    if (_activeCombatFromTurnCombat && combatEngine && combatEngine.inCombat) {
      log('⚔️ 합 종료 → 전투 보조 모드로 복귀');
      _activeCombatFromTurnCombat = false;
      flowState = STATE.TURN_COMBAT;
      overlay.addLog('합 종료 — 전투 보조 모드로 복귀', 'info');
      overlay.setStatus('active', '전투 보조 중');
      overlay.smoothTransition(() => refreshTurnUI());
      return;
    }

    // 관전 추적 중이었으면 관전 UI 복귀 (비호스트)
    if (_activeCombatFromTurnCombat && _turnTrackingActive) {
      log('⚔️ 합 종료 → 전투 관전 모드로 복귀');
      _activeCombatFromTurnCombat = false;
      flowState = STATE.IDLE;
      overlay.setTurnTrackingMode(true);
      overlay.addLog('합 종료 — 전투 관전 모드로 복귀', 'info');
      overlay.setStatus('active', '👁 전투 관전 중');
      overlay.smoothTransition(() => updateTrackedTurnUI());
      return;
    }

    _activeCombatFromTurnCombat = false;
    flowState = STATE.IDLE;

    // 오버레이 상태 업데이트 (전투 종료 후에도 잠시 표시 유지)
    setTimeout(() => {
      overlay.updateCombatState(engine.getState());
    }, 5000);
  }

  // ── 수동 모드: 주사위 결과 직접 입력 ──────────────────

  async function processManualDiceInput(who) {
    const state = engine.getState();
    if (!state?.combat) return;

    let emoji, playerName, whoKey;
    if (flowState === STATE.WAITING_ATTACKER_RESULT) {
      emoji = '⚔️';
      playerName = state.combat.attacker.name;
      whoKey = 'attacker';
    } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
      emoji = '🛡️';
      playerName = state.combat.defender.name;
      whoKey = 'defender';
    } else {
      return;
    }

    // H0 자유 발동 루프: 사용자가 H0을 입력하면 발동 후 재프롬프트
    let manualValue;
    while (true) {
      const currentFighter = engine.getState().combat[whoKey];
      const h0Available = currentFighter.traits &&
        currentFighter.traits.some(t => ['H0', 'H00', 'H40', 'H400'].includes(t)) &&
        !currentFighter.h0Used;

      manualValue = await overlay.showManualInput(who, emoji, playerName, h0Available);

      if (manualValue === 'H0') {
        const h0Result = engine.activateH0Free(whoKey);
        if (h0Result) {
          const icon = whoKey === 'attacker' ? '⚔️' : '🛡️';
          const snd = '발도' + (Math.floor(Math.random() * 3) + 1);
          overlay.addLog(`🔥 ${playerName}: 인간 특성 발동! 주사위 +1`, 'crit');
          await chat.sendSystemMessage(`🔥 인간 특성 발동! | ${icon} ${playerName} 주사위 +1 @${snd}`);
          overlay.updateCombatState(engine.getState());
        }
        continue; // 다시 주사위 값 입력 대기
      }
      break; // 숫자 입력 또는 취소
    }

    if (manualValue === null) {
      log('수동 입력: 취소됨 (전투 중지)');
      return;
    }

    log(`수동 입력: ${who} = ${manualValue}`);
    overlay.addLog(`${emoji} ${playerName}: ${manualValue} (수동 입력)`, 'info');

    if (flowState === STATE.WAITING_ATTACKER_RESULT) {
      flowState = STATE.PROCESSING_RESULT;
      engine.setAttackerRoll(manualValue);
      const logType = manualValue >= state.combat.attacker.critThreshold ? 'crit'
        : manualValue <= state.combat.attacker.fumbleThreshold ? 'fumble' : 'info';
      overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${manualValue}`, logType);
      overlay.animateDiceValue('attacker', manualValue);
      if (logType === 'crit') overlay.playCrit('attacker');
      else if (logType === 'fumble') overlay.playFumble('attacker');
      setTimeout(() => rollForDefender(), 0);
    } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
      flowState = STATE.PROCESSING_RESULT;
      engine.setDefenderRoll(manualValue);
      const logType = manualValue >= state.combat.defender.critThreshold ? 'crit'
        : manualValue <= state.combat.defender.fumbleThreshold ? 'fumble' : 'info';
      overlay.addLog(`🛡️ ${state.combat.defender.name}: ${manualValue}`, logType);
      overlay.animateDiceValue('defender', manualValue);
      if (logType === 'crit') overlay.playCrit('defender');
      else if (logType === 'fumble') overlay.playFumble('defender');
      setTimeout(() => processRoundResult(), 0);
    }
  }

  // ── 타임아웃 → 수동 입력 요청 ──────────────────────

  function setResultTimeout(who) {
    clearTimeout(resultTimeoutId);
    const expectedRound = engine.round;
    resultTimeoutId = setTimeout(async () => {
      // 라운드가 바뀌었으면 무시 (stale timeout)
      if (engine.round !== expectedRound) {
        log(`${who} 타임아웃 무시 (라운드 변경: ${expectedRound} → ${engine.round})`);
        return;
      }

      log(`${who} 결과 타임아웃 → 수동 입력 요청`);
      overlay.addLog(`${who} 결과를 자동 인식하지 못했습니다. 도우미에 직접 입력해주세요.`, 'warning');

      const state = engine.getState();
      if (!state?.combat) return;

      let emoji, playerName;
      if (flowState === STATE.WAITING_ATTACKER_RESULT) {
        emoji = '⚔️';
        playerName = state.combat.attacker.name;
      } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
        emoji = '🛡️';
        playerName = state.combat.defender.name;
      } else {
        return; // 이미 다른 상태로 전환될 경우
      }

      // 수동 입력 UI 표시 & 대기
      const manualValue = await overlay.showManualInput(who, emoji, playerName);
      if (manualValue === null) {
        // 수동 입력 취소됨 (채팅에서 인식되었거나 전투 중지)
        log('수동 입력: 취소됨 (채팅 인식 또는 중지)');
        return;
      }

      log(`수동 입력: ${who} = ${manualValue}`);
      overlay.addLog(`${emoji} ${playerName}: ${manualValue} (수동 입력)`, 'info');

      if (flowState === STATE.WAITING_ATTACKER_RESULT) {
        flowState = STATE.PROCESSING_RESULT;
        engine.setAttackerRoll(manualValue);
        const logType = manualValue >= state.combat.attacker.critThreshold ? 'crit'
          : manualValue <= state.combat.attacker.fumbleThreshold ? 'fumble' : 'info';
        overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${manualValue}`, logType);
        overlay.animateDiceValue('attacker', manualValue);
        if (logType === 'crit') overlay.playCrit('attacker');
        else if (logType === 'fumble') overlay.playFumble('attacker');
        setTimeout(() => rollForDefender(), config.timing.betweenRolls);
      } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
        flowState = STATE.PROCESSING_RESULT;
        engine.setDefenderRoll(manualValue);
        const logType = manualValue >= state.combat.defender.critThreshold ? 'crit'
          : manualValue <= state.combat.defender.fumbleThreshold ? 'fumble' : 'info';
        overlay.addLog(`🛡️ ${state.combat.defender.name}: ${manualValue}`, logType);
        overlay.animateDiceValue('defender', manualValue);
        if (logType === 'crit') overlay.playCrit('defender');
        else if (logType === 'fumble') overlay.playFumble('defender');
        setTimeout(() => processRoundResult(), config.timing.beforeRoundResult);
      }
    }, config.timing.resultTimeout);
  }

  // ── 확장 프로그램 메시지 처리 ────────────────────────────

  function onExtensionMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'BWBR_GET_STATUS':
        sendResponse({
          enabled: enabled,
          state: flowState,
          paused: paused,
          combat: engine ? engine.getState() : null,
          connected: !!(chat && chat.chatContainer)
        });
        break;

      case 'BWBR_SET_ENABLED':
        enabled = message.enabled;
        overlay.setStatus(enabled ? 'idle' : 'disabled', enabled ? '대기 중' : '비활성');
        if (!enabled) cancelCombat();
        sendResponse({ success: true });
        break;

      case 'BWBR_UPDATE_CONFIG':
        config = deepMerge(window.BWBR_DEFAULTS, message.config);
        // 패턴/템플릿은 항상 최신 기본값 사용 (팝업 측 구버전 호환)
        config.patterns = JSON.parse(JSON.stringify(window.BWBR_DEFAULTS.patterns));
        config.templates = JSON.parse(JSON.stringify(window.BWBR_DEFAULTS.templates));
        engine.updateConfig(config);
        chat.updateConfig(config);
        overlay.updateConfig(config);
        applySiteVolume(config.general.siteVolume ?? 1.0);
        syncSiteVolumeSlider(config.general.siteVolume ?? 1.0);
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_SITE_VOLUME':
        config.general.siteVolume = message.volume;
        applySiteVolume(message.volume);
        syncSiteVolumeSlider(message.volume);
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_MANUAL_MODE':
        config.general.manualMode = message.manualMode;
        alwaysLog(`수동 모드 ${message.manualMode ? '활성화' : '비활성화'}`);
        overlay.addLog(`수동 모드 ${message.manualMode ? 'ON' : 'OFF'}`, 'info');
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_SHOW_BATTLE_LOG':
        config.general.showBattleLog = message.showBattleLog;
        overlay.updateConfig(config);
        alwaysLog(`전투 로그 ${message.showBattleLog ? '표시' : '숨김'}`);
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_AUTO_COMPLETE':
        config.general.autoComplete = message.autoComplete;
        if (window.BWBR_AutoComplete) {
          window.BWBR_AutoComplete.setEnabled(message.autoComplete);
        }
        alwaysLog(`자동완성 ${message.autoComplete ? '활성화' : '비활성화'}`);
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_AUTO_CONSUME_ACTIONS':
        config.general.autoConsumeActions = message.autoConsumeActions;
        alwaysLog(`행동 자동 소모 ${message.autoConsumeActions ? '활성화' : '비활성화'}`);
        overlay.addLog(`행동 자동 소모 ${message.autoConsumeActions ? 'ON' : 'OFF'}`, 'info');
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_BETTER_SOUNDBAR':
        config.general.betterSoundbar = message.betterSoundbar;
        if (message.betterSoundbar) {
          injectSiteVolumeSlider();
        } else {
          removeSiteVolumeSlider();
        }
        alwaysLog(`더 나은 사운드바 ${message.betterSoundbar ? '활성화' : '비활성화'}`);
        sendResponse({ success: true });
        break;

      case 'BWBR_CANCEL_COMBAT':
        cancelCombat();
        sendResponse({ success: true });
        break;

      case 'BWBR_PAUSE_COMBAT':
        togglePause();
        sendResponse({ success: true, paused: paused });
        break;

      case 'BWBR_TEST_SEND':
        // 테스트 메시지 전송
        chat.sendMessage(message.text).then(ok => {
          sendResponse({ success: ok });
        });
        return true; // 비동기 응답

      case 'BWBR_REFRESH_DOM':
        // DOM 재탐색
        chat.findElements();
        sendResponse({
          success: !!(chat.chatContainer && chat.chatInput),
          container: !!chat.chatContainer,
          input: !!chat.chatInput
        });
        break;

      default:
        break;
    }
  }

  // ── 로그 추출 ────────────────────────────────────────────

  let _logExportBusy = false;

  /**
   * 코코포리아 톱니바퀴 드롭다운에 "더 나은 로그 출력" 메뉴 항목을 삽입합니다.
   * MUI Menu가 열릴 때마다 감지하여 자동으로 항목을 추가합니다.
   */
  function setupLogExportMenu() {
    const bodyObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // MUI Popover/Modal → 직접 자식으로 body에 추가됨
          if (node.getAttribute?.('role') === 'presentation' ||
              node.classList?.contains?.('MuiModal-root') ||
              node.classList?.contains?.('MuiPopover-root')) {
            _tryInjectExportMenuItem(node);
          }
        }
      }
    });
    bodyObserver.observe(document.body, { childList: true });
  }

  function _tryInjectExportMenuItem(container) {
    // React 렌더 완료 대기 (double rAF)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const items = container.querySelectorAll('li[role="menuitem"], li.MuiMenuItem-root');
      let logItem = null;
      for (const item of items) {
        const text = item.textContent.trim();
        // 코코포리아 메뉴: "ログ出力" (일본어) 또는 유사 표현
        if (text.includes('ログ出力') || text.includes('ログを出力') ||
            text === '로그 출력' || text.toLowerCase().includes('log')) {
          logItem = item;
          break;
        }
      }
      if (!logItem) return;
      if (logItem.parentElement?.querySelector?.('.bwbr-export-log-item')) return;

      // 기존 MUI MenuItem과 동일한 구조로 복제
      const exportItem = logItem.cloneNode(false);
      exportItem.className = logItem.className;
      exportItem.removeAttribute('id');
      exportItem.classList.add('bwbr-export-log-item');
      exportItem.setAttribute('role', 'menuitem');
      exportItem.setAttribute('tabindex', '-1');
      exportItem.textContent = '더 나은 로그 출력';
      exportItem.style.color = '#90caf9';

      exportItem.addEventListener('mouseenter', () => {
        exportItem.style.backgroundColor = 'rgba(144,202,249,0.08)';
      });
      exportItem.addEventListener('mouseleave', () => {
        exportItem.style.backgroundColor = '';
      });

      exportItem.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // MUI Menu 닫기 — backdrop 클릭
        const backdrop = container.querySelector('.MuiBackdrop-root, [class*="Backdrop"]');
        if (backdrop) backdrop.click();
        else container.style.display = 'none';
        // 로그 추출 시작
        startLogExport();
      });

      logItem.insertAdjacentElement('afterend', exportItem);
      alwaysLog('톱니바퀴 메뉴에 "더 나은 로그 출력" 삽입됨');
    }));
  }

  /**
   * 로그 추출을 시작합니다.
   * Firestore에서 전체 메시지를 가져와 HTML로 변환하고 다운로드합니다.
   */
  function startLogExport() {
    if (_logExportBusy) {
      alwaysLog('로그 추출이 이미 진행 중입니다.');
      return;
    }
    _logExportBusy = true;

    // 진행 상태 토스트 표시
    overlay.addLog('📜 로그 추출 중...', 'info');
    _showExportToast('📜 Firestore에서 로그를 가져오는 중...');

    const handler = (e) => {
      clearTimeout(timeout);
      window.removeEventListener('bwbr-export-log-result', handler);
      _logExportBusy = false;

      if (!e.detail?.success) {
        overlay.addLog('로그 추출 실패: ' + (e.detail?.error || '알 수 없는 오류'), 'error');
        _showExportToast('❌ 로그 추출 실패: ' + (e.detail?.error || ''), 3000);
        return;
      }

      const { messages, roomName } = e.detail;
      overlay.addLog(`📜 ${messages.length}건 로그 가져옴`, 'info');
      _showExportToast(`📜 ${messages.length}건 로그 가져옴`, 2000);

      // 다이얼로그 열기 (log-export-dialog.js)
      if (window.LogExportDialog) {
        window.LogExportDialog.open(messages, roomName);
      } else {
        // fallback: 직접 내보내기 (다이얼로그 로드 실패 시)
        try {
          const html = _generateLogHtml(messages, roomName);
          const filename = `log_${roomName || 'cocofolia'}_${_formatDateForFilename(new Date())}.html`;
          _downloadFile(filename, html, 'text/html');
          overlay.addLog(`📜 로그 추출 완료! ${messages.length}건 → ${filename}`, 'success');
          _showExportToast(`✅ ${messages.length}건 로그 추출 완료!`, 3000);
        } catch (genErr) {
          overlay.addLog('HTML 생성 실패: ' + genErr.message, 'error');
          _showExportToast('❌ HTML 생성 실패', 3000);
        }
      }
    };

    // 타임아웃 (60초)
    let timeout = setTimeout(() => {
      window.removeEventListener('bwbr-export-log-result', handler);
      _logExportBusy = false;
      overlay.addLog('로그 추출 타임아웃 (60초 초과)', 'error');
      _showExportToast('❌ 로그 추출 타임아웃', 3000);
    }, 60000);

    window.addEventListener('bwbr-export-log-result', handler, { once: true });

    // MAIN world에 요청
    window.dispatchEvent(new CustomEvent('bwbr-export-log'));
  }

  /**
   * 메시지 배열을 코코포리아 채팅 스타일 HTML 문서로 변환합니다.
   * 코코포리아 실제 채팅 UI를 최대한 재현합니다.
   */
  function _generateLogHtml(messages, roomName) {
    const now = new Date();
    const exportDate = _formatDateTime(now);

    // 공백 메시지 필터링 + 텍스트 정리
    const filtered = messages.filter(m =>
      (m.text && m.text.trim()) || m.imageUrl || m.diceResult
    ).map(m => {
      if (m.text) {
        let t = m.text;
        t = t.replace(/\r\n/g, '\n');
        const lines = t.split('\n');
        for (let j = 0; j < lines.length; j++) lines[j] = lines[j].trimEnd();
        while (lines.length && !lines[0].trim()) lines.shift();
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        const cleaned = [];
        let emptyCount = 0;
        for (const ln of lines) {
          if (!ln.trim()) { emptyCount++; if (emptyCount <= 1) cleaned.push(''); }
          else { emptyCount = 0; cleaned.push(ln); }
        }
        t = cleaned.join('\n');
        m = Object.assign({}, m, { text: t });
      }
      return m;
    });
    const total = filtered.length;

    function isMainChannel(msg) {
      if (!msg.channel) return true;
      const cn = (msg.channelName || '').trim().toLowerCase();
      if (!cn) return true;                          // channelName 없으면 메인 취급
      return cn === 'メイン' || cn === 'めいん' || cn === '메인' || cn === 'main';
    }

    let prevDate = '';
    let prevKey = '';
    let prevChannel = '';
    let groupStartTime = 0;
    const rows = [];
    const GROUP_GAP = 600000;
    let inAltSection = false;   // 현재 비메인 탭 섹션 안인지

    let sysBuffer = [];
    let sysGroupStart = 0;

    function flushSysBuffer() {
      if (!sysBuffer.length) return;
      const timeStr = sysGroupStart ? _formatTime(new Date(sysGroupStart)) : '';
      rows.push(
        `<div class="sys-block">` +
          (timeStr ? `<div class="sys-time">${timeStr}</div>` : '') +
          sysBuffer.join('') +
        `</div>`
      );
      sysBuffer = [];
    }

    function openAltSection(chName) {
      if (inAltSection) return;
      rows.push(`<div class="alt-section"><div class="alt-ch-name">${_escapeHtml(chName)}</div>`);
      inAltSection = true;
    }
    function closeAltSection() {
      if (!inAltSection) return;
      rows.push(`</div>`);
      inAltSection = false;
    }

    function cleanHtml(raw) {
      let h = _escapeHtml(raw || '').replace(/\n/g, '<br>');
      h = h.replace(/^(<br\s*\/?>)+/gi, '');
      h = h.replace(/(<br\s*\/?>)+$/gi, '');
      h = h.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
      return h;
    }

    // ── 합 블록 사전 탐색 (공격자/방어자/승자 정보 추출) ──
    const hapBlocks = [];
    {
      let hs = -1;
      for (let j = 0; j < filtered.length; j++) {
        const t = filtered[j].text || '';
        if (/《합\s*개시》/.test(t)) {
          hs = j;
        } else if (hs >= 0 && /《합\s*(승리|종료|중지)》/.test(t)) {
          let rounds = 0;
          const isDraw = /무승부/.test(t) || /《합\s*종료》/.test(t);

          // 합 개시 메시지에서 공격자/방어자 이름 추출
          const startText = filtered[hs].text || '';
          const atkMatch = startText.match(/⚔\uFE0F?\s*(.+?)\s*-\s*\d+/);
          const defMatch = startText.match(/🛡\uFE0F?\s*(.+?)\s*-\s*\d+/);
          const atkName = atkMatch ? atkMatch[1].trim() : '';
          const defName = defMatch ? defMatch[1].trim() : '';

          // 승자 이름 (승리 메시지에서)
          let winnerName = '';
          let winnerSide = 'draw';
          if (!isDraw) {
            const wm = t.match(/[⚔️🛡️]\s*(.+?)(?:\s*@|\s*$)/);
            if (wm) winnerName = wm[1].trim();
            // 승자가 공격자인지 방어자인지
            if (winnerName === atkName) winnerSide = 'attacker';
            else if (winnerName === defName) winnerSide = 'defender';
            else winnerSide = 'attacker'; // fallback
          }

          // 색상/아이콘/주사위 추출
          let atkColor = '#d0d0d0', defColor = '#d0d0d0';
          let atkIcon = '', defIcon = '';
          let winnerDice = '';
          for (let k = hs; k <= j; k++) {
            const km = filtered[k];
            const kt = km.text || '';
            if (/《\d+합》/.test(kt)) rounds++;
            if (km.name === atkName && !atkIcon) { atkIcon = km.iconUrl || ''; atkColor = km.color || '#d0d0d0'; }
            if (km.name === defName && !defIcon) { defIcon = km.iconUrl || ''; defColor = km.color || '#d0d0d0'; }
            // 승자의 마지막 주사위
            if (winnerName && km.name === winnerName && km.diceResult) winnerDice = km.diceResult;
            // 시스템 주사위도 검사 (승자 이름이 텍스트에 포함된 경우)
            if (winnerName && (km.type === 'system' || km.name === 'system') && km.diceResult && kt.includes(winnerName)) {
              winnerDice = km.diceResult;
            }
          }

          hapBlocks.push({
            startIdx: hs, endIdx: j, rounds, isDraw,
            atkName, defName, atkColor, defColor, atkIcon, defIcon,
            winnerName, winnerSide, winnerDice
          });
          hs = -1;
        }
      }
    }
    // 합 범위에 속하는 메시지 인덱스 → 블록 매핑
    const hapIndexMap = new Map(); // idx → { blockIdx, isStart }
    for (let bi = 0; bi < hapBlocks.length; bi++) {
      const b = hapBlocks[bi];
      for (let k = b.startIdx; k <= b.endIdx; k++) {
        hapIndexMap.set(k, { blockIdx: bi, isStart: k === b.startIdx });
      }
    }

    // ── 합 내부 메시지 렌더 함수 (개별 메시지 → HTML) ──
    function renderSingleMsg(msg, forceNoGroup) {
      const esc = cleanHtml(msg.text);
      const si = msg.imageUrl && msg.imageUrl !== msg.iconUrl;
      const ih = si ? `<div class="msg-img"><img src="${_escapeHtml(msg.imageUrl)}" loading="lazy"></div>` : '';
      const dh = msg.diceResult ? `<div class="dice"><span class="dice-icon">&#x1F3B2;</span><span class="dice-val">${_escapeHtml(msg.diceResult)}</span></div>` : '';
      const isSys = msg.type === 'system' || msg.name === 'system';
      if (isSys) {
        const timeS = msg.createdAt ? _formatTime(new Date(msg.createdAt)) : '';
        return `<div class="sys-block"><div class="sys-time">${timeS}</div>${esc ? `<div class="sys-line">${esc}</div>` : ''}${dh}${ih}</div>`;
      }
      const iconSrc = msg.iconUrl ? _escapeHtml(msg.iconUrl) : '';
      const key = msg.name || '';
      const aviInner = iconSrc
        ? `<img src="${iconSrc}" alt="" loading="lazy">`
        : `<span class="avi-letter">${_escapeHtml(key.charAt(0) || '?')}</span>`;
      const nc = msg.color || '#d0d0d0';
      const ts = msg.createdAt ? _formatTime(new Date(msg.createdAt)) : '';
      return `<div class="msg"><div class="msg-gutter"><div class="avi">${aviInner}</div></div><div class="msg-body"><div class="msg-head"><span class="msg-name" style="color:${_escapeHtml(nc)}">${_escapeHtml(key)}</span><span class="msg-ts">${ts}</span></div>${esc ? `<div class="msg-text">${esc}</div>` : ''}${dh}${ih}</div></div>`;
    }

    for (let i = 0; i < filtered.length; i++) {
      const msg = filtered[i];
      const isSystem = msg.type === 'system' || msg.name === 'system';
      const curKey = isSystem ? '__system__' : (msg.name || '');
      const curCh = msg.channelName || msg.channel || '';
      const mainCh = isMainChannel(msg);

      // 날짜 구분
      const dateStr = msg.createdAt ? _formatDate(new Date(msg.createdAt)) : '';
      if (dateStr && dateStr !== prevDate) {
        flushSysBuffer();
        closeAltSection();
        rows.push(
          `<div class="date-sep">` +
            `<div class="date-line"></div>` +
            `<span class="date-text">${dateStr}</span>` +
            `<div class="date-line"></div>` +
          `</div>`
        );
        prevDate = dateStr;
        prevKey = '';
        prevChannel = '';
        groupStartTime = 0;
        sysGroupStart = 0;
      }

      // 탭 전환 처리
      if (curCh !== prevChannel) {
        flushSysBuffer();
        if (mainCh) {
          closeAltSection();
          // 메인 탭 라벨 (항상 표시)
          rows.push(`<div class="main-ch-name">MAIN</div>`);
        } else {
          closeAltSection();
          openAltSection(msg.channelName || curCh);
        }
        prevKey = '';
        groupStartTime = 0;
      }

      const escaped = cleanHtml(msg.text);
      const showImage = msg.imageUrl && msg.imageUrl !== msg.iconUrl;
      const imgHtml = showImage
        ? `<div class="msg-img"><img src="${_escapeHtml(msg.imageUrl)}" loading="lazy"></div>` : '';
      const diceHtml = msg.diceResult
        ? `<div class="dice"><span class="dice-icon">&#x1F3B2;</span><span class="dice-val">${_escapeHtml(msg.diceResult)}</span></div>` : '';
      const whisperTag = msg.to
        ? `<span class="whisper-badge">&#x1F512; → ${_escapeHtml(msg.toName || msg.to)}</span>` : '';

      // ── 합 블록 처리 (전체를 한번에 렌더) ──
      const hapInfo = hapIndexMap.get(i);
      if (hapInfo && hapInfo.isStart) {
        flushSysBuffer();
        const b = hapBlocks[hapInfo.blockIdx];
        // 합 내부 전체 메시지를 개별 렌더
        const innerParts = [];
        for (let k = b.startIdx; k <= b.endIdx; k++) {
          innerParts.push(renderSingleMsg(filtered[k]));
        }
        // summary 디자인 (가운데 정렬)
        const resultLabel = b.isDraw ? '무승부' : '승리!';
        const wDice = b.winnerDice ? _escapeHtml(b.winnerDice) : '';
        const eAtkName = _escapeHtml(b.atkName || '???');
        const eDefName = _escapeHtml(b.defName || '???');
        const eAtkColor = _escapeHtml(b.atkColor);
        const eDefColor = _escapeHtml(b.defColor);
        // 승자/패자 강조: 승자는 밝게, 패자는 희미하게
        const atkBright = b.winnerSide === 'attacker' || b.isDraw;
        const defBright = b.winnerSide === 'defender' || b.isDraw;

        rows.push(
          `<details class="hap-fold">` +
            `<summary class="hap-fold-summary">` +
              `<div class="hap-fold-badge">${resultLabel}</div>` +
              `<div class="hap-fold-sep">` +
                `<div class="hap-fold-line"></div>` +
                `<span class="hap-fold-rounds">${b.rounds}합</span>` +
                `<div class="hap-fold-line"></div>` +
              `</div>` +
              `<div class="hap-fold-versus">` +
                `<span class="hap-fold-fighter${atkBright ? '' : ' dim'}" style="color:${eAtkColor}">⚔️ ${eAtkName}</span>` +
                `<span class="hap-fold-vs">vs</span>` +
                `<span class="hap-fold-fighter${defBright ? '' : ' dim'}" style="color:${eDefColor}">🛡️ ${eDefName}</span>` +
              `</div>` +
              (wDice ? `<div class="hap-fold-dice">${wDice}</div>` : '') +
            `</summary>` +
            `<div class="hap-fold-body">${innerParts.join('\n')}</div>` +
          `</details>`
        );
        // 합 끝까지 스킵
        i = b.endIdx;
        prevKey = '';
        prevChannel = curCh;
        groupStartTime = 0;
        continue;
      }
      // 합 범위 안인데 isStart가 아닌 경우 (이미 위에서 처리됨) → 스킵
      if (hapInfo) continue;

      // ── 시스템 ──
      if (isSystem) {
        if (sysBuffer.length && msg.createdAt - sysGroupStart >= GROUP_GAP) {
          flushSysBuffer();
        }
        if (!sysBuffer.length) sysGroupStart = msg.createdAt || 0;
        sysBuffer.push(
          (escaped ? `<div class="sys-line">${escaped}</div>` : '') +
          `${diceHtml}${imgHtml}`
        );
        prevKey = '__system__';
        prevChannel = curCh;
        continue;
      }

      flushSysBuffer();

      // 발화자 변경 → 구분선 (시스템 직후 제외)
      if (prevKey && prevKey !== curKey && prevKey !== '__system__') {
        rows.push(`<div class="divider"></div>`);
      }

      const timeDiff = msg.createdAt - groupStartTime;
      const sameGroup = (curKey === prevKey) && (curCh === prevChannel) && (timeDiff < GROUP_GAP);
      if (!sameGroup) groupStartTime = msg.createdAt || 0;
      const timeStr = msg.createdAt ? _formatTime(new Date(msg.createdAt)) : '';

      if (sameGroup) {
        rows.push(
          `<div class="msg grouped">` +
            `<div class="msg-gutter"></div>` +
            `<div class="msg-body">` +
              `${whisperTag}` +
              (escaped ? `<div class="msg-text">${escaped}</div>` : '') +
              `${diceHtml}${imgHtml}` +
            `</div>` +
          `</div>`
        );
      } else {
        const iconSrc = msg.iconUrl ? _escapeHtml(msg.iconUrl) : '';
        const aviInner = iconSrc
          ? `<img src="${iconSrc}" alt="" loading="lazy">`
          : `<span class="avi-letter">${_escapeHtml(curKey ? curKey.charAt(0) : '?')}</span>`;
        const nameColor = msg.color || '#d0d0d0';

        rows.push(
          `<div class="msg">` +
            `<div class="msg-gutter"><div class="avi">${aviInner}</div></div>` +
            `<div class="msg-body">` +
              `<div class="msg-head">` +
                `<span class="msg-name" style="color:${_escapeHtml(nameColor)}">${_escapeHtml(curKey)}</span>` +
                `<span class="msg-ts">${timeStr}</span>` +
                `${whisperTag}` +
              `</div>` +
              (escaped ? `<div class="msg-text">${escaped}</div>` : '') +
              `${diceHtml}${imgHtml}` +
            `</div>` +
          `</div>`
        );
      }

      prevKey = curKey;
      prevChannel = curCh;
    }
    flushSysBuffer();
    closeAltSection();

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${_escapeHtml(roomName || '코코포리아')} - 채팅 로그</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=IBM+Plex+Mono:wght@600;700&display=swap');

:root{
  --bg:#d8d8dc;
  --bg-panel:#131316;
  --bg-log:#17171b;
  --bg-card:#1d1d22;
  --border:rgba(200,200,210,.06);
  --border-hard:rgba(200,200,210,.11);
  --text:#ececf0;
  --text-sub:rgba(225,225,230,.65);
  --text-dim:rgba(170,170,180,.35);
  --sys-bg:#222228;
  --sys-text:rgba(215,215,225,.82);
  --whisper-c:#c0a8f0;
  --whisper-bg:rgba(192,168,240,.08);
}
*{margin:0;padding:0;box-sizing:border-box}

body{
  font-family:"Noto Sans KR",sans-serif;
  background:var(--bg);
  color:var(--text);
  min-height:100vh;
  line-height:1.6;
  font-size:16px;
  -webkit-font-smoothing:antialiased;
  position:relative;
  padding:24px 0 0;
}
body::before{
  content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(circle, rgba(0,0,0,.10) 1px, transparent 1px);
  background-size:14px 14px;
}

/* ── 헤더 ── */
.hdr{
  position:sticky;top:0;z-index:200;
  background:var(--bg-panel);
  border-bottom:1px solid var(--border-hard);
  padding:18px 32px;
  display:flex;align-items:center;justify-content:space-between;
  max-width:860px;margin:0 auto;
  border-radius:12px 12px 0 0;
  box-shadow:0 -8px 32px rgba(0,0,0,.12);
}
.hdr-title{font-size:18px;font-weight:900;color:var(--text)}
.hdr-meta{font-size:12px;color:var(--text-dim);display:flex;gap:16px;font-weight:500}

/* ── 로그 ── */
.log-wrap{
  position:relative;z-index:1;
  max-width:860px;
  margin:0 auto;
  padding:20px 0 60px;
  background:var(--bg-log);
  border-radius:0;
  min-height:calc(100vh - 100px);
  overflow:hidden;
  box-shadow:0 4px 40px rgba(0,0,0,.10);
}
/* 하프톤: 좌우 끝에서 안쪽으로 */
.log-wrap::after{
  content:'';position:absolute;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(circle, rgba(255,255,255,.14) 1px, transparent 1px);
  background-size:16px 16px;
  mask-image:linear-gradient(to right, rgba(0,0,0,.9) 0%, transparent 30%, transparent 70%, rgba(0,0,0,.9) 100%);
  -webkit-mask-image:linear-gradient(to right, rgba(0,0,0,.9) 0%, transparent 30%, transparent 70%, rgba(0,0,0,.9) 100%);
}
.log-wrap>*{position:relative;z-index:1}

/* ── 날짜 ── */
.date-sep{
  display:flex;align-items:center;
  gap:20px;padding:44px 28px 22px;user-select:none;
}
.date-line{
  flex:1;height:1px;
  background:linear-gradient(to right,transparent,rgba(255,255,255,.2),transparent);
}
.date-text{
  font-size:15px;font-weight:700;
  color:#fff;letter-spacing:4px;
  white-space:nowrap;
}

/* ── 메인 탭 라벨 ── */
.main-ch-name{
  font-size:11px;font-weight:700;
  letter-spacing:2px;
  color:rgba(255,255,255,.55);
  text-transform:uppercase;
  padding:6px 40px 10px;
  margin-top:14px;
}

/* ── 비메인 탭 섹션 (흰색 톤) ── */
.alt-section{
  background:#e8e8ec;
  color:#1a1a1e;
  margin:28px 0;
  padding:14px 0 18px;
  border-top:1px solid rgba(0,0,0,.08);
  border-bottom:1px solid rgba(0,0,0,.08);
}
.alt-ch-name{
  font-size:11px;font-weight:700;
  letter-spacing:2px;
  color:rgba(0,0,0,.5);
  text-transform:uppercase;
  padding:6px 40px 10px;
}
.alt-section .msg-text{color:rgba(0,0,0,.85)}
.alt-section .msg-name{color:#111!important}
.alt-section .msg-ts{color:rgba(0,0,0,.45)}
.alt-section .avi{background:#d0d0d5}
.alt-section .avi-letter{background:#d0d0d5;color:rgba(0,0,0,.25)}
.alt-section .divider{background:rgba(0,0,0,.08)}
.alt-section .sys-block{
  background:#dddde2;
  border-color:rgba(0,0,0,.08);
}
.alt-section .sys-line{color:rgba(0,0,0,.7)}
.alt-section .sys-time{color:rgba(0,0,0,.4)}
.alt-section .dice{
  background:rgba(0,0,0,.05);
  border-color:rgba(0,0,0,.12);
}
.alt-section .dice-val{color:rgba(0,0,0,.75)}
.alt-section .dice-icon{filter:grayscale(1) brightness(.4)}
.alt-section .date-line{background:linear-gradient(to right,transparent,rgba(0,0,0,.15),transparent)}
.alt-section .date-text{color:rgba(0,0,0,.65)}
.alt-section .whisper-badge{
  color:#7a5cb0;background:rgba(122,92,176,.08);
  border-color:rgba(122,92,176,.18);
}

/* ── 구분선 ── */
.divider{height:1px;margin:12px 0;background:var(--border-hard)}

/* ── 메시지 ── */
.msg{display:flex;padding:3px 28px}
.msg:not(.grouped){margin-top:14px}

.msg-gutter{
  width:92px;flex-shrink:0;
  display:flex;align-items:flex-start;justify-content:center;
  padding-top:2px;
}

/* 아바타 */
.avi{
  width:80px;height:80px;border-radius:14px;
  overflow:hidden;background:var(--bg-card);flex-shrink:0;
}
.avi img{width:100%;height:100%;object-fit:cover;object-position:center 5%;display:block}
.avi-letter{
  width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  font-size:24px;font-weight:900;color:var(--text-dim);background:var(--bg-card);
}

.msg-body{flex:1;min-width:0;padding:0 12px}
.msg-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:3px}
.msg-name{font-size:16px;font-weight:700}
.msg-ts{font-size:12px;color:var(--text-dim);font-weight:500}
.msg-text{
  font-size:16px;line-height:1.7;
  color:#fff;word-break:break-word;
}

/* ── 주사위 ── */
.dice{
  display:inline-flex;align-items:center;gap:8px;
  margin:6px 0 2px;
  padding:8px 18px;
  background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.12);
  border-radius:6px;
}
.dice-icon{font-size:17px;line-height:1;flex-shrink:0}
.dice-val{
  font-family:"IBM Plex Mono","Consolas",monospace;
  font-size:15px;font-weight:700;
  color:rgba(255,255,255,.88);
  letter-spacing:.5px;
}

/* 이미지 */
.msg-img{margin:8px 0 4px}
.msg-img img{
  max-width:320px;max-height:320px;border-radius:12px;
  border:1px solid var(--border-hard);display:block;
}

/* 위스퍼 */
.whisper-badge{
  font-size:12px;font-weight:700;
  color:var(--whisper-c);background:var(--whisper-bg);
  border:1px solid rgba(192,168,240,.18);
  border-radius:3px;padding:1px 8px;white-space:nowrap;
}

/* ── 시스템 ── */
.sys-block{
  background:var(--sys-bg);
  border-top:1px solid var(--border-hard);
  border-bottom:1px solid var(--border-hard);
  margin:14px 0;
  padding:16px 48px;
  text-align:center;
}
.sys-time{font-size:12px;color:var(--text-dim);font-weight:500;margin-bottom:6px}
.sys-line{
  font-size:15px;line-height:1.7;
  color:var(--sys-text);word-break:break-word;
  font-style:italic;
}
.sys-line+.sys-line{margin-top:2px}
.sys-block .dice{
  background:rgba(255,255,255,.03);
  border-color:rgba(255,255,255,.08);
}

/* ── 합 접기/펼치기 ── */
.hap-fold{
  margin:20px 0;
  border-top:1px solid var(--border-hard);
  border-bottom:1px solid var(--border-hard);
  overflow:hidden;
}
.hap-fold-summary{
  cursor:pointer;list-style:none;
  display:flex;flex-direction:column;align-items:center;
  padding:28px 32px 22px;
  background:rgba(255,255,255,.03);
  user-select:none;
  transition:background .15s;
  gap:10px;
}
.hap-fold-summary:hover{background:rgba(255,255,255,.06)}
.hap-fold-summary::-webkit-details-marker{display:none}

.hap-fold-badge{
  font-size:20px;font-weight:900;
  color:#5b9bf0;
  letter-spacing:3px;
}
.hap-fold-sep{
  display:flex;align-items:center;gap:12px;
  width:80%;max-width:320px;
}
.hap-fold-line{
  flex:1;height:1px;
  background:linear-gradient(to right,transparent,rgba(255,255,255,.18),transparent);
}
.hap-fold-rounds{
  font-size:14px;font-weight:700;
  color:rgba(255,255,255,.35);
  white-space:nowrap;letter-spacing:1px;
}
.hap-fold-versus{
  display:flex;align-items:center;gap:10px;
  font-size:17px;font-weight:700;
}
.hap-fold-fighter{transition:opacity .15s}
.hap-fold-fighter.dim{opacity:.35}
.hap-fold-vs{
  font-size:13px;font-weight:500;
  color:rgba(255,255,255,.28);
  letter-spacing:1px;
}
.hap-fold-dice{
  font-family:"IBM Plex Mono","Consolas",monospace;
  font-size:14px;font-weight:600;
  color:rgba(255,255,255,.3);
  letter-spacing:.5px;
  margin-top:2px;
}

.hap-fold[open]>.hap-fold-summary{
  border-bottom:1px solid rgba(255,255,255,.08);
}
.hap-fold-body{
  padding:12px 0;
}

/* 합 — alt-section 오버라이드 */
.alt-section .hap-fold{border-color:rgba(0,0,0,.1)}
.alt-section .hap-fold-summary{background:rgba(0,0,0,.03)}
.alt-section .hap-fold-summary:hover{background:rgba(0,0,0,.06)}
.alt-section .hap-fold-badge{color:#3b7ad0}
.alt-section .hap-fold-line{background:linear-gradient(to right,transparent,rgba(0,0,0,.12),transparent)}
.alt-section .hap-fold-rounds{color:rgba(0,0,0,.4)}
.alt-section .hap-fold-fighter{color:#222!important}
.alt-section .hap-fold-vs{color:rgba(0,0,0,.35)}
.alt-section .hap-fold-dice{color:rgba(0,0,0,.35)}
.alt-section .hap-fold[open]>.hap-fold-summary{border-bottom-color:rgba(0,0,0,.08)}

/* ── 푸터 ── */
.ftr{
  max-width:860px;margin:0 auto;background:var(--bg-log);
  text-align:center;padding:24px;
  font-size:12px;color:var(--text-dim);font-weight:500;
  border-top:1px solid var(--border);
  border-radius:0 0 12px 12px;
}

@media print{
  body{background:#fff;color:#111}
  body::before,.log-wrap::after{display:none}
  .log-wrap,.ftr{background:#fafafa;box-shadow:none}
  .msg-text{color:#222}
  .sys-block{background:#f0f0f0;border-color:#ddd}
  .sys-line{color:#333}
  .msg-name{color:#111!important}
  .dice{background:#f4f4f4;border-color:#ccc}
  .dice-val{color:#111}
  .hdr{position:static;background:#f4f4f4;border-color:#ccc}
  .ftr{background:#fafafa}
  .alt-section{background:#f0f0f0;color:#111}
}
</style>
</head>
<body>
<div class="hdr">
  <span class="hdr-title">${_escapeHtml(roomName || '코코포리아')} — 채팅 로그</span>
  <div class="hdr-meta">
    <span>${total.toLocaleString()}건</span>
    <span>${_escapeHtml(exportDate)}</span>
  </div>
</div>
<div class="log-wrap">
${rows.join('\n')}
</div>
<div class="ftr">Exported by BWBR · ${_escapeHtml(exportDate)}</div>
</body>
</html>`;
  }

  /** 파일 다운로드 트리거 */
  function _downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** 로그 추출 진행 토스트 */
  function _showExportToast(text, autoHideMs) {
    let toast = document.getElementById('bwbr-export-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bwbr-export-toast';
      toast.className = 'bwbr-export-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.display = 'flex';
    toast.style.opacity = '1';
    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    if (autoHideMs) {
      toast._hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 300);
      }, autoHideMs);
    }
  }

  // 로그 추출용 유틸리티
  function _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function _formatDateTime(d) {
    return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())} ${_pad(d.getHours())}:${_pad(d.getMinutes())}:${_pad(d.getSeconds())}`;
  }
  function _formatDate(d) {
    return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
  }
  function _formatTime(d) {
    return `${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
  }
  function _formatDateForFilename(d) {
    return `${d.getFullYear()}${_pad(d.getMonth()+1)}${_pad(d.getDate())}_${_pad(d.getHours())}${_pad(d.getMinutes())}`;
  }
  function _pad(n) { return n < 10 ? '0' + n : '' + n; }

  // ── 유틸리티 ─────────────────────────────────────────────

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 구 효과음 형식(single string) → 신 형식(array) 마이그레이션 */
  function migrateSounds(sounds) {
    if (!sounds) return;
    if (typeof sounds.combatStartSound === 'string') {
      sounds.combatStartSounds = [sounds.combatStartSound];
      delete sounds.combatStartSound;
    }
    if (typeof sounds.resultSpecialSound === 'string') {
      sounds.resultSpecialSounds = [sounds.resultSpecialSound];
      delete sounds.resultSpecialSound;
    }
    if (typeof sounds.victorySound === 'string') {
      sounds.victorySounds = [sounds.victorySound];
      delete sounds.victorySound;
    }
    // 효과음 이름 챙챙→챙 수정 (v1.1.8 이전 잘못된 기본값 수정)
    var fixName = function(arr) {
      if (!Array.isArray(arr)) return arr;
      return arr.map(function(s) { return typeof s === 'string' ? s.replace(/^챙챙/, '챙') : s; });
    };
    if (sounds.roundHeaderSounds) sounds.roundHeaderSounds = fixName(sounds.roundHeaderSounds);
    if (sounds.resultNormalSounds) sounds.resultNormalSounds = fixName(sounds.resultNormalSounds);
    if (sounds.resultSpecialSounds) sounds.resultSpecialSounds = fixName(sounds.resultSpecialSounds);
  }

  /** 항상 출력되는 핵심 로그 */
  function alwaysLog(msg) {
    console.log(`%c[BWBR]%c ${msg}`, 'color: #ff9800; font-weight: bold;', 'color: inherit;');
  }

  /** 디버그 모드에서만 출력 */
  function log(msg) {
    if (config && config.general && config.general.debugMode) {
      console.log(`[BWBR] ${msg}`);
    }
  }

  // ── Redux Store 접근 (캐릭터 데이터용) ───────────────────

  /** 
   * 페이지 컨텍스트(MAIN world)에 스크립트를 주입하여 Redux Store를 획득합니다.
   * Content Script는 isolated world이므로 React internals에 직접 접근할 수 없습니다.
   */
  function setupReduxStore() {
    // 이미 주입되었으면 스킵
    if (window.__BWBR_REDUX_INJECTOR_LOADED) {
      return;
    }
    window.__BWBR_REDUX_INJECTOR_LOADED = true;

    // Redux 준비 이벤트 수신
    window.addEventListener('bwbr-redux-ready', (e) => {
      if (e.detail?.success) {
        alwaysLog(`✅ Redux Store 연결 완료! (캐릭터 ${e.detail.characterCount || 0}명)`);
      } else {
        alwaysLog('⚠️ Redux Store를 찾을 수 없습니다. 전투 보조 기능이 제한됩니다.');
      }
    });

    // 페이지 스크립트 주입 (MAIN world에서 실행)
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/redux-injector.js');
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    
    alwaysLog('Redux Injector 주입됨');
  }

  /**
   * 페이지 컨텍스트에서 캐릭터 데이터 요청
   * @returns {Promise<Array|null>} 캐릭터 배열 또는 null
   */
  function requestCharacterData() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('bwbr-characters-data', handler);
        alwaysLog('캐릭터 데이터 요청 타임아웃');
        resolve(null);
      }, 5000);

      const handler = () => {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-characters-data', handler);

        // DOM 속성 브릿지 (MAIN → ISOLATED 크로스-월드 안정성)
        const raw = document.documentElement.getAttribute('data-bwbr-characters-data');
        document.documentElement.removeAttribute('data-bwbr-characters-data');
        if (raw) {
          try {
            const data = JSON.parse(raw);
            if (data.success && data.characters) {
              log(`캐릭터 데이터 수신: ${data.characters.length}명`);
              resolve(data.characters);
              return;
            }
          } catch (e) { /* JSON 파싱 실패 */ }
        }
        alwaysLog('캐릭터 데이터 수신 실패');
        resolve(null);
      };

      window.addEventListener('bwbr-characters-data', handler);
      window.dispatchEvent(new CustomEvent('bwbr-request-characters'));
    });
  }

  // ── aria-hidden 포커스 충돌 완화 (ccfolia MUI 버그) ───────

  /**
   * MUI Popover/Dialog/Menu가 닫힐 때 aria-hidden="true"가 설정되면서
   * 내부에 포커스가 남아있으면 브라우저 경고가 발생합니다.
   *
   * MutationObserver는 비동기이므로 경고 발생 후에야 실행됩니다.
   * 대신 클릭(capture)과 키보드(Escape) 이벤트에서 Modal/Popover 내
   * 포커스를 사전에 blur하여 aria-hidden 충돌을 방지합니다.
   */
  (function fixAriaHiddenFocus() {
    var MODAL_SEL = '.MuiPopover-root, .MuiDialog-root, .MuiModal-root, .MuiMenu-root';

    // 1) 백드롭 클릭 시에만 blur (모달 내부 인터랙션은 방해하지 않음)
    //    capture 단계 → React onClick보다 먼저 실행 → aria-hidden 설정 전에 blur
    document.addEventListener('click', function(e) {
      if (!e.target.matches || !e.target.matches('.MuiBackdrop-root')) return;
      var ae = document.activeElement;
      if (!ae || ae === document.body) return;
      var modal = ae.closest(MODAL_SEL);
      if (modal) ae.blur();
    }, true);

    // 2) Escape 키: Dialog/Popover 닫기 전에 blur
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape') return;
      var ae = document.activeElement;
      if (!ae || ae === document.body) return;
      var modal = ae.closest(MODAL_SEL);
      if (modal) ae.blur();
    }, true);

    // 3) 폴백: aria-hidden 설정 시 (이미 경고가 나올 수 있지만 접근성 트리 정리용)
    var obs = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type !== 'attributes' || m.attributeName !== 'aria-hidden') continue;
        var target = m.target;
        if (target.getAttribute('aria-hidden') !== 'true') continue;
        if (target.contains(document.activeElement)) {
          document.activeElement.blur();
        }
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['aria-hidden'], subtree: true });
  })();

  // ── 사이트 음량 컨트롤러 ─────────────────────────────────

  /** 사이트 음량을 변경합니다. (site-volume.js의 페이지 스크립트로 전달) */
  function applySiteVolume(volume) {
    const v = Math.max(0, Math.min(1, volume));
    window.dispatchEvent(new CustomEvent('bwbr-set-site-volume', { detail: { volume: v } }));
  }

  /**
   * 주입된 경량 슬라이더를 제거하고 네이티브 MUI 슬라이더를 복원합니다.
   */
  function removeSiteVolumeSlider() {
    const root = document.getElementById('bwbr-site-vol-root');
    if (root) {
      // 네이티브 슬라이더 복원
      const parent = root.parentElement;
      if (parent) {
        const native = parent.querySelector('.MuiSlider-root');
        if (native) native.style.display = '';
      }
      root.remove();
    }
  }

  /**
   * 코코포리아의 네이티브 MUI 음량 슬라이더를 숨기고,
   * 동일 위치에 렉 없는 경량 슬라이더로 교체합니다.
   * (MUI Slider는 드래그 시 React 리렌더를 유발 → 컷인 많은 룸에서 심한 렉)
   */
  function injectSiteVolumeSlider() {
    // 토글 꺼져 있으면 주입하지 않음
    if (config.general.betterSoundbar === false) return;
    if (document.getElementById('bwbr-site-vol-root')) return;

    // 상단 툴바의 수평 음량 슬라이더 찾기
    const sliders = document.querySelectorAll('.MuiSlider-root');
    let nativeSlider = null;
    for (const s of sliders) {
      const r = s.getBoundingClientRect();
      if (r.top < 200 && r.width > r.height && r.width > 0) { nativeSlider = s; break; }
    }
    if (!nativeSlider) {
      setTimeout(injectSiteVolumeSlider, 2000);
      return;
    }

    // 네이티브 MUI 슬라이더의 치수 캡처
    const nativeRect = nativeSlider.getBoundingClientRect();
    const parentEl = nativeSlider.parentElement;   // sc-iKUUEK 래퍼
    const parentRect = parentEl.getBoundingClientRect();

    // CSS 주입 (MUI Slider 외관 모방 — 주황색)
    if (!document.getElementById('bwbr-site-vol-style')) {
      const style = document.createElement('style');
      style.id = 'bwbr-site-vol-style';
      style.textContent = `
        #bwbr-site-vol-root {
          position: relative;
          width: ${Math.round(nativeRect.width)}px;
          height: ${Math.round(parentRect.height)}px;
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          touch-action: none;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }
        #bwbr-site-vol-rail {
          position: absolute; left: 0; right: 0;
          height: 4px; border-radius: 2px;
          background: rgba(255,167,38,0.28);
        }
        #bwbr-site-vol-track {
          position: absolute; left: 0;
          height: 4px; border-radius: 2px;
          background: #ffa726;
          pointer-events: none;
          transition: none;
        }
        #bwbr-site-vol-thumb {
          position: absolute; width: 14px; height: 14px;
          border-radius: 50%; background: #ffa726;
          transform: translate(-50%, -50%); top: 50%;
          box-shadow: 0 0 0 0 rgba(255,167,38,0.16);
          transition: box-shadow 0.15s;
          z-index: 1;
        }
        #bwbr-site-vol-thumb:hover,
        #bwbr-site-vol-root.bwbr-vol-active #bwbr-site-vol-thumb {
          box-shadow: 0 0 0 8px rgba(255,167,38,0.16);
        }
        #bwbr-site-vol-tooltip {
          position: absolute; top: -32px; left: 50%;
          transform: translateX(-50%);
          background: #424242; color: #fff; font-size: 11px;
          padding: 2px 6px; border-radius: 4px;
          pointer-events: none; white-space: nowrap;
          opacity: 0; transition: opacity 0.15s;
        }
        #bwbr-site-vol-root:hover #bwbr-site-vol-tooltip,
        #bwbr-site-vol-root.bwbr-vol-active #bwbr-site-vol-tooltip {
          opacity: 1;
        }
      `;
      document.head.appendChild(style);
    }

    // ── 커스텀 슬라이더 구조 생성 ──
    const root = document.createElement('div');
    root.id = 'bwbr-site-vol-root';
    root.title = '가지세계 도우미 — 사이트 음량 (렉 방지)';

    const rail = document.createElement('div');
    rail.id = 'bwbr-site-vol-rail';
    const track = document.createElement('div');
    track.id = 'bwbr-site-vol-track';
    const thumb = document.createElement('div');
    thumb.id = 'bwbr-site-vol-thumb';
    const tooltip = document.createElement('div');
    tooltip.id = 'bwbr-site-vol-tooltip';

    root.appendChild(rail);
    root.appendChild(track);
    thumb.appendChild(tooltip);
    root.appendChild(thumb);

    // ── 상태 ──
    let curVal = config.general.siteVolume ?? 1.0;
    let dragging = false;
    let _saveTimer = 0;

    function updateVisual(val) {
      const pct = Math.round(val * 100);
      track.style.width = pct + '%';
      thumb.style.left = pct + '%';
      tooltip.textContent = pct + '%';
    }
    updateVisual(curVal);

    function setVolume(val, save) {
      curVal = Math.max(0, Math.min(1, val));
      updateVisual(curVal);
      applySiteVolume(curVal);
      config.general.siteVolume = curVal;
      if (save) {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
          try {
            chrome.storage.sync.get('bwbr_config', (res) => {
              if (chrome.runtime.lastError) return;
              const c = res.bwbr_config || {};
              if (!c.general) c.general = {};
              c.general.siteVolume = curVal;
              chrome.storage.sync.set({ bwbr_config: c });
            });
          } catch(e) { /* 컨텍스트 무효화 */ }
        }, 300);
      }
    }

    function valFromEvent(e) {
      const rect = root.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    // ── 마우스 이벤트 ──
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      root.classList.add('bwbr-vol-active');
      root.setPointerCapture(e.pointerId);
      setVolume(valFromEvent(e), false);
    });
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      setVolume(valFromEvent(e), false);
    });
    root.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('bwbr-vol-active');
      setVolume(valFromEvent(e), true);
    });
    root.addEventListener('pointercancel', () => {
      dragging = false;
      root.classList.remove('bwbr-vol-active');
    });

    // 키보드 접근성
    root.tabIndex = 0;
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', '사이트 음량');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');
    root.setAttribute('aria-valuenow', String(Math.round(curVal * 100)));
    root.addEventListener('keydown', (e) => {
      let step = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') step = 0.05;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') step = -0.05;
      if (step) {
        e.preventDefault();
        setVolume(curVal + step, true);
        root.setAttribute('aria-valuenow', String(Math.round(curVal * 100)));
      }
    });

    // ── 네이티브 MUI 숨기고 교체 (왼쪽에 배치) ──
    nativeSlider.style.display = 'none';
    parentEl.insertBefore(root, nativeSlider);

    // DOM 제거 감시 (React 리렌더 대비)
    let _recheckTimer = 0;
    const reObs = new MutationObserver(() => {
      clearTimeout(_recheckTimer);
      _recheckTimer = setTimeout(() => {
        if (!document.contains(root)) {
          reObs.disconnect();
          injectSiteVolumeSlider();
        }
      }, 500);
    });
    const obsTarget = parentEl.parentElement || document.body;
    reObs.observe(obsTarget, { childList: true, subtree: true });

    alwaysLog('사이트 음량 슬라이더 교체 완료 (렉 방지)');
  }

  /** 사이트에 주입된 음량 슬라이더 값을 동기화합니다. */
  function syncSiteVolumeSlider(volume) {
    const track = document.getElementById('bwbr-site-vol-track');
    const thumb = document.getElementById('bwbr-site-vol-thumb');
    const tooltip = document.getElementById('bwbr-site-vol-tooltip');
    const root = document.getElementById('bwbr-site-vol-root');
    const v = Math.round(Math.max(0, Math.min(1, volume)) * 100);
    if (track) track.style.width = v + '%';
    if (thumb) thumb.style.left = v + '%';
    if (tooltip) tooltip.textContent = v + '%';
    if (root) root.setAttribute('aria-valuenow', String(v));
  }

  // ── 시작 ─────────────────────────────────────────────────

  // 페이지 로드 후 초기화
  if (document.readyState === 'complete') {
    init().catch(e => console.error('[BWBR] init 미처리 거부:', e));
  } else {
    window.addEventListener('load', () => init().catch(e => console.error('[BWBR] init 미처리 거부:', e)));
  }

})();
