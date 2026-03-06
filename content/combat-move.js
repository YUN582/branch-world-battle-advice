// ============================================================
// [COMBAT] Combat Move - 전투 이동 시각화
//
// 전투 모드 ON → 토큰 클릭 → 이동 범위 표시 → 클릭 이동
//
// 맵 토큰 = roomItems (스크린 패널)
// 캐릭터 바인딩: 1) 토큰 바인딩 맵 (우선) 2) memo의 〔캐릭터이름〕 (폴백)
// 이동 범위: 바인딩된 캐릭터의 params "이동거리" 기반
// 거리 계산: 맨해튼 거리 (상하좌우, 대각선 불가)
// 1 이동 타일 = 스크린 패널 크기 (width × height cells)
// 1 cell = 24px (코코포리아 좌표계)
// 이동 실행: roomItems Firestore 직접 쓰기
//
// ISOLATED world (content script)
// MAIN world 통신: bwbr-request-char-for-move / bwbr-move-item
// ============================================================

(function () {
  'use strict';
  console.log('[Branch Move] combat-move.js v1.2.109 loaded');

  var CELL_PX = 24;
  var NATIVE_CELL = 24;       // 코코포리아 기본 셀 = 24px
  var _gridSize = 4;          // 코코포리아 gridSize (기본 4 → 96px 한칸)
  var _gridCellPx = 96;       // _gridSize * NATIVE_CELL
  var LOG_PREFIX = '%c[Branch Move]%c';
  var LOG_STYLE = 'color:#2196f3;font-weight:bold';

  // 네이티브 코코포리아 스타일 툴팁 헬퍼
  function _createTooltip(text) {
    var el = document.createElement('div');
    el.setAttribute('data-bwbr-tooltip', '');
    el.style.cssText =
      'position:fixed;z-index:1500;pointer-events:none;' +
      'background:rgb(22,22,22);color:#fff;' +
      'font:500 12px/1.4 Roboto,Helvetica,Arial,sans-serif;' +
      'padding:4px 8px;border-radius:4px;max-width:300px;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.2),0 1px 1px rgba(0,0,0,.14),0 2px 1px -1px rgba(0,0,0,.12);' +
      'white-space:pre-line;opacity:0;transition:opacity 0.2s cubic-bezier(0.4,0,0.2,1);';
    el.textContent = text;
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    return el;
  }
  function _positionTooltip(el, ev) {
    el.style.left = (ev.clientX + 12) + 'px';
    el.style.top = (ev.clientY + 14) + 'px';
  }

  function LOG() {
    if (!window._BWBR_DEBUG) return;
    var args = [LOG_PREFIX, LOG_STYLE, 'color:inherit'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  // -- state --
  var _combatMode = false;
  var _moveOverlay = null;
  var _selectedItem = null;  // { item, char }
  var _waypoints = [];        // 중간 경유지 목록 [{ x, y }]
  var _waypointMarkers = [];  // 경유지 DOM 마커
  var _totalWaypointDist = 0; // 이미 소비된 이동 거리
  var _helpPanel = null;      // 전투 모드 도움말 패널

  // ------------------------------------------------
  //  1. Zoom container finder
  // ------------------------------------------------
  function findZoomContainer() {
    var movable = document.querySelector('.movable');
    return movable ? movable.parentElement : null;
  }

  // ------------------------------------------------
  //  2. Token DOM → imageUrl 추출
  //     .movable 요소의 img src 또는 background-image
  // ------------------------------------------------
  function extractTokenImageUrl(tokenEl) {
    // 1) img 태그의 src
    var img = tokenEl.querySelector('img');
    if (img && img.src) return img.src;
    // 2) background-image 폴백
    var allEls = tokenEl.querySelectorAll('*');
    for (var i = 0; i < allEls.length; i++) {
      var bg = allEls[i].style.backgroundImage || '';
      if (bg && bg !== 'none') {
        var m = bg.match(/url\(["']?(.+?)["']?\)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  // ------------------------------------------------
  //  3. MAIN world communication helpers
  // ------------------------------------------------
  function extractTransformPosition(el) {
    if (!el) return null;
    // 1) inline style → 2) computedStyle 폴백
    var t = el.style.transform || '';
    if (!t || t === 'none') {
      try { t = window.getComputedStyle(el).transform || ''; } catch (e) { t = ''; }
    }
    // translate(Xpx, Ypx)
    var m = t.match(/translate\(([\d.e+-]+)px,\s*([\d.e+-]+)px\)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    // translate3d(Xpx, Ypx, Zpx)
    m = t.match(/translate3d\(([\d.e+-]+)px,\s*([\d.e+-]+)px/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    // matrix(a,b,c,d,tx,ty)
    m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([\d.e+-]+),\s*([\d.e+-]+)\)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    return null;
  }

  function requestCharForMove(imageUrl, position) {
    var payload = { imageUrl: imageUrl, position: position || null };
    return BWBR_Bridge.request(
      'bwbr-request-char-for-move', 'bwbr-char-move-data', payload,
      { sendAttr: 'data-bwbr-move-payload', recvAttr: 'data-bwbr-char-move-result', timeout: 3000 }
    ).catch(function () { return { success: false }; });
  }

  function moveItem(itemId, x, y) {
    return BWBR_Bridge.request(
      'bwbr-move-item', 'bwbr-move-item-result',
      { itemId: itemId, x: x, y: y },
      { sendAttr: 'data-bwbr-move-item', recvAttr: 'data-bwbr-move-item-result', timeout: 5000 }
    ).catch(function () { return { success: false }; });
  }

  /** 특정 캐릭터로 채팅 메시지 전송 (Firestore 직접) */
  function sendChatAsChar(text, charName, iconUrl, color) {
    var el = document.documentElement;
    el.setAttribute('data-bwbr-char-msg-text', text);
    el.setAttribute('data-bwbr-char-msg-name', charName || '');
    el.setAttribute('data-bwbr-char-msg-icon', iconUrl || '');
    el.setAttribute('data-bwbr-char-msg-color', color || '#e0e0e0');
    window.dispatchEvent(new Event('bwbr-send-message-as-char'));
  }

  // ------------------------------------------------
  //  4. Token click handling
  // ------------------------------------------------
  function findTokenElement(target) {
    // .movable가 이중 중첩됨 (outer: position:absolute+transform, inner: relative+size)
    // 가장 바깥쪽 .movable를 반환해야 이미지를 포함함
    var el = target;
    var found = null;
    for (var d = 0; el && d < 20; d++, el = el.parentElement) {
      if (el instanceof HTMLElement && (el.className + '').indexOf('movable') !== -1) {
        found = el; // 계속 위로 탐색하여 가장 바깥쪽 .movable 찾기
      }
    }
    return found;
  }

  /** .movable 조상 중 개별 패널 수준의 transform 을 가진 요소 찾기 */
  function findPanelTransform(rawTarget) {
    // 클릭 대상에서 위로 올라가며 모든 .movable를 수집
    var el = rawTarget;
    var movables = [];
    for (var d = 0; el && d < 20; d++, el = el.parentElement) {
      if (el instanceof HTMLElement && (el.className + '').indexOf('movable') !== -1) {
        movables.push(el);
      }
    }
    // 외부→내부 순서 (outermost first — token-binding과 동일 방식)
    for (var i = movables.length - 1; i >= 0; i--) {
      var raw = movables[i].style.transform || '(inline 없음)';
      var computed = '';
      try { computed = window.getComputedStyle(movables[i]).transform || '(없음)'; } catch (e) { computed = '(에러)'; }
      console.log('[Branch Move] movable[' + i + '/' + movables.length + '] inline="' + raw + '" computed="' + computed + '"');
      var pos = extractTransformPosition(movables[i]);
      if (pos) {
        console.log('[Branch Move] 패널 transform 발견: movable[' + i + '/' + movables.length + '] pos=(' + pos.x + ', ' + pos.y + ')');
        return pos;
      }
    }
    console.log('[Branch Move] ⚠️ 모든 movable(' + movables.length + '개)에서 transform 발견 못함');
    return null;
  }

  function handleTokenClick(tokenEl, rawTarget) {
    var imageUrl = extractTokenImageUrl(tokenEl);
    // 1) pointerdown 캐시 (가장 안정적 — token-binding 방식과 동일)
    var position = _lastPointerDownPos;
    _lastPointerDownPos = null;
    // 2) 폴백: rawTarget에서 직접 탐색
    if (!position) {
      position = findPanelTransform(rawTarget || tokenEl);
    }
    // 3) 폴백: token-binding의 pointerdown 추적 데이터
    if (!position && window.BWBR_getLastClickedPanel) {
      var last = window.BWBR_getLastClickedPanel();
      if (last && last.position) {
        position = last.position;
        console.log('[Branch Move] token-binding 폴백 위치: (' + position.x + ', ' + position.y + ')');
      }
    }
    console.log('[Branch Move] 토큰 클릭: imageUrl=' + (imageUrl ? imageUrl.substring(0, 60) + '...' : 'null') +
        ', pos=' + (position ? '(' + position.x + ', ' + position.y + ')' : 'NULL'));

    if (!imageUrl) {
      LOG('이미지 URL을 찾을 수 없습니다');
      showToast('토큰 이미지를 찾을 수 없습니다', 3000);
      return;
    }

    requestCharForMove(imageUrl, position).then(function (result) {
      if (!result || !result.success) {
        LOG('매칭 실패 — memo에 〔캐릭터이름〕이 있는지 확인하세요');
        return;
      }
      _selectedItem = { item: result.item, char: result.char };
      showMoveRange(result.item, result.char);
    });
  }

  // ------------------------------------------------
  //  5. Document click handler (capture phase)
  //     전투 모드 ON일 때 모든 클릭을 관리
  // ------------------------------------------------

  /** 전투 모드 시 pointerdown 위치 캐시 (드래그는 차단하지 않음) */
  var _lastPointerDownPos = null;  // pointerdown 시점의 위치 캐시
  var _pointerDownScreenPos = null; // 화면 좌표 (드래그 판별용)
  function onCombatPointerDown(e) {
    if (!_combatMode && !_contextMoveActive) return;
    var movable = findTokenElement(e.target);
    if (movable) {
      // ★ pointerdown 시점에 위치 추출 (click보다 안정적 — token-binding과 동일 타이밍)
      _lastPointerDownPos = extractTransformPosition(movable);
      _pointerDownScreenPos = { x: e.clientX, y: e.clientY };
      console.log('[Branch Move] pointerdown 위치 캐시: ' +
        (_lastPointerDownPos ? '(' + _lastPointerDownPos.x + ', ' + _lastPointerDownPos.y + ')' : 'NULL') +
        ' (inline="' + (movable.style.transform || '') + '")');
      // 드래그는 차단하지 않음 — 클릭 이벤트에서 처리
    }
  }

  /** 전투 모드 시 우클릭 차단 (캐릭터 선택 드롭다운만 허용) */
  function onCombatContextMenu(e) {
    if (!_combatMode) return;
    // 캐릭터 선택 드롭다운(MuiPopover) 내부는 허용
    if (e.target.closest && e.target.closest('.MuiPopover-root')) return;
    // 전투 모드일 때 모든 우클릭 차단
    e.stopPropagation();
    e.preventDefault();
  }

  /** 클릭이 드래그인지 판별 (5px 이상 이동 = 드래그) */
  function _wasDrag(e) {
    if (!_pointerDownScreenPos) return false;
    var dx = e.clientX - _pointerDownScreenPos.x;
    var dy = e.clientY - _pointerDownScreenPos.y;
    return (dx * dx + dy * dy) > 25;
  }

  /** 전투 모드 컨텍스트 메뉴 닫기 */
  var _combatCtxMenu = null;
  function closeCombatContextMenu() {
    if (_combatCtxMenu) { _combatCtxMenu.remove(); _combatCtxMenu = null; }
  }

  /** 전투 모드용 컨텍스트 메뉴 표시 (토큰 클릭 시) */
  function showCombatContextMenu(e, tokenEl, rawTarget) {
    closeCombatContextMenu();

    var imageUrl = extractTokenImageUrl(tokenEl);
    var position = _lastPointerDownPos;
    _lastPointerDownPos = null;
    if (!position) position = findPanelTransform(rawTarget || tokenEl);
    if (!position && window.BWBR_getLastClickedPanel) {
      var last = window.BWBR_getLastClickedPanel();
      if (last && last.position) position = last.position;
    }
    if (!imageUrl) return;

    requestCharForMove(imageUrl, position).then(function (result) {
      if (!result || !result.success) {
        LOG('토큰 매칭 실패 — 바인딩 안 된 패널');
        return;
      }
      _buildCombatMenu(e.clientX, e.clientY, result.item, result.char, imageUrl, position);
    });
  }

  /** 네이티브 코코포리아 스타일 컨텍스트 메뉴 DOM 빌드 */
  function _buildCombatMenu(x, y, item, charData, imageUrl, position) {
    // MuiPopover-root (최외곽)
    var popover = document.createElement('div');
    popover.className = 'bwbr-combat-ctx';
    popover.style.cssText =
      'position:fixed;inset:0;z-index:1300;';

    // 투명 백드롭 (클릭 시 닫기)
    var backdrop = document.createElement('div');
    backdrop.style.cssText =
      'position:fixed;inset:0;z-index:-1;' +
      'background-color:transparent;-webkit-tap-highlight-color:transparent;';
    backdrop.addEventListener('click', function () { closeCombatContextMenu(); });
    popover.appendChild(backdrop);

    // MuiPaper-root.MuiMenu-paper
    var paper = document.createElement('div');
    paper.style.cssText =
      'position:absolute;overflow-x:hidden;overflow-y:auto;' +
      'min-width:16px;min-height:16px;max-width:calc(100% - 32px);max-height:calc(100% - 96px);' +
      'outline:0;opacity:1;transform:none;' +
      'background-color:rgba(44,44,44,0.87);color:#fff;' +
      'border-radius:4px;' +
      'box-shadow:0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12);' +
      'transition:opacity 251ms cubic-bezier(0.4,0,0.2,1),transform 167ms cubic-bezier(0.4,0,0.2,1);';
    paper.style.left = x + 'px';
    paper.style.top = y + 'px';

    // ul.MuiList-root (role="menu")
    var ul = document.createElement('ul');
    ul.setAttribute('role', 'menu');
    ul.style.cssText =
      'list-style:none;margin:0;padding:8px 0;' +
      'position:relative;outline:0;';

    // ── 이동 (전투 이동: 이동거리 기반) ──
    ul.appendChild(_ctxMenuItem('이동', function () {
      closeCombatContextMenu();
      _selectedItem = { item: item, char: charData };
      showMoveRange(item, charData);
    }));

    // ── 도약 (미구현) ──
    ul.appendChild(_ctxMenuItem('도약', null, true));

    // ── 돌진 (미구현) ──
    ul.appendChild(_ctxMenuItem('돌진', null, true));

    // 구분선 (MuiDivider)
    var hr = document.createElement('hr');
    hr.style.cssText =
      'margin:4px 0;border:none;height:1px;flex-shrink:0;' +
      'background-color:rgba(255,255,255,0.12);';
    ul.appendChild(hr);

    // ── 편집 ──
    ul.appendChild(_ctxMenuItem('편집', function () {
      closeCombatContextMenu();
      window.dispatchEvent(new CustomEvent('bwbr-character-edit', { detail: { name: charData.name } }));
    }));

    // ── 캐릭터 목록에 표시 (hideStatus 토글) ──
    ul.appendChild(_ctxMenuItem('캐릭터 목록에 표시', function () {
      closeCombatContextMenu();
      var payload = JSON.stringify({ op: 'toggleHideStatus', ids: [charData._id] });
      document.documentElement.setAttribute('data-bwbr-char-batch-op', payload);
      document.dispatchEvent(new CustomEvent('bwbr-char-batch-op'));
      window.dispatchEvent(new CustomEvent('bwbr-char-batch-op'));
    }));

    // ── 패널 숨기기 (visible 토글) ──
    ul.appendChild(_ctxMenuItem('패널 숨기기', function () {
      closeCombatContextMenu();
      var payload = JSON.stringify({ op: 'toggleVisible', ids: [item._id] });
      document.documentElement.setAttribute('data-bwbr-panel-batch-op', payload);
      document.dispatchEvent(new CustomEvent('bwbr-panel-batch-op'));
      window.dispatchEvent(new CustomEvent('bwbr-panel-batch-op'));
    }));

    // ── 삭제 ──
    ul.appendChild(_ctxMenuItem('삭제', function () {
      closeCombatContextMenu();
      var payload = JSON.stringify({ op: 'delete', ids: [item._id] });
      document.documentElement.setAttribute('data-bwbr-panel-batch-op', payload);
      document.dispatchEvent(new CustomEvent('bwbr-panel-batch-op'));
      window.dispatchEvent(new CustomEvent('bwbr-panel-batch-op'));
    }));

    paper.appendChild(ul);
    popover.appendChild(paper);
    document.body.appendChild(popover);
    _combatCtxMenu = popover;

    // 화면 밖으로 나가지 않도록 위치 보정
    requestAnimationFrame(function () {
      var r = paper.getBoundingClientRect();
      if (r.right > innerWidth) paper.style.left = (innerWidth - r.width - 8) + 'px';
      if (r.bottom > innerHeight) paper.style.top = (innerHeight - r.height - 8) + 'px';
    });
  }

  /** 네이티브 MUI MenuItem 스타일 (li.MuiMenuItem-root) */
  function _ctxMenuItem(label, onClick, disabled) {
    var li = document.createElement('li');
    li.setAttribute('role', 'menuitem');
    li.textContent = label;
    li.style.cssText =
      'display:flex;align-items:center;justify-content:flex-start;' +
      'appearance:none;outline:0;border:0;margin:0;cursor:pointer;' +
      'user-select:none;vertical-align:middle;-webkit-tap-highlight-color:transparent;' +
      'font-family:"Roboto","Helvetica","Arial",sans-serif;font-weight:400;' +
      'font-size:1rem;line-height:1.5;letter-spacing:0.00938em;' +
      'padding:6px 16px;box-sizing:border-box;white-space:nowrap;' +
      'min-height:36px;color:#fff;background-color:transparent;' +
      'text-decoration:none;transition:background-color 150ms cubic-bezier(0.4,0,0.2,1);' +
      'list-style:none;';
    if (disabled) {
      li.style.opacity = '0.38';
      li.style.pointerEvents = 'none';
      li.style.cursor = 'default';
    } else {
      li.onmouseenter = function () { li.style.backgroundColor = 'rgba(255,255,255,0.08)'; };
      li.onmouseleave = function () { li.style.backgroundColor = 'transparent'; };
      li.addEventListener('click', function (ev) { ev.stopPropagation(); onClick(); });
    }
    return li;
  }

  function onCombatClick(e) {
    if (!_combatMode) return;

    // 전투 컨텍스트 메뉴가 열려있으면 닫고 무시
    if (_combatCtxMenu) {
      closeCombatContextMenu();
      return;
    }

    // 드래그였으면 무시 (네이티브 드래그 이동)
    if (_wasDrag(e)) {
      _pointerDownScreenPos = null;
      return;
    }
    _pointerDownScreenPos = null;

    // 이동 타일 클릭 → 타일의 자체 핸들러가 처리 (간섭 안 함)
    if (e.target.closest && e.target.closest('[data-bwbr-move-tile]')) return;

    // 현재 위치 표시자 클릭 → 이동 취소
    if (e.target.closest && e.target.closest('[data-bwbr-current-pos]')) {
      e.stopPropagation();
      e.preventDefault();
      clearMoveOverlay();
      _selectedItem = null;
      LOG('이동 취소');
      return;
    }

    // 오버레이가 표시 중일 때
    if (_moveOverlay) {
      // 다른 토큰 클릭 → 새 토큰의 컨텍스트 메뉴
      var movable = findTokenElement(e.target);
      if (movable) {
        e.stopPropagation();
        e.preventDefault();
        clearMoveOverlay();
        _selectedItem = null;
        showCombatContextMenu(e, movable, e.target);
        return;
      }
      // 다른 곳 클릭 → 오버레이 해제
      clearMoveOverlay();
      _selectedItem = null;
      return;
    }

    // 오버레이 없음 → 토큰 클릭 시 전투 모드 컨텍스트 메뉴 표시
    var token = findTokenElement(e.target);
    if (token) {
      e.stopPropagation();
      e.preventDefault();
      showCombatContextMenu(e, token, e.target);
    }
  }

  // ------------------------------------------------
  //  6. Movement range overlay
  // ------------------------------------------------
  function showMoveRange(item, char) {
    clearMoveOverlay();

    var zoom = findZoomContainer();
    if (!zoom) {
      LOG('zoom container를 찾을 수 없습니다');
      return;
    }

    // params에서 이동거리 파싱
    var moveDistance = 0;
    if (char.params) {
      for (var i = 0; i < char.params.length; i++) {
        var p = char.params[i];
        if (p.label && (p.label === '이동거리' || p.label.indexOf('이동거리') !== -1 || p.label.indexOf('이동') !== -1)) {
          moveDistance = parseInt(p.value, 10) || 0;
          break;
        }
      }
    }

    if (moveDistance <= 0) {
      LOG(char.name + ': 이동거리를 찾을 수 없거나 0입니다');
      showToast(char.name + ': 이동거리 매개변수를 찾을 수 없습니다', 3000);
      return;
    }

    LOG(char.name + ': 이동거리 ' + moveDistance +
      ', 위치 (' + item.x + ', ' + item.y + ')' +
      ', 크기 ' + item.width + 'x' + item.height +
      ', 그리드 ' + _gridSize + ' (' + _gridCellPx + 'px)');

    // 오버레이 컨테이너 생성
    _moveOverlay = document.createElement('div');
    _moveOverlay.id = 'bwbr-move-overlay';
    _moveOverlay.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'z-index:9999;pointer-events:none;';

    // 이동 한칸(스텝) = gridSize (네이티브 셀 단위)
    var stepW = _gridSize;
    var stepH = _gridSize;
    // 토큰이 차지하는 그리드 셀 수 (네이티브 셀 단위 → 그리드 셀 단위)
    var tokenGW = Math.ceil(item.width / _gridSize);  // 토큰 폭 (그리드 셀)
    var tokenGH = Math.ceil(item.height / _gridSize);  // 토큰 높이 (그리드 셀)
    var tokenPxW = item.width * CELL_PX;
    var tokenPxH = item.height * CELL_PX;

    // 1단계: 이동 가능 영역의 모든 그리드 셀을 수집 (중복 없이)
    //   각 이동 목적지에서 토큰이 차지하는 그리드 셀들을 Set에 추가
    var reachableCells = {};      // key = "gx,gy" → { dist: 맨해튼 거리 }
    var moveTargets = [];         // 클릭 가능한 이동 목적지 목록

    for (var dx = -moveDistance; dx <= moveDistance; dx++) {
      for (var dy = -moveDistance; dy <= moveDistance; dy++) {
        var dist = Math.abs(dx) + Math.abs(dy);
        if (dist === 0 || dist > moveDistance) continue;

        var targetX = item.x + dx * stepW;
        var targetY = item.y + dy * stepH;
        moveTargets.push({ x: targetX, y: targetY, dist: dist });

        // 이 목적지에서 토큰이 커버하는 모든 그리드 셀
        for (var gx = 0; gx < tokenGW; gx++) {
          for (var gy = 0; gy < tokenGH; gy++) {
            var cellX = targetX + gx * _gridSize;
            var cellY = targetY + gy * _gridSize;
            var key = cellX + ',' + cellY;
            // 가장 가까운 거리를 기록 (색상 결정용)
            if (!reachableCells[key] || reachableCells[key].dist > dist) {
              reachableCells[key] = { x: cellX, y: cellY, dist: dist };
            }
          }
        }
      }
    }

    // 현재 위치의 토큰 셀은 제외 (현재 위치는 별도 마커)
    for (var gx = 0; gx < tokenGW; gx++) {
      for (var gy = 0; gy < tokenGH; gy++) {
        var key = (item.x + gx * _gridSize) + ',' + (item.y + gy * _gridSize);
        delete reachableCells[key];
      }
    }

    // 2단계: 겹치지 않는 그리드 셀 단위로 영역 렌더링
    var cellKeys = Object.keys(reachableCells);
    for (var ci = 0; ci < cellKeys.length; ci++) {
      var cell = reachableCells[cellKeys[ci]];
      var intensity = moveDistance > 0 ? 1 - (cell.dist - 1) / moveDistance : 0.5;
      intensity = Math.max(0.15, Math.min(1, intensity));
      var alpha = (0.10 + intensity * 0.18).toFixed(2);

      var cellEl = document.createElement('div');
      cellEl.style.cssText =
        'position:absolute;' +
        'left:' + (cell.x * CELL_PX) + 'px;' +
        'top:' + (cell.y * CELL_PX) + 'px;' +
        'width:' + _gridCellPx + 'px;' +
        'height:' + _gridCellPx + 'px;' +
        'background:rgba(66,165,245,' + alpha + ');' +
        'box-sizing:border-box;' +
        'pointer-events:none;';
      _moveOverlay.appendChild(cellEl);
    }

    // 3단계: 클릭 가능한 이동 목적지 마커 (토큰 크기, 투명 + 테두리)
    for (var ti = 0; ti < moveTargets.length; ti++) {
      var t = moveTargets[ti];
      var tile = createMoveTile(
        t.x * CELL_PX, t.y * CELL_PX,
        tokenPxW, tokenPxH,
        item, char, t.x, t.y, moveDistance
      );
      _moveOverlay.appendChild(tile);
    }

    // 현재 위치 표시 (노란색, 토큰 전체 크기, 클릭 시 취소)
    var currentTile = document.createElement('div');
    currentTile.setAttribute('data-bwbr-current-pos', '');
    currentTile.style.cssText =
      'position:absolute;' +
      'left:' + (item.x * CELL_PX) + 'px;' +
      'top:' + (item.y * CELL_PX) + 'px;' +
      'width:' + tokenPxW + 'px;' +
      'height:' + tokenPxH + 'px;' +
      'background:rgba(255,235,59,0.25);' +
      'border:2px solid rgba(255,235,59,0.7);' +
      'box-sizing:border-box;' +
      'pointer-events:auto;' +
      'cursor:pointer;' +
      'z-index:1;' +
      'border-radius:2px;';
    // 네이티브 코코포리아 스타일 툴팁
    var curTooltipEl = null;
    var curTooltipText = char.name + ' (현재 위치 — 클릭하면 취소)';
    currentTile.addEventListener('mouseenter', function (ev) {
      curTooltipEl = _createTooltip(curTooltipText);
      _positionTooltip(curTooltipEl, ev);
      document.body.appendChild(curTooltipEl);
    });
    currentTile.addEventListener('mousemove', function (ev) {
      if (curTooltipEl) _positionTooltip(curTooltipEl, ev);
    });
    currentTile.addEventListener('mouseleave', function () {
      if (curTooltipEl) { curTooltipEl.remove(); curTooltipEl = null; }
    });
    _moveOverlay.appendChild(currentTile);

    // 이동 거리 라벨 (현재 위치 위에 표시)
    var label = document.createElement('div');
    label.style.cssText =
      'position:absolute;' +
      'left:' + (item.x * CELL_PX) + 'px;' +
      'top:' + (item.y * CELL_PX - 20) + 'px;' +
      'width:' + tokenPxW + 'px;' +
      'height:20px;' +
      'display:flex;align-items:center;justify-content:center;' +
      'color:#fff;font-size:11px;font-weight:bold;' +
      'text-shadow:0 1px 3px rgba(0,0,0,0.8);' +
      'pointer-events:none;white-space:nowrap;';
    label.textContent = char.name + ' — 이동거리 ' + moveDistance;
    _moveOverlay.appendChild(label);

    zoom.appendChild(_moveOverlay);
    LOG('이동 범위 표시됨 (' + countTiles(moveDistance) + '칸)');
  }

  /** 경유지에서의 맨해튼 거리 (현재 위치 또는 마지막 경유지 기준) */
  function waypointDistFrom(item, targetX, targetY) {
    var fromX, fromY;
    if (_waypoints.length > 0) {
      fromX = _waypoints[_waypoints.length - 1].x;
      fromY = _waypoints[_waypoints.length - 1].y;
    } else {
      fromX = item.x;
      fromY = item.y;
    }
    return Math.abs(targetX - fromX) / _gridSize + Math.abs(targetY - fromY) / _gridSize;
  }

  /** 전체 경로 거리 합 (현재 위치 → 경유지들 → 목표) */
  function totalPathDist(item, targetX, targetY) {
    return _totalWaypointDist + waypointDistFrom(item, targetX, targetY);
  }

  /** 경유지 마커 추가 (초록 점선 테두리 + 중앙 거리 표시) */
  function addWaypointMarker(wpX, wpY, tokenPxW, tokenPxH, num, usedDist, moveMax) {
    if (!_moveOverlay) return;
    var marker = document.createElement('div');
    marker.setAttribute('data-bwbr-waypoint', num);
    marker.style.cssText =
      'position:absolute;' +
      'left:' + (wpX * CELL_PX) + 'px;' +
      'top:' + (wpY * CELL_PX) + 'px;' +
      'width:' + tokenPxW + 'px;' +
      'height:' + tokenPxH + 'px;' +
      'background:rgba(76,175,80,0.18);' +
      'border:2px dashed rgba(76,175,80,0.8);' +
      'box-sizing:border-box;' +
      'pointer-events:none;' +
      'z-index:2;' +
      'border-radius:2px;';
    // 좌상단 순번 라벨
    var lbl = document.createElement('div');
    lbl.style.cssText =
      'position:absolute;top:2px;left:2px;' +
      'background:rgba(76,175,80,0.85);color:#fff;' +
      'font-size:10px;font-weight:bold;padding:1px 5px;border-radius:3px;' +
      'pointer-events:none;line-height:1.3;';
    lbl.textContent = num;
    marker.appendChild(lbl);
    // 중앙 이동 거리 표시 (usedDist/moveMax)
    var minDim = Math.min(tokenPxW, tokenPxH);
    var fontSize = Math.max(12, Math.min(40, Math.floor(minDim * 0.32)));
    var center = document.createElement('div');
    center.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;' +
      'display:flex;align-items:center;justify-content:center;' +
      'pointer-events:none;';
    var distLabel = document.createElement('div');
    distLabel.style.cssText =
      'font-family:"Roboto","Helvetica","Arial",sans-serif;' +
      'font-size:' + fontSize + 'px;font-weight:bold;' +
      'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.7);' +
      'line-height:1;white-space:nowrap;' +
      'pointer-events:none;';
    distLabel.innerHTML = '<span style="color:#a5d6a7">' + Math.round(usedDist) +
      '</span><span style="opacity:0.5;font-size:' + Math.round(fontSize * 0.7) + 'px">/' +
      moveMax + '</span>';
    center.appendChild(distLabel);
    marker.appendChild(center);
    _moveOverlay.appendChild(marker);
    _waypointMarkers.push(marker);
  }

  /** 경유지 경로 라인 시각화 (SVG) */
  function drawWaypointPath(item, tokenPxW, tokenPxH) {
    // 기존 경로 라인 제거
    if (_moveOverlay) {
      var oldLines = _moveOverlay.querySelectorAll('[data-bwbr-wp-line]');
      for (var i = 0; i < oldLines.length; i++) oldLines[i].remove();
    }
    if (_waypoints.length === 0 || !_moveOverlay) return;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-bwbr-wp-line', '');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;';

    var halfW = tokenPxW / 2;
    var halfH = tokenPxH / 2;
    var points = [{ x: item.x, y: item.y }].concat(_waypoints);

    for (var i = 0; i < points.length - 1; i++) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', points[i].x * CELL_PX + halfW);
      line.setAttribute('y1', points[i].y * CELL_PX + halfH);
      line.setAttribute('x2', points[i + 1].x * CELL_PX + halfW);
      line.setAttribute('y2', points[i + 1].y * CELL_PX + halfH);
      line.setAttribute('stroke', 'rgba(76,175,80,0.7)');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-dasharray', '6,4');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    }
    _moveOverlay.appendChild(svg);
  }

  /** 이동 타일 DOM 요소 생성 (클릭 가능한 투명 마커, 호버 시 토큰 윤곽 표시) */
  function createMoveTile(leftPx, topPx, widthPx, heightPx, item, char, targetX, targetY, moveMax) {
    var tile = document.createElement('div');
    tile.setAttribute('data-bwbr-move-tile', '');
    tile.setAttribute('data-target-x', targetX);
    tile.setAttribute('data-target-y', targetY);

    // 거리 계산 (경유지 기준)
    var segDist = waypointDistFrom(item, targetX, targetY);
    var fullDist = totalPathDist(item, targetX, targetY);

    tile.style.cssText =
      'position:absolute;' +
      'left:' + leftPx + 'px;' +
      'top:' + topPx + 'px;' +
      'width:' + widthPx + 'px;' +
      'height:' + heightPx + 'px;' +
      'background:transparent;' +
      'border:1px solid transparent;' +
      'box-sizing:border-box;' +
      'pointer-events:auto;' +
      'cursor:pointer;' +
      'border-radius:2px;' +
      'z-index:3;' +
      'transition:background 0.12s,border-color 0.12s;';

    // 네이티브 코코포리아 스타일 툴팁
    var tooltipText = '(' + targetX + ', ' + targetY + ') — 거리 ' + Math.round(fullDist) +
      (_waypoints.length > 0 ? ' (경유 ' + _waypoints.length + '개)' : '') +
      '\nShift+클릭: 경유지 추가 / 클릭: 최종 이동';
    var tooltipEl = null;
    tile.addEventListener('mouseenter', function (ev) {
      tile.style.background = 'rgba(66,165,245,0.30)';
      tile.style.borderColor = 'rgba(66,165,245,0.8)';
      tooltipEl = _createTooltip(tooltipText);
      _positionTooltip(tooltipEl, ev);
      document.body.appendChild(tooltipEl);
    });
    tile.addEventListener('mousemove', function (ev) {
      if (tooltipEl) _positionTooltip(tooltipEl, ev);
    });
    tile.addEventListener('mouseleave', function () {
      tile.style.background = 'transparent';
      tile.style.borderColor = 'transparent';
      if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    });

    // 클릭 → Shift면 경유지, 아니면 최종 이동
    tile.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();

      if (e.shiftKey) {
        // ── Shift+클릭: 경유지 추가 ──
        var wpDist = waypointDistFrom(item, targetX, targetY);
        _waypoints.push({ x: targetX, y: targetY });
        _totalWaypointDist += wpDist;
        LOG('경유지 추가: (' + targetX + ',' + targetY + '), 누적 ' + _totalWaypointDist);
        addWaypointMarker(targetX, targetY, widthPx, heightPx, _waypoints.length, _totalWaypointDist, moveMax);
        drawWaypointPath(item, widthPx, heightPx);
        showToast('경유지 ' + _waypoints.length + ' 추가 (' + Math.round(_totalWaypointDist) + '/' + moveMax + '칸)', 1500);

        // 이동 범위 재계산: 남은 거리 기준으로 타일 활성화/비활성화
        refreshTileReachability(item, moveMax);
        return;
      }

      // ── 일반 클릭: 최종 이동 (경유지 순서대로 실행) ──
      var finalDist = totalPathDist(item, targetX, targetY);
      var allSteps = _waypoints.slice();
      allSteps.push({ x: targetX, y: targetY });

      // 이동 중 표시
      tile.style.background = 'rgba(76,175,80,0.5)';
      tile.style.borderColor = 'rgba(76,175,80,0.8)';
      tile.style.cursor = 'wait';

      executePathSequence(item._id, allSteps, 0, function (allOk) {
        if (allOk) {
          LOG(char.name + ' 경로 이동: ' + allSteps.length + '단계, 총 ' + Math.round(finalDist) + '칸');
          var moveMsg = '【이동👣】| ' + Math.round(finalDist) + '칸 이동' +
            (allSteps.length > 1 ? ' (' + allSteps.length + '단계)' : '');
          sendChatAsChar(moveMsg, char.name, char.iconUrl, char.color);
          // 전투 보조: 이동된 캐릭터가 현재 차례일 때만 행동 소비
          if (window.BWBR_CombatController) {
            var cc = window.BWBR_CombatController;
            var ce = cc.getCombatEngine && cc.getCombatEngine();
            var curChar = ce && ce.getState() && ce.getState().currentCharacter;
            console.log('[Branch Move] 행동 소비 체크: 이동캐릭="' + char.name + '", 현재차례="' + (curChar ? curChar.name : 'null') + '", 일치=' + (curChar ? curChar.name === char.name : false));
            if (curChar && curChar.name === char.name) {
              cc.checkForCombatAssistTrigger(moveMsg);
            } else {
              console.log('[Branch Move] 행동 소비 생략: 이동="' + char.name + '" ≠ 현재차례="' + (curChar ? curChar.name : 'null') + '"');
            }
          }
        } else {
          LOG('이동 실패');
          showToast('이동 실패', 2000);
        }
        clearMoveOverlay();
        _selectedItem = null;
        if (_contextMoveActive) endContextMove();
      });
    });

    return tile;
  }

  /** 경유지 후 남은 이동 거리에 따라 타일 도달 가능/불가 토글 */
  function refreshTileReachability(item, moveMax) {
    if (!_moveOverlay) return;
    var tiles = _moveOverlay.querySelectorAll('[data-bwbr-move-tile]');
    for (var i = 0; i < tiles.length; i++) {
      var tx = parseInt(tiles[i].getAttribute('data-target-x'), 10);
      var ty = parseInt(tiles[i].getAttribute('data-target-y'), 10);
      var pathDist = totalPathDist(item, tx, ty);
      if (pathDist > moveMax) {
        tiles[i].style.pointerEvents = 'none';
        tiles[i].style.opacity = '0.25';
        tiles[i].style.cursor = 'not-allowed';
      } else {
        tiles[i].style.pointerEvents = 'auto';
        tiles[i].style.opacity = '1';
        tiles[i].style.cursor = 'pointer';
      }
    }
  }

  /** 경로 순차 실행 (재귀) */
  function executePathSequence(itemId, steps, idx, callback) {
    if (idx >= steps.length) { callback(true); return; }
    moveItem(itemId, steps[idx].x, steps[idx].y).then(function (result) {
      if (!result || !result.success) { callback(false); return; }
      // 짧은 딜레이 후 다음 스텝 (시각적 효과)
      setTimeout(function () {
        executePathSequence(itemId, steps, idx + 1, callback);
      }, 120);
    });
  }

  /** 맨해튼 거리 내 타일 수 (현재 위치 제외) */
  function countTiles(dist) {
    // 맨해튼 거리 d 내 격자점 수 = 2d(d+1), 원점 제외
    return 2 * dist * (dist + 1);
  }

  function clearMoveOverlay() {
    // 잔여 툴팁 제거
    document.querySelectorAll('[data-bwbr-tooltip]').forEach(function (t) { t.remove(); });
    if (_moveOverlay) {
      _moveOverlay.remove();
      _moveOverlay = null;
    }
    _waypoints = [];
    _waypointMarkers = [];
    _totalWaypointDist = 0;
  }

  // ------------------------------------------------
  //  7. Combat mode toggle
  // ------------------------------------------------
  function enableCombatMode() {
    if (_combatMode) return;
    _combatMode = true;
    document.addEventListener('click', onCombatClick, true);
    document.addEventListener('pointerdown', onCombatPointerDown, true);
    document.addEventListener('contextmenu', onCombatContextMenu, true);
    updateFabLabel();
    showHelpPanel();
    showToast('전투 모드 활성화', 2000);
    LOG('전투 모드 ON');
  }

  function disableCombatMode() {
    _combatMode = false;
    clearMoveOverlay();
    closeCombatContextMenu();
    _selectedItem = null;
    document.removeEventListener('click', onCombatClick, true);
    document.removeEventListener('pointerdown', onCombatPointerDown, true);
    document.removeEventListener('contextmenu', onCombatContextMenu, true);
    updateFabLabel();
    hideHelpPanel();
    showToast('전투 모드 비활성화', 2000);
    LOG('전투 모드 OFF');
  }

  function toggleCombatMode() {
    if (_combatMode) disableCombatMode();
    else enableCombatMode();
  }

  // ------------------------------------------------
  //  8. FAB menu injection (grid-overlay.js 패턴)
  // ------------------------------------------------
  var COMBAT_ATTR = 'data-bwbr-combat';

  function findFabMenuList() {
    var popovers = document.querySelectorAll('.MuiPopover-root');
    for (var i = 0; i < popovers.length; i++) {
      var paper = popovers[i].querySelector('.MuiPaper-root');
      if (!paper) continue;
      var list = paper.querySelector('.MuiList-root');
      if (!list) continue;
      var items = list.querySelectorAll('.MuiListItemButton-root');
      if (items.length < 4) continue;
      // FAB 메뉴 식별: "스크린 패널" (KR) 또는 "スクリーンパネル" (JP)
      // 이 텍스트는 FAB 메뉴의 "스크린 패널을 추가" 항목에만 존재
      var text = list.textContent;
      if (text.indexOf('스크린 패널') === -1 && text.indexOf('スクリーンパネル') === -1) continue;
      return list;
    }
    return null;
  }

  function setupFabInjection() {
    function tryInject() {
      // 이미 주입됨
      var existing = document.querySelector('[' + COMBAT_ATTR + ']');
      if (existing) { updateFabLabel(); return; }

      var list = findFabMenuList();
      if (!list) return;

      var items = list.querySelectorAll('.MuiListItemButton-root');
      if (items.length === 0) return;

      // PRO 뱃지 없는 아이템을 복제 원본으로 선택
      var source = items[0];
      for (var i = 0; i < items.length; i++) {
        if (!/PRO|Pro/i.test(items[i].textContent)) { source = items[i]; break; }
      }

      var clone = source.cloneNode(true);
      clone.setAttribute(COMBAT_ATTR, '');
      clone.removeAttribute('disabled');
      clone.removeAttribute('aria-disabled');
      clone.classList.remove('Mui-disabled');

      // React 내부 속성 제거
      (function strip(el) {
        for (var k of Object.keys(el)) {
          if (k.startsWith('__react')) try { delete el[k]; } catch (e) {}
        }
        for (var c of el.children) strip(c);
      })(clone);

      // PRO 뱃지 / Chip / Badge 제거
      clone.querySelectorAll('.MuiChip-root, .MuiBadge-root, [class*="Badge"]')
        .forEach(function (el) { el.remove(); });
      clone.querySelectorAll('span, p').forEach(function (el) {
        if (/^\s*PRO\s*$/i.test(el.textContent) && !el.querySelector('svg')) el.remove();
      });

      // 텍스트 교체
      var lit = clone.querySelector('.MuiListItemText-root');
      if (lit) {
        var typos = lit.querySelectorAll('.MuiTypography-root');
        if (typos.length > 0) {
          typos[0].textContent = _combatMode ? '전투 모드 끄기' : '전투 모드';
        }
        if (typos.length > 1) {
          typos[1].textContent = '이동 범위 표시 + 클릭 이동 (Alt+*)';
          for (var j = 2; j < typos.length; j++) typos[j].remove();
        } else {
          var desc = document.createElement('span');
          desc.className = typos[0] ? typos[0].className : '';
          desc.style.cssText = 'display:block;font-size:0.75rem;opacity:0.7;';
          desc.textContent = '이동 범위 표시 + 클릭 이동 (Alt+*)';
          lit.appendChild(desc);
        }
      } else {
        var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        var tNodes = [], tn;
        while ((tn = walker.nextNode())) tNodes.push(tn);
        if (tNodes.length > 0) tNodes[0].textContent = _combatMode ? '전투 모드 끄기' : '전투 모드';
        for (var j = 1; j < tNodes.length; j++) {
          if (!tNodes[j].parentElement.closest('svg')) tNodes[j].textContent = '';
        }
      }

      // 아이콘 교체 (검 아이콘)
      var svg = clone.querySelector('svg');
      if (svg) {
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.innerHTML =
          '<path fill="currentColor" d="M6.92 5H5l9 9 1-.94-7.08-8.06M16 2l-4 4 7.08 7.08L23 9l-7-7M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>';
      }

      // 클릭 핸들러
      function onCombatItemClick(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleCombatMode();
        // FAB Popover 닫기
        var popover = clone.closest('.MuiPopover-root');
        if (popover) {
          var backdrop = popover.querySelector('.MuiBackdrop-root');
          if (backdrop) backdrop.click();
        }
      }
      clone.addEventListener('click', onCombatItemClick, true);
      clone.querySelectorAll('button, [role="button"]').forEach(function (btn) {
        btn.addEventListener('click', onCombatItemClick, true);
      });

      // ── 메뉴 스크롤 가능하게 (확장 항목 추가로 넘칠 수 있음) ──
      var paper = list.closest('.MuiPaper-root');
      if (paper) {
        var pRect = paper.getBoundingClientRect();
        var maxAvail = window.innerHeight - pRect.top - 16;
        if (maxAvail > 100) paper.style.maxHeight = maxAvail + 'px';
      }

      // 그리드 버튼 뒤에 삽입 (없으면 첫 번째 항목 뒤)
      var gridItem = list.querySelector('[data-bwbr-grid]');
      if (gridItem && gridItem.nextSibling) {
        list.insertBefore(clone, gridItem.nextSibling);
      } else if (list.children[0]) {
        if (list.children[1]) {
          list.insertBefore(clone, list.children[1]);
        } else {
          list.appendChild(clone);
        }
      } else {
        list.appendChild(clone);
      }

      LOG('FAB 메뉴 전투 모드 항목 주입');
    }

    // grid-overlay 주입 완료 시그널 → 확실한 주입
    window.addEventListener('bwbr-fab-injected', function () {
      setTimeout(tryInject, 50);
    });

    // MutationObserver (자체 감지, non-canceling setTimeout 디바운스)
    var pending = false;
    var obs = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; tryInject(); }, 150);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function updateFabLabel() {
    var el = document.querySelector('[' + COMBAT_ATTR + ']');
    if (!el) return;
    var lit = el.querySelector('.MuiListItemText-root');
    if (lit) {
      var typos = lit.querySelectorAll('.MuiTypography-root');
      if (typos.length > 0) {
        typos[0].textContent = _combatMode ? '전투 모드 끄기' : '전투 모드';
      }
    } else {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var tn = walker.nextNode();
      if (tn && !tn.parentElement.closest('svg')) {
        tn.textContent = _combatMode ? '전투 모드 끄기' : '전투 모드';
      }
    }
  }

  // ------------------------------------------------
  //  9. Combat mode help panel
  //     전투 모드 ON 시 오른쪽에서 슬라이드 인, OFF 시 슬라이드 아웃
  // ------------------------------------------------
  /** 채팅 드로어 paper 요소 탐색 */
  function _findDrawerPaper() {
    return document.querySelector('.MuiDrawer-paperAnchorDockedRight')
      || document.querySelector('.MuiDrawer-paperAnchorRight')
      || document.querySelector('.MuiDrawer-paper');
  }

  function showHelpPanel() {
    if (_helpPanel) return;

    var paper = _findDrawerPaper();
    if (!paper) return;

    var paperLeft = paper.getBoundingClientRect().left;

    _helpPanel = document.createElement('div');
    _helpPanel.id = 'bwbr-combat-help';

    // 초기 상태: 오른쪽으로 밀려나 있음 (translateX(0) = 드로어 안쪽에 숨김)
    _helpPanel.style.cssText =
      'position:fixed;top:140px;' +
      'left:' + paperLeft + 'px;' +
      'transform:translateX(0);' +
      'z-index:10;width:220px;' +
      'background:rgba(30,30,30,0.92);color:#eee;' +
      'border-radius:8px 0 0 8px;' +
      'box-shadow:-2px 0 16px rgba(0,0,0,0.4);' +
      'font-family:"Roboto","Helvetica","Arial",sans-serif;' +
      'font-size:12px;line-height:1.7;' +
      'pointer-events:auto;' +
      'border:1px solid rgba(255,255,255,0.1);border-right:none;' +
      'opacity:0;overflow:hidden;box-sizing:border-box;' +
      'transition:transform 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease, width 0.35s cubic-bezier(0.2,0.8,0.3,1);';

    // content: 펼침 시 보임, 접힘 시 opacity로 숨김 (overflow:hidden이 잘라줌)
    // tab: 접힘 시 보임, position:absolute로 좁은 폭에 맞춤
    _helpPanel.innerHTML =
      '<div id="bwbr-help-content" style="padding:14px 18px;white-space:nowrap;' +
      'transition:opacity 0.25s;">' +
      '<div style="font-size:13px;font-weight:bold;margin-bottom:8px;color:#42a5f5;">' +
      '⚔️ 전투 모드</div>' +
      '<div style="margin-bottom:4px;">🖱️ <b>토큰 클릭</b> — 전투 메뉴</div>' +
      '<div style="margin-bottom:4px;">🖱️ <b>드래그</b> — 토큰 이동</div>' +
      '<div style="margin-bottom:4px;">⇧ <b>Shift+클릭</b> — 경유지 추가</div>' +
      '<div style="margin-bottom:4px;">🟡 <b>현재 위치 클릭</b> — 취소</div>' +
      '<div style="margin-bottom:0;opacity:0.6;font-size:11px;margin-top:6px;">' +
      'Alt+* 로 전투 모드 토글</div>' +
      '</div>' +
      '<div id="bwbr-help-tab" style="position:absolute;top:0;left:0;right:0;bottom:0;' +
      'display:flex;align-items:center;justify-content:center;' +
      'writing-mode:vertical-rl;font-size:11px;font-weight:bold;color:#42a5f5;' +
      'letter-spacing:2px;cursor:pointer;' +
      'opacity:0;pointer-events:none;transition:opacity 0.25s;">⚔️ 전투</div>';

    paper.appendChild(_helpPanel);

    // 슬라이드 인: 오른쪽에서 왼쪽으로 자연스럽게 나오기
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (_helpPanel) {
          _helpPanel.style.opacity = '1';
          _helpPanel.style.transform = 'translateX(-100%)';
        }
      });
    });

  }

  function _collapseHelpPanel() {
    if (!_helpPanel) return;
    var content = _helpPanel.querySelector('#bwbr-help-content');
    var tab = _helpPanel.querySelector('#bwbr-help-tab');
    // content를 먼저 투명하게 → width 줄이면 overflow:hidden이 잘라냄 (구겨짐 없음)
    if (content) content.style.opacity = '0';
    if (tab) tab.style.opacity = '1';
    _helpPanel.style.width = '28px';
    _helpPanel.style.opacity = '0.7';
    _helpPanel.style.cursor = 'pointer';
  }

  function _expandHelpPanel() {
    if (!_helpPanel) return;
    var content = _helpPanel.querySelector('#bwbr-help-content');
    var tab = _helpPanel.querySelector('#bwbr-help-tab');
    _helpPanel.style.width = '220px';
    _helpPanel.style.opacity = '1';
    _helpPanel.style.cursor = 'default';
    if (tab) tab.style.opacity = '0';
    // width 전환 후 content 페이드인
    if (content) {
      setTimeout(function () { content.style.opacity = '1'; }, 150);
    }
  }

  function hideHelpPanel() {
    if (!_helpPanel) return;
    // 슬라이드 아웃: 왼쪽에서 오른쪽으로 드로어 안으로 돌아감
    _helpPanel.style.opacity = '0';
    _helpPanel.style.transform = 'translateX(0)';
    var panel = _helpPanel;
    _helpPanel = null;
    setTimeout(function () { panel.remove(); }, 450);
  }

  // ------------------------------------------------
  //  10. Toast notification (간단한 알림)
  // ------------------------------------------------
  function showToast(msg, dur) {
    if (!dur) dur = 3000;
    var old = document.querySelectorAll('.bwbr-combat-toast');
    for (var i = 0; i < old.length; i++) old[i].remove();

    var root = document.querySelector('#root > div') || document.body;
    var box = document.getElementById('bwbr-toast-container');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bwbr-toast-container';
      box.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:14000;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none';
      root.appendChild(box);
    }
    var t = document.createElement('div');
    t.className = 'bwbr-combat-toast';
    t.style.cssText = 'background:rgba(50,50,50,0.92);color:#fff;padding:6px 16px;border-radius:4px;font-size:0.875rem;box-shadow:0 3px 8px rgba(0,0,0,0.3);max-width:344px;opacity:0;transform:translateY(100%);transition:opacity 225ms,transform 225ms;pointer-events:auto;white-space:pre-line;font-family:"Roboto","Helvetica","Arial",sans-serif';
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'none'; });
    setTimeout(function () {
      t.style.opacity = '0'; t.style.transform = 'translateY(100%)';
      setTimeout(function () { t.remove(); }, 225);
    }, dur);
  }

  // ------------------------------------------------
  //  11. Init
  // ------------------------------------------------
  setupFabInjection();

  // gridSize 변경 감지 — 이동 한칸 크기 갱신
  window.addEventListener('bwbr-grid-size-changed', function(e) {
    var newSize = e.detail && e.detail.value;
    if (typeof newSize === 'number' && newSize > 0 && newSize !== _gridSize) {
      LOG('gridSize changed: ' + _gridSize + ' → ' + newSize);
      _gridSize = newSize;
      _gridCellPx = _gridSize * NATIVE_CELL;
      // 이동 오버레이가 표시중이면 닫기 (크기가 바뀌므로 다시 클릭하도록)
      if (_moveOverlay) {
        clearMoveOverlay();
        _selectedItem = null;
      }
    }
  });

  // gridSize 초기값 수신
  window.addEventListener('bwbr-grid-size-result', function(e) {
    if (e.detail && e.detail.success && typeof e.detail.value === 'number' && e.detail.value > 0) {
      if (e.detail.value !== _gridSize) {
        _gridSize = e.detail.value;
        _gridCellPx = _gridSize * NATIVE_CELL;
        LOG('initial gridSize: ' + _gridSize + ' (' + _gridCellPx + 'px)');
      }
    }
  }, { once: true });

  // 빠른 시작: .movable 등장 시 gridSize 조회
  (function queryGridSize() {
    function tryQuery() {
      if (document.querySelectorAll('.movable').length > 0) {
        window.dispatchEvent(new CustomEvent('bwbr-query-grid-size'));
        return true;
      }
      return false;
    }
    if (tryQuery()) return;
    var obs = new MutationObserver(function() {
      if (tryQuery()) { obs.disconnect(); clearTimeout(fb); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    var fb = setTimeout(function() {
      obs.disconnect();
      window.dispatchEvent(new CustomEvent('bwbr-query-grid-size'));
    }, 5000);
  })();

  // Alt+* 단축키로 전투 모드 토글 (capture phase — 항상 동작)
  document.addEventListener('keydown', function(e) {
    // NumPad multiply = '*', 또는 Shift+8 = '*'
    if (e.altKey && (e.key === '*' || e.code === 'NumpadMultiply' || (e.shiftKey && e.code === 'Digit8'))) {
      e.preventDefault();
      e.stopPropagation();
      toggleCombatMode();
    }
  }, true);

  // 글로벌 API
  window.__bwbrCombatMove = {
    get combatMode() { return _combatMode; },
    enable: enableCombatMode,
    disable: disableCombatMode,
    toggle: toggleCombatMode
  };

  // 우클릭 메뉴 → 전투이동 (전투 모드 아닐 때도 동작)
  window.addEventListener('bwbr-context-combat-move', function () {
    var imageUrl = document.documentElement.getAttribute('data-bwbr-context-move-url');
    document.documentElement.removeAttribute('data-bwbr-context-move-url');
    if (!imageUrl) return;

    // token-binding의 우클릭 추적 데이터로 위치 가져오기
    var position = null;
    if (window.BWBR_getLastClickedPanel) {
      var last = window.BWBR_getLastClickedPanel();
      if (last && last.position) {
        position = last.position;
        LOG('우클릭 전투이동 위치: (' + position.x + ', ' + position.y + ')');
      }
    }

    LOG('우클릭 전투이동: imageUrl=' + imageUrl.substring(0, 60) + '...');
    requestCharForMove(imageUrl, position).then(function (result) {
      if (!result || !result.success) {
        LOG('전투이동 매칭 실패');
        return;
      }
      _selectedItem = { item: result.item, char: result.char };
      showMoveRange(result.item, result.char);
      // 전투 모드가 아니면 임시 클릭 핸들러 활성화
      if (!_combatMode) {
        _contextMoveActive = true;
        document.addEventListener('click', onContextMoveClick, true);
        document.addEventListener('pointerdown', onCombatPointerDown, true);
      }
    });
  });

  // 우클릭 전투이동 전용 클릭 핸들러 (전투 모드 OFF 상태에서 사용)
  var _contextMoveActive = false;
  function onContextMoveClick(e) {
    if (!_contextMoveActive) return;

    // 이동 타일 클릭 → 타일의 자체 핸들러가 처리
    if (e.target.closest && e.target.closest('[data-bwbr-move-tile]')) return;

    // 현재 위치 클릭 → 취소
    if (e.target.closest && e.target.closest('[data-bwbr-current-pos]')) {
      e.stopPropagation();
      e.preventDefault();
      endContextMove();
      return;
    }

    // 다른 곳 클릭 → 취소
    endContextMove();
  }

  function endContextMove() {
    _contextMoveActive = false;
    clearMoveOverlay();
    _selectedItem = null;
    document.removeEventListener('click', onContextMoveClick, true);
    document.removeEventListener('pointerdown', onCombatPointerDown, true);
  }

  LOG('module loaded');
})();
