// ============================================================
// Branch World Battle Roll - 채팅 자동완성
// 괄호/따옴표 자동 닫기 + Tab/Shift+Tab 순환
// ============================================================

(function () {
  'use strict';

  /* ── 모든 자동 닫기 쌍 정의 (열기 → 닫기) ───────────── */
  const AUTO_CLOSE = new Map([
    ['"',       '"'],         // ASCII "
    ['\u201C',  '\u201D'],    // "" (스마트 쌍따옴표)
    ["'",       "'"],         // ASCII '
    ['\u2018',  '\u2019'],    // '' (스마트 홑따옴표)
    ['(',       ')'],         // ()
    ['\u300C',  '\u300D'],    // 「」
    ['\u300E',  '\u300F'],    // 『』
    ['\u3010',  '\u3011'],    // 【】
    ['\u300A',  '\u300B'],    // 《》
  ]);

  /* ── 모든 닫기 문자 집합 ──────────────────────────────── */
  const ALL_CLOSE = new Set();
  AUTO_CLOSE.forEach(c => ALL_CLOSE.add(c));

  /* ── Tab 순환 순서 ────────────────────────────────────── */
  const CYCLE = [
    ['\u201C',  '\u201D'],    // ""
    ['\u2018',  '\u2019'],    // ''
    ['(',       ')'],         // ()
    ['\u300C',  '\u300D'],    // 「」
    ['\u300E',  '\u300F'],    // 『』
    ['\u3010',  '\u3011'],    // 【】
    ['\u300A',  '\u300B'],    // 《》
  ];

  /* ── 열기 문자 → 순환 인덱스 (ASCII 별명 포함) ──────── */
  const CYCLE_INDEX = new Map();
  CYCLE.forEach(([o], i) => CYCLE_INDEX.set(o, i));
  CYCLE_INDEX.set('"', 0);   // ASCII " → 스마트 "" 위치
  CYCLE_INDEX.set("'", 1);   // ASCII ' → 스마트 '' 위치

  let enabled = true;
  let _guard = false;  // setNative 재진입 방지

  /* ── # 자동완성 상태 ──────────────────────────────────── */
  let _hashActive = false;
  let _hashStartPos = -1;
  let _hashInput = null;
  let _hashDrop = null;
  let _hashIdx = 0;
  let _hashCandidates = [];

  /* ── 코코포리아 채팅 입력란 감지 (textarea + contenteditable) */
  function isChatInput(el) {
    if (!el) return false;
    // contenteditable 지원
    if (el.contentEditable === 'true') return true;
    const tag = el.tagName;
    // 코코포리아: <textarea name="text"> 또는 폼 내부 input
    if (tag === 'TEXTAREA') return el.name === 'text' || !!el.closest?.('form');
    if (tag === 'INPUT' && el.type === 'text') return el.name === 'text' || !!el.closest?.('form');
    return false;
  }

  /* ── React-호환 값 설정 ──────────────────────────────── */
  function setNative(el, val) {
    const P = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(P, 'value')?.set;
    if (setter) setter.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ── keydown 핸들러 (capture phase) ─────────────────── */
  document.addEventListener('keydown', (e) => {
    if (!enabled) return;
    if (!isChatInput(e.target)) return;

    const el = e.target;

    /* ── # 자동완성 키 처리 ──────────────────────── */
    if (_hashActive && _hashInput === el) {
      // 커서가 # 앞으로 이동했거나, #가 사라졌으면 취소
      if (el.selectionStart <= _hashStartPos || el.value[_hashStartPos] !== '#') {
        _hideHash();
      }
    }
    if (_hashActive && _hashInput === el) {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        const list = _filteredHash();
        if (list.length > 0) { _hashIdx = (_hashIdx + 1) % list.length; _highlightHash(); }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const list = _filteredHash();
        if (list.length > 0) { _hashIdx = (_hashIdx - 1 + list.length) % list.length; _highlightHash(); }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        const list = _filteredHash();
        if (list.length > 0 && _hashIdx >= 0) _selectHash(list[_hashIdx].name);
        else _hideHash();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        _hideHash();
        return;
      }
      if (e.key === 'Backspace') {
        if (el.selectionStart <= _hashStartPos + 1) {
          _hideHash();
          return; // 일반 Backspace로 # 삭제
        }
        return; // input 이벤트에서 필터 갱신
      }
      if (e.key === 'Tab') {
        _hideHash(); // Tab은 괄호 순환으로 넘김
      }
    }

    /* ── :# 명령어 처리 (Enter) ──────────────────── */
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      const val = el.value.trim();

      // /ㅇ 시스템 메시지 명령
      const sysMatch = val.match(/^\/ㅇ\s+(.+)$/);
      if (sysMatch) {
        e.preventDefault();
        e.stopPropagation();
        _guard = true; setNative(el, ''); _guard = false;
        _sendSystemMessage(sysMatch[1]);
        return;
      }

      const cmdMatch = val.match(/^:#(.+)\s+(\S+?)([+\-=])(\d+)$/);
      if (cmdMatch) {
        e.preventDefault();
        e.stopPropagation();
        _execStatusCmd(el, cmdMatch[1], cmdMatch[2], cmdMatch[3], parseInt(cmdMatch[4], 10));
        return;
      }
    }

    /* ── Tab / Shift+Tab : 항상 브라우저 포커스 이동 차단 */
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      cycleTab(el, e.shiftKey);
      return;
    }

    /* ── Backspace : 빈 괄호쌍 한 번에 삭제 ──────────── */
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const pos = el.selectionStart;
      const val = el.value;

      if (pos > 0 && pos < val.length && el.selectionStart === el.selectionEnd) {
        const open = val[pos - 1];
        const close = val[pos];
        if (AUTO_CLOSE.get(open) === close) {
          e.preventDefault();
          e.stopPropagation();
          const nv = val.slice(0, pos - 1) + val.slice(pos + 1);
          _guard = true; setNative(el, nv); _guard = false;
          el.selectionStart = el.selectionEnd = pos - 1;
          return;
        }
      }
    }

    // IME 조합 중이면 괄호 처리 건너뜀
    if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;

    const ch = e.key;
    /* ── 열기 괄호 입력 → 자동 닫기 / 대칭쌍 overtype ── */
    if (AUTO_CLOSE.has(ch)) {
      const close = AUTO_CLOSE.get(ch);
      const pos = el.selectionStart;
      const val = el.value;

      // 대칭쌍 (ch === close, 예: ASCII ")에서 커서 뒤가 닫기 문자면 건너뜀
      if (ch === close && pos < val.length && val[pos] === close) {
        e.preventDefault();
        e.stopPropagation();
        el.selectionStart = el.selectionEnd = pos + 1;
        return;
      }

      // 쌍 삽입
      e.preventDefault();
      e.stopPropagation();
      const s = el.selectionStart, en = el.selectionEnd;
      const nv = val.slice(0, s) + ch + close + val.slice(en);
      _guard = true; setNative(el, nv); _guard = false;
      el.selectionStart = el.selectionEnd = s + 1;
      return;
    }

    /* ── 닫기 전용 문자 (예: ), 」 등) → overtype ──── */
    if (ALL_CLOSE.has(ch) && !AUTO_CLOSE.has(ch)) {
      const pos = el.selectionStart;
      const val = el.value;
      if (pos < val.length && val[pos] === ch) {
        e.preventDefault();
        e.stopPropagation();
        el.selectionStart = el.selectionEnd = pos + 1;
      }
    }
  }, true);

  /* ── input 이벤트 핸들러 (IME 폴백) ────────────────── */
  /*    keydown에서 e.key === 'Process' 인 경우 (한글 IME가
       문장부호를 중개한 경우), 실제 삽입된 문자를 input에서 감지 */
  document.addEventListener('input', (e) => {
    if (_guard || !enabled) return;
    if (!isChatInput(e.target)) return;

    if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;

    const ch = e.data;
    if (!AUTO_CLOSE.has(ch)) return;

    const el = e.target;
    const pos = el.selectionStart;
    const val = el.value;
    const close = AUTO_CLOSE.get(ch);

    // 이미 닫기 문자가 있으면 건너뜀
    if (pos < val.length && val[pos] === close) return;

    const nv = val.slice(0, pos) + close + val.slice(pos);
    _guard = true; setNative(el, nv); _guard = false;
    el.selectionStart = el.selectionEnd = pos;
  }, true);

  /* ── 닫기 문자 → 열기 문자 역방향 맵 (괄호 쌍 탐색용) ─ */
  const CLOSE_TO_OPEN = new Map();
  AUTO_CLOSE.forEach((c, o) => CLOSE_TO_OPEN.set(c, o));

  /* ── Tab 순환 : 커서를 감싸는 가장 가까운 괄호 쌍 탐색 ── */
  function cycleTab(el, reverse) {
    const pos = el.selectionStart;
    const val = el.value;

    let openPos = -1, closePos = -1, openCh = null;

    // 1) 커서 바로 앞뒤가 빈 쌍인지 먼저 확인 (기존 동작 유지)
    if (pos >= 1 && pos < val.length) {
      const o = val[pos - 1], c = val[pos];
      if (AUTO_CLOSE.get(o) === c) {
        openPos = pos - 1; closePos = pos; openCh = o;
      }
    }

    // 2) 빈 쌍이 아니면, 커서를 감싸는 가장 가까운 괄호 쌍 탐색
    if (openPos < 0) {
      for (let i = pos - 1; i >= 0; i--) {
        const ch = val[i];
        const expectedClose = AUTO_CLOSE.get(ch);
        if (expectedClose === undefined) continue;
        // 이 열기 문자에 대응하는 닫기 문자를 오른쪽에서 찾기 (중첩 고려)
        let depth = 0;
        for (let j = i + 1; j < val.length; j++) {
          if (val[j] === ch && ch !== expectedClose) depth++;
          if (val[j] === expectedClose) {
            if (depth === 0) {
              // 커서가 이 쌍 안에 있는지 확인
              if (pos > i && pos <= j) {
                openPos = i; closePos = j; openCh = ch;
              }
              break;
            }
            depth--;
          }
        }
        if (openPos >= 0) break;
      }
    }

    if (openPos < 0) return; // 괄호 쌍 없음

    // 순환 인덱스 확인
    const idx = CYCLE_INDEX.get(openCh);
    if (idx === undefined) return;

    const dir = reverse ? -1 : 1;
    const ni = (idx + dir + CYCLE.length) % CYCLE.length;
    const [no, nc] = CYCLE[ni];

    const nv = val.slice(0, openPos) + no + val.slice(openPos + 1, closePos) + nc + val.slice(closePos + 1);
    _guard = true; setNative(el, nv); _guard = false;
    el.selectionStart = el.selectionEnd = pos;
  }

  /* ── # 자동완성 : CSS 주입 ──────────────────────────── */
  (function _injectHashCSS() {
    const s = document.createElement('style');
    s.textContent = `
      .bwbr-hash-dropdown {
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        overflow-y: auto;
        font-size: 14px;
        color: #e0e0e0;
        padding: 4px 0;
      }
      .bwbr-hash-item {
        padding: 6px 12px;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bwbr-hash-item.selected {
        background: #3a3a3a;
        color: #fff;
      }
      .bwbr-hash-empty {
        color: #888;
        font-style: italic;
        cursor: default;
      }
      .bwbr-hash-empty.selected {
        background: transparent;
        color: #888;
      }
      .bwbr-toast {
        position: fixed;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        padding: 6px 14px;
        font-size: 13px;
        color: #e0e0e0;
        z-index: 99999;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        white-space: nowrap;
      }
      .bwbr-toast.show { opacity: 1; }
      .bwbr-toast.error { border-color: #f44336; color: #ff8a80; }
      .bwbr-toast.success { border-color: #4caf50; color: #a5d6a7; }
    `;
    document.head.appendChild(s);
  })();

  /* ── # 자동완성 : 캐릭터 데이터 요청 ──────────────── */
  function _requestChars() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 3000);
      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('bwbr-characters-data', handler);
        if (e.detail?.success && e.detail?.characters) {
          resolve(e.detail.characters.filter(c => c.active !== false));
        } else {
          resolve([]);
        }
      };
      window.addEventListener('bwbr-characters-data', handler);
      window.dispatchEvent(new CustomEvent('bwbr-request-characters'));
    });
  }

  /* ── 토스트 알림 ──────────────────────────────────── */
  function _showToast(msg, type) {
    const toast = document.createElement('div');
    toast.className = 'bwbr-toast show' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    // textarea 바로 위에 위치시키기
    const ta = document.querySelector('textarea');
    if (ta) {
      const r = ta.getBoundingClientRect();
      toast.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      toast.style.left = r.left + 'px';
    } else {
      toast.style.bottom = '80px';
      toast.style.left = '50%';
      toast.style.transform = 'translateX(-50%)';
    }
    setTimeout(() => { toast.classList.remove('show'); }, 2000);
    setTimeout(() => { toast.remove(); }, 2400);
  }

  /* ── # 자동완성 : 드롭다운 관리 ────────────────────── */
  function _hideHash() {
    if (_hashDrop) { _hashDrop.remove(); _hashDrop = null; }
    _hashActive = false;
    _hashStartPos = -1;
    _hashInput = null;
    _hashIdx = 0;
    _hashCandidates = [];
  }

  function _createHashDrop(el) {
    _hideHash();
    _hashDrop = document.createElement('div');
    _hashDrop.className = 'bwbr-hash-dropdown';
    const rect = el.getBoundingClientRect();
    Object.assign(_hashDrop.style, {
      position: 'fixed',
      left: rect.left + 'px',
      bottom: (window.innerHeight - rect.top + 4) + 'px',
      minWidth: Math.min(rect.width, 200) + 'px',
      maxWidth: '300px',
      maxHeight: '200px',
      zIndex: '99999'
    });
    document.body.appendChild(_hashDrop);
  }

  function _filteredHash() {
    if (!_hashInput) return [];
    const f = _hashInput.value.slice(_hashStartPos + 1, _hashInput.selectionStart).toLowerCase();
    return f ? _hashCandidates.filter(c => c.name.toLowerCase().includes(f)) : [..._hashCandidates];
  }

  function _renderHash() {
    if (!_hashDrop || !_hashInput) return;
    const list = _filteredHash();
    _hashDrop.innerHTML = '';

    if (list.length === 0) {
      const em = document.createElement('div');
      em.className = 'bwbr-hash-item bwbr-hash-empty';
      em.textContent = '일치하는 캐릭터 없음';
      _hashDrop.appendChild(em);
      _hashIdx = -1;
      return;
    }

    if (_hashIdx >= list.length) _hashIdx = list.length - 1;
    if (_hashIdx < 0) _hashIdx = 0;

    list.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'bwbr-hash-item' + (i === _hashIdx ? ' selected' : '');
      item.textContent = c.name;
      item.addEventListener('mousedown', (e) => { e.preventDefault(); _selectHash(c.name); });
      item.addEventListener('mouseenter', () => { _hashIdx = i; _highlightHash(); });
      _hashDrop.appendChild(item);
    });
  }

  function _highlightHash() {
    if (!_hashDrop) return;
    _hashDrop.querySelectorAll('.bwbr-hash-item:not(.bwbr-hash-empty)').forEach((el, i) => {
      el.classList.toggle('selected', i === _hashIdx);
      if (i === _hashIdx) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function _selectHash(name) {
    if (!_hashInput) return;
    const el = _hashInput;
    const val = el.value;
    const before = val.slice(0, _hashStartPos);
    const after = val.slice(el.selectionStart);
    const nv = before + '#' + name + after;
    _guard = true; setNative(el, nv); _guard = false;
    el.selectionStart = el.selectionEnd = _hashStartPos + 1 + name.length;
    _hideHash();
  }

  async function _startHash(el) {
    const pos = _hashStartPos; // await 전에 저장
    _hashInput = el;
    _hashCandidates = await _requestChars();
    if (_hashCandidates.length === 0 || !_hashActive) { _hideHash(); return; }
    const candidates = _hashCandidates; // _createHashDrop → _hideHash가 리셋하므로 보존
    _createHashDrop(el);
    // 재할당 (createHashDrop 내부에서 _hideHash 호출로 리셋되므로)
    _hashActive = true;
    _hashStartPos = pos;
    _hashInput = el;
    _hashIdx = 0;
    _hashCandidates = candidates; // 보존된 후보 복원
    _renderHash();
  }

  /* ── # 자동완성 : input 이벤트 (감지 + 필터 갱신) ─── */
  document.addEventListener('input', (e) => {
    if (_guard || !enabled) return;
    if (!isChatInput(e.target)) return;
    const el = e.target;

    // # 삽입 감지 → 자동완성 시작
    if (!_hashActive && e.inputType === 'insertText' && e.data === '#') {
      _hashActive = true;
      _hashStartPos = el.selectionStart - 1;
      _startHash(el);
      return;
    }

    // 필터 갱신
    if (_hashActive && _hashInput === el) {
      if (el.value[_hashStartPos] !== '#') { _hideHash(); return; }
      _renderHash();
    }
  }, true);

  /* ── # 자동완성 : 포커스 아웃 시 닫기 ──────────────── */
  document.addEventListener('focusout', (e) => {
    if (_hashActive && _hashInput === e.target) {
      setTimeout(() => { if (_hashActive) _hideHash(); }, 150);
    }
  }, true);

  /* ── :# 스테이터스 변경 명령 실행 ──────────────────── */
  function _execStatusCmd(el, targetName, statusLabel, operation, value) {
    // 입력 필드 클리어
    _guard = true; setNative(el, ''); _guard = false;

    const handler = (e) => {
      window.removeEventListener('bwbr-modify-status-result', handler);
      if (e.detail?.success) {
        // 성공 시 토스트 없음 (시스템 메시지로 확인 가능)
      } else {
        console.warn('[BWBR] 스테이터스 변경 실패:', e.detail?.error);
        _showToast(`⚠️ ${e.detail?.error || '알 수 없는 오류'}`, 'error');
      }
    };

    window.addEventListener('bwbr-modify-status-result', handler);
    setTimeout(() => window.removeEventListener('bwbr-modify-status-result', handler), 5000);

    window.dispatchEvent(new CustomEvent('bwbr-modify-status', {
      detail: { targetName, statusLabel, operation, value }
    }));
  }

  /* ── /ㅇ 시스템 메시지 전송 ─────────────────────── */
  function _sendSystemMessage(text) {
    document.documentElement.setAttribute('data-bwbr-send-text', text);
    document.documentElement.setAttribute('data-bwbr-send-type', 'system');
    window.dispatchEvent(new Event('bwbr-send-message-direct'));
  }

  /* ── 페이지 힌트 주입 (주사위 버튼 바 영역) ──────────── */
  function injectHint() {
    // 전송 버튼(type="submit") 옆에 힌트 삽입
    const submitBtn = document.querySelector('button[type="submit"]');
    if (!submitBtn) return;
    const bar = submitBtn.parentElement;
    if (!bar || bar.querySelector('.bwbr-hint')) return; // 이미 주입됨

    const hint = document.createElement('span');
    hint.className = 'bwbr-hint';
    hint.style.cssText = 'color:#909090;margin-left:auto;margin-right:4px;font-size:11px;white-space:nowrap;';
    hint.textContent = 'Tab / \u21e7+Tab: \ubb38\uc7a5\ubd80\ud638 \uc804\ud658';
    bar.insertBefore(hint, submitBtn);
    return;
  }

  // 코코포리아 SPA 로드 대기 후 힌트 주입
  let _hintTimer = setInterval(() => {
    if (document.querySelector('button[type="submit"]')) {
      clearInterval(_hintTimer);
      injectHint();
    }
  }, 2000);
  setTimeout(() => clearInterval(_hintTimer), 30000);

  /* ── 외부 API ─────────────────────────────────────── */
  window.BWBR_AutoComplete = {
    setEnabled(v) { enabled = !!v; if (!v) _hideHash(); },
    isEnabled()   { return enabled; },
    isHashActive() { return _hashActive; },
    hideHash()     { _hideHash(); }
  };

})();
