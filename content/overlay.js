// ============================================================
// Branch World Battle Roll - 임베디드 전투 패널
// 코코포리아 채팅 패널 헤더 아래에 삽입되는 전투 UI
// ============================================================

window.BattleRollOverlay = class BattleRollOverlay {
  constructor(config) {
    this.config = config || window.BWBR_DEFAULTS;
    this.element = null;
    this.isCollapsed = true;
    this.onCancelCallback = null;
    this._manualInputResolve = null;
    this._injected = false;
    this._retryTimer = null;
    this._inject();
  }

  updateConfig(config) {
    this.config = config;
  }

  // ── DOM 삽입 ──────────────────────────────────────────

  _inject() {
    // 코코포리아 Drawer 찾기
    const drawer = this._findDrawer();
    if (!drawer) {
      this._retryTimer = setTimeout(() => this._inject(), 2000);
      return;
    }

    // Drawer 안의 header (룸 채팅) 찾기
    const header = drawer.querySelector('header.MuiAppBar-root');
    if (!header) {
      this._retryTimer = setTimeout(() => this._inject(), 2000);
      return;
    }

    // 기존 패널 제거
    const existing = document.getElementById('bwbr-panel');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'bwbr-panel';
    el.innerHTML = `
      <div id="bwbr-toggle">
        <div class="bwbr-toggle-left">
          <span class="bwbr-toggle-icon">⚔️</span>
          <span class="bwbr-toggle-title">가지세계 도우미</span>
          <span class="bwbr-dot idle" id="bwbr-dot"></span>
          <span class="bwbr-status-text" id="bwbr-status-text">대기 중</span>
        </div>
        <button id="bwbr-btn-expand" type="button">▼</button>
      </div>
      <div id="bwbr-body" class="bwbr-collapsed">
        <div id="bwbr-combat-info">
          <div class="bwbr-fighters">
            <div class="bwbr-fighter">
              <span class="bwbr-fighter-icon">⚔️</span>
              <span class="bwbr-fighter-name bwbr-empty">공격자</span>
              <span class="bwbr-fighter-dice">-</span>
            </div>
            <span class="bwbr-vs">VS</span>
            <div class="bwbr-fighter">
              <span class="bwbr-fighter-icon">🛡️</span>
              <span class="bwbr-fighter-name bwbr-empty">방어자</span>
              <span class="bwbr-fighter-dice">-</span>
            </div>
          </div>
        </div>
        <div id="bwbr-manual-input" style="display:none">
          <div class="bwbr-manual-label" id="bwbr-manual-label">결과를 입력하세요</div>
          <div class="bwbr-manual-row">
            <input type="number" id="bwbr-manual-value" min="1" max="20" placeholder="1~20">
            <button type="button" id="bwbr-manual-submit">확인</button>
          </div>
        </div>
        <div id="bwbr-actions" style="display:none">
          <button type="button" id="bwbr-btn-cancel">전투 중지</button>
        </div>
        <div id="bwbr-log"></div>
      </div>
    `;

    // header 바로 뒤에 삽입
    header.insertAdjacentElement('afterend', el);
    this.element = el;
    this._injected = true;
    this._bindEvents();
  }

  _findDrawer() {
    return document.querySelector('.MuiDrawer-paperAnchorDockedRight')
      || document.querySelector('.MuiDrawer-paper');
  }

  _bindEvents() {
    // 토글 바 클릭 → 접기/펼치기
    const toggleBar = this.element.querySelector('#bwbr-toggle');
    toggleBar.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') this.toggleCollapse();
    });

    const btnExpand = this.element.querySelector('#bwbr-btn-expand');
    btnExpand.addEventListener('click', () => this.toggleCollapse());

    // 전투 중지 버튼
    const btnCancel = this.element.querySelector('#bwbr-btn-cancel');
    btnCancel.addEventListener('click', () => {
      if (this.onCancelCallback) this.onCancelCallback();
    });

    // 수동 입력 확인 버튼
    const btnSubmit = this.element.querySelector('#bwbr-manual-submit');
    btnSubmit.addEventListener('click', () => this._submitManualInput());

    // 수동 입력 Enter 키 (코코포리아 채팅의 Enter와 충돌 방지)
    const inputEl = this.element.querySelector('#bwbr-manual-value');
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this._submitManualInput();
      }
    });
  }

  // ── 접기/펼치기 ───────────────────────────────────────

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    const body = this.element?.querySelector('#bwbr-body');
    const btn = this.element?.querySelector('#bwbr-btn-expand');
    if (body) body.classList.toggle('bwbr-collapsed', this.isCollapsed);
    if (btn) btn.textContent = this.isCollapsed ? '▼' : '▲';
  }

  /** 전투 시작 시 자동 펼치기 */
  show() {
    if (this.isCollapsed) this.toggleCollapse();
  }

  /** 전투 없을 때 접기 */
  hide() {
    if (!this.isCollapsed) this.toggleCollapse();
  }

  toggleMinimize() {
    this.toggleCollapse();
  }

  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    if (this._retryTimer) clearTimeout(this._retryTimer);
  }

  /** DOM 분리 감지 시 재삽입 */
  ensureInjected() {
    if (this.element && this.element.isConnected) return;
    this._inject();
  }

  // ── 상태 업데이트 ────────────────────────────────────

  setStatus(status, statusText) {
    this.ensureInjected();
    const dot = this.element?.querySelector('#bwbr-dot');
    const text = this.element?.querySelector('#bwbr-status-text');
    if (dot) dot.className = 'bwbr-dot ' + status;
    if (text) text.textContent = statusText || status;

    // 전투 중일 때만 중지 버튼 표시
    const actions = this.element?.querySelector('#bwbr-actions');
    if (actions) {
      actions.style.display = (status === 'active' || status === 'waiting') ? '' : 'none';
    }
  }

  updateCombatState(state) {
    this.ensureInjected();
    const info = this.element?.querySelector('#bwbr-combat-info');
    if (!info) return;

    if (!state.combat) {
      info.innerHTML = `
        <div class="bwbr-fighters">
          <div class="bwbr-fighter">
            <span class="bwbr-fighter-icon">⚔️</span>
            <span class="bwbr-fighter-name bwbr-empty">공격자</span>
            <span class="bwbr-fighter-dice">-</span>
          </div>
          <span class="bwbr-vs">VS</span>
          <div class="bwbr-fighter">
            <span class="bwbr-fighter-icon">🛡️</span>
            <span class="bwbr-fighter-name bwbr-empty">방어자</span>
            <span class="bwbr-fighter-dice">-</span>
          </div>
        </div>`;
      return;
    }

    const atk = state.combat.attacker;
    const def = state.combat.defender;

    info.innerHTML = `
      <div class="bwbr-round-badge">제 ${state.round}합</div>
      <div class="bwbr-fighters">
        <div class="bwbr-fighter">
          <span class="bwbr-fighter-icon">⚔️</span>
          <span class="bwbr-fighter-name" title="${this._esc(atk.name)}">${this._esc(atk.name)}</span>
          <span class="bwbr-fighter-dice">${atk.dice}</span>
          <span class="bwbr-fighter-thresholds">${atk.critThreshold}+ / ${atk.fumbleThreshold}-</span>
        </div>
        <span class="bwbr-vs">VS</span>
        <div class="bwbr-fighter">
          <span class="bwbr-fighter-icon">🛡️</span>
          <span class="bwbr-fighter-name" title="${this._esc(def.name)}">${this._esc(def.name)}</span>
          <span class="bwbr-fighter-dice">${def.dice}</span>
          <span class="bwbr-fighter-thresholds">${def.critThreshold}+ / ${def.fumbleThreshold}-</span>
        </div>
      </div>
    `;
  }

  // ── 수동 입력 ─────────────────────────────────────────

  /**
   * 수동 입력 UI를 표시하고, 사용자가 값을 입력할 때까지 대기합니다.
   * @param {string} who - '공격자' | '방어자'
   * @param {string} emoji - '⚔️' | '🛡️'
   * @param {string} playerName - 캐릭터 이름
   * @returns {Promise<number|null>} 입력된 값 또는 취소시 null
   */
  showManualInput(who, emoji, playerName) {
    this.ensureInjected();
    // 자동 펼치기
    if (this.isCollapsed) this.toggleCollapse();

    const container = this.element?.querySelector('#bwbr-manual-input');
    const label = this.element?.querySelector('#bwbr-manual-label');
    const input = this.element?.querySelector('#bwbr-manual-value');
    if (!container || !label || !input) return Promise.resolve(null);

    const maxVal = this.config.rules?.diceType || 20;
    label.textContent = `${emoji} ${playerName} 주사위 결과를 입력하세요 (1~${maxVal})`;
    input.value = '';
    input.max = maxVal;
    container.style.display = '';
    input.focus();

    return new Promise((resolve) => {
      this._manualInputResolve = resolve;
    });
  }

  /** 수동 입력 UI 숨김 (채팅에서 결과가 먼저 인식된 경우) */
  hideManualInput() {
    const container = this.element?.querySelector('#bwbr-manual-input');
    if (container) container.style.display = 'none';

    // 대기 중인 Promise 취소 (null 반환)
    if (this._manualInputResolve) {
      this._manualInputResolve(null);
      this._manualInputResolve = null;
    }
  }

  /** 수동 입력 값 제출 */
  _submitManualInput() {
    const input = this.element?.querySelector('#bwbr-manual-value');
    if (!input) return;

    const val = parseInt(input.value, 10);
    const max = this.config.rules?.diceType || 20;
    if (isNaN(val) || val < 1 || val > max) {
      input.classList.add('bwbr-input-error');
      setTimeout(() => input.classList.remove('bwbr-input-error'), 500);
      return;
    }

    const container = this.element?.querySelector('#bwbr-manual-input');
    if (container) container.style.display = 'none';

    if (this._manualInputResolve) {
      this._manualInputResolve(val);
      this._manualInputResolve = null;
    }
  }

  // ── 로그 ──────────────────────────────────────────────

  addLog(message, type = 'info') {
    this.ensureInjected();
    const log = this.element?.querySelector('#bwbr-log');
    if (!log) return;

    const entry = document.createElement('div');
    entry.className = `bwbr-log-entry bwbr-log-${type}`;
    entry.textContent = message;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;

    while (log.children.length > 50) {
      log.removeChild(log.firstChild);
    }
  }

  clearLog() {
    const log = this.element?.querySelector('#bwbr-log');
    if (log) log.innerHTML = '';
  }

  // ── 콜백 ──────────────────────────────────────────────

  onCancel(callback) {
    this.onCancelCallback = callback;
  }

  // ── 유틸리티 ──────────────────────────────────────────

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
