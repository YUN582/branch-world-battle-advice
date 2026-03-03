/**
 * panel-manager.js — 스크린/마커 패널 + 시나리오 텍스트 일괄 관리
 *
 * 패널 목록(MuiPaper-elevation6) 감지 시:
 * - 헤더에 "선택" 버튼 주입 (→ 선택 모드 토글)
 * - 선택 모드: 아이템 클릭 → 파란 행 하이라이트로 선택/해제
 * - 하단 액션바:
 *   · 스크린/마커: 전체 선택, 표시 전환, 삭제
 *   · 시나리오 텍스트: 전체 선택, 삭제 (표시 전환 없음)
 *
 * ★ 각 패널별 독립 상태 (여러 패널 동시 지원)
 * ★ 선택 모드: document 캡처 단계에서 React 이벤트 완전 차단
 *
 * 크로스-월드: BWBR_Bridge.request()
 */
(function () {
  'use strict';

  const TAG = '[CE 패널관리]';

  /* ── 패널별 상태 (WeakMap: paper DOM → state) ─────── */
  const _states = new WeakMap();

  function getState(paper) {
    let s = _states.get(paper);
    if (!s) {
      s = {
        selectMode: false,
        selected: new Set(),
        itemMap: new Map(),   // domListItem → reduxData
        type: 'screens'       // 'screens' | 'markers' | 'notes'
      };
      _states.set(paper, s);
    }
    return s;
  }

  /* ── body 레벨 MUI 네이티브 스타일 툴팁 ──────────────── */
  let _tipEl = null;
  let _tipTimer = null;

  function showTip(anchor, text) {
    hideTip();
    _tipTimer = setTimeout(() => {
      if (!_tipEl) {
        _tipEl = document.createElement('div');
        _tipEl.className = 'bwbr-native-tooltip';
        Object.assign(_tipEl.style, {
          position: 'fixed', pointerEvents: 'none', zIndex: '1500',
          background: 'rgb(22, 22, 22)', color: '#fff',
          fontSize: '12px', fontFamily: 'Roboto, Helvetica, Arial, sans-serif',
          fontWeight: '500', lineHeight: '1.4em',
          padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap',
          opacity: '0', transition: 'opacity .15s'
        });
        document.body.appendChild(_tipEl);
      }
      _tipEl.textContent = text;
      _tipEl.style.left = '-9999px';
      _tipEl.style.top = '0';
      _tipEl.style.opacity = '0';
      const tipW = _tipEl.offsetWidth;
      const tipH = _tipEl.offsetHeight;
      const r = anchor.getBoundingClientRect();
      _tipEl.style.left = Math.max(4, r.left + r.width / 2 - tipW / 2) + 'px';
      _tipEl.style.top  = (r.top - tipH - 6) + 'px';
      requestAnimationFrame(() => { if (_tipEl) _tipEl.style.opacity = '1'; });
    }, 350);
  }

  function hideTip() {
    clearTimeout(_tipTimer);
    if (_tipEl) _tipEl.style.opacity = '0';
  }

  /* ══════════════════════════════════════════════════════════
   *  패널 목록 감지 — 모든 매칭 패널 반환
   * ══════════════════════════════════════════════════════════ */

  function findAllPanelLists() {
    const results = [];
    for (const paper of document.querySelectorAll('.MuiPaper-root.MuiPaper-elevation6')) {
      const h6 = paper.querySelector('h6');
      if (!h6) continue;
      const t = h6.textContent.trim();
      if (t.includes('스크린') || t.includes('スクリーン')) {
        results.push({ paper, title: t, type: 'screens' });
      } else if (t.includes('마커') || t.includes('マーカー')) {
        results.push({ paper, title: t, type: 'markers' });
      } else if (t.includes('시나리오') || t.includes('텍스트') ||
                 t.includes('シナリオ') || t.includes('テキスト')) {
        results.push({ paper, title: t, type: 'notes' });
      }
    }
    return results;
  }

  function getListItems(paper) {
    // 두 셀렉터 모두 조회 — 패널 유형에 따라 한쪽만 쓰이거나 혼용 가능
    const all = paper.querySelectorAll('.MuiListItemButton-root, .MuiListItem-root');
    // MuiListItem-root 이 자식으로 MuiListItemButton-root 을 포함하면 부모 제외 (중복 방지)
    return [...all].filter(el =>
      !el.classList.contains('MuiListItem-root') || !el.querySelector('.MuiListItemButton-root')
    );
  }

  function extractImagePath(el) {
    const img = el.querySelector('.MuiAvatar-root img, .MuiListItemAvatar-root img');
    if (!img || !img.src) return '';
    try { return new URL(img.src).pathname; } catch { return img.src; }
  }

  function parseSecondary(item) {
    const p = item.querySelector('.MuiListItemText-root p');
    if (!p) return null;
    const m = p.textContent.match(/\[(\d+)\]\s*(\d+)\s*[×x]\s*(\d+)/);
    return m ? { z: +m[1], w: +m[2], h: +m[3] } : null;
  }

  /* ══════════════════════════════════════════════════════════
   *  크로스-월드 통신
   * ══════════════════════════════════════════════════════════ */

  async function loadPanelData() {
    try {
      const result = await BWBR_Bridge.request(
        'bwbr-request-panel-list', 'bwbr-panel-list-data', {},
        { sendAttr: 'data-bwbr-request-panel-list', recvAttr: 'data-bwbr-panel-list-data', timeout: 5000 }
      );
      return result?.items || [];
    } catch (e) { console.error(TAG, '패널 데이터 로드 실패:', e.message); return []; }
  }

  async function loadNoteData() {
    try {
      const result = await BWBR_Bridge.request(
        'bwbr-request-note-list', 'bwbr-note-list-data', {},
        { sendAttr: 'data-bwbr-request-note-list', recvAttr: 'data-bwbr-note-list-data', timeout: 5000 }
      );
      return result?.items || [];
    } catch (e) { console.error(TAG, '노트 데이터 로드 실패:', e.message); return []; }
  }

  async function loadMarkerData() {
    try {
      const result = await BWBR_Bridge.request(
        'bwbr-request-marker-list', 'bwbr-marker-list-data', {},
        { sendAttr: 'data-bwbr-request-marker-list', recvAttr: 'data-bwbr-marker-list-data', timeout: 5000 }
      );
      return result?.items || [];
    } catch (e) { console.error(TAG, '마커 데이터 로드 실패:', e.message); return []; }
  }

  /**
   * 배치 작업 실행
   * 단계별 로그로 실패 지점 특정
   */
  async function doBatchOp(panelType, op, ids, extra) {
    const evSend = panelType === 'notes' ? 'bwbr-note-batch-op'
      : panelType === 'markers' ? 'bwbr-marker-batch-op' : 'bwbr-panel-batch-op';
    const sendAttr = 'data-' + evSend;
    const recvAttr = sendAttr + '-result';
    const el = document.documentElement;

    try {
      el.removeAttribute(recvAttr);
      el.setAttribute(sendAttr, JSON.stringify({ op, ids: ids || [], ...extra }));
      document.dispatchEvent(new CustomEvent(evSend));
      window.dispatchEvent(new CustomEvent(evSend));

      // 폴링 (5초: 50ms × 100)
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 50));
        const raw = el.getAttribute(recvAttr);
        if (raw) {
          el.removeAttribute(recvAttr);
          try { return JSON.parse(raw); }
          catch { return { success: false, error: 'JSON 파싱 실패' }; }
        }
      }
      return { success: false, error: '응답 대기 시간 초과' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /* ══════════════════════════════════════════════════════════
   *  DOM ↔ Redux 매핑
   * ══════════════════════════════════════════════════════════ */

  function buildItemMap(paper, items) {
    const s = getState(paper);
    const listItems = getListItems(paper);
    s.itemMap.clear();
    const usedIds = new Set();

    for (const domItem of listItems) {
      const domPath = extractImagePath(domItem);
      const domSec  = parseSecondary(domItem);
      for (const reduxItem of items) {
        if (usedIds.has(reduxItem._id)) continue;
        let rPath = '';
        try { rPath = new URL(reduxItem.imageUrl).pathname; } catch { rPath = reduxItem.imageUrl || ''; }
        if (domPath && rPath && domPath === rPath) { s.itemMap.set(domItem, reduxItem); usedIds.add(reduxItem._id); break; }
        if (domSec && reduxItem.z === domSec.z && reduxItem.width === domSec.w && reduxItem.height === domSec.h) {
          s.itemMap.set(domItem, reduxItem); usedIds.add(reduxItem._id); break;
        }
      }
    }
    const domIdxMap = [...listItems].map((li, i) => ({ li, i })).filter(x => !s.itemMap.has(x.li));
    const reduxLeftover = items.filter(it => !usedIds.has(it._id));
    for (let k = 0; k < Math.min(domIdxMap.length, reduxLeftover.length); k++) {
      s.itemMap.set(domIdxMap[k].li, reduxLeftover[k]); usedIds.add(reduxLeftover[k]._id);
    }
    // 매핑된 DOM 아이템에 data-bwbr-id 부여
    for (const [domItem, data] of s.itemMap) {
      domItem.dataset.bwbrId = data._id;
    }
  }

  function buildNoteMap(paper, notes) {
    const s = getState(paper);
    const listItems = getListItems(paper);
    s.itemMap.clear();
    const usedIds = new Set();

    for (const domItem of listItems) {
      const nameEl = domItem.querySelector('.MuiListItemText-root span');
      const domName = nameEl ? nameEl.textContent.trim() : '';
      if (!domName) continue;
      for (const note of notes) {
        if (usedIds.has(note._id)) continue;
        if (note.name === domName) { s.itemMap.set(domItem, note); usedIds.add(note._id); break; }
      }
    }
    const unmatched = [...listItems].filter(li => !s.itemMap.has(li));
    const leftover  = notes.filter(n => !usedIds.has(n._id));
    for (let i = 0; i < Math.min(unmatched.length, leftover.length); i++) {
      s.itemMap.set(unmatched[i], leftover[i]);
    }
  }

  // buildMarkerMap 삭제 — 마커도 buildItemMap 사용 (이미지+z/w/h+순서 폴백)

  /** 순서 기반 매핑 (마커 등 고유 식별자가 DOM에 없는 경우) */
  function buildOrderMap(paper, items) {
    const s = getState(paper);
    const listItems = getListItems(paper);
    s.itemMap.clear();
    const count = Math.min(listItems.length, items.length);
    for (let i = 0; i < count; i++) {
      s.itemMap.set(listItems[i], items[i]);
      listItems[i].dataset.bwbrId = items[i]._id;
    }
  }

  /** 매핑 재구축 (복제/삭제 후 DOM 변경 반영) */
  async function remapPanel(paper) {
    const s = getState(paper);
    let items;
    if (s.type === 'notes') items = await loadNoteData();
    else if (s.type === 'markers') items = await loadMarkerData();
    else {
      const all = await loadPanelData();
      items = all.filter(it => it.type === 'object');
    }
    if (s.type === 'notes') buildNoteMap(paper, items);
    else if (s.type === 'markers') buildOrderMap(paper, items);
    else buildItemMap(paper, items);
  }

  /** 매핑 재구축 + 선택 모드 UI 새로고침 (오버레이 재사용) */
  async function remapAndRefreshSelect(paper) {
    const s = getState(paper);
    if (!s.selectMode) return;

    // 1. pointer-events 차단
    for (const item of getListItems(paper)) {
      item.style.pointerEvents = 'none';
      item.style.background = '';
      const sort = item.closest('[aria-roledescription="sortable"]');
      if (sort) sort.style.pointerEvents = 'none';
    }

    // 2. 매핑 재구축
    await remapPanel(paper);

    // 3. 오버레이가 없으면 새로 생성, 있으면 높이만 갱신
    if (!s._overlay || !s._overlay.parentElement) {
      if (s._overlay?._resizeObs) s._overlay._resizeObs.disconnect();
      s._overlay?.remove();
      s._overlay = null;
      enterSelectMode(paper);
    } else {
      const cont = s._overlay.parentElement;
      s._overlay.style.height = Math.max(cont.scrollHeight, cont.clientHeight) + 'px';
    }

    // 4. 유효하지 않은 선택 항목 제거 + 시각적 복원
    const validIds = new Set([...s.itemMap.values()].map(d => d._id));
    for (const id of [...s.selected]) {
      if (!validIds.has(id)) s.selected.delete(id);
    }
    for (const [domItem, data] of s.itemMap) {
      domItem.style.background = s.selected.has(data._id) ? 'rgba(33,150,243,0.15)' : '';
    }

    refreshActionBar(paper);
  }

  /** DOM 변경 감지 후 remapAndRefreshSelect 실행 */
  function watchListAndRefresh(paper) {
    const container = paper.querySelector('.MuiList-root') || paper.querySelector('.MuiDialogContent-root');
    if (!container) { setTimeout(() => remapAndRefreshSelect(paper), 500); return; }

    // MutationObserver: DOM 변경 시 디바운스 후 1회 리맵
    let debounce, done = false;
    const exec = () => { if (done) return; done = true; obs.disconnect(); remapAndRefreshSelect(paper); };

    const obs = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(exec, 200);
    });
    obs.observe(container, { childList: true, subtree: true });

    // 안전장치: 2초 후 MutationObserver가 안 잡았으면 강제 리맵
    setTimeout(exec, 2000);
  }

  /* ══════════════════════════════════════════════════════════
   *  메인 주입
   * ══════════════════════════════════════════════════════════ */

  async function inject(paper, type) {
    if (paper.dataset.bwbrInjected) return;
    paper.dataset.bwbrInjected = '1';
    const s = getState(paper);
    s.type = type || 'screens';
    s.selected.clear();
    s.selectMode = false;

    let items;
    if (s.type === 'notes') {
      items = await loadNoteData();
    } else if (s.type === 'markers') {
      items = await loadMarkerData();
    } else {
      const all = await loadPanelData();
      items = all.filter(it => it.type === 'object');
    }
    if (!items.length) { console.log(TAG, '아이템 0개 — 주입 생략'); return; }

    if (s.type === 'notes') { buildNoteMap(paper, items); }
    else if (s.type === 'markers') { buildOrderMap(paper, items); }
    else                    { buildItemMap(paper, items); }
    injectSelectButton(paper);
  }

  /* ══════════════════════════════════════════════════════════
   *  헤더 "선택" 버튼
   * ══════════════════════════════════════════════════════════ */

  function injectSelectButton(paper) {
    const toolbar = paper.querySelector('.MuiToolbar-dense');
    if (!toolbar || toolbar.querySelector('.bwbr-panel-select-btn')) return;

    const nativeBtns = toolbar.querySelectorAll('button');
    if (!nativeBtns.length) return;
    const btnContainer = nativeBtns[0].parentElement;

    const btn = document.createElement('button');
    btn.className = 'bwbr-panel-select-btn';
    btn.textContent = '선택';
    Object.assign(btn.style, {
      background: 'none', border: 'none', cursor: 'pointer',
      color: 'rgba(255,255,255,0.5)', padding: '4px 8px',
      fontSize: '13px', fontFamily: 'Roboto, sans-serif',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '4px', transition: 'color .15s, background .15s',
      verticalAlign: 'middle', whiteSpace: 'nowrap', marginRight: '2px'
    });

    const tipText = () => {
      const s = getState(paper);
      return s.selectMode ? '선택 모드 종료' : '일괄 선택 모드';
    };
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.08)'; showTip(btn, tipText()); });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; hideTip(); });
    btn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); hideTip(); toggleSelectMode(paper); });

    btnContainer.insertBefore(btn, btnContainer.firstChild);
  }

  /* ══════════════════════════════════════════════════════════
   *  선택 모드 전환
   * ══════════════════════════════════════════════════════════ */

  async function toggleSelectMode(paper) {
    const s = getState(paper);
    s.selectMode = !s.selectMode;
    s.selected.clear();

    const btn = paper.querySelector('.bwbr-panel-select-btn');
    if (btn) {
      btn.style.color = s.selectMode ? '#2196F3' : 'rgba(255,255,255,0.5)';
      btn.textContent = s.selectMode ? '완료' : '선택';
    }

    if (s.selectMode) {
      // 선택 모드 진입 전: 즉시 pointer-events 차단 → 매핑 최신화 → 진입
      for (const item of getListItems(paper)) {
        item.style.pointerEvents = 'none';
        const sort = item.closest('[aria-roledescription="sortable"]');
        if (sort) sort.style.pointerEvents = 'none';
      }
      await remapPanel(paper);
      enterSelectMode(paper);
    }
    else { exitSelectMode(paper); }
  }

  /* ══════════════════════════════════════════════════════════
   *  선택 모드 진입/해제
   *
   *  핵심 원리 (React 클릭 100% 차단):
   *  ─────────────────────────────────────────
   *  1차 방어: document 캡처 단계에서 _captureBlocker가
   *    stopImmediatePropagation() → React #root 핸들러에 이벤트 미도달
   *  2차 방어: 아이템 + dnd-kit 래퍼에 pointer-events:none
   *    + 컨테이너에 투명 오버레이 배치 (좌표 히트 테스트)
   *
   *  실제 DOM (2026-03-03 진단):
   *  ─────────────────────────────────────────
   *  paper.MuiPaper-elevation6
   *    └─ div.MuiDialogContent-root.scrollable-list
   *       └─ div → div.sc-* (styled-component)
   *          └─ div → div[aria-roledescription="sortable"] (dnd-kit)
   *             └─ div.MuiListItemButton-root (클릭 아이템)
   *
   *  ⚠ MuiList-root 없음, MuiListItem-root 없음
   *    아이템: MuiListItemButton-root
   *    컨테이너: MuiDialogContent-root (또는 MuiList-root fallback)
   * ══════════════════════════════════════════════════════════ */

  function enterSelectMode(paper) {
    const s = getState(paper);
    // 시나리오 텍스트: MuiList-root 없음 → MuiDialogContent-root 사용
    const container = paper.querySelector('.MuiList-root') || paper.querySelector('.MuiDialogContent-root');
    if (!container) { console.warn(TAG, '컨테이너 없음 — 선택 모드 실패'); return; }

    // 1. 매핑된 아이템 + dnd-kit sortable 래퍼의 pointer-events 차단
    for (const item of getListItems(paper)) {
      if (s.itemMap.has(item)) {
        item.style.pointerEvents = 'none';
        const sortable = item.closest('[aria-roledescription="sortable"]');
        if (sortable) sortable.style.pointerEvents = 'none';
      }
    }

    // 2. 컨테이너에 position:relative 보장
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
      container._bwbrWasStatic = true;
    }

    // 3. 컨테이너의 직접 자식으로 투명 오버레이 배치
    const overlay = document.createElement('div');
    overlay.className = 'bwbr-select-overlay';
    const updateOverlayH = () => {
      overlay.style.height = Math.max(container.scrollHeight, container.clientHeight) + 'px';
    };
    Object.assign(overlay.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: Math.max(container.scrollHeight, container.clientHeight) + 'px',
      minHeight: '100%', zIndex: '10',
      cursor: 'pointer', pointerEvents: 'auto',
      background: 'transparent'
    });
    // 리스트 변경 시 오버레이 높이 자동 갱신
    const _resizeObs = new ResizeObserver(updateOverlayH);
    _resizeObs.observe(container);
    overlay._resizeObs = _resizeObs;

    overlay.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();

      // 좌표 기반 히트 테스트 (pointer-events:none 아이템도 rect로 탐색)
      for (const [domItem, data] of s.itemMap) {
        const rect = domItem.getBoundingClientRect();
        if (rect.height === 0) continue; // 숨겨진 아이템 스킵
        if (e.clientY >= rect.top && e.clientY <= rect.bottom &&
            e.clientX >= rect.left && e.clientX <= rect.right) {
          toggleItemSelect(paper, domItem, data._id);
          return;
        }
      }
    });

    container.appendChild(overlay);
    s._overlay = overlay;

    showActionBar(paper);
  }

  function exitSelectMode(paper) {
    const s = getState(paper);
    for (const item of getListItems(paper)) {
      item.style.background = '';
      item.style.pointerEvents = '';
      item.style.cursor = '';
      const sortable = item.closest('[aria-roledescription="sortable"]');
      if (sortable) sortable.style.pointerEvents = '';
    }
    s.selected.clear();

    if (s._overlay) {
      if (s._overlay._resizeObs) s._overlay._resizeObs.disconnect();
      s._overlay.remove();
      s._overlay = null;
    }

    const container = paper.querySelector('.MuiList-root') || paper.querySelector('.MuiDialogContent-root');
    if (container && container._bwbrWasStatic) {
      container.style.position = '';
      delete container._bwbrWasStatic;
    }

    hideActionBar(paper);
  }

  function toggleItemSelect(paper, listItem, id) {
    const s = getState(paper);
    if (s.selected.has(id)) {
      s.selected.delete(id);
      listItem.style.background = '';
    } else {
      s.selected.add(id);
      listItem.style.background = 'rgba(33,150,243,0.15)';
    }
    refreshActionBar(paper);
  }

  /* ══════════════════════════════════════════════════════════
   *  액션 바
   * ══════════════════════════════════════════════════════════ */

  function showActionBar(paper) {
    if (paper.querySelector('.bwbr-panel-actionbar')) return;
    const s = getState(paper);

    const bar = document.createElement('div');
    bar.className = 'bwbr-panel-actionbar';
    Object.assign(bar.style, {
      position: 'sticky', bottom: '0', background: '#2d2d2d',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px',
      zIndex: '20', minHeight: '36px'
    });

    const countLabel = document.createElement('span');
    countLabel.className = 'bwbr-panel-count';
    Object.assign(countLabel.style, { color: 'rgba(255,255,255,0.6)', fontSize: '12px', flex: '1', padding: '0 4px' });
    countLabel.textContent = '항목을 선택하세요';
    bar.appendChild(countLabel);

    // 전체 선택
    bar.appendChild(makeIconBtn('전체 선택',
      '<path d="M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"/>',
      () => {
        const allSelected = s.selected.size === s.itemMap.size;
        for (const [domItem, data] of s.itemMap) {
          if (allSelected) { s.selected.delete(data._id); domItem.style.background = ''; }
          else             { s.selected.add(data._id); domItem.style.background = 'rgba(33,150,243,0.15)'; }
        }
        refreshActionBar(paper);
      }
    ));

    // 표시 전환 (스크린 전용 — 마커에는 불필요)
    if (s.type === 'screens') {
      bar.appendChild(makeIconBtn('표시 전환',
        '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>',
        async () => {
          if (s.selected.size === 0) return;
          const res = await doBatchOp(s.type, 'toggleActive', [...s.selected]);
          if (res?.success) { console.log(TAG, '✅', res.count + '개 표시 전환'); }
          else { console.error(TAG, '표시 전환 실패:', res?.error); }
        }
      ));
    }

    // 복제
    bar.appendChild(makeIconBtn('복제',
      '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>',
      async () => {
        if (s.selected.size === 0) return;
        const res = await doBatchOp(s.type, 'duplicate', [...s.selected]);
        if (res?.success) {
          console.log(TAG, '✅', res.count + '개 복제');
          watchListAndRefresh(paper);
        }
        else { console.error(TAG, '복제 실패:', res?.error); }
      }
    ));

    // 삭제
    const delBtn = makeIconBtn('삭제',
      '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
      async () => {
        if (s.selected.size === 0) return;
        const label = s.type === 'notes' ? '텍스트' : s.type === 'markers' ? '마커' : '패널';
        if (!confirm(s.selected.size + '개 ' + label + '을(를) 삭제하시겠습니까?')) return;

        // 낙관적 UI: 서버 응답 전 선택된 아이템 즉시 숨기기
        for (const [domItem, data] of s.itemMap) {
          if (s.selected.has(data._id)) {
            const sortable = domItem.closest('[aria-roledescription="sortable"]');
            (sortable || domItem).style.display = 'none';
          }
        }
        // 오버레이 높이 즉시 갱신
        if (s._overlay) {
          const cont = s._overlay.parentElement;
          if (cont) s._overlay.style.height = Math.max(cont.scrollHeight, cont.clientHeight) + 'px';
        }

        const deletedIds = new Set(s.selected);
        s.selected.clear();
        refreshActionBar(paper);

        const res = await doBatchOp(s.type, 'delete', [...deletedIds]);
        if (res?.success) {
          console.log(TAG, '✅', res.count + '개 삭제');
          // 매핑에서 삭제된 항목 제거
          for (const [domItem, data] of s.itemMap) {
            if (deletedIds.has(data._id)) s.itemMap.delete(domItem);
          }
          watchListAndRefresh(paper);
        }
        else {
          console.error(TAG, '삭제 실패:', res?.error);
          // 실패 시 숨긴 아이템 복원
          for (const [domItem, data] of s.itemMap) {
            if (deletedIds.has(data._id)) {
              const sortable = domItem.closest('[aria-roledescription="sortable"]');
              (sortable || domItem).style.display = '';
            }
          }
        }
      }
    );
    delBtn.style.color = '#ef5350';
    bar.appendChild(delBtn);

    paper.appendChild(bar);
    refreshActionBar(paper);
  }

  function hideActionBar(paper) {
    const bar = paper.querySelector('.bwbr-panel-actionbar');
    if (bar) bar.remove();
  }

  function refreshActionBar(paper) {
    const s = getState(paper);
    const label = paper.querySelector('.bwbr-panel-count');
    if (label) {
      label.textContent = s.selected.size > 0 ? s.selected.size + '개 선택' : '항목을 선택하세요';
    }
  }

  /** MUI IconButton + 네이티브 툴팁 */
  function makeIconBtn(label, svgPath, onClick) {
    const btn = document.createElement('button');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:block">' + svgPath + '</svg>';
    Object.assign(btn.style, {
      background: 'none', border: 'none', cursor: 'pointer',
      color: 'rgba(255,255,255,0.6)', padding: '6px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '50%', transition: 'color .15s, background .15s'
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.08)'; btn.style.color = 'rgba(255,255,255,0.9)'; showTip(btn, label); });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = btn.dataset.customColor || 'rgba(255,255,255,0.6)'; hideTip(); });
    btn.addEventListener('click', e => { e.stopPropagation(); hideTip(); onClick(); });
    return btn;
  }

  /* ══════════════════════════════════════════════════════════
   *  document 캡처 단계 이벤트 차단
   *  React 17+ 는 #root 컨테이너에 이벤트를 위임하므로,
   *  document 캡처 핸들러가 #root 보다 먼저 실행되어
   *  선택 모드 중 React 클릭을 완전 차단합니다.
   * ══════════════════════════════════════════════════════════ */

  const _INTERCEPT_EVENTS = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];

  function _captureBlocker(e) {
    // MuiListItemButton-root (시나리오 텍스트) 또는 MuiListItem-root (스크린/마커)
    const item = e.target.closest?.('.MuiListItemButton-root') || e.target.closest?.('.MuiListItem-root');
    if (!item) return;
    const paper = item.closest('.MuiPaper-root.MuiPaper-elevation6');
    if (!paper) return;
    const s = _states.get(paper);
    if (!s || !s.selectMode) return;
    // 액션 바 클릭은 패스
    if (e.target.closest('.bwbr-panel-actionbar')) return;
    // 매핑되지 않은 아이템은 패스
    if (!s.itemMap.has(item)) return;

    // React 에게 이벤트가 전달되지 않도록 완전 차단
    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();

    // click 일 때만 선택 토글
    if (e.type === 'click') {
      const data = s.itemMap.get(item);
      if (data) toggleItemSelect(paper, item, data._id);
    }
  }

  for (const evt of _INTERCEPT_EVENTS) {
    document.addEventListener(evt, _captureBlocker, true);
  }

  /* ══════════════════════════════════════════════════════════
   *  메인 옵저버 — 모든 패널 동시 감지
   * ══════════════════════════════════════════════════════════ */

  const _mainObs = new MutationObserver(() => {
    const panels = findAllPanelLists();
    for (const { paper, type } of panels) {
      if (!paper.dataset.bwbrInjected) {
        setTimeout(() => inject(paper, type), 250);
      }
    }
  });

  _mainObs.observe(document.body, { childList: true, subtree: true });

  console.log(
    '%c[CE]%c 패널 관리 모듈 로드',
    'color: #2196F3; font-weight: bold;', 'color: inherit;'
  );
})();
