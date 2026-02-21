// ============================================================
// Branch World Battle Roll - Popup 스크립트
// 설정 UI 로직: 로드, 저장, 내보내기/가져오기, 탭 전환
// ============================================================

(function () {
  'use strict';

  // ── 기본값 (content script의 BWBR_DEFAULTS와 동일한 구조) ───
  // popup에서는 content script에 접근할 수 없으므로 기본값을 여기에도 정의합니다.

  const DEFAULTS = {
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
      victorySounds: ['합']
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
    selectors: {
      chatContainer: ['[class*="MuiList-root"]', '[class*="chat-log"]', '[class*="message-list"]', '[role="log"]', '[class*="scroll"]'],
      chatMessage: ['[class*="MuiListItem"]', '[class*="message"]', '[class*="chat-item"]'],
      messageText: ['[class*="MuiTypography"]', '[class*="text"]', '[class*="content"]', '[class*="body"]', 'p', 'span', 'div'],
      chatInput: ['textarea', 'input[type="text"]', '[contenteditable="true"]', '[class*="MuiInput"] textarea', '[class*="MuiInput"] input'],
      sendButton: ['button[type="submit"]', '[class*="send"]', '[aria-label*="send"]', '[aria-label*="전송"]']
    },
    general: {
      enabled: true,
      manualMode: false,
      showBattleLog: false,
      autoComplete: true,
      autoConsumeActions: true,
      autoScroll: true,
      showOverlay: true,
      debugMode: false,
      sfxVolume: 0.45,
      siteVolume: 1.0,
      language: 'ko'
    }
  };

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
      chrome.storage.sync.get('bwbr_config', (result) => {
        if (result.bwbr_config) {
          const merged = deepMerge(DEFAULTS, result.bwbr_config);
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
      chrome.storage.sync.set({ bwbr_config: config }, () => {
        resolve();
      });
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

    // 로컬 효과음 (커스텀 롤 사운드)
    loadCustomRollSounds();

    // 패턴
    $('pat-triggerRegex').value = cfg.patterns.triggerRegex;
    $('pat-diceResultRegex').value = cfg.patterns.diceResultRegex;
    $('pat-cancelRegex').value = cfg.patterns.cancelRegex;

    // 기타
    $('gen-autoScroll').checked = cfg.general.autoScroll;
    $('gen-showOverlay').checked = cfg.general.showOverlay;
    $('gen-debugMode').checked = cfg.general.debugMode;
    $('gen-sfxVolume').value = cfg.general.sfxVolume ?? 0.45;
    $('gen-sfxVolume-val').textContent = Math.round((cfg.general.sfxVolume ?? 0.45) * 100) + '%';
    $('gen-siteVolume').value = cfg.general.siteVolume ?? 1.0;
    $('gen-siteVolume-val').textContent = Math.round((cfg.general.siteVolume ?? 1.0) * 100) + '%';
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

    // 패턴
    cfg.patterns.triggerRegex = $('pat-triggerRegex').value;
    cfg.patterns.diceResultRegex = $('pat-diceResultRegex').value;
    cfg.patterns.cancelRegex = $('pat-cancelRegex').value;

    // 기타
    cfg.general.autoScroll = $('gen-autoScroll').checked;
    cfg.general.showOverlay = $('gen-showOverlay').checked;
    cfg.general.debugMode = $('gen-debugMode').checked;
    cfg.general.sfxVolume = parseFloat($('gen-sfxVolume').value) || 0.45;
    cfg.general.siteVolume = parseFloat($('gen-siteVolume').value) ?? 1.0;

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

    // 코코포리아 음량 슬라이더 실시간 표시 + 즉시 적용
    $('gen-siteVolume').addEventListener('input', (e) => {
      $('gen-siteVolume-val').textContent = Math.round(e.target.value * 100) + '%';
      sendToContent({ type: 'BWBR_SET_SITE_VOLUME', volume: parseFloat(e.target.value) });
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
      { list: 'sound-victory-list', input: 'sound-victory-input', add: 'sound-victory-add', key: 'victorySounds' }
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

})();
