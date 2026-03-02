// ============================================================
// Ccofolia Extension - Popup 스크립트
// 설정 UI 로직: 로드, 저장, 내보내기/가져오기, 탭 전환
// ============================================================

(function () {
  'use strict';

  // ── 기본값 (content script의 BWBR_*_DEFAULTS와 동일한 구조) ──
  // popup에서는 content script에 접근할 수 없으므로 기본값을 여기에도 정의합니다.
  // 네임스페이스: CORE_DEFAULTS (범용) + COMBAT_DEFAULTS (전투 모듈)

  const CORE_DEFAULTS = {
    general: {
      enabled: true,
      manualMode: false,
      showBattleLog: false,
      autoComplete: true,
      autoConsumeActions: true,
      showVisitHistory: true,
      charShortcuts: true,
      autoScroll: true,
      showOverlay: true,
      debugMode: false,
      sfxVolume: 0.45,
      siteVolume: 1.0,
      betterSoundbar: true,
      language: 'ko'
    },
    selectors: {
      chatContainer: ['[class*="MuiList-root"]', '[class*="chat-log"]', '[class*="message-list"]', '[role="log"]', '[class*="scroll"]'],
      chatMessage: ['[class*="MuiListItem"]', '[class*="message"]', '[class*="chat-item"]'],
      messageText: ['[class*="MuiTypography"]', '[class*="text"]', '[class*="content"]', '[class*="body"]', 'p', 'span', 'div'],
      chatInput: ['textarea', 'input[type="text"]', '[contenteditable="true"]', '[class*="MuiInput"] textarea', '[class*="MuiInput"] input'],
      sendButton: ['button[type="submit"]', '[class*="send"]', '[aria-label*="send"]', '[aria-label*="전송"]']
    }
  };

  const COMBAT_DEFAULTS = {
    templates: {
      combatStart: '《합 개시》| ⚔️ {attacker} - {atkDice}/{atkCrit}/{atkFumble} | 🛡️ {defender} - {defDice}/{defCrit}/{defFumble}',
      roundHeader: '《{round}합》| ⚔️ {attacker} {atkDice} : 🛡️ {defender} {defDice} @{sound}',
      attackerRoll: '1D20 ⚔️ {attacker}',
      defenderRoll: '1D20 🛡️ {defender}',
      roundResultWin: '⚔️ {attacker}【{atkValue}】 vs 🛡️ {defender}【{defValue}】 → {winner} 승리!',
      roundResultCrit: '💥 {name} 대성공! 【{value}】 → 상대 주사위 파괴 & 주사위 +1',
      roundResultFumble: '💀 {name} 대실패! 【{value}】 → 자신 주사위 파괴 & 주사위 -1',
      roundResultBothCrit: '⚡ 쌍방 대성공! ⚔️【{atkValue}】 🛡️【{defValue}】 → 각자 주사위 +1',
      roundResultTie: '⚖️ 무승부! ⚔️【{atkValue}】 🛡️【{defValue}】 → 재굴림',
      victory: '《합 승리》\n{winnerIcon} {winner} @{sound}',
      combatCancel: '《합 중지》'
    },
    timing: {
      beforeFirstRoll: 700,
      betweenRolls: 700,
      beforeRoundResult: 700,
      beforeNextRound: 700,
      beforeVictory: 700,
      resultTimeout: 3000
    },
    sounds: {
      combatStartSounds: ['합'],
      roundHeaderSounds: ['후웅1', '후웅2', '후웅3', '후웅4'],
      resultNormalSounds: ['챙1', '챙2', '챙3'],
      resultSpecialSounds: ['챙4'],
      victorySounds: ['합'],
      battleStartSounds: [],
      turnStartSounds: [],
      actionConsumeSounds: ['발도1'],
      actionAddSounds: ['발도2'],
      battleEndSounds: []
    },
    rules: {
      diceType: 20,
      criticalValue: 20,
      fumbleValue: 1,
      criticalBonus: 1,
      fumblePenalty: 1,
      tieRule: 'reroll'
    },
    patterns: {
      triggerRegex: '《합\\s*개시》\\s*\\|?\\s*⚔\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?\\s*\\|?\\s*🛡\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?',
      diceResultRegex: '1[Dd]20[^0-9]*?[→＞>]\\s*(\\d+)',
      cancelRegex: '《합\\s*중지》'
    },
    traits: {}
  };

  // 런타임 병합 (하위 호환): 기존 코드가 DEFAULTS.templates, DEFAULTS.general 등으로 접근
  const DEFAULTS = Object.assign({},
    JSON.parse(JSON.stringify(CORE_DEFAULTS)),
    JSON.parse(JSON.stringify(COMBAT_DEFAULTS))
  );

  /** 코어 / 전투 네임스페이스 키 분류 */
  const CORE_KEYS = ['general', 'selectors'];
  const COMBAT_KEYS = ['templates', 'timing', 'sounds', 'rules', 'patterns', 'traits'];

  let currentConfig = null;

  // ── 초기화 ───────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    // 버전 표시 (manifest.json에서 자동으로 읽어옴)
    const manifest = chrome.runtime.getManifest();
    const versionEl = document.getElementById('header-version');
    if (versionEl) versionEl.textContent = 'v' + manifest.version;

    currentConfig = await loadConfig();
    populateUI(currentConfig);
    bindEvents();
    checkConnection();
    checkForUpdateUI();
    loadModules(); // 모듈 탭 초기화
  });

  // ── 설정 로드/저장 ───────────────────────────────────────

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

  function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['bwbr_core', 'bwbr_combat', 'bwbr_config'], (result) => {
        let coreData = result.bwbr_core;
        let combatData = result.bwbr_combat;

        // v1→v2 마이그레이션: 구 bwbr_config가 있고 새 키가 없으면 자동 변환
        if (result.bwbr_config && !coreData) {
          coreData = {};
          combatData = {};
          CORE_KEYS.forEach(k => { if (result.bwbr_config[k] !== undefined) coreData[k] = result.bwbr_config[k]; });
          COMBAT_KEYS.forEach(k => { if (result.bwbr_config[k] !== undefined) combatData[k] = result.bwbr_config[k]; });
          // 마이그레이션 저장 (비동기, 차단 안 함)
          chrome.storage.sync.set({ bwbr_core: coreData, bwbr_combat: combatData }, () => {
            chrome.storage.sync.remove('bwbr_config');
          });
        }

        if (coreData || combatData) {
          const mergedCore = deepMerge(CORE_DEFAULTS, coreData || {});
          const mergedCombat = deepMerge(COMBAT_DEFAULTS, combatData || {});
          const merged = Object.assign({}, mergedCore, mergedCombat);
          migrateSounds(merged.sounds);
          resolve(merged);
        } else {
          resolve(JSON.parse(JSON.stringify(DEFAULTS)));
        }
      });
    });
  }

  function saveConfig(config) {
    return new Promise((resolve) => {
      if (config === null) {
        // 초기화: 두 네임스페이스 키 모두 삭제
        chrome.storage.sync.remove(['bwbr_core', 'bwbr_combat', 'bwbr_config'], () => resolve());
        return;
      }
      // 네임스페이스별로 분리 저장
      const core = {};
      const combat = {};
      CORE_KEYS.forEach(k => { if (config[k] !== undefined) core[k] = config[k]; });
      COMBAT_KEYS.forEach(k => { if (config[k] !== undefined) combat[k] = config[k]; });
      chrome.storage.sync.set({ bwbr_core: core, bwbr_combat: combat }, () => resolve());
    });
  }

  function deepMerge(defaults, overrides) {
    const result = JSON.parse(JSON.stringify(defaults));
    for (const key of Object.keys(overrides)) {
      if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key]) && result[key] && typeof result[key] === 'object') {
        result[key] = deepMerge(result[key], overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }
    return result;
  }

  // ── UI ↔ 데이터 매핑 ────────────────────────────────────

  /** 설정 데이터로 UI 필드를 채웁니다 */
  function populateUI(cfg) {
    // 활성화
    $('toggle-enabled').checked = cfg.general.enabled;

    // 수동 모드
    $('toggle-manualMode').checked = cfg.general.manualMode || false;
    const hint = document.getElementById('manual-mode-hint');
    if (hint) hint.style.display = cfg.general.manualMode ? '' : 'none';

    // 전투 로그
    $('toggle-showBattleLog').checked = cfg.general.showBattleLog || false;

    // 자동완성
    $('toggle-autoComplete').checked = cfg.general.autoComplete !== false;

    // 행동 자동 소모
    $('toggle-autoConsumeActions').checked = cfg.general.autoConsumeActions !== false;

    // 방문 기록
    $('toggle-showVisitHistory').checked = cfg.general.showVisitHistory !== false;

    // 캐릭터 단축키
    $('toggle-charShortcuts').checked = cfg.general.charShortcuts !== false;

    // 맞춤법 검사 — 제거됨

    // 타이밍
    setTimingField('time-beforeFirstRoll', cfg.timing.beforeFirstRoll);
    setTimingField('time-betweenRolls', cfg.timing.betweenRolls);
    setTimingField('time-beforeRoundResult', cfg.timing.beforeRoundResult);
    setTimingField('time-beforeNextRound', cfg.timing.beforeNextRound);
    setTimingField('time-beforeVictory', cfg.timing.beforeVictory);
    setTimingField('time-resultTimeout', cfg.timing.resultTimeout);

    // 효과음 (코코포리아 컷인)
    renderTagList('sound-combatStart-list', cfg.sounds.combatStartSounds || ['합'], 'combatStartSounds');
    renderTagList('sound-roundHeader-list', cfg.sounds.roundHeaderSounds || [], 'roundHeaderSounds');
    renderTagList('sound-resultNormal-list', cfg.sounds.resultNormalSounds || [], 'resultNormalSounds');
    renderTagList('sound-resultSpecial-list', cfg.sounds.resultSpecialSounds || ['챙4'], 'resultSpecialSounds');
    renderTagList('sound-victory-list', cfg.sounds.victorySounds || ['합'], 'victorySounds');

    // 전투 보조 (턴제) 효과음
    renderTagList('sound-battleStart-list', cfg.sounds.battleStartSounds || [], 'battleStartSounds');
    renderTagList('sound-turnStart-list', cfg.sounds.turnStartSounds || [], 'turnStartSounds');
    renderTagList('sound-actionConsume-list', cfg.sounds.actionConsumeSounds || ['발도1'], 'actionConsumeSounds');
    renderTagList('sound-actionAdd-list', cfg.sounds.actionAddSounds || ['발도2'], 'actionAddSounds');
    renderTagList('sound-battleEnd-list', cfg.sounds.battleEndSounds || [], 'battleEndSounds');

    // 로컬 효과음 (커스텀 롤 사운드)
    loadCustomRollSounds();

    // 패턴
    $('pat-triggerRegex').value = cfg.patterns.triggerRegex;
    $('pat-diceResultRegex').value = cfg.patterns.diceResultRegex;
    $('pat-cancelRegex').value = cfg.patterns.cancelRegex;

    // 디버그 모드 (일반 탭 + 고급 탭 양쪽)
    $('toggle-debugMode').checked = cfg.general.debugMode;

    // 기타
    $('gen-autoScroll').checked = cfg.general.autoScroll;
    $('gen-showOverlay').checked = cfg.general.showOverlay;
    $('gen-debugMode').checked = cfg.general.debugMode;
    $('gen-sfxVolume').value = cfg.general.sfxVolume ?? 0.45;
    $('gen-sfxVolume-val').textContent = Math.round((cfg.general.sfxVolume ?? 0.45) * 100) + '%';
    $('toggle-betterSoundbar').checked = cfg.general.betterSoundbar !== false;
  }

  /** UI 필드에서 설정 데이터를 수집합니다 */
  function collectFromUI() {
    const cfg = JSON.parse(JSON.stringify(DEFAULTS));

    // 활성화
    cfg.general.enabled = $('toggle-enabled').checked;

    // 수동 모드
    cfg.general.manualMode = $('toggle-manualMode').checked;

    // 전투 로그
    cfg.general.showBattleLog = $('toggle-showBattleLog').checked;

    // 자동완성
    cfg.general.autoComplete = $('toggle-autoComplete').checked;

    // 행동 자동 소모
    cfg.general.autoConsumeActions = $('toggle-autoConsumeActions').checked;

    // 방문 기록
    cfg.general.showVisitHistory = $('toggle-showVisitHistory').checked;

    // 캐릭터 단축키
    cfg.general.charShortcuts = $('toggle-charShortcuts').checked;

    // 맞춤법 검사 — 제거됨

    // 타이밍
    cfg.timing.beforeFirstRoll = getTimingValue('time-beforeFirstRoll');
    cfg.timing.betweenRolls = getTimingValue('time-betweenRolls');
    cfg.timing.beforeRoundResult = getTimingValue('time-beforeRoundResult');
    cfg.timing.beforeNextRound = getTimingValue('time-beforeNextRound');
    cfg.timing.beforeVictory = getTimingValue('time-beforeVictory');
    cfg.timing.resultTimeout = getTimingValue('time-resultTimeout');

    // 효과음 (코코포리아 컷인)
    cfg.sounds.combatStartSounds = collectTags('sound-combatStart-list');
    cfg.sounds.roundHeaderSounds = collectTags('sound-roundHeader-list');
    cfg.sounds.resultNormalSounds = collectTags('sound-resultNormal-list');
    cfg.sounds.resultSpecialSounds = collectTags('sound-resultSpecial-list');
    cfg.sounds.victorySounds = collectTags('sound-victory-list');
    cfg.sounds.battleStartSounds = collectTags('sound-battleStart-list');
    cfg.sounds.turnStartSounds = collectTags('sound-turnStart-list');
    cfg.sounds.actionConsumeSounds = collectTags('sound-actionConsume-list');
    cfg.sounds.actionAddSounds = collectTags('sound-actionAdd-list');
    cfg.sounds.battleEndSounds = collectTags('sound-battleEnd-list');

    // 패턴
    cfg.patterns.triggerRegex = $('pat-triggerRegex').value;
    cfg.patterns.diceResultRegex = $('pat-diceResultRegex').value;
    cfg.patterns.cancelRegex = $('pat-cancelRegex').value;

    // 디버그 모드 (일반 탭 우선)
    cfg.general.debugMode = $('toggle-debugMode').checked;

    // 기타
    cfg.general.autoScroll = $('gen-autoScroll').checked;
    cfg.general.showOverlay = $('gen-showOverlay').checked;
    cfg.general.sfxVolume = parseFloat($('gen-sfxVolume').value) || 0.45;
    cfg.general.betterSoundbar = $('toggle-betterSoundbar').checked;

    return cfg;
  }

  // ── 이벤트 바인딩 ────────────────────────────────────────

  function bindEvents() {
    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 타이밍 슬라이더 ↔ 숫자 입력 동기화
    document.querySelectorAll('.field-range').forEach(range => {
      const numId = range.id + '-num';
      const numInput = $(numId);
      if (numInput) {
        range.addEventListener('input', () => { numInput.value = range.value; });
        numInput.addEventListener('input', () => { range.value = numInput.value; });
      }
    });

    // 효과음 볼륨 슬라이더 실시간 표시
    $('gen-sfxVolume').addEventListener('input', (e) => {
      $('gen-sfxVolume-val').textContent = Math.round(e.target.value * 100) + '%';
    });

    // 더 나은 사운드바 토글 (즉시 적용)
    $('toggle-betterSoundbar').addEventListener('change', (e) => {
      sendToContent({ type: 'BWBR_SET_BETTER_SOUNDBAR', betterSoundbar: e.target.checked });
    });

    // 디버그 모드 토글 양방향 동기화 (일반 탭 ↔ 고급 탭)
    $('toggle-debugMode').addEventListener('change', (e) => {
      $('gen-debugMode').checked = e.target.checked;
    });
    $('gen-debugMode').addEventListener('change', (e) => {
      $('toggle-debugMode').checked = e.target.checked;
    });

    // 활성화 토글
    $('toggle-enabled').addEventListener('change', (e) => {
      sendToContent({ type: 'BWBR_SET_ENABLED', enabled: e.target.checked });
    });

    // 수동 모드 토글
    $('toggle-manualMode').addEventListener('change', (e) => {
      const hint = document.getElementById('manual-mode-hint');
      if (hint) hint.style.display = e.target.checked ? '' : 'none';
      sendToContent({ type: 'BWBR_SET_MANUAL_MODE', manualMode: e.target.checked });
    });

    // 전투 로그 표시 토글 (즉시 적용)
    $('toggle-showBattleLog').addEventListener('change', (e) => {
      sendToContent({ type: 'BWBR_SET_SHOW_BATTLE_LOG', showBattleLog: e.target.checked });
    });

    // 자동완성 토글 (즉시 적용)
    $('toggle-autoComplete').addEventListener('change', (e) => {
      sendToContent({ type: 'BWBR_SET_AUTO_COMPLETE', autoComplete: e.target.checked });
    });

    // 행동 자동 소모 토글 (즉시 적용)
    $('toggle-autoConsumeActions').addEventListener('change', (e) => {
      sendToContent({ type: 'BWBR_SET_AUTO_CONSUME_ACTIONS', autoConsumeActions: e.target.checked });
    });

    // 코코포리아 컷인 효과음 태그 추가
    const soundTagConfigs = [
      { list: 'sound-combatStart-list', input: 'sound-combatStart-input', add: 'sound-combatStart-add', key: 'combatStartSounds' },
      { list: 'sound-roundHeader-list', input: 'sound-roundHeader-input', add: 'sound-roundHeader-add', key: 'roundHeaderSounds' },
      { list: 'sound-resultNormal-list', input: 'sound-resultNormal-input', add: 'sound-resultNormal-add', key: 'resultNormalSounds' },
      { list: 'sound-resultSpecial-list', input: 'sound-resultSpecial-input', add: 'sound-resultSpecial-add', key: 'resultSpecialSounds' },
      { list: 'sound-victory-list', input: 'sound-victory-input', add: 'sound-victory-add', key: 'victorySounds' },
      { list: 'sound-battleStart-list', input: 'sound-battleStart-input', add: 'sound-battleStart-add', key: 'battleStartSounds' },
      { list: 'sound-turnStart-list', input: 'sound-turnStart-input', add: 'sound-turnStart-add', key: 'turnStartSounds' },
      { list: 'sound-actionConsume-list', input: 'sound-actionConsume-input', add: 'sound-actionConsume-add', key: 'actionConsumeSounds' },
      { list: 'sound-actionAdd-list', input: 'sound-actionAdd-input', add: 'sound-actionAdd-add', key: 'actionAddSounds' },
      { list: 'sound-battleEnd-list', input: 'sound-battleEnd-input', add: 'sound-battleEnd-add', key: 'battleEndSounds' }
    ];
    soundTagConfigs.forEach(({ list, input, add, key }) => {
      $(add).addEventListener('click', () => addTag(list, input, key));
      $(input).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTag(list, input, key);
      });
    });

    // 로컬 효과음 파일 추가
    $('btn-add-roll-sound').addEventListener('click', () => {
      $('roll-sound-file').click();
    });
    $('roll-sound-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const name = file.name.replace(/\.[^.]+$/, '');
        const result = await chrome.storage.local.get('bwbr_custom_roll_sounds');
        const sounds = result.bwbr_custom_roll_sounds || [];
        if (sounds.some(s => s.name === name)) {
          showToast('같은 이름의 사운드가 이미 있습니다.', 'error');
          e.target.value = '';
          return;
        }
        sounds.push({ name, dataUrl, fileName: file.name });
        await chrome.storage.local.set({ bwbr_custom_roll_sounds: sounds });
        renderCustomRollSounds(sounds);
        showToast(`"${name}" 사운드가 추가되었습니다.`, 'success');
      } catch (err) {
        showToast('파일 읽기 오류: ' + err.message, 'error');
      }
      e.target.value = '';
    });

    // 저장
    $('btn-save').addEventListener('click', async () => {
      const cfg = collectFromUI();
      await saveConfig(cfg);
      currentConfig = cfg;
      sendToContent({ type: 'BWBR_UPDATE_CONFIG', config: cfg });
      showToast('설정이 저장되었습니다.', 'success');
    });

    // 초기화
    $('btn-reset').addEventListener('click', async () => {
      if (!confirm('모든 설정을 기본값으로 초기화하시겠습니까?')) return;
      currentConfig = JSON.parse(JSON.stringify(DEFAULTS));
      await saveConfig(null);  // null = 기본값 사용
      populateUI(currentConfig);
      sendToContent({ type: 'BWBR_UPDATE_CONFIG', config: currentConfig });
      showToast('설정이 초기화되었습니다.', 'success');
    });

    // 내보내기
    $('btn-export').addEventListener('click', () => {
      const cfg = collectFromUI();
      const json = JSON.stringify(cfg, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bwbr-config.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('설정을 내보냈습니다.', 'success');
    });

    // 가져오기
    $('btn-import').addEventListener('click', () => {
      $('import-file').click();
    });
    $('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const cfg = JSON.parse(text);
        currentConfig = deepMerge(DEFAULTS, cfg);
        populateUI(currentConfig);
        showToast('설정을 가져왔습니다. "저장"을 눌러 적용하세요.', 'success');
      } catch (err) {
        showToast('파일 파싱 오류: ' + err.message, 'error');
      }
      e.target.value = '';
    });
  }

  // ── 탭 전환 ──────────────────────────────────────────────

  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === 'tab-' + tabId);
    });
  }

  // ── 연결 상태 확인 ───────────────────────────────────────

  function checkConnection() {
    const dot = $('status-dot');
    const text = $('status-text');
    dot.className = 'status-dot checking';
    text.textContent = '확인 중...';

    sendToContent({ type: 'BWBR_GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        dot.className = 'status-dot disconnected';
        text.textContent = '미연결';
        return;
      }
      if (response.connected) {
        dot.className = 'status-dot connected';
        text.textContent = response.enabled ? '연결됨' : '비활성';
      } else {
        dot.className = 'status-dot disconnected';
        text.textContent = 'DOM 미탐색';
      }
    });
  }

  // ── content script 통신 ──────────────────────────────────

  function sendToContent(message, callback) {
    message.target = 'content';
    chrome.runtime.sendMessage(message, (response) => {
      if (callback) callback(response);
    });
  }

  // ── 태그 리스트 관리 ─────────────────────────────────────

  function renderTagList(listId, tags, dataKey) {
    const list = $(listId);
    list.innerHTML = '';
    tags.forEach((tag, i) => {
      const item = document.createElement('span');
      item.className = 'tag-item';
      item.innerHTML = `${escapeHtml(tag)}<span class="tag-remove" data-index="${i}" data-key="${dataKey}">×</span>`;
      item.querySelector('.tag-remove').addEventListener('click', (e) => {
        tags.splice(parseInt(e.target.dataset.index), 1);
        renderTagList(listId, tags, dataKey);
      });
      list.appendChild(item);
    });
  }

  function addTag(listId, inputId, dataKey) {
    const input = $(inputId);
    const value = input.value.trim();
    if (!value) return;

    // 현재 태그 수집
    const tags = collectTags(listId);
    if (tags.includes(value)) {
      showToast('이미 추가된 사운드입니다.', 'error');
      return;
    }
    tags.push(value);
    renderTagList(listId, tags, dataKey);
    input.value = '';
  }

  function collectTags(listId) {
    const list = $(listId);
    return Array.from(list.querySelectorAll('.tag-item')).map(item => {
      return item.textContent.replace('×', '').trim();
    });
  }

  // ── 타이밍 필드 헬퍼 ─────────────────────────────────────

  function setTimingField(baseId, value) {
    const range = $(baseId);
    const num = $(baseId + '-num');
    if (range) range.value = value;
    if (num) num.value = value;
  }

  function getTimingValue(baseId) {
    const num = $(baseId + '-num');
    return parseInt(num?.value) || 0;
  }

  // ── 유틸리티 ─────────────────────────────────────────────

  function $(id) {
    return document.getElementById(id);
  }

  function arrayToString(arr) {
    return Array.isArray(arr) ? arr.join(', ') : '';
  }

  function stringToArray(str) {
    return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message, type = '') {
    const toast = $('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
      toast.className = 'toast';
    }, 2500);
  }

  // ── 로컬 사운드 관리 ──────────────────────────────────────

  /** sounds/ 폴더의 기본 내장 사운드 파일 목록 */
  const BUILTIN_ROLL_SOUNDS = [
    'parry1', 'parry2', 'parry3', 'parry4', 'parry5', 'parry6',
    'hu-ung1', 'hu-ung2', 'hu-ung3', 'hu-ung4',
    'shield1', 'shield2', 'shield3',
    'jump'
  ];

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function loadCustomRollSounds() {
    const result = await chrome.storage.local.get('bwbr_custom_roll_sounds');
    renderCustomRollSounds(result.bwbr_custom_roll_sounds || []);
  }

  function renderCustomRollSounds(customs) {
    const list = $('local-roll-sounds-list');
    if (!list) return;
    list.innerHTML = '';

    // 기본 내장 사운드 (삭제 불가)
    BUILTIN_ROLL_SOUNDS.forEach(name => {
      const item = document.createElement('span');
      item.className = 'tag-item tag-builtin';
      item.textContent = name;
      list.appendChild(item);
    });

    // 커스텀 사운드 (삭제 가능)
    customs.forEach((s, i) => {
      const item = document.createElement('span');
      item.className = 'tag-item';
      item.innerHTML = `${escapeHtml(s.name)}<span class="tag-remove" data-index="${i}">×</span>`;
      item.querySelector('.tag-remove').addEventListener('click', async (e) => {
        customs.splice(parseInt(e.target.dataset.index), 1);
        await chrome.storage.local.set({ bwbr_custom_roll_sounds: customs });
        renderCustomRollSounds(customs);
        showToast('사운드가 삭제되었습니다.', 'success');
      });
      list.appendChild(item);
    });
  }

  // ── 업데이트 확인 UI ──────────────────────────────────────

  function checkForUpdateUI() {
    // 먼저 저장된 업데이트 정보 확인
    chrome.storage.local.get('bwbr_update', (result) => {
      if (result.bwbr_update && result.bwbr_update.available) {
        showUpdateBanner(result.bwbr_update);
      }
    });

    // background에 최신 확인 요청
    chrome.runtime.sendMessage({ type: 'BWBR_CHECK_UPDATE' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.available) {
        showUpdateBanner(response);
      } else if (response && response.isLatest) {
        const badge = $('header-latest-badge');
        if (badge) badge.style.display = 'inline';
      }
    });
  }

  function showUpdateBanner(updateInfo) {
    const banner = $('update-banner');
    const text = $('update-banner-text');
    if (!banner || !text) return;

    text.textContent = 'v' + updateInfo.remoteVersion + ' 업데이트 가능!';
    banner.style.display = '';
    banner.style.backgroundColor = '#ffab40'; // 주황색 배경 복구

    // 업데이트 버튼
    const btnUpdate = $('btn-update');
    if (btnUpdate) {
      btnUpdate.style.display = ''; // 버튼 다시 보이기
      btnUpdate.onclick = () => showUpdateModal(updateInfo);
    }

    // 닫기 버튼
    const btnDismiss = $('btn-update-dismiss');
    if (btnDismiss) {
      btnDismiss.onclick = () => {
        banner.style.display = 'none';
        chrome.runtime.sendMessage({ type: 'BWBR_DISMISS_UPDATE' });
      };
    }
  }

  function showUpdateModal(updateInfo) {
    const modal = $('update-modal');
    const versionInfo = $('update-version-info');
    if (!modal) return;

    if (versionInfo) {
      versionInfo.textContent = '현재 v' + updateInfo.localVersion + ' → 최신 v' + updateInfo.remoteVersion;
    }

    modal.style.display = '';

    // GitHub 페이지 열기
    const btnGithub = $('btn-open-github');
    if (btnGithub) {
      btnGithub.onclick = () => {
        chrome.tabs.create({ url: updateInfo.repoUrl || 'https://github.com/YUN582/branch-world-battle-advice' });
      };
    }

    // 모달 닫기
    const btnClose = $('btn-close-update-modal');
    if (btnClose) {
      btnClose.onclick = () => { modal.style.display = 'none'; };
    }

    // 오버레이 클릭으로도 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // ══════════════════════════════════════════════════════════
  //  모듈 관리
  // ══════════════════════════════════════════════════════════

  // 내장 모듈 경로 (module-loader.js와 동일)
  const BUILTIN_MODULE_PATHS = [
    'modules/branch-world/manifest.json',
    'modules/triggers/manifest.json'
  ];

  const MODULE_STORAGE_KEY = 'bwbr_modules';
  const USER_MODULES_KEY = 'bwbr_user_modules';

  // 모듈 매니페스트 필수 필드
  const REQUIRED_MODULE_FIELDS = ['id', 'name', 'version', 'type'];

  /**
   * 모듈 목록 로드 및 UI 렌더링
   */
  async function loadModules() {
    const container = document.getElementById('module-list');
    if (!container) return;

    try {
      // 1. 내장 모듈 JSON 로드
      const modules = [];
      for (const path of BUILTIN_MODULE_PATHS) {
        try {
          const url = chrome.runtime.getURL(path);
          const res = await fetch(url);
          if (res.ok) {
            const mod = await res.json();
            mod._path = path;
            mod._builtin = true;
            modules.push(mod);
          }
        } catch (e) {
          console.warn('[CE Popup] 모듈 로드 실패:', path, e);
        }
      }

      // 2. 사용자 모듈 로드 (chrome.storage.local)
      const userMods = await new Promise(resolve => {
        chrome.storage.local.get(USER_MODULES_KEY, result => {
          resolve((result && result[USER_MODULES_KEY]) || {});
        });
      });
      for (const id of Object.keys(userMods)) {
        try {
          const mod = JSON.parse(JSON.stringify(userMods[id]));
          // 내장 모듈과 중복 ID 방지
          if (modules.some(m => m.id === mod.id)) continue;
          mod._builtin = false;
          mod._user = true;
          modules.push(mod);
        } catch (e) {
          console.warn('[CE Popup] 사용자 모듈 파싱 오류:', id, e);
        }
      }

      // 3. 활성 상태 로드
      const enabledState = await new Promise(resolve => {
        chrome.storage.sync.get(MODULE_STORAGE_KEY, result => {
          resolve((result && result[MODULE_STORAGE_KEY]) || {});
        });
      });

      // 4. 렌더링
      renderModuleList(container, modules, enabledState);

    } catch (e) {
      container.innerHTML = '<div class="module-loading">모듈 목록을 불러올 수 없습니다.</div>';
      console.error('[CE Popup] 모듈 로드 오류:', e);
    }

    // 5. 가져오기 버튼 이벤트 바인딩
    setupModuleImport();
  }

  /**
   * 모듈 목록 UI 렌더링
   */
  function renderModuleList(container, modules, enabledState) {
    container.innerHTML = '';

    if (modules.length === 0) {
      container.innerHTML = '<div class="module-loading">설치된 모듈이 없습니다.</div>';
      return;
    }

    modules.forEach(mod => {
      const enabled = enabledState[mod.id] !== undefined ? enabledState[mod.id] : true;
      const isUser = !!mod._user;

      const card = document.createElement('div');
      card.className = 'module-card' + (enabled ? '' : ' disabled');

      const info = document.createElement('div');
      info.className = 'module-info';

      // 헤더 (이름 + 버전 + 타입 + 출처 배지)
      const header = document.createElement('div');
      header.className = 'module-header';

      const name = document.createElement('span');
      name.className = 'module-name';
      name.textContent = mod.name || mod.id;
      header.appendChild(name);

      if (mod.version) {
        const ver = document.createElement('span');
        ver.className = 'module-version';
        ver.textContent = 'v' + mod.version;
        header.appendChild(ver);
      }

      if (mod.type) {
        const type = document.createElement('span');
        type.className = 'module-type-badge';
        type.textContent = mod.type;
        header.appendChild(type);
      }

      // 내장/사용자 배지
      const originBadge = document.createElement('span');
      originBadge.className = 'module-origin-badge' + (isUser ? ' user' : ' builtin');
      originBadge.textContent = isUser ? '사용자' : '내장';
      header.appendChild(originBadge);

      info.appendChild(header);

      // 설명
      if (mod.description) {
        const desc = document.createElement('div');
        desc.className = 'module-desc';
        desc.textContent = mod.description;
        info.appendChild(desc);
      }

      // 작성자 + 태그 행
      const meta = document.createElement('div');
      meta.className = 'module-meta';

      if (mod.author) {
        const author = document.createElement('span');
        author.className = 'module-author';
        author.textContent = '👤 ' + mod.author;
        meta.appendChild(author);
      }

      if (mod.tags && mod.tags.length > 0) {
        mod.tags.forEach(t => {
          const tag = document.createElement('span');
          tag.className = 'module-tag';
          tag.textContent = t;
          meta.appendChild(tag);
        });
      }

      if (meta.childElementCount > 0) info.appendChild(meta);

      card.appendChild(info);

      // 액션 영역 (토글 + 내보내기/삭제 버튼)
      const actions = document.createElement('div');
      actions.className = 'module-actions';

      // 토글 스위치
      const toggle = document.createElement('div');
      toggle.className = 'module-toggle';
      const label = document.createElement('label');
      label.className = 'toggle-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = enabled;
      cb.addEventListener('change', () => {
        toggleModule(mod.id, cb.checked, enabledState, card);
      });
      const slider = document.createElement('span');
      slider.className = 'toggle-slider small';
      label.appendChild(cb);
      label.appendChild(slider);
      toggle.appendChild(label);
      actions.appendChild(toggle);

      // 버튼 행 (내보내기 + 삭제)
      const btnRow = document.createElement('div');
      btnRow.className = 'module-btn-row';

      // 내보내기 버튼
      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'btn-module-small';
      exportBtn.title = 'JSON 파일로 내보내기';
      exportBtn.textContent = '📤';
      exportBtn.addEventListener('click', () => exportModule(mod));
      btnRow.appendChild(exportBtn);

      // 사용자 모듈만 삭제 버튼 표시
      if (isUser) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn-module-small danger';
        deleteBtn.title = '모듈 삭제';
        deleteBtn.textContent = '🗑️';
        deleteBtn.addEventListener('click', () => removeModule(mod.id, enabledState));
        btnRow.appendChild(deleteBtn);
      }

      actions.appendChild(btnRow);
      card.appendChild(actions);

      container.appendChild(card);
    });
  }

  /**
   * 모듈 활성/비활성 토글
   */
  function toggleModule(id, enabled, enabledState, card) {
    enabledState[id] = enabled;
    card.classList.toggle('disabled', !enabled);

    // 저장
    const data = {};
    data[MODULE_STORAGE_KEY] = enabledState;
    chrome.storage.sync.set(data, () => {
      if (chrome.runtime.lastError) {
        console.warn('[CE Popup] 모듈 상태 저장 실패:', chrome.runtime.lastError.message);
        return;
      }
      showToast(enabled ? '모듈 활성화됨 — 새로고침 후 적용' : '모듈 비활성화됨 — 새로고침 후 적용');
    });
  }

  /**
   * 모듈 JSON 파일 내보내기
   */
  function exportModule(mod) {
    try {
      const clean = JSON.parse(JSON.stringify(mod));
      delete clean._builtin;
      delete clean._user;
      delete clean._path;
      const json = JSON.stringify(clean, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (mod.id || 'module') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('모듈 내보내기 완료: ' + a.download);
    } catch (e) {
      showToast('내보내기 실패: ' + e.message);
    }
  }

  /**
   * 사용자 모듈 삭제
   */
  async function removeModule(id, enabledState) {
    if (!confirm('모듈 "' + id + '"을(를) 삭제하시겠습니까?')) return;

    try {
      // storage.local에서 제거
      const store = await new Promise(resolve => {
        chrome.storage.local.get(USER_MODULES_KEY, result => {
          resolve((result && result[USER_MODULES_KEY]) || {});
        });
      });
      delete store[id];
      await new Promise(resolve => {
        const data = {};
        data[USER_MODULES_KEY] = store;
        chrome.storage.local.set(data, resolve);
      });

      // 활성 상태에서도 제거
      delete enabledState[id];
      await new Promise(resolve => {
        const data = {};
        data[MODULE_STORAGE_KEY] = enabledState;
        chrome.storage.sync.set(data, resolve);
      });

      showToast('모듈 삭제됨 — 새로고침 후 적용');
      loadModules(); // UI 새로고침
    } catch (e) {
      showToast('모듈 삭제 실패: ' + e.message);
    }
  }

  /**
   * 모듈 가져오기 (파일 입력) 설정
   */
  function setupModuleImport() {
    const importBtn = document.getElementById('btn-import-module');
    const fileInput = document.getElementById('module-file-input');
    if (!importBtn || !fileInput) return;

    // 이벤트 중복 방지
    if (importBtn._bound) return;
    importBtn._bound = true;

    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      fileInput.value = ''; // 동일 파일 재선택 허용

      try {
        const text = await file.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch (pe) {
          showToast('유효하지 않은 JSON 파일입니다.');
          return;
        }

        // 유효성 검증
        const errors = [];
        REQUIRED_MODULE_FIELDS.forEach(f => {
          if (!json[f]) errors.push('필수 필드 누락: ' + f);
        });
        if (json.id && !/^[a-zA-Z0-9_-]+$/.test(json.id)) {
          errors.push('모듈 ID는 영문, 숫자, 하이픈, 밑줄만 허용됩니다.');
        }
        if (json.type && json.type !== 'data') {
          errors.push('현재 "data" 타입만 가져올 수 있습니다.');
        }

        // 내장 모듈 ID 충돌 검사
        const builtinIds = [];
        for (const path of BUILTIN_MODULE_PATHS) {
          try {
            const res = await fetch(chrome.runtime.getURL(path));
            if (res.ok) {
              const m = await res.json();
              builtinIds.push(m.id);
            }
          } catch (_) { /* skip */ }
        }
        if (builtinIds.includes(json.id)) {
          errors.push('내장 모듈과 ID가 충돌합니다: ' + json.id);
        }

        if (errors.length > 0) {
          alert('모듈 검증 실패:\n\n' + errors.join('\n'));
          return;
        }

        // 기존 사용자 모듈과 중복 시 교체 확인
        const store = await new Promise(resolve => {
          chrome.storage.local.get(USER_MODULES_KEY, result => {
            resolve((result && result[USER_MODULES_KEY]) || {});
          });
        });
        if (store[json.id]) {
          if (!confirm('동일 ID의 모듈이 이미 존재합니다.\n기존 모듈을 교체하시겠습니까?')) return;
        }

        // 저장
        store[json.id] = json;
        await new Promise(resolve => {
          const data = {};
          data[USER_MODULES_KEY] = store;
          chrome.storage.local.set(data, resolve);
        });

        showToast('모듈 가져오기 완료: ' + (json.name || json.id) + ' — 새로고침 후 적용');
        loadModules(); // UI 새로고침

      } catch (e) {
        showToast('모듈 가져오기 실패: ' + e.message);
      }
    });
  }

})();
