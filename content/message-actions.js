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

  // ── 수정 다이얼로그 ──
  function _showEditDialog(msgId, currentText, onConfirm) {
    // 기존 다이얼로그 제거
    var existing = document.getElementById('bwbr-msg-edit-dialog');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'bwbr-msg-edit-dialog';
    overlay.className = 'bwbr-msg-edit-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'bwbr-msg-edit-box';

    var title = document.createElement('div');
    title.className = 'bwbr-msg-edit-title';
    title.textContent = '메시지 수정';

    var textarea = document.createElement('textarea');
    textarea.className = 'bwbr-msg-edit-textarea';
    textarea.value = currentText;
    textarea.rows = 5;

    var btnRow = document.createElement('div');
    btnRow.className = 'bwbr-msg-edit-btns';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'bwbr-msg-edit-btn bwbr-msg-edit-btn--cancel';
    cancelBtn.textContent = '취소';
    cancelBtn.onclick = function() { overlay.remove(); };

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'bwbr-msg-edit-btn bwbr-msg-edit-btn--confirm';
    confirmBtn.textContent = '수정';
    confirmBtn.onclick = function() {
      var newText = textarea.value;
      if (newText === currentText) { overlay.remove(); return; }
      overlay.remove();
      onConfirm(newText);
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(title);
    dialog.appendChild(textarea);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 오버레이 클릭 시 닫기
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });

    // textarea 포커스
    setTimeout(function() { textarea.focus(); textarea.select(); }, 50);

    // Esc 닫기
    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { overlay.remove(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { confirmBtn.click(); }
    });
  }

  // ── 삭제 확인 ──
  function _showDeleteConfirm(msgId, onConfirm) {
    var existing = document.getElementById('bwbr-msg-edit-dialog');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'bwbr-msg-edit-dialog';
    overlay.className = 'bwbr-msg-edit-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'bwbr-msg-edit-box bwbr-msg-edit-box--small';

    var title = document.createElement('div');
    title.className = 'bwbr-msg-edit-title';
    title.textContent = '메시지 삭제';

    var desc = document.createElement('div');
    desc.className = 'bwbr-msg-edit-desc';
    desc.textContent = '이 메시지를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.';

    var btnRow = document.createElement('div');
    btnRow.className = 'bwbr-msg-edit-btns';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'bwbr-msg-edit-btn bwbr-msg-edit-btn--cancel';
    cancelBtn.textContent = '취소';
    cancelBtn.onclick = function() { overlay.remove(); };

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'bwbr-msg-edit-btn bwbr-msg-edit-btn--delete';
    confirmBtn.textContent = '삭제';
    confirmBtn.onclick = function() { overlay.remove(); onConfirm(); };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(title);
    dialog.appendChild(desc);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ── 공통 SVG 아이콘 ──
  var ICON_EDIT = '<svg class="MuiSvgIcon-root" focusable="false" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg>';
  var ICON_DELETE = '<svg class="MuiSvgIcon-root" focusable="false" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path></svg>';

  function _createMuiIconButton(icon, title, extraClass) {
    var btn = document.createElement('button');
    btn.className = 'MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeSmall bwbr-msg-action-btn' + (extraClass ? ' ' + extraClass : '');
    btn.setAttribute('type', 'button');
    btn.title = title;
    btn.innerHTML = icon + '<span class="MuiTouchRipple-root"></span>';
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
  var _injectedButtons = []; // 주입한 버튼들 추적

  function _removeActions() {
    for (var i = 0; i < _injectedButtons.length; i++) {
      _injectedButtons[i].remove();
    }
    _injectedButtons = [];
    // 시스템 메시지용 컨테이너 제거
    if (_currentHoveredItem) {
      var sc = _currentHoveredItem.querySelector('.bwbr-msg-actions-sys');
      if (sc) sc.remove();
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

    if (msgType === 'system') {
      // ── 시스템 메시지: 수정 + 삭제 (네이티브 컨테이너 없음) ──
      var sysContainer = document.createElement('div');
      sysContainer.className = 'bwbr-msg-actions-sys';

      var editBtn = _createMuiIconButton(ICON_EDIT, '수정', 'bwbr-msg-action-edit');
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

      var delBtn = _createMuiIconButton(ICON_DELETE, '삭제', 'bwbr-msg-action-delete');
      delBtn.onclick = function(e) {
        e.stopPropagation();
        _doDelete(listItem, msgId);
      };

      sysContainer.appendChild(editBtn);
      sysContainer.appendChild(delBtn);
      listItem.style.position = 'relative';
      listItem.appendChild(sysContainer);
    } else {
      // ── 텍스트 메시지: 네이티브 편집 버튼 컨테이너에 삭제 버튼 추가 ──
      var nativeBtn = listItem.querySelector('.MuiIconButton-root');
      var nativeContainer = nativeBtn ? nativeBtn.parentElement : null;

      var delBtn = _createMuiIconButton(ICON_DELETE, '삭제', 'bwbr-msg-action-delete');
      delBtn.onclick = function(e) {
        e.stopPropagation();
        _doDelete(listItem, msgId);
      };

      if (nativeContainer && nativeContainer !== listItem) {
        // 네이티브 편집 버튼 뒤에 삭제 버튼 삽입
        nativeContainer.appendChild(delBtn);
        _injectedButtons.push(delBtn);
      } else {
        // 컨테이너 못 찾으면 fallback
        listItem.style.position = 'relative';
        var fb = document.createElement('div');
        fb.className = 'bwbr-msg-actions-sys';
        fb.appendChild(delBtn);
        listItem.appendChild(fb);
      }
    }
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
