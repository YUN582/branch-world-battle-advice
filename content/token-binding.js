// ============================================================
// Token Binding — 스크린 패널 ↔ 캐릭터 바인딩
//
// 스크린 패널 설정 다이얼로그의 "고급 설정" 아코디언 내에
// 캐릭터 바인딩 드롭다운을 주입합니다.
//
// 바인딩 데이터: chrome.storage.local
//   tokenBindings_{roomId}: { panelId: charId, ... }
//
// ISOLATED world (content script)
// MAIN world 통신:
//   bwbr-identify-panel / bwbr-panel-identified (패널 식별)
//   bwbr-request-all-characters / bwbr-all-characters-data (캐릭터 목록)
//   bwbr-sync-token-bindings (바인딩 동기화, ISOLATED→MAIN 일방향)
// ============================================================

(function () {
  'use strict';

  const LOG_PREFIX = '%c[BWBR Bind]%c';
  const LOG_STYLE = 'color:#ab47bc;font-weight:bold';
  function LOG(...args) {
    if (!window._BWBR_DEBUG) return;
    console.log(LOG_PREFIX, LOG_STYLE, 'color:inherit', ...args);
  }

  // ------------------------------------------------
  //  Utility
  // ------------------------------------------------
  function getRoomId() {
    const m = location.pathname.match(/\/rooms\/([^/]+)/);
    return m ? m[1] : null;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ------------------------------------------------
  //  chrome.storage.local helpers
  // ------------------------------------------------
  function getBindings(roomId) {
    return new Promise((resolve) => {
      const key = 'tokenBindings_' + roomId;
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] || {});
      });
    });
  }

  function setBinding(roomId, panelId, charId) {
    return new Promise((resolve) => {
      const key = 'tokenBindings_' + roomId;
      chrome.storage.local.get(key, (result) => {
        const bindings = result[key] || {};
        if (charId) {
          bindings[panelId] = charId;
        } else {
          delete bindings[panelId];
        }
        const obj = {};
        obj[key] = bindings;
        chrome.storage.local.set(obj, () => {
          syncBindingsToMain(roomId, bindings);
          resolve();
        });
      });
    });
  }

  // ------------------------------------------------
  //  MAIN world communication (DOM attribute bridge)
  // ------------------------------------------------
  function syncBindingsToMain(roomId, bindings) {
    // DOM attr 영구 유지 (MAIN world에서 온디맨드 읽기 가능)
    document.documentElement.setAttribute(
      'data-bwbr-token-bindings',
      JSON.stringify({ roomId, bindings })
    );
    // document + window 이벤트 이중 전파 (크로스-월드 안정성)
    document.dispatchEvent(new CustomEvent('bwbr-sync-token-bindings'));
    window.dispatchEvent(new CustomEvent('bwbr-sync-token-bindings'));
  }

  function identifyPanel(formProps) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        document.removeEventListener('bwbr-panel-identified', handler);
        resolve(null);
      }, 3000);

      const handler = () => {
        clearTimeout(timeout);
        document.removeEventListener('bwbr-panel-identified', handler);
        const raw = document.documentElement.getAttribute('data-bwbr-panel-result');
        document.documentElement.removeAttribute('data-bwbr-panel-result');
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); }
      };
      document.addEventListener('bwbr-panel-identified', handler);
      document.documentElement.setAttribute('data-bwbr-panel-props', JSON.stringify(formProps));
      document.dispatchEvent(new CustomEvent('bwbr-identify-panel'));
    });
  }

  function fetchCharacters() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('bwbr-all-characters-data', handler);
        resolve([]);
      }, 3000);
      const handler = () => {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-all-characters-data', handler);
        try {
          const raw = document.documentElement.getAttribute('data-bwbr-all-characters-data');
          if (raw) {
            const parsed = JSON.parse(raw);
            resolve(parsed.characters || []);
            return;
          }
        } catch (e) { /* fallback */ }
        resolve([]);
      };
      window.addEventListener('bwbr-all-characters-data', handler);
      window.dispatchEvent(new CustomEvent('bwbr-request-all-characters'));
    });
  }

  // ------------------------------------------------
  //  Initial binding sync to MAIN world
  // ------------------------------------------------
  function initSync() {
    const roomId = getRoomId();
    if (!roomId) return;
    getBindings(roomId).then((bindings) => {
      LOG('초기 바인딩 동기화:', Object.keys(bindings).length + '개');
      syncBindingsToMain(roomId, bindings);
    });
  }

  // 지연 동기화 — redux-injector 로드 대기
  setTimeout(initSync, 2000);
  document.addEventListener('bwbr-injector-ready', () => setTimeout(initSync, 500));

  // ------------------------------------------------
  //  Panel click tracking (imageUrl 기억)
  //  패널 우클릭/더블클릭 시 imageUrl을 캡처하여
  //  다이얼로그 열릴 때 정확한 패널 식별에 사용
  // ------------------------------------------------
  let _lastClickedPanelImageUrl = null;

  function extractTokenImageUrl(el) {
    if (!el) return null;
    // 1) img 태그의 src
    const img = el.querySelector('img');
    if (img && img.src) return img.src;
    // 2) background-image 폴백
    const allEls = el.querySelectorAll('*');
    for (let i = 0; i < allEls.length; i++) {
      const bg = allEls[i].style.backgroundImage || '';
      if (bg && bg !== 'none') {
        const m = bg.match(/url\(["']?(.+?)["']?\)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  function findMovableParent(target) {
    let el = target;
    let found = null;
    for (let d = 0; el && d < 20; d++, el = el.parentElement) {
      if (el instanceof HTMLElement && (el.className + '').indexOf('movable') !== -1) {
        found = el;
      }
    }
    return found;
  }

  function trackPanelClick(e) {
    const movable = findMovableParent(e.target);
    if (movable) {
      const url = extractTokenImageUrl(movable);
      if (url) {
        _lastClickedPanelImageUrl = url;
        LOG('패널 클릭 추적:', url.substring(0, 60) + '...');
      }
    }
  }

  // capture phase로 우클릭/더블클릭 추적
  document.addEventListener('contextmenu', trackPanelClick, true);
  document.addEventListener('dblclick', trackPanelClick, true);
  document.addEventListener('pointerdown', trackPanelClick, true);

  // ------------------------------------------------
  //  Read form values from panel edit dialog
  // ------------------------------------------------
  function readFormValues(form) {
    const props = {};
    const inputs = form.querySelectorAll('input');
    for (const input of inputs) {
      if (!input.name) continue;
      if (input.type === 'checkbox') {
        props[input.name] = input.checked;
      } else {
        props[input.name] = input.value;
      }
    }
    return props;
  }

  // ------------------------------------------------
  //  Binding dropdown UI (MUI OutlinedInput 스타일)
  // ------------------------------------------------
  function createBindingUI(currentCharId, characters, onSelect) {
    const container = document.createElement('div');
    container.className = 'bwbr-binding-field';
    container.style.cssText = 'position:relative;width:100%;margin-bottom:16px;';

    // ── Label (MUI InputLabel shrunk) ──
    const label = document.createElement('label');
    label.textContent = '캐릭터 바인딩';
    label.style.cssText = [
      'position:absolute', 'top:-9px', 'left:10px', 'padding:0 5px',
      'background:rgb(50,50,50)', 'color:rgba(255,255,255,0.7)',
      'font-size:12px', 'font-family:Roboto,"Noto Sans KR",sans-serif',
      'z-index:1', 'pointer-events:none', 'line-height:1.2',
      'transition:color 200ms cubic-bezier(0.0,0,0.2,1)'
    ].join(';');

    // ── Select area (OutlinedInput) ──
    const selectArea = document.createElement('div');
    selectArea.style.cssText = [
      'position:relative', 'width:100%',
      'border:1px solid rgba(255,255,255,0.23)', 'border-radius:4px',
      'cursor:pointer', 'box-sizing:border-box',
      'outline:none',
      'transition:border-color 200ms cubic-bezier(0.4,0,0.2,1)'
    ].join(';');

    // ── Display value ──
    const display = document.createElement('div');
    display.style.cssText = [
      'padding:16.5px 32px 16.5px 14px', 'color:#fff',
      'font-size:1rem', 'font-family:"Noto Sans KR",Roboto,sans-serif',
      'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap',
      'min-height:1.4375em', 'line-height:1.4375em'
    ].join(';');

    // ── Arrow icon ──
    const arrow = document.createElement('div');
    arrow.innerHTML = '&#9662;';
    arrow.style.cssText = [
      'position:absolute', 'right:7px', 'top:50%',
      'transform:translateY(-50%)', 'color:rgba(255,255,255,0.7)',
      'font-size:20px', 'pointer-events:none',
      'transition:transform 200ms cubic-bezier(0.4,0,0.2,1)'
    ].join(';');

    // ── Fieldset (notched outline — label cutout) ──
    const fieldset = document.createElement('fieldset');
    fieldset.style.cssText = [
      'position:absolute', 'inset:-5px 0 0', 'margin:0', 'padding:0 8px',
      'border:inherit', 'border-radius:inherit', 'overflow:hidden',
      'pointer-events:none', 'text-align:left'
    ].join(';');
    const legend = document.createElement('legend');
    legend.style.cssText = 'float:unset;width:auto;overflow:hidden;display:block;padding:0;height:11px;font-size:0.75em;visibility:hidden;max-width:100%;white-space:nowrap;';
    legend.innerHTML = '<span style="padding-left:5px;padding-right:5px;display:inline-block;opacity:0;visibility:visible;">캐릭터 바인딩</span>';
    fieldset.appendChild(legend);

    selectArea.appendChild(display);
    selectArea.appendChild(arrow);
    selectArea.appendChild(fieldset);

    // ── Dropdown popup (position:fixed, 위로 펼침, 다이얼로그 밖 렌더링) ──
    const dropdown = document.createElement('div');
    dropdown.style.cssText = [
      'display:none', 'position:fixed',
      'z-index:1500',
      'background:rgb(50,50,50)', 'border-radius:4px',
      'max-height:240px', 'overflow-y:auto',
      'box-shadow:0 8px 10px 1px rgba(0,0,0,0.14),0 3px 14px 2px rgba(0,0,0,0.12),0 5px 5px -3px rgba(0,0,0,0.2)'
    ].join(';');

    let isOpen = false;

    // ── Display 갱신 ──
    function updateDisplay() {
      if (!currentCharId) {
        display.innerHTML = '<span style="color:rgba(255,255,255,0.5)">바인딩 없음</span>';
        return;
      }
      for (const ch of characters) {
        if (ch._id === currentCharId) {
          if (ch.iconUrl) {
            display.innerHTML =
              '<span style="display:inline-flex;align-items:center;gap:8px;">' +
              '<img src="' + escapeHtml(ch.iconUrl) + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;" />' +
              '<span>' + escapeHtml(ch.name) + '</span></span>';
          } else {
            display.textContent = ch.name;
          }
          return;
        }
      }
      // 바인딩된 캐릭터가 목록에 없음 (삭제됨?)
      display.innerHTML = '<span style="color:rgba(255,255,255,0.5)">알 수 없는 캐릭터</span>';
    }

    // ── 옵션 빌드 ──
    function buildOptions() {
      dropdown.innerHTML = '';
      // "없음" 옵션
      dropdown.appendChild(createOption('', '바인딩 없음', null, !currentCharId));
      // 활성 캐릭터만
      const active = characters.filter((c) => c.active);
      for (const ch of active) {
        dropdown.appendChild(createOption(ch._id, ch.name, ch.iconUrl, ch._id === currentCharId));
      }
    }

    function createOption(value, name, iconUrl, selected) {
      const opt = document.createElement('div');
      opt.setAttribute('data-value', value);
      opt.style.cssText = [
        'padding:8px 16px', 'color:#fff', 'font-size:14px',
        'cursor:pointer', 'display:flex', 'align-items:center', 'gap:8px',
        'font-family:"Noto Sans KR",Roboto,sans-serif',
        selected ? 'background:rgba(33,150,243,0.16)' : ''
      ].join(';');

      if (iconUrl) {
        const img = document.createElement('img');
        img.src = iconUrl;
        img.style.cssText = 'width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;';
        opt.appendChild(img);
      } else {
        const ph = document.createElement('span');
        ph.style.cssText = 'width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.12);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:rgba(255,255,255,0.3);font-size:18px;';
        ph.textContent = value === '' ? '—' : name.charAt(0);
        opt.appendChild(ph);
      }

      const txt = document.createElement('span');
      txt.textContent = name;
      txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      if (!value) txt.style.color = 'rgba(255,255,255,0.5)';
      opt.appendChild(txt);

      opt.addEventListener('mouseenter', () => {
        opt.style.background = selected ? 'rgba(33,150,243,0.24)' : 'rgba(255,255,255,0.08)';
      });
      opt.addEventListener('mouseleave', () => {
        opt.style.background = selected ? 'rgba(33,150,243,0.16)' : '';
      });

      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        currentCharId = value || null;
        closeDropdown();
        updateDisplay();
        buildOptions();
        if (onSelect) onSelect(currentCharId);
      });

      return opt;
    }

    // ── 드롭다운 열기/닫기 (fixed 위치, 위로 펼침) ──
    function positionDropdown() {
      const rect = selectArea.getBoundingClientRect();
      dropdown.style.left = rect.left + 'px';
      dropdown.style.width = rect.width + 'px';
      // 위로 펼침: 드롭다운 bottom을 select 영역 top에 맞춤
      dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
      dropdown.style.top = 'auto';
    }

    function openDropdown() {
      if (isOpen) return;
      isOpen = true;
      // body에 직접 붙여 다이얼로그 overflow에 영향받지 않음
      document.body.appendChild(dropdown);
      positionDropdown();
      dropdown.style.display = 'block';
      selectArea.style.borderColor = 'rgb(33,150,243)';
      selectArea.style.outline = '1px solid rgb(33,150,243)';
      arrow.style.transform = 'translateY(-50%) rotate(180deg)';
      label.style.color = 'rgb(33,150,243)';
    }

    function closeDropdown() {
      if (!isOpen) return;
      isOpen = false;
      dropdown.style.display = 'none';
      // body에서 제거하여 깨끗하게
      if (dropdown.parentNode === document.body) {
        document.body.removeChild(dropdown);
      }
      selectArea.style.borderColor = 'rgba(255,255,255,0.23)';
      selectArea.style.outline = 'none';
      arrow.style.transform = 'translateY(-50%)';
      label.style.color = 'rgba(255,255,255,0.7)';
    }

    selectArea.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isOpen) closeDropdown(); else openDropdown();
    });

    // Hover
    selectArea.addEventListener('mouseenter', () => {
      if (!isOpen) selectArea.style.borderColor = '#fff';
    });
    selectArea.addEventListener('mouseleave', () => {
      if (!isOpen) selectArea.style.borderColor = 'rgba(255,255,255,0.23)';
    });

    // 외부 클릭으로 닫기
    const outsideClick = (e) => {
      if (!container.contains(e.target)) closeDropdown();
    };
    document.addEventListener('click', outsideClick);

    updateDisplay();
    buildOptions();

    container.appendChild(label);
    container.appendChild(selectArea);
    // dropdown은 openDropdown 시 document.body에 직접 부착

    // Cleanup 함수 (다이얼로그 닫힘 시 호출)
    container._cleanup = () => {
      closeDropdown();
      document.removeEventListener('click', outsideClick);
    };

    return container;
  }

  // ------------------------------------------------
  //  Inject binding UI into panel edit dialog
  // ------------------------------------------------
  let _injectedDialog = null;

  async function injectBindingUI(dialogPaper) {
    const roomId = getRoomId();
    if (!roomId) return;

    const form = dialogPaper.querySelector('form');
    if (!form) return;

    // 폼 값 읽기 + 추적된 imageUrl 포함 (패널 식별용)
    const formProps = readFormValues(form);
    formProps._trackedImageUrl = _lastClickedPanelImageUrl || '';
    LOG('폼 속성:', formProps, 'imageUrl:', formProps._trackedImageUrl ? formProps._trackedImageUrl.substring(0, 60) + '...' : '없음');

    // MAIN world에서 패널 식별
    const result = await identifyPanel(formProps);
    if (!result || !result.success) {
      LOG('패널 식별 실패 — 바인딩 UI 미주입');
      return;
    }
    const panelId = result.panelId;
    LOG('패널 식별 성공:', panelId);

    // 현재 바인딩 조회
    const bindings = await getBindings(roomId);
    const currentCharId = bindings[panelId] || null;
    LOG('현재 바인딩:', currentCharId || '없음');

    // 캐릭터 목록 조회
    const characters = await fetchCharacters();
    LOG('캐릭터:', characters.length + '명');

    // 바인딩 UI 생성
    const bindingUI = createBindingUI(currentCharId, characters, (charId) => {
      LOG('바인딩 변경:', panelId, '→', charId || '없음');
      setBinding(roomId, panelId, charId);
    });

    // 주입 지점: 고급 설정 아코디언 내, clickAction 위
    const accordion = dialogPaper.querySelector('.MuiAccordion-root');
    if (!accordion) {
      LOG('고급 설정 아코디언 없음');
      return;
    }

    const details = accordion.querySelector('.MuiAccordionDetails-root');
    if (details) {
      doInject(details, bindingUI);
    } else {
      // 아코디언이 접힌 상태 → 펼쳐질 때 주입
      const accObs = new MutationObserver(() => {
        const det = accordion.querySelector('.MuiAccordionDetails-root');
        if (det) {
          accObs.disconnect();
          doInject(det, bindingUI);
        }
      });
      accObs.observe(accordion, { childList: true, subtree: true });
    }
  }

  function doInject(detailsEl, bindingUI) {
    // AccordionDetails → MuiAccordion-region → MuiAccordionDetails-root
    // 내부에 MuiFormControl (clickAction) 이 있음 → 그 앞에 삽입
    const region = detailsEl.closest('.MuiAccordion-region') || detailsEl;
    const formCtrl = region.querySelector('.MuiFormControl-root');
    if (formCtrl) {
      formCtrl.parentNode.insertBefore(bindingUI, formCtrl);
    } else {
      detailsEl.appendChild(bindingUI);
    }
    LOG('바인딩 UI 주입 완료');
  }

  // ------------------------------------------------
  //  Dialog detection (MutationObserver)
  // ------------------------------------------------
  let _dialogObserver = null;

  function isPanelSettingsDialog(dialog) {
    const paper = dialog.querySelector('.MuiDialog-paper');
    if (!paper) return false;
    const form = paper.querySelector('form');
    if (!form) return false;
    // 패널 설정 다이얼로그 특징: width, height, clickAction 입력 필드
    return !!(
      form.querySelector('input[name="width"]') &&
      form.querySelector('input[name="height"]') &&
      form.querySelector('input[name="clickAction"]')
    );
  }

  function checkNode(node) {
    if (_injectedDialog) return;
    const dialogs = [];
    if (node.classList && node.classList.contains('MuiDialog-root')) {
      dialogs.push(node);
    }
    if (node.querySelectorAll) {
      node.querySelectorAll('.MuiDialog-root').forEach((d) => dialogs.push(d));
    }
    for (const dialog of dialogs) {
      if (isPanelSettingsDialog(dialog)) {
        _injectedDialog = dialog;
        const paper = dialog.querySelector('.MuiDialog-paper');
        if (paper) injectBindingUI(paper);
        return;
      }
    }
  }

  function handleDialogClose() {
    if (_injectedDialog) {
      const binding = _injectedDialog.querySelector('.bwbr-binding-field');
      if (binding && binding._cleanup) binding._cleanup();
    }
    _injectedDialog = null;
    LOG('다이얼로그 닫힘');
  }

  function startObserving() {
    if (_dialogObserver || !document.body) return;

    _dialogObserver = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        // 추가된 노드 검사
        for (const node of mut.addedNodes) {
          if (node.nodeType === 1) checkNode(node);
        }
        // 제거된 노드 검사 (다이얼로그 닫힘)
        if (_injectedDialog) {
          for (const node of mut.removedNodes) {
            if (node.nodeType !== 1) continue;
            if (node === _injectedDialog || node.contains(_injectedDialog)) {
              handleDialogClose();
            }
          }
        }
      }
    });

    _dialogObserver.observe(document.body, { childList: true, subtree: true });
    LOG('다이얼로그 감시 시작');
  }

  // 시작
  if (document.body) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving);
  }

})();
