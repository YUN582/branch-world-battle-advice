// ============================================================
// Branch World Battle Roll - 임베디드 전투 패널
// 코코포리아 채팅 패널 헤더 아래에 삽입되는 전투 UI
// ============================================================

window.BattleRollOverlay = class BattleRollOverlay {
  constructor(config) {
    this.config = config || window.BWBR_DEFAULTS;
    this.element = null;
    this.isCollapsed = false;
    this.onCancelCallback = null;
    this.onPauseCallback = null;
    this._manualInputResolve = null;
    this._injected = false;
    this._retryTimer = null;
    this._paused = false;
    this._combatHideTimer = null;
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
        <button id="bwbr-btn-expand" type="button">▲</button>
      </div>
      <div id="bwbr-body">
        <div id="bwbr-actions" style="display:none">
          <button type="button" id="bwbr-btn-pause" title="일시정지">⏸</button>
          <button type="button" id="bwbr-btn-cancel" title="전투 중지">✖</button>
        </div>
        <div id="bwbr-combat-info"></div>
        <div id="bwbr-guide">
          <div class="bwbr-guide-trigger">《합 개시》| ⚔️ 공격자 - 주사위/대성공/대실패 | 🛡️ 방어자 - 주사위/대성공/대실패</div>
          <div class="bwbr-guide-traits">
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h0">H0</span>
              <span>인간 고유 특성 — 주사위 0 시 +1 부활, 대성공 시 초기화</span>
            </div>
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h00">H00</span>
              <span>인간 고유 특성 (잠재) — 특성 없지만 대성공 시 초기화되어 사용 가능</span>
            </div>
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h4">H4</span>
              <span>피로 새겨진 역사 — 대성공 시 다음 판정 +2, 최대+5, 비크리 시 초기화</span>
            </div>
            <div class="bwbr-guide-example">사용예: ⚔️ 철수 - 5/18/3/H0H4 | 🛡️ 영희 - 5/18/3/H00</div>
          </div>
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
      // 부드러운 숨김: 콘텐츠 페이드아웃 → 컨테이너 접힘
      info.classList.remove('bwbr-combat-visible');
      clearTimeout(this._combatHideTimer);
      this._combatHideTimer = setTimeout(() => {
        if (!info.classList.contains('bwbr-combat-visible')) {
          info.innerHTML = '';
        }
      }, 700);
      return;
    }

    clearTimeout(this._combatHideTimer);

    const atk = state.combat.attacker;
    const def = state.combat.defender;

    const atkTraitBadges = this._renderTraitBadges(atk);
    const defTraitBadges = this._renderTraitBadges(def);
    const atkH4Info = atk.h4Bonus > 0 ? `<span class="bwbr-h4-indicator" title="피로 새겨진 역사 +${atk.h4Bonus}">역사+${atk.h4Bonus}</span>` : '';
    const defH4Info = def.h4Bonus > 0 ? `<span class="bwbr-h4-indicator" title="피로 새겨진 역사 +${def.h4Bonus}">역사+${def.h4Bonus}</span>` : '';
    const atkHasH0 = atk.traits?.includes('H0') || atk.traits?.includes('H00');
    const defHasH0 = def.traits?.includes('H0') || def.traits?.includes('H00');
    const atkH0Info = atkHasH0 && atk.h0Used ? `<span class="bwbr-h0-used" title="인간 고유 특성 사용됨">부활✗</span>` : '';
    const defH0Info = defHasH0 && def.h0Used ? `<span class="bwbr-h0-used" title="인간 고유 특성 사용됨">부활✗</span>` : '';

    info.innerHTML = `
      <div class="bwbr-round-badge">제 ${state.round}합</div>
      <div class="bwbr-fighters">
        <div class="bwbr-fighter" id="bwbr-atk">
          <span class="bwbr-fighter-icon">⚔️</span>
          <span class="bwbr-fighter-name" title="${this._esc(atk.name)}">${this._esc(atk.name)}</span>
          ${atkTraitBadges}
          <span class="bwbr-fighter-dice" id="bwbr-atk-dice">${atk.dice}</span>
          <span class="bwbr-fighter-thresholds">${atk.critThreshold}+ / ${atk.fumbleThreshold}-</span>
          <span class="bwbr-trait-status">${atkH4Info}${atkH0Info}</span>
        </div>
        <span class="bwbr-vs">VS</span>
        <div class="bwbr-fighter" id="bwbr-def">
          <span class="bwbr-fighter-icon">🛡️</span>
          <span class="bwbr-fighter-name" title="${this._esc(def.name)}">${this._esc(def.name)}</span>
          ${defTraitBadges}
          <span class="bwbr-fighter-dice" id="bwbr-def-dice">${def.dice}</span>
          <span class="bwbr-fighter-thresholds">${def.critThreshold}+ / ${def.fumbleThreshold}-</span>
          <span class="bwbr-trait-status">${defH4Info}${defH0Info}</span>
        </div>
      </div>
    `;

    // 부드러운 표시: 컨테이너 펼침 → 콘텐츠 페이드인
    if (!info.classList.contains('bwbr-combat-visible')) {
      requestAnimationFrame(() => {
        info.classList.add('bwbr-combat-visible');
      });
    }
  }

  // ── 효과음 재생 ──────────────────────────────────────

  /** 합 주사위 굴림 시 무작위 재생할 효과음 목록 { file, ext } */
  static ROLL_SOUNDS = [
    { file: 'parry1', ext: 'mp3' }, { file: 'parry2', ext: 'mp3' }, { file: 'parry3', ext: 'mp3' },
    { file: 'parry4', ext: 'mp3' }, { file: 'parry5', ext: 'mp3' }, { file: 'parry6', ext: 'mp3' },
    { file: 'hu-ung1', ext: 'wav' }, { file: 'hu-ung2', ext: 'wav' },
    { file: 'hu-ung3', ext: 'wav' }, { file: 'hu-ung4', ext: 'wav' },
    { file: 'shield1', ext: 'wav' }, { file: 'shield2', ext: 'wav' }, { file: 'shield3', ext: 'wav' },
    { file: 'jump', ext: 'wav' }
  ];

  /** Web Audio API 컨텍스트 (겹침 재생 지원) */
  _audioCtx = null;
  /** 프리로드된 사운드 버퍼 캐시 */
  _soundBuffers = {};

  /** AudioContext lazy init */
  _getAudioCtx() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
    return this._audioCtx;
  }

  /** 사운드 파일 fetch → AudioBuffer 캐시 */
  async _loadSoundBuffer(url) {
    if (this._soundBuffers[url]) return this._soundBuffers[url];
    try {
      const resp = await fetch(url);
      const arrayBuf = await resp.arrayBuffer();
      const audioBuffer = await this._getAudioCtx().decodeAudioData(arrayBuf);
      this._soundBuffers[url] = audioBuffer;
      return audioBuffer;
    } catch (e) {
      console.warn('[BWBR] sound decode failed:', url, e);
      return null;
    }
  }

  /** AudioBuffer를 즉시 재생 (겹침 OK) */
  _playBuffer(buffer, volume) {
    const ctx = this._getAudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  }

  /** 현재 설정의 SFX 볼륨 (0~1) */
  _getSfxVolume() {
    return this.config?.general?.sfxVolume ?? 0.45;
  }

  /** 초기화 시 모든 롤 사운드 프리로드 */
  preloadRollSounds() {
    for (const s of BattleRollOverlay.ROLL_SOUNDS) {
      const url = chrome.runtime.getURL(`sounds/${s.file}.${s.ext}`);
      this._loadSoundBuffer(url);
    }
  }

  /**
   * 합 주사위 굴림 시 효과음 무작위 재생 (겹침 지원)
   */
  playParrySound() {
    try {
      const pick = BattleRollOverlay.ROLL_SOUNDS[Math.floor(Math.random() * BattleRollOverlay.ROLL_SOUNDS.length)];
      const url = chrome.runtime.getURL(`sounds/${pick.file}.${pick.ext}`);
      const vol = this._getSfxVolume();
      const cached = this._soundBuffers[url];
      if (cached) {
        this._playBuffer(cached, vol);
      } else {
        // 아직 프리로드 안 됐으면 로드 후 재생
        this._loadSoundBuffer(url).then(buf => {
          if (buf) this._playBuffer(buf, vol);
        });
      }
    } catch (e) {
      console.warn('[BWBR] roll sound error:', e);
    }
  }

  /**
   * 임의 효과음 재생
   * @param {string} name - 파일명 (확장자 제외)
   */
  playTraitSound(name) {
    try {
      const url = chrome.runtime.getURL(`sounds/${name}.mp3`);
      const audio = new Audio(url);
      audio.volume = this._getSfxVolume();
      audio.play().catch(e => console.warn(`[BWBR] ${name} sound play failed:`, e));
    } catch (e) {
      console.warn(`[BWBR] ${name} sound error:`, e);
    }
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

    // 줄바꿈(\n) 처리
    const lines = message.split('\n');
    if (lines.length > 1) {
      lines.forEach((line, i) => {
        entry.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) entry.appendChild(document.createElement('br'));
      });
    } else {
      entry.textContent = message;
    }

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
      btn.textContent = isPaused ? '▶' : '⏸';
      btn.title = isPaused ? '재개' : '일시정지';
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

  /** 특성 태그 배지 HTML 생성 (코드→한글 명칭, 세로 나열) */
  _renderTraitBadges(fighter) {
    if (!fighter.traits || fighter.traits.length === 0) return '';
    const TRAIT_NAMES = {
      H0: '인간 고유 특성', H00: '인간 고유 특성 (잠재)', H1: '공석', H2: '공석', H3: '공석', H4: '피로 새겨진 역사'
    };
    return '<div class="bwbr-trait-badges">' +
      fighter.traits
        .filter(t => TRAIT_NAMES[t] && TRAIT_NAMES[t] !== '공석')
        .map(t => `<span class="bwbr-trait-badge bwbr-trait-${t.toLowerCase()}" title="${t}: ${TRAIT_NAMES[t]}">${TRAIT_NAMES[t]}</span>`)
        .join('') +
      '</div>';
  }

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
