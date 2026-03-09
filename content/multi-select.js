// ================================================================
//  다중 선택 모듈 (Multi-Select Module)
//  Alt+Drag       → 스크린 토큰 (type: 'object') 다중 선택
//  Ctrl+Drag      → 마커 패널  (type: 'plane')  다중 선택
//  Ctrl+Alt+Drag  → 전체 다중 선택
//
//  선택 상태에서:
//    드래그    → 그룹 이동
//    우클릭    → 일괄 컨텍스트 메뉴
//    ESC       → 선택 해제
// ================================================================
(function () {
  'use strict';

  // ============================================================
  //  Constants
  // ============================================================
  var NATIVE_CELL = 24;       // ccfolia 1 grid unit = 24px
  var DRAG_THRESHOLD = 5;     // px — 클릭과 드래그 구분

  // ============================================================
  //  State
  // ============================================================
  var _selectedItems = new Map();   // domElement → { _id, type, x, y, ... }
  var _itemsCache = [];             // 캐시된 roomItems
  var _itemsCacheTime = 0;

  // 선택 사각형
  var _isSelecting = false;
  var _selectModifier = null;       // 'alt' | 'ctrl' | 'ctrlalt'
  var _selectStart = null;          // { x, y } viewport
  var _selectRectEl = null;

  // 그룹 드래그
  var _isGroupDrag = false;
  var _groupDragStart = null;       // { x, y } viewport
  var _groupDragInitial = new Map(); // element → { x, y } (transform px)

  // 컨텍스트 메뉴
  var _ctxMenuEl = null;

  // ============================================================
  //  Utility — Zoom & Coordinate
  // ============================================================

  function getZoomContainer() {
    var m = document.querySelector('.movable');
    return m ? m.parentElement : null;
  }

  function getZoomScale() {
    var zoom = getZoomContainer();
    if (!zoom) return 1;
    var t = getComputedStyle(zoom).transform;
    if (!t || t === 'none') return 1;
    var m = t.match(/matrix\(([^,]+)/);
    return m ? parseFloat(m[1]) : 1;
  }

  function getTopLevelMovables() {
    var zoom = getZoomContainer();
    if (!zoom) return [];
    var out = [];
    for (var i = 0; i < zoom.children.length; i++) {
      var ch = zoom.children[i];
      if (ch.classList && ch.classList.contains('movable')) out.push(ch);
    }
    return out;
  }

  function extractTransform(el) {
    var t = el.style.transform || getComputedStyle(el).transform || '';
    var m = t.match(/translate3d\(\s*([^,]+)px,\s*([^,]+)px/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    m = t.match(/translate\(\s*([^,]+)px,\s*([^,]+)px/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,]+),\s*([^)]+)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    return { x: 0, y: 0 };
  }

  function extractImageUrl(el) {
    var img = el.querySelector('img');
    if (img && img.src) return img.src;
    var children = el.querySelectorAll('*');
    for (var i = 0; i < children.length; i++) {
      var bg = children[i].style.backgroundImage || '';
      var m = bg.match(/url\(["']?(.+?)["']?\)/);
      if (m) return m[1];
    }
    return '';
  }

  function normalizeStoragePath(url) {
    if (!url) return '';
    try {
      var u = new URL(url);
      var oMatch = u.pathname.match(/\/o\/(.+?)(\?|$)/);
      if (oMatch) return decodeURIComponent(oMatch[1]);
      return u.pathname;
    } catch (e) { return url; }
  }

  function rectsIntersect(a, b) {
    return a.right > b.left && a.left < b.right &&
           a.bottom > b.top && a.top < b.bottom;
  }

  /** 가장 가까운 최상위 .movable 조상 반환 */
  function findTopMovable(el) {
    var cur = el;
    var best = null;
    while (cur && cur !== document.body) {
      if (cur.classList && cur.classList.contains('movable')) best = cur;
      cur = cur.parentElement;
    }
    // best 는 가장 바깥쪽 .movable
    return best;
  }

  /** UI 요소(다이얼로그, 패널, 입력 등)인지 판별 — true면 선택 시작 금지 */
  function isUIElement(el) {
    if (!el) return true;
    // 이미 열린 컨텍스트 메뉴
    if (_ctxMenuEl && _ctxMenuEl.contains(el)) return true;
    var cur = el;
    while (cur && cur !== document.body) {
      // MUI 다이얼로그, 팝오버, 드로어, 채팅 입력 등
      if (cur.classList && (
          cur.classList.contains('MuiDialog-root') ||
          cur.classList.contains('MuiPopover-root') ||
          cur.classList.contains('MuiDrawer-root') ||
          cur.classList.contains('MuiPaper-root')))
        return true;
      // 채팅/입력 영역
      var tag = (cur.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if (cur.getAttribute && cur.getAttribute('role') === 'dialog') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // ============================================================
  //  Cross-World Bridge (ISOLATED ↔ MAIN)
  // ============================================================

  function requestRoomItems() {
    if (_itemsCache.length && Date.now() - _itemsCacheTime < 800) {
      return Promise.resolve(_itemsCache);
    }
    return new Promise(function (resolve) {
      var el = document.documentElement;
      var timer;
      var handler = function () {
        window.removeEventListener('bwbr-panel-list-data', handler);
        clearTimeout(timer);
        var raw = el.getAttribute('data-bwbr-panel-list-data');
        el.removeAttribute('data-bwbr-panel-list-data');
        var data = raw ? JSON.parse(raw) : { items: [] };
        _itemsCache = data.items || [];
        _itemsCacheTime = Date.now();
        resolve(_itemsCache);
      };
      window.addEventListener('bwbr-panel-list-data', handler);
      el.setAttribute('data-bwbr-request-panel-list', '');
      window.dispatchEvent(new CustomEvent('bwbr-request-panel-list'));
      timer = setTimeout(function () {
        window.removeEventListener('bwbr-panel-list-data', handler);
        resolve(_itemsCache);
      }, 3000);
    });
  }

  function batchOp(op, ids, updates) {
    return new Promise(function (resolve, reject) {
      var el = document.documentElement;
      var timer;
      var handler = function () {
        window.removeEventListener('bwbr-panel-batch-op-result', handler);
        clearTimeout(timer);
        var raw = el.getAttribute('data-bwbr-panel-batch-op-result');
        el.removeAttribute('data-bwbr-panel-batch-op-result');
        resolve(raw ? JSON.parse(raw) : {});
      };
      window.addEventListener('bwbr-panel-batch-op-result', handler);
      el.setAttribute('data-bwbr-panel-batch-op', JSON.stringify({ op: op, ids: ids, updates: updates }));
      window.dispatchEvent(new CustomEvent('bwbr-panel-batch-op'));
      timer = setTimeout(function () {
        window.removeEventListener('bwbr-panel-batch-op-result', handler);
        reject(new Error('batch op timeout'));
      }, 10000);
    });
  }

  // ============================================================
  //  DOM ↔ Redux Item Matching
  // ============================================================

  function matchMovableToItem(movableEl, items) {
    var domUrl = normalizeStoragePath(extractImageUrl(movableEl));
    var domPos = extractTransform(movableEl);
    var gridX = Math.round(domPos.x / NATIVE_CELL);
    var gridY = Math.round(domPos.y / NATIVE_CELL);

    // 1) imageUrl 매칭
    if (domUrl) {
      var urlMatches = items.filter(function (it) {
        return normalizeStoragePath(it.imageUrl) === domUrl;
      });
      if (urlMatches.length === 1) return urlMatches[0];
      if (urlMatches.length > 1) {
        // 같은 이미지가 복수일 때 위치로 구분
        var posMatch = urlMatches.find(function (it) {
          return it.x === gridX && it.y === gridY;
        });
        return posMatch || urlMatches[0];
      }
    }

    // 2) 위치 매칭 (폴백)
    var posFallback = items.find(function (it) {
      return it.x === gridX && it.y === gridY;
    });
    return posFallback || null;
  }

  // ============================================================
  //  Selection — Visual Feedback
  // ============================================================

  // 스크린(object)=파랑, 마커(plane)=주황
  var COLOR_SCREEN = 'rgba(33,150,243,0.85)'; // #2196F3
  var COLOR_MARKER = 'rgba(255,152,0,0.85)';  // #FF9800
  var COLOR_SCREEN_BG = 'rgba(33,150,243,0.08)';
  var COLOR_MARKER_BG = 'rgba(255,152,0,0.08)';

  function highlightEl(el, type) {
    var c = (type === 'plane') ? COLOR_MARKER : COLOR_SCREEN;
    el.style.outline = '2px dashed ' + c;
    el.style.outlineOffset = '2px';
    el.setAttribute('data-bwbr-multisel', type || 'object');
  }

  function unhighlightEl(el) {
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.removeAttribute('data-bwbr-multisel');
  }

  function clearSelection() {
    _selectedItems.forEach(function (_v, el) { unhighlightEl(el); });
    _selectedItems.clear();
    removeContextMenu();
  }

  // ============================================================
  //  Selection Rectangle
  // ============================================================

  function createSelectionRect(modifier) {
    var r = document.createElement('div');
    r.id = 'bwbr-multisel-rect';
    var isMarker = modifier === 'ctrl';
    var bColor = isMarker ? COLOR_MARKER : COLOR_SCREEN;
    var bgColor = isMarker ? COLOR_MARKER_BG : COLOR_SCREEN_BG;
    if (modifier === 'ctrlalt') { bColor = 'rgba(156,39,176,0.8)'; bgColor = 'rgba(156,39,176,0.08)'; }
    r.style.cssText =
      'position:fixed;border:2px dashed ' + bColor + ';' +
      'background:' + bgColor + ';z-index:1300;pointer-events:none;';
    document.body.appendChild(r);
    return r;
  }

  function updateSelectionRect(rect, start, cur) {
    var l = Math.min(start.x, cur.x);
    var t = Math.min(start.y, cur.y);
    rect.style.left = l + 'px';
    rect.style.top = t + 'px';
    rect.style.width = Math.abs(cur.x - start.x) + 'px';
    rect.style.height = Math.abs(cur.y - start.y) + 'px';
  }

  function removeSelectionRect() {
    if (_selectRectEl) { _selectRectEl.remove(); _selectRectEl = null; }
  }

  // ============================================================
  //  Selection Processing
  // ============================================================

  function processSelection(selRect, modifier) {
    var sRect = selRect.getBoundingClientRect();
    var movables = getTopLevelMovables();
    var intersecting = movables.filter(function (el) {
      return rectsIntersect(sRect, el.getBoundingClientRect());
    });
    if (intersecting.length === 0) return;

    requestRoomItems().then(function (items) {
      for (var i = 0; i < intersecting.length; i++) {
        var el = intersecting[i];
        var item = matchMovableToItem(el, items);
        if (!item) continue;
        // 수식키에 따른 타입 필터
        if (modifier === 'alt' && item.type !== 'object') continue;
        if (modifier === 'ctrl' && item.type !== 'plane') continue;
        // 'ctrlalt' → 필터 없음
        _selectedItems.set(el, item);
        highlightEl(el, item.type);
      }
      if (_selectedItems.size > 0) {
        console.log('[CE Multi-Select] ' + _selectedItems.size + '개 아이템 선택됨');
      }
    });
  }

  // ============================================================
  //  Context Menu
  // ============================================================

  function removeContextMenu() {
    if (_ctxMenuEl) { _ctxMenuEl.remove(); _ctxMenuEl = null; }
    document.removeEventListener('pointerdown', _closeCtxOnOutside, true);
  }

  function _closeCtxOnOutside(e) {
    if (_ctxMenuEl && !_ctxMenuEl.contains(e.target)) removeContextMenu();
  }

  function _mkRow(label, shortcut, action, opts) {
    opts = opts || {};
    var row = document.createElement('li');
    row.setAttribute('role', 'menuitem');
    row.setAttribute('tabindex', '-1');
    row.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:6px 16px;min-height:36px;cursor:pointer;white-space:nowrap;' +
      'list-style:none;font-size:14px;line-height:1.5;letter-spacing:0.00938em;' +
      'box-sizing:border-box;position:relative;overflow:hidden;' +
      (opts.danger ? 'color:#ef5350;' : 'color:rgba(255,255,255,0.87);') +
      (opts.disabled ? 'opacity:0.38;pointer-events:none;' : '');
    row.onmouseenter = function () { if (!opts.disabled) row.style.background = 'rgba(255,255,255,0.08)'; };
    row.onmouseleave = function () { row.style.background = ''; };
    var lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.flex = '1';
    row.appendChild(lbl);
    if (shortcut) {
      var sc = document.createElement('span');
      sc.style.cssText = 'color:rgba(255,255,255,0.38);font-size:13px;margin-left:24px;';
      sc.textContent = shortcut;
      row.appendChild(sc);
    }
    if (action && !opts.disabled) {
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        removeContextMenu();
        action();
      });
    }
    return row;
  }

  function _mkDivider() {
    var d = document.createElement('li');
    d.setAttribute('role', 'separator');
    d.style.cssText = 'height:0;margin:0;border:0;list-style:none;' +
      'border-bottom:1px solid rgba(255,255,255,0.12);margin:4px 0;';
    return d;
  }

  function showContextMenu(x, y) {
    removeContextMenu();
    var count = _selectedItems.size;
    if (count === 0) return;

    // 선택된 아이템들의 locked 상태 확인
    var allLocked = true;
    _selectedItems.forEach(function (item) { if (!item.locked) allLocked = false; });
    var lockLabel = allLocked ? '위치 고정 해제' : '위치 고정';

    var menu = document.createElement('div');
    menu.id = 'bwbr-multisel-ctx';
    menu.setAttribute('role', 'menu');
    menu.style.cssText =
      'position:fixed;z-index:1400;background-color:#303030;border-radius:4px;' +
      'padding:8px 0;min-width:200px;max-width:320px;' +
      'box-shadow:0px 5px 5px -3px rgba(0,0,0,0.2), 0px 8px 10px 1px rgba(0,0,0,0.14), 0px 3px 14px 2px rgba(0,0,0,0.12);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans KR","Helvetica Neue",Arial,sans-serif;' +
      'font-size:14px;color:rgba(255,255,255,0.87);user-select:none;outline:0;' +
      'overflow:auto;';

    // 헤더 – 선택 수
    var hdr = document.createElement('li');
    hdr.setAttribute('role', 'presentation');
    hdr.style.cssText = 'padding:4px 16px 6px;color:#90caf9;font-size:12px;list-style:none;cursor:default;';
    hdr.textContent = count + '개 선택됨';
    menu.appendChild(hdr);
    menu.appendChild(_mkDivider());

    var single = count === 1;
    menu.appendChild(_mkRow('편집', '', function () { triggerNativeEdit(); }, { disabled: !single }));
    menu.appendChild(_mkRow(lockLabel, 'L', function () { doBatchLock(); }));
    menu.appendChild(_mkRow('전투이동', '', null, { disabled: true }));
    menu.appendChild(_mkRow('패널 숨기기', 'S', function () { doBatchToggleActive(); }));
    menu.appendChild(_mkDivider());
    menu.appendChild(_mkRow('전체 공개하기', 'O', function () { doBatchVisibility('public'); }));
    menu.appendChild(_mkRow('비공개로 하기', 'T', function () { doBatchVisibility('private'); }));
    menu.appendChild(_mkRow('자신만 보기', 'T', function () { doBatchVisibility('self'); }));
    menu.appendChild(_mkRow('자신 외에 공개', 'W', function () { doBatchVisibility('except-self'); }));
    menu.appendChild(_mkDivider());
    menu.appendChild(_mkRow('회전', 'R / Shift+R', function () { doBatchRotate(90); }));
    menu.appendChild(_mkRow('확대 보기', 'E', null, { disabled: !single }));
    menu.appendChild(_mkDivider());
    menu.appendChild(_mkRow('복제', 'Ctrl+D', function () { doBatchDuplicate(); }));
    menu.appendChild(_mkRow('삭제', 'Ctrl+⌫', function () { doBatchDelete(); }, { danger: true }));

    document.body.appendChild(menu);

    // 화면 밖 넘침 보정
    var mr = menu.getBoundingClientRect();
    if (x + mr.width > window.innerWidth) x = window.innerWidth - mr.width - 8;
    if (y + mr.height > window.innerHeight) y = window.innerHeight - mr.height - 8;
    menu.style.left = Math.max(0, x) + 'px';
    menu.style.top = Math.max(0, y) + 'px';

    _ctxMenuEl = menu;
    setTimeout(function () {
      document.addEventListener('pointerdown', _closeCtxOnOutside, true);
    }, 50);
  }

  // ============================================================
  //  Batch Operations
  // ============================================================

  function getSelectedIds() {
    var ids = [];
    _selectedItems.forEach(function (item) {
      if (item._id) ids.push(item._id);
    });
    return ids;
  }

  function doBatchLock() {
    var ids = getSelectedIds();
    if (!ids.length) return;
    batchOp('lock', ids).then(function () {
      console.log('[CE Multi-Select] ' + ids.length + '개 위치 고정 전환');
      // 캐시된 locked 상태 토글
      _selectedItems.forEach(function (item) { item.locked = !item.locked; });
    }).catch(function (e) { console.error('[CE Multi-Select] lock:', e); });
  }

  function doBatchToggleActive() {
    var ids = getSelectedIds();
    if (!ids.length) return;
    batchOp('toggleActive', ids).then(function () {
      console.log('[CE Multi-Select] ' + ids.length + '개 활성 전환');
      clearSelection();
    }).catch(function (e) { console.error('[CE Multi-Select] active:', e); });
  }

  function doBatchVisibility(mode) {
    var ids = getSelectedIds();
    if (!ids.length) return;
    batchOp('setVisibility', ids, { mode: mode }).then(function () {
      console.log('[CE Multi-Select] ' + ids.length + '개 공개 상태 → ' + mode);
    }).catch(function (e) { console.error('[CE Multi-Select] visibility:', e); });
  }

  function doBatchRotate(angle) {
    var ids = getSelectedIds();
    if (!ids.length) return;
    batchOp('rotate', ids, { angle: angle }).then(function () {
      console.log('[CE Multi-Select] ' + ids.length + '개 회전 ' + angle + '°');
    }).catch(function (e) { console.error('[CE Multi-Select] rotate:', e); });
  }

  function doBatchDuplicate() {
    var ids = getSelectedIds();
    if (!ids.length) return;
    batchOp('duplicate', ids).then(function () {
      console.log('[CE Multi-Select] ' + ids.length + '개 복제');
      clearSelection();
    }).catch(function (e) { console.error('[CE Multi-Select] duplicate:', e); });
  }

  function doBatchDelete() {
    var ids = getSelectedIds();
    if (!ids.length) return;
    batchOp('delete', ids).then(function () {
      console.log('[CE Multi-Select] ' + ids.length + '개 삭제');
      clearSelection();
    }).catch(function (e) { console.error('[CE Multi-Select] delete:', e); });
  }

  /** 단일 선택 시 네이티브 편집 다이얼로그 열기 (더블클릭 시뮬레이션) */
  function triggerNativeEdit() {
    if (_selectedItems.size !== 1) return;
    var el = _selectedItems.keys().next().value;
    clearSelection();
    // ccfolia 는 더블클릭으로 편집 다이얼로그를 연다
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  }

  // ============================================================
  //  Group Drag — Move
  // ============================================================

  function startGroupDrag(e) {
    if (_selectedItems.size === 0 || e.button !== 0) return false;
    if (e.altKey || e.ctrlKey) return false;  // 수식키 = 선택 모드
    var movable = findTopMovable(e.target);
    if (!movable || !_selectedItems.has(movable)) return false;

    _isGroupDrag = true;
    _groupDragStart = { x: e.clientX, y: e.clientY };
    _groupDragInitial = new Map();
    _selectedItems.forEach(function (_item, el) {
      var p = extractTransform(el);
      _groupDragInitial.set(el, { x: p.x, y: p.y });
    });

    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  function moveGroupDrag(e) {
    if (!_isGroupDrag) return;
    var scale = getZoomScale();
    var dx = (e.clientX - _groupDragStart.x) / scale;
    var dy = (e.clientY - _groupDragStart.y) / scale;
    _selectedItems.forEach(function (_item, el) {
      var init = _groupDragInitial.get(el);
      if (!init) return;
      el.style.transform = 'translate(' + (init.x + dx) + 'px, ' + (init.y + dy) + 'px)';
    });
    e.preventDefault();
    e.stopPropagation();
  }

  function endGroupDrag(e) {
    if (!_isGroupDrag) return;
    _isGroupDrag = false;

    var scale = getZoomScale();
    var dxPx = (e.clientX - _groupDragStart.x) / scale;
    var dyPx = (e.clientY - _groupDragStart.y) / scale;
    var dxGrid = Math.round(dxPx / NATIVE_CELL);
    var dyGrid = Math.round(dyPx / NATIVE_CELL);

    // 그리드 스냅 — 시각적 정렬
    _selectedItems.forEach(function (_item, el) {
      var init = _groupDragInitial.get(el);
      if (!init) return;
      el.style.transform = 'translate(' + (init.x + dxGrid * NATIVE_CELL) + 'px, ' +
        (init.y + dyGrid * NATIVE_CELL) + 'px)';
    });

    if (dxGrid === 0 && dyGrid === 0) {
      // 이동 없음 — 원위치 복원
      _selectedItems.forEach(function (_item, el) {
        var init = _groupDragInitial.get(el);
        if (init) el.style.transform = 'translate(' + init.x + 'px, ' + init.y + 'px)';
      });
      _groupDragInitial.clear();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    var ids = getSelectedIds();
    if (ids.length > 0) {
      // 이동 전에 아이템 캐시를 갱신하여 최신 _id 확인 (복제 후 이동 대응)
      _itemsCacheTime = 0;  // 캐시 무효화
      requestRoomItems().then(function (freshItems) {
        // 선택된 요소들의 _id를 갱신된 데이터로 재매칭
        var freshIds = [];
        _selectedItems.forEach(function (oldItem, el) {
          var matched = matchMovableToItem(el, freshItems);
          if (matched) {
            _selectedItems.set(el, matched); // 최신 데이터로 교체
            freshIds.push(matched._id);
          } else if (oldItem._id) {
            freshIds.push(oldItem._id);
          }
        });
        if (freshIds.length === 0) return;
        return batchOp('move', freshIds, { dx: dxGrid, dy: dyGrid });
      }).then(function (result) {
        if (result) {
          console.log('[CE Multi-Select] ' + ids.length + '개 이동 (dx:' + dxGrid + ', dy:' + dyGrid + ')');
          _selectedItems.forEach(function (item) {
            item.x = (item.x || 0) + dxGrid;
            item.y = (item.y || 0) + dyGrid;
          });
        }
      }).catch(function (err) {
        console.error('[CE Multi-Select] 이동 실패:', err);
        _selectedItems.forEach(function (_item, el) {
          var init = _groupDragInitial.get(el);
          if (init) el.style.transform = 'translate(' + init.x + 'px, ' + init.y + 'px)';
        });
      });
    }
    _groupDragInitial.clear();
    e.preventDefault();
    e.stopPropagation();
  }

  // ============================================================
  //  Unified Pointer Event Handlers (CAPTURE phase)
  // ============================================================

  function onPointerDown(e) {
    // 컨텍스트 메뉴 열린 상태에서 다른 곳 클릭 → 닫기만
    if (_ctxMenuEl && !_ctxMenuEl.contains(e.target)) {
      removeContextMenu();
      // 이벤트는 통과
    }

    var isAlt = e.altKey && !e.ctrlKey;
    var isCtrl = !e.altKey && e.ctrlKey;
    var isCtrlAlt = e.altKey && e.ctrlKey;

    // ── 선택 모드 시작 (UI 요소 위가 아닌 모든 곳에서 가능) ──
    if ((isAlt || isCtrl || isCtrlAlt) && e.button === 0 && !isUIElement(e.target)) {
      _isSelecting = true;
      _selectModifier = isCtrlAlt ? 'ctrlalt' : (isAlt ? 'alt' : 'ctrl');
      _selectStart = { x: e.clientX, y: e.clientY };
      clearSelection();
      _selectRectEl = createSelectionRect(_selectModifier);
      updateSelectionRect(_selectRectEl, _selectStart, _selectStart);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // ── 그룹 드래그 시작 ──
    if (_selectedItems.size > 0 && e.button === 0) {
      if (startGroupDrag(e)) return;
    }

    // ── 빈 곳 클릭 → 선택 해제 ──
    if (_selectedItems.size > 0 && e.button === 0 && !e.altKey && !e.ctrlKey) {
      var mv = findTopMovable(e.target);
      if (!mv && !isUIElement(e.target)) {
        clearSelection();
      }
    }
  }

  function onPointerMove(e) {
    if (_isSelecting && _selectRectEl) {
      updateSelectionRect(_selectRectEl, _selectStart, { x: e.clientX, y: e.clientY });
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (_isGroupDrag) {
      moveGroupDrag(e);
      return;
    }
  }

  function onPointerUp(e) {
    if (_isSelecting) {
      var dx = e.clientX - _selectStart.x;
      var dy = e.clientY - _selectStart.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        processSelection(_selectRectEl, _selectModifier);
      }
      removeSelectionRect();
      _isSelecting = false;
      _selectModifier = null;
      _selectStart = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (_isGroupDrag) {
      endGroupDrag(e);
      return;
    }
  }

  function onContextMenu(e) {
    if (_selectedItems.size === 0) return;
    var movable = findTopMovable(e.target);
    if (!movable || !_selectedItems.has(movable)) return;
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY);
  }

  // ============================================================
  //  Keyboard Shortcuts (선택 상태에서만)
  // ============================================================

  function onKeyDown(e) {
    if (_selectedItems.size === 0) return;

    // ESC → 선택 해제
    if (e.key === 'Escape') {
      clearSelection();
      e.preventDefault();
      return;
    }

    // 컨텍스트 메뉴가 열려있으면 단축키 비활성
    if (_ctxMenuEl) return;

    // 입력 필드 안에서는 무시
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

    switch (e.key.toUpperCase()) {
      case 'L':
        e.preventDefault(); doBatchLock(); break;
      case 'S':
        e.preventDefault(); doBatchToggleActive(); break;
      case 'O':
        e.preventDefault(); doBatchVisibility('public'); break;
      case 'T':
        e.preventDefault(); doBatchVisibility('private'); break;
      case 'W':
        e.preventDefault(); doBatchVisibility('except-self'); break;
      case 'R':
        e.preventDefault(); doBatchRotate(e.shiftKey ? -90 : 90); break;
      case 'D':
        if (e.ctrlKey) { e.preventDefault(); doBatchDuplicate(); } break;
      case 'BACKSPACE':
        if (e.ctrlKey) { e.preventDefault(); doBatchDelete(); } break;
      case 'DELETE':
        if (e.ctrlKey) { e.preventDefault(); doBatchDelete(); } break;
    }
  }

  // ============================================================
  //  Initialization
  // ============================================================

  function init() {
    // 모듈 활성화 확인
    if (window.BWBR_ModuleLoader && typeof window.BWBR_ModuleLoader.isEnabled === 'function') {
      if (window.BWBR_ModuleLoader.isEnabled('multi-select') === false) {
        console.log('[CE] 다중 선택 모듈 비활성화됨');
        return;
      }
    }

    // CAPTURE phase — ccfolia React 이벤트보다 먼저 처리
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown, true);

    console.log('%c[CE]%c 다중 선택 모듈 초기화 완료',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  }

  // DOM 준비 후 초기화 (짧은 딜레이 — 모듈 로더 완료 대기)
  function deferInit() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 500); });
    } else {
      setTimeout(init, 500);
    }
  }

  deferInit();
})();
