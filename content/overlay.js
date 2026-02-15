// ============================================================
// Branch World Battle Roll - 오버레이 패널
// 코코포리아 페이지 위에 전투 상태를 표시하는 플로팅 UI
// ============================================================

window.BattleRollOverlay = class BattleRollOverlay {
  constructor(config) {
    this.config = config || window.BWBR_DEFAULTS;
    this.element = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.isMinimized = false;
    this._build();
  }

  /** 설정 업데이트 */
  updateConfig(config) {
    this.config = config;
  }

  // ── UI 구축 ──────────────────────────────────────────────

  _build() {
    // 기존 오버레이 제거
    const existing = document.getElementById('bwbr-overlay');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'bwbr-overlay';
    el.classList.add('hidden');
    el.innerHTML = `
      <div id="bwbr-header">
        <div class="bwbr-title">
          <span class="bwbr-icon">⚔️</span>
          <span>가지세계 도우미</span>
        </div>
        <div class="bwbr-controls">
          <button id="bwbr-btn-minimize" title="최소화">─</button>
          <button id="bwbr-btn-cancel" title="전투 중지">✕</button>
        </div>
      </div>
      <div id="bwbr-status">
        <div class="bwbr-dot idle" id="bwbr-dot"></div>
        <span id="bwbr-status-text">대기 중</span>
      </div>
      <div id="bwbr-body">
        <div class="bwbr-no-combat">
          <div>진행 중인 전투가 없습니다</div>
          <div class="bwbr-trigger-hint">
            트리거: 《합 개시》| ⚔️ 이름 - N/N/N | 🛡️ 이름 - N/N/N
          </div>
        </div>
      </div>
      <div id="bwbr-log"></div>
    `;

    document.body.appendChild(el);
    this.element = el;

    this._bindEvents();
  }

  _bindEvents() {
    // 드래그 이동
    const header = this.element.querySelector('#bwbr-header');
    header.addEventListener('mousedown', (e) => this._onDragStart(e));
    document.addEventListener('mousemove', (e) => this._onDragMove(e));
    document.addEventListener('mouseup', () => this._onDragEnd());

    // 최소화 버튼
    const btnMin = this.element.querySelector('#bwbr-btn-minimize');
    btnMin.addEventListener('click', () => this.toggleMinimize());

    // 전투 중지 버튼
    const btnCancel = this.element.querySelector('#bwbr-btn-cancel');
    btnCancel.addEventListener('click', () => {
      if (this.onCancelCallback) this.onCancelCallback();
    });
  }

  // ── 드래그 ───────────────────────────────────────────────

  _onDragStart(e) {
    if (e.target.tagName === 'BUTTON') return;
    this.isDragging = true;
    const rect = this.element.getBoundingClientRect();
    this.dragOffset.x = e.clientX - rect.left;
    this.dragOffset.y = e.clientY - rect.top;
    this.element.style.transition = 'none';
  }

  _onDragMove(e) {
    if (!this.isDragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 50, e.clientX - this.dragOffset.x));
    const y = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - this.dragOffset.y));
    this.element.style.left = x + 'px';
    this.element.style.top = y + 'px';
    this.element.style.right = 'auto';
  }

  _onDragEnd() {
    if (this.isDragging) {
      this.isDragging = false;
      this.element.style.transition = '';
    }
  }

  // ── 표시/숨김 ────────────────────────────────────────────

  show() {
    if (this.element) this.element.classList.remove('hidden');
  }

  hide() {
    if (this.element) this.element.classList.add('hidden');
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    if (this.element) {
      this.element.classList.toggle('minimized', this.isMinimized);
      const btn = this.element.querySelector('#bwbr-btn-minimize');
      if (btn) btn.textContent = this.isMinimized ? '□' : '─';
    }
  }

  /** 오버레이 제거 */
  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  // ── 상태 업데이트 ────────────────────────────────────────

  /**
   * 전투 상태에 따라 오버레이를 업데이트합니다.
   * @param {string} status - 'idle' | 'active' | 'waiting' | 'error' | 'disabled'
   * @param {string} statusText - 상태 텍스트
   */
  setStatus(status, statusText) {
    const dot = this.element?.querySelector('#bwbr-dot');
    const text = this.element?.querySelector('#bwbr-status-text');
    if (dot) {
      dot.className = 'bwbr-dot ' + status;
    }
    if (text) {
      text.textContent = statusText || status;
    }
  }

  /**
   * 전투 정보를 업데이트합니다.
   * @param {object} state - BattleRollEngine.getState() 결과
   */
  updateCombatState(state) {
    const body = this.element?.querySelector('#bwbr-body');
    if (!body) return;

    if (!state.combat) {
      body.innerHTML = `
        <div class="bwbr-no-combat">
          <div>진행 중인 전투가 없습니다</div>
          <div class="bwbr-trigger-hint">
            트리거: 《합 개시》| ⚔️ 이름 - N/N/N | 🛡️ 이름 - N/N/N
          </div>
        </div>
      `;
      return;
    }

    const atk = state.combat.attacker;
    const def = state.combat.defender;

    body.innerHTML = `
      <div class="bwbr-round-info">제 ${state.round}합</div>
      <div class="bwbr-combatants">
        <div class="bwbr-combatant">
          <div class="bwbr-role">⚔️</div>
          <div class="bwbr-name" title="${this._esc(atk.name)}">${this._esc(atk.name)}</div>
          <div class="bwbr-dice-count">${atk.dice}</div>
          <div class="bwbr-stats">대성공 ${atk.critThreshold}+ / 대실패 ${atk.fumbleThreshold}-</div>
        </div>
        <div class="bwbr-vs">VS</div>
        <div class="bwbr-combatant">
          <div class="bwbr-role">🛡️</div>
          <div class="bwbr-name" title="${this._esc(def.name)}">${this._esc(def.name)}</div>
          <div class="bwbr-dice-count">${def.dice}</div>
          <div class="bwbr-stats">대성공 ${def.critThreshold}+ / 대실패 ${def.fumbleThreshold}-</div>
        </div>
      </div>
    `;
  }

  // ── 로그 ─────────────────────────────────────────────────

  /**
   * 로그 항목을 추가합니다.
   * @param {string} message - 로그 메시지
   * @param {string} type - 'info' | 'success' | 'warning' | 'error' | 'crit' | 'fumble'
   */
  addLog(message, type = 'info') {
    const log = this.element?.querySelector('#bwbr-log');
    if (!log) return;

    const entry = document.createElement('div');
    entry.className = `bwbr-log-entry bwbr-log-${type}`;
    entry.textContent = message;
    log.appendChild(entry);

    // 자동 스크롤
    log.scrollTop = log.scrollHeight;

    // 최대 로그 수 제한
    while (log.children.length > 50) {
      log.removeChild(log.firstChild);
    }
  }

  /** 로그 초기화 */
  clearLog() {
    const log = this.element?.querySelector('#bwbr-log');
    if (log) log.innerHTML = '';
  }

  // ── 콜백 ────────────────────────────────────────────────

  /** 전투 중지 콜백 등록 */
  onCancel(callback) {
    this.onCancelCallback = callback;
  }

  // ── 유틸리티 ─────────────────────────────────────────────

  /** HTML 이스케이프 */
  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
