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

    // 중복 제거 (중첩된 DOM 요소에서 같은 텍스트가 여러 번 수집될 수 있음)
    const dedupSet = new Set();
    const uniqueUnseen = [];
    for (const msg of unseenMessages) {
      if (!dedupSet.has(msg.text)) {
        dedupSet.add(msg.text);
        uniqueUnseen.push(msg);
      }
    }

    // 탭 전환 감지: 보이는 메시지의 70% 이상이 unseen이면 탭 전환
    const unseenRatio = uniqueUnseen.length / current.length;
    if (current.length >= 3 && unseenRatio > 0.7) {
      this._log(`⚠️ 탭 전환 감지 (${uniqueUnseen.length}/${current.length} = ${Math.round(unseenRatio*100)}% unseen) → 무시`);
      return;
    }

    // 대량 신규(8개+) → 로드/탭전환
    if (uniqueUnseen.length > 8) {
      this._log(`⚠️ 대량 신규(${uniqueUnseen.length}개) → 무시`);
      return;
    }

    // 새 메시지 처리
    this._log(`📨 새 메시지 ${uniqueUnseen.length}개`);

    for (const { text } of uniqueUnseen) {
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
      '1[Dd]20.*?[→＞>=]+\\s*(\\d+)',
      '\\(1[Dd]20\\).*?[→＞>=]+\\s*(\\d+)',
      '결과[:\\s]*(\\d+)',
      '[→＞>]\\s*(\\d+)\\s*$',
      ':\\s*(\\d{1,2})\\s*$'
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
  //  메시지 전송  ──  수동/자동 모드 지원
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

    // 주사위 명령이 아닌 경우에만 자체 메시지로 등록
    if (!/^\d+[dD]\d+/.test(text)) {
      this._lastSentMessages.push({ text, time: Date.now() });
    }
    this._seenTexts.add(text);

    // ── 수동 모드: 텍스트를 채우고 사용자 Enter 대기 ──
    if (this.config.general.manualSend) {
      return await this._sendManual(text);
    }

    // ── 자동 모드: 기존 방식 ──
    this._log(`📤 자동 전송: "${text.substring(0, 60)}"`);
    if (await this._sendViaReactFiber(text)) return true;
    if (await this._sendViaNativeSetter(text)) return true;
    if (await this._sendViaExecCommand(text)) return true;
    if (await this._sendViaClipboard(text)) return true;
    this._log('❌ 전송 실패');
    return false;
  }

  /**
   * 수동 전송 모드: 입력창에 텍스트를 채우고 사용자가 Enter키를 누를 때까지 대기
   * 사용자가 직접 Enter를 누르므로 isTrusted=true → @효과음 작동
   */
  async _sendManual(text) {
    this._log(`✍️ 수동모드: 입력창에 채움 → Enter 대기: "${text.substring(0, 60)}"`);

    // 입력창에 텍스트 채우기 (React onChange)
    const filled = await this._fillText(text);
    if (!filled) {
      this._log('❌ 텍스트 채우기 실패');
      return false;
    }

    // 사용자가 Enter를 누를 때까지 대기 (입력창이 비어지면 전송된 것)
    return await this._waitForSend(60000); // 최대 60초 대기
  }

  /**
   * React onChange로 입력창에 텍스트를 채움 (전송은 하지 않음)
   */
  async _fillText(text) {
    const el = this.chatInput;
    el.focus();
    await this._delay(50);

    // React onChange 시도
    const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
    if (propsKey && el[propsKey]?.onChange) {
      this._setNativeValue(el, text);
      el[propsKey].onChange({
        target: el, currentTarget: el, type: 'change',
        preventDefault() {}, stopPropagation() {},
        nativeEvent: new Event('change'), persist() {}
      });
      await this._delay(200);
      if (el.value === text) return true;

      // 재시도
      this._setNativeValue(el, text);
      el[propsKey].onChange({
        target: el, currentTarget: el, type: 'change',
        preventDefault() {}, stopPropagation() {},
        nativeEvent: new Event('change'), persist() {}
      });
      await this._delay(200);
      if (el.value === text) return true;
    }

    // nativeInputValueSetter 폴백
    this._setNativeValue(el, text);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await this._delay(200);
    return el.value === text || el.value.includes(text.substring(0, 10));
  }

  /**
   * 입력창이 비어질 때까지 대기 (사용자가 Enter를 누른 것으로 판단)
   */
  async _waitForSend(maxWait = 60000) {
    const el = this.chatInput;
    const start = Date.now();

    // 오버레이 상태 업데이트 콜백 (대기 중 표시 용)
    if (this._onWaitingForEnter) this._onWaitingForEnter(true);

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - start;

        // 입력창이 비어졌으면 전송 완료
        if (!el.value || el.value.trim() === '') {
          clearInterval(checkInterval);
          this._log('✅ 사용자 Enter 감지 → 전송 완료');
          if (this._onWaitingForEnter) this._onWaitingForEnter(false);
          resolve(true);
          return;
        }

        // 타임아웃
        if (elapsed >= maxWait) {
          clearInterval(checkInterval);
          this._log('⚠️ Enter 대기 타임아웃');
          if (this._onWaitingForEnter) this._onWaitingForEnter(false);
          resolve(false);
          return;
        }
      }, 100); // 100ms 간격으로 확인
    });
  }

  /** 대기 상태 콜백 등록 (오버레이에서 사용) */
  onWaitingForEnter(callback) {
    this._onWaitingForEnter = callback;
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
      await this._delay(400);

      if (el.value !== text) {
        this._setNativeValue(el, text);
        el[propsKey].onChange({
          target: el, currentTarget: el, type: 'change',
          preventDefault() {}, stopPropagation() {},
          nativeEvent: new Event('change'), persist() {}
        });
        await this._delay(200);
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
   * 폼 제출
   * 네이티브 Enter → form submit 이벤트 → React fiber Enter → 버튼 클릭 순서.
   * 네이티브 Enter가 React 이벤트 위임을 통해 코코포리아 @효과음을 트리거합니다.
   */
  async _submitForm() {
    const el = this.chatInput;
    el.focus();
    await this._delay(30);

    // A) 네이티브 Enter — React 이벤트 위임으로 @효과음 지원
    this._log('전송(A): 네이티브 Enter (이벤트 위임)');
    const enterOpts = {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true, view: window
    };
    el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    await this._delay(50);
    el.dispatchEvent(new KeyboardEvent('keypress', { ...enterOpts, charCode: 13 }));
    el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    await this._delay(400);
    if (!el.value || el.value.trim() === '') {
      this._log('✅ 전송 성공 (A: 네이티브 Enter)');
      return true;
    }

    // B) form submit 이벤트 — React onSubmit 트리거
    if (this.chatForm) {
      this._log('전송(B): form submit 이벤트');
      this.chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await this._delay(300);
      if (!el.value || el.value.trim() === '') {
        this._log('✅ 전송 성공 (B: form submit)');
        return true;
      }
    }

    // C) React fiber Enter 전파 — 직접 핸들러 호출
    try {
      const fiberKey = Object.keys(el).find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (fiberKey) {
        this._log('전송(C): React fiber Enter 전파');
        const enterEvent = {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          charCode: 13, shiftKey: false, ctrlKey: false, altKey: false,
          metaKey: false, isComposing: false,
          target: el, currentTarget: el, type: 'keydown',
          bubbles: true, cancelable: true,
          isDefaultPrevented: () => false,
          isPropagationStopped: () => false,
          preventDefault() {}, stopPropagation() {},
          nativeEvent: new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true
          }),
          persist() {}
        };
        let fiber = el[fiberKey];
        let depth = 0;
        while (fiber && depth < 30) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (props?.onKeyDown) {
            try { props.onKeyDown(enterEvent); } catch (e) {}
          }
          fiber = fiber.return;
          depth++;
        }
        await this._delay(400);
        if (!el.value || el.value.trim() === '') {
          this._log('✅ 전송 성공 (C: fiber Enter)');
          return true;
        }
      }
    } catch (e) {
      this._log(`React fiber Enter 오류: ${e.message}`);
    }

    // D) 전송 버튼
    if (this.sendButton && this._isVisible(this.sendButton)) {
      this._log('전송(D): 버튼 클릭');
      this.sendButton.click();
      await this._delay(200);
      return true;
    }

    // E) form.requestSubmit()
    if (this.chatForm) {
      try {
        this._log('전송(E): form.requestSubmit()');
        this.chatForm.requestSubmit();
        await this._delay(200);
        return true;
      } catch (e) {}
    }

    this._log('⚠️ 모든 전송 방법 실패');
    return false;
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
