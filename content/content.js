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
    SPECTATING: 'SPECTATING'
  };

  let config = null;        // 현재 설정
  let engine = null;        // BattleRollEngine
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

  // ── 초기화 ───────────────────────────────────────────────

  async function init() {
    alwaysLog('확장 프로그램 초기화 시작...');

    // 설정 로드
    config = await loadConfig();

    // 모듈 초기화
    engine = new window.BattleRollEngine(config);
    chat = new window.CocoforiaChatInterface(config);
    overlay = new window.BattleRollOverlay(config);
    overlay.preloadRollSounds();

    enabled = config.general.enabled;

    // 자동완성 초기화
    if (window.BWBR_AutoComplete) {
      window.BWBR_AutoComplete.setEnabled(config.general.autoComplete !== false);
    }

    // 패널 이벤트
    overlay.onCancel(() => cancelCombat());
    overlay.onPause(() => togglePause());
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

    // 채팅 관찰 시작 (주사위 결과 감지용)
    chat.observeChat(onNewMessage);

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

  // ── 사용자 입력 감지 (Enter 키) ───────────────────

  function onInputSubmit(text) {
    if (!enabled) return;
    // @ 컷인 명령은 무시 (절대 전투 트리거가 아님)
    if (text.startsWith('@')) return;
    log(`[입력 감지] "${text.substring(0, 80)}"`);  // 디버그 모드에서만

    if (flowState === STATE.IDLE) {
      checkForTrigger(text);
    }
    checkForCancel(text);
  }

  // ── 채팅 로그 메시지 처리 ───────────────────────

  function onNewMessage(text, element) {
    if (!enabled) return;

    alwaysLog(`[상태: ${flowState}] 메시지 수신: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

    switch (flowState) {
      case STATE.IDLE:
        // 합 개시 트리거는 입력 훅(onInputSubmit)에서 감지
        // 다른 사용자가 전송한 합 개시 메시지 → 관전 모드
        checkForSpectatorTrigger(text);
        checkForCancel(text);
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

  // ── 합 개시 트리거 감지 ──────────────────────────────────

  function checkForTrigger(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;

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

    if (flowState === STATE.SPECTATING) {
      endSpectating();
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

    flowState = STATE.IDLE;
    _stateBeforePause = null;
    engine.reset();
    overlay.addLog('전투가 중지되었습니다.', 'warning');
    overlay.setStatus('idle', '대기 중');
    overlay.updateCombatState(engine.getState());
  }

  // ── 관전 모드 ────────────────────────────────────────────

  function checkForSpectatorTrigger(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;
    startSpectating(triggerData);
  }

  function startSpectating(triggerData) {
    alwaysLog(`👁️ 관전 모드 시작! ⚔️${triggerData.attacker.name}(${triggerData.attacker.dice}) vs 🛡️${triggerData.defender.name}(${triggerData.defender.dice})`);

    engine.startCombat(triggerData.attacker, triggerData.defender);
    engine.round = 1;
    flowState = STATE.SPECTATING;
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
    if (!state?.combat) { endSpectating(); return; }

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
      endSpectating();
      return;
    }

    // 2. 합 승리 / 종료
    if (text.includes('《합 승리》') || text.includes('《합 종료》')) {
      const cleanText = text.replace(/@\S+/g, '').trim();
      if (text.includes('⚔')) overlay.playVictory('attacker');
      else if (text.includes('🛡')) overlay.playVictory('defender');
      overlay.addLog(cleanText, 'success');
      overlay.setStatus('idle', '전투 종료');
      setTimeout(() => endSpectating(), 5000);
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

  function endSpectating() {
    alwaysLog('👁️ 관전 모드 종료');
    flowState = STATE.IDLE;
    engine.reset();
    _spectatorDedup.clear();
    overlay.setSpectatorMode(false);
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
    await chat.sendMessage(headerMsg);

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

    // Pattern 1: "이름: 숫자" 또는 "이름： 숫자" (코코포리아 주사위 결과 표시)
    const p1 = new RegExp(nameEsc + '\\s*[：:]\\s*(\\d{1,2})');
    const m1 = text.match(p1);
    if (m1) {
      const v = parseInt(m1[1], 10);
      if (v >= 1 && v <= config.rules.diceType) return v;
    }

    // Pattern 2: "1D20 [이모지/이름] ... > 숫자" — 이름 또는 이모지가 1D20과 결과값 사이에 있어야 함
    const p2 = new RegExp('1[Dd]20[^>＞→]*(?:' + emojiEsc + '|' + nameEsc + ')[^>＞→]*[→＞>]\\s*(\\d{1,2})');
    const m2 = text.match(p2);
    if (m2) {
      const v = parseInt(m2[1], 10);
      if (v >= 1 && v <= config.rules.diceType) return v;
    }

    // Pattern 3: "[이모지/이름]... (1D20) > 숫자" — 이모지/이름이 1D20 앞에 나오는 패턴
    const p3 = new RegExp('(?:' + emojiEsc + '|' + nameEsc + ')[^>＞→]*\\(1[Dd]20\\)[^>＞→]*[→＞>]\\s*(\\d{1,2})');
    const m3 = text.match(p3);
    if (m3) {
      const v = parseInt(m3[1], 10);
      if (v >= 1 && v <= config.rules.diceType) return v;
    }

    // Pattern 4: "결과: 숫자" (이모지 또는 이름 포함 시 — fallback)
    if (text.includes(emoji) || text.includes(playerName)) {
      const m4 = text.match(/결과\s*[：:]\s*(\d{1,2})/);
      if (m4) {
        const v = parseInt(m4[1], 10);
        if (v >= 1 && v <= config.rules.diceType) return v;
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

    const logType = value >= state.combat.attacker.critThreshold ? 'crit'
      : value <= state.combat.attacker.fumbleThreshold ? 'fumble' : 'info';
    overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${value}`, logType);
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

    const logType = value >= state.combat.defender.critThreshold ? 'crit'
      : value <= state.combat.defender.fumbleThreshold ? 'fumble' : 'info';
    overlay.addLog(`🛡️ ${state.combat.defender.name}: ${value}`, logType);
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

      // 결과 메시지 전송
      if (result.description) {
        await chat.sendMessage(result.description);
        overlay.addLog(result.description, getResultLogType(result));
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
          if (chatMsg) await chat.sendMessage(chatMsg);
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
    await chat.sendMessage(victoryMsg);

    // 승리/패배 애니메이션
    if (winner === 'attacker' || winner === 'defender') {
      overlay.playVictory(winner);
    }

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
          await chat.sendMessage(`🔥 인간 특성 발동! | ${icon} ${playerName} 주사위 +1 @${snd}`);
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
