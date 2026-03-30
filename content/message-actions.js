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

    // DialogContent (padding: 0) → form → TextField → FilledInput 구조
    var content = document.createElement('div');
    content.className = 'bwbr-msg-edit-content';

    var form = document.createElement('form');
    form.setAttribute('autocomplete', 'off');
    form.addEventListener('submit', function(e) { e.preventDefault(); confirmBtn.click(); });

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
    form.appendChild(field);
    content.appendChild(form);

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

  // ── 삭제된 메시지 추적 (탭 전환 시 재표시 방지) ──
  var _deletedMsgIds = new Set();

  // ── 삭제 실행 (확인 없이 즉시) ──
  function _doDelete(listItem, msgId) {
    _deletedMsgIds.add(msgId);
    listItem.style.display = 'none';
    _removeActions();
    _sendToMain('bwbr-delete-message', { msgId: msgId }).then(function(res) {
      if (!res || !res.success) {
        // 삭제 실패 → 복원
        _deletedMsgIds.delete(msgId);
        listItem.style.display = '';
      }
    });
  }

  // ── 호버 버튼 주입/제거 ──
  // 네이티브 DOM 절대 비간섭: 독립 CE 컨테이너만 사용
  // 텍스트 메시지: CE[삭제] + CSS로 네이티브 편집 왼쪽 이동 → [편집][삭제]
  // 시스템 메시지: CE[편집][삭제]
  var _currentHoveredItem = null;
  var _actionContainer = null;

  function _removeActions() {
    if (_currentHoveredItem) {
      _currentHoveredItem.classList.remove('bwbr-has-actions');
    }
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
    // 삭제된 메시지면 숨기기
    if (_deletedMsgIds.has(msgId)) { listItem.style.display = 'none'; return; }

    var myUid = _getMyUid();
    if (!myUid || msgFrom !== myUid) return;

    _currentHoveredItem = listItem;
    listItem.classList.add('bwbr-has-actions');

    _actionContainer = document.createElement('div');
    _actionContainer.className = 'bwbr-msg-actions';

    if (msgType === 'system') {
      // ── 시스템 메시지: CE [편집][삭제] ──
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
    // 텍스트 메시지: 편집은 네이티브가 제공, CE는 삭제만
    // CSS가 .bwbr-has-actions[data-msg-type="text"]일 때 네이티브 컨테이너를 right:48px로 shift

    var delBtn = _createActionBtn(ICON_DELETE, '삭제', 'bwbr-msg-action-delete');
    delBtn.onclick = function(e) {
      e.stopPropagation();
      _doDelete(listItem, msgId);
    };
    _actionContainer.appendChild(delBtn);

    listItem.appendChild(_actionContainer);
  }

  // ── 삭제된 메시지 DOM 숨김 (탭 전환/리렌더 시) ──
  function _hideDeletedMessages(msgList) {
    if (_deletedMsgIds.size === 0) return;
    var items = msgList.querySelectorAll('.MuiListItem-root[data-msg-id]');
    for (var i = 0; i < items.length; i++) {
      if (_deletedMsgIds.has(items[i].getAttribute('data-msg-id'))) {
        items[i].style.display = 'none';
      }
    }
  }

  // ── 이벤트 위임 (document 레벨 — UL 교체에도 안전) ──
  function _setupHoverListeners() {
    // document 레벨 delegation — React 리렌더로 UL이 교체되어도 동작
    document.addEventListener('mouseover', function(e) {
      var item = e.target.closest('.MuiListItem-root');
      if (!item) return;
      // 메시지 리스트 안의 아이템만 대상
      if (!item.closest('ul.MuiList-root')) return;
      if (item === _currentHoveredItem) return;
      // 태그 없으면 MAIN world에 재태깅 요청 후 재시도
      if (!item.getAttribute('data-msg-id')) {
        document.dispatchEvent(new CustomEvent('bwbr-retag-messages'));
        setTimeout(function() { _injectActions(item); }, 200);
        return;
      }
      _injectActions(item);
    });

    document.addEventListener('mouseout', function(e) {
      if (!_currentHoveredItem) return;
      var related = e.relatedTarget;
      // 같은 ListItem 안에서 이동 중이면 무시
      if (related && related.closest && related.closest('.MuiListItem-root') === _currentHoveredItem) return;
      // 현재 호버 아이템에서 나갈 때만 제거
      var fromItem = e.target.closest('.MuiListItem-root');
      if (fromItem === _currentHoveredItem) {
        _removeActions();
      }
    });

    // 삭제된 메시지 DOM 재표시 방지 — 태깅 완료 이벤트 수신 시 재숨김
    document.addEventListener('bwbr-tags-applied', function() {
      if (_deletedMsgIds.size === 0) return;
      var msgList = document.querySelector('ul.MuiList-root');
      if (msgList) _hideDeletedMessages(msgList);
    });

    // 주기적 삭제 메시지 숨김 (탭 전환 후 태깅 지연 대비)
    setInterval(function() {
      if (_deletedMsgIds.size === 0) return;
      var msgList = document.querySelector('ul.MuiList-root');
      if (msgList) _hideDeletedMessages(msgList);
    }, 1500);

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
