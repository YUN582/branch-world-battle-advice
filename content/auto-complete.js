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
  let _atPrefix = null; // @ 컷인 자동완성 트릭용 접두사 저장

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

    /* ── @ 컷인 트릭 중 Enter ────────────────────── */
    if (e.key === 'Enter' && !e.shiftKey && _atPrefix !== null) {
      const hasDropdown = !!document.querySelector(
        '[role="listbox"], [role="option"], [data-popper-placement]'
      );

      if (hasDropdown) {
        // 드롭다운 열림 → 코코포리아가 선택 처리하게 놔둠
        // Enter 통과 후 코코포리아가 값을 바꿀 때까지 대기, prefix 결합
        const prev = el.value;
        const prefix = _atPrefix;
        _atPrefix = null;  // 다른 핸들러(focusout 등) 선점
        waitAndPrepend(el, prefix, prev);
        return;  // 코코포리아에 Enter 전달
      }

      // 드롭다운 닫힘 → 바로 접두사 + 현재값 결합
      e.preventDefault();
      e.stopImmediatePropagation();
      const combined = _atPrefix + el.value;
      _atPrefix = null;
      _guard = true; setNative(el, combined); _guard = false;
      el.selectionStart = el.selectionEnd = combined.length;
      return;
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

      /* ── @ 컷인 트릭 중 Backspace: @ 지우면 원래 텍스트 복원 ── */
      if (_atPrefix !== null && val.startsWith('@') && pos === 1 && el.selectionStart === el.selectionEnd) {
        e.preventDefault();
        e.stopPropagation();
        cancelAtTrick(el);
        return;
      }

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
    /* ── @ 컷인 자동완성 트릭 ───────────────── */
    if (ch === '@') {
      const val = el.value;
      const pos = el.selectionStart;
      // 커서가 끝에 있고, 앞에 텍스트가 있을 때만 트릭 적용
      if (pos === val.length && val.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        _atPrefix = val;
        _guard = true; setNative(el, '@'); _guard = false;
        el.selectionStart = el.selectionEnd = 1;
        return;
      }
    }
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

  /* ── @ 컷인 복원 헬퍼 ────────────────────────────────── */
  function cancelAtTrick(el) {
    const prefix = _atPrefix;
    _atPrefix = null;
    _guard = true; setNative(el, prefix); _guard = false;
    el.selectionStart = el.selectionEnd = prefix.length;
  }

  /* ── @ 컷인: 코코포리아 선택 대기 후 prefix 결합 ────── */
  /*    코코포리아가 드롭다운 선택을 처리해 textarea 값을 바꿀 때까지
       짧은 폴링으로 대기, 변경되면 prefix + 새값으로 결합 */
  function waitAndPrepend(el, prefix, prev) {
    let tries = 0;
    const maxTries = 30;  // ~500ms (30 × 16ms)
    function check() {
      const val = el.value;
      if (val !== prev) {
        // 코코포리아가 값을 갱신함 → prefix 붙이기
        const combined = prefix + val;
        _guard = true; setNative(el, combined); _guard = false;
        el.selectionStart = el.selectionEnd = combined.length;
        return;
      }
      if (++tries < maxTries) {
        requestAnimationFrame(check);
      } else {
        // 타임아웃: 값이 안 바뀜 → 그냥 prefix + 현재값 결합
        const combined = prefix + val;
        _guard = true; setNative(el, combined); _guard = false;
        el.selectionStart = el.selectionEnd = combined.length;
      }
    }
    requestAnimationFrame(check);
  }
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

  /* ── @ 컷인: Escape 취소 ─────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (_atPrefix === null || e.key !== 'Escape') return;
    if (!isChatInput(e.target)) return;
    cancelAtTrick(e.target);
  });  // non-capture: 코코포리아 자동완성 팝업이 먼저 닫힌 후 처리

  /* ── @ 컷인: 포커스 아웃 시 복원 ─────────────────────── */
  document.addEventListener('focusout', (e) => {
    if (_atPrefix === null) return;
    if (!isChatInput(e.target)) return;
    const el = e.target;
    setTimeout(() => {
      if (_atPrefix === null) return;  // Enter가 이미 처리함
      cancelAtTrick(el);
    }, 300);
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
    setEnabled(v) { enabled = !!v; },
    isEnabled()   { return enabled; },
    isAtTrickActive() { return _atPrefix !== null; }
  };

})();
