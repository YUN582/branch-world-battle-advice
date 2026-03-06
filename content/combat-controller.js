// ============================================================
// Ccofolia Extension - Combat Controller
// 가지세계 전투 모듈 — 합(合)/턴제/관전 모든 전투 로직
//
// content.js에서 추출된 [COMBAT] 코드를 하나의 모듈로 캡슐화합니다.
// 의존성은 init()에서 주입받고, window.BWBR_CombatController로 공개 API를 노출합니다.
// ============================================================

(function () {
  'use strict';

  // ── 상태 상수 ──────────────────────────────────────────────

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
    TURN_COMBAT: 'TURN_COMBAT'
  };

  // ── 의존성 (init에서 주입) ─────────────────────────────────

  let config;                    // 설정 객체 (content.js와 동일 참조)
  let chat;                      // CocoforiaChatInterface
  let _requestCharacterData;     // () => Promise<Character[]>
  let _awaitUserMessage;         // () => Promise<void>
  let _getSpeakerName;           // () => string|null
  let _log;                      // (msg) => void (디버그 로그)
  let _alwaysLog;                // (msg) => void (항상 출력 로그)

  // ── 엔진 인스턴스 ─────────────────────────────────────────

  let engine = null;             // BattleRollEngine (합 처리)
  let combatEngine = null;       // CombatEngine (전투 보조)
  let overlay = null;            // BattleRollOverlay

  // ── 전투 상태 변수 ─────────────────────────────────────────

  let flowState = STATE.IDLE;
  let resultTimeoutId = null;
  let paused = false;
  let _pauseRequested = false;
  let _stateBeforePause = null;
  let _spectatorAtkRollSeen = false;
  let _spectatorDefRollSeen = false;
  let _spectatorDedup = new Map();
  let _lastTurnAdvanceTime = 0;
  let _turnTrackingActive = false;
  let _characterCache = new Map();
  let _currentTrackedTurn = null;
  let _spectatorFromTurnCombat = false;
  let _spectatorStartTime = 0;
  let _activeCombatFromTurnCombat = false;
  let _statRefreshTimer = null;

  // ── 유틸리티 ──────────────────────────────────────────────

  function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 정규식 특수문자 이스케이프 */
  function _escRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── 초기화 ────────────────────────────────────────────────

  function init(deps) {
    config = deps.config;
    chat = deps.chat;
    _requestCharacterData = deps.requestCharacterData;
    _awaitUserMessage = deps.awaitUserMessage;
    _getSpeakerName = deps.getSpeakerName;
    _log = deps.log;
    _alwaysLog = deps.alwaysLog;

    // 엔진 인스턴스 생성
    engine = new window.BattleRollEngine(config);
    combatEngine = new window.CombatEngine(config);
    overlay = new window.BattleRollOverlay(config);
    overlay.preloadRollSounds();

    // 오버레이 콜백 연결
    overlay.onCancel(() => cancelCombat());
    overlay.onPause(() => togglePause());
    overlay.setActionClickCallback(async (type, index, action) => {
      const current = combatEngine.getState()?.currentCharacter;
      if (!current) return;
      const statLabel = type === 'main' ? '주 행동🔺' : '보조 행동🔹';
      const preStats = _extractActionStats(current);

      let result;
      if (action === 'use') {
        result = await _modifyCharStat(current.name, statLabel, '-', 1, true);
      } else if (action === 'restore') {
        result = await _modifyCharStat(current.name, statLabel, '+', 1, true);
      } else if (action === 'add') {
        result = await _modifyCharStat(current.name, statLabel, '+', 1, true);
      }

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

      _scheduleStatRefreshUI(100);
    });

    // 상태이상 +/- 버튼 콜백
    overlay.setStatusEffectCallback(async (label, action) => {
      const current = combatEngine.getState()?.currentCharacter;
      if (!current) return;

      let result;
      if (action === 'add') {
        result = await _modifyCharParam(current.name, label, '+', 1, true);
      } else if (action === 'remove') {
        result = await _modifyCharParam(current.name, label, '-', 1, true);
      }

      if (result && result.success) {
        const msg = `〔 ${current.name} 〕 ${label} : ${result.oldVal} → ${result.newVal}`;
        chat.sendSystemMessage(msg);
      }

      _scheduleStatRefreshUI(100);
    });

    overlay.setStatus(deps.enabled ? 'idle' : 'disabled', deps.enabled ? '대기 중' : '비활성');
  }

  // ── 효과음 헬퍼 ──────────────────────────────────────────

  function _pickCutin(soundsKey) {
    const arr = config?.sounds?.[soundsKey];
    if (!arr || arr.length === 0) return '';
    return ' @' + arr[Math.floor(Math.random() * arr.length)];
  }

  // ══════════════════════════════════════════════════════════
  // 전투 보조 시스템 (턴 관리)
  // ══════════════════════════════════════════════════════════

  async function checkForCombatAssistTrigger(text, skipActionConsume) {
    try {
    _alwaysLog(`[전투 보조] 트리거 체크 진입: flowState=${flowState}, text="${text.substring(0, 40)}"${skipActionConsume ? ' (행동소비 생략)' : ''}`);
    if (combatEngine.parseCombatStartTrigger(text)) {
      _log('[전투 보조] 전투개시 트리거 감지!');
      startCombatAssist();
      return;
    }

    if (combatEngine.parseCombatEndTrigger && combatEngine.parseCombatEndTrigger(text)) {
      endCombatAssist();
      return;
    }

    if (flowState === STATE.TURN_COMBAT && combatEngine.parseTurnEndTrigger(text)) {
      const now = Date.now();
      if (now - _lastTurnAdvanceTime < 1000) {
        _log('[전투 보조] 차례 종료 중복 감지 — 무시');
        return;
      }
      _lastTurnAdvanceTime = now;
      _log('[전투 보조] 차례종료 트리거 감지!');
      advanceTurn();
      return;
    }

    if (skipActionConsume) return;

    if (flowState === STATE.TURN_COMBAT) {
      const mainMatch = /《[^》]+》/.test(text);
      const subMatch = /【[^】]+】/.test(text);
      _alwaysLog(`[전투 보조] 패턴 검사: mainMatch(《》)=${mainMatch}, subMatch(【】)=${subMatch}`);

      if (mainMatch || subMatch) {
        const statLabel = mainMatch ? '주 행동🔺' : '보조 행동🔹';
        const emoji = mainMatch ? '🔺' : '🔹';
        const actionType = mainMatch ? '주' : '보조';

        // 전투 개시/종료/차례 종료 패턴은 위에서 이미 return됨
        // 여기 도달 = 일반 《》 또는 【】 패턴

        // 턴제에서는 항상 현재 차례 캐릭터에게 차감 (화자가 GM일 수 있으므로)
        const curChar = combatEngine.getState()?.currentCharacter;
        const targetName = curChar ? curChar.name : null;
        if (!targetName) {
          _alwaysLog(`[전투 보조] 현재 차례 캐릭터 없음 — 행동 소비 생략`);
          return;
        }

        _alwaysLog(`[전투 보조] ${actionType} 행동 소비 감지: 대상=${targetName} / 라벨="${statLabel}"`);

        await _awaitUserMessage();
        const result = await _modifyCharStat(targetName, statLabel, '-', 1, true);

        if (result && result.success) {
          let msg = `〔 ${emoji}${actionType} 행동 소비 〕`;
          msg += `\n[ ${targetName} ] ${statLabel} : ${result.oldVal} → ${result.newVal}`;
          chat.sendSystemMessage(msg);
          _scheduleStatRefreshUI();
        } else {
          _alwaysLog(`[전투 보조] 행동 소비 실패: ${result ? result.error : '타임아웃(null)'}`);
        }
      }
    }
    } catch (err) {
      _alwaysLog(`[전투 보조] checkForCombatAssistTrigger 예외: ${err.message}`);
      console.error('[전투 보조] 예외:', err);
    }
  }

  function _fetchCharStatsFromMain(name) {
    return BWBR_Bridge.request(
      'bwbr-get-char-stats', 'bwbr-char-stats-result', name,
      { sendAttr: 'data-bwbr-get-char-stats', recvAttr: 'data-bwbr-char-stats-result', timeout: 3000 }
    ).catch(() => null);
  }

  function processCombatAssistMessage(text, senderName) {
    if (flowState !== STATE.TURN_COMBAT) return;

    if (combatEngine.parseTurnEndTrigger(text)) {
      const now = Date.now();
      if (now - _lastTurnAdvanceTime < 1000) {
        _log('[전투 보조] 차례 종료 중복 감지 — 무시');
        return;
      }
      _lastTurnAdvanceTime = now;
      advanceTurn();
      return;
    }

    if (/[《〔].*행동\s*(소비|추가)[》〕]/.test(text) || /\]\s*주 행동🔺/.test(text) || /\]\s*보조 행동🔹/.test(text)) {
      _scheduleStatRefreshUI();
    }

    // 상태이상 변경 감지 → UI 갱신 (“[ 캐릭 ] 라벨 : old → new” 패턴)
    const effectDefs = config.statusEffects;
    if (effectDefs) {
      for (const label of Object.keys(effectDefs)) {
        if (text.includes(label)) {
          _scheduleStatRefreshUI(300);
          break;
        }
      }
    }
  }

  function _scheduleStatRefreshUI(ms) {
    clearTimeout(_statRefreshTimer);
    _statRefreshTimer = setTimeout(async () => {
      if (flowState !== STATE.TURN_COMBAT) return; // 합 전환 등으로 상태 변경 시 무시
      await _refreshCharacterOriginalData();
      await refreshTurnUI();
    }, ms != null ? ms : 800);
  }

  async function startCombatAssist() {
    _alwaysLog('🎲 전투 보조 모드 시작!');
    overlay.show();
    overlay.addLog('캐릭터 데이터 로딩 중...', 'info');

    const characters = await _requestCharacterData();
    if (!characters || characters.length === 0) {
      overlay.addLog('전투 보조 시작 실패 — 활성화된 캐릭터가 없습니다.', 'error');
      overlay.showToast('⚠️ 활성화된 캐릭터가 없습니다 — 맵에 캐릭터를 배치해주세요', 5000);
      overlay.setStatus('idle', '대기 중');
      return;
    }

    combatEngine.setCharacterData(characters);
    _doStartCombatAssist();
  }

  async function _doStartCombatAssist() {
    const result = combatEngine.startCombat();
    if (!result.success) {
      _alwaysLog(`전투 보조 시작 실패: ${result.message}`);
      overlay.show();
      overlay.addLog(`전투 보조 시작 실패 — ${result.message || '캐릭터 데이터를 찾을 수 없습니다.'}`, 'error');
      return;
    }

    flowState = STATE.TURN_COMBAT;
    overlay.show();
    overlay.addLog('🎲 전투 보조 모드 시작!', 'success');
    overlay.setStatus('active', '전투 보조 중');

    const state = combatEngine.getState();
    const turnOrder = state.turnOrder.map((c, i) =>
      `${i + 1}. ${c.name} (행동력: ${c.initiative})`
    ).join('\n');
    _log(`턴 순서:\n${turnOrder}`);

    await _resetAllActionStats('⚔️ 전투 개시');
    combatEngine.nextTurn();
    _saveTurnCombatState();
    await refreshTurnUI();
    sendTurnStartMessage();

    const startCutin = _pickCutin('battleStartSounds');
    if (startCutin) {
      chat.sendSystemMessage(startCutin);
    }
  }

  async function _resetAllActionStats(headerText) {
    await _modifyAllCharStat('취약💥', '=', 0, true);
    await _modifyAllCharStat('주 행동🔺', '=max', 0, true);
    await _modifyAllCharStat('보조 행동🔹', '=max', 0, true);

    let msg = `〔 ${headerText} 〕`;
    msg += `\n모든 캐릭터의 행동력이 초기화되었습니다.`;
    chat.sendSystemMessage(msg);
  }

  function advanceTurn() {
    if (flowState !== STATE.TURN_COMBAT) return;

    const nextChar = combatEngine.nextTurn();
    if (!nextChar) {
      _log('모든 캐릭터 턴 완료, 처음으로 돌아감');
    }
    sendTurnStartMessage();
  }

  // ── 스탯 변경 헬퍼 ────────────────────────────────────────

  function _modifyCharStat(characterName, statLabel, operation, value, silent) {
    const detail = {
      targetName: characterName,
      statusLabel: statLabel,
      operation: operation,
      value: value,
      valueType: 'value',
      silent: !!silent
    };
    return BWBR_Bridge.request(
      'bwbr-modify-status', 'bwbr-modify-status-result', detail,
      { sendAttr: 'data-bwbr-modify-status', recvAttr: 'data-bwbr-modify-status-result', timeout: 5000 }
    ).catch(() => null);
  }

  function _modifyAllCharStat(statLabel, operation, value, silent) {
    const detail = {
      statusLabel: statLabel,
      operation: operation,
      value: value,
      valueType: 'value',
      silent: !!silent
    };
    return BWBR_Bridge.request(
      'bwbr-modify-status-all', 'bwbr-modify-status-all-result', detail,
      { sendAttr: 'data-bwbr-modify-status-all', recvAttr: 'data-bwbr-modify-status-all-result', timeout: 5000 }
    ).catch(() => null);
  }

  // ── 파라미터 변경 헬퍼 (상태이상용) ───────────────────────

  function _modifyCharParam(characterName, paramLabel, operation, value, silent) {
    const detail = {
      targetName: characterName,
      paramLabel: paramLabel,
      operation: operation,
      value: value,
      silent: !!silent
    };
    return BWBR_Bridge.request(
      'bwbr-modify-param', 'bwbr-modify-param-result', detail,
      { sendAttr: 'data-bwbr-modify-param', recvAttr: 'data-bwbr-modify-param-result', timeout: 5000 }
    ).catch(() => null);
  }

  function _modifyAllCharParam(paramLabel, operation, value, silent) {
    const detail = {
      paramLabel: paramLabel,
      operation: operation,
      value: value,
      silent: !!silent
    };
    return BWBR_Bridge.request(
      'bwbr-modify-param-all', 'bwbr-modify-param-all-result', detail,
      { sendAttr: 'data-bwbr-modify-param-all', recvAttr: 'data-bwbr-modify-param-all-result', timeout: 5000 }
    ).catch(() => null);
  }

  // ── 상태이상 처리 ─────────────────────────────────────────

  /**
   * 현재 차례 캐릭터의 활성 상태이상을 읽고, 안내 메시지를 전송하고,
   * turnDecay/cc 계열을 자동 감소시킵니다.
   * @returns {Array} 활성 상태이상 배열 (UI 표시용)
   */
  async function _processStatusEffects() {
    const effectDefs = config.statusEffects;
    if (!effectDefs) return [];

    const state = combatEngine.getState();
    const current = state.currentCharacter;
    if (!current?.originalData?.params) return [];

    const charName = current.name;
    const activeEffects = combatEngine.getActiveStatusEffects(current.originalData, effectDefs);
    if (activeEffects.length === 0) return [];

    const activeLines = [];   // 유지되는 상태이상
    const expiredLines = [];  // 이번 차례에 해제되는 상태이상

    for (const effect of activeEffects) {
      const { label, value, def } = effect;
      const name = def.name || label;

      // ── 자동 감소 처리 & 해제 판정 ──
      let willExpire = false;

      if (def.type === 'turnDecay') {
        // 매 차례 -1 → value가 1이면 이번에 해제
        willExpire = (value <= 1);
        await _modifyCharParam(charName, label, '-', 1, true);
      } else if (def.type === 'cc') {
        const dur = combatEngine.getStatusDuration(charName, label);
        if (dur > 0) {
          const results = combatEngine.decrementStatusDurations(charName);
          const thisResult = results.find(r => r.label === label);
          if (thisResult?.expired) {
            willExpire = true;
            await _modifyCharParam(charName, label, '=', '0', true);
          }
        } else {
          // duration 미추적 → 1차례 CC
          willExpire = true;
          if (def.stacking) {
            await _modifyCharParam(charName, label, '=', '0', true);
          } else {
            await _modifyCharParam(charName, label, '-', 1, true);
          }
        }
      }
      // onHit: 자동 감소 없음

      // ── 메시지 생성 ──
      if (willExpire) {
        expiredLines.push(`❌ ${label} 해제`);
      } else {
        // desc에서 [name] 치환: 수량 문맥 → 숫자, 참조 문맥 → 라벨
        let desc = def.desc || '';
        const eName = _escRegex(name);
        const v = String(value);

        // 1) [name] 만큼 / [name]× → 숫자값
        desc = desc.replace(new RegExp('\\[' + eName + '\\](\s*만큼|×)', 'g'), v + '$1');
        // 2) -[name] (감산 문맥) → 숫자값
        desc = desc.replace(new RegExp('-\\[' + eName + '\\]', 'g'), '-' + v);
        // 3) 나머지 [name] → 라벨명 (화상🔥 등)
        desc = desc.replace(new RegExp('\\[' + eName + '\\]', 'g'), label);

        // CC 지속시간 문구 치환
        if (def.type === 'cc') {
          const dur = combatEngine.getStatusDuration(charName, label);
          if (dur > 1) {
            desc = desc.replace('다음 차례까지', `다음 ${dur}차례까지`);
          }
        }

        activeLines.push(`▫️${label} ${value}: ${desc}`);
      }
    }

    // 별도 시스템 메시지로 상태이상 안내
    const allLines = [...activeLines, ...expiredLines];
    if (allLines.length > 0) {
      const msg = `〔 ⚠️ ${charName} 상태이상 〕\n${allLines.join('\n')}`;
      chat.sendSystemMessage(msg);
    }

    // 상태 저장
    _saveTurnCombatState();

    return activeEffects;
  }

  /**
   * 전투 종료 시 모든 캐릭터의 상태이상 파라미터를 0으로 초기화합니다.
   */
  async function _resetAllStatusEffects() {
    const effectDefs = config.statusEffects;
    if (!effectDefs) return;

    for (const label of Object.keys(effectDefs)) {
      await _modifyAllCharParam(label, '=', '0', true);
    }
    combatEngine.clearAllStatusDurations();
    _log('[상태이상] 모든 캐릭터 상태이상 초기화 완료');
  }

  /**
   * 캐릭터의 활성 상태이상 배열을 반환합니다 (UI 표시용).
   * @param {object} charData - 캐릭터 originalData
   * @returns {Array<{label: string, value: number, def: object}>}
   */
  function _getActiveEffectsForUI(charData) {
    const effectDefs = config.statusEffects;
    if (!effectDefs) return [];
    return combatEngine.getActiveStatusEffects(charData, effectDefs);
  }

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

  async function _refreshCharacterOriginalData() {
    try {
      const characters = await _requestCharacterData();
      if (characters && characters.length > 0) {
        combatEngine.refreshOriginalData(characters);
      }
    } catch (e) {
      _alwaysLog(`[전투 보조] 캐릭터 데이터 갱신 실패: ${e.message}`);
    }
  }

  // ── 턴 전투 상태 영속성 (새로고침 복원) ────────────────────

  function _saveTurnCombatState() {
    if (flowState !== STATE.TURN_COMBAT) return;
    try {
      const data = combatEngine.serializeTurnCombat();
      if (data) {
        chrome.storage.session.set({ bwbr_turnCombat: data });
        _log('[턴 전투] 상태 저장됨');
      }
    } catch (e) {
      _alwaysLog(`[턴 전투] 상태 저장 실패: ${e.message}`);
    }
  }

  function _clearTurnCombatState() {
    try {
      chrome.storage.session.remove('bwbr_turnCombat');
      _log('[턴 전투] 저장된 상태 삭제');
    } catch (e) {
      // 무시
    }
  }

  async function _tryRestoreTurnCombat() {
    try {
      const result = await chrome.storage.session.get('bwbr_turnCombat');
      const data = result?.bwbr_turnCombat;
      if (!data) return false;

      if (data.savedAt && Date.now() - data.savedAt > 10 * 60 * 1000) {
        _alwaysLog('[턴 전투] 저장된 상태가 10분 초과 — 폐기');
        _clearTurnCombatState();
        return false;
      }

      const restored = combatEngine.restoreTurnCombat(data);
      if (!restored) {
        _alwaysLog('[턴 전투] 엔진 복원 실패');
        _clearTurnCombatState();
        return false;
      }

      await _refreshCharacterOriginalData();

      flowState = STATE.TURN_COMBAT;
      overlay.show();
      overlay.setStatus('active', '전투 보조 중');
      overlay.addLog('🔄 전투 보조 복원됨 (새로고침)', 'success');

      await refreshTurnUI();
      _retryRefreshIfMissingHP();

      _log('[턴 전투] 상태 복원 완료!');
      return true;
    } catch (e) {
      _alwaysLog(`[턴 전투] 복원 실패: ${e.message}`);
      return false;
    }
  }

  function _retryRefreshIfMissingHP() {
    const state = combatEngine.getState();
    const current = state.currentCharacter;
    if (!current) return;

    const { willValue } = _extractCharInfo(current);
    if (willValue !== null && willValue !== undefined) return;

    _log('[턴 전투] HP 데이터 없음 — 재시도 예약');
    let retries = 0;
    const maxRetries = 5;
    const timer = setInterval(async () => {
      retries++;
      try {
        await _refreshCharacterOriginalData();
        const { willValue: w } = _extractCharInfo(combatEngine.getState().currentCharacter);
        if (w !== null && w !== undefined) {
          _log(`[턴 전투] HP 데이터 획득 성공 (${retries}회차)`);
          await refreshTurnUI();
          clearInterval(timer);
        } else if (retries >= maxRetries) {
          _alwaysLog('[턴 전투] HP 데이터 재시도 한도 초과');
          clearInterval(timer);
        }
      } catch (e) {
        if (retries >= maxRetries) clearInterval(timer);
      }
    }, 2000);
  }

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

    await _refreshCharacterOriginalData();

    const { willValue, willMax, armorValue, aliasValue } = _extractCharInfo(current);
    const actionStats = _extractActionStats(current);
    const activeEffects = _getActiveEffectsForUI(current.originalData);

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
      subActionsMax: actionStats.subActionsMax,
      statusEffects: activeEffects
    });
  }

  async function sendTurnStartMessage() {
    await _awaitUserMessage();
    const state = combatEngine.getState();
    const current = state.currentCharacter;

    if (!current) {
      _log('현재 차례 캐릭터 없음');
      return;
    }

    const r1 = await _modifyCharStat(current.name, '주 행동🔺', '=max', 0, true);
    const r2 = await _modifyCharStat(current.name, '보조 행동🔹', '=max', 0, true);

    await _delay(400);
    await _refreshCharacterOriginalData();

    const { willValue, willMax, armorValue, aliasValue } = _extractCharInfo(current);
    const actionStats = _extractActionStats(current);

    let turnMsg = `〔 ${current.name}의 차례 〕`;
    turnMsg += `\n🔺주 행동 ${actionStats.mainActions}개, 🔹보조 행동 ${actionStats.subActions}개 | 이동거리 ${current.movement}`;
    const cutin = _pickCutin('turnStartSounds');
    if (cutin) turnMsg += cutin;

    _log(`턴 메시지: ${turnMsg}`);
    overlay.addLog(`🎯 ${current.name}의 차례`, 'success');

    // 차례 메시지를 먼저 전송
    chat.sendSystemMessage(turnMsg);

    // 상태이상 처리: 안내 + 자동 감소 (차례 메시지 뒤에)
    await _processStatusEffects();

    // 상태이상 처리 후 데이터 재로드
    await _delay(200);
    await _refreshCharacterOriginalData();
    const updatedEffects = _getActiveEffectsForUI(current.originalData);

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
      subActionsMax: actionStats.subActionsMax,
      statusEffects: updatedEffects
    });

    // 상태 저장
    _saveTurnCombatState();
  }

  async function endCombatAssist() {
    if (flowState !== STATE.TURN_COMBAT) return;

    _alwaysLog('🎲 전투 보조 모드 종료');

    await _resetAllActionStats('🏳️ 전투 종료');

    // 상태이상 초기화
    await _resetAllStatusEffects();

    const endCutin = _pickCutin('battleEndSounds');
    if (endCutin) {
      chat.sendSystemMessage(endCutin);
    }

    combatEngine.endCombat();
    flowState = STATE.IDLE;

    _clearTurnCombatState();

    overlay.updateTurnInfo(null);
    overlay.addLog('🎲 전투 보조 모드 종료', 'warning');
    overlay.setStatus('idle', '대기 중');
  }

  // ══════════════════════════════════════════════════════════
  // 전투 보조 관전 추적 (진행자가 아닌 사용자용)
  // ══════════════════════════════════════════════════════════

  async function processTurnCombatTracking(text) {
    if (combatEngine.parseCombatStartTrigger(text)) {
      _log('[관전 추적] 전투 개시 감지!');
      _turnTrackingActive = true;
      await updateCharacterCache();
      overlay.show();
      overlay.setTurnTrackingMode(true);
      overlay.addLog('👁️ 전투 관전 모드', 'info');
      overlay.setStatus('active', '👁 전투 관전 중');
      return;
    }

    if (combatEngine.parseCombatEndTrigger(text)) {
      if (_turnTrackingActive) {
        _log('[관전 추적] 전투 종료 감지');
        _turnTrackingActive = false;
        _currentTrackedTurn = null;
        overlay.setTurnTrackingMode(false);
        overlay.updateTurnInfo(null);
        overlay.addLog('전투 종료', 'warning');
        overlay.setStatus('idle', '대기 중');
      }
      return;
    }

    if (!_turnTrackingActive) return;

    const turnStart = combatEngine.parseTurnStartMessage(text);
    _log(`[관전 추적] 차례 시작 파싱 결과: ${JSON.stringify(turnStart)}`);
    if (turnStart) {
      _log(`[관전 추적] 차례 시작: ${turnStart.name}`);
      if (_characterCache.size === 0) {
        _log(`[관전 추적] 캐시 비어있음 - 업데이트 대기`);
        await updateCharacterCache();
      }
      _currentTrackedTurn = {
        ...turnStart,
        iconUrl: getCharacterIconUrl(turnStart.name)
      };
      updateTrackedTurnUI();
      return;
    }

    const actionConsumed = combatEngine.parseActionConsumedMessage(text);
    if (actionConsumed && _currentTrackedTurn) {
      _log(`[관전 추적] ${actionConsumed.actionType} 행동 소비: ${actionConsumed.name}`);
      if (_currentTrackedTurn.name === actionConsumed.name) {
        _currentTrackedTurn.mainActions = actionConsumed.mainActions;
        _currentTrackedTurn.subActions = actionConsumed.subActions;
        _currentTrackedTurn.movement = actionConsumed.movement;
        updateTrackedTurnUI();
      }
      return;
    }

    const actionAdded = combatEngine.parseActionAddedMessage(text);
    if (actionAdded && _currentTrackedTurn) {
      _log(`[관전 추적] ${actionAdded.actionType} 행동 추가: ${actionAdded.name}`);
      if (_currentTrackedTurn.name === actionAdded.name) {
        _currentTrackedTurn.mainActions = actionAdded.mainActions;
        _currentTrackedTurn.subActions = actionAdded.subActions;
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

  async function updateCharacterCache() {
    try {
      const characters = await _requestCharacterData();
      if (characters && characters.length > 0) {
        _characterCache.clear();
        for (const char of characters) {
          _characterCache.set(char.name, {
            iconUrl: char.iconUrl || null,
            params: char.params || [],
            status: char.status || []
          });
        }
        _log(`[관전 추적] 캐릭터 캐시 업데이트: ${_characterCache.size}명`);
      }
    } catch (e) {
      _alwaysLog(`[관전 추적] 캐릭터 캐시 업데이트 실패: ${e.message}`);
    }
  }

  function getCharacterIconUrl(name) {
    const cached = _characterCache.get(name);
    return cached?.iconUrl || null;
  }

  function updateTrackedTurnUI() {
    if (!_currentTrackedTurn) return;

    const cached = _characterCache.get(_currentTrackedTurn.name);
    let willValue = null, willMax = null, armorValue = null, aliasValue = null;

    if (cached) {
      const willStatus = cached.status?.find(s => s.label === '의지' || s.label?.includes('의지'));
      if (willStatus) {
        willValue = willStatus.value;
        willMax = willStatus.max;
      } else {
        const willParam = cached.params?.find(p => p.label === '의지' || p.label?.includes('의지'));
        if (willParam) { willValue = willParam.value; willMax = willParam.value; }
      }

      const armorStatus = cached.status?.find(s => s.label === '장갑' || s.label?.includes('장갑'));
      if (armorStatus) { armorValue = armorStatus.value; }
      else {
        const armorParam = cached.params?.find(p => p.label === '장갑' || p.label?.includes('장갑'));
        if (armorParam) armorValue = armorParam.value;
      }

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

  function checkForTrigger(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;

    _alwaysLog(`✅ 합 개시 감지! ⚔️${triggerData.attacker.name}(${triggerData.attacker.dice}) vs 🛡️${triggerData.defender.name}(${triggerData.defender.dice})`);

    if (flowState === STATE.TURN_COMBAT) {
      const currentChar = combatEngine.getState().currentCharacter;
      if (currentChar && currentChar.name === triggerData.attacker.name) {
        _modifyCharStat(currentChar.name, '주 행동🔺', '-', 1);
        _scheduleStatRefreshUI();
      }
    }

    if (flowState === STATE.TURN_COMBAT) {
      _activeCombatFromTurnCombat = true;
      _log('⚔️ 전투 보조 중 능동 합 시작 → 합 종료 후 전투 보조로 복귀 예정');
    } else if (_turnTrackingActive) {
      _activeCombatFromTurnCombat = true;
      _log('⚔️ 전투 관전 중 능동 합 시작 → 합 종료 후 관전 모드로 복귀 예정');
    } else {
      _activeCombatFromTurnCombat = false;
    }

    engine.startCombat(triggerData.attacker, triggerData.defender);
    flowState = STATE.COMBAT_STARTED;

    overlay.clearLog();
    overlay.addLog('전투 개시!', 'success');
    overlay.updateCombatState(engine.getState());
    overlay.setStatus('active', '전투 진행 중');

    startNextRound();
  }

  // ── 전투 중지 ──────────────────────────────────────────────

  function checkForCancel(text) {
    if (engine.parseCancelTrigger(text)) {
      cancelCombat();
    }
  }

  function cancelCombat() {
    if (_turnTrackingActive) {
      _alwaysLog('👁️ 관전 추적 수동 종료');
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

    _log('전투 중지');
    clearTimeout(resultTimeoutId);
    overlay.hideManualInput();
    overlay.hideH0Prompt();

    paused = false;
    _pauseRequested = false;
    overlay.setPaused(false);

    _stateBeforePause = null;
    engine.reset();
    overlay.addLog('전투가 중지되었습니다.', 'warning');

    if (_activeCombatFromTurnCombat && combatEngine && combatEngine.inCombat) {
      _activeCombatFromTurnCombat = false;
      setTimeout(() => {
        _log('⚔️ 합 중지 → 전투 보조 모드로 복귀');
        flowState = STATE.TURN_COMBAT;
        overlay.setStatus('active', '전투 보조 중');
        overlay.smoothTransition(() => refreshTurnUI());
      }, 4000);
      return;
    }

    if (_activeCombatFromTurnCombat && _turnTrackingActive) {
      _activeCombatFromTurnCombat = false;
      setTimeout(() => {
        _log('⚔️ 합 중지 → 전투 관전 모드로 복귀');
        flowState = STATE.IDLE;
        overlay.setTurnTrackingMode(true);
        overlay.setStatus('active', '👁 전투 관전 중');
        overlay.smoothTransition(() => updateTrackedTurnUI());
      }, 4000);
      return;
    }

    _activeCombatFromTurnCombat = false;
    flowState = STATE.IDLE;
    overlay.setStatus('idle', '대기 중');
    overlay.updateCombatState(engine.getState());
  }

  // ── 관전 모드 ──────────────────────────────────────────────

  function checkForSpectatorTrigger(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;
    startSpectating(triggerData, _turnTrackingActive);
  }

  function checkForSpectatorTriggerFromTurnCombat(text) {
    const triggerData = engine.parseTrigger(text);
    if (!triggerData) return;
    startSpectating(triggerData, true);
  }

  function startSpectating(triggerData, fromTurnCombat) {
    if (fromTurnCombat === undefined) fromTurnCombat = false;
    _alwaysLog(`👁️ 관전 모드 시작! ⚔️${triggerData.attacker.name}(${triggerData.attacker.dice}) vs 🛡️${triggerData.defender.name}(${triggerData.defender.dice})`);

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

  function processSpectatorMessage(text) {
    const state = engine.getState();
    if (!state?.combat) {
      if (_spectatorStartTime > 0 && Date.now() - _spectatorStartTime < 3000) {
        _log(`[SPEC] ⚠️ engine.combat=null but within 3s grace period — ignoring (text="${text.substring(0,50)}")`);
        return;
      }
      endSpectating('no_combat_state');
      return;
    }

    const now = Date.now();
    const dedupKey = text.substring(0, 80);
    if (_spectatorDedup.has(dedupKey) && now - _spectatorDedup.get(dedupKey) < 2000) return;
    _spectatorDedup.set(dedupKey, now);
    if (_spectatorDedup.size > 50) {
      for (const [k, t] of _spectatorDedup) { if (now - t > 5000) _spectatorDedup.delete(k); }
    }

    if (engine.parseCancelTrigger(text)) {
      overlay.addLog('전투가 중지되었습니다.', 'warning');
      endSpectating('cancel_trigger');
      return;
    }

    if (text.includes('《합 승리》') || text.includes('《합 종료》')) {
      const cleanText = text.replace(/@\S+/g, '').trim();
      if (text.includes('⚔')) overlay.playVictory('attacker');
      else if (text.includes('🛡')) overlay.playVictory('defender');
      overlay.addLog(cleanText, 'success');
      overlay.setStatus('idle', '전투 종료');
      setTimeout(() => endSpectating('victory_timeout'), 2000);
      return;
    }

    const roundMatch = text.match(/《(\d+)합》/);
    if (roundMatch) {
      const roundNum = parseInt(roundMatch[1], 10);
      engine.round = roundNum;

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

    const cleanText = text.replace(/@\S+/g, '').trim();

    if (text.includes('인간 특성 발동')) { overlay.addLog(cleanText, 'crit'); return; }
    if (text.includes('피로 새겨진 역사') && text.includes('초기화')) { overlay.addLog(cleanText, 'info'); return; }
    if (text.includes('피로 새겨진 역사')) { overlay.addLog(cleanText, 'warning'); return; }
    if (text.includes('인간 특성 초기화')) { overlay.addLog(cleanText, 'info'); return; }
    if (text.includes('연격') && text.includes('초기화')) { overlay.addLog(cleanText, 'info'); return; }
    if (text.includes('연격')) { overlay.addLog(cleanText, 'warning'); return; }
    if (text.includes('대성공') && (text.includes('→') || text.includes('파괴'))) { overlay.addLog(cleanText, 'crit'); return; }
    if (text.includes('대실패') && (text.includes('→') || text.includes('파괴'))) { overlay.addLog(cleanText, 'fumble'); return; }
    if (text.includes('쌍방')) { overlay.addLog(cleanText, text.includes('대성공') ? 'crit' : 'fumble'); return; }
    if (text.includes('무승부') || text.includes('재굴림')) { overlay.playTie(); overlay.addLog(cleanText, 'warning'); return; }
    if (text.includes('→') && text.includes('승리')) {
      // 승리 줄만 검사 (패자 줄에도 상대 아이콘이 있으므로 전체 텍스트 검사 불가)
      const winLine = text.split('\n').find(l => l.includes('→') && l.includes('승리'));
      if (winLine) {
        if (winLine.includes('⚔')) overlay.playRoundWin('attacker');
        else if (winLine.includes('🛡')) overlay.playRoundWin('defender');
      }
      overlay.addLog(cleanText, 'info');
      return;
    }
  }

  function endSpectating(reason) {
    if (reason === undefined) reason = 'unknown';
    _alwaysLog(`👁️ 관전 모드 종료 (reason=${reason}, flowState=${flowState})`);

    if (flowState !== STATE.SPECTATING) {
      _log(`👁️ endSpectating 무시: flowState=${flowState}`);
      return;
    }

    engine.reset();
    _spectatorDedup.clear();
    _spectatorStartTime = 0;
    overlay.setSpectatorMode(false);

    if (_spectatorFromTurnCombat && combatEngine && combatEngine.inCombat) {
      const wasFromTurn = true;
      _spectatorFromTurnCombat = false;
      // 결과 확인 시간 4초 후 전투 보조로 복귀
      setTimeout(() => {
        _log('👁️ 합 종료 → 전투 보조 모드로 복귀');
        flowState = STATE.TURN_COMBAT;
        overlay.addLog('합 종료 — 전투 보조 모드로 복귀', 'info');
        overlay.setStatus('active', '전투 보조 중');
        overlay.smoothTransition(() => refreshTurnUI());
      }, 4000);
      return;
    }

    if (_spectatorFromTurnCombat && _turnTrackingActive) {
      _spectatorFromTurnCombat = false;
      // 결과 확인 시간 4초 후 관전 모드로 복귀
      setTimeout(() => {
        _log('👁️ 합 종료 → 전투 관전 모드로 복귀');
        flowState = STATE.IDLE;
        overlay.setTurnTrackingMode(true);
        overlay.addLog('합 종료 — 전투 관전 모드로 복귀', 'info');
        overlay.setStatus('active', '👁 전투 관전 중');
        overlay.smoothTransition(() => updateTrackedTurnUI());
      }, 4000);
      return;
    }

    flowState = STATE.IDLE;
    _spectatorFromTurnCombat = false;
    overlay.addLog('관전 종료', 'info');
    overlay.setStatus('idle', '대기 중');
    setTimeout(() => overlay.updateCombatState(engine.getState()), 5000);
  }

  // ── 일시정지 / 재개 ──────────────────────────────────────

  function togglePause() {
    if (paused || _pauseRequested) {
      resumeCombat();
    } else {
      pauseCombat();
    }
  }

  function pauseCombat() {
    if (flowState === STATE.IDLE || flowState === STATE.COMBAT_END || flowState === STATE.SPECTATING || paused || _pauseRequested) return;

    if (flowState === STATE.WAITING_ATTACKER_RESULT || flowState === STATE.WAITING_DEFENDER_RESULT) {
      _applyPause();
      return;
    }

    _pauseRequested = true;
    _log('⏸ 일시정지 예약 (주사위 굴림 후 적용)');
    overlay.setPaused(true);
    overlay.setStatus('active', '주사위 굴림 후 일시정지...');
    overlay.addLog('주사위 굴림 후 일시정지됩니다.', 'warning');
  }

  function _applyPause() {
    paused = true;
    _pauseRequested = false;
    _stateBeforePause = flowState;
    flowState = STATE.PAUSED;
    clearTimeout(resultTimeoutId);

    _alwaysLog('⏸ 전투 일시정지');
    overlay.setPaused(true);
    overlay.setStatus('paused', '일시정지');
    overlay.addLog('전투가 일시정지되었습니다.', 'warning');
  }

  function resumeCombat() {
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

    _alwaysLog(`▶ 전투 재개 (복원: ${restoreState})`);
    overlay.setPaused(false);
    overlay.addLog('전투가 재개되었습니다.', 'success');

    flowState = restoreState;

    if (restoreState === STATE.WAITING_ATTACKER_RESULT || restoreState === STATE.WAITING_DEFENDER_RESULT) {
      _showManualInputNow(restoreState);
    } else {
      overlay.setStatus('active', '전투 진행 중');
    }
  }

  async function _showManualInputNow(waitingState) {
    const state = engine.getState();
    if (!state?.combat) return;

    let who, emoji, playerName;
    if (waitingState === STATE.WAITING_ATTACKER_RESULT) {
      who = '공격자'; emoji = '⚔️'; playerName = state.combat.attacker.name;
    } else {
      who = '방어자'; emoji = '🛡️'; playerName = state.combat.defender.name;
    }

    overlay.setStatus('waiting', `${who} 결과 입력 대기...`);
    overlay.addLog(`${who} 결과를 입력해주세요.`, 'warning');

    const manualValue = await overlay.showManualInput(who, emoji, playerName);
    if (manualValue === null) { _log('수동 입력: 취소됨'); return; }

    _log(`수동 입력 (재개): ${who} = ${manualValue}`);
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
    overlay.playClash();

    const headerMsg = engine.getRoundHeaderMessage();
    _log(`라운드 ${state.round} 헤더 전송`);
    overlay.addLog(`── 제 ${state.round}합 ──`, 'info');

    flowState = STATE.ROUND_HEADER_SENT;
    await chat.sendSystemMessage(headerMsg);

    await _delay(config.general.manualMode ? 0 : config.timing.beforeFirstRoll);
    rollForAttacker();
  }

  async function rollForAttacker() {
    flowState = STATE.WAITING_ATTACKER_RESULT;
    overlay.setStatus('waiting', '공격자 결과 대기 중...');

    if (config.general.manualMode) {
      _log('수동 모드: 공격자 주사위 결과 입력 대기');
      overlay.playParrySound();
      await processManualDiceInput('공격자');
    } else {
      const state = engine.getState();
      const bonus = engine.combat?.attacker?.n0Bonus || 0;
      const notation = bonus > 0 ? `1D${config.rules.diceType}+${bonus}` : `1D${config.rules.diceType}`;
      const charName = state.combat.attacker.name;
      const label = `⚔️ ${charName}`;
      _log(`공격자 주사위 굴림: ${notation} ${label} (${charName} 캐릭터로 직접 전송)`);

      chat.sendDiceAsCharacter(notation, label, charName);
      overlay.playParrySound();

      if (_pauseRequested) { _applyPause(); return; }
      if (flowState === STATE.WAITING_ATTACKER_RESULT) { setResultTimeout('공격자'); }
    }
  }

  function extractDiceValue(text, playerName, emoji) {
    const nameEsc = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emojiEsc = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const maxDiceVal = config.rules.diceType + 10;

    const p1 = new RegExp(nameEsc + '\\s*[：:]\\s*(\\d{1,2})');
    const m1 = text.match(p1);
    if (m1) { const v = parseInt(m1[1], 10); if (v >= 1 && v <= maxDiceVal) return v; }

    const p2 = new RegExp('1[Dd]20(?:\\+\\d+)?[^>＞→]*(?:' + emojiEsc + '|' + nameEsc + ')[^>＞→]*[→＞>]\\s*(\\d{1,2})');
    const m2 = text.match(p2);
    if (m2) { const v = parseInt(m2[1], 10); if (v >= 1 && v <= maxDiceVal) return v; }

    const p3 = new RegExp('(?:' + emojiEsc + '|' + nameEsc + ')[^>＞→]*\\(1[Dd]20(?:\\+\\d+)?\\)[^>＞→]*[→＞>]\\s*(\\d{1,2})');
    const m3 = text.match(p3);
    if (m3) { const v = parseInt(m3[1], 10); if (v >= 1 && v <= maxDiceVal) return v; }

    if (text.includes(emoji) || text.includes(playerName)) {
      const m4 = text.match(/결과\s*[：:]\s*(\d{1,2})/);
      if (m4) { const v = parseInt(m4[1], 10); if (v >= 1 && v <= maxDiceVal) return v; }
    }

    return null;
  }

  function checkForAttackerResult(text) {
    const state = engine.getState();
    if (!state?.combat) return;

    const value = extractDiceValue(text, state.combat.attacker.name, '⚔');
    if (value === null) return;

    flowState = STATE.PROCESSING_RESULT;
    clearTimeout(resultTimeoutId);
    overlay.hideManualInput();
    _log(`공격자 결과: ${value}`);
    engine.setAttackerRoll(value);

    const atkN0 = state.combat.attacker.n0Bonus || 0;
    const atkRaw = value - atkN0;
    const logType = atkRaw >= state.combat.attacker.critThreshold ? 'crit'
      : atkRaw <= state.combat.attacker.fumbleThreshold ? 'fumble' : 'info';
    overlay.addLog(`⚔️ ${state.combat.attacker.name}: ${value}${atkN0 > 0 ? ` (${atkRaw}+${atkN0})` : ''}`, logType);
    overlay.animateDiceValue('attacker', value);
    overlay.playAttack('attacker');
    if (logType === 'crit') overlay.playCrit('attacker');
    else if (logType === 'fumble') overlay.playFumble('attacker');

    setTimeout(() => rollForDefender(), config.timing.betweenRolls);
  }

  async function rollForDefender() {
    flowState = STATE.WAITING_DEFENDER_RESULT;
    overlay.setStatus('waiting', '방어자 결과 대기 중...');

    if (config.general.manualMode) {
      _log('수동 모드: 방어자 주사위 결과 입력 대기');
      overlay.playParrySound();
      await processManualDiceInput('방어자');
    } else {
      const state = engine.getState();
      const bonus = engine.combat?.defender?.n0Bonus || 0;
      const notation = bonus > 0 ? `1D${config.rules.diceType}+${bonus}` : `1D${config.rules.diceType}`;
      const charName = state.combat.defender.name;
      const label = `🛡️ ${charName}`;
      _log(`방어자 주사위 굴림: ${notation} ${label} (${charName} 캐릭터로 직접 전송)`);

      chat.sendDiceAsCharacter(notation, label, charName);
      overlay.playParrySound();

      if (_pauseRequested) { _applyPause(); return; }
      if (flowState === STATE.WAITING_DEFENDER_RESULT) { setResultTimeout('방어자'); }
    }
  }

  function checkForDefenderResult(text) {
    const state = engine.getState();
    if (!state?.combat) return;

    const value = extractDiceValue(text, state.combat.defender.name, '🛡');
    if (value === null) return;

    flowState = STATE.PROCESSING_RESULT;
    clearTimeout(resultTimeoutId);
    overlay.hideManualInput();
    _log(`방어자 결과: ${value}`);
    engine.setDefenderRoll(value);

    const defN0 = state.combat.defender.n0Bonus || 0;
    const defRaw = value - defN0;
    const logType = defRaw >= state.combat.defender.critThreshold ? 'crit'
      : defRaw <= state.combat.defender.fumbleThreshold ? 'fumble' : 'info';
    overlay.addLog(`🛡️ ${state.combat.defender.name}: ${value}${defN0 > 0 ? ` (${defRaw}+${defN0})` : ''}`, logType);
    overlay.animateDiceValue('defender', value);
    overlay.playAttack('defender');
    if (logType === 'crit') overlay.playCrit('defender');
    else if (logType === 'fumble') overlay.playFumble('defender');

    setTimeout(() => processRoundResult(), config.timing.beforeRoundResult);
  }

  // ── 라운드 결과 처리 ──────────────────────────────────────

  async function processRoundResult() {
    flowState = STATE.PROCESSING_RESULT;
    overlay.setStatus('active', '결과 처리 중...');

    try {
      const result = engine.processRoundResult(config.general.manualMode);
      if (!result) {
        _log('⚠️ processRoundResult: 이미 처리됨 (중복 호출 무시)');
        return;
      }

      if (result.description) {
        overlay.addLog(result.description, getResultLogType(result));

        const soundTagMatch = result.description.match(/ (@\S+)\s*$/);
        const soundTag = soundTagMatch ? ' ' + soundTagMatch[1] : '';

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

          await chat.sendSystemMessage(winMsg + '\n' + loseMsg + soundTag);
        } else {
          await chat.sendSystemMessage(result.description);
        }
      }

      let manualH0ExtraRound = false;
      const traitChatLines = [];
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
          else if (te.trait === 'N0' && te.event === 'stack') {
            logMsg = `⚡ ${te.name}: 연격! 다음 판정 보너스 +${te.bonus}`;
            chatMsg = `⚡ 연격 | ${icon} ${te.name} 다음 판정 +${te.bonus}`;
            logType = 'warning';
          } else if (te.trait === 'N0' && te.event === 'reset') {
            logMsg = `⚡ ${te.name}: 연격 보너스 초기화`;
            chatMsg = `⚡ 연격 초기화 | ${icon} ${te.name}`;
          }
          else if (te.event === 'h0_available') {
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
          else if (te.event === 'h40_h0_available') {
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
        if (traitChatLines.length > 0) {
          await chat.sendSystemMessage(traitChatLines.join('\n'));
        }
      }

      overlay.updateCombatState(engine.getState());

      if (result.type === 'tie') { overlay.playTie(); }
      else if (result.winner) { overlay.playRoundWin(result.winner); }

      if (result.needsReroll) {
        overlay.addLog('동점! 재굴림합니다.', 'warning');
        await _delay(config.general.manualMode ? 0 : config.timing.beforeNextRound);
        await startNextRound();
        return;
      }

      if (manualH0ExtraRound || result.traitEvents?.some(te => (te.trait === 'H40' || te.trait === 'H400') && te.event === 'h0_extra_round')) {
        overlay.addLog('인간 특성 발동! 추가 합 진행...', 'crit');
        await _delay(config.general.manualMode ? 0 : config.timing.beforeNextRound);
        await startNextRound();
        return;
      }

      if (engine.isVictory()) {
        await _delay(config.general.manualMode ? 0 : config.timing.beforeVictory);
        await announceVictory();
        return;
      }

      await _delay(config.general.manualMode ? 0 : config.timing.beforeNextRound);
      await startNextRound();

    } catch (e) {
      console.error('[Branch] 결과 처리 오류:', e);
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

  // ── 승리 선언 ──────────────────────────────────────────────

  async function announceVictory() {
    flowState = STATE.COMBAT_END;
    const victoryMsg = engine.getVictoryMessage();
    const winner = engine.getWinner();

    _log(`전투 종료! 승자: ${winner}`);
    await chat.sendSystemMessage(victoryMsg);

    if (winner === 'attacker' || winner === 'defender') {
      overlay.playVictory(winner);
    }

    overlay.addLog(victoryMsg, 'success');
    overlay.setStatus('idle', '전투 종료');
    engine.reset();

    if (_activeCombatFromTurnCombat && combatEngine && combatEngine.inCombat) {
      _activeCombatFromTurnCombat = false;
      // 결과 확인 시간 4초 후 전투 보조로 복귀
      setTimeout(() => {
        _log('⚔️ 합 종료 → 전투 보조 모드로 복귀');
        flowState = STATE.TURN_COMBAT;
        overlay.addLog('합 종료 — 전투 보조 모드로 복귀', 'info');
        overlay.setStatus('active', '전투 보조 중');
        overlay.smoothTransition(() => refreshTurnUI());
      }, 4000);
      return;
    }

    if (_activeCombatFromTurnCombat && _turnTrackingActive) {
      _activeCombatFromTurnCombat = false;
      // 결과 확인 시간 4초 후 관전 모드로 복귀
      setTimeout(() => {
        _log('⚔️ 합 종료 → 전투 관전 모드로 복귀');
        flowState = STATE.IDLE;
        overlay.setTurnTrackingMode(true);
        overlay.addLog('합 종료 — 전투 관전 모드로 복귀', 'info');
        overlay.setStatus('active', '👁 전투 관전 중');
        overlay.smoothTransition(() => updateTrackedTurnUI());
      }, 4000);
      return;
    }

    _activeCombatFromTurnCombat = false;
    flowState = STATE.IDLE;

    setTimeout(() => { overlay.updateCombatState(engine.getState()); }, 5000);
  }

  // ── 수동 모드: 주사위 결과 직접 입력 ──────────────────────

  async function processManualDiceInput(who) {
    const state = engine.getState();
    if (!state?.combat) return;

    let emoji, playerName, whoKey;
    if (flowState === STATE.WAITING_ATTACKER_RESULT) {
      emoji = '⚔️'; playerName = state.combat.attacker.name; whoKey = 'attacker';
    } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
      emoji = '🛡️'; playerName = state.combat.defender.name; whoKey = 'defender';
    } else { return; }

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
        continue;
      }
      break;
    }

    if (manualValue === null) { _log('수동 입력: 취소됨 (전투 중지)'); return; }

    _log(`수동 입력: ${who} = ${manualValue}`);
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

  // ── 타임아웃 → 수동 입력 요청 ────────────────────────────

  function setResultTimeout(who) {
    clearTimeout(resultTimeoutId);
    const expectedRound = engine.round;
    resultTimeoutId = setTimeout(async () => {
      if (engine.round !== expectedRound) {
        _log(`${who} 타임아웃 무시 (라운드 변경: ${expectedRound} → ${engine.round})`);
        return;
      }

      _log(`${who} 결과 타임아웃 → 수동 입력 요청`);
      overlay.addLog(`${who} 결과를 자동 인식하지 못했습니다. 도우미에 직접 입력해주세요.`, 'warning');

      const state = engine.getState();
      if (!state?.combat) return;

      let emoji, playerName;
      if (flowState === STATE.WAITING_ATTACKER_RESULT) {
        emoji = '⚔️'; playerName = state.combat.attacker.name;
      } else if (flowState === STATE.WAITING_DEFENDER_RESULT) {
        emoji = '🛡️'; playerName = state.combat.defender.name;
      } else { return; }

      const manualValue = await overlay.showManualInput(who, emoji, playerName);
      if (manualValue === null) { _log('수동 입력: 취소됨 (채팅 인식 또는 중지)'); return; }

      _log(`수동 입력: ${who} = ${manualValue}`);
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

  // ── 설정/상태 관리 (content.js에서 호출) ──────────────────

  function updateConfig(newConfig) {
    config = newConfig;
    engine.updateConfig(config);
    overlay.updateConfig(config);
  }

  function setEnabled(enabled) {
    overlay.setStatus(enabled ? 'idle' : 'disabled', enabled ? '대기 중' : '비활성');
  }

  function setManualMode(mode) {
    config.general.manualMode = mode;
    _alwaysLog(`수동 모드 ${mode ? '활성화' : '비활성화'}`);
    overlay.addLog(`수동 모드 ${mode ? 'ON' : 'OFF'}`, 'info');
  }

  function setShowBattleLog(show) {
    config.general.showBattleLog = show;
    overlay.updateConfig(config);
    _alwaysLog(`전투 로그 ${show ? '표시' : '숨김'}`);
  }

  function setAutoConsumeActions(val) {
    config.general.autoConsumeActions = val;
    _alwaysLog(`행동 자동 소모 ${val ? '활성화' : '비활성화'}`);
    overlay.addLog(`행동 자동 소모 ${val ? 'ON' : 'OFF'}`, 'info');
  }

  // ── 메시지 분배 (onNewMessage에서 호출) ────────────────────

  function handleNewMessage(text, element, senderName) {
    // 전투 보조 관전 추적 (전투 진행자가 아닌 경우)
    if (flowState !== STATE.TURN_COMBAT) {
      processTurnCombatTracking(text).catch(e => {
        _alwaysLog(`[관전 추적] 에러: ${e.message}`);
      });
    }

    switch (flowState) {
      case STATE.IDLE:
        checkForSpectatorTrigger(text);
        checkForCancel(text);
        break;

      case STATE.TURN_COMBAT:
        processCombatAssistMessage(text, senderName);
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
        checkForCancel(text);
        break;

      default:
        checkForCancel(text);
        break;
    }
  }

  // ══════════════════════════════════════════════════════════
  // 공개 API
  // ══════════════════════════════════════════════════════════

  window.BWBR_CombatController = {
    STATE: STATE,
    init: init,

    // 상태 조회
    getFlowState: function () { return flowState; },
    getOverlay: function () { return overlay; },
    getEngine: function () { return engine; },
    getCombatEngine: function () { return combatEngine; },
    getPaused: function () { return paused; },

    // 입력/메시지 핸들러 (content.js 디스패처에서 호출)
    checkForCombatAssistTrigger: checkForCombatAssistTrigger,
    checkForTrigger: checkForTrigger,
    checkForCancel: checkForCancel,
    handleNewMessage: handleNewMessage,

    // 전투 제어
    cancelCombat: cancelCombat,
    togglePause: togglePause,
    tryRestore: function () { return _tryRestoreTurnCombat(); },

    // 설정/상태 관리
    updateConfig: updateConfig,
    setEnabled: setEnabled,
    setManualMode: setManualMode,
    setShowBattleLog: setShowBattleLog,
    setAutoConsumeActions: setAutoConsumeActions
  };

})();
