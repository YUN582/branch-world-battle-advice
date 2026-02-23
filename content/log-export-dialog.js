// log-export-dialog.js
// 더 나은 로그 출력 — 설정 다이얼로그 + 필터링 + 스타일링 + 미리보기 + 내보내기
// ISOLATED world content script
(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  //  상수 & 기본값
  // ════════════════════════════════════════════════════════════════

  var DIALOG_ID = 'bwbr-led';
  var STYLE_ID  = 'bwbr-led-style';

  var TAB_IDS = ['general','filter','style','export'];
  var TAB_NAMES = { general:'기본', filter:'필터', style:'스타일', export:'내보내기' };

  var FONT_PRESETS = [
    { label:'Noto Sans KR',      url:'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap' },
    { label:'Pretendard',         url:'https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css' },
    { label:'IBM Plex Sans KR',   url:'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;700&display=swap' },
    { label:'Noto Serif KR',      url:'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700;900&display=swap' },
    { label:'Spoqa Han Sans Neo',  url:'https://spoqa.github.io/spoqa-han-sans/css/SpoqaHanSansNeo.css' },
    { label:'마루 부리',           url:'https://fonts.googleapis.com/css2?family=MaruBuri:wght@400;700&display=swap' },
  ];

  var DEFAULT_COLORS = {
    bg:       '#d8d8dc',
    bgPanel:  '#131316',
    bgLog:    '#17171b',
    bgCard:   '#1d1d22',
    text:     '#ececf0',
    textSub:  'rgba(225,225,230,0.65)',
    textDim:  'rgba(170,170,180,0.35)',
    sysBg:    '#222228',
    sysText:  'rgba(215,215,225,0.82)',
    altBg:    '#e8e8ec',
    altText:  '#1a1a1e',
  };

  var COLOR_LABELS = {
    bg:       '외부 배경',
    bgPanel:  '헤더 배경',
    bgLog:    '로그 배경',
    bgCard:   '카드 배경',
    text:     '기본 텍스트',
    sysBg:    '시스템 배경',
    sysText:  '시스템 텍스트',
    altBg:    '비메인탭 배경',
    altText:  '비메인탭 텍스트',
  };

  // ════════════════════════════════════════════════════════════════
  //  State
  // ════════════════════════════════════════════════════════════════

  var dialogEl = null;
  var allMessages = [];
  var roomName = '';
  var currentTab = 'general';

  var settings = {
    title: '',
    headerImage: null,   // data URL
    channels: {},        // { channelKey: true/false }
    dateFrom: null,      // epoch ms
    dateTo: null,
    font: 'Noto Sans KR',
    customFontUrl: '',
    colors: Object.assign({}, DEFAULT_COLORS),
    theme: 'default',
    exportFormat: 'htmlFile',
  };

  // calendar state
  var calYear, calMonth;
  var calDragging = false;
  var calDragAnchor = null;   // epoch ms (start of day that began drag)
  var calDragEnd = null;      // epoch ms (start of day currently hovered)

  // derived data (populated on open)
  var channelList = [];      // [{ key, name, count }]
  var dateCounts = {};       // { 'YYYY-MM-DD': count }
  var dateMin = null, dateMax = null;

  // preview debounce
  var previewTimer = null;

  // ════════════════════════════════════════════════════════════════
  //  CSS 주입
  // ════════════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS_TEXT;
    document.head.appendChild(s);
  }

  var CSS_TEXT = [
  '#' + DIALOG_ID + '-overlay {',
  '  position:fixed;inset:0;z-index:15000;',
  '  background:rgba(0,0,0,0.55);',
  '  display:flex;align-items:center;justify-content:center;',
  '  font-family:"Noto Sans KR","Roboto","Helvetica","Arial",sans-serif;',
  '  color:#e8e8ec;font-size:14px;line-height:1.5;',
  '}',

  /* ── split layout ── */
  '#' + DIALOG_ID + ' {',
  '  background:#2a2a2e;border-radius:12px;',
  '  width:min(1340px,96vw);height:min(860px,90vh);',
  '  display:flex;flex-direction:column;',
  '  box-shadow:0 12px 48px rgba(0,0,0,0.5);',
  '  overflow:hidden;',
  '}',
  '.led-split {',
  '  flex:1;display:flex;min-height:0;',
  '}',
  '.led-left {',
  '  width:420px;flex-shrink:0;display:flex;flex-direction:column;',
  '  border-right:1px solid rgba(255,255,255,0.08);',
  '}',
  '.led-right {',
  '  flex:1;display:flex;flex-direction:column;min-width:0;',
  '  background:#1e1e22;',
  '}',

  /* header */
  '.led-hdr {',
  '  display:flex;align-items:center;justify-content:space-between;',
  '  padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.08);',
  '  flex-shrink:0;',
  '}',
  '.led-hdr-title { font-size:15px;font-weight:700; }',
  '.led-hdr-close {',
  '  background:none;border:none;color:rgba(255,255,255,0.5);',
  '  font-size:20px;cursor:pointer;padding:4px 8px;border-radius:4px;',
  '}',
  '.led-hdr-close:hover { color:#fff;background:rgba(255,255,255,0.08); }',

  /* tabs */
  '.led-tabs {',
  '  display:flex;border-bottom:1px solid rgba(255,255,255,0.08);',
  '  padding:0 12px;flex-shrink:0;',
  '}',
  '.led-tab {',
  '  padding:9px 14px;font-size:12px;font-weight:600;',
  '  color:rgba(255,255,255,0.45);cursor:pointer;',
  '  border-bottom:2px solid transparent;',
  '  transition:all 0.15s;user-select:none;',
  '}',
  '.led-tab:hover { color:rgba(255,255,255,0.7); }',
  '.led-tab.active { color:#90caf9;border-bottom-color:#90caf9; }',

  /* body (left panel content) */
  '.led-body {',
  '  flex:1;overflow-y:auto;padding:16px 18px;',
  '  min-height:0;',
  '}',

  /* section */
  '.led-section { margin-bottom:20px; }',
  '.led-label {',
  '  font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);',
  '  letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;',
  '}',

  /* inputs */
  '.led-input {',
  '  width:100%;padding:8px 12px;font-size:13px;',
  '  background:#1e1e22;color:#e8e8ec;',
  '  border:1px solid rgba(255,255,255,0.1);border-radius:6px;',
  '  outline:none;font-family:inherit;',
  '}',
  '.led-input:focus { border-color:#5b9bf0; }',
  '.led-input::placeholder { color:rgba(255,255,255,0.25); }',

  '.led-select {',
  '  padding:7px 10px;font-size:13px;',
  '  background:#1e1e22;color:#e8e8ec;',
  '  border:1px solid rgba(255,255,255,0.1);border-radius:6px;',
  '  outline:none;font-family:inherit;cursor:pointer;',
  '  appearance:auto;',
  '}',

  /* checkbox list */
  '.led-ck-list {',
  '  display:flex;flex-wrap:wrap;gap:5px;',
  '  max-height:160px;overflow-y:auto;padding:4px 0;',
  '}',
  '.led-ck-item {',
  '  display:flex;align-items:center;gap:5px;',
  '  padding:4px 10px;border-radius:5px;',
  '  background:rgba(255,255,255,0.04);',
  '  cursor:pointer;user-select:none;font-size:12px;',
  '  transition:background 0.1s;',
  '}',
  '.led-ck-item:hover { background:rgba(255,255,255,0.08); }',
  '.led-ck-item.checked { background:rgba(90,155,240,0.15); }',
  '.led-ck-box {',
  '  width:14px;height:14px;border-radius:3px;flex-shrink:0;',
  '  border:1.5px solid rgba(255,255,255,0.25);',
  '  display:flex;align-items:center;justify-content:center;',
  '  font-size:10px;color:#5b9bf0;transition:all 0.1s;',
  '}',
  '.led-ck-item.checked .led-ck-box {',
  '  border-color:#5b9bf0;background:rgba(90,155,240,0.2);',
  '}',

  /* select-all toggle */
  '.led-toggle-all {',
  '  font-size:11px;color:#5b9bf0;cursor:pointer;',
  '  margin-bottom:4px;user-select:none;',
  '}',
  '.led-toggle-all:hover { text-decoration:underline; }',

  /* calendar */
  '.led-cal { user-select:none; }',
  '.led-cal-nav {',
  '  display:flex;align-items:center;justify-content:space-between;',
  '  margin-bottom:6px;',
  '}',
  '.led-cal-nav-btn {',
  '  background:none;border:none;color:rgba(255,255,255,0.5);',
  '  font-size:16px;cursor:pointer;padding:3px 8px;border-radius:4px;',
  '}',
  '.led-cal-nav-btn:hover { color:#fff;background:rgba(255,255,255,0.08); }',
  '.led-cal-month { font-size:13px;font-weight:700;color:rgba(255,255,255,0.8); }',
  '.led-cal-grid {',
  '  display:grid;grid-template-columns:repeat(7,1fr);gap:1px;',
  '}',
  '.led-cal-hdr {',
  '  text-align:center;font-size:10px;font-weight:600;',
  '  color:rgba(255,255,255,0.3);padding:3px 0;',
  '}',
  '.led-cal-day {',
  '  text-align:center;padding:5px 2px;font-size:11px;',
  '  border-radius:3px;cursor:pointer;position:relative;',
  '  color:rgba(255,255,255,0.5);transition:background 0.08s;',
  '}',
  '.led-cal-day:hover { background:rgba(255,255,255,0.08); }',
  '.led-cal-day.empty { cursor:default; }',
  '.led-cal-day.empty:hover { background:none; }',
  '.led-cal-day.has-msg { color:rgba(255,255,255,0.85); }',
  '.led-cal-day.has-msg::after {',
  '  content:"";position:absolute;bottom:1px;left:50%;transform:translateX(-50%);',
  '  width:3px;height:3px;border-radius:50%;background:#5b9bf0;',
  '}',
  '.led-cal-day.has-many::after { width:5px;height:5px;background:#90caf9; }',
  '.led-cal-day.in-range { background:rgba(90,155,240,0.15); }',
  '.led-cal-day.range-start,.led-cal-day.range-end {',
  '  background:#5b9bf0;color:#fff;font-weight:700;',
  '}',
  '.led-cal-day.range-start::after,.led-cal-day.range-end::after { background:#fff; }',
  '.led-cal-day.today { box-shadow:inset 0 0 0 1px rgba(255,255,255,0.25); }',
  '.led-cal-day.drag-hover { background:rgba(90,155,240,0.25); }',

  /* date inputs */
  '.led-date-row {',
  '  display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap;',
  '}',
  '.led-date-input {',
  '  padding:5px 8px;font-size:12px;width:115px;',
  '  background:#1e1e22;color:#e8e8ec;',
  '  border:1px solid rgba(255,255,255,0.1);border-radius:4px;',
  '  outline:none;font-family:inherit;',
  '}',
  '.led-date-input:focus { border-color:#5b9bf0; }',
  '.led-date-quick {',
  '  font-size:11px;color:#5b9bf0;cursor:pointer;',
  '  padding:3px 6px;border-radius:4px;',
  '}',
  '.led-date-quick:hover { background:rgba(90,155,240,0.1);text-decoration:underline; }',

  /* color grid */
  '.led-color-grid {',
  '  display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;',
  '}',
  '.led-color-item {',
  '  display:flex;align-items:center;gap:6px;',
  '  padding:6px;border-radius:5px;',
  '  background:rgba(255,255,255,0.03);',
  '}',
  '.led-color-swatch {',
  '  width:28px;height:28px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);',
  '  cursor:pointer;flex-shrink:0;overflow:hidden;',
  '}',
  '.led-color-swatch input {',
  '  width:44px;height:44px;border:none;cursor:pointer;',
  '  margin:-8px;',
  '}',
  '.led-color-name { font-size:11px;color:rgba(255,255,255,0.6); }',

  /* image upload */
  '.led-img-drop {',
  '  border:2px dashed rgba(255,255,255,0.12);border-radius:8px;',
  '  padding:16px;text-align:center;cursor:pointer;',
  '  color:rgba(255,255,255,0.35);font-size:12px;',
  '  transition:all 0.15s;',
  '}',
  '.led-img-drop:hover,.led-img-drop.dragover {',
  '  border-color:#5b9bf0;color:#5b9bf0;background:rgba(90,155,240,0.05);',
  '}',
  '.led-img-preview {',
  '  margin-top:8px;position:relative;display:inline-block;',
  '}',
  '.led-img-preview img {',
  '  max-width:100%;max-height:140px;border-radius:6px;',
  '  border:1px solid rgba(255,255,255,0.08);',
  '}',
  '.led-img-remove {',
  '  position:absolute;top:4px;right:4px;',
  '  background:rgba(0,0,0,0.7);border:none;color:#fff;',
  '  width:22px;height:22px;border-radius:50%;cursor:pointer;',
  '  font-size:13px;display:flex;align-items:center;justify-content:center;',
  '}',

  /* right panel: preview */
  '.led-preview-hdr {',
  '  display:flex;align-items:center;justify-content:space-between;',
  '  padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.06);',
  '  flex-shrink:0;',
  '}',
  '.led-preview-hdr-title {',
  '  font-size:12px;font-weight:700;color:rgba(255,255,255,0.4);',
  '  letter-spacing:1px;text-transform:uppercase;',
  '}',
  '.led-preview-hdr-info {',
  '  font-size:11px;color:rgba(255,255,255,0.3);',
  '}',
  '.led-preview-frame {',
  '  flex:1;width:100%;border:none;background:#17171b;',
  '}',

  /* export options */
  '.led-radio-group { display:flex;flex-direction:column;gap:6px; }',
  '.led-radio {',
  '  display:flex;align-items:center;gap:8px;',
  '  padding:10px 12px;border-radius:6px;cursor:pointer;',
  '  background:rgba(255,255,255,0.03);',
  '  border:1px solid rgba(255,255,255,0.06);',
  '  transition:all 0.15s;',
  '}',
  '.led-radio:hover { background:rgba(255,255,255,0.06); }',
  '.led-radio.selected { background:rgba(90,155,240,0.1);border-color:rgba(90,155,240,0.3); }',
  '.led-radio-dot {',
  '  width:14px;height:14px;border-radius:50%;flex-shrink:0;',
  '  border:2px solid rgba(255,255,255,0.25);',
  '  display:flex;align-items:center;justify-content:center;',
  '}',
  '.led-radio.selected .led-radio-dot {',
  '  border-color:#5b9bf0;',
  '}',
  '.led-radio.selected .led-radio-dot::after {',
  '  content:"";width:7px;height:7px;border-radius:50%;background:#5b9bf0;',
  '}',
  '.led-radio-label { font-size:13px; }',
  '.led-radio-desc { font-size:11px;color:rgba(255,255,255,0.4);margin-top:1px; }',

  /* buttons */
  '.led-btn {',
  '  padding:8px 20px;border:none;border-radius:6px;',
  '  font-size:13px;font-weight:600;cursor:pointer;',
  '  font-family:inherit;transition:all 0.15s;',
  '}',
  '.led-btn-primary {',
  '  background:#5b9bf0;color:#fff;',
  '}',
  '.led-btn-primary:hover { background:#4a8ae0; }',
  '.led-btn-secondary {',
  '  background:rgba(255,255,255,0.08);color:#e8e8ec;',
  '}',
  '.led-btn-secondary:hover { background:rgba(255,255,255,0.12); }',

  /* info text */
  '.led-info {',
  '  font-size:11px;color:rgba(255,255,255,0.35);margin-top:3px;',
  '}',

  /* stat bar */
  '.led-stat {',
  '  display:flex;gap:12px;padding:8px 0;font-size:12px;color:rgba(255,255,255,0.5);',
  '  border-top:1px solid rgba(255,255,255,0.06);margin-top:12px;',
  '}',
  '.led-stat b { color:#e8e8ec;font-weight:600; }',

  /* message count badge */
  '.led-count {',
  '  font-size:10px;color:rgba(255,255,255,0.3);',
  '  margin-left:3px;',
  '}',

  /* scrollbar */
  '.led-body::-webkit-scrollbar { width:5px; }',
  '.led-body::-webkit-scrollbar-track { background:transparent; }',
  '.led-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1);border-radius:3px; }',
  '.led-body::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.2); }',
  '.led-ck-list::-webkit-scrollbar { width:4px; }',
  '.led-ck-list::-webkit-scrollbar-track { background:transparent; }',
  '.led-ck-list::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08);border-radius:2px; }',
  ].join('\n');

  // ════════════════════════════════════════════════════════════════
  //  유틸리티
  // ════════════════════════════════════════════════════════════════

  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        for (var sk in attrs[k]) e.style[sk] = attrs[k][sk];
      } else if (k === 'className') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (children) {
      if (typeof children === 'string') e.textContent = children;
      else if (Array.isArray(children)) children.forEach(function(c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      else e.appendChild(children);
    }
    return e;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDateTime(d) { return fmtDate(d) + ' ' + fmtTime(d) + ':' + pad(d.getSeconds()); }
  function fmtDateFile(d) { return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()); }
  function dayKey(ts) { var d = new Date(ts); return fmtDate(d); }
  function startOfDay(ts) { var d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function endOfDay(ts) { var d = new Date(ts); d.setHours(23,59,59,999); return d.getTime(); }

  function isMainChannel(msg) {
    if (!msg.channel) return true;
    var cn = (msg.channelName || '').trim().toLowerCase();
    if (!cn) return true;
    return cn === 'メイン' || cn === 'めいん' || cn === '메인' || cn === 'main';
  }

  // ════════════════════════════════════════════════════════════════
  //  데이터 분석 (open 시 호출)
  // ════════════════════════════════════════════════════════════════

  function analyzeMessages(msgs) {
    var chanMap = {};
    dateCounts = {};
    dateMin = null; dateMax = null;

    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      // channels
      var ck = m.channel || 'main';
      var cn = m.channelName || m.channel || 'main';
      if (!chanMap[ck]) chanMap[ck] = { key: ck, name: cn, count: 0 };
      chanMap[ck].count++;

      // dates
      if (m.createdAt) {
        var dk = dayKey(m.createdAt);
        dateCounts[dk] = (dateCounts[dk] || 0) + 1;
        if (!dateMin || m.createdAt < dateMin) dateMin = m.createdAt;
        if (!dateMax || m.createdAt > dateMax) dateMax = m.createdAt;
      }
    }

    channelList = Object.keys(chanMap).map(function(k) { return chanMap[k]; })
      .sort(function(a, b) {
        var order = ['main','info','other'];
        var ai = order.indexOf(a.key), bi = order.indexOf(b.key);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1; if (bi !== -1) return 1;
        return a.name.localeCompare(b.name);
      });

    // 기본 설정: 모두 선택
    settings.channels = {};
    for (var ci = 0; ci < channelList.length; ci++) settings.channels[channelList[ci].key] = true;
    settings.dateFrom = dateMin ? startOfDay(dateMin) : null;
    settings.dateTo = dateMax ? endOfDay(dateMax) : null;

    var d = dateMax ? new Date(dateMax) : new Date();
    calYear = d.getFullYear();
    calMonth = d.getMonth();
  }

  // ════════════════════════════════════════════════════════════════
  //  필터 적용
  // ════════════════════════════════════════════════════════════════

  function getFilteredMessages() {
    return allMessages.filter(function(m) {
      var ck = m.channel || 'main';
      if (settings.channels[ck] === false) return false;
      if (settings.dateFrom && m.createdAt && m.createdAt < settings.dateFrom) return false;
      if (settings.dateTo && m.createdAt && m.createdAt > settings.dateTo) return false;
      return true;
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  다이얼로그 열기 / 닫기
  // ════════════════════════════════════════════════════════════════

  function open(msgs, rName) {
    if (dialogEl) close();
    injectStyles();
    allMessages = msgs;
    roomName = rName || '';
    settings.title = rName || '';
    analyzeMessages(msgs);
    currentTab = 'general';
    render();
  }

  function close() {
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    // clean up potential drag listeners
    document.removeEventListener('mouseup', onCalDragEnd);
    var ov = document.getElementById(DIALOG_ID + '-overlay');
    if (ov) ov.remove();
    dialogEl = null;
  }

  // ════════════════════════════════════════════════════════════════
  //  메인 렌더 — 좌우 분할 레이아웃
  // ════════════════════════════════════════════════════════════════

  function render() {
    close();
    var overlay = el('div', { id: DIALOG_ID + '-overlay' });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    var dlg = el('div', { id: DIALOG_ID });
    overlay.appendChild(dlg);

    // header
    var hdr = el('div', { className: 'led-hdr' }, [
      el('span', { className: 'led-hdr-title' }, '더 나은 로그 출력'),
      el('button', { className: 'led-hdr-close', onClick: close }, '✕'),
    ]);
    dlg.appendChild(hdr);

    // split
    var split = el('div', { className: 'led-split' });

    // ── LEFT: tabs + body ──
    var left = el('div', { className: 'led-left' });
    var tabBar = el('div', { className: 'led-tabs' });
    TAB_IDS.forEach(function(tid) {
      var t = el('div', {
        className: 'led-tab' + (tid === currentTab ? ' active' : ''),
        onClick: function() { currentTab = tid; renderLeftBody(); }
      }, TAB_NAMES[tid]);
      tabBar.appendChild(t);
    });
    left.appendChild(tabBar);
    var body = el('div', { className: 'led-body', id: DIALOG_ID + '-body' });
    left.appendChild(body);
    split.appendChild(left);

    // ── RIGHT: always-visible preview ──
    var right = el('div', { className: 'led-right' });
    var pvHdr = el('div', { className: 'led-preview-hdr' });
    pvHdr.appendChild(el('span', { className: 'led-preview-hdr-title' }, '미리보기'));
    pvHdr.appendChild(el('span', { className: 'led-preview-hdr-info', id: DIALOG_ID + '-pv-info' }, ''));
    var refreshBtn = el('button', { className: 'led-btn led-btn-secondary',
      style: { padding: '4px 10px', fontSize: '11px', marginLeft: '8px' },
      onClick: function() { refreshPreview(); }
    }, '↻ 갱신');
    pvHdr.appendChild(refreshBtn);
    right.appendChild(pvHdr);
    var frame = el('iframe', { className: 'led-preview-frame', id: DIALOG_ID + '-preview-frame' });
    right.appendChild(frame);
    split.appendChild(right);

    dlg.appendChild(split);
    document.body.appendChild(overlay);
    dialogEl = dlg;
    renderLeftBody();
    schedulePreview();
  }

  function renderLeftBody() {
    var body = document.getElementById(DIALOG_ID + '-body');
    if (!body) return;
    body.innerHTML = '';

    // update tab active state
    var tabs = body.parentElement.querySelectorAll('.led-tab');
    tabs.forEach(function(t) {
      t.classList.toggle('active', t.textContent === TAB_NAMES[currentTab]);
    });

    switch (currentTab) {
      case 'general':  buildGeneralTab(body);  break;
      case 'filter':   buildFilterTab(body);   break;
      case 'style':    buildStyleTab(body);    break;
      case 'export':   buildExportTab(body);   break;
    }

    // stat bar
    var filtered = getFilteredMessages();
    var stat = el('div', { className: 'led-stat' });
    stat.innerHTML = '전체 <b>' + allMessages.length.toLocaleString() + '</b>건 &nbsp;|&nbsp; 필터 적용 <b>' + filtered.length.toLocaleString() + '</b>건';
    body.appendChild(stat);
  }

  // ── preview helpers ──
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(function() { refreshPreview(); }, 200);
  }

  function refreshPreview() {
    var frame = document.getElementById(DIALOG_ID + '-preview-frame');
    var info = document.getElementById(DIALOG_ID + '-pv-info');
    if (!frame) return;
    var filtered = getFilteredMessages();
    var previewMsgs = filtered.length > 200 ? filtered.slice(0, 200) : filtered;
    var htmlContent = generateExportHtml(previewMsgs, settings.title || roomName, true);
    frame.srcdoc = htmlContent;
    if (info) info.textContent = filtered.length.toLocaleString() + '건' + (filtered.length > 200 ? ' (처음 200건 표시)' : '');
  }

  // ════════════════════════════════════════════════════════════════
  //  TAB: 기본
  // ════════════════════════════════════════════════════════════════

  function buildGeneralTab(body) {
    // 세션 제목
    var sec1 = el('div', { className: 'led-section' });
    sec1.appendChild(el('div', { className: 'led-label' }, '세션 제목'));
    var titleInput = el('input', {
      className: 'led-input',
      type: 'text',
      value: settings.title,
      placeholder: roomName || '세션 제목을 입력하세요',
    });
    titleInput.addEventListener('input', function() { settings.title = titleInput.value; });
    sec1.appendChild(titleInput);
    sec1.appendChild(el('div', { className: 'led-info' }, '내보낸 로그의 헤더에 표시됩니다.'));
    body.appendChild(sec1);

    // 헤더 이미지
    var sec2 = el('div', { className: 'led-section' });
    sec2.appendChild(el('div', { className: 'led-label' }, '헤더 이미지'));

    var dropZone = el('div', { className: 'led-img-drop' }, '클릭 또는 이미지를 드래그하여 업로드');
    var fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    dropZone.addEventListener('click', function() { fileInput.click(); });
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault(); dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleImageFile(e.dataTransfer.files[0], sec2);
    });
    fileInput.addEventListener('change', function() {
      if (fileInput.files.length) handleImageFile(fileInput.files[0], sec2);
    });
    sec2.appendChild(dropZone);
    sec2.appendChild(fileInput);

    // preview existing
    if (settings.headerImage) renderImagePreview(sec2);

    sec2.appendChild(el('div', { className: 'led-info' }, '세션 카드 헤더 아래에 삽입됩니다. 가로 폭에 맞게 조절됩니다.'));
    body.appendChild(sec2);
  }

  function handleImageFile(file, container) {
    if (!file.type.startsWith('image/')) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      settings.headerImage = e.target.result;
      var old = container.querySelector('.led-img-preview');
      if (old) old.remove();
      renderImagePreview(container);
    };
    reader.readAsDataURL(file);
  }

  function renderImagePreview(container) {
    var old = container.querySelector('.led-img-preview');
    if (old) old.remove();
    if (!settings.headerImage) return;
    var wrap = el('div', { className: 'led-img-preview' });
    var img = el('img', { src: settings.headerImage });
    var btn = el('button', { className: 'led-img-remove', onClick: function() {
      settings.headerImage = null;
      wrap.remove();
    }}, '✕');
    wrap.appendChild(img);
    wrap.appendChild(btn);
    // insert after drop zone
    var dropZone = container.querySelector('.led-img-drop');
    if (dropZone) dropZone.insertAdjacentElement('afterend', wrap);
    else container.appendChild(wrap);
  }

  // ════════════════════════════════════════════════════════════════
  //  TAB: 필터
  // ════════════════════════════════════════════════════════════════

  function buildFilterTab(body) {
    // 탭 선택
    var sec1 = el('div', { className: 'led-section' });
    sec1.appendChild(el('div', { className: 'led-label' }, '내보낼 탭'));
    var allChOn = channelList.every(function(c) { return settings.channels[c.key] !== false; });
    var toggleAllCh = el('div', { className: 'led-toggle-all' }, allChOn ? '전체 해제' : '전체 선택');
    toggleAllCh.addEventListener('click', function() {
      var newVal = !allChOn;
      channelList.forEach(function(c) { settings.channels[c.key] = newVal; });
      renderLeftBody(); schedulePreview();
    });
    sec1.appendChild(toggleAllCh);
    var chList = el('div', { className: 'led-ck-list' });
    channelList.forEach(function(ch) {
      var on = settings.channels[ch.key] !== false;
      var item = el('div', { className: 'led-ck-item' + (on ? ' checked' : '') });
      item.appendChild(el('div', { className: 'led-ck-box' }, on ? '✓' : ''));
      var label = ch.name;
      if (ch.key === 'main') label = 'メイン (메인)';
      else if (ch.key === 'info') label = '情報 (정보)';
      else if (ch.key === 'other') label = '雑談 (잡담)';
      item.appendChild(document.createTextNode(label));
      item.appendChild(el('span', { className: 'led-count' }, '(' + ch.count + ')'));
      item.addEventListener('click', function() {
        settings.channels[ch.key] = !on;
        renderLeftBody(); schedulePreview();
      });
      chList.appendChild(item);
    });
    sec1.appendChild(chList);
    body.appendChild(sec1);

    // 날짜 범위
    var sec3 = el('div', { className: 'led-section' });
    sec3.appendChild(el('div', { className: 'led-label' }, '날짜 범위'));
    sec3.appendChild(el('div', { className: 'led-info', style: { marginTop: '0', marginBottom: '6px' } }, '드래그하여 범위를 선택하세요'));
    sec3.appendChild(buildCalendar());

    // date inputs
    var dateRow = el('div', { className: 'led-date-row' });
    var fromInput = el('input', {
      className: 'led-date-input', type: 'date',
      value: settings.dateFrom ? fmtDate(new Date(settings.dateFrom)) : '',
    });
    fromInput.addEventListener('change', function() {
      var d = new Date(fromInput.value + 'T00:00:00');
      if (!isNaN(d.getTime())) settings.dateFrom = d.getTime();
      renderLeftBody(); schedulePreview();
    });
    var toInput = el('input', {
      className: 'led-date-input', type: 'date',
      value: settings.dateTo ? fmtDate(new Date(settings.dateTo)) : '',
    });
    toInput.addEventListener('change', function() {
      var d = new Date(toInput.value + 'T23:59:59.999');
      if (!isNaN(d.getTime())) settings.dateTo = d.getTime();
      renderLeftBody(); schedulePreview();
    });
    dateRow.appendChild(fromInput);
    dateRow.appendChild(document.createTextNode(' ~ '));
    dateRow.appendChild(toInput);

    // quick buttons
    var qAll = el('span', { className: 'led-date-quick' }, '전체');
    qAll.addEventListener('click', function() {
      settings.dateFrom = dateMin ? startOfDay(dateMin) : null;
      settings.dateTo = dateMax ? endOfDay(dateMax) : null;
      renderLeftBody(); schedulePreview();
    });
    dateRow.appendChild(qAll);

    if (dateMax) {
      var q7 = el('span', { className: 'led-date-quick' }, '최근 7일');
      q7.addEventListener('click', function() {
        settings.dateTo = endOfDay(dateMax);
        settings.dateFrom = startOfDay(dateMax - 6 * 86400000);
        renderLeftBody(); schedulePreview();
      });
      dateRow.appendChild(q7);
      var q30 = el('span', { className: 'led-date-quick' }, '최근 30일');
      q30.addEventListener('click', function() {
        settings.dateTo = endOfDay(dateMax);
        settings.dateFrom = startOfDay(dateMax - 29 * 86400000);
        renderLeftBody(); schedulePreview();
      });
      dateRow.appendChild(q30);
    }

    sec3.appendChild(dateRow);
    body.appendChild(sec3);
  }

  // ── Calendar widget (드래그 범위 선택) ──

  function onCalDragEnd() {
    if (!calDragging) return;
    calDragging = false;
    document.removeEventListener('mouseup', onCalDragEnd);
    // commit drag range
    if (calDragAnchor != null && calDragEnd != null) {
      var lo = Math.min(calDragAnchor, calDragEnd);
      var hi = Math.max(calDragAnchor, calDragEnd);
      settings.dateFrom = startOfDay(lo);
      settings.dateTo = endOfDay(hi);
    }
    calDragAnchor = null;
    calDragEnd = null;
    renderLeftBody(); schedulePreview();
  }

  function updateCalDragVisual(grid) {
    if (!grid) return;
    var days = grid.querySelectorAll('.led-cal-day[data-ts]');
    var lo = calDragAnchor != null && calDragEnd != null ? Math.min(calDragAnchor, calDragEnd) : null;
    var hi = calDragAnchor != null && calDragEnd != null ? Math.max(calDragAnchor, calDragEnd) : null;
    for (var i = 0; i < days.length; i++) {
      var ts = +days[i].getAttribute('data-ts');
      // remove previous drag classes
      days[i].classList.remove('range-start', 'range-end', 'in-range', 'drag-hover');
      if (lo !== null && hi !== null) {
        if (ts === lo) days[i].classList.add('range-start');
        if (ts === hi) days[i].classList.add('range-end');
        if (ts > lo && ts < hi) days[i].classList.add('in-range');
      }
    }
  }

  function buildCalendar() {
    var wrap = el('div', { className: 'led-cal' });

    // nav
    var nav = el('div', { className: 'led-cal-nav' });
    var prevBtn = el('button', { className: 'led-cal-nav-btn', onClick: function() {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      var calEl = wrap.parentElement.querySelector('.led-cal');
      if (calEl) calEl.replaceWith(buildCalendar());
    }}, '◀');
    var nextBtn = el('button', { className: 'led-cal-nav-btn', onClick: function() {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      var calEl = wrap.parentElement.querySelector('.led-cal');
      if (calEl) calEl.replaceWith(buildCalendar());
    }}, '▶');
    var monthLabel = el('span', { className: 'led-cal-month' }, calYear + '년 ' + (calMonth + 1) + '월');
    nav.appendChild(prevBtn);
    nav.appendChild(monthLabel);
    nav.appendChild(nextBtn);
    wrap.appendChild(nav);

    // grid
    var grid = el('div', { className: 'led-cal-grid' });
    var dayNames = ['일','월','화','수','목','금','토'];
    dayNames.forEach(function(dn) {
      grid.appendChild(el('div', { className: 'led-cal-hdr' }, dn));
    });

    var firstDay = new Date(calYear, calMonth, 1).getDay();
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var today = fmtDate(new Date());

    // empty cells before first day
    for (var e = 0; e < firstDay; e++) {
      grid.appendChild(el('div', { className: 'led-cal-day empty' }));
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var dk = calYear + '-' + pad(calMonth + 1) + '-' + pad(d);
      var count = dateCounts[dk] || 0;
      var cls = 'led-cal-day';
      if (count > 0) cls += ' has-msg';
      if (count > 20) cls += ' has-many';
      if (dk === today) cls += ' today';

      // range check (committed range when not dragging)
      if (!calDragging) {
        var ts2 = new Date(calYear, calMonth, d).getTime();
        var fromDay = settings.dateFrom ? startOfDay(settings.dateFrom) : null;
        var toDay = settings.dateTo ? startOfDay(settings.dateTo) : null;
        if (fromDay !== null && toDay !== null) {
          if (ts2 === fromDay) cls += ' range-start';
          if (ts2 === toDay) cls += ' range-end';
          if (ts2 > fromDay && ts2 < toDay) cls += ' in-range';
          if (fromDay === toDay && ts2 === fromDay) cls += ' range-start range-end';
        }
      }

      var dayEl = el('div', { className: cls }, '' + d);
      var ts = new Date(calYear, calMonth, d).getTime();
      dayEl.setAttribute('data-ts', '' + ts);

      (function(dayTs) {
        dayEl.addEventListener('mousedown', function(e) {
          e.preventDefault();
          calDragging = true;
          calDragAnchor = dayTs;
          calDragEnd = dayTs;
          updateCalDragVisual(grid);
          document.addEventListener('mouseup', onCalDragEnd);
        });
        dayEl.addEventListener('mouseenter', function() {
          if (calDragging) {
            calDragEnd = dayTs;
            updateCalDragVisual(grid);
          }
        });
      })(ts);

      grid.appendChild(dayEl);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  // ════════════════════════════════════════════════════════════════
  //  TAB: 스타일
  // ════════════════════════════════════════════════════════════════

  function buildStyleTab(body) {
    // 테마 프리셋
    var sec1 = el('div', { className: 'led-section' });
    sec1.appendChild(el('div', { className: 'led-label' }, '테마 프리셋'));
    var themeSelect = el('select', { className: 'led-select' });
    themeSelect.appendChild(el('option', { value: 'default' }, '기본 (어두운 테마)'));
    themeSelect.value = settings.theme;
    themeSelect.addEventListener('change', function() {
      settings.theme = themeSelect.value;
      if (settings.theme === 'default') settings.colors = Object.assign({}, DEFAULT_COLORS);
      renderLeftBody(); schedulePreview();
    });
    sec1.appendChild(themeSelect);
    sec1.appendChild(el('div', { className: 'led-info' }, '프리셋은 향후 추가될 예정입니다.'));
    body.appendChild(sec1);

    // 폰트
    var sec2 = el('div', { className: 'led-section' });
    sec2.appendChild(el('div', { className: 'led-label' }, '폰트'));
    var fontSelect = el('select', { className: 'led-select' });
    FONT_PRESETS.forEach(function(fp) {
      var opt = el('option', { value: fp.label }, fp.label);
      fontSelect.appendChild(opt);
    });
    fontSelect.appendChild(el('option', { value: '__custom__' }, '커스텀 웹 폰트...'));
    fontSelect.value = settings.font === '__custom__' ? '__custom__' :
      (FONT_PRESETS.find(function(f) { return f.label === settings.font; }) ? settings.font : '__custom__');
    fontSelect.addEventListener('change', function() {
      if (fontSelect.value === '__custom__') {
        settings.font = '__custom__';
      } else {
        settings.font = fontSelect.value;
        settings.customFontUrl = '';
      }
      renderLeftBody(); schedulePreview();
    });
    sec2.appendChild(fontSelect);

    if (settings.font === '__custom__' || !FONT_PRESETS.find(function(f) { return f.label === settings.font; })) {
      var customInput = el('input', {
        className: 'led-input',
        type: 'text',
        placeholder: 'Google Fonts CSS URL (https://fonts.googleapis.com/css2?...)',
        value: settings.customFontUrl || '',
        style: { marginTop: '6px' },
      });
      customInput.addEventListener('input', function() { settings.customFontUrl = customInput.value; });
      sec2.appendChild(customInput);

      var fontNameInput = el('input', {
        className: 'led-input',
        type: 'text',
        placeholder: '폰트 이름 (예: Nanum Gothic)',
        value: settings.font === '__custom__' ? '' : settings.font,
        style: { marginTop: '4px' },
      });
      fontNameInput.addEventListener('input', function() {
        if (fontNameInput.value) settings.font = fontNameInput.value;
      });
      sec2.appendChild(fontNameInput);
    }

    var fontPreview = el('div', {
      style: { marginTop: '8px', padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '5px',
               fontFamily: '"' + settings.font + '",sans-serif', fontSize: '14px' }
    }, '폰트 미리보기: 가나다라마바사 ABCDEFG 1234567890');
    sec2.appendChild(fontPreview);
    body.appendChild(sec2);

    // 색상
    var sec3 = el('div', { className: 'led-section' });
    sec3.appendChild(el('div', { className: 'led-label' }, '색상'));
    var colorGrid = el('div', { className: 'led-color-grid' });
    var editableColors = ['bg','bgPanel','bgLog','text','sysBg','sysText','altBg','altText'];
    editableColors.forEach(function(ck) {
      var item = el('div', { className: 'led-color-item' });
      var swatch = el('div', { className: 'led-color-swatch' });
      swatch.style.backgroundColor = settings.colors[ck] || DEFAULT_COLORS[ck] || '#888';
      var colorInput = el('input', { type: 'color', value: toHex(settings.colors[ck] || DEFAULT_COLORS[ck] || '#888888') });
      colorInput.addEventListener('input', function() {
        settings.colors[ck] = colorInput.value;
        swatch.style.backgroundColor = colorInput.value;
      });
      swatch.appendChild(colorInput);
      item.appendChild(swatch);
      item.appendChild(el('div', { className: 'led-color-name' }, COLOR_LABELS[ck] || ck));
      colorGrid.appendChild(item);
    });
    sec3.appendChild(colorGrid);
    var resetBtn = el('button', { className: 'led-btn led-btn-secondary', style: { marginTop: '8px' } }, '기본값으로 초기화');
    resetBtn.addEventListener('click', function() {
      settings.colors = Object.assign({}, DEFAULT_COLORS);
      renderLeftBody(); schedulePreview();
    });
    sec3.appendChild(resetBtn);
    body.appendChild(sec3);
  }

  function toHex(c) {
    if (!c) return '#888888';
    if (c.charAt(0) === '#' && c.length >= 7) return c.substring(0, 7);
    if (c.charAt(0) === '#' && c.length === 4) {
      return '#' + c[1]+c[1] + c[2]+c[2] + c[3]+c[3];
    }
    // rgba → hex approximation
    var m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return '#' + pad16(+m[1]) + pad16(+m[2]) + pad16(+m[3]);
    return '#888888';
  }
  function pad16(n) { var h = n.toString(16); return h.length < 2 ? '0' + h : h; }

  // ════════════════════════════════════════════════════════════════
  //  TAB: 내보내기
  // ════════════════════════════════════════════════════════════════

  function buildExportTab(body) {
    var sec1 = el('div', { className: 'led-section' });
    sec1.appendChild(el('div', { className: 'led-label' }, '내보내기 방식'));

    var radioGroup = el('div', { className: 'led-radio-group' });

    var opt1 = buildRadioOption('htmlFile', 'HTML 파일 다운로드',
      '완전한 HTML 파일로 다운로드합니다. 오프라인에서도 볼 수 있습니다.');
    var opt2 = buildRadioOption('clipboard', 'HTML 복사 (블로그용)',
      'HTML+CSS 코드를 클립보드에 복사합니다. 티스토리 등 블로그 HTML 편집기에 붙여넣기 하세요.');

    radioGroup.appendChild(opt1);
    radioGroup.appendChild(opt2);
    sec1.appendChild(radioGroup);
    body.appendChild(sec1);

    // filename preview
    var sec2 = el('div', { className: 'led-section' });
    var filename = 'log_' + (settings.title || roomName || 'cocofolia') + '_' + fmtDateFile(new Date()) + '.html';
    sec2.appendChild(el('div', { className: 'led-info' }, '파일명: ' + filename));
    body.appendChild(sec2);

    // export button
    var sec3 = el('div', { className: 'led-section', style: { textAlign: 'center', paddingTop: '6px' } });
    var exportBtn = el('button', {
      className: 'led-btn led-btn-primary',
      style: { padding: '12px 44px', fontSize: '15px' },
      onClick: doExport
    }, '내보내기');
    sec3.appendChild(exportBtn);
    body.appendChild(sec3);
  }

  function buildRadioOption(value, label, desc) {
    var opt = el('div', {
      className: 'led-radio' + (settings.exportFormat === value ? ' selected' : ''),
      onClick: function() { settings.exportFormat = value; renderLeftBody(); }
    });
    opt.appendChild(el('div', { className: 'led-radio-dot' }));
    var text = el('div');
    text.appendChild(el('div', { className: 'led-radio-label' }, label));
    text.appendChild(el('div', { className: 'led-radio-desc' }, desc));
    opt.appendChild(text);
    return opt;
  }

  // ════════════════════════════════════════════════════════════════
  //  내보내기 실행
  // ════════════════════════════════════════════════════════════════

  function doExport() {
    var filtered = getFilteredMessages();
    if (!filtered.length) {
      alert('내보낼 메시지가 없습니다. 필터 설정을 확인해주세요.');
      return;
    }

    var title = settings.title || roomName || '코코포리아';
    var htmlContent = generateExportHtml(filtered, title, false);

    if (settings.exportFormat === 'clipboard') {
      // Extract body content + style for blog
      var bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      var styleMatch = htmlContent.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
      var clipHtml = '';
      if (styleMatch) clipHtml += '<style>\n' + styleMatch[1] + '\n</style>\n';
      if (bodyMatch) clipHtml += bodyMatch[1];
      navigator.clipboard.writeText(clipHtml).then(function() {
        alert('HTML이 클립보드에 복사되었습니다!\n블로그 HTML 편집기에 붙여넣기 하세요.');
      }).catch(function() {
        // fallback: textarea copy
        var ta = document.createElement('textarea');
        ta.value = clipHtml;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('HTML이 클립보드에 복사되었습니다!');
      });
    } else {
      var filename = 'log_' + title.replace(/[^a-zA-Z0-9가-힣_-]/g, '_') + '_' + fmtDateFile(new Date()) + '.html';
      var blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert(filtered.length + '건 로그를 ' + filename + '으로 내보냈습니다!');
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  HTML 생성 (설정 반영)
  // ════════════════════════════════════════════════════════════════

  function generateExportHtml(messages, title, isPreview) {
    var c = settings.colors;
    var fontFamily = '"' + settings.font + '",sans-serif';
    var fontUrl = '';
    if (settings.font === '__custom__' || settings.customFontUrl) {
      fontUrl = settings.customFontUrl;
    } else {
      var fp = FONT_PRESETS.find(function(f) { return f.label === settings.font; });
      if (fp) fontUrl = fp.url;
    }

    var now = new Date();
    var exportDate = fmtDateTime(now);
    var total = messages.length;

    // ── filter & clean ──
    var filtered = messages.filter(function(m) {
      return (m.text && m.text.trim()) || m.imageUrl || m.diceResult;
    }).map(function(m) {
      if (m.text) {
        var t = m.text.replace(/\r\n/g, '\n');
        var lines = t.split('\n');
        for (var j = 0; j < lines.length; j++) lines[j] = lines[j].trimEnd();
        while (lines.length && !lines[0].trim()) lines.shift();
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        var cleaned = [];
        var emptyCount = 0;
        for (var li = 0; li < lines.length; li++) {
          if (!lines[li].trim()) { emptyCount++; if (emptyCount <= 1) cleaned.push(''); }
          else { emptyCount = 0; cleaned.push(lines[li]); }
        }
        m = Object.assign({}, m, { text: cleaned.join('\n') });
      }
      return m;
    });

    function cleanHtml(raw) {
      var h = esc(raw || '').replace(/\n/g, '<br>');
      h = h.replace(/^(<br\s*\/?>)+/gi, '');
      h = h.replace(/(<br\s*\/?>)+$/gi, '');
      h = h.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
      return h;
    }

    var prevDate = '';
    var prevKey = '';
    var prevChannel = '';
    var groupStartTime = 0;
    var GROUP_GAP = 600000;
    var inAltSection = false;
    var sysBuffer = [];
    var sysGroupStart = 0;
    var rows = [];

    function flushSys() {
      if (!sysBuffer.length) return;
      var ts = sysGroupStart ? fmtTime(new Date(sysGroupStart)) : '';
      rows.push('<div class="sys-block">' + (ts ? '<div class="sys-time">' + ts + '</div>' : '') + sysBuffer.join('') + '</div>');
      sysBuffer = [];
    }
    function openAlt(chName) {
      if (inAltSection) return;
      rows.push('<div class="alt-section"><div class="alt-ch-name">' + esc(chName) + '</div>');
      inAltSection = true;
    }
    function closeAlt() {
      if (!inAltSection) return;
      rows.push('</div>');
      inAltSection = false;
    }

    // ── 합 블록 사전 탐색 ──
    var hapBlocks = [];
    var hs = -1;
    for (var j = 0; j < filtered.length; j++) {
      var txt = filtered[j].text || '';
      if (/《합\s*개시》/.test(txt)) {
        hs = j;
      } else if (hs >= 0 && /《합\s*(승리|종료|중지)》/.test(txt)) {
        var rounds = 0;
        var isDraw = /무승부/.test(txt) || /《합\s*종료》/.test(txt);
        var startText = filtered[hs].text || '';
        var atkMatch = startText.match(/⚔\uFE0F?\s*(.+?)\s*-\s*\d+/);
        var defMatch = startText.match(/🛡\uFE0F?\s*(.+?)\s*-\s*\d+/);
        var atkName = atkMatch ? atkMatch[1].trim() : '';
        var defName = defMatch ? defMatch[1].trim() : '';
        var winnerName = '';
        var winnerSide = 'draw';
        if (!isDraw) {
          var wm = txt.match(/[⚔️🛡️]\s*(.+?)(?:\s*@|\s*$)/);
          if (wm) winnerName = wm[1].trim();
          if (winnerName === atkName) winnerSide = 'attacker';
          else if (winnerName === defName) winnerSide = 'defender';
          else winnerSide = 'attacker';
        }
        var atkColor = '#d0d0d0', defColor = '#d0d0d0';
        var atkIcon = '', defIcon = '';
        var winnerDice = '';
        for (var k = hs; k <= j; k++) {
          var km = filtered[k]; var kt = km.text || '';
          if (/《\d+합》/.test(kt)) rounds++;
          if (km.name === atkName && !atkIcon) { atkIcon = km.iconUrl || ''; atkColor = km.color || '#d0d0d0'; }
          if (km.name === defName && !defIcon) { defIcon = km.iconUrl || ''; defColor = km.color || '#d0d0d0'; }
          if (winnerName && km.name === winnerName && km.diceResult) winnerDice = km.diceResult;
        }
        hapBlocks.push({ startIdx: hs, endIdx: j, rounds: rounds, isDraw: isDraw,
          atkName: atkName, defName: defName, atkColor: atkColor, defColor: defColor,
          winnerName: winnerName, winnerSide: winnerSide, winnerDice: winnerDice });
        hs = -1;
      }
    }
    var hapIndexMap = {};
    for (var bi = 0; bi < hapBlocks.length; bi++) {
      var bk = hapBlocks[bi];
      for (var ki = bk.startIdx; ki <= bk.endIdx; ki++) {
        hapIndexMap[ki] = { blockIdx: bi, isStart: ki === bk.startIdx };
      }
    }

    function renderSingleMsg(msg) {
      var escaped = cleanHtml(msg.text);
      var si = msg.imageUrl && msg.imageUrl !== msg.iconUrl;
      var ih = si ? '<div class="msg-img"><img src="' + esc(msg.imageUrl) + '" loading="lazy"></div>' : '';
      var dh = msg.diceResult ? '<div class="dice"><span class="dice-icon">&#x1F3B2;</span><span class="dice-val">' + esc(msg.diceResult) + '</span></div>' : '';
      var isSys = msg.type === 'system' || msg.name === 'system';
      if (isSys) {
        var timeS = msg.createdAt ? fmtTime(new Date(msg.createdAt)) : '';
        return '<div class="sys-block"><div class="sys-time">' + timeS + '</div>' + (escaped ? '<div class="sys-line">' + escaped + '</div>' : '') + dh + ih + '</div>';
      }
      var iconSrc = msg.iconUrl ? esc(msg.iconUrl) : '';
      var key = msg.name || '';
      var aviInner = iconSrc ? '<img src="' + iconSrc + '" alt="" loading="lazy">' :
        '<span class="avi-letter">' + esc(key.charAt(0) || '?') + '</span>';
      var nc = msg.color || '#d0d0d0';
      var ts = msg.createdAt ? fmtTime(new Date(msg.createdAt)) : '';
      return '<div class="msg"><div class="msg-gutter"><div class="avi">' + aviInner + '</div></div><div class="msg-body"><div class="msg-head"><span class="msg-name" style="color:' + esc(nc) + '">' + esc(key) + '</span><span class="msg-ts">' + ts + '</span></div>' + (escaped ? '<div class="msg-text">' + escaped + '</div>' : '') + dh + ih + '</div></div>';
    }

    // ── main loop ──
    for (var i = 0; i < filtered.length; i++) {
      var msg = filtered[i];
      var isSys = msg.type === 'system' || msg.name === 'system';
      var curKey = isSys ? '__system__' : (msg.name || '');
      var curCh = msg.channelName || msg.channel || '';
      var mainCh = isMainChannel(msg);

      var dateStr = msg.createdAt ? fmtDate(new Date(msg.createdAt)) : '';
      if (dateStr && dateStr !== prevDate) {
        flushSys(); closeAlt();
        rows.push('<div class="date-sep"><div class="date-line"></div><span class="date-text">' + dateStr + '</span><div class="date-line"></div></div>');
        prevDate = dateStr; prevKey = ''; prevChannel = ''; groupStartTime = 0;
      }

      if (curCh !== prevChannel) {
        flushSys();
        if (mainCh) { closeAlt(); rows.push('<div class="main-ch-name">MAIN</div>'); }
        else { closeAlt(); openAlt(msg.channelName || curCh); }
        prevKey = ''; groupStartTime = 0;
      }

      var escaped = cleanHtml(msg.text);
      var showImage = msg.imageUrl && msg.imageUrl !== msg.iconUrl;
      var imgHtml = showImage ? '<div class="msg-img"><img src="' + esc(msg.imageUrl) + '" loading="lazy"></div>' : '';
      var diceHtml = msg.diceResult ? '<div class="dice"><span class="dice-icon">&#x1F3B2;</span><span class="dice-val">' + esc(msg.diceResult) + '</span></div>' : '';
      var whisperTag = msg.to ? '<span class="whisper-badge">&#x1F512; → ' + esc(msg.toName || msg.to) + '</span>' : '';

      // 합 블록
      var hapInfo = hapIndexMap[i];
      if (hapInfo && hapInfo.isStart) {
        flushSys();
        var b = hapBlocks[hapInfo.blockIdx];
        var innerParts = [];
        for (var ki2 = b.startIdx; ki2 <= b.endIdx; ki2++) innerParts.push(renderSingleMsg(filtered[ki2]));
        var resultLabel = b.isDraw ? '무승부' : '승리!';
        var eAtkName = esc(b.atkName || '???'), eDefName = esc(b.defName || '???');
        var eAtkColor = esc(b.atkColor), eDefColor = esc(b.defColor);
        var atkBright = b.winnerSide === 'attacker' || b.isDraw;
        var defBright = b.winnerSide === 'defender' || b.isDraw;
        rows.push('<details class="hap-fold"><summary class="hap-fold-summary">' +
          '<div class="hap-fold-badge">' + resultLabel + '</div>' +
          '<div class="hap-fold-sep"><div class="hap-fold-line"></div><span class="hap-fold-rounds">' + b.rounds + '합</span><div class="hap-fold-line"></div></div>' +
          '<div class="hap-fold-versus"><span class="hap-fold-fighter' + (atkBright ? '' : ' dim') + '" style="color:' + eAtkColor + '">⚔️ ' + eAtkName + '</span><span class="hap-fold-vs">vs</span><span class="hap-fold-fighter' + (defBright ? '' : ' dim') + '" style="color:' + eDefColor + '">🛡️ ' + eDefName + '</span></div>' +
          (b.winnerDice ? '<div class="hap-fold-dice">' + esc(b.winnerDice) + '</div>' : '') +
          '</summary><div class="hap-fold-body">' + innerParts.join('\n') + '</div></details>');
        i = b.endIdx;
        prevKey = ''; prevChannel = curCh; groupStartTime = 0;
        continue;
      }
      if (hapInfo) continue;

      if (isSys) {
        if (sysBuffer.length && msg.createdAt - sysGroupStart >= GROUP_GAP) flushSys();
        if (!sysBuffer.length) sysGroupStart = msg.createdAt || 0;
        sysBuffer.push((escaped ? '<div class="sys-line">' + escaped + '</div>' : '') + diceHtml + imgHtml);
        prevKey = '__system__'; prevChannel = curCh;
        continue;
      }

      flushSys();
      if (prevKey && prevKey !== curKey && prevKey !== '__system__') rows.push('<div class="divider"></div>');

      var timeDiff = msg.createdAt - groupStartTime;
      var sameGroup = (curKey === prevKey) && (curCh === prevChannel) && (timeDiff < GROUP_GAP);
      if (!sameGroup) groupStartTime = msg.createdAt || 0;
      var timeStr = msg.createdAt ? fmtTime(new Date(msg.createdAt)) : '';

      if (sameGroup) {
        rows.push('<div class="msg grouped"><div class="msg-gutter"></div><div class="msg-body">' + whisperTag +
          (escaped ? '<div class="msg-text">' + escaped + '</div>' : '') + diceHtml + imgHtml + '</div></div>');
      } else {
        var iconSrc = msg.iconUrl ? esc(msg.iconUrl) : '';
        var aviInner = iconSrc ? '<img src="' + iconSrc + '" alt="" loading="lazy">' :
          '<span class="avi-letter">' + esc(curKey ? curKey.charAt(0) : '?') + '</span>';
        var nameColor = msg.color || '#d0d0d0';
        rows.push('<div class="msg"><div class="msg-gutter"><div class="avi">' + aviInner + '</div></div><div class="msg-body">' +
          '<div class="msg-head"><span class="msg-name" style="color:' + esc(nameColor) + '">' + esc(curKey) + '</span><span class="msg-ts">' + timeStr + '</span>' + whisperTag + '</div>' +
          (escaped ? '<div class="msg-text">' + escaped + '</div>' : '') + diceHtml + imgHtml + '</div></div>');
      }

      prevKey = curKey; prevChannel = curCh;
    }
    flushSys(); closeAlt();

    // ── Header image HTML ──
    var headerImgHtml = '';
    if (settings.headerImage) {
      headerImgHtml = '<div class="hdr-img"><img src="' + settings.headerImage + '" alt=""></div>';
    }

    // ── Build full document ──
    return '<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>' + esc(title) + ' - 채팅 로그</title>\n' +
    (fontUrl ? '<link rel="stylesheet" href="' + esc(fontUrl) + '">\n' : '') +
    '<style>\n' +
    '@import url(\'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600;700&display=swap\');\n' +
    ':root{\n' +
    '  --bg:' + c.bg + ';\n' +
    '  --bg-panel:' + c.bgPanel + ';\n' +
    '  --bg-log:' + c.bgLog + ';\n' +
    '  --bg-card:' + (c.bgCard || '#1d1d22') + ';\n' +
    '  --border:rgba(200,200,210,.06);\n' +
    '  --border-hard:rgba(200,200,210,.11);\n' +
    '  --text:' + c.text + ';\n' +
    '  --text-sub:' + (c.textSub || 'rgba(225,225,230,.65)') + ';\n' +
    '  --text-dim:' + (c.textDim || 'rgba(170,170,180,.35)') + ';\n' +
    '  --sys-bg:' + c.sysBg + ';\n' +
    '  --sys-text:' + c.sysText + ';\n' +
    '  --whisper-c:#c0a8f0;\n' +
    '  --whisper-bg:rgba(192,168,240,.08);\n' +
    '}\n' +
    '*{margin:0;padding:0;box-sizing:border-box}\n' +
    'body{\n' +
    '  font-family:' + fontFamily + ';\n' +
    '  background:var(--bg);color:var(--text);\n' +
    '  min-height:100vh;line-height:1.6;font-size:16px;\n' +
    '  -webkit-font-smoothing:antialiased;position:relative;padding:24px 0 0;\n' +
    '}\n' +
    'body::before{content:\'\';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(circle,rgba(0,0,0,.10) 1px,transparent 1px);background-size:14px 14px;}\n' +
    '.hdr{position:sticky;top:0;z-index:200;background:var(--bg-panel);border-bottom:1px solid var(--border-hard);padding:18px 32px;display:flex;align-items:center;justify-content:space-between;max-width:860px;margin:0 auto;border-radius:12px 12px 0 0;box-shadow:0 -8px 32px rgba(0,0,0,.12);}\n' +
    '.hdr-title{font-size:18px;font-weight:900;color:var(--text)}\n' +
    '.hdr-meta{font-size:12px;color:var(--text-dim);display:flex;gap:16px;font-weight:500}\n' +
    '.hdr-img{max-width:860px;margin:0 auto;}\n' +
    '.hdr-img img{width:100%;display:block;}\n' +
    '.log-wrap{position:relative;z-index:1;max-width:860px;margin:0 auto;padding:20px 0 60px;background:var(--bg-log);min-height:calc(100vh - 100px);overflow:hidden;box-shadow:0 4px 40px rgba(0,0,0,.10);}\n' +
    '.log-wrap::after{content:\'\';position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(circle,rgba(255,255,255,.14) 1px,transparent 1px);background-size:16px 16px;mask-image:linear-gradient(to right,rgba(0,0,0,.9) 0%,transparent 30%,transparent 70%,rgba(0,0,0,.9) 100%);-webkit-mask-image:linear-gradient(to right,rgba(0,0,0,.9) 0%,transparent 30%,transparent 70%,rgba(0,0,0,.9) 100%);}\n' +
    '.log-wrap>*{position:relative;z-index:1}\n' +
    '.date-sep{display:flex;align-items:center;gap:20px;padding:44px 28px 22px;user-select:none;}\n' +
    '.date-line{flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(255,255,255,.2),transparent);}\n' +
    '.date-text{font-size:15px;font-weight:700;color:#fff;letter-spacing:4px;white-space:nowrap;}\n' +
    '.main-ch-name{font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,.55);text-transform:uppercase;padding:6px 40px 10px;margin-top:14px;}\n' +
    '.alt-section{background:' + c.altBg + ';color:' + c.altText + ';margin:28px 0;padding:14px 0 18px;border-top:1px solid rgba(0,0,0,.08);border-bottom:1px solid rgba(0,0,0,.08);}\n' +
    '.alt-ch-name{font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(0,0,0,.5);text-transform:uppercase;padding:6px 40px 10px;}\n' +
    '.alt-section .msg-text{color:rgba(0,0,0,.85)}.alt-section .msg-name{color:#111!important}.alt-section .msg-ts{color:rgba(0,0,0,.45)}.alt-section .avi{background:#d0d0d5}.alt-section .avi-letter{background:#d0d0d5;color:rgba(0,0,0,.25)}.alt-section .divider{background:rgba(0,0,0,.08)}\n' +
    '.alt-section .sys-block{background:#dddde2;border-color:rgba(0,0,0,.08);}.alt-section .sys-line{color:rgba(0,0,0,.7)}.alt-section .sys-time{color:rgba(0,0,0,.4)}\n' +
    '.alt-section .dice{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.12);}.alt-section .dice-val{color:rgba(0,0,0,.75)}.alt-section .dice-icon{filter:grayscale(1) brightness(.4)}\n' +
    '.alt-section .date-line{background:linear-gradient(to right,transparent,rgba(0,0,0,.15),transparent)}.alt-section .date-text{color:rgba(0,0,0,.65)}\n' +
    '.alt-section .whisper-badge{color:#7a5cb0;background:rgba(122,92,176,.08);border-color:rgba(122,92,176,.18);}\n' +
    '.divider{height:1px;margin:12px 0;background:var(--border-hard)}\n' +
    '.msg{display:flex;padding:3px 28px}.msg:not(.grouped){margin-top:14px}\n' +
    '.msg-gutter{width:92px;flex-shrink:0;display:flex;align-items:flex-start;justify-content:center;padding-top:2px;}\n' +
    '.avi{width:80px;height:80px;border-radius:14px;overflow:hidden;background:var(--bg-card);flex-shrink:0;}\n' +
    '.avi img{width:100%;height:100%;object-fit:cover;object-position:center 5%;display:block}\n' +
    '.avi-letter{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;color:var(--text-dim);background:var(--bg-card);}\n' +
    '.msg-body{flex:1;min-width:0;padding:0 12px}\n' +
    '.msg-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:3px}\n' +
    '.msg-name{font-size:16px;font-weight:700}.msg-ts{font-size:12px;color:var(--text-dim);font-weight:500}\n' +
    '.msg-text{font-size:16px;line-height:1.7;color:#fff;word-break:break-word;}\n' +
    '.dice{display:inline-flex;align-items:center;gap:8px;margin:6px 0 2px;padding:8px 18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;}\n' +
    '.dice-icon{font-size:17px;line-height:1;flex-shrink:0}.dice-val{font-family:"IBM Plex Mono","Consolas",monospace;font-size:15px;font-weight:700;color:rgba(255,255,255,.88);letter-spacing:.5px;}\n' +
    '.msg-img{margin:8px 0 4px}.msg-img img{max-width:320px;max-height:320px;border-radius:12px;border:1px solid var(--border-hard);display:block;}\n' +
    '.whisper-badge{font-size:12px;font-weight:700;color:var(--whisper-c);background:var(--whisper-bg);border:1px solid rgba(192,168,240,.18);border-radius:3px;padding:1px 8px;white-space:nowrap;}\n' +
    '.sys-block{background:var(--sys-bg);border-top:1px solid var(--border-hard);border-bottom:1px solid var(--border-hard);margin:14px 0;padding:16px 48px;text-align:center;}\n' +
    '.sys-time{font-size:12px;color:var(--text-dim);font-weight:500;margin-bottom:6px}\n' +
    '.sys-line{font-size:15px;line-height:1.7;color:var(--sys-text);word-break:break-word;font-style:italic;}.sys-line+.sys-line{margin-top:2px}\n' +
    '.sys-block .dice{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.08);}\n' +
    '.hap-fold{margin:20px 0;border-top:1px solid var(--border-hard);border-bottom:1px solid var(--border-hard);overflow:hidden;}\n' +
    '.hap-fold-summary{cursor:pointer;list-style:none;display:flex;flex-direction:column;align-items:center;padding:28px 32px 22px;background:rgba(255,255,255,.03);user-select:none;transition:background .15s;gap:10px;}\n' +
    '.hap-fold-summary:hover{background:rgba(255,255,255,.06)}.hap-fold-summary::-webkit-details-marker{display:none}\n' +
    '.hap-fold-badge{font-size:20px;font-weight:900;color:#5b9bf0;letter-spacing:3px;}\n' +
    '.hap-fold-sep{display:flex;align-items:center;gap:12px;width:80%;max-width:320px;}\n' +
    '.hap-fold-line{flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(255,255,255,.18),transparent);}\n' +
    '.hap-fold-rounds{font-size:14px;font-weight:700;color:rgba(255,255,255,.35);white-space:nowrap;letter-spacing:1px;}\n' +
    '.hap-fold-versus{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:700;}\n' +
    '.hap-fold-fighter{transition:opacity .15s}.hap-fold-fighter.dim{opacity:.35}\n' +
    '.hap-fold-vs{font-size:13px;font-weight:500;color:rgba(255,255,255,.28);letter-spacing:1px;}\n' +
    '.hap-fold-dice{font-family:"IBM Plex Mono","Consolas",monospace;font-size:14px;font-weight:600;color:rgba(255,255,255,.3);letter-spacing:.5px;margin-top:2px;}\n' +
    '.hap-fold[open]>.hap-fold-summary{border-bottom:1px solid rgba(255,255,255,.08);}\n' +
    '.hap-fold-body{padding:12px 0;}\n' +
    '.alt-section .hap-fold{border-color:rgba(0,0,0,.1)}.alt-section .hap-fold-summary{background:rgba(0,0,0,.03)}.alt-section .hap-fold-summary:hover{background:rgba(0,0,0,.06)}\n' +
    '.alt-section .hap-fold-badge{color:#3b7ad0}.alt-section .hap-fold-line{background:linear-gradient(to right,transparent,rgba(0,0,0,.12),transparent)}\n' +
    '.alt-section .hap-fold-rounds{color:rgba(0,0,0,.4)}.alt-section .hap-fold-fighter{color:#222!important}.alt-section .hap-fold-vs{color:rgba(0,0,0,.35)}\n' +
    '.alt-section .hap-fold-dice{color:rgba(0,0,0,.35)}.alt-section .hap-fold[open]>.hap-fold-summary{border-bottom-color:rgba(0,0,0,.08)}\n' +
    '.ftr{max-width:860px;margin:0 auto;background:var(--bg-log);text-align:center;padding:24px;font-size:12px;color:var(--text-dim);font-weight:500;border-top:1px solid var(--border);border-radius:0 0 12px 12px;}\n' +
    '@media print{body{background:#fff;color:#111}body::before,.log-wrap::after{display:none}.log-wrap,.ftr{background:#fafafa;box-shadow:none}.msg-text{color:#222}.sys-block{background:#f0f0f0;border-color:#ddd}.sys-line{color:#333}.msg-name{color:#111!important}.dice{background:#f4f4f4;border-color:#ccc}.dice-val{color:#111}.hdr{position:static;background:#f4f4f4;border-color:#ccc}.ftr{background:#fafafa}.alt-section{background:#f0f0f0;color:#111}}\n' +
    '</style>\n</head>\n<body>\n' +
    '<div class="hdr"><span class="hdr-title">' + esc(title) + ' — 채팅 로그</span><div class="hdr-meta"><span>' + total.toLocaleString() + '건</span><span>' + esc(exportDate) + '</span></div></div>\n' +
    headerImgHtml +
    '<div class="log-wrap">\n' + rows.join('\n') + '\n</div>\n' +
    '<div class="ftr">Exported by BWBR · ' + esc(exportDate) + '</div>\n' +
    '</body>\n</html>';
  }

  // ════════════════════════════════════════════════════════════════
  //  Public API
  // ════════════════════════════════════════════════════════════════

  window.LogExportDialog = { open: open, close: close };

})();
