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
      roundHeader: '《{round}합》\n⚔️ {attacker} {atkDice} : 🛡️ {defender} {defDice}',
      attackerRoll: '1D20 ⚔️ {attacker} @{sound}',
      defenderRoll: '1D20 🛡️ {defender} @{sound}',
      roundResultWin: '⚔️ {attacker}【{atkValue}】 vs 🛡️ {defender}【{defValue}】 → {winner} 승리!',
      roundResultCrit: '💥 {name} 대성공! 【{value}】 → 상대 주사위 파괴 & 주사위 +1',
      roundResultFumble: '💀 {name} 대실패! 【{value}】 → 자신 주사위 파괴 & 주사위 -1',
      roundResultBothCrit: '⚡ 쌍방 대성공! ⚔️【{atkValue}】 🛡️【{defValue}】 → 각자 주사위 +1',
      roundResultTie: '⚖️ 무승부! ⚔️【{atkValue}】 🛡️【{defValue}】 → 재굴림',
      victory: '《합 승리》- {winnerIcon} {winner} @합',
      combatCancel: '《합 중지》'
    },
    timing: {
      beforeFirstRoll: 1000,
      betweenRolls: 600,
      beforeRoundResult: 600,
      beforeNextRound: 1000,
      beforeVictory: 1000,
      resultTimeout: 10000
    },
    sounds: {
      combatStartSound: '합',
      roundHeaderSounds: ['후웅1', '후웅2', '후웅3', '후웅4'],
      resultNormalSounds: ['챙1', '챙2', '챙3'],
      resultSpecialSound: '챙4',
      victorySound: '합'
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
      triggerRegex: '《합\\s*개시》\\s*\\|?\\s*⚔\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)\\s*\\|?\\s*🛡\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)',
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
      autoScroll: true,
      showOverlay: true,
      debugMode: false,
      language: 'ko'
    }
  };

  let currentConfig = null;

  // ── 초기화 ───────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    currentConfig = await loadConfig();
    populateUI(currentConfig);
    bindEvents();
    checkConnection();
  });

  // ── 설정 로드/저장 ───────────────────────────────────────

  function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('bwbr_config', (result) => {
        if (result.bwbr_config) {
          resolve(deepMerge(DEFAULTS, result.bwbr_config));
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

    // 메시지 템플릿
    $('tpl-roundHeader').value = cfg.templates.roundHeader;
    $('tpl-attackerRoll').value = cfg.templates.attackerRoll;
    $('tpl-defenderRoll').value = cfg.templates.defenderRoll;
    $('tpl-roundResultWin').value = cfg.templates.roundResultWin;
    $('tpl-roundResultCrit').value = cfg.templates.roundResultCrit;
    $('tpl-roundResultFumble').value = cfg.templates.roundResultFumble;
    $('tpl-roundResultBothCrit').value = cfg.templates.roundResultBothCrit;
    $('tpl-roundResultTie').value = cfg.templates.roundResultTie;
    $('tpl-victory').value = cfg.templates.victory;
    $('tpl-combatCancel').value = cfg.templates.combatCancel;

    // 타이밍
    setTimingField('time-beforeFirstRoll', cfg.timing.beforeFirstRoll);
    setTimingField('time-betweenRolls', cfg.timing.betweenRolls);
    setTimingField('time-beforeRoundResult', cfg.timing.beforeRoundResult);
    setTimingField('time-beforeNextRound', cfg.timing.beforeNextRound);
    setTimingField('time-beforeVictory', cfg.timing.beforeVictory);
    setTimingField('time-resultTimeout', cfg.timing.resultTimeout);

    // 규칙
    $('rule-diceType').value = cfg.rules.diceType;
    $('rule-criticalValue').value = cfg.rules.criticalValue;
    $('rule-fumbleValue').value = cfg.rules.fumbleValue;
    $('rule-criticalBonus').value = cfg.rules.criticalBonus;
    $('rule-fumblePenalty').value = cfg.rules.fumblePenalty;
    $('rule-tieRule').value = cfg.rules.tieRule;

    // 효과음
    $('sound-combatStart').value = cfg.sounds.combatStartSound || '';
    renderTagList('sound-roundHeader-list', cfg.sounds.roundHeaderSounds || [], 'roundHeaderSounds');
    renderTagList('sound-resultNormal-list', cfg.sounds.resultNormalSounds || [], 'resultNormalSounds');
    $('sound-resultSpecial').value = cfg.sounds.resultSpecialSound || '';
    $('sound-victory').value = cfg.sounds.victorySound || '';

    // 패턴
    $('pat-triggerRegex').value = cfg.patterns.triggerRegex;
    $('pat-diceResultRegex').value = cfg.patterns.diceResultRegex;
    $('pat-cancelRegex').value = cfg.patterns.cancelRegex;

    // 선택자
    $('sel-chatContainer').value = arrayToString(cfg.selectors.chatContainer);
    $('sel-chatMessage').value = arrayToString(cfg.selectors.chatMessage);
    $('sel-messageText').value = arrayToString(cfg.selectors.messageText);
    $('sel-chatInput').value = arrayToString(cfg.selectors.chatInput);
    $('sel-sendButton').value = arrayToString(cfg.selectors.sendButton);

    // 기타
    $('gen-autoScroll').checked = cfg.general.autoScroll;
    $('gen-showOverlay').checked = cfg.general.showOverlay;
    $('gen-debugMode').checked = cfg.general.debugMode;
  }

  /** UI 필드에서 설정 데이터를 수집합니다 */
  function collectFromUI() {
    const cfg = JSON.parse(JSON.stringify(DEFAULTS));

    // 활성화
    cfg.general.enabled = $('toggle-enabled').checked;

    // 메시지 템플릿
    cfg.templates.roundHeader = $('tpl-roundHeader').value;
    cfg.templates.attackerRoll = $('tpl-attackerRoll').value;
    cfg.templates.defenderRoll = $('tpl-defenderRoll').value;
    cfg.templates.roundResultWin = $('tpl-roundResultWin').value;
    cfg.templates.roundResultCrit = $('tpl-roundResultCrit').value;
    cfg.templates.roundResultFumble = $('tpl-roundResultFumble').value;
    cfg.templates.roundResultBothCrit = $('tpl-roundResultBothCrit').value;
    cfg.templates.roundResultTie = $('tpl-roundResultTie').value;
    cfg.templates.victory = $('tpl-victory').value;
    cfg.templates.combatCancel = $('tpl-combatCancel').value;

    // 타이밍
    cfg.timing.beforeFirstRoll = getTimingValue('time-beforeFirstRoll');
    cfg.timing.betweenRolls = getTimingValue('time-betweenRolls');
    cfg.timing.beforeRoundResult = getTimingValue('time-beforeRoundResult');
    cfg.timing.beforeNextRound = getTimingValue('time-beforeNextRound');
    cfg.timing.beforeVictory = getTimingValue('time-beforeVictory');
    cfg.timing.resultTimeout = getTimingValue('time-resultTimeout');

    // 규칙
    cfg.rules.diceType = parseInt($('rule-diceType').value) || 20;
    cfg.rules.criticalValue = parseInt($('rule-criticalValue').value) || 20;
    cfg.rules.fumbleValue = parseInt($('rule-fumbleValue').value) || 1;
    cfg.rules.criticalBonus = parseInt($('rule-criticalBonus').value) || 1;
    cfg.rules.fumblePenalty = parseInt($('rule-fumblePenalty').value) || 1;
    cfg.rules.tieRule = $('rule-tieRule').value;

    // 효과음
    cfg.sounds.combatStartSound = $('sound-combatStart').value.trim() || '합';
    cfg.sounds.roundHeaderSounds = collectTags('sound-roundHeader-list');
    cfg.sounds.resultNormalSounds = collectTags('sound-resultNormal-list');
    cfg.sounds.resultSpecialSound = $('sound-resultSpecial').value.trim() || '챙4';
    cfg.sounds.victorySound = $('sound-victory').value.trim() || '합';

    // 패턴
    cfg.patterns.triggerRegex = $('pat-triggerRegex').value;
    cfg.patterns.diceResultRegex = $('pat-diceResultRegex').value;
    cfg.patterns.cancelRegex = $('pat-cancelRegex').value;

    // 선택자
    cfg.selectors.chatContainer = stringToArray($('sel-chatContainer').value);
    cfg.selectors.chatMessage = stringToArray($('sel-chatMessage').value);
    cfg.selectors.messageText = stringToArray($('sel-messageText').value);
    cfg.selectors.chatInput = stringToArray($('sel-chatInput').value);
    cfg.selectors.sendButton = stringToArray($('sel-sendButton').value);

    // 기타
    cfg.general.autoScroll = $('gen-autoScroll').checked;
    cfg.general.showOverlay = $('gen-showOverlay').checked;
    cfg.general.debugMode = $('gen-debugMode').checked;

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

    // 활성화 토글
    $('toggle-enabled').addEventListener('change', (e) => {
      sendToContent({ type: 'BWBR_SET_ENABLED', enabled: e.target.checked });
    });

    // 효과음 추가
    $('sound-roundHeader-add').addEventListener('click', () => {
      addTag('sound-roundHeader-list', 'sound-roundHeader-input', 'roundHeaderSounds');
    });
    $('sound-roundHeader-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTag('sound-roundHeader-list', 'sound-roundHeader-input', 'roundHeaderSounds');
    });

    $('sound-resultNormal-add').addEventListener('click', () => {
      addTag('sound-resultNormal-list', 'sound-resultNormal-input', 'resultNormalSounds');
    });
    $('sound-resultNormal-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTag('sound-resultNormal-list', 'sound-resultNormal-input', 'resultNormalSounds');
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

    // DOM 재탐색
    $('btn-refresh-dom').addEventListener('click', () => {
      sendToContent({ type: 'BWBR_REFRESH_DOM' }, (response) => {
        const statusEl = $('dom-status');
        if (response && response.success) {
          statusEl.className = 'dom-status success';
          statusEl.textContent = `✓ 연결 성공! 컨테이너: ${response.container ? '발견' : '미발견'}, 입력필드: ${response.input ? '발견' : '미발견'}`;
        } else {
          statusEl.className = 'dom-status error';
          statusEl.textContent = `✕ 연결 실패. 코코포리아 페이지가 열려 있는지 확인하세요.`;
        }
      });
    });

    // 테스트 메시지 전송
    $('btn-test-send').addEventListener('click', () => {
      const text = $('test-message').value;
      if (!text) return;
      sendToContent({ type: 'BWBR_TEST_SEND', text: text }, (response) => {
        if (response && response.success) {
          showToast('메시지 전송 완료!', 'success');
        } else {
          showToast('메시지 전송 실패', 'error');
        }
      });
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
      showToast('이미 추가된 효과음입니다.', 'error');
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

})();
