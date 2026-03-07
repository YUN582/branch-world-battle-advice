// ============================================================
// [CORE] Ccofolia Extension - 캐릭터 단축키 바인딩
// ============================================================

(function () {
  'use strict';

  var STORAGE_KEY = 'bwbr_charShortcuts';
  var LOG = '[CE 단축키]';

  var CODE_TO_DIGIT = {
    Digit0: '0', Numpad0: '0', Digit1: '1', Numpad1: '1',
    Digit2: '2', Numpad2: '2', Digit3: '3', Numpad3: '3',
    Digit4: '4', Numpad4: '4', Digit5: '5', Numpad5: '5',
    Digit6: '6', Numpad6: '6', Digit7: '7', Numpad7: '7',
    Digit8: '8', Numpad8: '8', Digit9: '9', Numpad9: '9'
  };
  var MOD_LABEL = 'Alt';

  // ── 상태 ──

  var bindings = {};
  var cachedCharacters = [];
  var enabled = true;
  var lastRightClickTarget = null;
  var pendingBindCharName = null;
  var bindDialogEl = null;

  // ── 초기화 ──

  async function init() {
    await loadBindings();
    await loadEnabled();
    setupKeyboardListener();
    setupTokenMenuInjector();
    setupCharStatusPanelInjector();
    setupCharListKeyLabels();
    suppressNativeContextMenu();
    refreshCharacterCache();
    setTimeout(refreshCharacterCache, 5000);
    setTimeout(refreshCharacterCache, 15000);
    setInterval(refreshCharacterCache, 180000);
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      if (changes[STORAGE_KEY]) bindings = changes[STORAGE_KEY].newValue || {};
      if (changes.bwbr_core) enabled = changes.bwbr_core.newValue?.general?.charShortcuts !== false;
    });
    window.addEventListener('bwbr-char-action-result', function (e) {
      if (e.detail?.message) showToast(e.detail.message, 2500);
    });
    log('초기화 완료');
  }

  // ── 저장/로드 ──

  async function loadBindings() {
    try { var d = await chrome.storage.sync.get(STORAGE_KEY); bindings = d[STORAGE_KEY] || {}; }
    catch (_) { bindings = {}; }
  }
  async function saveBindings() {
    try { await chrome.storage.sync.set({ [STORAGE_KEY]: bindings }); }
    catch (e) { console.warn('[CE char-shortcut] saveBindings 실패:', e); }
  }
  async function loadEnabled() {
    try { var d = await chrome.storage.sync.get('bwbr_core'); enabled = d.bwbr_core?.general?.charShortcuts !== false; }
    catch (_) { enabled = true; }
  }

  // ── 캐릭터 캐시 ──

  function refreshCharacterCache() {
    window.dispatchEvent(new CustomEvent('bwbr-request-all-characters'));
  }
  window.addEventListener('bwbr-all-characters-data', function () {
    // MAIN→ISOLATED: event.detail은 크로스-월드에서 신뢰 불가 → DOM 속성 사용
    var raw = document.documentElement.getAttribute('data-bwbr-all-characters-data');
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (data.characters && data.characters.length) {
        cachedCharacters = data.characters;
        log('캐릭터 캐시: ' + cachedCharacters.length + '명');
      }
    } catch (_) {}
  });

  function matchCharacterByImage(imageUrl) {
    if (!imageUrl || !cachedCharacters.length) return null;
    var a = extractStoragePath(imageUrl);
    for (var i = 0; i < cachedCharacters.length; i++) {
      var c = cachedCharacters[i];
      if (!c.iconUrl) continue;
      var b = extractStoragePath(c.iconUrl);
      if (a && b && a === b) return c;
      if (imageUrl.indexOf(c.iconUrl) !== -1 || c.iconUrl.indexOf(imageUrl) !== -1) return c;
    }
    return null;
  }
  function extractStoragePath(url) {
    if (!url) return '';
    try {
      // Firebase Storage: /o/users%2F.../files%2F... → users/.../files/...
      var m = url.match(/\/o\/([^?]+)/);
      if (m) return decodeURIComponent(m[1]);
      // ccfolia CDN: storage.ccfolia-cdn.net/users/.../files/...
      var m2 = url.match(/ccfolia-cdn\.net\/(.+?)(?:\?|$)/);
      if (m2) return decodeURIComponent(m2[1]);
      // 일반 경로 추출 (도메인 이후)
      var m3 = url.match(/\/users\/[^?]+/);
      if (m3) return m3[0];
      return '';
    }
    catch (_) { return ''; }
  }

  // ================================================================
  //  키보드 단축키
  // ================================================================

  function setupKeyboardListener() {
    document.addEventListener('keydown', function (e) {
      if (!enabled) return;
      var digit = CODE_TO_DIGIT[e.code];
      if (!digit) return;

      // 바인딩 다이얼로그
      if (bindDialogEl) { handleBindDialogKey(e, digit); return; }

      // Alt+숫자만 처리
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;

      var key = 'alt+' + digit;
      var binding = bindings[key];
      if (!binding) return;

      e.preventDefault();
      e.stopPropagation();
      switchCharacter(binding.name);
      showToast('🔄 ' + binding.name, 2000);
    }, true);
  }

  function switchCharacter(name) {
    window.dispatchEvent(new CustomEvent('bwbr-switch-character', { detail: { name: name } }));
    log('캐릭터 전환:', name);
  }

  function dispatchCharAction(eventName, charName) {
    window.dispatchEvent(new CustomEvent(eventName, { detail: { name: charName } }));
  }

  // ================================================================
  //  캐릭터 선택 드롭다운에 바인딩 키 표시
  //  MUI Autocomplete listbox 감지 → option마다 Alt+N 뱃지 주입
  // ================================================================

  function setupCharListKeyLabels() {
    // MutationObserver — 새로 추가되는 요소 감지
    var obs = new MutationObserver(function (mutations) {
      if (!enabled || !Object.keys(bindings).length) return;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          scanAndInjectKeyLabels(node);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // 주기적 스캔 — 가시성만 바뀌는 드롭다운 + 뱃지가 사라진 경우 재주입
    // MutationObserver가 주요 트리거이므로 폴백은 2초면 충분 (600ms→2000ms)
    setInterval(function () {
      if (!enabled || !Object.keys(bindings).length) return;
      scanAllVisibleCharLists();
    }, 2000);
  }

  function scanAllVisibleCharLists() {
    // 캐릭터 이미지가 포함된 드롭다운/리스트 영역 탐색
    // 1) role="listbox" 내부 option
    var listboxes = document.querySelectorAll('ul[role="listbox"]');
    for (var i = 0; i < listboxes.length; i++) {
      var opts = listboxes[i].querySelectorAll('li[role="option"]');
      for (var j = 0; j < opts.length; j++) injectKeyLabelToItem(opts[j]);
    }
    // 2) downshift 아이템
    var dsItems = document.querySelectorAll('[id^="downshift-"][id*="-item"]');
    for (var k = 0; k < dsItems.length; k++) injectKeyLabelToItem(dsItems[k]);
    // 3) MUI Popover/Popper 내부의 캐릭터 아이템 (이미지+텍스트 조합)
    var poppers = document.querySelectorAll('.MuiAutocomplete-popper, .MuiPopper-root, .MuiPopover-root');
    for (var p = 0; p < poppers.length; p++) {
      if (poppers[p].offsetParent === null) continue;
      scanContainerForCharItems(poppers[p]);
    }
  }

  /** 컨테이너 내부에서 캐릭터 이미지를 포함한 li/div 아이템을 찾아 뱃지 주입 */
  function scanContainerForCharItems(container) {
    var imgs = container.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].src || imgs[i].src.indexOf('data:') === 0) continue;
      // 이미지의 부모 중 리스트 아이템급 요소 찾기
      var item = imgs[i].parentElement;
      for (var d = 0; item && d < 5; d++, item = item.parentElement) {
        if (!item || item === container) break;
        var rect = item.getBoundingClientRect();
        if (rect.height > 20 && rect.height < 150 && rect.width > 80) {
          injectKeyLabelToItem(item);
          break;
        }
      }
    }
  }

  function scanAndInjectKeyLabels(root) {
    if (!root.querySelectorAll) return;
    // 구체적 셀렉터
    var items = root.querySelectorAll('li[role="option"], [id^="downshift-"][id*="-item"]');
    for (var i = 0; i < items.length; i++) injectKeyLabelToItem(items[i]);
    // root 자체
    if (root.getAttribute && (root.getAttribute('role') === 'option'
        || (root.id && /^downshift-.*-item/.test(root.id)))) {
      injectKeyLabelToItem(root);
    }
    // 이미지 기반 폴백
    if (root.querySelectorAll('img').length) scanContainerForCharItems(root);
  }

  function injectKeyLabelToItem(item) {
    if (!item || item.querySelector('.bwbr-key-badge')) return;
    // 보드 토큰(.movable) 내부에는 뱃지 주입 안 함
    if (item.closest && item.closest('.movable')) return;
    // 파일 관리자/이미지 갤러리(MuiDialog) 내부에는 뱃지 주입 안 함
    // (캐릭터 선택 드롭다운은 MuiAutocomplete-popper 로 body에 포탈되므로 영향 없음)
    if (item.closest && item.closest('.MuiDialog-root')) return;
    var info = extractCharFromElement(item);
    if (!info) return;
    var key = findBindingForCharacter(info.name);
    if (!key) return;
    var badge = document.createElement('span');
    badge.className = 'bwbr-key-badge';
    badge.textContent = fmtKey(key);
    badge.style.cssText = 'margin-left:8px;font-size:0.7rem;color:rgba(255,255,255,0.45);white-space:nowrap;pointer-events:none;vertical-align:middle';

    // "활성화 상태"/"비활성화 상태" 텍스트 옆에 인라인 배치
    var allEls = item.querySelectorAll('span, p');
    for (var s = 0; s < allEls.length; s++) {
      var txt = allEls[s].textContent.trim();
      if ((txt === '활성화 상태' || txt === '비활성화 상태') && !allEls[s].querySelector('span')) {
        allEls[s].appendChild(document.createTextNode(' '));
        allEls[s].appendChild(badge);
        return;
      }
    }

    // 폴백: 아이템 끝에 추가
    badge.style.cssText = 'margin-left:auto;font-size:0.7rem;color:rgba(255,255,255,0.45);white-space:nowrap;flex-shrink:0;pointer-events:none;padding-right:4px';
    item.appendChild(badge);
  }

  // ================================================================
  //  네이티브 우클릭 메뉴 차단
  // ================================================================

  function suppressNativeContextMenu() {
    document.addEventListener('contextmenu', function (e) {
      var sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.target.isContentEditable) return;
      // 확대 보기(Inspector) 내부의 이미지에서만 우클릭 허용 (새 탭 열기/복사 가능)
      // Inspector는 MuiModal-root로 렌더링됨 — img 타겟일 때만 허용
      if (tag === 'img' && e.target.closest && e.target.closest('.MuiModal-root')) return;
      e.preventDefault();
    }, false);
  }

  // ================================================================
  //  캐릭터 토큰 MUI 컨텍스트 메뉴 주입
  //  ★ 패널 메뉴 = "위치 고정"/"패널 숨기기" 존재 → 주입 안 함
  //  ★ 토큰 메뉴 = "집어넣기" 존재 → 단축키 지정 + 확대 보기 주입
  // ================================================================

  function setupTokenMenuInjector() {
    document.addEventListener('contextmenu', function (e) { lastRightClickTarget = e.target; }, true);

    var obs = new MutationObserver(function (mutations) {
      if (!enabled) return;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1 || !node.matches || !node.matches('div.MuiPopover-root')) continue;
          var paper = node.querySelector('div.MuiMenu-paper');
          if (paper) {
            onPaperReady(paper);
          } else {
            (function (n) {
              var inner = new MutationObserver(function () {
                var p = n.querySelector('div.MuiMenu-paper');
                if (p) { onPaperReady(p); inner.disconnect(); }
              });
              inner.observe(n, { childList: true, subtree: true });
            })(node);
          }
        }
      }
    });
    obs.observe(document.body, { childList: true });
  }

  // ================================================================
  //  스크린 패널 우클릭 메뉴 → 전투이동 버튼 주입
  // ================================================================
  function injectCombatMoveToPanel(menuList, items, texts, paper) {
    // 위치 고정 아이템 찾기
    var anchorItem = null;
    for (var i = 0; i < items.length; i++) {
      if (texts[i].indexOf('위치 고정') === 0 || texts[i].indexOf('位置固定') === 0) {
        anchorItem = items[i];
        break;
      }
    }

    var firstItem = menuList.querySelector('li[role="menuitem"]');
    var itemClass = firstItem ? firstItem.className : 'MuiButtonBase-root MuiMenuItem-root MuiMenuItem-gutters';
    var popover = paper.closest('.MuiPopover-root') || paper.parentElement;

    var combatItem = document.createElement('li');
    combatItem.className = itemClass;
    combatItem.tabIndex = -1;
    combatItem.role = 'menuitem';
    combatItem.dataset.bwbr = '1';
    combatItem.textContent = '전투이동';
    combatItem.addEventListener('click', function (ev) {
      ev.stopPropagation();
      dismissMenu(popover);
      // 우클릭한 토큰의 imageUrl로 전투이동 시작
      var tokenEl = findTokenElement(lastRightClickTarget);
      if (!tokenEl) {
        log('전투이동: 토큰을 찾을 수 없습니다');
        return;
      }
      var imgUrl = extractImageUrl(tokenEl);
      if (!imgUrl) {
        log('전투이동: 이미지 URL을 찾을 수 없습니다');
        return;
      }
      // combat-move 모듈에 이동 요청
      document.documentElement.setAttribute('data-bwbr-context-move-url', imgUrl);
      window.dispatchEvent(new Event('bwbr-context-combat-move'));
    });

    // 위치 고정 아래에 삽입
    if (anchorItem && anchorItem.nextSibling) {
      menuList.insertBefore(combatItem, anchorItem.nextSibling);
    } else if (anchorItem) {
      menuList.appendChild(combatItem);
    } else {
      // 위치 고정을 찾지 못한 경우 맨 아래
      menuList.appendChild(combatItem);
    }
    log('스크린 패널 메뉴에 전투이동 주입');
  }

  function onPaperReady(paper) {
    var menuList = paper.querySelector("ul[role='menu']");
    if (!menuList) return;
    if (menuList.querySelector('[data-bwbr]')) return;

    var items = menuList.querySelectorAll('li');
    var texts = [];
    for (var i = 0; i < items.length; i++) texts.push((items[i].textContent || '').trim());

    // 패널 메뉴 감지 → 전투이동 버튼만 주입
    var isPanel = texts.some(function (t) {
      return t.indexOf('위치 고정') === 0 || t.indexOf('패널 숨기기') === 0
        || t.indexOf('位置固定') === 0 || t.indexOf('パネルを隱す') === 0;
    });
    if (isPanel) {
      log('스크린 패널 메뉴 → 전투이동 주입');
      injectCombatMoveToPanel(menuList, items, texts, paper);
      return;
    }

    // 캐릭터 토큰 메뉴 확인: "집어넣기" 또는 "ID 복사"
    var rotateItem = null;
    var isToken = false;
    for (var t = 0; t < texts.length; t++) {
      if (texts[t].indexOf('회전') === 0 || texts[t].indexOf('回転') === 0) rotateItem = items[t];
      if (texts[t].indexOf('집어넣기') === 0 || texts[t].indexOf('ID 복사') === 0
        || texts[t].indexOf('しまう') === 0) isToken = true;
    }
    if (!isToken) {
      log('캐릭터 토큰 메뉴 아님. 항목:', texts.join(', '));
      return;
    }

    log('캐릭터 토큰 메뉴 → 주입');
    var charName = identifyCharacterFromTarget();
    var firstItem = menuList.querySelector('li[role="menuitem"]');
    var itemClass = firstItem ? firstItem.className : 'MuiButtonBase-root MuiMenuItem-root MuiMenuItem-gutters';
    var popover = paper.closest('.MuiPopover-root') || paper.parentElement;

    // ── 확대 보기: 회전 아래 ──
    var zoomItem = document.createElement('li');
    zoomItem.className = itemClass;
    zoomItem.tabIndex = -1;
    zoomItem.role = 'menuitem';
    zoomItem.dataset.bwbr = '1';
    zoomItem.textContent = '확대 보기';
    zoomItem.addEventListener('click', function (ev) {
      ev.stopPropagation();
      dismissMenu(popover);
      var tokenEl = findTokenElement(lastRightClickTarget);
      if (tokenEl) {
        var imgUrl = extractImageUrl(tokenEl);
        if (imgUrl) openZoomView(imgUrl);
      }
    });
    if (rotateItem && rotateItem.nextSibling) {
      menuList.insertBefore(zoomItem, rotateItem.nextSibling);
    } else {
      menuList.appendChild(zoomItem);
    }

    // ── 단축키 지정: 확대 보기 바로 아래 ──
    var bindItem = document.createElement('li');
    bindItem.className = itemClass;
    bindItem.tabIndex = -1;
    bindItem.role = 'menuitem';
    bindItem.dataset.bwbr = '1';
    bindItem.textContent = '단축키 지정';
    bindItem.addEventListener('click', function (ev) {
      ev.stopPropagation();
      dismissMenu(popover);
      if (charName) openBindDialog(charName);
      else { showToast('캐릭터를 식별할 수 없습니다', 2000); refreshCharacterCache(); }
    });
    if (zoomItem.nextSibling) {
      menuList.insertBefore(bindItem, zoomItem.nextSibling);
    } else {
      menuList.appendChild(bindItem);
    }

    log('주입 완료:', charName || '(미식별)');
  }

  function identifyCharacterFromTarget() {
    var tokenEl = findTokenElement(lastRightClickTarget);
    if (!tokenEl) return null;
    var imgUrl = extractImageUrl(tokenEl);
    if (!imgUrl) return null;
    var m = matchCharacterByImage(imgUrl);
    return m ? m.name : null;
  }

  function dismissMenu(popover) {
    if (!popover) return;
    var bd = popover.querySelector('.MuiBackdrop-root');
    if (bd) { bd.click(); return; }
    document.body.click();
  }

  // ================================================================
  //  화면 캐릭터 상태 패널 — hideStatus 토글 아이콘 주입
  //  캐릭터 초상화 클릭 시 나오는 상태창의 편집/집어넣기 아이콘 사이에 주입
  // ================================================================

  function setupCharStatusPanelInjector() {
    var _timer = 0;
    var obs = new MutationObserver(function () {
      clearTimeout(_timer);
      _timer = setTimeout(injectHideStatusButton, 80);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /** 상태 패널 툴바에서 캐릭터 이름 텍스트 매칭으로 식별 */
  function findCharacterFromPanel(toolbarEl) {
    if (!cachedCharacters.length) return null;
    var nameMap = {};
    for (var c = 0; c < cachedCharacters.length; c++) {
      nameMap[cachedCharacters[c].name] = cachedCharacters[c];
    }
    var el = toolbarEl;
    for (var u = 0; u < 5 && el; u++, el = el.parentElement) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      var node;
      while ((node = walker.nextNode())) {
        // 우리가 주입한 버튼 내부 텍스트는 스킵
        if (node.parentElement && node.parentElement.closest('.bwbr-hide-status-btn')) continue;
        var txt = node.textContent.trim();
        if (txt && nameMap[txt]) return nameMap[txt];
      }
    }
    return null;
  }

  function visibilitySvg(svgCls, hidden) {
    var open = '<svg' + (svgCls ? ' class="' + svgCls + '"' : '') + ' focusable="false" aria-hidden="true" viewBox="0 0 24 24">';
    if (hidden) {
      // VisibilityOff — 현재 숨겨진 상태 → 클릭하면 표시
      return open + '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"></path></svg>';
    }
    // Visibility — 현재 표시 중 → 클릭하면 숨김
    return open + '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"></path></svg>';
  }

  function injectHideStatusButton() {
    // 상태 패널 툴바의 편집 아이콘(M3 17.25) 중
    // 형제 버튼이 2+인 것만 대상 (스텟 행 단독 버튼 제외)
    var allPaths = document.querySelectorAll('button.MuiIconButton-root svg path');
    for (var i = 0; i < allPaths.length; i++) {
      var d = allPaths[i].getAttribute('d') || '';
      if (d.indexOf('M3 17.25') === -1) continue;

      var btn = allPaths[i].closest('button');
      if (!btn) continue;
      var parent = btn.parentElement;
      if (!parent) continue;
      if (parent.querySelectorAll('button').length < 2) continue;
      if (parent.querySelector('.bwbr-hide-status-btn')) continue;

      // 캐릭터 식별 — 이름 텍스트 매칭
      var charData = findCharacterFromPanel(parent);
      if (!charData) continue;

      // 형제 SVG 클래스 복사
      var sibSvg = btn.querySelector('svg');
      var svgCls = sibSvg ? (sibSvg.getAttribute('class') || '') : '';

      // 형제 버튼과 동일한 클래스 사용 → UI 일치
      var hideBtn = document.createElement('button');
      hideBtn.className = 'bwbr-hide-status-btn ' + btn.className;
      hideBtn.type = 'button';
      hideBtn.tabIndex = 0;

      // 초기 아이콘: hideStatus 상태에 따라
      var isHidden = !!charData.hideStatus;
      hideBtn.innerHTML = visibilitySvg(svgCls, isHidden);
      hideBtn.title = isHidden ? charData.name + ' 화면에 표시' : charData.name + ' 화면에서 숨기기';

      // 클로저로 상태 캡처
      (function (id, name, sc) {
        var hidden = isHidden;
        hideBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          hidden = !hidden;
          var payload = JSON.stringify({ op: 'toggleHideStatus', ids: [id] });
          document.documentElement.setAttribute('data-bwbr-char-batch-op', payload);
          document.dispatchEvent(new CustomEvent('bwbr-char-batch-op'));
          window.dispatchEvent(new CustomEvent('bwbr-char-batch-op'));
          hideBtn.innerHTML = visibilitySvg(sc, hidden);
          hideBtn.title = hidden ? name + ' 화면에 표시' : name + ' 화면에서 숨기기';
          showToast(name + (hidden ? ' 화면에서 숨김' : ' 화면에 표시'), 2000);
        });
      })(charData._id, charData.name, svgCls);

      btn.parentNode.insertBefore(hideBtn, btn.nextSibling);
    }
  }

  /** 캐릭터 항목에서 이름 추출 — DOM 텍스트 직접 읽기 (캐시 의존 X) */
  function extractCharFromElement(el) {
    // 1. DOM 텍스트 노드를 직접 수집 (주입 뱃지 제외)
    var parts = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      // 우리가 주입한 키 뱃지 텍스트는 건너뛴다
      if (node.parentElement && node.parentElement.classList.contains('bwbr-key-badge')) continue;
      var t = node.textContent.trim();
      if (t) parts.push(t);
    }
    var raw = parts.join('');
    // 코코포리아 상태 접미사 제거
    var name = raw.replace(/(비활성화 상태|활성화 상태)$/, '').trim();
    if (name) {
      var ico = '';
      var imgs = el.querySelectorAll('img[src]');
      for (var i = 0; i < imgs.length; i++) { ico = imgs[i].src; break; }
      return { name: name, iconUrl: ico };
    }
    // 2. 텍스트 없으면 이미지로 폴백
    var imgs2 = el.querySelectorAll('img');
    for (var i = 0; i < imgs2.length; i++) {
      if (!imgs2[i].src) continue;
      var c = matchCharacterByImage(imgs2[i].src);
      if (c) return { name: c.name, iconUrl: c.iconUrl };
    }
    return null;
  }

  // ================================================================
  //  바인딩 다이얼로그
  // ================================================================

  function openBindDialog(charName) {
    closeBindDialog();
    pendingBindCharName = charName;

    var cd = cachedCharacters.find(function (c) { return c.name === charName; });

    var ov = document.createElement('div');
    ov.id = 'bwbr-bind-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:14000;display:flex;align-items:center;justify-content:center';

    var dlg = document.createElement('div');
    dlg.id = 'bwbr-bind-dialog';
    dlg.style.cssText = 'background:#2d2d2d;border-radius:8px;padding:24px;min-width:320px;max-width:420px;color:#fff;font-family:"Roboto","Helvetica","Arial",sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center';

    if (cd && cd.iconUrl) {
      var ico = document.createElement('img');
      ico.src = cd.iconUrl;
      ico.style.cssText = 'width:64px;height:64px;border-radius:50%;object-fit:cover;object-position:center 5%;margin-bottom:12px;border:2px solid rgba(255,255,255,0.2)';
      dlg.appendChild(ico);
    }

    var title = document.createElement('div');
    title.textContent = charName;
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:4px';
    dlg.appendChild(title);

    var sub = document.createElement('div');
    sub.textContent = 'Alt + 숫자 키(0~9)를 눌러 바인딩';
    sub.style.cssText = 'font-size:0.8rem;color:rgba(255,255,255,0.6);margin-bottom:20px';
    dlg.appendChild(sub);

    var kd = document.createElement('div');
    kd.id = 'bwbr-bind-key-display';
    kd.style.cssText = 'font-size:1.5rem;font-weight:700;font-family:"Consolas","Monaco","Courier New",monospace;padding:16px;border:none;border-radius:8px;margin-bottom:16px;min-height:60px;display:flex;align-items:center;justify-content:center;color:#82b1ff;transition:all 200ms';
    var existing = findBindingForCharacter(charName);
    kd.textContent = existing ? fmtKey(existing) : 'Alt + 숫자';
    dlg.appendChild(kd);

    var listWrap = document.createElement('div');
    listWrap.id = 'bwbr-bind-list-wrap';
    listWrap.appendChild(buildBindingsList(charName));
    dlg.appendChild(listWrap);

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:20px';
    var ub = mkBtn('해제', 'rgba(244,67,54,0.2)', '#ef5350', 'rgba(244,67,54,0.3)');
    ub.id = 'bwbr-bind-unbind-btn';
    ub.onclick = function () {
      var cur = findBindingForCharacter(charName);
      if (cur) {
        delete bindings[cur];
        saveBindings();
        showToast(charName + ' 해제됨', 2000);
        refreshBindDialog(charName);
      }
    };
    ub.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (!Object.keys(bindings).length) return;
      bindings = {}; saveBindings();
      showToast('모든 단축키 해제됨', 2000);
      refreshBindDialog(charName);
    });
    btns.appendChild(ub);

    var cb = mkBtn('닫기', 'rgba(255,255,255,0.08)', '#fff', 'rgba(255,255,255,0.2)');
    cb.onclick = closeBindDialog;
    btns.appendChild(cb);

    dlg.appendChild(btns);

    var helpArea = document.createElement('div');
    helpArea.style.cssText = 'margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);font-size:0.7rem;color:rgba(255,255,255,0.35);line-height:1.6;text-align:center';
    helpArea.innerHTML = '해제: 이 캐릭터만 해제 &nbsp;|&nbsp; 해제 우클릭: 전체 해제';
    dlg.appendChild(helpArea);
    ov.appendChild(dlg);
    document.body.appendChild(ov);
    bindDialogEl = ov;
    ov.addEventListener('click', function (e) { if (e.target === ov) closeBindDialog(); });
  }

  /** 바인딩 다이얼로그 내부 갱신 (닫지 않고 상태만 업데이트) */
  function refreshBindDialog(charName) {
    var kd = document.getElementById('bwbr-bind-key-display');
    var cur = findBindingForCharacter(charName);
    if (kd) {
      kd.textContent = cur ? fmtKey(cur) : 'Alt + 숫자';
      kd.style.color = cur ? '#82b1ff' : 'rgba(255,255,255,0.3)';
    }
    var listWrap = document.getElementById('bwbr-bind-list-wrap');
    if (listWrap) { listWrap.innerHTML = ''; listWrap.appendChild(buildBindingsList(charName)); }
    var ubBtn = document.getElementById('bwbr-bind-unbind-btn');
    if (ubBtn) {
      ubBtn.style.opacity = cur ? '1' : '0.35';
      ubBtn.style.pointerEvents = cur ? 'auto' : 'none';
    }
  }

  function handleBindDialogKey(e, digit) {
    e.preventDefault();
    e.stopPropagation();
    var key = 'alt+' + digit;
    var charName = pendingBindCharName;
    if (!charName) return;
    var old = findBindingForCharacter(charName);
    if (old && old !== key) delete bindings[old];
    var cd = cachedCharacters.find(function (c) { return c.name === charName; });
    bindings[key] = { name: charName, iconUrl: (cd && cd.iconUrl) || '' };
    saveBindings();
    showToast(charName + ' → ' + fmtKey(key), 2500);
    refreshBindDialog(charName);
    var kd = document.getElementById('bwbr-bind-key-display');
    if (kd) { kd.style.color = '#69f0ae'; }
    setTimeout(function () { if (kd) kd.style.color = '#82b1ff'; }, 600);
  }

  function mkBtn(text, bg, clr, border) {
    var b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'padding:8px 20px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:0.85rem';
    b.style.background = bg; b.style.color = clr; b.style.border = '1px solid ' + border;
    return b;
  }

  function buildBindingsList(hl) {
    var c = document.createElement('div');
    c.style.cssText = 'font-size:0.75rem;color:rgba(255,255,255,0.55);text-align:left;max-height:120px;overflow-y:auto;width:100%';
    var ent = Object.entries(bindings);
    if (!ent.length) { c.textContent = '설정된 단축키 없음'; c.style.textAlign = 'center'; return c; }
    for (var i = 0; i < ent.length; i++) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:2px 4px';
      if (ent[i][1].name === hl) row.style.color = '#82b1ff';
      var ks = document.createElement('span'); ks.textContent = fmtKey(ent[i][0]); ks.style.fontFamily = 'monospace';
      var ns = document.createElement('span'); ns.textContent = ent[i][1].name;
      row.appendChild(ks); row.appendChild(ns); c.appendChild(row);
    }
    return c;
  }

  function closeBindDialog() {
    if (bindDialogEl) { bindDialogEl.remove(); bindDialogEl = null; }
    pendingBindCharName = null;
  }

  // ================================================================
  //  확대 보기 (네이티브)
  // ================================================================

  function openZoomView(imageUrl) {
    window.dispatchEvent(new CustomEvent('bwbr-native-zoom', { detail: { imageUrl: imageUrl } }));
  }

  // ================================================================
  //  DOM 유틸리티
  // ================================================================

  function findTokenElement(target) {
    var el = target;
    for (var d = 0; el && d < 20; d++, el = el.parentElement) {
      if (el instanceof HTMLElement && (el.className + '').indexOf('movable') !== -1) return el;
    }
    return null;
  }

  function extractImageUrl(el) {
    var imgs = el.querySelectorAll('img[src]');
    if (imgs.length) {
      var best = null, bestA = -1;
      for (var i = 0; i < imgs.length; i++) {
        var r = imgs[i].getBoundingClientRect();
        var a = Math.max(1, r.width) * Math.max(1, r.height);
        if (a > bestA) { bestA = a; best = imgs[i]; }
      }
      if (best) return best.currentSrc || best.src;
    }
    var q = [el], depth = 0;
    while (q.length && depth < 30) {
      var cur = q.shift(); depth++;
      var bg = getComputedStyle(cur).backgroundImage;
      if (bg && bg.indexOf('url(') !== -1) {
        var m = bg.match(/url\(["']?(.*?)["']?\)/);
        if (m && m[1]) return m[1];
      }
      for (var j = 0; j < cur.children.length; j++) {
        if (cur.children[j] instanceof HTMLElement) q.push(cur.children[j]);
      }
    }
    return null;
  }

  // ================================================================
  //  유틸
  // ================================================================

  function findBindingForCharacter(name) {
    var keys = Object.keys(bindings);
    for (var i = 0; i < keys.length; i++) if (bindings[keys[i]].name === name) return keys[i];
    return null;
  }
  function fmtKey(key) {
    var p = key.split('+'), digit = p.pop();
    return MOD_LABEL + ' + ' + digit;
  }

  function showToast(msg, dur) {
    if (!dur) dur = 3000;
    var old = document.querySelectorAll('.bwbr-shortcut-toast');
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
    t.className = 'bwbr-shortcut-toast';
    t.style.cssText = 'background:rgba(50,50,50,0.92);color:#fff;padding:6px 16px;border-radius:4px;font-size:0.875rem;box-shadow:0 3px 8px rgba(0,0,0,0.3);max-width:344px;opacity:0;transform:translateY(100%);transition:opacity 225ms,transform 225ms;pointer-events:auto;white-space:pre-line';
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'none'; });
    setTimeout(function () {
      t.style.opacity = '0'; t.style.transform = 'translateY(100%)';
      setTimeout(function () { t.remove(); }, 225);
    }, dur);
  }

  function log() {
    if (!window._BWBR_DEBUG) return;
    var a = [].slice.call(arguments);
    a.unshift('color:inherit'); a.unshift('color:#82b1ff;font-weight:bold'); a.unshift('%c' + LOG + '%c');
    console.log.apply(console, a);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
