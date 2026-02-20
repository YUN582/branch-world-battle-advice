// ============================================================
// Branch World Battle Roll - 코코포리아 채팅 인터페이스 v8
//
// === 핵심 설계 (Redux 기반) ===
// 1) Redux store.subscribe()로 roomMessages 변화를 실시간 감지
// 2) 탭 전환, DOM 갱신에 영향받지 않아 100% 메시지 감지율
// 3) 페이지 컨텍스트(redux-injector.js)에서 CustomEvent로 전달
//
// === 메시지 전송 ===
// 텍스트 메시지 → Firestore 직접 전송 (유저 입력 차단 없음)
// 주사위 명령    → React fiber + form submit (코코포리아 주사위 처리)
// Firestore 실패 → textarea 자동 폴백
//
// === 유지되는 DOM 기능 ===
// hookInputSubmit — Enter 키 감지 (사용자 입력)
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

  // ================================================================
  //  Redux 기반 채팅 관찰  ──  store.subscribe() → CustomEvent
  // ================================================================

  /**
   * Redux Store의 roomMessages를 구독하여 새 메시지를 실시간으로 감지합니다.
   * DOM 기반 observeChat()과 달리 탭 전환, DOM 갱신에 영향을 받지 않습니다.
   *
   * 페이지 컨텍스트(redux-injector.js)에서 store.subscribe()로 감지 후
   * CustomEvent('bwbr-new-chat-message')로 전달받습니다.
   *
   * @param {function} callback - 새 메시지 텍스트를 전달받는 콜백 (text, null)
   */
  observeReduxMessages(callback) {
    this.messageCallback = callback;
    this._reduxReady = false;

    // 기존 DOM 관찰 중지 (혹시 실행 중이면)
    this.stopObserving();

    // Redux 메시지 이벤트 수신 핸들러
    this._reduxMessageHandler = (e) => {
      if (!this._reduxReady) return;
      const detail = e.detail;
      if (!detail?.text) return;

      const text = detail.text.trim();
      if (text.length < 2) return;

      // 자체 전송 메시지 필터링
      if (this._isOwnMessage(text)) {
        this._log(`  [자체 Redux] "${text.substring(0, 40)}"`);
        return;
      }

      this._log(`\ud83d\udce8 [Redux] "${text.substring(0, 100)}" (${detail.name || '?'})`);

      if (this.messageCallback) {
        try {
          this.messageCallback(text, null, detail.name || '');
        } catch (err) {
          console.error('[BWBR Chat]', err);
        }
      }
    };

    window.addEventListener('bwbr-new-chat-message', this._reduxMessageHandler);

    // 페이지 컨텍스트에 메시지 관찰 시작 요청 + 재시도
    let retries = 0;
    const maxRetries = 5;

    const requestStart = () => {
      window.dispatchEvent(new CustomEvent('bwbr-start-message-observer'));
    };

    const statusHandler = (e) => {
      if (e.detail?.active) {
        window.removeEventListener('bwbr-message-observer-status', statusHandler);
        this._log('✅ Redux 메시지 관찰자 활성화 확인');
      } else if (retries < maxRetries) {
        retries++;
        this._log(`⚠️ 관찰자 활성화 실패 → 재시도 ${retries}/${maxRetries}`);
        setTimeout(requestStart, 1000);
      } else {
        window.removeEventListener('bwbr-message-observer-status', statusHandler);
        this._log('❌ Redux 메시지 관찰자 활성화 최종 실패');
      }
    };

    window.addEventListener('bwbr-message-observer-status', statusHandler);
    requestStart();

    // 2초 유예 후 활성화 (초기 메시지 무시 — 기존 observeChat과 동일)
    setTimeout(() => {
      this._reduxReady = true;
      this._log('✅ Redux 메시지 수신 활성화');
    }, 2000);

    this._log('Redux 메시지 관찰 준비 중 (2초 유예)...');
    return true;
  }

  /**
   * Redux 기반 채팅 관찰을 중지합니다.
   */
  stopReduxObserving() {
    if (this._reduxMessageHandler) {
      window.removeEventListener('bwbr-new-chat-message', this._reduxMessageHandler);
      this._reduxMessageHandler = null;
    }
    this._reduxReady = false;
    window.dispatchEvent(new CustomEvent('bwbr-stop-message-observer'));
    this._log('Redux 메시지 관찰 중지');
  }

  // ================================================================
  //  입력 감지 훅  ──  사용자 Enter 눌림 감지
  // ================================================================

  /**
   * 채팅 입력창에서 사용자가 Enter를 눌러 메시지를 전송할 때 콜백을 호출합니다.
   * document 레벨 이벤트 위임을 사용하므로 textarea가 React에 의해 교체되어도 작동합니다.
   * @param {function} callback - 입력 텍스트를 전달받는 콜백
   */
  hookInputSubmit(callback) {
    this._inputSubmitCallback = callback;
    if (this._inputHooked) return true;

    let composing = false;

    document.addEventListener('compositionstart', (e) => {
      if (this._isChatInput(e.target)) composing = true;
    }, true);

    document.addEventListener('compositionend', (e) => {
      if (this._isChatInput(e.target)) composing = false;
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || composing || e.isComposing) return;
      if (!this._isChatInput(e.target)) return;

      const text = e.target.value?.trim();
      if (text && this._inputSubmitCallback) {
        this._log(`🔑 입력 감지: "${text.substring(0, 80)}"`);
        this._inputSubmitCallback(text);
      }
    }, true); // capture phase

    this._inputHooked = true;
    this._log('✅ 입력 훅 설정 완료');
    return true;
  }

  /** 대상이 코코포리아 채팅 입력창인지 확인 */
  _isChatInput(el) {
    if (!el || el.tagName !== 'TEXTAREA') return false;
    return el.name === 'text' || el === this.chatInput;
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

    // 컨테이너가 DOM에서 분리됐으면 재탐색 (React 리렌더 대응)
    if (!this.chatContainer.isConnected) {
      this._log('⚠️ 컨테이너 DOM 분리 감지 → 재탐색');
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (!this.findElements() || !this.chatContainer) {
        return; // 다음 폴링에서 재시도
      }
      // 새 컨테이너의 기존 메시지 등록
      const reconnTexts = this._collectAllTexts();
      for (const t of reconnTexts) this._seenTexts.add(t);
      // Observer 재설정
      this.observer = new MutationObserver(() => {
        if (!this._ready) return;
        this._debouncedPoll();
      });
      this.observer.observe(this.chatContainer, { childList: true, subtree: true });
      this._log(`✅ DOM 재연결 성공 (${reconnTexts.length}개 메시지 등록)`);
      return;
    }

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
  //  메시지 전송  ──  Firestore 직접 전송 + React fiber 폴백
  //
  //  ★ 주사위 명령 (1D20 등) → textarea 경유 (코코포리아 주사위 처리 필요)
  //  ★ 텍스트 메시지        → Firestore 직접 전송 (유저 입력 차단 없음)
  //                            실패 시 textarea 폴백
  // ================================================================

  async sendMessage(text) {
    // 주사위 명령이 아닌 경우에만 자체 메시지로 등록
    // (주사위 결과 메시지가 substring 매칭으로 필터링되는 것을 방지)
    if (!/^\d+[dD]\d+/.test(text)) {
      this._lastSentMessages.push({ text, time: Date.now() });
    }
    // 전송할 메시지를 미리 seen에 등록 (돌아왔을 때 무시)
    this._seenTexts.add(text);

    // ★ 주사위 명령은 반드시 textarea 경유 (코코포리아가 주사위를 처리해야 함)
    if (/^\d+[dD]\d+/.test(text.trim())) {
      this._log(`📤 전송(주사위): "${text.substring(0, 60)}"`);
      return this._sendViaTextarea(text);
    }

    // ★ 텍스트 메시지 → Firestore 직접 전송 시도
    this._log(`📤 전송(직접): "${text.substring(0, 60)}"`);
    const directResult = await this._sendViaFirestoreDirect(text);
    if (directResult) return true;

    // Firestore 실패 → textarea 폴백
    this._log('⚠️ Firestore 직접 전송 실패 → textarea 폴백');
    return this._sendViaTextarea(text);
  }

  /**
   * Firestore에 직접 메시지를 작성합니다.
   * 페이지 컨텍스트(redux-injector.js)에 CustomEvent로 요청 → 결과 수신.
   * 유저의 textarea 입력을 전혀 건드리지 않습니다.
   */
  _sendViaFirestoreDirect(text) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('bwbr-send-message-result', handler);
        this._log('⏱️ Firestore 직접 전송 타임아웃');
        resolve(false);
      }, 5000);

      const handler = (e) => {
        if (e.detail?.text !== text) return;  // 다른 메시지의 결과 무시
        clearTimeout(timeout);
        window.removeEventListener('bwbr-send-message-result', handler);
        if (e.detail.success) {
          this._log('✅ Firestore 직접 전송 성공');
        } else {
          this._log(`⚠️ Firestore 직접 전송 실패: ${e.detail.error || 'unknown'}`);
        }
        resolve(!!e.detail.success);
      };

      window.addEventListener('bwbr-send-message-result', handler);

      // ★ ISOLATED→MAIN에서는 CustomEvent.detail이 전달되지 않으므로
      //    DOM attribute를 통해 텍스트를 전달합니다.
      document.documentElement.setAttribute('data-bwbr-send-text', text);
      window.dispatchEvent(new Event('bwbr-send-message-direct'));
    });
  }

  /**
   * textarea + React fiber를 통한 메시지 전송 (기존 방식).
   * 주사위 명령 또는 Firestore 실패 시 폴백으로 사용됩니다.
   */
  async _sendViaTextarea(text) {
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

    this._log(`📤 전송(textarea): "${text.substring(0, 60)}"`);

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
