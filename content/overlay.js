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
    this.onPauseCallback = null;
    this._manualInputResolve = null;
    this._injected = false;
    this._retryTimer = null;
    this._paused = false;
    this._inject();
  }

  updateConfig(config) {
    this.config = config;
  }

  // ── DOM 삽입 ──────────────────────────────────────────

  _inject() {
    const drawer = this._findDrawer();
    if (!drawer) {
      this._retryTimer = setTimeout(() => this._inject(), 2000);
      return;
    }

    const header = drawer.querySelector('header.MuiAppBar-root');
    if (!header) {
      this._retryTimer = setTimeout(() => this._inject(), 2000);
      return;
    }

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
        <div id="bwbr-actions" style="display:none">
          <button type="button" id="bwbr-btn-pause">⏸ 일시정지</button>
          <button type="button" id="bwbr-btn-cancel">전투 중지</button>
        </div>
        <div id="bwbr-log"></div>
        <div id="bwbr-manual-input" style="display:none">
          <div class="bwbr-manual-label" id="bwbr-manual-label">결과를 입력하세요</div>
          <div class="bwbr-manual-row">
            <input type="number" id="bwbr-manual-value" min="1" max="20" placeholder="1~20">
            <button type="button" id="bwbr-manual-submit">확인</button>
          </div>
        </div>
      </div>
    `;

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
    const toggleBar = this.element.querySelector('#bwbr-toggle');
    toggleBar.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') this.toggleCollapse();
    });

    const btnExpand = this.element.querySelector('#bwbr-btn-expand');
    btnExpand.addEventListener('click', () => this.toggleCollapse());

    const btnPause = this.element.querySelector('#bwbr-btn-pause');
    btnPause.addEventListener('click', () => {
      if (this.onPauseCallback) this.onPauseCallback();
    });

    const btnCancel = this.element.querySelector('#bwbr-btn-cancel');
    btnCancel.addEventListener('click', () => {
      if (this.onCancelCallback) this.onCancelCallback();
    });

    const btnSubmit = this.element.querySelector('#bwbr-manual-submit');
    btnSubmit.addEventListener('click', () => this._submitManualInput());

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

  show() {
    if (this.isCollapsed) this.toggleCollapse();
  }

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

    const actions = this.element?.querySelector('#bwbr-actions');
    if (actions) {
      actions.style.display = (status === 'active' || status === 'waiting' || status === 'paused') ? '' : 'none';
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
        <div class="bwbr-fighter" id="bwbr-atk">
          <span class="bwbr-fighter-icon">⚔️</span>
          <span class="bwbr-fighter-name" title="${this._esc(atk.name)}">${this._esc(atk.name)}</span>
          <span class="bwbr-fighter-dice" id="bwbr-atk-dice">${atk.dice}</span>
          <span class="bwbr-fighter-thresholds">${atk.critThreshold}+ / ${atk.fumbleThreshold}-</span>
        </div>
        <span class="bwbr-vs">VS</span>
        <div class="bwbr-fighter" id="bwbr-def">
          <span class="bwbr-fighter-icon">🛡️</span>
          <span class="bwbr-fighter-name" title="${this._esc(def.name)}">${this._esc(def.name)}</span>
          <span class="bwbr-fighter-dice" id="bwbr-def-dice">${def.dice}</span>
          <span class="bwbr-fighter-thresholds">${def.critThreshold}+ / ${def.fumbleThreshold}-</span>
        </div>
      </div>
    `;
  }

  // ── 전투 애니메이션 ──────────────────────────────────

  /**
   * 충돌(Clash) 애니메이션: 양 파이터가 부딪치고 불꽃 + 충격파 + 화면 진동
   */
  playClash() {
    const fighters = this.element?.querySelector('.bwbr-fighters');
    const combatInfo = this.element?.querySelector('#bwbr-combat-info');
    if (!fighters) return;

    // 불꽃 파티클 (2파 — 시차)
    this._spawnSparks(fighters, 14);
    setTimeout(() => this._spawnSparks(fighters, 8), 150);

    // 충격파 링
    this._spawnImpactWave(fighters);

    // 화면 진동
    if (combatInfo) {
      combatInfo.classList.add('bwbr-anim-screen-shake');
      setTimeout(() => combatInfo.classList.remove('bwbr-anim-screen-shake'), 600);
    }

    fighters.classList.add('bwbr-anim-clash');
    setTimeout(() => fighters.classList.remove('bwbr-anim-clash'), 900);
  }

  /**
   * 불꽃 파티클 생성 (크고 화려)
   * @param {HTMLElement} container - 파티클 부모 요소
   * @param {number} count - 파티클 수 (기본 16)
   */
  _spawnSparks(container, count = 16) {
    const sparksEl = document.createElement('div');
    sparksEl.className = 'bwbr-sparks';
    const colors = ['#ffd54f', '#ff9800', '#fff', '#ff5722', '#ffab00', '#ff6d00', '#ffc107'];

    for (let i = 0; i < count; i++) {
      // 메인 불꽃
      const spark = document.createElement('div');
      spark.className = 'bwbr-spark';
      const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.6;
      const dist = 30 + Math.random() * 55;
      spark.style.setProperty('--sx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--sy', `${Math.sin(angle) * dist}px`);
      const c = colors[Math.floor(Math.random() * colors.length)];
      spark.style.background = c;
      spark.style.color = c;
      spark.style.width = (3 + Math.random() * 5) + 'px';
      spark.style.height = spark.style.width;
      sparksEl.appendChild(spark);

      // 꼬리 트레일 (2개)
      for (let t = 0; t < 2; t++) {
        const trail = document.createElement('div');
        trail.className = 'bwbr-spark-trail';
        const trailDist = dist * (0.4 + Math.random() * 0.3);
        const trailAngle = angle + (Math.random() - 0.5) * 0.4;
        trail.style.setProperty('--sx', `${Math.cos(trailAngle) * trailDist}px`);
        trail.style.setProperty('--sy', `${Math.sin(trailAngle) * trailDist}px`);
        trail.style.background = c;
        trail.style.animationDelay = (0.03 + t * 0.06) + 's';
        sparksEl.appendChild(trail);
      }
    }

    container.style.position = 'relative';
    container.appendChild(sparksEl);
    setTimeout(() => sparksEl.remove(), 1200);
  }

  /**
   * 충격파 링 이펙트
   */
  _spawnImpactWave(container) {
    for (let i = 0; i < 3; i++) {
      const wave = document.createElement('div');
      wave.className = 'bwbr-impact-wave';
      wave.style.animationDelay = (i * 0.12) + 's';
      wave.style.opacity = 1 - i * 0.25;
      container.appendChild(wave);
      setTimeout(() => wave.remove(), 1000);
    }
  }

  /**
   * 대성공(Crit) 효과: 금색 폭발 + 아이콘 바운스 + 배경 플래시
   * @param {string} who - 'attacker' | 'defender'
   */
  playCrit(who) {
    const fighter = this.element?.querySelector(who === 'attacker' ? '#bwbr-atk' : '#bwbr-def');
    const combatInfo = this.element?.querySelector('#bwbr-combat-info');
    const fighters = this.element?.querySelector('.bwbr-fighters');
    if (!fighter) return;

    fighter.classList.add('bwbr-anim-crit');

    // 배경 플래시 (금색)
    if (combatInfo) {
      combatInfo.style.position = 'relative';
      const flash = document.createElement('div');
      flash.className = 'bwbr-flash-crit';
      combatInfo.appendChild(flash);
      setTimeout(() => flash.remove(), 1100);
    }

    // 불꽃 파티클 (2파)
    if (fighters) {
      this._spawnSparks(fighters, 18);
      setTimeout(() => this._spawnSparks(fighters, 10), 200);
    }

    // 화면 진동
    if (combatInfo) {
      combatInfo.classList.add('bwbr-anim-screen-shake');
      setTimeout(() => combatInfo.classList.remove('bwbr-anim-screen-shake'), 600);
    }

    setTimeout(() => fighter.classList.remove('bwbr-anim-crit'), 1500);
  }

  /**
   * 대실패(Fumble) 효과: 빨간 폭발 + 아이콘 드롭 + 진동 + 배경 플래시
   * @param {string} who - 'attacker' | 'defender'
   */
  playFumble(who) {
    const fighter = this.element?.querySelector(who === 'attacker' ? '#bwbr-atk' : '#bwbr-def');
    const combatInfo = this.element?.querySelector('#bwbr-combat-info');
    if (!fighter) return;

    fighter.classList.add('bwbr-anim-fumble');
    fighter.classList.add('bwbr-anim-shake');

    // 배경 플래시 (적색)
    if (combatInfo) {
      combatInfo.style.position = 'relative';
      const flash = document.createElement('div');
      flash.className = 'bwbr-flash-fumble';
      combatInfo.appendChild(flash);
      setTimeout(() => flash.remove(), 1100);

      // 진동
      combatInfo.classList.add('bwbr-anim-screen-shake');
      setTimeout(() => combatInfo.classList.remove('bwbr-anim-screen-shake'), 600);
    }

    setTimeout(() => {
      fighter.classList.remove('bwbr-anim-fumble');
      fighter.classList.remove('bwbr-anim-shake');
    }, 1500);
  }

  /**
   * 승리 효과: 승자 빛남 + 스핀 + 반짝이 + 패자 페이드
   * @param {string} winner - 'attacker' | 'defender'
   */
  playVictory(winner) {
    const winEl = this.element?.querySelector(winner === 'attacker' ? '#bwbr-atk' : '#bwbr-def');
    const loseEl = this.element?.querySelector(winner === 'attacker' ? '#bwbr-def' : '#bwbr-atk');
    const fighters = this.element?.querySelector('.bwbr-fighters');

    if (winEl) {
      winEl.classList.add('bwbr-anim-victory');

      // 불꽃 3파 (시차)
      if (fighters) {
        this._spawnSparks(fighters, 20);
        setTimeout(() => this._spawnSparks(fighters, 14), 300);
        setTimeout(() => this._spawnSparks(fighters, 10), 600);
      }

      // 충격파
      if (fighters) this._spawnImpactWave(fighters);

      // 화면 진동
      const combatInfo = this.element?.querySelector('#bwbr-combat-info');
      if (combatInfo) {
        combatInfo.classList.add('bwbr-anim-screen-shake');
        setTimeout(() => combatInfo.classList.remove('bwbr-anim-screen-shake'), 600);
      }

      setTimeout(() => winEl.classList.remove('bwbr-anim-victory'), 3000);
    }
    if (loseEl) {
      loseEl.classList.add('bwbr-anim-defeat');
      setTimeout(() => loseEl.classList.remove('bwbr-anim-defeat'), 4000);
    }
  }

  /**
   * 주사위 값 업데이트 (숫자 슬롯머신 애니메이션 — 크고 화려)
   * @param {string} who - 'attacker' | 'defender'
   * @param {number} value - 최종 주사위 값
   */
  animateDiceValue(who, value) {
    const diceEl = this.element?.querySelector(who === 'attacker' ? '#bwbr-atk-dice' : '#bwbr-def-dice');
    if (!diceEl) return;

    const max = this.config.rules?.diceType || 20;
    let count = 0;
    const totalFrames = 14;

    // 회전하면서 숫자 바뀜
    diceEl.style.transition = 'none';
    const interval = setInterval(() => {
      count++;
      const randomVal = Math.floor(Math.random() * max) + 1;
      diceEl.textContent = randomVal;

      // 슬롯머신 스타일 바운스
      const scale = 1 + Math.sin(count / totalFrames * Math.PI) * 0.4;
      const rot = (Math.random() - 0.5) * 12;
      diceEl.style.transform = `scale(${scale}) rotate(${rot}deg)`;
      diceEl.style.color = ['#fff', '#ffd54f', '#ff9800', '#e0e0e0'][count % 4];

      if (count >= totalFrames) {
        clearInterval(interval);
        diceEl.textContent = value;
        diceEl.style.transform = 'scale(1.25)';
        diceEl.style.color = '#fff';

        // 최종 값 강조 시 화면 진동
        const ci = this.element?.querySelector('#bwbr-combat-info');
        if (ci) {
          ci.classList.add('bwbr-anim-screen-shake');
          setTimeout(() => ci.classList.remove('bwbr-anim-screen-shake'), 600);
        }

        // 최종 값 강조 후 원복
        setTimeout(() => {
          diceEl.style.transition = 'transform 0.4s ease-out, color 0.3s';
          diceEl.style.transform = 'scale(1)';
        }, 200);
      }
    }, 45);
  }

  // ── 수동 입력 ─────────────────────────────────────────

  showManualInput(who, emoji, playerName) {
    this.ensureInjected();
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

  hideManualInput() {
    const container = this.element?.querySelector('#bwbr-manual-input');
    if (container) container.style.display = 'none';

    if (this._manualInputResolve) {
      this._manualInputResolve(null);
      this._manualInputResolve = null;
    }
  }

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

  // ── 일시정지 UI ──────────────────────────────────────

  setPaused(isPaused) {
    this._paused = isPaused;
    const btn = this.element?.querySelector('#bwbr-btn-pause');
    if (btn) {
      btn.textContent = isPaused ? '▶ 재개' : '⏸ 일시정지';
      btn.classList.toggle('bwbr-btn-resume', isPaused);
    }
  }

  // ── 콜백 ──────────────────────────────────────────────

  onCancel(callback) {
    this.onCancelCallback = callback;
  }

  onPause(callback) {
    this.onPauseCallback = callback;
  }

  // ── 유틸리티 ──────────────────────────────────────────

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
