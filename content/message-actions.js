// ============================================================
// [CORE] 메시지 수정/삭제 UI — ISOLATED world
// 채팅 메시지 호버 시 수정/삭제 버튼 표시
// 시스템 메시지: 수정 + 삭제, 텍스트 메시지: 삭제만 (수정은 네이티브)
// 자신이 보낸 메시지만 대상 (from === 내 UID)
// ============================================================

(function() {
  'use strict';

  if (window.__BWBR_MSG_ACTIONS_LOADED) return;
  window.__BWBR_MSG_ACTIONS_LOADED = true;

  // ── cross-world 헬퍼 (bridge-util.js 패턴) ──
  function _sendToMain(eventName, payload) {
    return new Promise(function(resolve) {
      var resultEvent = eventName + '-result';
      function onResult() {
        document.removeEventListener(resultEvent, onResult);
        var raw = document.documentElement.getAttribute('data-' + resultEvent);
        document.documentElement.removeAttribute('data-' + resultEvent);
        try { resolve(JSON.parse(raw)); } catch(e) { resolve(null); }
      }
      document.addEventListener(resultEvent, onResult);
      document.documentElement.setAttribute('data-' + eventName, JSON.stringify(payload));
      document.dispatchEvent(new CustomEvent(eventName));
      // 타임아웃 (5초)
      setTimeout(function() {
        document.removeEventListener(resultEvent, onResult);
        resolve(null);
      }, 5000);
    });
  }

  // ── 내 UID 가져오기 ──
  function _getMyUid() {
    return document.documentElement.getAttribute('data-bwbr-my-uid') || '';
  }

  // ── 다이얼로그 닫기 (fade-out 애니메이션) ──
  function _closeDialog(overlay) {
    overlay.classList.remove('bwbr-dialog-open');
    setTimeout(function() { overlay.remove(); }, 230);
  }

  // ── 수정 다이얼로그 (네이티브 MUI Dialog 구조 정밀 매칭) ──
  function _showEditDialog(msgId, currentText, onConfirm) {
    var existing = document.getElementById('bwbr-msg-edit-dialog');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'bwbr-msg-edit-dialog';
    overlay.className = 'bwbr-msg-edit-overlay';
    overlay.setAttribute('role', 'presentation');

    var backdrop = document.createElement('div');
    backdrop.className = 'bwbr-msg-edit-backdrop';

    var dialog = document.createElement('div');
    dialog.className = 'bwbr-msg-edit-box';
    dialog.setAttribute('role', 'dialog');

    // DialogContent (padding: 0) → TextField → FilledInput 구조
    var content = document.createElement('div');
    content.className = 'bwbr-msg-edit-content';

    var field = document.createElement('div');
    field.className = 'bwbr-msg-edit-field';

    var label = document.createElement('label');
    label.className = 'bwbr-msg-edit-label';
    label.textContent = '메시지 편집';

    // FilledInput wrapper (bg + ::before/::after 언더라인)
    var inputRoot = document.createElement('div');
    inputRoot.className = 'bwbr-msg-edit-input-root';

    var textarea = document.createElement('textarea');
    textarea.className = 'bwbr-msg-edit-textarea';
    textarea.value = currentText;
    textarea.rows = 4;

    // 포커스 상태 관리 (언더라인 애니메이션)
    textarea.addEventListener('focus', function() {
      inputRoot.classList.add('bwbr-input-focused');
    });
    textarea.addEventListener('blur', function() {
      inputRoot.classList.remove('bwbr-input-focused');
    });

    inputRoot.appendChild(textarea);
    field.appendChild(label);
    field.appendChild(inputRoot);
    content.appendChild(field);

    // DialogActions — 네이티브는 "저장" 버튼 하나만
    var btnRow = document.createElement('div');
    btnRow.className = 'bwbr-msg-edit-btns';

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'bwbr-msg-edit-btn bwbr-msg-edit-btn--confirm';
    confirmBtn.textContent = '저장';
    confirmBtn.setAttribute('type', 'button');
    confirmBtn.onclick = function() {
      var newText = textarea.value;
      if (newText === currentText) { _closeDialog(overlay); return; }
      _closeDialog(overlay);
      onConfirm(newText);
    };

    btnRow.appendChild(confirmBtn);
    dialog.appendChild(content);
    dialog.appendChild(btnRow);
    overlay.appendChild(backdrop);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 백드롭 클릭 → 닫기
    backdrop.addEventListener('click', function() { _closeDialog(overlay); });

    // opacity fade-in 애니메이션 (네이티브 0.225s cubic-bezier)
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        overlay.classList.add('bwbr-dialog-open');
      });
    });

    // textarea 포커스
    setTimeout(function() { textarea.focus(); textarea.select(); }, 100);

    // Esc 닫기, Ctrl+Enter 저장
    function _onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', _onKey); _closeDialog(overlay); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { document.removeEventListener('keydown', _onKey); confirmBtn.click(); }
    }
    document.addEventListener('keydown', _onKey);
  }

  // ── 삭제 확인 (같은 MUI Dialog 스타일) ──
  function _showDeleteConfirm(msgId, onConfirm) {
    var existing = document.getElementById('bwbr-msg-edit-dialog');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'bwbr-msg-edit-dialog';
    overlay.className = 'bwbr-msg-edit-overlay';
    overlay.setAttribute('role', 'presentation');

    var backdrop = document.createElement('div');
    backdrop.className = 'bwbr-msg-edit-backdrop';

    var dialog = document.createElement('div');
    dialog.className = 'bwbr-msg-edit-box bwbr-msg-edit-box--small';
    dialog.setAttribute('role', 'dialog');

    var content = document.createElement('div');
    content.className = 'bwbr-msg-edit-content bwbr-msg-edit-content--delete';

    var title = document.createElement('div');
    title.className = 'bwbr-msg-edit-title';
    title.textContent = '메시지 삭제';

    var desc = document.createElement('div');
    desc.className = 'bwbr-msg-edit-desc';
    desc.textContent = '이 메시지를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.';

    content.appendChild(title);
    content.appendChild(desc);

    var btnRow = document.createElement('div');
    btnRow.className = 'bwbr-msg-edit-btns';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'bwbr-msg-edit-btn bwbr-msg-edit-btn--cancel';
    cancelBtn.textContent = '취소';
    cancelBtn.setAttribute('type', 'button');
    cancelBtn.onclick = function() { _closeDialog(overlay); };

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'bwbr-msg-edit-btn bwbr-msg-edit-btn--delete';
    confirmBtn.textContent = '삭제';
    confirmBtn.setAttribute('type', 'button');
    confirmBtn.onclick = function() { _closeDialog(overlay); setTimeout(function() { onConfirm(); }, 50); };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(content);
    dialog.appendChild(btnRow);
    overlay.appendChild(backdrop);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 백드롭 클릭 → 닫기
    backdrop.addEventListener('click', function() { _closeDialog(overlay); });

    // fade-in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        overlay.classList.add('bwbr-dialog-open');
      });
    });

    // Esc 닫기
    function _onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', _onKey); _closeDialog(overlay); }
    }
    document.addEventListener('keydown', _onKey);
  }

  // ── 공통 SVG 아이콘 ──
  var ICON_EDIT = '<svg focusable="false" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  var ICON_DELETE = '<svg focusable="false" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

  function _createActionBtn(icon, title, extraClass) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-msg-action-btn' + (extraClass ? ' ' + extraClass : '');
    btn.setAttribute('type', 'button');
    btn.title = title;
    btn.innerHTML = icon;
    return btn;
  }

  // ── 삭제 실행 (공통) ──
  function _doDelete(listItem, msgId) {
    _showDeleteConfirm(msgId, function() {
      _sendToMain('bwbr-delete-message', { msgId: msgId }).then(function(res) {
        if (res && res.success) {
          listItem.style.transition = 'opacity 0.3s, max-height 0.3s';
          listItem.style.opacity = '0';
          listItem.style.maxHeight = listItem.offsetHeight + 'px';
          setTimeout(function() {
            listItem.style.maxHeight = '0';
            listItem.style.overflow = 'hidden';
            listItem.style.padding = '0';
            listItem.style.margin = '0';
          }, 200);
          setTimeout(function() { listItem.remove(); }, 500);
        }
      });
    });
  }

  // ── 호버 버튼 주입/제거 ──
  var _currentHoveredItem = null;
  var _actionContainer = null;

  function _removeActions() {
    if (_actionContainer) {
      _actionContainer.remove();
      _actionContainer = null;
    }
    _currentHoveredItem = null;
  }

  function _injectActions(listItem) {
    if (_currentHoveredItem === listItem) return;
    _removeActions();

    var msgId = listItem.getAttribute('data-msg-id');
    var msgFrom = listItem.getAttribute('data-msg-from');
    var msgType = listItem.getAttribute('data-msg-type');

    if (!msgId) return;

    var myUid = _getMyUid();
    if (!myUid || msgFrom !== myUid) return;

    _currentHoveredItem = listItem;

    // 항상 독립 컨테이너 — 네이티브 DOM 절대 비간섭
    _actionContainer = document.createElement('div');
    _actionContainer.className = 'bwbr-msg-actions';

    if (msgType === 'system') {
      // ── 시스템 메시지: 수정(커스텀 다이얼로그) + 삭제 ──
      var editBtn = _createActionBtn(ICON_EDIT, '수정', 'bwbr-msg-action-edit');
      editBtn.onclick = function(e) {
        e.stopPropagation();
        var textEl = listItem.querySelector('.MuiListItemText-secondary');
        var current = textEl ? textEl.textContent : '';
        _showEditDialog(msgId, current, function(newText) {
          _sendToMain('bwbr-edit-message', { msgId: msgId, newText: newText, msgType: 'system' }).then(function(res) {
            if (res && res.success && textEl) {
              textEl.textContent = newText;
            }
          });
        });
      };
      _actionContainer.appendChild(editBtn);
    }

    // 삭제 버튼 (시스템/텍스트 공용)
    var delBtn = _createActionBtn(ICON_DELETE, '삭제', 'bwbr-msg-action-delete');
    delBtn.onclick = function(e) {
      e.stopPropagation();
      _doDelete(listItem, msgId);
    };
    _actionContainer.appendChild(delBtn);

    listItem.appendChild(_actionContainer);
  }

  // ── 이벤트 위임 (mouseover/mouseout) ──
  function _setupHoverListeners() {
    var msgList = document.querySelector('ul.MuiList-root');
    if (!msgList) {
      setTimeout(_setupHoverListeners, 2000);
      return;
    }

    msgList.addEventListener('mouseover', function(e) {
      var item = e.target.closest('.MuiListItem-root');
      if (!item) return;
      if (item === _currentHoveredItem) return;
      _injectActions(item);
    });

    msgList.addEventListener('mouseleave', function() {
      _removeActions();
    });

    // 개별 아이템에서 나갈 때도 제거
    msgList.addEventListener('mouseout', function(e) {
      var item = e.target.closest('.MuiListItem-root');
      var relatedItem = e.relatedTarget ? e.relatedTarget.closest('.MuiListItem-root') : null;
      // 다른 아이템으로 이동하면 injectActions가 처리
      // 리스트 밖으로 나가면 제거
      if (item === _currentHoveredItem && !relatedItem) {
        _removeActions();
      }
    });

    console.log('[CE] 메시지 수정/삭제 UI 초기화 완료');
  }

  // 초기화
  if (document.readyState === 'complete') {
    setTimeout(_setupHoverListeners, 2000);
  } else {
    window.addEventListener('load', function() {
      setTimeout(_setupHoverListeners, 2000);
    });
  }

})();
