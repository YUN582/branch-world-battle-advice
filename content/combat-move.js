// ============================================================
// Combat Move - 전투 이동 시각화
//
// 전투 모드 ON → 토큰 클릭 → 이동 범위 표시 → 클릭 이동
//
// 맵 토큰 = roomItems (스크린 패널)
// 캐릭터 바인딩: 스크린 패널 memo에 〔캐릭터이름〕 기재
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

  var CELL_PX = 24;
  var LOG_PREFIX = '%c[BWBR Move]%c';
  var LOG_STYLE = 'color:#2196f3;font-weight:bold';

  function LOG() {
    var args = [LOG_PREFIX, LOG_STYLE, 'color:inherit'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  // -- state --
  var _combatMode = false;
  var _moveOverlay = null;
  var _selectedItem = null;  // { item, char }

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
  function requestCharForMove(imageUrl) {
    return new Promise(function (resolve) {
      var done = false;
      var handler = function (e) {
        if (done) return;
        done = true;
        window.removeEventListener('bwbr-char-move-data', handler);
        resolve(e.detail);
      };
      window.addEventListener('bwbr-char-move-data', handler);
      // ISOLATED→MAIN: DOM attribute 경유 (CustomEvent.detail 전달 불가)
      document.documentElement.setAttribute('data-bwbr-move-imageurl', imageUrl);
      window.dispatchEvent(new Event('bwbr-request-char-for-move'));
      setTimeout(function () {
        if (!done) {
          done = true;
          window.removeEventListener('bwbr-char-move-data', handler);
          resolve({ success: false });
        }
      }, 3000);
    });
  }

  function moveItem(itemId, x, y) {
    return new Promise(function (resolve) {
      var done = false;
      var handler = function (e) {
        if (done) return;
        done = true;
        window.removeEventListener('bwbr-move-item-result', handler);
        resolve(e.detail);
      };
      window.addEventListener('bwbr-move-item-result', handler);
      window.dispatchEvent(new CustomEvent('bwbr-move-item', {
        detail: { itemId: itemId, x: x, y: y }
      }));
      setTimeout(function () {
        if (!done) {
          done = true;
          window.removeEventListener('bwbr-move-item-result', handler);
          resolve({ success: false });
        }
      }, 5000);
    });
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

  function handleTokenClick(tokenEl) {
    var imageUrl = extractTokenImageUrl(tokenEl);
    LOG('토큰 클릭: imageUrl=' + (imageUrl ? imageUrl.substring(0, 80) + '...' : 'null'));

    if (!imageUrl) {
      LOG('이미지 URL을 찾을 수 없습니다');
      showToast('토큰 이미지를 찾을 수 없습니다', 3000);
      return;
    }

    requestCharForMove(imageUrl).then(function (result) {
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

  /** 전투 모드 시 드래그 차단 (pointerdown capture) */
  function onCombatPointerDown(e) {
    if (!_combatMode && !_contextMoveActive) return;
    var movable = findTokenElement(e.target);
    if (movable) {
      e.stopPropagation();   // 코코포리아 드래그 핸들러에 도달 못하게
      e.preventDefault();
    }
  }

  /** 전투 모드 시 우클릭 차단 (contextmenu capture) */
  function onCombatContextMenu(e) {
    if (!_combatMode) return;
    var movable = findTokenElement(e.target);
    if (movable) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  function onCombatClick(e) {
    if (!_combatMode) return;

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
      // 다른 토큰 클릭 → 새 토큰의 범위 표시
      var movable = findTokenElement(e.target);
      if (movable) {
        e.stopPropagation();
        e.preventDefault();
        handleTokenClick(movable);
        return;
      }
      // 다른 곳 클릭 → 오버레이 해제
      clearMoveOverlay();
      _selectedItem = null;
      return;
    }

    // 오버레이 없음 → 토큰 클릭 시 범위 표시
    var token = findTokenElement(e.target);
    if (token) {
      e.stopPropagation();
      e.preventDefault();
      handleTokenClick(token);
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
      ', 크기 ' + item.width + 'x' + item.height);

    // 오버레이 컨테이너 생성
    _moveOverlay = document.createElement('div');
    _moveOverlay.id = 'bwbr-move-overlay';
    _moveOverlay.style.cssText =
      'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'z-index:10;pointer-events:none;';

    var tileW = item.width;   // 타일 크기 (셀 단위)
    var tileH = item.height;
    var tilePxW = tileW * CELL_PX;
    var tilePxH = tileH * CELL_PX;

    // 맨해튼 거리 기반 이동 가능 타일 생성
    for (var dx = -moveDistance; dx <= moveDistance; dx++) {
      for (var dy = -moveDistance; dy <= moveDistance; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (Math.abs(dx) + Math.abs(dy) > moveDistance) continue;

        var targetX = item.x + dx * tileW;
        var targetY = item.y + dy * tileH;

        var tile = createMoveTile(
          targetX * CELL_PX, targetY * CELL_PX,
          tilePxW, tilePxH,
          item, char, targetX, targetY, moveDistance
        );
        _moveOverlay.appendChild(tile);
      }
    }

    // 현재 위치 표시 (노란색, 클릭 시 취소)
    var currentTile = document.createElement('div');
    currentTile.setAttribute('data-bwbr-current-pos', '');
    currentTile.style.cssText =
      'position:absolute;' +
      'left:' + (item.x * CELL_PX) + 'px;' +
      'top:' + (item.y * CELL_PX) + 'px;' +
      'width:' + tilePxW + 'px;' +
      'height:' + tilePxH + 'px;' +
      'background:rgba(255,235,59,0.25);' +
      'border:2px solid rgba(255,235,59,0.7);' +
      'box-sizing:border-box;' +
      'pointer-events:auto;' +
      'cursor:pointer;' +
      'border-radius:2px;';
    currentTile.title = char.name + ' (현재 위치 — 클릭하면 취소)';
    _moveOverlay.appendChild(currentTile);

    // 이동 거리 라벨 (현재 위치 위에 표시)
    var label = document.createElement('div');
    label.style.cssText =
      'position:absolute;' +
      'left:' + (item.x * CELL_PX) + 'px;' +
      'top:' + (item.y * CELL_PX - 20) + 'px;' +
      'width:' + tilePxW + 'px;' +
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

  /** 이동 타일 DOM 요소 생성 */
  function createMoveTile(leftPx, topPx, widthPx, heightPx, item, char, targetX, targetY, moveMax) {
    var tile = document.createElement('div');
    tile.setAttribute('data-bwbr-move-tile', '');
    tile.setAttribute('data-target-x', targetX);
    tile.setAttribute('data-target-y', targetY);

    // 맨해튼 거리에 따른 색상 변화
    var dx = Math.abs(targetX - item.x) / item.width;
    var dy = Math.abs(targetY - item.y) / item.height;
    var dist = dx + dy;
    // 가까울수록 진하고, 멀수록 연하게
    var intensity = moveMax > 0 ? 1 - (dist - 1) / moveMax : 0.5;
    intensity = Math.max(0.15, Math.min(1, intensity));
    var alpha = (0.15 + intensity * 0.25).toFixed(2);
    var borderAlpha = (0.3 + intensity * 0.4).toFixed(2);

    tile.style.cssText =
      'position:absolute;' +
      'left:' + leftPx + 'px;' +
      'top:' + topPx + 'px;' +
      'width:' + widthPx + 'px;' +
      'height:' + heightPx + 'px;' +
      'background:rgba(66,165,245,' + alpha + ');' +
      'border:1px solid rgba(66,165,245,' + borderAlpha + ');' +
      'box-sizing:border-box;' +
      'pointer-events:auto;' +
      'cursor:pointer;' +
      'border-radius:2px;' +
      'transition:background 0.12s,border-color 0.12s;';

    tile.title = '(' + targetX + ', ' + targetY + ') — 거리 ' + dist;

    // 호버 효과
    tile.addEventListener('mouseenter', function () {
      tile.style.background = 'rgba(66,165,245,0.55)';
      tile.style.borderColor = 'rgba(66,165,245,0.9)';
    });
    tile.addEventListener('mouseleave', function () {
      tile.style.background = 'rgba(66,165,245,' + alpha + ')';
      tile.style.borderColor = 'rgba(66,165,245,' + borderAlpha + ')';
    });

    // 클릭 → 이동 실행
    tile.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();

      // 이동 중 표시
      tile.style.background = 'rgba(76,175,80,0.5)';
      tile.style.borderColor = 'rgba(76,175,80,0.8)';
      tile.style.cursor = 'wait';

      moveItem(item._id, targetX, targetY).then(function (result) {
        if (result && result.success) {
          LOG(char.name + ' 이동: (' + item.x + ',' + item.y + ') → (' + targetX + ',' + targetY + ')');
          // 이동 거리 채팅 출력
          sendChatAsChar(
            '【이동👣】| ' + dist + '칸 이동',
            char.name, char.iconUrl, char.color
          );
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

  /** 맨해튼 거리 내 타일 수 (현재 위치 제외) */
  function countTiles(dist) {
    // 맨해튼 거리 d 내 격자점 수 = 2d(d+1), 원점 제외
    return 2 * dist * (dist + 1);
  }

  function clearMoveOverlay() {
    if (_moveOverlay) {
      _moveOverlay.remove();
      _moveOverlay = null;
    }
  }

  // ------------------------------------------------
  //  7. Combat mode toggle
  // ------------------------------------------------
  function enableCombatMode() {
    if (_combatMode) return;
    _combatMode = true;
    document.addEventListener('click', onCombatClick, true);
    document.addEventListener('pointerdown', onCombatPointerDown, true);
    document.addEventListener('mousedown', onCombatPointerDown, true);
    document.addEventListener('contextmenu', onCombatContextMenu, true);
    updateFabLabel();
    LOG('전투 모드 ON');
    showToast('전투 모드 ON — 토큰을 클릭하면 이동 범위가 표시됩니다', 3000);
  }

  function disableCombatMode() {
    _combatMode = false;
    clearMoveOverlay();
    _selectedItem = null;
    document.removeEventListener('click', onCombatClick, true);
    document.removeEventListener('pointerdown', onCombatPointerDown, true);
    document.removeEventListener('mousedown', onCombatPointerDown, true);
    document.removeEventListener('contextmenu', onCombatContextMenu, true);
    updateFabLabel();
    LOG('전투 모드 OFF');
    showToast('전투 모드 OFF', 2000);
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
  //  9. Toast notification (간단한 알림)
  // ------------------------------------------------
  function showToast(msg, dur) {
    if (!dur) dur = 3000;
    var old = document.querySelectorAll('.bwbr-combat-toast');
    for (var i = 0; i < old.length; i++) old[i].remove();

    var toast = document.createElement('div');
    toast.className = 'bwbr-combat-toast';
    toast.style.cssText =
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'z-index:14000;padding:8px 20px;border-radius:6px;' +
      'background:rgba(33,150,243,0.92);color:#fff;font-size:13px;' +
      'font-weight:500;box-shadow:0 3px 12px rgba(0,0,0,0.3);' +
      'pointer-events:none;opacity:0;transition:opacity 0.3s;' +
      'font-family:"Roboto","Helvetica","Arial",sans-serif;';
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.style.opacity = '1';
    });
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 400);
    }, dur);
  }

  // ------------------------------------------------
  //  10. Init
  // ------------------------------------------------
  setupFabInjection();

  // Alt+* 단축키로 전투 모드 토글
  document.addEventListener('keydown', function(e) {
    // NumPad multiply = '*', 또는 Shift+8 = '*'
    if (e.altKey && (e.key === '*' || e.code === 'NumpadMultiply')) {
      e.preventDefault();
      toggleCombatMode();
    }
  });

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

    LOG('우클릭 전투이동: imageUrl=' + imageUrl.substring(0, 60) + '...');
    requestCharForMove(imageUrl).then(function (result) {
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
        document.addEventListener('mousedown', onCombatPointerDown, true);
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
    document.removeEventListener('mousedown', onCombatPointerDown, true);
  }

  LOG('module loaded');
})();
