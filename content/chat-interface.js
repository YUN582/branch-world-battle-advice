// ============================================================
// Branch World Battle Roll - 코코포리아 채팅 인터페이스 v5
//
// === 설계 원칙 ===
// MutationObserver → "뭔가 바뀜" 신호만 발생 → 즉시 poll 트리거
// 실제 메시지 감지 → 스냅샷(배열) 비교로 "끝에 추가된 것"만 처리
// 탭 전환 → 스냅샷과 현재 목록이 50%+ 다르면 재스냅샷
//
// === 코코포리아 DOM ===
// textarea[name="text"]  — 채팅 입력
// button[type="submit"]  — "전송" 버튼 (같은 <form>)
// __reactProps$xxx.onChange — React state 갱신
// ============================================================

window.CocoforiaChatInterface = class CocoforiaChatInterface {
  constructor(config) {
    this.config = config || window.BWBR_DEFAULTS;
    this.chatContainer = null;
    this.chatInput = null;
    this.sendButton = null;
    this.chatForm = null;
    this.observer = null;
    this.pollingTimer = null;
    this.messageCallback = null;

    // ── 스냅샷 기반 감지 ──
    this._ready = false;
    this._snapshot = [];           // 마지막으로 본 메시지 텍스트 배열
    this._lastSentMessages = [];
    this._lastSentMaxAge = 10000;
    this._pollDebounceTimer = null;
  }

  updateConfig(config) { this.config = config; }

  // ================================================================
  //  DOM 요소 탐색
  // ================================================================

  findElements() {
    this.chatInput = this._findChatInput();
    this.chatForm = this.chatInput?.closest('form') || null;
    this.sendButton = this._findSendButton();
    this.chatContainer = this._findChatContainer();

    const ok = !!(this.chatContainer && this.chatInput);
    this._log(`DOM: container=${!!this.chatContainer}, input=${!!this.chatInput}, form=${!!this.chatForm}, btn=${!!this.sendButton}`);
    return ok;
  }

  _findChatInput() {
    // 1) 코코포리아: name="text"
    let el = document.querySelector('textarea[name="text"]');
    if (el && this._isVisible(el)) return el;
    // 2) MUI textarea
    el = document.querySelector('textarea.MuiInputBase-inputMultiline');
    if (el && this._isVisible(el)) return el;
    // 3) 아무 visible textarea
    for (const ta of document.querySelectorAll('textarea')) {
      if (this._isVisible(ta)) return ta;
    }
    // 4) contenteditable
    for (const ce of document.querySelectorAll('[contenteditable="true"]')) {
      if (this._isVisible(ce)) return ce;
    }
    return null;
  }

  _findSendButton() {
    if (this.chatForm) {
      const btn = this.chatForm.querySelector('button[type="submit"]');
      if (btn) return btn;
    }
    for (const btn of document.querySelectorAll('button[type="submit"]')) {
      if (btn.textContent.includes('전송') && this._isVisible(btn)) return btn;
    }
    return null;
  }

  _findChatContainer() {
    // 전략 1: config 선택자
    for (const sel of this._asArray(this.config.selectors.chatContainer)) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (this._isVisible(el) && this._looksLikeChat(el)) {
            this._log(`컨테이너: 설정 "${sel}"`);
            return el;
          }
        }
      } catch (e) {}
    }
    // 전략 2: form 기준 형제 탐색
    if (this.chatInput) {
      let parent = this.chatForm?.parentElement || this.chatInput.parentElement;
      let depth = 0;
      while (parent && depth < 15) {
        for (const sib of parent.children) {
          if (!sib.contains?.(this.chatInput) && this._looksLikeChat(sib)) {
            this._log(`컨테이너: 형제탐색 depth=${depth}`);
            return sib;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    }
    // 전략 3: role="log"
    const logEl = document.querySelector('[role="log"]');
    if (logEl && this._isVisible(logEl)) return logEl;
    // 전략 4: body
    this._log('컨테이너: body 폴백');
    return document.body;
  }

  _looksLikeChat(el) {
    if (!this._isVisible(el) || el.id?.includes('bwbr')) return false;
    const r = el.getBoundingClientRect();
    if (r.height < 80 || r.width < 80) return false;
    const s = window.getComputedStyle(el);
    const scrollable = s.overflowY === 'scroll' || s.overflowY === 'auto' || el.scrollHeight > el.clientHeight;
    return scrollable && el.children.length >= 2;
  }

  _isVisible(el) {
    if (!el?.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
  }

  async waitForElements(maxWait = 30000, interval = 1000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (this.findElements()) return true;
      await this._delay(interval);
    }
    return false;
  }

  // ================================================================
  //  채팅 관찰  ──  스냅샷 비교 방식
  // ================================================================

  observeChat(callback) {
    this.messageCallback = callback;
    if (!this.chatContainer) {
      this._log('컨테이너 없음 → 관찰 불가');
      return false;
    }

    this.stopObserving();

    // ▶ 초기 스냅샷 (기존 메시지 전부 등록)
    this._snapshot = this._collectAllTexts();
    this._ready = false;
    this._log(`초기 스냅샷: ${this._snapshot.length}개 메시지`);

    // ▶ MutationObserver — 변화 감지 시 즉시 poll 트리거
    this.observer = new MutationObserver(() => {
      if (!this._ready) return;
      this._debouncedPoll();
    });
    this.observer.observe(this.chatContainer, {
      childList: true, subtree: true
    });

    // ▶ 정기 폴링 (안전망, 1초 간격)
    this.pollingTimer = setInterval(() => {
      if (!this._ready) return;
      this._doPoll();
    }, 1000);

    // ▶ 2초 유예 후 활성화
    setTimeout(() => {
      // 유예 중 추가된 메시지도 스냅샷에 포함
      this._snapshot = this._collectAllTexts();
      this._ready = true;
      this._log(`✅ 관찰 활성화 (스냅샷 ${this._snapshot.length}개)`);
    }, 2000);

    this._log('관찰 준비 중 (2초 유예)...');
    return true;
  }

  stopObserving() {
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
    if (this._pollDebounceTimer) { clearTimeout(this._pollDebounceTimer); this._pollDebounceTimer = null; }
    this._ready = false;
  }

  /** MutationObserver에서 호출 — 짧은 디바운스 후 poll */
  _debouncedPoll() {
    if (this._pollDebounceTimer) clearTimeout(this._pollDebounceTimer);
    this._pollDebounceTimer = setTimeout(() => this._doPoll(), 150);
  }

  /**
   * 핵심 감지 로직: 스냅샷과 현재 메시지 목록을 비교
   * - 끝에 추가된 메시지만 새 메시지로 처리
   * - 대량 변화 → 탭 전환으로 판정 → 재스냅샷
   */
  _doPoll() {
    if (!this.chatContainer) return;

    const current = this._collectAllTexts();
    const prev = this._snapshot;

    // 변화 없음
    if (current.length === prev.length && current[current.length - 1] === prev[prev.length - 1]) {
      return;
    }

    // ── 탭 전환 감지 ──
    // 1) 메시지가 크게 줄었으면 탭 전환
    if (current.length < prev.length - 3) {
      this._log(`⚠️ 탭 전환: 메시지 감소 (${prev.length}→${current.length})`);
      this._snapshot = current;
      return;
    }

    // 2) 기존 메시지의 앞부분이 완전히 달라졌으면 탭 전환
    //    (같은 탭이면 이전 메시지가 여전히 존재해야 함)
    if (prev.length >= 3 && current.length >= 3) {
      let matchCount = 0;
      const checkLen = Math.min(5, prev.length, current.length);
      for (let i = 0; i < checkLen; i++) {
        if (current.includes(prev[prev.length - 1 - i])) matchCount++;
      }
      if (matchCount < checkLen * 0.4) {
        this._log(`⚠️ 탭 전환: 기존 메시지 불일치 (${matchCount}/${checkLen})`);
        this._snapshot = current;
        return;
      }
    }

    // ── 새 메시지 추출 ──
    // 이전 스냅샷의 마지막 메시지가 현재 목록의 어디에 있는지 찾기
    let startIdx = current.length; // 기본: 새 메시지 없음
    if (prev.length === 0) {
      startIdx = 0;
    } else {
      const lastPrev = prev[prev.length - 1];
      // 뒤에서부터 검색 (가장 최근 일치 위치 찾기)
      for (let i = current.length - 1; i >= 0; i--) {
        if (current[i] === lastPrev) {
          startIdx = i + 1;
          break;
        }
      }
      // 이전 마지막 메시지를 못 찾으면 → current가 prev보다 길 때만
      if (startIdx === current.length && current.length > prev.length) {
        startIdx = prev.length;
      }
    }

    const newMessages = current.slice(startIdx);
    this._snapshot = current;

    if (newMessages.length === 0) return;

    // 과도하게 많으면 (20개+) 탭 전환/로드로 간주
    if (newMessages.length > 20) {
      this._log(`⚠️ 대량 신규(${newMessages.length}개) → 무시`);
      return;
    }

    this._log(`📨 새 메시지 ${newMessages.length}개 감지`);

    for (const text of newMessages) {
      if (!text || text.length < 2) continue;

      // 자체 전송 메시지 무시
      if (this._isOwnMessage(text)) {
        this._log(`  [자체] "${text.substring(0, 40)}"`);
        continue;
      }

      this._log(`  [NEW] "${text.substring(0, 100)}"`);
      if (this.messageCallback) {
        try { this.messageCallback(text, null); } catch (e) { console.error('[BWBR]', e); }
      }
    }
  }

  // ── 메시지 텍스트 수집 ──

  _collectAllTexts() {
    if (!this.chatContainer) return [];
    const texts = [];

    // chatMessage 선택자로 메시지 요소 찾기
    let messageEls = [];
    for (const sel of this._asArray(this.config.selectors.chatMessage)) {
      try {
        this.chatContainer.querySelectorAll(sel).forEach(e => {
          if (!messageEls.includes(e)) messageEls.push(e);
        });
      } catch (e) {}
    }

    // 못 찾으면 direct children
    if (messageEls.length === 0) {
      messageEls = Array.from(this.chatContainer.children);
    }

    for (const el of messageEls) {
      if (el.id?.includes('bwbr')) continue;
      const t = (el.textContent || '').trim();
      if (t.length >= 2) texts.push(t);
    }
    return texts;
  }

  // ── 주사위 결과 파싱 ──

  parseDiceResult(text) {
    const patterns = [
      this.config.patterns.diceResultRegex,
      '1[Dd]20[^0-9]*?[→＞>=]+\\s*(\\d+)',
      '\\(1[Dd]20\\)[^0-9]*?[→＞>=]+\\s*(\\d+)',
      '결과[:\\s]*(\\d+)',
      '[→＞>]\\s*(\\d+)\\s*$'
    ];
    for (const pat of patterns) {
      try {
        const m = text.match(new RegExp(pat));
        if (m?.[1]) {
          const v = parseInt(m[1], 10);
          if (!isNaN(v) && v >= 1 && v <= this.config.rules.diceType) return v;
        }
      } catch (e) {}
    }
    return null;
  }

  // ── 자체 전송 메시지 확인 ──

  _isOwnMessage(text) {
    const now = Date.now();
    this._lastSentMessages = this._lastSentMessages.filter(m => now - m.time < this._lastSentMaxAge);
    for (let i = 0; i < this._lastSentMessages.length; i++) {
      const sent = this._lastSentMessages[i];
      if (text.includes(sent.text) || sent.text.includes(text)) {
        this._lastSentMessages.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  // ================================================================
  //  메시지 전송  ──  React fiber + form submit
  // ================================================================

  async sendMessage(text) {
    if (!this.chatInput || !this._isVisible(this.chatInput)) {
      this.findElements();
    }
    if (!this.chatInput) {
      this._log('❌ 입력 필드 없음');
      return false;
    }
    if (!this.sendButton || !this._isVisible(this.sendButton)) {
      this.chatForm = this.chatInput.closest('form') || null;
      this.sendButton = this._findSendButton();
    }

    this._lastSentMessages.push({ text, time: Date.now() });
    this._log(`📤 전송: "${text.substring(0, 60)}"`);

    // 시도 1: React fiber onChange + 버튼 클릭
    if (await this._sendViaReactFiber(text)) return true;
    // 시도 2: nativeValueSetter + InputEvent + 버튼
    if (await this._sendViaNativeSetter(text)) return true;
    // 시도 3: execCommand
    if (await this._sendViaExecCommand(text)) return true;
    // 시도 4: 클립보드
    if (await this._sendViaClipboard(text)) return true;

    this._log('❌ 전송 실패');
    return false;
  }

  // ── 방법 1: React Fiber onChange ──
  async _sendViaReactFiber(text) {
    try {
      const el = this.chatInput;
      el.focus();
      await this._delay(50);

      const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      if (!propsKey || !el[propsKey]?.onChange) return false;

      this._setNativeValue(el, text);
      el[propsKey].onChange({
        target: el, currentTarget: el, type: 'change',
        preventDefault() {}, stopPropagation() {},
        nativeEvent: new Event('change'), persist() {}
      });
      await this._delay(100);

      if (el.value !== text) {
        this._setNativeValue(el, text);
        el[propsKey].onChange({
          target: el, currentTarget: el, type: 'change',
          preventDefault() {}, stopPropagation() {},
          nativeEvent: new Event('change'), persist() {}
        });
        await this._delay(80);
      }

      return await this._submitForm();
    } catch (e) {
      this._log(`React fiber 오류: ${e.message}`);
      return false;
    }
  }

  // ── 방법 2: Native setter + InputEvent ──
  async _sendViaNativeSetter(text) {
    try {
      const el = this.chatInput;
      el.focus();
      await this._delay(50);
      this._setNativeValue(el, text);
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await this._delay(100);
      return await this._submitForm();
    } catch (e) { return false; }
  }

  // ── 방법 3: execCommand ──
  async _sendViaExecCommand(text) {
    try {
      const el = this.chatInput;
      el.focus();
      await this._delay(50);
      el.select?.();
      document.execCommand('selectAll', false, null);
      if (!document.execCommand('insertText', false, text)) return false;
      await this._delay(100);
      return await this._submitForm();
    } catch (e) { return false; }
  }

  // ── 방법 4: 클립보드 ──
  async _sendViaClipboard(text) {
    try {
      const el = this.chatInput;
      el.focus();
      await this._delay(50);
      el.select?.();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await navigator.clipboard.writeText(text);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt
      }));
      await this._delay(100);
      if (!el.value?.includes(text.substring(0, 10))) {
        this._setNativeValue(el, text);
      }
      return await this._submitForm();
    } catch (e) { return false; }
  }

  // ── 폼 제출 ──
  async _submitForm() {
    // A) 전송 버튼 클릭
    if (this.sendButton && this._isVisible(this.sendButton)) {
      this._log('전송: 버튼 클릭');
      this.sendButton.click();
      await this._delay(200);
      return true;
    }
    // B) form.requestSubmit()
    if (this.chatForm) {
      try { this.chatForm.requestSubmit(); await this._delay(200); return true; } catch (e) {}
      try {
        this.chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await this._delay(200); return true;
      } catch (e) {}
    }
    // C) Enter 키
    const el = this.chatInput;
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      }));
    }
    await this._delay(100);
    // D) React onKeyDown
    try {
      const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      if (pk && el[pk]?.onKeyDown) {
        el[pk].onKeyDown({
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          shiftKey: false, ctrlKey: false, target: el, currentTarget: el,
          preventDefault() {}, stopPropagation() {},
          nativeEvent: new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }),
          persist() {}
        });
      }
    } catch (e) {}
    await this._delay(100);
    return true;
  }

  // ── Native value setter ──
  _setNativeValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) { desc.set.call(el, text); return; }
    }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = text;
    else el.textContent = text;
  }

  // ── 유틸리티 ──
  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  _asArray(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
  _log(msg) {
    console.log(`%c[BWBR Chat]%c ${msg}`, 'color: #4a7cff; font-weight: bold;', 'color: inherit;');
  }
};
