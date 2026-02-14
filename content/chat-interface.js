// ============================================================
// Branch World Battle Roll - 코코포리아 채팅 인터페이스 v6
//
// === 핵심 설계 ===
// 1) Set 기반 메시지 추적: 이미 본 텍스트를 Set에 저장
// 2) "맨 아래 N개"만 검사: 스크롤로 위에 로드된 메시지 무시
// 3) 탭 전환 감지: 모든 최하단 메시지가 미확인이면 탭 전환
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

    // ── Set 기반 감지 ──
    this._ready = false;
    this._seenTexts = new Set();   // 이미 본 메시지 텍스트
    this._lastSentMessages = [];
    this._lastSentMaxAge = 15000;
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
    let el = document.querySelector('textarea[name="text"]');
    if (el && this._isVisible(el)) return el;
    el = document.querySelector('textarea.MuiInputBase-inputMultiline');
    if (el && this._isVisible(el)) return el;
    for (const ta of document.querySelectorAll('textarea')) {
      if (this._isVisible(ta)) return ta;
    }
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
    for (const sel of this._asArray(this.config.selectors.chatContainer)) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (this._isVisible(el) && this._looksLikeChat(el)) {
            this._log(`컨테이너: "${sel}"`);
            return el;
          }
        }
      } catch (e) {}
    }
    if (this.chatInput) {
      let parent = this.chatForm?.parentElement || this.chatInput.parentElement;
      let depth = 0;
      while (parent && depth < 15) {
        for (const sib of parent.children) {
          if (!sib.contains?.(this.chatInput) && this._looksLikeChat(sib)) {
            this._log(`컨테이너: 형제 depth=${depth}`);
            return sib;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    }
    const logEl = document.querySelector('[role="log"]');
    if (logEl && this._isVisible(logEl)) return logEl;
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
  //  채팅 관찰  ──  Set 기반 + 맨 아래만 검사
  // ================================================================

  observeChat(callback) {
    this.messageCallback = callback;
    if (!this.chatContainer) {
      this._log('컨테이너 없음 → 관찰 불가');
      return false;
    }

    this.stopObserving();

    // ▶ 현재 모든 메시지를 "이미 본 것"으로 등록
    this._seenTexts = new Set();
    const initial = this._collectAllTexts();
    for (const t of initial) this._seenTexts.add(t);
    this._ready = false;
    this._log(`초기 등록: ${initial.length}개 메시지`);

    // ▶ MutationObserver → poll 트리거
    this.observer = new MutationObserver(() => {
      if (!this._ready) return;
      this._debouncedPoll();
    });
    this.observer.observe(this.chatContainer, {
      childList: true, subtree: true
    });

    // ▶ 정기 폴링 (안전망)
    this.pollingTimer = setInterval(() => {
      if (!this._ready) return;
      this._doPoll();
    }, 1000);

    // ▶ 2초 유예 후 활성화
    setTimeout(() => {
      // 유예 중 추가된 메시지도 등록
      const current = this._collectAllTexts();
      for (const t of current) this._seenTexts.add(t);
      this._ready = true;
      this._log(`✅ 관찰 활성화 (${this._seenTexts.size}개 등록됨)`);
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

  _debouncedPoll() {
    if (this._pollDebounceTimer) clearTimeout(this._pollDebounceTimer);
    this._pollDebounceTimer = setTimeout(() => this._doPoll(), 150);
  }

  /**
   * 핵심 감지 로직 (v7):
   * - _seenTexts Set에 없는 모든 메시지를 검사
   * - Set이 이미 기존 메시지를 모두 포함하므로 스크롤로 나타난 옛날 메시지는 이미 Set에 있음
   * - 탭 전환: 보이는 메시지의 대다수(70%+)가 미확인이면 탭 전환
   */
  _doPoll() {
    if (!this.chatContainer) return;

    const current = this._collectAllTexts();
    if (current.length === 0) return;

    // 메시지 전체에서 unseen 찾기
    const unseenMessages = [];
    for (let i = 0; i < current.length; i++) {
      const text = current[i];
      if (text && text.length >= 2 && !this._seenTexts.has(text)) {
        unseenMessages.push({ text, index: i });
      }
    }

    // 모든 현재 메시지를 seen에 등록 (스크롤로 보인 옛날 메시지 포함)
    for (const t of current) {
      if (t) this._seenTexts.add(t);
    }

    // Set 크기 관리
    if (this._seenTexts.size > 1000) {
      const arr = [...this._seenTexts];
      this._seenTexts = new Set(arr.slice(-500));
    }

    if (unseenMessages.length === 0) return;

    // 탭 전환 감지: 보이는 메시지의 70% 이상이 unseen이면 탭 전환
    const unseenRatio = unseenMessages.length / current.length;
    if (current.length >= 3 && unseenRatio > 0.7) {
      this._log(`⚠️ 탭 전환 감지 (${unseenMessages.length}/${current.length} = ${Math.round(unseenRatio*100)}% unseen) → 무시`);
      return;
    }

    // 대량 신규(8개+) → 로드/탭전환
    if (unseenMessages.length > 8) {
      this._log(`⚠️ 대량 신규(${unseenMessages.length}개) → 무시`);
      return;
    }

    // 새 메시지 처리
    this._log(`📨 새 메시지 ${unseenMessages.length}개`);

    for (const { text } of unseenMessages) {
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
    let messageEls = [];
    for (const sel of this._asArray(this.config.selectors.chatMessage)) {
      try {
        this.chatContainer.querySelectorAll(sel).forEach(e => {
          if (!messageEls.includes(e)) messageEls.push(e);
        });
      } catch (e) {}
    }
    if (messageEls.length === 0) messageEls = Array.from(this.chatContainer.children);
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
    // 전송할 메시지를 미리 seen에 등록 (돌아왔을 때 무시)
    this._seenTexts.add(text);
    this._log(`📤 전송: "${text.substring(0, 60)}"`);

    if (await this._sendViaReactFiber(text)) return true;
    if (await this._sendViaNativeSetter(text)) return true;
    if (await this._sendViaExecCommand(text)) return true;
    if (await this._sendViaClipboard(text)) return true;

    this._log('❌ 전송 실패');
    return false;
  }

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

  /**
   * 폼 제출 -- 코코포리아 컨티인(@효과음) 지원을 위해
   * React onKeyDown(Enter) → 네이티브 Enter 이벤트 → 버튼 클릭 순으로 시도.
   * 컨틴인은 Enter 키로 전송할 때만 작동하므로 Enter를 최우선.
   */
  async _submitForm() {
    const el = this.chatInput;

    // A) React onKeyDown(Enter) — 컨틴인 지원됨
    try {
      const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      if (pk && el[pk]?.onKeyDown) {
        this._log('전송: React onKeyDown(Enter)');
        const prevented = { value: false };
        el[pk].onKeyDown({
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
          target: el, currentTarget: el,
          preventDefault() { prevented.value = true; },
          stopPropagation() {},
          nativeEvent: new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }),
          persist() {},
          isDefaultPrevented() { return prevented.value; }
        });
        await this._delay(200);

        // Enter 후 입력란이 비어졌으면 성공
        if (!el.value || el.value.trim() === '') return true;
        // 비어지지 않았으면 다음 방법 시도
      }
    } catch (e) {
      this._log(`React Enter 오류: ${e.message}`);
    }

    // B) 네이티브 KeyboardEvent Enter
    this._log('전송: 네이티브 Enter');
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      }));
    }
    await this._delay(200);
    if (!el.value || el.value.trim() === '') return true;

    // C) 전송 버튼 (컨티인 미지원 펴백)
    if (this.sendButton && this._isVisible(this.sendButton)) {
      this._log('전송: 버튼 클릭 (펴백)');
      this.sendButton.click();
      await this._delay(200);
      return true;
    }

    // D) form submit (최후 수단)
    if (this.chatForm) {
      try { this.chatForm.requestSubmit(); await this._delay(200); return true; } catch (e) {}
    }

    return true;
  }

  _setNativeValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc?.set) { desc.set.call(el, text); return; }
    }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = text;
    else el.textContent = text;
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  _asArray(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
  _log(msg) {
    console.log(`%c[BWBR Chat]%c ${msg}`, 'color: #4a7cff; font-weight: bold;', 'color: inherit;');
  }
};
