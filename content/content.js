// ============================================================
// Ccofolia Extension - 메인 컨트롤러 (Content Script)
// 설정 로드, 채팅 감시, 확장 메시지 처리, 로그 추출 오케스트레이션
// 전투 로직은 combat-controller.js (BWBR_CombatController)에 위임
//
// [모듈 분류 가이드]
//   [CORE]    = 범용 코코포리아 확장 기능 (TRPG 시스템 무관)
//   [COMBAT]  = 전투 제어기 위임 (combat-controller.js)
//   [TRIGGER] = 범용 트리거 자동화 모듈
// ============================================================

(function () {
  'use strict';

  // ── [CORE] 전역 상태 ─────────────────────────────────────

  let config = null;        // 현재 설정
  let chat = null;          // CocoforiaChatInterface
  let enabled = true;
  let _userMessagePendingPromise = null; // 사용자 메시지 도착 대기 프라미스 (메시지 순서 보장)
  let _cachedSpeakerName = null; // 현재 발화(선택) 캐릭터 이름

  // [COMBAT] 전투 제어기 (combat-controller.js)
  let combatCtrl = null;

  // [TRIGGER] 트리거 모듈 변수
  let triggerEngine = null; // TriggerEngine 인스턴스 (범용 트리거 시스템)

  // [CORE] Redux speaking 캐릭터 변경 감시 (redux-injector.js의 store.subscribe에서 push)
  document.addEventListener('bwbr-speaker-changed', () => {
    const name = document.documentElement.getAttribute('data-bwbr-speaker-name');
    if (name) _cachedSpeakerName = name;
  });

  // [CORE] char-shortcut.js Alt+숫자 전환 시 캐시 선행 갱신 (Redux 반영 전)
  window.addEventListener('bwbr-switch-character', (e) => {
    const name = e.detail?.name;
    if (name) _cachedSpeakerName = name;
  });

  // ── [CORE] 초기화 ────────────────────────────────────────────

  async function init() {
    try {
    alwaysLog('확장 프로그램 초기화 시작...');

    // 모듈 로더: 내장 모듈 로드 → BWBR_COMBAT_DEFAULTS, BWBR_DEFAULTS 구성
    if (window.BWBR_ModuleLoader) {
      await window.BWBR_ModuleLoader.loadAll();
      const mods = window.BWBR_ModuleLoader.getModules();
      alwaysLog('모듈 로더 완료: ' + mods.length + '개 모듈, ' +
        mods.filter(function(m) { return m.enabled; }).length + '개 활성');
    }

    // 설정 로드
    config = await loadConfig();

    // 디버그 모드 플래그 공유 (다른 ISOLATED world 모듈이 참조)
    window._BWBR_DEBUG = !!(config.general && config.general.debugMode);
    // MAIN world (redux-injector.js)에 디버그 모드 전달
    document.documentElement.setAttribute('data-bwbr-debug', String(window._BWBR_DEBUG));
    document.dispatchEvent(new CustomEvent('bwbr-set-debug'));

    // 모듈 초기화
    chat = new window.CocoforiaChatInterface(config);

    // 전투 제어기 초기화 (engine, combatEngine, overlay는 내부에서 생성)
    combatCtrl = window.BWBR_CombatController;
    combatCtrl.init({
      config: config,
      chat: chat,
      requestCharacterData: () => requestCharacterData(),
      awaitUserMessage: () => _awaitUserMessage(),
      getSpeakerName: () => _cachedSpeakerName,
      log: (msg) => log(msg),
      alwaysLog: (msg) => alwaysLog(msg),
      enabled: config.general.enabled
    });

    // Redux Store 가져오기 (전투 보조용 캐릭터 데이터 접근)
    setupReduxStore();

    enabled = config.general.enabled;

    // 자동완성 초기화
    if (window.BWBR_AutoComplete) {
      window.BWBR_AutoComplete.setEnabled(config.general.autoComplete !== false);
    }

    // DOM 요소 탐색 (코코포리아 로드 대기)
    log('코코포리아 채팅 DOM 탐색 중...');
    const found = await chat.waitForElements(60000, 2000);
    if (!found) {
      alwaysLog('채팅 DOM 요소를 찾을 수 없습니다. 수동 선택자 설정이 필요할 수 있습니다.');
      combatCtrl.getOverlay().setStatus('error', 'DOM 탐색 실패');
      combatCtrl.getOverlay().addLog('채팅 DOM 요소를 찾을 수 없습니다. 확장 프로그램 설정에서 선택자를 확인해주세요.', 'error');
      return;
    }

    alwaysLog('채팅 DOM 발견! 채팅 관찰 시작...');
    combatCtrl.getOverlay().addLog('코코포리아 연결 완료', 'success');

    // 로그 추출 메뉴 삽입 (톱니바퀴 메뉴에 항목 추가)
    setupLogExportMenu();

    // 범용 트리거 엔진 초기화 (트리거 모듈이 활성일 때만)
    const triggerModuleEnabled = window.BWBR_ModuleLoader
      ? window.BWBR_ModuleLoader.isEnabled('triggers')
      : true; // 모듈 로더 없으면 기본 활성

    if (window.TriggerEngine && triggerModuleEnabled) {
      triggerEngine = new window.TriggerEngine();
      triggerEngine.init({
        chat: chat,
        getFlowState: () => combatCtrl.getFlowState(),
        awaitUserMessage: () => _awaitUserMessage(),
        getCurrentCombatCharName: () => {
          const s = combatCtrl.getCombatEngine().getState();
          return s && s.currentCharacter ? s.currentCharacter.name : null;
        },
        getSpeakerName: () => _cachedSpeakerName
      });

      // 모듈 시스템에서 제공하는 기본 트리거가 있으면 전달
      if (window.BWBR_ModuleLoader && window.BWBR_ModuleLoader.getTriggers().length > 0) {
        triggerEngine.setExternalDefaults(window.BWBR_ModuleLoader.getTriggers());
      }

      await triggerEngine.load();
      alwaysLog('범용 트리거 엔진 초기화 완료 (' + triggerEngine.getTriggers().length + '개 트리거)');

      // 트리거 관리 UI 초기화
      if (window.BWBR_TriggerUI) {
        window.BWBR_TriggerUI.init(triggerEngine);
      }
    } else if (window.TriggerEngine && !triggerModuleEnabled) {
      alwaysLog('트리거 모듈 비활성 — 트리거 엔진/UI 건너뜀');
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

    // 메시지 스타일 변경 적용
    if (config.general.messageStyle) {
      _applyMessageStyle(true);
    }

    // 화면 표시 스케일 적용 (스탠딩/대화창 크기)
    if (window.BWBR_DisplayScale) {
      window.BWBR_DisplayScale.updateScale(
        config.general.standingScale ?? 1.0,
        config.general.chatBubbleScale ?? 1.0
      );
    }

    // 저장된 턴 전투 상태 복원 시도 (새로고침 후)
    const restored = await combatCtrl.tryRestore();
    if (restored) {
      alwaysLog('턴 전투 상태 복원 완료 — 전투 보조 모드 재개');
    }

    alwaysLog('초기화 완료! 트리거 대기 중...');
    log(`트리거 정규식: ${config.patterns.triggerRegex}`);
    } catch (err) {
      console.error('[CE] 초기화 실패:', err);
      alwaysLog('초기화 실패: ' + (err.message || err));
    }
  }

  // ── [CORE] 설정 로드 ────────────────────────────────────────

  async function loadConfig() {
    return new Promise((resolve) => {
      // 확장 컨텍스트 무효화 대비: 타임아웃 후 기본값 사용
      const fallbackTimer = setTimeout(() => {
        alwaysLog('설정 로드 타임아웃 → 기본값 사용');
        resolve(JSON.parse(JSON.stringify(window.BWBR_DEFAULTS)));
      }, 5000);
      try {
        // v2: 네임스페이스 키 + v1 마이그레이션 감지
        chrome.storage.sync.get(['bwbr_core', 'bwbr_combat', 'bwbr_config'], async (result) => {
          clearTimeout(fallbackTimer);
          if (chrome.runtime.lastError) {
            alwaysLog('설정 로드 오류: ' + chrome.runtime.lastError.message + ' → 기본값 사용');
            resolve(JSON.parse(JSON.stringify(window.BWBR_DEFAULTS)));
            return;
          }

          let coreData = result.bwbr_core;
          let combatData = result.bwbr_combat;

          // v1→v2 마이그레이션: 구 bwbr_config가 있고 새 키가 없으면 자동 변환
          if (result.bwbr_config && !coreData) {
            alwaysLog('v1 설정 감지 → v2 마이그레이션 시작...');
            const migrated = await window.BWBR_migrateConfigV1toV2(result.bwbr_config);
            coreData = migrated.core;
            combatData = migrated.combat;
          }

          if (coreData || combatData) {
            // 네임스페이스별 기본값과 병합 → 평탄한 런타임 config 생성
            const mergedCore = deepMerge(window.BWBR_CORE_DEFAULTS, coreData || {});
            const mergedCombat = deepMerge(window.BWBR_COMBAT_DEFAULTS, combatData || {});
            const merged = Object.assign({}, mergedCore, mergedCombat);
            // 정규식, 템플릿은 항상 최신 기본값을 사용 (이전 버전 호환)
            // 가지세계 모듈 비활성 시 BWBR_COMBAT_DEFAULTS가 빈 객체일 수 있으므로 안전 체크
            if (window.BWBR_COMBAT_DEFAULTS.patterns) {
              merged.patterns = JSON.parse(JSON.stringify(window.BWBR_COMBAT_DEFAULTS.patterns));
            }
            if (window.BWBR_COMBAT_DEFAULTS.templates) {
              merged.templates = JSON.parse(JSON.stringify(window.BWBR_COMBAT_DEFAULTS.templates));
            }
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

  // ── [CORE] 사용자 메시지 도착 대기 ─────────────────────

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

  // ── [CORE] 사용자 입력 감지 (Enter 키) ───────────────
  // ↳ 전투 제어기(combatCtrl)에 위임
  // ↳ [TRIGGER] triggerEngine.check/execute 호출

  function onInputSubmit(text) {
    if (!enabled) return;
    // @ 컷인 명령은 무시 (절대 전투 트리거가 아님)
    if (text.startsWith('@')) return;
    alwaysLog(`[입력 감지] "${text.substring(0, 80)}" (flowState=${combatCtrl.getFlowState()})`);

    // ★ 사용자 메시지가 Firestore에 도착할 때까지 대기할 프라미스 생성
    _userMessagePendingPromise = waitForUserMessageDelivery();

    // 전투 보조 시스템 트리거는 항상 먼저 체크 (범용 트리거와 독립 실행)
    const fs = combatCtrl.getFlowState();
    const isTracking = combatCtrl.isTrackingActive && combatCtrl.isTrackingActive();
    if (fs === 'IDLE' || fs === 'TURN_COMBAT') {
      // 턴제/관전추적: 화자가 현재 차례 캐릭터일 때만 행동 소비 (전투개시/종료는 항상 처리)
      const inCombatOrTracking = fs === 'TURN_COMBAT' || isTracking;
      if (inCombatOrTracking && _cachedSpeakerName) {
        let curCharName;
        if (fs === 'TURN_COMBAT') {
          const ce = combatCtrl.getCombatEngine && combatCtrl.getCombatEngine();
          const curChar = ce && ce.getState() && ce.getState().currentCharacter;
          curCharName = curChar ? curChar.name : null;
        } else {
          curCharName = combatCtrl.getTrackedTurnName && combatCtrl.getTrackedTurnName();
        }
        if (curCharName && curCharName !== _cachedSpeakerName) {
          alwaysLog(`[입력 감지] 화자="${_cachedSpeakerName}" ≠ 현재차례="${curCharName}" — 행동 소비 건너뜀 (전투개시/종료만 체크)`);
          // 전투 개시/종료 트리거만 체크 (행동 소비 제외)
          combatCtrl.checkForCombatAssistTrigger(text, true);
        } else {
          combatCtrl.checkForCombatAssistTrigger(text);
        }
      } else {
        combatCtrl.checkForCombatAssistTrigger(text);
      }
    } else {
      alwaysLog(`[입력 감지] flowState="${fs}" — 전투 보조 체크 건너뜀`);
    }

    // 범용 트리거 엔진 매칭
    if (triggerEngine) {
      const match = triggerEngine.check(text, 'input');
      if (match) {
        triggerEngine.execute(match.trigger, match.params, true);
        const fs2 = combatCtrl.getFlowState();
        if (fs2 === 'IDLE' || fs2 === 'TURN_COMBAT') {
          combatCtrl.checkForTrigger(text);
        }
        combatCtrl.checkForCancel(text);
        return;
      }
    }

    // 합 개시: IDLE 또는 TURN_COMBAT에서 능동 합 진행 시작
    const fs3 = combatCtrl.getFlowState();
    if (fs3 === 'IDLE' || fs3 === 'TURN_COMBAT') {
      combatCtrl.checkForTrigger(text);
    }
    combatCtrl.checkForCancel(text);
  }

  // ── [CORE] 채팅 로그 메시지 처리 ─────────────────
  // ↳ 전투 관련 메시지는 전투 제어기(combatCtrl)에 위임
  // ↳ [TRIGGER] triggerEngine.check/execute 호출

  function onNewMessage(text, element, senderName) {
    if (!enabled) return;

    log(`[상태: ${combatCtrl.getFlowState()}] 메시지 수신: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

    // 범용 트리거 엔진 매칭 (source = 'message')
    if (triggerEngine) {
      const diceValue = chat.parseDiceResult(text);
      if (diceValue != null) {
        triggerEngine.resolvePendingDice(diceValue);
      }
      const match = triggerEngine.check(text, 'message', diceValue, senderName);
      if (match) {
        triggerEngine.execute(match.trigger, match.params, false);
      }
    }

    // 전투 관련 메시지 처리는 모두 전투 제어기에 위임
    combatCtrl.handleNewMessage(text, element, senderName);
  }

  // ── [CORE] 확장 프로그램 메시지 처리 ────────────────
  // ↳ 전투 관련 설정은 전투 제어기(combatCtrl)에 위임
  // ↳ BWBR_SET_AUTO_COMPLETE, BWBR_SET_BETTER_SOUNDBAR 등은 [CORE]

  function onExtensionMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'BWBR_GET_STATUS':
        sendResponse({
          enabled: enabled,
          state: combatCtrl.getFlowState(),
          paused: combatCtrl.getPaused(),
          combat: combatCtrl.getEngine() ? combatCtrl.getEngine().getState() : null,
          connected: !!(chat && chat.chatContainer)
        });
        break;

      case 'BWBR_SET_ENABLED':
        enabled = message.enabled;
        combatCtrl.setEnabled(enabled);
        if (!enabled) combatCtrl.cancelCombat();
        sendResponse({ success: true });
        break;

      case 'BWBR_UPDATE_CONFIG':
        config = deepMerge(window.BWBR_DEFAULTS, message.config);
        // 패턴/템플릿은 항상 최신 기본값 사용 (팝업 측 구버전 호환)
        config.patterns = JSON.parse(JSON.stringify(window.BWBR_COMBAT_DEFAULTS.patterns));
        config.templates = JSON.parse(JSON.stringify(window.BWBR_COMBAT_DEFAULTS.templates));
        combatCtrl.updateConfig(config);
        chat.updateConfig(config);
        applySiteVolume(config.general.siteVolume ?? 1.0);
        syncSiteVolumeSlider(config.general.siteVolume ?? 1.0);
        if (window.BWBR_DisplayScale) {
          window.BWBR_DisplayScale.updateScale(
            config.general.standingScale ?? 1.0,
            config.general.chatBubbleScale ?? 1.0
          );
        }
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_SITE_VOLUME':
        config.general.siteVolume = message.volume;
        applySiteVolume(message.volume);
        syncSiteVolumeSlider(message.volume);
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_MANUAL_MODE':
        combatCtrl.setManualMode(message.manualMode);
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_SHOW_BATTLE_LOG':
        combatCtrl.setShowBattleLog(message.showBattleLog);
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
        combatCtrl.setAutoConsumeActions(message.autoConsumeActions);
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

      case 'BWBR_SET_MESSAGE_STYLE':
        config.general.messageStyle = message.messageStyle;
        _applyMessageStyle(message.messageStyle);
        alwaysLog(`메시지 스타일 변경 ${message.messageStyle ? '활성화' : '비활성화'}`);
        sendResponse({ success: true });
        break;

      case 'BWBR_SET_DISPLAY_SCALE':
        config.general.standingScale = message.standingScale ?? config.general.standingScale;
        config.general.chatBubbleScale = message.chatBubbleScale ?? config.general.chatBubbleScale;
        if (window.BWBR_DisplayScale) {
          window.BWBR_DisplayScale.updateScale(
            config.general.standingScale,
            config.general.chatBubbleScale
          );
        }
        sendResponse({ success: true });
        break;

      case 'BWBR_CANCEL_COMBAT':
        combatCtrl.cancelCombat();
        sendResponse({ success: true });
        break;

      case 'BWBR_PAUSE_COMBAT':
        combatCtrl.togglePause();
        sendResponse({ success: true, paused: combatCtrl.getPaused() });
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

  // ── [CORE] 로그 추출 ────────────────────────────────────

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
    combatCtrl.getOverlay().addLog('📜 로그 추출 중...', 'info');
    _showExportToast('📜 Firestore에서 로그를 가져오는 중...');

    const handler = (e) => {
      clearTimeout(timeout);
      window.removeEventListener('bwbr-export-log-result', handler);
      _logExportBusy = false;

      if (!e.detail?.success) {
        combatCtrl.getOverlay().addLog('로그 추출 실패: ' + (e.detail?.error || '알 수 없는 오류'), 'error');
        _showExportToast('❌ 로그 추출 실패: ' + (e.detail?.error || ''), 3000);
        return;
      }

      const { messages, roomName } = e.detail;
      combatCtrl.getOverlay().addLog(`📜 ${messages.length}건 로그 가져옴`, 'info');
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
          combatCtrl.getOverlay().addLog(`📜 로그 추출 완료! ${messages.length}건 → ${filename}`, 'success');
          _showExportToast(`✅ ${messages.length}건 로그 추출 완료!`, 3000);
        } catch (genErr) {
          combatCtrl.getOverlay().addLog('HTML 생성 실패: ' + genErr.message, 'error');
          _showExportToast('❌ HTML 생성 실패', 3000);
        }
      }
    };

    // 타임아웃 (60초)
    let timeout = setTimeout(() => {
      window.removeEventListener('bwbr-export-log-result', handler);
      _logExportBusy = false;
      combatCtrl.getOverlay().addLog('로그 추출 타임아웃 (60초 초과)', 'error');
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

  // ── [CORE] 유틸리티 ─────────────────────────────────────────

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
    console.log(`%c[CE]%c ${msg}`, 'color: #ff9800; font-weight: bold;', 'color: inherit;');
  }

  /** 디버그 모드에서만 출력 */
  function log(msg) {
    if (config && config.general && config.general.debugMode) {
      console.log(`[CE] ${msg}`);
    }
  }

  // ── [CORE] Redux Store 접근 (캐릭터 데이터용) ─────────────

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
    return BWBR_Bridge.request(
      'bwbr-request-characters', 'bwbr-characters-data', null,
      { recvAttr: 'data-bwbr-characters-data', timeout: 5000 }
    ).then(data => {
      if (data && data.success && data.characters) {
        log(`캐릭터 데이터 수신: ${data.characters.length}명`);
        return data.characters;
      }
      alwaysLog('캐릭터 데이터 수신 실패');
      return null;
    }).catch(() => {
      alwaysLog('캐릭터 데이터 요청 타임아웃');
      return null;
    });
  }

  // ── [CORE] aria-hidden 포커스 충돌 완화 (ccfolia MUI 버그) ───

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

  // ── [CORE] 사이트 음량 컨트롤러 ───────────────────────────

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

  // ── 메시지 스타일 변경 (시스템 가운데정렬 + 마크다운 렌더링) ──
  const _MSG_STYLE_ID = 'bwbr-message-style-css';
  let _msgStyleEnabled = false;
  let _mdProcessing = false;         // 재귀 방지 플래그
  const _mdCache = new Map();        // msgId → {raw, html} 캐시
  let _mdRafId = 0;                  // rAF ID

  // 마크다운 파서: 텍스트 → HTML
  function _parseMarkdown(text) {
    let s = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 헤딩 (줄 시작)
    s = s.replace(/^### (.+)$/gm, '<span style="font-size:1.1em;font-weight:700">$1</span>');
    s = s.replace(/^## (.+)$/gm, '<span style="font-size:1.3em;font-weight:700">$1</span>');
    s = s.replace(/^# (.+)$/gm, '<span style="font-size:1.5em;font-weight:700">$1</span>');

    // (텍스트|루비:루비문자)
    s = s.replace(/\(([^|)]+)\|루비:([^)]+)\)/g, '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');

    // (텍스트|툴팁:툴팁내용) — 커스텀 CSS 툴팁
    s = s.replace(/\(([^|)]+)\|툴팁:([^)]+)\)/g, '<span class="bwbr-md-tip" data-tip="$2">$1</span>');

    // (텍스트|#색상코드) — hex만 허용 (XSS 방지)
    s = s.replace(/\(([^|)]+)\|#([0-9a-fA-F]{6})\)/g, '<span style="color:#$2">$1</span>');
    s = s.replace(/\(([^|)]+)\|#([0-9a-fA-F]{3})\)/g, '<span style="color:#$2">$1</span>');

    // `코드`
    s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.9em">$1</code>');

    // **굵게**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // *기울임*
    s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // __밑줄__
    s = s.replace(/__([^_]+)__/g, '<span style="text-decoration:underline">$1</span>');

    // ~~취소선~~
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return s;
  }

  // 마크다운 포함 여부 빠른 검사
  function _hasMarkdown(text) {
    return /\*\*|(?<!\*)\*[^*]|__|~~|`[^`]+`|\([^|)]+\|[#루툴]|^#{1,3} /m.test(text);
  }

  // DOM에 마크다운 적용 (rAF에서 실행)
  function _applyMarkdownToMessages() {
    if (!_msgStyleEnabled || _mdProcessing) return;
    _mdProcessing = true;
    const items = document.querySelectorAll('.MuiListItem-root[data-msg-id]');
    for (let i = items.length - 1; i >= 0; i--) {  // 최신 메시지 우선
      const item = items[i];
      if (item.style.display === 'none') continue;
      const textEl = item.querySelector('.MuiListItemText-secondary');
      if (!textEl) continue;
      if (textEl.getAttribute('data-bwbr-md') === '1') continue;
      const msgId = item.getAttribute('data-msg-id');
      const raw = textEl.textContent || '';
      if (!_hasMarkdown(raw)) {
        textEl.setAttribute('data-bwbr-md', '1');
        continue;
      }
      // 캐시 확인
      const cached = _mdCache.get(msgId);
      let html;
      if (cached && cached.raw === raw) {
        html = cached.html;
      } else {
        html = _parseMarkdown(raw);
        _mdCache.set(msgId, { raw, html });
      }
      textEl.innerHTML = html;
      textEl.setAttribute('data-bwbr-md', '1');
    }
    _mdProcessing = false;
  }

  // rAF 디바운스 래퍼
  function _scheduleMarkdown() {
    if (!_msgStyleEnabled) return;
    if (_mdRafId) cancelAnimationFrame(_mdRafId);
    _mdRafId = requestAnimationFrame(_applyMarkdownToMessages);
  }

  // 마크다운 해제
  function _removeMarkdownFromMessages() {
    const items = document.querySelectorAll('.MuiListItemText-secondary[data-bwbr-md]');
    for (const item of items) {
      item.removeAttribute('data-bwbr-md');
    }
    _mdCache.clear();
  }

  function _applyMessageStyle(enabled) {
    _msgStyleEnabled = enabled;
    let styleEl = document.getElementById(_MSG_STYLE_ID);
    if (enabled) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = _MSG_STYLE_ID;
        styleEl.textContent = `
/* CE 메시지 스타일: 시스템 메시지 가운데 정렬 */
.MuiListItem-root[data-msg-type="system"] .MuiListItemText-root {
  text-align: center !important;
}
.MuiListItem-root[data-msg-type="system"] .MuiListItemAvatar-root {
  display: none !important;
}
.MuiListItem-root[data-msg-type="system"] .MuiListItemText-primary {
  display: none !important;
}
/* CE 마크다운 루비 */
.MuiListItemText-secondary ruby rt {
  font-size: 0.6em;
  color: rgba(255,255,255,0.7);
}
/* CE 마크다운 커스텀 툴팁 */
.bwbr-md-tip {
  position: relative;
  border-bottom: 1px dotted currentColor;
  cursor: help;
}
.bwbr-md-tip:hover::after {
  content: attr(data-tip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: #222;
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  z-index: 9999;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
`;
        document.head.appendChild(styleEl);
      }
      _scheduleMarkdown();
      document.addEventListener('bwbr-tags-applied', _scheduleMarkdown);
    } else {
      if (styleEl) styleEl.remove();
      _removeMarkdownFromMessages();
      document.removeEventListener('bwbr-tags-applied', _scheduleMarkdown);
    }
  }

  // ── 채팅 커맨드 도움말에 마크다운 섹션 주입 ──
  const _MD_HELP_MARKER = 'bwbr-md-help';
  let _helpDialogObserver = null;

  function _injectMarkdownHelp() {
    // role="dialog" 인 MuiPaper 찾기
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dlg of dialogs) {
      const content = dlg.querySelector('.MuiDialogContent-root');
      if (!content) continue;
      const title = dlg.querySelector('.MuiDialogTitle-root');
      if (!title || !title.textContent.includes('채팅 커맨드')) continue;
      // 이미 주입됐으면 스킵
      if (content.querySelector('.' + _MD_HELP_MARKER)) continue;

      // 구분선
      const hr = document.createElement('hr');
      hr.className = 'MuiDivider-root MuiDivider-fullWidth';
      hr.style.margin = '16px 0';
      hr.setAttribute('role', 'separator');

      // 제목
      const h6 = document.createElement('h6');
      h6.className = 'MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom';
      h6.textContent = '마크다운 서식 (CE 확장)';
      h6.classList.add(_MD_HELP_MARKER);

      // 본문
      const p = document.createElement('p');
      p.className = 'MuiTypography-root MuiTypography-body2';
      p.style.cssText = 'word-break:break-all;white-space:pre-wrap;';
      p.innerHTML = [
        '<strong>**굵게**</strong>',
        '<em>*기울임*</em>',
        '<span style="text-decoration:underline">__밑줄__</span>',
        '<del>~~취소선~~</del>',
        '<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px">`코드`</code>',
        '',
        '<span style="color:#FF6B6B">(텍스트|#FF6B6B)</span> — 색상 변경 (3~6자리 HEX)',
        '<ruby>텍스트<rp>(</rp><rt>루비</rt><rp>)</rp></ruby> — (텍스트|루비:루비)',
        '<span style="border-bottom:1px dotted currentColor;cursor:help">텍스트</span> — (텍스트|툴팁:설명)',
        '',
        '<span style="font-size:1.5em;font-weight:700"># 크기 1</span>',
        '<span style="font-size:1.3em;font-weight:700">## 크기 2</span>',
        '<span style="font-size:1.1em;font-weight:700">### 크기 3</span>',
        '',
        '단축키: Ctrl+B 굵게, Ctrl+I 기울임, Ctrl+U 밑줄, Ctrl+D 취소선',
        '',
        '※ 설정 &gt; 일반 &gt; "메시지 스타일 변경" 토글 필요',
      ].join('<br>');

      content.appendChild(hr);
      content.appendChild(h6);
      content.appendChild(p);
    }
  }

  // 도움말 다이얼로그 열림 감지 — body 에 MutationObserver
  function _startHelpDialogWatch() {
    if (_helpDialogObserver) return;
    _helpDialogObserver = new MutationObserver(() => {
      _injectMarkdownHelp();
    });
    _helpDialogObserver.observe(document.body, { childList: true, subtree: false });
  }
  // 초기화 시 한 번 호출
  _startHelpDialogWatch();

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
          position: absolute; top: -36px; left: 50%;
          transform: translateX(-50%);
          background: rgb(22, 22, 22); color: #fff;
          font-size: 12px; font-weight: 500;
          font-family: Roboto, Helvetica, Arial, sans-serif;
          padding: 4px 8px; border-radius: 4px;
          pointer-events: none; white-space: nowrap;
          box-shadow: rgba(0,0,0,0.2) 0px 1px 3px 0px, rgba(0,0,0,0.14) 0px 1px 1px 0px, rgba(0,0,0,0.12) 0px 2px 1px -1px;
          opacity: 0; transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          transition-delay: 100ms;
        }
        #bwbr-site-vol-root:hover #bwbr-site-vol-tooltip,
        #bwbr-site-vol-root.bwbr-vol-active #bwbr-site-vol-tooltip {
          opacity: 1; transition-delay: 0ms;
        }
      `;
      document.head.appendChild(style);
    }

    // ── 커스텀 슬라이더 구조 생성 ──
    const root = document.createElement('div');
    root.id = 'bwbr-site-vol-root';
    root.title = 'Ccofolia Extension — 사이트 음량 (렉 방지)';

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
            chrome.storage.sync.get('bwbr_core', (res) => {
              if (chrome.runtime.lastError) return;
              const c = res.bwbr_core || {};
              if (!c.general) c.general = {};
              c.general.siteVolume = curVal;
              chrome.storage.sync.set({ bwbr_core: c });
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

  // ── [CORE] 시작 ─────────────────────────────────────────────

  // 페이지 로드 후 초기화
  if (document.readyState === 'complete') {
    init().catch(e => console.error('[CE] init 미처리 거부:', e));
  } else {
    window.addEventListener('load', () => init().catch(e => console.error('[CE] init 미처리 거부:', e)));
  }

})();