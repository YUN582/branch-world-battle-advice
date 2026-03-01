// ============================================================
// Grid Overlay - cocofolia native grid design replacement
//
// cocofolia "jeongyeong-e geurideu pyosi" (displayGrid) on/off
// native grid -> hidden, custom overlay shown.
// SpeedDial (pencil menu) toggle button injected.
//
// 24px small cell, 48px big cell (2x2), diamond accent
//
// zoom container (.movable parentElement)
//   [0] div (foreground) -> <img>
//   [?] native grid (hidden by JS when overlay active)
//   [1..N] .movable (tokens)
//   [?] #bwbr-grid-overlay (custom overlay)
// ============================================================

(function () {
  'use strict';

  const LOG = (...a) => {
    if (!window._BWBR_DEBUG) return;
    console.log('%c[BWBR Grid]%c', 'color:#4caf50;font-weight:bold', 'color:inherit', ...a);
  };

  // -- state --
  let overlayEl  = null;
  let _visible   = false;
  const GRID_ATTR = 'data-bwbr-grid';

  // -- 미리 계산된 SVG data URL (상수이므로 1회만 생성) --
  const _SVG_CACHE = (function() {
    var SM = 24, LG = 48, XL = 96, D = 5;
    var enc = function(s) { return 'data:image/svg+xml,' + encodeURIComponent(s); };

    var diamond96 =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + XL + '" height="' + XL + '">' +
      '<polygon points="' + (XL/2) + ',' + (XL/2-D) + ' ' + (XL/2+D) + ',' + (XL/2) + ' ' + (XL/2) + ',' + (XL/2+D) + ' ' + (XL/2-D) + ',' + (XL/2) + '"' +
      ' fill="rgba(255,255,255,0.5)"/>' +
      '<polygon points="0,' + (-D) + ' ' + D + ',0 0,' + D + ' ' + (-D) + ',0"' +
      ' fill="rgba(255,255,255,0.5)"/>' +
      '<polygon points="' + XL + ',' + (-D) + ' ' + (XL+D) + ',0 ' + XL + ',' + D + ' ' + (XL-D) + ',0"' +
      ' fill="rgba(255,255,255,0.5)"/>' +
      '<polygon points="0,' + (XL-D) + ' ' + D + ',' + XL + ' 0,' + (XL+D) + ' ' + (-D) + ',' + XL + '"' +
      ' fill="rgba(255,255,255,0.5)"/>' +
      '<polygon points="' + XL + ',' + (XL-D) + ' ' + (XL+D) + ',' + XL + ' ' + XL + ',' + (XL+D) + ' ' + (XL-D) + ',' + XL + '"' +
      ' fill="rgba(255,255,255,0.5)"/>' +
      '</svg>';

    // 손그림 선 (cubic bezier path) — 타일 경계에서 tangent 일치하도록 제어점 설계
    var smallCell =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + SM + '" height="' + SM + '">' +
      '<path d="M0,0 C0.7,4 -0.5,8 0.4,12 C-0.4,16 -0.7,20 0,24" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.5" stroke-dasharray="2,2" stroke-linecap="round"/>' +
      '<path d="M0,0 C4,0.7 8,-0.5 12,0.4 C16,-0.4 20,-0.7 24,0" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.5" stroke-dasharray="2,2" stroke-linecap="round"/></svg>';

    var bigCell =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + LG + '" height="' + LG + '">' +
      '<path d="M0,0 C1.2,8 -0.9,16 0.7,24 C-0.7,32 -1.2,40 0,48" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-linecap="round"/>' +
      '<path d="M0,0 C8,1.2 16,-0.9 24,0.7 C32,-0.7 40,-1.2 48,0" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-linecap="round"/></svg>';

    // 체스판 틴트 96px: 192px 반복, 대각선 96px 셀 2개에 밝은 tint (큰 칸 구분)
    var XLXL = XL * 2; // 192
    var checker96 =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + XLXL + '" height="' + XLXL + '">' +
      '<rect x="0" y="0" width="' + XL + '" height="' + XL + '" fill="rgba(255,255,255,0.20)"/>' +
      '<rect x="' + XL + '" y="' + XL + '" width="' + XL + '" height="' + XL + '" fill="rgba(255,255,255,0.20)"/>' +
      '</svg>';

    // 96px(한 칸) 경계선: 손그림 선 (2px, 불투명 흩색)
    var xlCell =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + XL + '" height="' + XL + '">' +
      '<path d="M0,0 C1.8,16 -1.4,32 1.0,48 C-1.0,64 -1.8,80 0,96" fill="none" stroke="rgba(255,255,255,1)" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M0,0 C16,1.8 32,-1.4 48,1.0 C64,-1.0 80,-1.8 96,0" fill="none" stroke="rgba(255,255,255,1)" stroke-width="2" stroke-linecap="round"/></svg>';

    return {
      bg: 'url("' + enc(diamond96) + '") repeat,' +
          'url("' + enc(xlCell) + '") repeat,' +
          'url("' + enc(bigCell) + '") repeat,' +
          'url("' + enc(smallCell) + '") repeat,' +
          'url("' + enc(checker96) + '") repeat',
      bgSize: XL + 'px ' + XL + 'px,' + XL + 'px ' + XL + 'px,' + LG + 'px ' + LG + 'px,' + SM + 'px ' + SM + 'px,' + XLXL + 'px ' + XLXL + 'px'
    };
  })();

  // ------------------------------------------------
  //  1. Find foreground (투명 전경 대응: img 없어도 찾기)
  // ------------------------------------------------
  function findForeground() {
    const movables = document.querySelectorAll('.movable');
    if (!movables.length) return null;
    const zoom = movables[0].parentElement;
    if (!zoom) return null;

    // 1차: 큰 img 포함된 자식 (표준 전경)
    for (const ch of zoom.children) {
      if (ch.classList.contains('movable')) continue;
      if (ch.id === 'bwbr-grid-overlay') continue;
      const img = ch.querySelector('img');
      if (!img) continue;
      const w = parseInt(img.style.width, 10) || img.naturalWidth;
      const h = parseInt(img.style.height, 10) || img.naturalHeight;
      if (w > 200 && h > 200) return ch;
    }

    // 2차 폴백: position:absolute인 자식 (투명/빈 전경)
    for (const ch of zoom.children) {
      if (ch.classList.contains('movable')) continue;
      if (ch.id === 'bwbr-grid-overlay') continue;
      const cs = getComputedStyle(ch);
      if (cs.position === 'absolute') {
        const w = parseFloat(cs.width);
        const h = parseFloat(cs.height);
        if (w > 100 && h > 100) return ch;
      }
    }
    return null;
  }

  // ------------------------------------------------
  //  2. Ensure overlay element (inserted right after foreground, before tokens)
  // ------------------------------------------------
  function ensureOverlay(fg) {
    if (overlayEl && overlayEl.parentElement === fg.parentElement) return overlayEl;
    if (overlayEl) overlayEl.remove();
    overlayEl = document.createElement('div');
    overlayEl.id = 'bwbr-grid-overlay';
    // 전경 바로 뒤에 삽입 → 토큰(.movable)보다 DOM 순서상 앞 → 토큰 아래에 렌더링
    fg.after(overlayEl);
    return overlayEl;
  }

  // ------------------------------------------------
  //  3. Sync overlay position/size to foreground
  // ------------------------------------------------
  function syncToForeground() {
    const fg = findForeground();
    if (!fg) return;

    const el = ensureOverlay(fg);
    const cs = getComputedStyle(fg);

    // 네이티브 그리드 CSS 무력화 — 전경 + 모든 형제에 적용
    _suppressNativeGrid(fg);

    el.style.cssText =
      'position:' + cs.position +
      ';left:' + cs.left +
      ';top:' + cs.top +
      ';width:' + cs.width +
      ';height:' + cs.height +
      ';transform:' + cs.transform +
      ';transform-origin:' + cs.transformOrigin +
      ';pointer-events:none;z-index:0;overflow:hidden;';

    const W = parseFloat(cs.width);
    const H = parseFloat(cs.height);
    if (!W || !H) return;

    // 캐시된 SVG data URL 적용 (상수이므로 매번 재생성하지 않음)
    el.style.background = _SVG_CACHE.bg;
    el.style.backgroundSize = _SVG_CACHE.bgSize;

    // 불완전 96px 셀 중앙 정렬 클리핑
    // background-position을 오프셋해서 그리드 패턴을 중앙 배치 + clip-path로 양쪽 불완전 셀 제거
    var exX = Math.round(W % 96);
    var exY = Math.round(H % 96);
    var offX = Math.round(exX / 2);
    var offY = Math.round(exY / 2);
    var posVal = offX + 'px ' + offY + 'px';
    el.style.backgroundPosition = posVal + ',' + posVal + ',' + posVal + ',' + posVal + ',' + posVal;
    if (exX > 0 || exY > 0) {
      el.style.clipPath = 'inset(' + offY + 'px ' + (exX - offX) + 'px ' + (exY - offY) + 'px ' + offX + 'px)';
    } else {
      el.style.clipPath = 'none';
    }

    // 그리드 경계 프레임 (마감 장식)
    var gridW = W - exX;   // 완전한 그리드 영역 크기
    var gridH = H - exY;
    var frame = el.querySelector('.bwbr-grid-frame');
    if (exX > 0 || exY > 0) {
      if (!frame) {
        frame = document.createElement('div');
        frame.className = 'bwbr-grid-frame';
        el.appendChild(frame);
      }
      frame.style.cssText = 'position:absolute;' +
        'left:' + offX + 'px;top:' + offY + 'px;' +
        'width:' + gridW + 'px;height:' + gridH + 'px;' +
        'border:1.5px solid rgba(255,255,255,0.35);' +
        'pointer-events:none;box-sizing:border-box;' +
        'border-radius:2px;' +
        'box-shadow:0 0 6px rgba(255,255,255,0.1);';
    } else {
      if (frame) frame.remove();
    }
  }

  // ------------------------------------------------
  //  3a. Native grid CSS suppression
  //      전경 요소에만 inline !important + data 속성 + 스타일시트
  //      성능: 이미 속성 설정된 요소는 건너뜀
  // ------------------------------------------------
  var _suppressedEl = null;

  function _suppressNativeGrid(fg) {
    if (_suppressedEl === fg && fg.hasAttribute('data-bwbr-no-grid')) return;
    fg.style.setProperty('background', 'transparent', 'important');
    fg.style.setProperty('background-image', 'none', 'important');
    fg.setAttribute('data-bwbr-no-grid', '');
    _suppressedEl = fg;
    _ensureSuppressStyle();
  }

  function _restoreNativeGrid(fg) {
    fg.removeAttribute('data-bwbr-no-grid');
    fg.style.removeProperty('background');
    fg.style.removeProperty('background-image');
    _suppressedEl = null;
    _removeSuppressStyle();
  }

  function _ensureSuppressStyle() {
    if (document.getElementById('bwbr-grid-suppress')) return;
    var s = document.createElement('style');
    s.id = 'bwbr-grid-suppress';
    // 전경 자체 + 전경 직접 자식에도 적용 (네이티브 그리드는 fg>div에 linear-gradient로 렌더링)
    s.textContent = '[data-bwbr-no-grid],[data-bwbr-no-grid]>*{background:transparent!important;background-image:none!important}';
    (document.head || document.documentElement).appendChild(s);
  }
  function _removeSuppressStyle() {
    var s = document.getElementById('bwbr-grid-suppress');
    if (s) s.remove();
    // data 속성 자운 정리
    document.querySelectorAll('[data-bwbr-no-grid]').forEach(function(el) {
      el.removeAttribute('data-bwbr-no-grid');
    });
  }

  // ------------------------------------------------
  //  4. Sync loop (MutationObserver + 낮은 빈도 interval fallback)
  //     rAF 매 프레임 대신 → 전경 style 변경 감시 + 2초 폴링
  // ------------------------------------------------
  let _styleObs = null;
  let _pollTimer = null;

  function startSyncLoop() {
    if (_styleObs) return;

    // 1회 즉시 동기화
    syncToForeground();

    // 전경 style 변경 감시 (React 리렌더 등)
    const fg = findForeground();
    if (fg) {
      _styleObs = new MutationObserver(function() {
        syncToForeground();
      });
      _styleObs.observe(fg, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    // 폴백: 2초 간격 (전경 사라짐/교체, 크기 변경 대응)
    _pollTimer = setInterval(function() {
      syncToForeground();
      // 전경이 바뀌면 observer 갱신
      var currentFg = findForeground();
      if (currentFg && _styleObs && currentFg !== fg) {
        _styleObs.disconnect();
        _styleObs.observe(currentFg, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    }, 2000);
  }

  function stopSyncLoop() {
    if (_styleObs) { _styleObs.disconnect(); _styleObs = null; }
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ------------------------------------------------
  //  5. Show / Hide
  // ------------------------------------------------
  function show() {
    if (_visible) return;
    _visible = true;
    // 네이티브 그리드 즉시 숨기기
    var fg = findForeground();
    if (fg) _suppressNativeGrid(fg);
    startSyncLoop();
    updateFabLabel();
    LOG('overlay ON');
  }

  function hide() {
    _visible = false;
    // 네이티브 그리드 CSS 복원
    var fg = findForeground();
    if (fg) _restoreNativeGrid(fg);
    stopSyncLoop();
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    updateFabLabel();
    LOG('overlay OFF');
  }

  // ------------------------------------------------
  //  6. Pencil FAB menu — grid button injection
  //     cocofolia FAB 클릭 → MuiPopover (body 포탈) 열림
  //     MuiPaper > MuiList > MuiListItemButton
  //     메뉴 닫으면 DOM 제거 → 열 때마다 재주입
  // ------------------------------------------------
  function setupFabInjection() {
    var MENU_ATTR = GRID_ATTR;

    /** FAB MuiPopover 안의 MuiList 찾기 (키워드 기반 식별) */
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

    function tryInject() {
      // 이미 주입됨
      var existing = document.querySelector('[' + MENU_ATTR + ']');
      if (existing) { updateFabLabel(); return; }

      var list = findFabMenuList();
      if (!list) return;

      var items = list.querySelectorAll('.MuiListItemButton-root');
      if (items.length === 0) return;

      // PRO 뱃지 없는 아이템을 우선 복제 원본으로 선택
      var source = items[0];
      for (var i = 0; i < items.length; i++) {
        if (!/PRO|Pro/i.test(items[i].textContent)) { source = items[i]; break; }
      }

      var clone = source.cloneNode(true);
      clone.setAttribute(MENU_ATTR, '');
      clone.removeAttribute('disabled');
      clone.removeAttribute('aria-disabled');
      clone.classList.remove('Mui-disabled');

      // React 내부 속성 제거
      (function strip(el) {
        for (var k of Object.keys(el)) {
          if (k.startsWith('__react')) try { delete el[k]; } catch(e) {}
        }
        for (var c of el.children) strip(c);
      })(clone);

      // PRO 뱃지 / Chip / Badge 제거
      clone.querySelectorAll('.MuiChip-root, .MuiBadge-root, [class*="Badge"]')
        .forEach(function(el) { el.remove(); });
      // "PRO" 텍스트만 담은 span 제거
      clone.querySelectorAll('span, p').forEach(function(el) {
        if (/^\s*PRO\s*$/i.test(el.textContent) && !el.querySelector('svg')) el.remove();
      });

      // 텍스트 교체 (primary만 남기고 secondary 제거)
      var lit = clone.querySelector('.MuiListItemText-root');
      if (lit) {
        var typos = lit.querySelectorAll('.MuiTypography-root');
        if (typos.length > 0) {
          typos[0].textContent = _visible ? '\uADF8\uB9AC\uB4DC \uC228\uAE30\uAE30' : '\uC804\uACBD\uC5D0 \uADF8\uB9AC\uB4DC \uD45C\uC2DC';
        }
        // 보조 텍스트 → 설명으로 교체 (단축키 포함)
        if (typos.length > 1) {
          typos[1].textContent = '\uC804\uACBD \uC774\uBBF8\uC9C0 \uC704\uC5D0 \uCE78\uC744 \uD45C\uC2DC (Alt+/)';
          // 나머지 보조 텍스트 제거
          for (var j = 2; j < typos.length; j++) typos[j].remove();
        } else {
          // secondary가 없으면 생성
          var desc = document.createElement('span');
          desc.className = typos[0] ? typos[0].className : '';
          desc.style.cssText = 'display:block;font-size:0.75rem;opacity:0.7;';
          desc.textContent = '\uC804\uACBD \uC774\uBBF8\uC9C0 \uC704\uC5D0 \uCE78\uC744 \uD45C\uC2DC (Alt+/)';
          lit.appendChild(desc);
        }
      } else {
        // fallback: 모든 텍스트 노드
        var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        var tNodes = [], tn;
        while ((tn = walker.nextNode())) tNodes.push(tn);
        if (tNodes.length > 0) tNodes[0].textContent = _visible ? '\uADF8\uB9AC\uB4DC \uC228\uAE30\uAE30' : '\uC804\uACBD\uC5D0 \uADF8\uB9AC\uB4DC \uD45C\uC2DC';
        for (var j = 1; j < tNodes.length; j++) {
          if (!tNodes[j].parentElement.closest('svg')) tNodes[j].textContent = '';
        }
      }

      // 아이콘 교체 (GridOn)
      var svg = clone.querySelector('svg');
      if (svg) {
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.innerHTML = '<path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z"/>';
      }

      // 클릭 핸들러 (capture 단계로 Popover backdrop보다 먼저 실행)
      function handleGridClick(e) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('bwbr-toggle-native-grid'));
        // aria-hidden 오류 방지: 포커스를 해제하고 Popover 닫기
        var popoverRoot = e.currentTarget.closest('.MuiPopover-root');
        if (popoverRoot) {
          // 포커스를 body로 이동 → aria-hidden 충돌 방지
          document.body.focus();
          var backdrop = popoverRoot.querySelector('.MuiBackdrop-root');
          if (backdrop) {
            setTimeout(function() {
              backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }, 16);
          }
        }
      }
      clone.addEventListener('click', handleGridClick, true);
      // 중첩 button이 있을 수 있으므로
      clone.querySelectorAll('button, [role="button"]').forEach(function(btn) {
        btn.addEventListener('click', handleGridClick, true);
      });

      // ── 메뉴 스크롤 가능하게 (확장 항목 추가로 넘칠 수 있음) ──
      // Paper의 top 위치 기준으로 maxHeight를 동적 제한
      var paper = list.closest('.MuiPaper-root');
      if (paper) {
        var pRect = paper.getBoundingClientRect();
        var maxAvail = window.innerHeight - pRect.top - 16; // 16px 하단 여백
        if (maxAvail > 100) paper.style.maxHeight = maxAvail + 'px';
      }

      // 리스트 맨 위에 삽입 (Popover 높이 밖으로 밀려나지 않게)
      list.insertBefore(clone, list.firstChild);
      LOG('FAB menu grid item injected (첫 번째 항목)');

      // 다른 모듈(combat-move 등)에게 FAB 메뉴 준비 알림
      window.dispatchEvent(new Event('bwbr-fab-injected'));
    }

    var debId = null;
    var obs = new MutationObserver(function() {
      if (debId) cancelAnimationFrame(debId);
      debId = requestAnimationFrame(function() { debId = null; tryInject(); });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function updateFabLabel() {
    var el = document.querySelector('[' + GRID_ATTR + ']');
    if (!el) return;
    var lit = el.querySelector('.MuiListItemText-root');
    if (lit) {
      var typos = lit.querySelectorAll('.MuiTypography-root');
      if (typos.length > 0) {
        typos[0].textContent = _visible ? '\uADF8\uB9AC\uB4DC \uC228\uAE30\uAE30' : '\uC804\uACBD\uC5D0 \uADF8\uB9AC\uB4DC \uD45C\uC2DC';
      }
    } else {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var tn = walker.nextNode();
      if (tn && !tn.parentElement.closest('svg')) {
        tn.textContent = _visible ? '\uADF8\uB9AC\uB4DC \uC228\uAE30\uAE30' : '\uC804\uACBD\uC5D0 \uADF8\uB9AC\uB4DC \uD45C\uC2DC';
      }
    }
  }

  // ------------------------------------------------
  //  8. displayGrid state change event listener
  // ------------------------------------------------
  window.addEventListener('bwbr-display-grid-changed', function(e) {
    var value = e.detail && e.detail.value;
    LOG('displayGrid changed:', value);
    if (value) show(); else hide();
  });

  // initial state query
  window.addEventListener('bwbr-query-native-grid-result', function(e) {
    if (e.detail && e.detail.success && e.detail.value === true) {
      LOG('initial: displayGrid=true -> show overlay');
      show();
    }
  }, { once: true });

  // 빠른 시작: .movable 등장 즉시 쿼리 (MutationObserver + 짧은 폴링)
  (function quickStart() {
    function tryQuery() {
      if (document.querySelectorAll('.movable').length > 0) {
        window.dispatchEvent(new CustomEvent('bwbr-query-native-grid'));
        return true;
      }
      return false;
    }
    if (tryQuery()) return;
    // DOM에 .movable이 아직 없으면 MutationObserver로 감시
    var initObs = new MutationObserver(function() {
      if (tryQuery()) { initObs.disconnect(); clearTimeout(initFb); }
    });
    initObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    // 안전 폴백: 5초
    var initFb = setTimeout(function() {
      initObs.disconnect();
      window.dispatchEvent(new CustomEvent('bwbr-query-native-grid'));
    }, 5000);
  })();

  // start FAB menu injection
  setupFabInjection();

  // Alt+/ 단축키로 그리드 토글
  document.addEventListener('keydown', function(e) {
    if (e.altKey && e.key === '/') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('bwbr-toggle-native-grid'));
    }
  });

  // global API
  window.__bwbrGridOverlay = { show: show, hide: hide, get isVisible() { return _visible; } };

  LOG('module loaded (displayGrid reactive + FAB)');
})();
