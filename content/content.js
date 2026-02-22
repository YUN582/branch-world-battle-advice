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

  // ── 초기화 ───────────────────────────────────────────────

  async function init() {
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
    overlay.setActionClickCallback((type, index, action) => {
      // 행동 슬롯 클릭 처리
      // action: 'use' (활성 슬롯 클릭 → 소모), 'restore' (소모된 슬롯 클릭 → 복구), 'add' (+ 버튼 클릭 → 추가)
      if (action === 'use') {
        if (type === 'main') {
          handleMainActionUsed(true);
        } else if (type === 'sub') {
          handleSubActionUsed();
        }
      } else if (action === 'restore' || action === 'add') {
        const extendMax = (action === 'add');
        if (type === 'main') {
          handleMainActionAdded(extendMax);
        } else if (type === 'sub') {
          handleSubActionAdded(extendMax);
        }
      }
    });
    overlay.setStatus(enabled ? 'idle' : 'disabled', enabled ? '대기 중' : '비활성');

    // DOM 요소 탐색 (코코포리아 로드 대기)
    alwaysLog('코코포리아 채팅 DOM 탐색 중...');
    const found = await chat.waitForElements(60000, 2000);
    if (!found) {
      alwaysLog('채팅 DOM 요소를 찾을 수 없습니다. 수동 선택자 설정이 필요할 수 있습니다.');
      overlay.setStatus('error', 'DOM 탐색 실패');
      overlay.addLog('채팅 DOM 요소를 찾을 수 없습니다. 확장 프로그램 설정에서 선택자를 확인해주세요.', 'error');
      return;
    }

    alwaysLog('채팅 DOM 발견! 채팅 관찰 시작...');
    overlay.addLog('코코포리아 연결 완료', 'success');

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

    alwaysLog('초기화 완료! 트리거 대기 중...');
    alwaysLog(`트리거 정규식: ${config.patterns.triggerRegex}`);
  }

  // ── 설정 로드 ────────────────────────────────────────────

  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('bwbr_config', (result) => {
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

    // ★ 사용자 메시지가 Firestore에 도착할 때까지 대기할 프라미스 생성
    // 시스템 메시지(턴 안내, 행동 소비 등)가 사용자 메시지 이후에 전송되도록 보장
    _userMessagePendingPromise = waitForUserMessageDelivery();

    // 전투 보조 시스템 트리거 감지
    if (flowState === STATE.IDLE || flowState === STATE.TURN_COMBAT) {
      checkForCombatAssistTrigger(text);
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

    alwaysLog(`[상태: ${flowState}] 메시지 수신: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

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
  function checkForCombatAssistTrigger(text) {
    alwaysLog(`[전투 보조] 트리거 체크: "${text.substring(0, 50)}"`);
    
    // 전투 개시 감지: 《 전투개시 》 또는 《 전투개시 》 @전투
    if (combatEngine.parseCombatStartTrigger(text)) {
      alwaysLog('[전투 보조] 전투개시 트리거 감지!');
      startCombatAssist();
      return;
    }

    // 전투 종료 감지: 《 전투종료 》
    if (combatEngine.parseCombatEndTrigger && combatEngine.parseCombatEndTrigger(text)) {
      endCombatAssist();
      return;
    }

    // 차례 종료 감지: 《 차례 종료 》 또는 《 차례종료 》
    // 사용자 입력에서 바로 감지 (채팅 로그에서는 컷인이 분리되어 감지 불가)
    if (flowState === STATE.TURN_COMBAT && combatEngine.parseTurnEndTrigger(text)) {
      const now = Date.now();
      if (now - _lastTurnAdvanceTime < 1000) {
        alwaysLog('[전투 보조] 차례 종료 중복 감지 — 무시');
        return;
      }
      _lastTurnAdvanceTime = now;
      alwaysLog('[전투 보조] 차례종료 트리거 감지!');
      advanceTurn();
      return;
    }
  }

  // ── 행동 소모 감지 ─────────────────────────────
  let _lastActionTime = 0;  // 행동 소모 디바운스 (onNewMessage 경로)

  /** 전투 보조 모드에서 채팅 메시지 처리 (onNewMessage 경유) */
  function processCombatAssistMessage(text, senderName) {
    if (flowState !== STATE.TURN_COMBAT) return;

    // 차례 종료 감지: 《 차례 종료 》
    if (combatEngine.parseTurnEndTrigger(text)) {
      // 디바운스: 1초 내 중복 호출 방지
      const now = Date.now();
      if (now - _lastTurnAdvanceTime < 1000) {
        alwaysLog('[전투 보조] 차례 종료 중복 감지 — 무시');
        return;
      }
      _lastTurnAdvanceTime = now;
      advanceTurn();
      return;
    }

    // 자동 소모가 비활성화되어 있으면 여기서 종료
    if (!config.general.autoConsumeActions) return;

    // 자체 전송한 행동 소비/추가 메시지는 무시 (에코 방지)
    if (/《.*행동\s*(소비|추가)》/.test(text)) return;

    // 행동 감지 디바운스: 500ms 내 중복 방지
    // (onInputSubmit에서 이미 소모한 경우 여기서 차단됨)
    const now = Date.now();
    if (now - _lastActionTime < 500) {
      return;
    }

    // 합 개시 감지: 공격자가 현재 차례 캐릭터와 같으면 주 행동 소모
    const meleeAttacker = combatEngine.parseMeleeStartAttacker(text);
    if (meleeAttacker) {
      const state = combatEngine.getState();
      const currentChar = state.currentCharacter;
      if (currentChar && currentChar.name === meleeAttacker) {
        _lastActionTime = now;
        handleMainActionUsed(true);
      }
      return;  // 합 개시 메시지는 일반 주 행동으로 처리하지 않음
    }

    // ★ 메시지 발신자가 현재 차례 캐릭터인지 확인 (다른 캐릭터의 행동은 무시)
    const currentChar = combatEngine.getState().currentCharacter;
    if (senderName && currentChar && senderName !== currentChar.name) {
      // 발신 캐릭터가 현재 차례자와 다르면 행동 소모 하지 않음
      return;
    }

    // 주 행동 다이스 감지: 1d20+... | 《...》 | 또는 단독 《...》
    const mainActionResult = combatEngine.parseMainActionRoll(text);
    if (mainActionResult) {
      _lastActionTime = now;
      handleMainActionUsed(mainActionResult);
      return;
    }

    // 보조 행동 감지: 【...】
    const subActionResult = combatEngine.parseSubActionRoll(text);
    if (subActionResult) {
      _lastActionTime = now;
      handleSubActionUsed();
      return;
    }
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

  function _doStartCombatAssist() {
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
    alwaysLog(`턴 순서:\n${turnOrder}`);

    // 첫 턴 시작 (currentTurnIndex를 -1에서 0으로)
    combatEngine.nextTurn();

    // 첫 턴 시작 메시지 전송
    sendTurnStartMessage();
  }

  /** 다음 턴으로 이동 */
  function advanceTurn() {
    if (flowState !== STATE.TURN_COMBAT) return;

    const nextChar = combatEngine.nextTurn();
    if (!nextChar) {
      // 모든 캐릭터 턴 완료 → 다시 첫 번째로
      alwaysLog('모든 캐릭터 턴 완료, 처음으로 돌아감');
    }

    sendTurnStartMessage();
  }

  /** 주 행동 사용 처리 */
  function handleMainActionUsed(actionResult) {
    const result = combatEngine.useMainAction();
    if (result.success) {
      alwaysLog(`주 행동 사용! 남은 주 행동: ${result.remaining.mainActions}개`);
      overlay.addLog(`🔺주 행동 사용 (남은: ${result.remaining.mainActions}개)`, 'info');
      refreshTurnUI();  // UI 갱신
      sendActionConsumedMessage('주');  // 비동기 — 사용자 메시지 도착 대기 후 전송
    }
  }

  /** 보조 행동 사용 처리 */
  function handleSubActionUsed() {
    const result = combatEngine.useSubAction();
    if (result.success) {
      alwaysLog(`보조 행동 사용! 남은 보조 행동: ${result.remaining.subActions}개`);
      overlay.addLog(`🔹보조 행동 사용 (남은: ${result.remaining.subActions}개)`, 'info');
      refreshTurnUI();  // UI 갱신
      sendActionConsumedMessage('보조');  // 비동기 — 사용자 메시지 도착 대기 후 전송
    }
  }

  /** 행동 소비 메시지 전송 */
  async function sendActionConsumedMessage(actionType) {
    await _awaitUserMessage();
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    if (!current) return;

    const emoji = actionType === '주' ? '🔺' : '🔹';
    const msg = `《${emoji}${actionType} 행동 소비》\n${current.name} | 🔺주 행동 ${current.mainActions}, 🔹보조 행동 ${current.subActions} | 이동거리 ${current.movement} @발도1`;
    chat.sendSystemMessage(msg);
  }

  /** 주 행동 추가 처리 (슬롯 복구 또는 신규 추가) */
  function handleMainActionAdded(extendMax = false) {
    const result = combatEngine.addMainAction(extendMax);
    if (result.success) {
      alwaysLog(`주 행동 추가! 현재 주 행동: ${result.remaining.mainActions}개`);
      overlay.addLog(`🔺주 행동 추가 (현재: ${result.remaining.mainActions}개)`, 'info');
      refreshTurnUI();  // UI 갱신
      sendActionAddedMessage('주');  // 비동기 — 사용자 메시지 도착 대기 후 전송
    }
  }

  /** 보조 행동 추가 처리 (슬롯 복구 또는 신규 추가) */
  function handleSubActionAdded(extendMax = false) {
    const result = combatEngine.addSubAction(extendMax);
    if (result.success) {
      alwaysLog(`보조 행동 추가! 현재 보조 행동: ${result.remaining.subActions}개`);
      overlay.addLog(`🔹보조 행동 추가 (현재: ${result.remaining.subActions}개)`, 'info');
      refreshTurnUI();  // UI 갱신
      sendActionAddedMessage('보조');  // 비동기 — 사용자 메시지 도착 대기 후 전송
    }
  }

  /** 행동 추가 메시지 전송 */
  async function sendActionAddedMessage(actionType) {
    await _awaitUserMessage();
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    if (!current) return;

    const emoji = actionType === '주' ? '🔺' : '🔹';
    const msg = `《${emoji}${actionType} 행동 추가》\n${current.name} | 🔺주 행동 ${current.mainActions}, 🔹보조 행동 ${current.subActions} | 이동거리 ${current.movement} @발도2`;
    chat.sendSystemMessage(msg);
  }

  /** 턴 정보 UI 갱신 */
  function refreshTurnUI() {
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    if (!current) return;

    // 기존 sendTurnStartMessage의 데이터 수집 로직 재사용
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

    overlay.updateTurnInfo({
      name: current.name,
      iconUrl: current.iconUrl,
      will: willValue,
      willMax: willMax,
      armor: armorValue,
      alias: aliasValue,
      mainActions: current.mainActions,
      mainActionsMax: current.mainActionsMax,
      subActions: current.subActions,
      subActionsMax: current.subActionsMax
    });
  }

  /** 턴 시작 메시지 전송 */
  async function sendTurnStartMessage() {
    // 사용자 트리거 메시지가 먼저 도착하도록 대기
    await _awaitUserMessage();
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    
    if (!current) {
      alwaysLog('현재 차례 캐릭터 없음');
      return;
    }

    // 《 {캐릭터 이름}의 차례 》\n🔺주 행동 N개, 🔹보조 행동 Y개 | 이동거리 Z
    const turnMsg = `《 ${current.name}의 차례 》\n🔺주 행동 ${current.mainActions}개, 🔹보조 행동 ${current.subActions}개 | 이동거리 ${current.movement}`;
    
    alwaysLog(`턴 메시지: ${turnMsg}`);
    overlay.addLog(`🎯 ${current.name}의 차례`, 'success');

    // 오버레이에 턴 정보 표시
    // 의지는 status에서 찾기 (value/max)
    let willValue = null;
    let willMax = null;
    const willStatus = combatEngine.getStatusValue(current.originalData, '의지');
    if (willStatus) {
      willValue = willStatus.value;
      willMax = willStatus.max;
    } else {
      // params에서 찾기
      const paramWill = combatEngine.getParamValue(current.originalData, '의지');
      if (paramWill !== null) {
        willValue = paramWill;
        willMax = paramWill;  // params는 max가 없으므로 동일하게
      }
    }

    // 장갑 값 가져오기
    let armorValue = null;
    const armorStatus = combatEngine.getStatusValue(current.originalData, '장갑');
    if (armorStatus !== null) {
      armorValue = armorStatus.value;
    } else {
      const paramArmor = combatEngine.getParamValue(current.originalData, '장갑');
      if (paramArmor !== null) armorValue = paramArmor;
    }

    // 이명 가져오기 (params에서)
    const aliasValue = combatEngine.getParamValue(current.originalData, '이명');
    
    overlay.updateTurnInfo({
      name: current.name,
      iconUrl: current.iconUrl,
      will: willValue,
      willMax: willMax,
      armor: armorValue,
      alias: aliasValue,
      mainActions: current.mainActions,
      mainActionsMax: current.mainActionsMax,
      subActions: current.subActions,
      subActionsMax: current.subActionsMax
    });

    // 채팅으로 전송
    chat.sendSystemMessage(turnMsg);
  }

  /** 전투 보조 모드 종료 */
  function endCombatAssist() {
    if (flowState !== STATE.TURN_COMBAT) return;

    alwaysLog('🎲 전투 보조 모드 종료');
    combatEngine.endCombat();
    flowState = STATE.IDLE;

    overlay.updateTurnInfo(null);  // 턴 정보 패널 숨김
    overlay.addLog('🎲 전투 보조 모드 종료', 'warning');
    overlay.setStatus('idle', '대기 중');
  }

  // ══════════════════════════════════════════════════════════
  // 전투 보조 관전 추적 (진행자가 아닌 사용자용)
  // ══════════════════════════════════════════════════════════

  /** 전투 보조 메시지를 파싱하여 관전자 UI 업데이트 */
  async function processTurnCombatTracking(text) {
    // DEBUG: 모든 메시지 로깅
    alwaysLog(`[관전 추적] 메시지 확인: "${text.substring(0, 80)}"`);
    
    // 1. 전투 개시 감지 → 캐릭터 캐시 업데이트
    if (combatEngine.parseCombatStartTrigger(text)) {
      alwaysLog('[관전 추적] 전투 개시 감지!');
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
        alwaysLog('[관전 추적] 전투 종료 감지');
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
    if (!_turnTrackingActive) {
      alwaysLog(`[관전 추적] 추적 비활성 상태 - 무시`);
      return;
    }

    // 3. 차례 시작 메시지 파싱
    const turnStart = combatEngine.parseTurnStartMessage(text);
    alwaysLog(`[관전 추적] 차례 시작 파싱 결과: ${JSON.stringify(turnStart)}`);
    if (turnStart) {
      alwaysLog(`[관전 추적] 차례 시작: ${turnStart.name}`);
      
      // 캐시가 비어있으면 업데이트 기다림
      if (_characterCache.size === 0) {
        alwaysLog(`[관전 추적] 캐시 비어있음 - 업데이트 대기`);
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
      alwaysLog(`[관전 추적] ${actionConsumed.actionType} 행동 소비: ${actionConsumed.name}`);
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
      alwaysLog(`[관전 추적] ${actionAdded.actionType} 행동 추가: ${actionAdded.name}`);
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
        alwaysLog(`[관전 추적] 캐릭터 캐시 업데이트: ${_characterCache.size}명`);
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

    // TURN_COMBAT에서 합 시작 시: 공격자가 현재 차례자이면 주 행동 소모
    // ※ onNewMessage 경로(processCombatAssistMessage)에서는 감지 불가 —
    //   checkForTrigger가 먼저 flowState를 COMBAT_STARTED로 변경하기 때문.
    //   따라서 여기서 직접 처리. 공격자 이름은 메시지에서 명시적으로 파싱되므로 안전.
    if (flowState === STATE.TURN_COMBAT && config.general.autoConsumeActions) {
      const currentChar = combatEngine.getState().currentCharacter;
      if (currentChar && currentChar.name === triggerData.attacker.name) {
        _lastActionTime = Date.now();
        handleMainActionUsed(true);
      }
    }

    // TURN_COMBAT에서 시작한 경우: 합 종료 후 복귀 플래그 설정
    if (flowState === STATE.TURN_COMBAT) {
      _activeCombatFromTurnCombat = true;
      alwaysLog('⚔️ 전투 보조 중 능동 합 시작 → 합 종료 후 전투 보조로 복귀 예정');
    } else if (_turnTrackingActive) {
      // 관전 추적 중 능동 합 시작 (비호스트)
      _activeCombatFromTurnCombat = true;
      alwaysLog('⚔️ 전투 관전 중 능동 합 시작 → 합 종료 후 관전 모드로 복귀 예정');
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
      alwaysLog('⚔️ 합 중지 → 전투 보조 모드로 복귀');
      _activeCombatFromTurnCombat = false;
      flowState = STATE.TURN_COMBAT;
      overlay.setStatus('active', '전투 보조 중');
      overlay.smoothTransition(() => refreshTurnUI());
      return;
    }

    // 관전 추적 중이었으면 관전 UI 복귀 (비호스트)
    if (_activeCombatFromTurnCombat && _turnTrackingActive) {
      alwaysLog('⚔️ 합 중지 → 전투 관전 모드로 복귀');
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
        alwaysLog(`[SPEC] ⚠️ engine.combat=null but within 3s grace period — ignoring (text="${text.substring(0,50)}")`);
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
      alwaysLog(`👁️ endSpectating 무시: flowState=${flowState}`);
      return;
    }
    
    engine.reset();
    _spectatorDedup.clear();
    _spectatorStartTime = 0;
    overlay.setSpectatorMode(false);

    // TURN_COMBAT에서 시작했고, 전투가 아직 진행 중이면 턴 UI로 복귀
    if (_spectatorFromTurnCombat && combatEngine && combatEngine.inCombat) {
      alwaysLog('👁️ 합 종료 → 전투 보조 모드로 복귀');
      flowState = STATE.TURN_COMBAT;
      _spectatorFromTurnCombat = false;
      overlay.addLog('합 종료 — 전투 보조 모드로 복귀', 'info');
      overlay.setStatus('active', '전투 보조 중');
      overlay.smoothTransition(() => refreshTurnUI());
      return;
    }

    // 관전 추적 중이었으면 추적 UI 복귀 (비호스트 사용자)
    if (_spectatorFromTurnCombat && _turnTrackingActive) {
      alwaysLog('👁️ 합 종료 → 전투 관전 모드로 복귀');
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
    alwaysLog('⏸ 일시정지 예약 (주사위 굴림 후 적용)');
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
      alwaysLog('수동 입력: 취소됨');
      return;
    }

    alwaysLog(`수동 입력 (재개): ${who} = ${manualValue}`);
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
      const rollMsg = engine.getAttackerRollMessage();
      log(`공격자 주사위 굴림: ${rollMsg}`);

      chat.sendMessage(rollMsg);
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
    alwaysLog(`공격자 결과: ${value}`);
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
      const rollMsg = engine.getDefenderRollMessage();
      log(`방어자 주사위 굴림: ${rollMsg}`);

      chat.sendMessage(rollMsg);
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
    alwaysLog(`방어자 결과: ${value}`);
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
        alwaysLog('⚠️ processRoundResult: 이미 처리됨 (중복 호출 무시)');
        return;
      }

      // 결과 메시지 전송 (승자/패자 색상 분리)
      if (result.description) {
        overlay.addLog(result.description, getResultLogType(result));

        if (result.winner) {
          // 승자(RED) / 패자(BLUE) 분리 전송
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

          await chat.sendSystemMessage(winMsg);
          await chat.sendSystemMessage(loseMsg);
        } else {
          // 동점 / 쌍방 대성공/대실패 → 기본 색상
          await chat.sendSystemMessage(result.description);
        }
      }

      // 특성 이벤트 로그 + 채팅 전송
      let manualH0ExtraRound = false;  // 수동 모드 H40/H400 추가 합 플래그
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
          if (chatMsg) await chat.sendSystemMessage(chatMsg);
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
      alwaysLog('⚔️ 합 종료 → 전투 보조 모드로 복귀');
      _activeCombatFromTurnCombat = false;
      flowState = STATE.TURN_COMBAT;
      overlay.addLog('합 종료 — 전투 보조 모드로 복귀', 'info');
      overlay.setStatus('active', '전투 보조 중');
      overlay.smoothTransition(() => refreshTurnUI());
      return;
    }

    // 관전 추적 중이었으면 관전 UI 복귀 (비호스트)
    if (_activeCombatFromTurnCombat && _turnTrackingActive) {
      alwaysLog('⚔️ 합 종료 → 전투 관전 모드로 복귀');
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
      alwaysLog('수동 입력: 취소됨 (전투 중지)');
      return;
    }

    alwaysLog(`수동 입력: ${who} = ${manualValue}`);
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
        alwaysLog(`${who} 타임아웃 무시 (라운드 변경: ${expectedRound} → ${engine.round})`);
        return;
      }

      alwaysLog(`${who} 결과 타임아웃 → 수동 입력 요청`);
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
        alwaysLog('수동 입력: 취소됨 (채팅 인식 또는 중지)');
        return;
      }

      alwaysLog(`수동 입력: ${who} = ${manualValue}`);
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
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_SITE_VOLUME':
        config.general.siteVolume = message.volume;
        applySiteVolume(message.volume);
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
        alwaysLog('캐릭터 데이터 요청 타임아웃');
        resolve(null);
      }, 5000);

      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-characters-data', handler);
        
        if (e.detail?.success && e.detail?.characters) {
          alwaysLog(`캐릭터 데이터 수신: ${e.detail.characters.length}명`);
          resolve(e.detail.characters);
        } else {
          alwaysLog('캐릭터 데이터 수신 실패');
          resolve(null);
        }
      };

      window.addEventListener('bwbr-characters-data', handler);
      window.dispatchEvent(new CustomEvent('bwbr-request-characters'));
    });
  }

  // ── 사이트 음량 컨트롤러 ─────────────────────────────────

  /** 사이트 음량을 변경합니다. (site-volume.js의 페이지 스크립트로 전달) */
  function applySiteVolume(volume) {
    const v = Math.max(0, Math.min(1, volume));
    window.dispatchEvent(new CustomEvent('bwbr-set-site-volume', { detail: { volume: v } }));
    alwaysLog(`사이트 음량: ${Math.round(v * 100)}%`);
  }

  // ── 시작 ─────────────────────────────────────────────────

  // 페이지 로드 후 초기화
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', () => init());
  }

})();
