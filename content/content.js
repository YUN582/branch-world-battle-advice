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
    COMBAT_END: 'COMBAT_END'
  };

  let config = null;        // 현재 설정
  let engine = null;        // BattleRollEngine
  let chat = null;          // CocoforiaChatInterface
  let overlay = null;       // BattleRollOverlay
  let flowState = STATE.IDLE;
  let enabled = true;
  let resultTimeoutId = null;

  // ── 초기화 ───────────────────────────────────────────────

  async function init() {
    alwaysLog('확장 프로그램 초기화 시작...');

    // 설정 로드
    config = await loadConfig();

    // 모듈 초기화
    engine = new window.BattleRollEngine(config);
    chat = new window.CocoforiaChatInterface(config);
    overlay = new window.BattleRollOverlay(config);

    enabled = config.general.enabled;

    // 오버레이 이벤트
    overlay.onCancel(() => cancelCombat());

    // 오버레이 표시 설정
    if (config.general.showOverlay) {
      overlay.show();
    }
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

    // 채팅 관찰 시작
    chat.observeChat(onNewMessage);

    // 메시지 리스너 (popup ↔ content 통신)
    chrome.runtime.onMessage.addListener(onExtensionMessage);

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
          // 정규식, 템플릿, 효과음은 항상 최신 기본값을 사용 (이전 버전 호환)
          merged.patterns = JSON.parse(JSON.stringify(window.BWBR_DEFAULTS.patterns));
          merged.templates = JSON.parse(JSON.stringify(window.BWBR_DEFAULTS.templates));
          merged.sounds = JSON.parse(JSON.stringify(window.BWBR_DEFAULTS.sounds));
          alwaysLog('저장된 설정 로드 (패턴/템플릿/효과음은 기본값 사용)');
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

  // ── 채팅 메시지 처리 ─────────────────────────────────────

  function onNewMessage(text, element) {
    if (!enabled) return;

    alwaysLog(`[상태: ${flowState}] 메시지 수신: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

    switch (flowState) {
      case STATE.IDLE:
        checkForTrigger(text);
        checkForCancel(text);
        break;

      case STATE.WAITING_ATTACKER_RESULT:
        checkForAttackerResult(text);
        checkForCancel(text);
        break;

      case STATE.WAITING_DEFENDER_RESULT:
        checkForDefenderResult(text);
        checkForCancel(text);
        break;

      default:
        // ROUND_HEADER_SENT, PROCESSING_RESULT, COMBAT_END 등은 타이머로 처리
        checkForCancel(text);
        break;
    }
  }

  // ── 합 개시 트리거 감지 ──────────────────────────────────

  function checkForTrigger(text) {
    alwaysLog(`트리거 체크: "${text.substring(0, 80)}"`);
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) {
      alwaysLog('트리거 매칭 실패 (정규식 불일치)');
      return;
    }

    alwaysLog(`✅ 합 개시 감지! ⚔️${triggerData.attacker.name}(${triggerData.attacker.dice}) vs 🛡️${triggerData.defender.name}(${triggerData.defender.dice})`);

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
    if (flowState === STATE.IDLE) return;

    log('전투 중지');
    clearTimeout(resultTimeoutId);
    flowState = STATE.IDLE;
    engine.reset();
    overlay.addLog('전투가 중지되었습니다.', 'warning');
    overlay.setStatus('idle', '대기 중');
    overlay.updateCombatState(engine.getState());
  }

  // ── 라운드 진행 ──────────────────────────────────────────

  async function startNextRound() {
    engine.incrementRound();
    const state = engine.getState();
    overlay.updateCombatState(state);

    // 라운드 헤더 전송
    const headerMsg = engine.getRoundHeaderMessage();
    log(`라운드 ${state.round} 헤더 전송`);
    overlay.addLog(`── 제 ${state.round}합 ──`, 'info');

    flowState = STATE.ROUND_HEADER_SENT;
    await chat.sendMessage(headerMsg);

    // 대기 후 공격자 굴림
    await delay(config.timing.beforeFirstRoll);
    rollForAttacker();
  }

  async function rollForAttacker() {
    const rollMsg = engine.getAttackerRollMessage();
    log(`공격자 주사위 굴림: ${rollMsg}`);

    flowState = STATE.WAITING_ATTACKER_RESULT;
    overlay.setStatus('waiting', '공격자 결과 대기 중...');

    await chat.sendMessage(rollMsg);

    // 타임아웃 설정
    setResultTimeout('공격자');
  }

  function checkForAttackerResult(text) {
    // 코코포리아 다이스봇 결과만 인식: '1D20' 또는 '(1D20)' 포함 필수
    if (!text.match(/1[Dd]20/)) return;

    const value = chat.parseDiceResult(text);
    if (value === null) return;

    // 결과가 공격자 것인지 확인 (⚔️ 또는 공격자 이름 포함 여부)
    const state = engine.getState();
    if (!text.includes('⚔️') && !text.includes(state.combat.attacker.name)) {
      return; // 무관한 주사위 결과 무시
    }

    clearTimeout(resultTimeoutId);
    log(`공격자 결과: ${value}`);
    engine.setAttackerRoll(value);

    const logType = value === config.rules.criticalValue ? 'crit'
      : value === config.rules.fumbleValue ? 'fumble' : 'info';
    overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${value}`, logType);

    // 대기 후 방어자 굴림
    setTimeout(() => rollForDefender(), config.timing.betweenRolls);
  }

  async function rollForDefender() {
    const rollMsg = engine.getDefenderRollMessage();
    log(`방어자 주사위 굴림: ${rollMsg}`);

    flowState = STATE.WAITING_DEFENDER_RESULT;
    overlay.setStatus('waiting', '방어자 결과 대기 중...');

    await chat.sendMessage(rollMsg);

    // 타임아웃 설정
    setResultTimeout('방어자');
  }

  function checkForDefenderResult(text) {
    // 코코포리아 다이스봇 결과만 인식: '1D20' 또는 '(1D20)' 포함 필수
    if (!text.match(/1[Dd]20/)) return;

    const value = chat.parseDiceResult(text);
    if (value === null) return;

    // 결과가 방어자 것인지 확인
    const state = engine.getState();
    if (!text.includes('🛡️') && !text.includes(state.combat.defender.name)) {
      return;
    }

    clearTimeout(resultTimeoutId);
    log(`방어자 결과: ${value}`);
    engine.setDefenderRoll(value);

    const logType = value === config.rules.criticalValue ? 'crit'
      : value === config.rules.fumbleValue ? 'fumble' : 'info';
    overlay.addLog(`🛡️ ${state.combat.defender.name}: ${value}`, logType);

    // 대기 후 결과 처리
    setTimeout(() => processRoundResult(), config.timing.beforeRoundResult);
  }

  // ── 라운드 결과 처리 ─────────────────────────────────────

  async function processRoundResult() {
    flowState = STATE.PROCESSING_RESULT;
    overlay.setStatus('active', '결과 처리 중...');

    try {
      const result = engine.processRoundResult();
      if (!result) {
        alwaysLog('⚠️ processRoundResult가 null 반환 → 재시도 대기');
        flowState = STATE.IDLE;
        return;
      }

      // 결과 메시지 전송
      if (result.description) {
        await chat.sendMessage(result.description);
        overlay.addLog(result.description, getResultLogType(result));
      }

      // 상태 업데이트
      overlay.updateCombatState(engine.getState());

      // 동점 재굴림 처리
      if (result.needsReroll) {
        overlay.addLog('동점! 재굴림합니다.', 'warning');
        await delay(config.timing.beforeNextRound);
        // 라운드 번호를 증가시키지 않고 다시 굴림
        engine.round--; // incrementRound에서 다시 증가할 것이므로
        await startNextRound();
        return;
      }

      // 승리 확인
      if (engine.isVictory()) {
        await delay(config.timing.beforeVictory);
        await announceVictory();
        return;
      }

      // 다음 라운드
      await delay(config.timing.beforeNextRound);
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
    await chat.sendMessage(victoryMsg);

    overlay.addLog(victoryMsg, 'success');
    overlay.setStatus('idle', '전투 종료');

    // 상태 초기화
    flowState = STATE.IDLE;
    engine.reset();

    // 오버레이 상태 업데이트 (전투 종료 후에도 잠시 표시 유지)
    setTimeout(() => {
      overlay.updateCombatState(engine.getState());
    }, 5000);
  }

  // ── 타임아웃 처리 ────────────────────────────────────────

  function setResultTimeout(who) {
    clearTimeout(resultTimeoutId);
    resultTimeoutId = setTimeout(() => {
      log(`${who} 결과 타임아웃!`);
      overlay.addLog(`${who} 결과 대기 시간 초과. 재시도합니다...`, 'warning');

      // 재시도: 현재 상태에 따라 재굴림
      if (flowState === STATE.WAITING_ATTACKER_RESULT) {
        rollForAttacker();
      } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
        rollForDefender();
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
        engine.updateConfig(config);
        chat.updateConfig(config);
        overlay.updateConfig(config);
        sendResponse({ success: true });
        break;

      case 'BWBR_CANCEL_COMBAT':
        cancelCombat();
        sendResponse({ success: true });
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

  // ── 시작 ─────────────────────────────────────────────────

  // 페이지 로드 후 초기화
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', () => init());
  }

})();
