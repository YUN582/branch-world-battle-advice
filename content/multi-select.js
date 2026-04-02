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
  //  Debug log (gated by _BWBR_DEBUG)
  // ============================================================
  function _log() {
    if (!window._BWBR_DEBUG) return;
    var args = ['%c[CE MS]%c', 'color:#2196f3;font-weight:bold', 'color:inherit'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  // ============================================================
  //  Constants
  // ============================================================
  var NATIVE_CELL = 24;       // ccfolia 1 grid unit = 24px
  var DRAG_THRESHOLD = 5;     // px — 클릭과 드래그 구분

  // ============================================================
  //  State
  // ============================================================
  var _selectedItems = new Map();   // domElement → { _id, type, x, y, _source?, ... }
  var _itemsCache = [];             // 캐시된 roomItems (스크린)
  var _itemsCacheTime = 0;
  var _markersCache = [];           // 캐시된 markers
  var _markersCacheTime = 0;

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

  /** 스크린/배경 패널 목록 (roomItems) */
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

  /** 마커 목록 (room.markers) */
  function requestMarkerItems() {
    if (_markersCache.length && Date.now() - _markersCacheTime < 800) {
      return Promise.resolve(_markersCache);
    }
    return new Promise(function (resolve) {
      var el = document.documentElement;
      var timer;
      var handler = function () {
        window.removeEventListener('bwbr-marker-list-data', handler);
        clearTimeout(timer);
        var raw = el.getAttribute('data-bwbr-marker-list-data');
        el.removeAttribute('data-bwbr-marker-list-data');
        var data = raw ? JSON.parse(raw) : { items: [] };
        _markersCache = data.items || [];
        _markersCacheTime = Date.now();
        // 마커에 _source 태그 추가
        _markersCache.forEach(function (m) { m._source = 'marker'; });
        resolve(_markersCache);
      };
      window.addEventListener('bwbr-marker-list-data', handler);
      el.setAttribute('data-bwbr-request-marker-list', '');
      window.dispatchEvent(new CustomEvent('bwbr-request-marker-list'));
      timer = setTimeout(function () {
        window.removeEventListener('bwbr-marker-list-data', handler);
        resolve(_markersCache);
      }, 3000);
    });
  }

  /** 스크린 + 마커 양쪽 모두 요청 */
  function requestAllBoardItems() {
    return Promise.all([requestRoomItems(), requestMarkerItems()]).then(function (results) {
      return results[0].concat(results[1]);
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

  /** 마커 전용 batch op (room 문서의 markers 필드) */
  function markerBatchOp(op, ids, extra) {
    return new Promise(function (resolve, reject) {
      var el = document.documentElement;
      var timer;
      var handler = function () {
        window.removeEventListener('bwbr-marker-batch-op-result', handler);
        clearTimeout(timer);
        var raw = el.getAttribute('data-bwbr-marker-batch-op-result');
        el.removeAttribute('data-bwbr-marker-batch-op-result');
        resolve(raw ? JSON.parse(raw) : {});
      };
      window.addEventListener('bwbr-marker-batch-op-result', handler);
      var payload = { op: op, ids: ids };
      if (extra) payload.extra = extra;
      el.setAttribute('data-bwbr-marker-batch-op', JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent('bwbr-marker-batch-op'));
      timer = setTimeout(function () {
        window.removeEventListener('bwbr-marker-batch-op-result', handler);
        reject(new Error('marker batch op timeout'));
      }, 10000);
    });
  }

  // ============================================================
  //  DOM ↔ Redux Item Matching (bipartite, scored)
  // ============================================================

  /**
   * 모든 intersecting DOM 요소를 한 번에 Redux items에 매칭합니다.
   * usedIds 를 통해 중복 매칭을 방지합니다.
   * @param {Element[]} movables  DOM .movable 요소 배열
   * @param {Object[]}  items     Redux roomItems (requestRoomItems 결과)
   * @returns {Map<Element, Object>}  el → item 매핑
   */
  function matchMovablesToItems(movables, items) {
    var result = new Map();
    var usedIds = new Set();

    // 각 movable 에 대해 최고 점수 item 을 찾는다
    for (var i = 0; i < movables.length; i++) {
      var el = movables[i];
      var domUrl = normalizeStoragePath(extractImageUrl(el));
      var domPos = extractTransform(el);
      var gridX = Math.round(domPos.x / NATIVE_CELL);
      var gridY = Math.round(domPos.y / NATIVE_CELL);
      var domW = Math.round((parseInt(el.style.width, 10) || el.offsetWidth) / NATIVE_CELL);
      var domH = Math.round((parseInt(el.style.height, 10) || el.offsetHeight) / NATIVE_CELL);

      var bestItem = null;
      var bestScore = -1;

      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (usedIds.has(it._id)) continue;

        var score = 0;
        // 위치 일치 (±1 허용)
        if (it.x === gridX && it.y === gridY) score += 100;
        else if (Math.abs(it.x - gridX) <= 1 && Math.abs(it.y - gridY) <= 1) score += 30;
        else continue;  // 위치가 너무 다르면 후보 제외

        // 이미지 URL 일치
        if (domUrl && normalizeStoragePath(it.imageUrl) === domUrl) score += 200;

        // 크기 일치
        if (domW > 0 && domH > 0) {
          var iw = it.width || 0, ih = it.height || 0;
          if (iw === domW && ih === domH) score += 50;
          else if (Math.abs(iw - domW) <= 1 && Math.abs(ih - domH) <= 1) score += 20;
        }

        if (score > bestScore) {
          bestScore = score;
          bestItem = it;
        }
      }

      if (bestItem && bestScore >= 30) {
        usedIds.add(bestItem._id);
        result.set(el, bestItem);
      }
    }
    return result;
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
    _log('processSelection modifier=' + modifier + ' intersecting=' + intersecting.length + '/' + movables.length);
    if (intersecting.length === 0) return;

    // 스크린(alt) → roomItems만, 마커(ctrl) → markers만, 전체(ctrlalt) → 둘 다
    var fetchPromise;
    if (modifier === 'alt') fetchPromise = requestRoomItems();
    else if (modifier === 'ctrl') fetchPromise = requestMarkerItems();
    else fetchPromise = requestAllBoardItems();

    fetchPromise.then(function (items) {
      var screenCount = 0, markerCount = 0;
      items.forEach(function (it) { if (it._source === 'marker') markerCount++; else screenCount++; });
      _log('데이터: 스크린=' + screenCount + ' 마커=' + markerCount);

      var matchMap = matchMovablesToItems(intersecting, items);
      _log('매칭 결과: ' + matchMap.size + '/' + intersecting.length);

      // 매칭 실패 디버그
      if (matchMap.size < intersecting.length) {
        for (var di = 0; di < intersecting.length; di++) {
          if (!matchMap.has(intersecting[di])) {
            var uel = intersecting[di];
            var uPos = extractTransform(uel);
            var uImg = normalizeStoragePath(extractImageUrl(uel));
            _log('❌ 미매칭 DOM[' + di + '] pos=(' +
              Math.round(uPos.x / NATIVE_CELL) + ',' + Math.round(uPos.y / NATIVE_CELL) +
              ') size=' + uel.offsetWidth + 'x' + uel.offsetHeight +
              ' img=' + (uImg ? uImg.slice(-30) : 'NONE'));
          }
        }
      }

      matchMap.forEach(function (item, el) {
        var itemType = item._source === 'marker' ? 'marker' : 'screen';
        _selectedItems.set(el, item);
        highlightEl(el, item._source === 'marker' ? 'plane' : 'object');
      });
      _log('최종: ' + _selectedItems.size + '개 선택됨');
    });
  }

  // ============================================================
  //  Context Menu
  // ============================================================

  function removeContextMenu() {
    if (!_ctxMenuEl) return;
    var container = _ctxMenuEl;
    _ctxMenuEl = null;
    // 포인터 이벤트 즉시 차단 (사라지기 애니메이션 중 상호작용 방지)
    container.style.pointerEvents = 'none';
    var paper = container.children[1]; // [0]=backdrop, [1]=paper
    if (paper) {
      paper.style.transition =
        'opacity 370ms cubic-bezier(0.4,0,0.2,1) 0ms,' +
        'transform 246ms cubic-bezier(0.4,0,0.2,1) 123ms';
      paper.style.opacity = '0';
      paper.style.transform = 'scale(0.75, 0.5625)';
      setTimeout(function () { container.remove(); }, 400);
    } else {
      container.remove();
    }
  }

  function _mkRow(label, shortcut, action, opts) {
    opts = opts || {};
    var row = document.createElement('li');
    row.setAttribute('role', 'menuitem');
    row.setAttribute('tabindex', '-1');
    row.className = 'bwbr-ms-menuitem';
    row.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:4px 16px;min-height:32px;cursor:pointer;white-space:nowrap;' +
      'list-style:none;font-family:Roboto,Helvetica,Arial,sans-serif;' +
      'font-size:14px;font-weight:400;line-height:20.02px;' +
      'letter-spacing:0.14994px;' +
      'box-sizing:border-box;position:relative;overflow:hidden;' +
      'transition:background-color 150ms cubic-bezier(0.4,0,0.2,1) 0ms;' +
      '-webkit-tap-highlight-color:transparent;' +
      (opts.danger ? 'color:#ef5350;' : 'color:rgb(255,255,255);') +
      (opts.disabled ? 'opacity:0.38;pointer-events:none;' : '');
    row.onmouseenter = function () { if (!opts.disabled) row.style.backgroundColor = 'rgba(255,255,255,0.08)'; };
    row.onmouseleave = function () { row.style.backgroundColor = ''; };
    var lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.flex = '1';
    row.appendChild(lbl);
    if (shortcut) {
      var sc = document.createElement('span');
      sc.style.cssText = 'color:rgba(255,255,255,0.3);font-size:12px;margin-left:24px;';
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
    d.style.cssText = 'height:0;margin:4px 0;padding:0;border:0;list-style:none;' +
      'border-bottom:1px solid rgba(255,255,255,0.12);';
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

    // ── Backdrop (투명, 클릭으로 메뉴 닫기) ──
    var backdrop = document.createElement('div');
    backdrop.style.cssText =
      'position:fixed;inset:0;z-index:1300;background-color:transparent;';
    backdrop.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      removeContextMenu();
    });

    // ── Menu Paper (MUI elevation-8 스타일) ──
    var paper = document.createElement('div');
    paper.style.cssText =
      'position:fixed;z-index:1300;' +
      'background-color:rgba(44,44,44,0.87);border-radius:4px;' +
      'box-shadow:0px 5px 5px -3px rgba(0,0,0,0.2),' +
      '0px 8px 10px 1px rgba(0,0,0,0.14),' +
      '0px 3px 14px 2px rgba(0,0,0,0.12);' +
      'outline:0;overflow-x:hidden;overflow-y:auto;' +
      'max-height:calc(100% - 96px);max-width:calc(100% - 32px);' +
      'opacity:0;transform:scale(0.75, 0.5625);' +
      'transition:opacity 364ms cubic-bezier(0.4,0,0.2,1) 0ms,' +
      'transform 242ms cubic-bezier(0.4,0,0.2,1) 0ms;';

    var ul = document.createElement('ul');
    ul.setAttribute('role', 'menu');
    ul.style.cssText =
      'list-style:none;margin:0;padding:8px 0;outline:0;' +
      'min-width:200px;max-width:320px;';
    paper.appendChild(ul);

    // 선택된 아이템 source 분석
    var src = getSelectedIdsBySource();
    var hasScreens = src.screenIds.length > 0;
    var hasMarkers = src.markerIds.length > 0;
    var onlyMarkers = hasMarkers && !hasScreens;

    // freezed 상태 확인 (마커 전용)
    var allFreezed = true;
    _selectedItems.forEach(function (item) { if (item._source === 'marker' && !item.freezed) allFreezed = false; });
    var freezeLabel = allFreezed ? '크기 고정 해제' : '크기 고정';

    // 헤더 – 선택 수 + 유형 정보
    var hdr = document.createElement('li');
    hdr.setAttribute('role', 'presentation');
    hdr.style.cssText =
      'padding:4px 16px 6px;color:#90caf9;font-size:12px;' +
      'font-family:Roboto,Helvetica,Arial,sans-serif;' +
      'list-style:none;cursor:default;';
    var hdrParts = [];
    if (hasScreens) hdrParts.push('스크린 ' + src.screenIds.length);
    if (hasMarkers) hdrParts.push('마커 ' + src.markerIds.length);
    hdr.textContent = count + '개 선택됨' + (hdrParts.length ? ' (' + hdrParts.join(', ') + ')' : '');
    ul.appendChild(hdr);
    ul.appendChild(_mkDivider());

    // ── 공통: 위치 고정 ──
    ul.appendChild(_mkRow(lockLabel, 'L', function () { doBatchLock(); }));

    // ── 마커 전용: 크기 고정 ──
    if (hasMarkers) {
      ul.appendChild(_mkRow(freezeLabel, 'F', function () { doBatchFreeze(); }));
    }

    // ── 스크린 전용 항목 ──
    if (hasScreens) {
      ul.appendChild(_mkRow('패널 숨기기', 'S', function () { doBatchToggleActive(); }));
      ul.appendChild(_mkDivider());
      ul.appendChild(_mkRow('전체 공개하기', 'O', function () { doBatchVisibility('public'); }));
      ul.appendChild(_mkRow('비공개로 하기', 'T', function () { doBatchVisibility('private'); }));
      ul.appendChild(_mkRow('자신만 보기', '', function () { doBatchVisibility('self'); }));
      ul.appendChild(_mkRow('자신 외에 공개', 'W', function () { doBatchVisibility('except-self'); }));
      ul.appendChild(_mkDivider());
      ul.appendChild(_mkRow('회전', 'R / Shift+R', function () { doBatchRotate(90); }));
    }

    ul.appendChild(_mkDivider());
    ul.appendChild(_mkRow('복제', 'Ctrl+D', function () { doBatchDuplicate(); }));
    ul.appendChild(_mkRow('삭제', 'Ctrl+⌫', function () { doBatchDelete(); }, { danger: true }));

    // ── 컨테이너 (Popover 역할) ──
    var container = document.createElement('div');
    container.id = 'bwbr-multisel-ctx';
    container.style.cssText = 'position:fixed;inset:0;z-index:1300;';
    container.appendChild(backdrop);
    container.appendChild(paper);
    document.body.appendChild(container);

    // 화면 밖 넘침 보정 + 나타나기 애니메이션
    paper.style.left = x + 'px';
    paper.style.top = y + 'px';
    requestAnimationFrame(function () {
      var pr = paper.getBoundingClientRect();
      var finalX = x, finalY = y;
      if (x + pr.width > window.innerWidth) finalX = Math.max(0, window.innerWidth - pr.width - 8);
      if (y + pr.height > window.innerHeight) finalY = Math.max(0, window.innerHeight - pr.height - 8);
      paper.style.left = finalX + 'px';
      paper.style.top = finalY + 'px';
      // transformOrigin = 클릭 위치 기준 (네이티브 MUI Grow와 동일)
      paper.style.transformOrigin = (x - finalX) + 'px ' + (y - finalY) + 'px';
      paper.style.opacity = '1';
      paper.style.transform = 'scale(1)';
    });

    _ctxMenuEl = container;
    // _closeCtxOnOutside 는 backdrop 이 처리하므로 별도 등록 불필요
  }

  // ============================================================
  //  Batch Operations — 스크린/마커 자동 분리
  // ============================================================

  /** 선택된 아이템을 source별로 분리: { screenIds: [...], markerIds: [...] } */
  function getSelectedIdsBySource() {
    var screenIds = [], markerIds = [];
    _selectedItems.forEach(function (item) {
      if (!item._id) return;
      if (item._source === 'marker') markerIds.push(item._id);
      else screenIds.push(item._id);
    });
    return { screenIds: screenIds, markerIds: markerIds };
  }

  function getSelectedIds() {
    var ids = [];
    _selectedItems.forEach(function (item) { if (item._id) ids.push(item._id); });
    return ids;
  }

  function doBatchLock() {
    var s = getSelectedIdsBySource();
    var promises = [];
    if (s.screenIds.length) promises.push(batchOp('lock', s.screenIds));
    if (s.markerIds.length) promises.push(markerBatchOp('lock', s.markerIds));
    Promise.all(promises).then(function () {
      _log('위치 고정 전환 (스크린:' + s.screenIds.length + ' 마커:' + s.markerIds.length + ')');
      _selectedItems.forEach(function (item) { item.locked = !item.locked; });
    }).catch(function (e) { console.error('[CE MS] lock:', e); });
  }

  function doBatchFreeze() {
    // 크기 고정: 마커 전용 (freezed 필드)
    var s = getSelectedIdsBySource();
    if (!s.markerIds.length) return;
    markerBatchOp('freeze', s.markerIds).then(function () {
      _log('크기 고정 전환 마커:' + s.markerIds.length);
      _selectedItems.forEach(function (item) {
        if (item._source === 'marker') item.freezed = !item.freezed;
      });
    }).catch(function (e) { console.error('[CE MS] freeze:', e); });
  }

  function doBatchToggleActive() {
    // 마커에는 active 개념 없음 → 스크린만
    var s = getSelectedIdsBySource();
    if (!s.screenIds.length) return;
    batchOp('toggleActive', s.screenIds).then(function () {
      _log(s.screenIds.length + '개 활성 전환');
      clearSelection();
    }).catch(function (e) { console.error('[CE MS] active:', e); });
  }

  function doBatchVisibility(mode) {
    // 마커에는 visible/closed/withoutOwner 없음 → 스크린만
    var s = getSelectedIdsBySource();
    _log('doBatchVisibility mode=' + mode + ' screenIds=' + s.screenIds.length +
      ' markerIds=' + s.markerIds.length + ' ids:', s.screenIds);
    if (!s.screenIds.length) { _log('가시성 변경 대상 스크린 없음'); return; }
    batchOp('setVisibility', s.screenIds, { mode: mode }).then(function (res) {
      _log('가시성 결과:', res);
    }).catch(function (e) { console.error('[CE MS] visibility:', e); });
  }

  function doBatchRotate(angle) {
    var s = getSelectedIdsBySource();
    var promises = [];
    if (s.screenIds.length) promises.push(batchOp('rotate', s.screenIds, { angle: angle }));
    // 마커 회전은 미지원
    Promise.all(promises).then(function () {
      _log('회전 ' + angle + '°');
    }).catch(function (e) { console.error('[CE MS] rotate:', e); });
  }

  function doBatchDuplicate() {
    var s = getSelectedIdsBySource();
    var promises = [];
    if (s.screenIds.length) promises.push(batchOp('duplicate', s.screenIds));
    if (s.markerIds.length) promises.push(markerBatchOp('duplicate', s.markerIds));
    Promise.all(promises).then(function () {
      _log('복제 (스크린:' + s.screenIds.length + ' 마커:' + s.markerIds.length + ')');
      clearSelection();
    }).catch(function (e) { console.error('[CE MS] duplicate:', e); });
  }

  function doBatchDelete() {
    var s = getSelectedIdsBySource();
    var promises = [];
    if (s.screenIds.length) promises.push(batchOp('delete', s.screenIds));
    if (s.markerIds.length) promises.push(markerBatchOp('delete', s.markerIds));
    Promise.all(promises).then(function () {
      _log('삭제 (스크린:' + s.screenIds.length + ' 마커:' + s.markerIds.length + ')');
      clearSelection();
    }).catch(function (e) { console.error('[CE MS] delete:', e); });
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

    var s = getSelectedIdsBySource();
    var movePayload = { dx: dxGrid, dy: dyGrid };
    var promises = [];
    if (s.screenIds.length) promises.push(batchOp('move', s.screenIds, movePayload));
    if (s.markerIds.length) promises.push(markerBatchOp('move', s.markerIds, movePayload));
    if (promises.length > 0) {
      Promise.all(promises).then(function (results) {
        var allOk = results.every(function (r) { return r && r.success; });
        if (allOk) {
          _log('이동 (스크린:' + s.screenIds.length + ' 마커:' + s.markerIds.length + ' dx:' + dxGrid + ' dy:' + dyGrid + ')');
          _selectedItems.forEach(function (item) {
            item.x = (item.x || 0) + dxGrid;
            item.y = (item.y || 0) + dyGrid;
          });
        } else {
          console.error('[CE MS] 이동 일부 실패:', results);
          _selectedItems.forEach(function (_item, el) {
            var init = _groupDragInitial.get(el);
            if (init) el.style.transform = 'translate(' + init.x + 'px, ' + init.y + 'px)';
          });
        }
      }).catch(function (err) {
        console.error('[CE MS] 이동 실패:', err);
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
    // 배치 모드 활성 시 선택 기능 양보
    if (window.BWBR_PlacementActive) return;
    // 컨텍스트 메뉴가 열려있으면 backdrop 이 닫기를 처리하므로 무시
    if (_ctxMenuEl && _ctxMenuEl.contains(e.target)) return;

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
      case 'F':
        e.preventDefault(); doBatchFreeze(); break;
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
        _log('다중 선택 모듈 비활성화됨');
        return;
      }
    }

    // CAPTURE phase — ccfolia React 이벤트보다 먼저 처리
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown, true);

    _log('다중 선택 모듈 초기화 완료');
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
