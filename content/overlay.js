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
    this.onActionClickCallback = null;  // 행동 슬롯 클릭 콜백
    this._manualInputResolve = null;
    this._injected = false;
    this._retryTimer = null;
    this._paused = false;
    this._combatHideTimer = null;
    this._currentTurnData = null;  // 현재 턴 데이터 저장
    this._isSpectatorMode = false;  // 관전 모드 (합 관전)
    this._isTurnTrackingMode = false;  // 턴 추적 모드 (관전자 턴 UI)
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
        <div id="bwbr-toggle-actions">
          <button type="button" id="bwbr-btn-pause" title="일시정지" style="display:none">⏸</button>
          <button type="button" id="bwbr-btn-cancel" title="전투 중지" style="display:none">✖</button>
        </div>
      </div>
      <div id="bwbr-body">
        <div id="bwbr-combat-info"></div>
        <div id="bwbr-guide" class="bwbr-guide-hidden">
          <div class="bwbr-guide-trigger">《합 개시》| ⚔️ 공격자 - 주사위/대성공/대실패 | 🛡️ 방어자 - 주사위/대성공/대실패</div>
          <div class="bwbr-guide-traits">
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h0">H0</span>
              <span>인간 특성: 주사위 0 시 +1 부활, 대성공 시 초기화</span>
            </div>
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h00">H00</span>
              <span>인간 특성 (잠재): 주사위 0 시 +1 부활, 대성공 시 초기화</span>
            </div>
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h4">H4</span>
              <span>피로 새겨진 역사: 대성공 시 다음 판정의 치명타 범위 +2, 누적. (최대 +6). 대성공 아닐 시 초기화.</span>
            </div>
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h40">H40</span>
              <span>역사+인간: H4 누적 초기화 시 인간 특성 발동, 주사위 +1</span>
            </div>
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-h400">H400</span>
              <span>역사+인간 (잠재): H4 누적 초기화 시 인간 특성 발동, 주사위 +1</span>
            </div>
            <div class="bwbr-guide-trait">
              <span class="bwbr-guide-tag bwbr-trait-n0">N0</span>
              <span>연격: 주사위 -2 (하한 3). 합 승리 시 합 굴림에 +1, 누적. 합 패배 시 초기화.</span>
            </div>
            <div class="bwbr-guide-example">사용예: 《합 개시》| ⚔️ 철수 - 5/18/3/N0 | 🛡️ 영희 - 5/18/3/H400</div>
          </div>
        </div>
        <div id="bwbr-log"></div>
        <div id="bwbr-manual-input" style="display:none">
          <div class="bwbr-manual-label" id="bwbr-manual-label">결과를 입력하세요</div>
          <div class="bwbr-manual-row">
            <input type="number" id="bwbr-manual-value" min="1" max="20" placeholder="1~20">
            <button type="button" id="bwbr-manual-submit">확인</button>
          </div>
          <div id="bwbr-h0-tip" style="display:none;font-size:10px;color:rgba(255,255,255,0.35);margin-top:4px;padding:0 2px;">💡 인간 특성을 수동 발동하려면 "H0"을 입력하세요 (주사위 0이 아니어도 가능)</div>
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
    // 토글 바 클릭 시 접기/펼치기 (컨텐츠가 있을 때만 동작)
    const toggleBar = this.element.querySelector('#bwbr-toggle');
    toggleBar.addEventListener('click', (e) => {
      // 버튼 클릭은 무시
      if (e.target.tagName === 'BUTTON') return;
      // 보이는 컨텐츠가 없으면 무시 (기본 상태에서 클릭 방지)
      if (!this._hasVisibleContent()) return;
      
      // 컨텐츠가 있으면 토글 허용 (접기/펼치기 둘 다)
      this.toggleCollapse();
    });

    // 입력창 감지: 트리거 문구 입력 시 가이드 표시
    this._setupInputWatcher();

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

  // ── 접기/펼치기 + 가이드 토글 ───────────────────────────

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    const body = this.element?.querySelector('#bwbr-body');
    if (body) body.classList.toggle('bwbr-collapsed', this.isCollapsed);
  }

  toggleGuide() {
    const guide = this.element?.querySelector('#bwbr-guide');
    if (!guide) return;
    const isHidden = guide.classList.contains('bwbr-guide-hidden');
    guide.classList.toggle('bwbr-guide-hidden');
    // 수동으로 열었으면 자동 닫히지 않도록
    this._guideManuallyOpened = isHidden;
  }

  /**
   * 실제로 보이는 컨텐츠가 있는지 체크
   * - 가이드가 표시 중
   * - 로그에 내용이 있음
   * - 전투 정보가 있음
   * - 수동 입력창이 표시 중
   * - 액션 버튼이 표시 중
   */
  _hasVisibleContent() {
    if (!this.element) return false;

    // 가이드가 표시 중인지
    const guide = this.element.querySelector('#bwbr-guide');
    if (guide && !guide.classList.contains('bwbr-guide-hidden')) {
      return true;
    }

    // 로그에 내용이 있는지
    const log = this.element.querySelector('#bwbr-log');
    if (log && log.children.length > 0) {
      return true;
    }

    // 전투 정보가 있는지
    const combatInfo = this.element.querySelector('#bwbr-combat-info');
    if (combatInfo && combatInfo.innerHTML.trim() !== '') {
      return true;
    }

    // 수동 입력창이 표시 중인지
    const manualInput = this.element.querySelector('#bwbr-manual-input');
    if (manualInput && manualInput.style.display !== 'none') {
      return true;
    }

    // 일시정지/취소 버튼이 표시 중인지 (전투 중)
    const btnPause = this.element.querySelector('#bwbr-btn-pause');
    if (btnPause && btnPause.style.display !== 'none') {
      return true;
    }

    return false;
  }

  showGuide() {
    const guide = this.element?.querySelector('#bwbr-guide');
    if (guide) guide.classList.remove('bwbr-guide-hidden');
  }

  hideGuide() {
    const guide = this.element?.querySelector('#bwbr-guide');
    if (guide) guide.classList.add('bwbr-guide-hidden');
  }

  // ── 입력창 감지: 트리거 문구 입력 시 가이드 표시 ───────

  _setupInputWatcher() {
    // 트리거 패턴 정의 (확장 가능)
    this._triggerPatterns = [
      { pattern: /《합/, guideType: 'melee' }
      // 나중에 추가: { pattern: /《연사/, guideType: 'rapid' }
    ];

    // 입력 이벤트 기반 감지 (300ms 폴링 → event-driven)
    this._inputHandler = () => {
      const input = document.querySelector('textarea[name="text"]');
      if (!input) return;

      const val = input.value;
      let shouldShow = false;

      for (const { pattern } of this._triggerPatterns) {
        if (pattern.test(val)) {
          shouldShow = true;
          break;
        }
      }

      if (shouldShow) {
        this.showGuide();
      } else if (!this._guideManuallyOpened) {
        this.hideGuide();
      }
    };

    // textarea가 동적으로 추가되므로 document 레벨에서 capture
    this._inputCaptureHandler = (e) => {
      if (e.target?.matches?.('textarea[name="text"]')) {
        this._inputHandler();
      }
    };
    document.addEventListener('input', this._inputCaptureHandler, true);
  }

  show() {
    // 토글이 아닌 명시적 펼치기
    if (this.isCollapsed) {
      this.isCollapsed = false;
      const body = this.element?.querySelector('#bwbr-body');
      if (body) body.classList.remove('bwbr-collapsed');
    }
  }

  hide() {
    // 토글이 아닌 명시적 접기
    if (!this.isCollapsed) {
      this.isCollapsed = true;
      const body = this.element?.querySelector('#bwbr-body');
      if (body) body.classList.add('bwbr-collapsed');
    }
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
    if (this._inputCaptureHandler) {
      document.removeEventListener('input', this._inputCaptureHandler, true);
      this._inputCaptureHandler = null;
    }
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

    // 일시정지/취소 버튼 표시 (전투 중일 때만)
    const btnPause = this.element?.querySelector('#bwbr-btn-pause');
    const btnCancel = this.element?.querySelector('#bwbr-btn-cancel');
    const showButtons = (status === 'active' || status === 'waiting' || status === 'paused');
    if (btnPause) btnPause.style.display = showButtons ? '' : 'none';
    if (btnCancel) btnCancel.style.display = showButtons ? '' : 'none';
  }

  /**
   * 전투 보조 - 현재 턴 정보 표시
   * @param {object|null} turnData - { name, iconUrl, will, willMax, mainActions, subActions } 또는 null (숨김)
   */
  updateTurnInfo(turnData) {
    this.ensureInjected();
    const info = this.element?.querySelector('#bwbr-combat-info');
    if (!info) return;

    if (!turnData) {
      // 전투 종료 - 패널 숨김
      info.classList.remove('bwbr-combat-visible');
      const guide = this.element?.querySelector('#bwbr-guide');
      if (guide) guide.classList.remove('bwbr-guide-hidden');
      clearTimeout(this._combatHideTimer);
      this._combatHideTimer = setTimeout(() => {
        if (!info.classList.contains('bwbr-combat-visible')) {
          info.innerHTML = '';
        }
      }, 700);
      return;
    }

    clearTimeout(this._combatHideTimer);

    // 이미지 (없으면 기본 아이콘)
    const iconHtml = turnData.iconUrl 
      ? `<img class="bwbr-portrait-img" src="${this._esc(turnData.iconUrl)}" alt="" />`
      : `<div class="bwbr-portrait-img bwbr-portrait-placeholder">👤</div>`;

    // 의지 바
    let willBarHtml = '';
    if (turnData.will !== null && turnData.will !== undefined) {
      const current = parseInt(turnData.will) || 0;
      const max = turnData.willMax || current;
      const percent = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 100;
      
      const armorHtml = turnData.armor !== null && turnData.armor !== undefined
        ? `<div class="bwbr-armor-display">🛡️ ${turnData.armor}</div>`
        : '';
      
      willBarHtml = `
        <div class="bwbr-bar-container">
          ${armorHtml}
          <div class="bwbr-will-bar">
            <div class="bwbr-will-bar-fill" style="width: ${percent}%"></div>
            <span class="bwbr-will-bar-text">💚 ${current} / ${max}</span>
          </div>
        </div>
      `;
    }

    // 행동 평행사변형 생성 (current > max 시 초과분 노란색 표시)
    const mainMax = turnData.mainActionsMax || turnData.mainActions;
    const subMax = turnData.subActionsMax || turnData.subActions;
    const mainCurrent = turnData.mainActions;
    const subCurrent = turnData.subActions;

    let mainCells = '';
    const mainTotal = Math.max(mainMax, mainCurrent);
    for (let i = 0; i < mainTotal; i++) {
      const spent = i >= mainCurrent ? ' bwbr-action-spent' : '';
      const excess = i >= mainMax && i < mainCurrent ? ' bwbr-action-excess' : '';
      mainCells += `<div class="bwbr-action-cell bwbr-action-main${spent}${excess}" data-action-type="main" data-action-index="${i}"></div>`;
    }
    // 🔺주 행동 + 버튼
    mainCells += `<div class="bwbr-action-add-btn" data-action-type="main" title="🔺주 행동 슬롯 추가">+</div>`;

    let subCells = '';
    const subTotal = Math.max(subMax, subCurrent);
    for (let i = 0; i < subTotal; i++) {
      const spent = i >= subCurrent ? ' bwbr-action-spent' : '';
      const excess = i >= subMax && i < subCurrent ? ' bwbr-action-excess' : '';
      subCells += `<div class="bwbr-action-cell bwbr-action-sub${spent}${excess}" data-action-type="sub" data-action-index="${i}"></div>`;
    }
    // 🔹보조 행동 + 버튼
    subCells += `<div class="bwbr-action-add-btn" data-action-type="sub" title="🔹보조 행동 슬롯 추가">+</div>`;

    // 이명 표시
    const aliasHtml = turnData.alias 
      ? `<span class="bwbr-turn-alias">${this._esc(turnData.alias)}</span>` 
      : '';

    info.innerHTML = `
      <div class="bwbr-turn-card">
        <div class="bwbr-portrait">
          ${iconHtml}
        </div>
        <div class="bwbr-turn-content">
          <div class="bwbr-turn-header">
            <span class="bwbr-turn-name">${this._esc(turnData.name)}</span>
            ${aliasHtml}
          </div>
          ${willBarHtml}
          <div class="bwbr-turn-actions">
            <div class="bwbr-action-row">${mainCells}</div>
            <div class="bwbr-action-row">${subCells}</div>
          </div>
        </div>
      </div>
    `;

    // 현재 턴 데이터 저장
    this._currentTurnData = turnData;

    // 행동 슬롯 클릭 이벤트 바인딩
    this._bindActionClickEvents(info);

    // 표시
    if (!info.classList.contains('bwbr-combat-visible')) {
      const guide = this.element?.querySelector('#bwbr-guide');
      if (guide) guide.classList.add('bwbr-guide-hidden');
      requestAnimationFrame(() => {
        info.classList.add('bwbr-combat-visible');
      });
    }
  }

  /**
   * 행동 슬롯 클릭 이벤트 바인딩
   */
  _bindActionClickEvents(container) {
    // 관전 모드 또는 턴 추적 모드이면 클릭 비활성화
    const isReadOnly = this._isSpectatorMode || this._isTurnTrackingMode;

    // 슬롯 클릭 이벤트
    const cells = container.querySelectorAll('.bwbr-action-cell');
    cells.forEach(cell => {
      cell.style.cursor = isReadOnly ? 'not-allowed' : 'pointer';
      cell.addEventListener('click', (e) => {
        if (isReadOnly) return;  // 읽기 전용 모드면 무시

        const type = cell.dataset.actionType;  // 'main' or 'sub'
        const index = parseInt(cell.dataset.actionIndex);
        const isSpent = cell.classList.contains('bwbr-action-spent');
        
        // 콜백 호출
        if (this.onActionClickCallback) {
          const action = isSpent ? 'restore' : 'use';
          this.onActionClickCallback(type, index, action);
        }
      });
    });

    // + 버튼 클릭 이벤트
    const addBtns = container.querySelectorAll('.bwbr-action-add-btn');
    addBtns.forEach(btn => {
      // 관전/추적 모드면 + 버튼 숨김
      btn.style.display = isReadOnly ? 'none' : '';
      btn.addEventListener('click', (e) => {
        if (isReadOnly) return;
        
        const type = btn.dataset.actionType;  // 'main' or 'sub'
        
        if (this.onActionClickCallback) {
          this.onActionClickCallback(type, -1, 'add');
        }
      });
    });
  }

  /**
   * 행동 클릭 콜백 설정
   * @param {function} callback - (type: 'main'|'sub', index: number, action: 'use'|'restore'|'add') => void
   */
  setActionClickCallback(callback) {
    this.onActionClickCallback = callback;
  }

  /**
   * 컴뱃 패널 → 턴 패널 전환 시 부드러운 접힘/펼침 애니메이션.
   * 현재 전투 정보를 접은 후, fn()으로 새 콘텐츠를 설정하고 펼침.
   * @param {function} fn - 새 콘텐츠를 설정하는 콜백 (updateTurnInfo 등)
   */
  smoothTransition(fn) {
    const info = this.element?.querySelector('#bwbr-combat-info');
    if (!info || !info.classList.contains('bwbr-combat-visible')) {
      fn();
      return;
    }
    // 가이드가 전환 중 나타나지 않도록 억제
    const guide = this.element?.querySelector('#bwbr-guide');
    if (guide) guide.classList.add('bwbr-guide-hidden');
    // 접기
    info.classList.remove('bwbr-combat-visible');
    clearTimeout(this._transitionTimer);
    this._transitionTimer = setTimeout(() => {
      fn();  // updateTurnInfo → innerHTML 교체 + bwbr-combat-visible 추가
      if (guide) guide.classList.add('bwbr-guide-hidden');
    }, 400);
  }

  /**
   * 턴 추적 모드 설정 (관전자 턴 UI용)
   */
  setTurnTrackingMode(isTracking) {
    this._isTurnTrackingMode = isTracking;
    if (!this.element) return;
    // 관전자는 일시정지 불필요, 취소 버튼은 관전 종료로 표시
    const btnPause = this.element.querySelector('#bwbr-btn-pause');
    if (btnPause) btnPause.style.display = isTracking ? 'none' : '';
    const btnCancel = this.element.querySelector('#bwbr-btn-cancel');
    if (btnCancel) btnCancel.title = isTracking ? '관전 종료' : '전투 중지';
  }

  updateCombatState(state) {
    this.ensureInjected();
    const info = this.element?.querySelector('#bwbr-combat-info');
    if (!info) return;

    if (!state.combat) {
      // 부드러운 숨김: 콘텐츠 페이드아웃 → 컨테이너 접힘
      info.classList.remove('bwbr-combat-visible');
      // 도움말 다시 표시
      const guide = this.element?.querySelector('#bwbr-guide');
      if (guide) guide.classList.remove('bwbr-guide-hidden');
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
    const atkHasH0 = atk.traits?.includes('H0') || atk.traits?.includes('H00') || atk.traits?.includes('H40') || atk.traits?.includes('H400');
    const defHasH0 = def.traits?.includes('H0') || def.traits?.includes('H00') || def.traits?.includes('H40') || def.traits?.includes('H400');
    const atkH0Info = atkHasH0 && atk.h0Used ? `<span class="bwbr-h0-used" title="인간 특성 사용됨">부활✗</span>` : '';
    const defH0Info = defHasH0 && def.h0Used ? `<span class="bwbr-h0-used" title="인간 특성 사용됨">부활✗</span>` : '';

    info.innerHTML = `
      <div class="bwbr-hap-content">
        <div class="bwbr-round-badge">
          <span class="bwbr-round-line"></span>
          <span class="bwbr-round-text">${state.round}합</span>
          <span class="bwbr-round-line"></span>
        </div>
        <div class="bwbr-fighters">
          <div class="bwbr-fighter" id="bwbr-atk">
            <span class="bwbr-fighter-icon">⚔️</span>
            <span class="bwbr-dice-count">🎲 ${atk.dice}</span>
            <span class="bwbr-fighter-name" title="${this._esc(atk.name)}">${this._esc(this._firstName(atk.name))}</span>
            <span class="bwbr-fighter-dice" id="bwbr-atk-dice">&nbsp;</span>
            <span class="bwbr-fighter-thresholds">
              <span class="bwbr-crit">${atk.critThreshold}+</span>
              <span class="bwbr-thresh-sep">/</span>
              <span class="bwbr-fumble">${atk.fumbleThreshold}−</span>
            </span>
            <span class="bwbr-trait-status">${atkTraitBadges}${atkH4Info}${atkH0Info}</span>
          </div>
          <span class="bwbr-vs">VS</span>
          <div class="bwbr-fighter" id="bwbr-def">
            <span class="bwbr-fighter-icon">🛡️</span>
            <span class="bwbr-dice-count">🎲 ${def.dice}</span>
            <span class="bwbr-fighter-name" title="${this._esc(def.name)}">${this._esc(this._firstName(def.name))}</span>
            <span class="bwbr-fighter-dice" id="bwbr-def-dice">&nbsp;</span>
            <span class="bwbr-fighter-thresholds">
              <span class="bwbr-crit">${def.critThreshold}+</span>
              <span class="bwbr-thresh-sep">/</span>
              <span class="bwbr-fumble">${def.fumbleThreshold}−</span>
            </span>
            <span class="bwbr-trait-status">${defTraitBadges}${defH4Info}${defH0Info}</span>
          </div>
        </div>
      </div>
    `;

    // 부드러운 표시: 컨테이너 펼침 → 콘텐츠 페이드인
    if (!info.classList.contains('bwbr-combat-visible')) {
      // 도움말 숨김
      const guide = this.element?.querySelector('#bwbr-guide');
      if (guide) guide.classList.add('bwbr-guide-hidden');
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
  _soundBuffers = {};  /** 커스텀 롤 사운드 URL 목록 (chrome.storage.local) */
  _customRollSoundUrls = [];
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

  /** 사운드 파일 fetch → AudioBuffer 캐시 (최대 50개) */
  async _loadSoundBuffer(url) {
    if (this._soundBuffers[url]) return this._soundBuffers[url];
    try {
      const resp = await fetch(url);
      const arrayBuf = await resp.arrayBuffer();
      const audioBuffer = await this._getAudioCtx().decodeAudioData(arrayBuf);
      // LRU 캡: 50개 초과 시 가장 오래된 항목 제거
      const keys = Object.keys(this._soundBuffers);
      if (keys.length >= 50) {
        delete this._soundBuffers[keys[0]];
      }
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

  /** 초기화 시 모든 롤 사운드 프리로드 (빌트인 + 커스텀) */
  async preloadRollSounds() {
    // 빌트인 사운드
    for (const s of BattleRollOverlay.ROLL_SOUNDS) {
      const url = chrome.runtime.getURL(`sounds/${s.file}.${s.ext}`);
      this._loadSoundBuffer(url);
    }
    // 커스텀 롤 사운드 (chrome.storage.local)
    try {
      const result = await chrome.storage.local.get('bwbr_custom_roll_sounds');
      const customs = result.bwbr_custom_roll_sounds || [];
      this._customRollSoundUrls = customs.map(c => c.dataUrl);
      for (const url of this._customRollSoundUrls) {
        this._loadSoundBuffer(url);
      }
    } catch (e) {
      console.warn('[BWBR] custom roll sounds load failed:', e);
    }
  }

  /**
   * 합 주사위 굴림 시 효과음 무작위 재생 (겹침 지원)
   */
  playParrySound() {
    if (!chrome.runtime?.id) return;  // 확장 컨텍스트 무효화 방어
    try {
      // 빌트인 + 커스텀 URL 풍 구성
      const builtInUrls = BattleRollOverlay.ROLL_SOUNDS.map(s => chrome.runtime.getURL(`sounds/${s.file}.${s.ext}`));
      const allUrls = builtInUrls.concat(this._customRollSoundUrls || []);
      if (allUrls.length === 0) return;
      const url = allUrls[Math.floor(Math.random() * allUrls.length)];
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
    if (!chrome.runtime?.id) return;  // 확장 컨텍스트 무효화 방어
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

  // ── 공격 모션 + 이펙트 ───────────────────────────────

  /** 공격 모션 종류 (돌진/내려찍기/찌르기) */
  static ATK_MOTIONS = ['lunge', 'overhead', 'thrust'];
  /** 공격 이펙트 종류 (참격/타격/관통) */
  static ATK_EFFECTS = ['slash', 'strike', 'pierce'];

  /**
   * 주사위 굴림 시 공격 모션 재생
   * - 공격 측이 상대 쪽으로 돌진/내려찍기/찌르기 중 무작위
   * - 이펙트(참격/타격/관통) 무작위
   * - 피격 측은 밀려나는 리코일
   * @param {string} who - 'attacker' | 'defender' (주사위 굴린 쪽)
   */
  playAttack(who) {
    const atkEl = this.element?.querySelector(who === 'attacker' ? '#bwbr-atk' : '#bwbr-def');
    const defEl = this.element?.querySelector(who === 'attacker' ? '#bwbr-def' : '#bwbr-atk');
    const fighters = this.element?.querySelector('.bwbr-fighters');
    if (!atkEl || !defEl) return;

    // 방향: attacker는 왼쪽(→ 오른쪽 공격), defender는 오른쪽(← 왼쪽 공격)
    const dir = who === 'attacker' ? 'r' : 'l';
    const defDir = who === 'attacker' ? 'r' : 'l'; // 피격 밀려나는 방향도 같은 쪽

    // 무작위 모션 선택
    const motion = BattleRollOverlay.ATK_MOTIONS[Math.floor(Math.random() * BattleRollOverlay.ATK_MOTIONS.length)];
    const motionClass = `bwbr-atk-${motion}-${dir}`;
    const recoilClass = `bwbr-hit-recoil-${defDir}`;

    // 이전 애니메이션 초기화
    atkEl.classList.remove(...['lunge', 'overhead', 'thrust'].flatMap(m => [`bwbr-atk-${m}-r`, `bwbr-atk-${m}-l`]));
    defEl.classList.remove('bwbr-hit-recoil-r', 'bwbr-hit-recoil-l');
    // force reflow
    void atkEl.offsetWidth;

    // 공격 모션 적용
    atkEl.classList.add(motionClass);
    setTimeout(() => atkEl.classList.remove(motionClass), 700);

    // 피격 리코일 (약간 딜레이)
    setTimeout(() => {
      defEl.classList.add(recoilClass);
      setTimeout(() => defEl.classList.remove(recoilClass), 600);
    }, 180);

    // 이펙트 생성 (피격 위치에)
    if (fighters) {
      setTimeout(() => this._spawnAttackEffect(fighters), 150);
    }
  }

  /**
   * 공격 이펙트 (참격/타격/관통) 생성
   * @param {HTMLElement} container - fighters 컨테이너
   */
  _spawnAttackEffect(container) {
    const effect = BattleRollOverlay.ATK_EFFECTS[Math.floor(Math.random() * BattleRollOverlay.ATK_EFFECTS.length)];
    const el = document.createElement('div');
    el.className = `bwbr-fx-${effect}`;

    // 참격은 랜덤 각도 변형
    if (effect === 'slash') {
      const angle = -35 + (Math.random() * 70 - 35);
      el.style.setProperty('--slash-angle', `${angle}deg`);
      if (el.style.setProperty) {
        // CSS 회전 오버라이드
        el.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 40 - 20}deg)`;
      }
    }

    // 타격 이펙트는 방사형 라인 추가
    if (effect === 'strike') {
      for (let i = 0; i < 6; i++) {
        const line = document.createElement('div');
        line.className = 'bwbr-strike-line';
        const angle = (360 / 6) * i + (Math.random() * 20 - 10);
        line.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        line.style.animationDelay = `${Math.random() * 0.1}s`;
        el.appendChild(line);
      }
    }

    // 관통 이펙트는 랜덤 회전
    if (effect === 'pierce') {
      el.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 30 - 15}deg)`;
    }

    container.style.position = 'relative';
    container.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  // ── 합 승리 (라운드 승리) 밀어내기 ──────────────────

  /**
   * 합(라운드) 승리 연출: 승자가 패자를 때려서 밀어냄
   * @param {string} winner - 'attacker' | 'defender'
   */
  playRoundWin(winner) {
    const winEl = this.element?.querySelector(winner === 'attacker' ? '#bwbr-atk' : '#bwbr-def');
    const loseEl = this.element?.querySelector(winner === 'attacker' ? '#bwbr-def' : '#bwbr-atk');
    const fighters = this.element?.querySelector('.bwbr-fighters');
    const vsEl = this.element?.querySelector('.bwbr-vs');
    if (!winEl || !loseEl) return;

    // 방향: 승자가 오른쪽으로 밀어냄(attacker) / 왼쪽으로 밀어냄(defender)
    const pushDir = winner === 'attacker' ? 'r' : 'l';
    const pushedDir = winner === 'attacker' ? 'r' : 'l';

    // 이전 클래스 초기화
    const allRoundClasses = [
      'bwbr-roundwin-push-r', 'bwbr-roundwin-push-l',
      'bwbr-roundlose-pushed-r', 'bwbr-roundlose-pushed-l',
      'bwbr-roundwin-name', 'bwbr-roundlose-name',
      'bwbr-round-winner', 'bwbr-round-loser'
    ];
    winEl.classList.remove(...allRoundClasses);
    loseEl.classList.remove(...allRoundClasses);
    void winEl.offsetWidth;

    // 승자 패널 글로우 + 돌진
    winEl.classList.add('bwbr-round-winner');
    winEl.classList.add(`bwbr-roundwin-push-${pushDir}`);
    const winName = winEl.querySelector('.bwbr-fighter-name');
    if (winName) winName.classList.add('bwbr-roundwin-name');

    // 패자 패널 디밍 + 밀려남
    setTimeout(() => {
      loseEl.classList.add('bwbr-round-loser');
      loseEl.classList.add(`bwbr-roundlose-pushed-${pushedDir}`);
      const loseName = loseEl.querySelector('.bwbr-fighter-name');
      if (loseName) loseName.classList.add('bwbr-roundlose-name');
    }, 150);

    // WIN/LOSE 라벨 — 주사위 값 자리에 표시
    const winDice = winEl.querySelector('.bwbr-fighter-dice');
    const loseDice = loseEl.querySelector('.bwbr-fighter-dice');
    const winOrigVal = winDice ? winDice.textContent : '';
    const loseOrigVal = loseDice ? loseDice.textContent : '';
    if (winDice) { winDice.textContent = 'WIN'; winDice.classList.add('bwbr-dice-win'); }
    setTimeout(() => {
      if (loseDice) { loseDice.textContent = 'LOSE'; loseDice.classList.add('bwbr-dice-lose'); }
    }, 150);

    // VS → 방향 화살표 전환
    if (vsEl) {
      const origText = vsEl.textContent;
      vsEl.textContent = winner === 'attacker' ? '▶' : '◀';
      vsEl.classList.add('bwbr-vs-arrow');
      setTimeout(() => {
        vsEl.textContent = origText;
        vsEl.classList.remove('bwbr-vs-arrow');
      }, 1400);
    }

    // 이펙트 + 불꽃
    if (fighters) {
      setTimeout(() => {
        this._spawnAttackEffect(fighters);
        this._spawnSparks(fighters, 10);
      }, 180);
    }

    // 화면 진동 (가볍게)
    const combatInfo = this.element?.querySelector('#bwbr-combat-info');
    if (combatInfo) {
      setTimeout(() => {
        combatInfo.classList.add('bwbr-anim-screen-shake');
        setTimeout(() => combatInfo.classList.remove('bwbr-anim-screen-shake'), 600);
      }, 200);
    }

    // 정리
    setTimeout(() => {
      winEl.classList.remove(`bwbr-roundwin-push-${pushDir}`, 'bwbr-round-winner');
      loseEl.classList.remove(`bwbr-roundlose-pushed-${pushedDir}`, 'bwbr-round-loser');
      if (winName) winName.classList.remove('bwbr-roundwin-name');
      const loseName = loseEl.querySelector('.bwbr-fighter-name');
      if (loseName) loseName.classList.remove('bwbr-roundlose-name');
      if (winDice) { winDice.textContent = winOrigVal; winDice.classList.remove('bwbr-dice-win'); }
      if (loseDice) { loseDice.textContent = loseOrigVal; loseDice.classList.remove('bwbr-dice-lose'); }
    }, 1500);
  }

  // ── 동점 (충돌 + 반발) ───────────────────────────────

  /**
   * 동점 연출: 양측이 부딪친 후 서로 밀려남
   */
  playTie() {
    const atkEl = this.element?.querySelector('#bwbr-atk');
    const defEl = this.element?.querySelector('#bwbr-def');
    const fighters = this.element?.querySelector('.bwbr-fighters');
    const vsEl = this.element?.querySelector('.bwbr-vs');
    if (!atkEl || !defEl) return;

    // 이전 클래스 초기화
    atkEl.classList.remove('bwbr-tie-repel-l', 'bwbr-tie-repel-r');
    defEl.classList.remove('bwbr-tie-repel-l', 'bwbr-tie-repel-r');
    void atkEl.offsetWidth;

    // 양측 충돌 후 반발
    atkEl.classList.add('bwbr-tie-repel-l');
    defEl.classList.add('bwbr-tie-repel-r');

    // VS 텍스트 플래시
    if (vsEl) {
      vsEl.classList.add('bwbr-tie-vs-flash');
      setTimeout(() => vsEl.classList.remove('bwbr-tie-vs-flash'), 800);
    }

    // 이름 하이라이트
    const atkName = atkEl.querySelector('.bwbr-fighter-name');
    const defName = defEl.querySelector('.bwbr-fighter-name');
    if (atkName) atkName.classList.add('bwbr-tie-name');
    if (defName) defName.classList.add('bwbr-tie-name');

    // 불꽃 + 충격파
    if (fighters) {
      fighters.style.position = 'relative';
      this._spawnSparks(fighters, 12);
      setTimeout(() => this._spawnSparks(fighters, 8), 200);
      this._spawnImpactWave(fighters);
    }

    // 화면 진동
    const combatInfo = this.element?.querySelector('#bwbr-combat-info');
    if (combatInfo) {
      combatInfo.classList.add('bwbr-anim-screen-shake');
      setTimeout(() => combatInfo.classList.remove('bwbr-anim-screen-shake'), 600);
    }

    // 정리
    setTimeout(() => {
      atkEl.classList.remove('bwbr-tie-repel-l');
      defEl.classList.remove('bwbr-tie-repel-r');
      if (atkName) atkName.classList.remove('bwbr-tie-name');
      if (defName) defName.classList.remove('bwbr-tie-name');
    }, 1200);
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
      diceEl.style.color = 'rgba(255, 255, 255, 0.5)';

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

  showManualInput(who, emoji, playerName, h0Available = false) {
    this.ensureInjected();
    if (this.isCollapsed) this.toggleCollapse();

    const container = this.element?.querySelector('#bwbr-manual-input');
    const label = this.element?.querySelector('#bwbr-manual-label');
    const input = this.element?.querySelector('#bwbr-manual-value');
    if (!container || !label || !input) return Promise.resolve(null);

    const maxVal = this.config.rules?.diceType || 20;
    this._h0Available = h0Available;

    if (h0Available) {
      label.textContent = `${emoji} ${playerName} 주사위 결과를 입력하세요 (1~${maxVal} 또는 H0)`;
      input.type = 'text';
      input.placeholder = `1~${maxVal} 또는 H0`;
      input.removeAttribute('min');
      input.removeAttribute('max');
    } else {
      label.textContent = `${emoji} ${playerName} 주사위 결과를 입력하세요 (1~${maxVal})`;
      input.type = 'number';
      input.placeholder = `1~${maxVal}`;
      input.min = 1;
      input.max = maxVal;
    }
    input.value = '';
    container.style.display = '';

    // H0 수동 발동 힌트: 수동 입력창이 열릴 때 항상 표시
    const h0Tip = container.querySelector('#bwbr-h0-tip');
    if (h0Tip) h0Tip.style.display = '';

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

    // H0 텍스트 입력 처리
    const rawText = input.value.trim();
    if (this._h0Available && rawText.toUpperCase() === 'H0') {
      const container = this.element?.querySelector('#bwbr-manual-input');
      if (container) container.style.display = 'none';
      if (this._manualInputResolve) {
        this._manualInputResolve('H0');
        this._manualInputResolve = null;
      }
      return;
    }

    const val = parseInt(rawText, 10);
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

  // ── 수동 모드: H0 발동 확인 프롬프트 ─────────────────────

  /**
   * 수동 모드에서 H0 발동 여부를 사용자에게 확인합니다.
   * @param {string} who - 'attacker' 또는 'defender'
   * @param {string} playerName - 플레이어 이름
   * @param {boolean} isH40 - H40/H400 (역사+인간) 상호작용 여부
   * @returns {Promise<boolean>} 발동 여부
   */
  showH0Prompt(who, playerName, isH40 = false) {
    this.ensureInjected();
    if (this.isCollapsed) this.toggleCollapse();

    const container = this.element?.querySelector('#bwbr-manual-input');
    const label = this.element?.querySelector('#bwbr-manual-label');
    const inputRow = this.element?.querySelector('.bwbr-manual-row');
    if (!container || !label || !inputRow) return Promise.resolve(false);

    const emoji = who === 'attacker' ? '⚔️' : '🛡️';
    if (isH40) {
      label.textContent = `🔥📜 ${emoji} ${playerName}: 인간 특성을 발동하여 역사를 유지하시겠습니까?`;
    } else {
      label.textContent = `🔥 ${emoji} ${playerName}: 인간 특성을 발동하시겠습니까? (주사위 +1 부활)`;
    }

    // 기존 input/button 숨기고 H0 전용 버튼 표시
    inputRow.style.display = 'none';
    let h0Row = container.querySelector('.bwbr-h0-row');
    if (!h0Row) {
      h0Row = document.createElement('div');
      h0Row.className = 'bwbr-h0-row';
      h0Row.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
      h0Row.innerHTML = `
        <button type="button" class="bwbr-h0-yes" style="flex:1;padding:6px 0;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">발동</button>
        <button type="button" class="bwbr-h0-no" style="flex:1;padding:6px 0;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer;">넘기기</button>
      `;
      container.appendChild(h0Row);
    }
    h0Row.style.display = 'flex';
    container.style.display = '';

    return new Promise((resolve) => {
      this._h0PromptResolve = resolve;
      const yesBtn = h0Row.querySelector('.bwbr-h0-yes');
      const noBtn = h0Row.querySelector('.bwbr-h0-no');

      const cleanup = () => {
        container.style.display = 'none';
        h0Row.style.display = 'none';
        inputRow.style.display = '';
        this._h0PromptResolve = null;
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
      };

      const onYes = () => { cleanup(); resolve(true); };
      const onNo = () => { cleanup(); resolve(false); };

      yesBtn.addEventListener('click', onYes);
      noBtn.addEventListener('click', onNo);
    });
  }

  /** H0 프롬프트 취소 (전투 중지 시) */
  hideH0Prompt() {
    const container = this.element?.querySelector('#bwbr-manual-input');
    const h0Row = container?.querySelector('.bwbr-h0-row');
    const inputRow = this.element?.querySelector('.bwbr-manual-row');
    if (container) container.style.display = 'none';
    if (h0Row) h0Row.style.display = 'none';
    if (inputRow) inputRow.style.display = '';
    if (this._h0PromptResolve) {
      this._h0PromptResolve(false);
      this._h0PromptResolve = null;
    }
  }

  // ── 로그 ──────────────────────────────────────────────

  addLog(message, type = 'info') {
    this.ensureInjected();
    if (!this.config?.general?.showBattleLog) return;
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

  /** 관전 모드 UI 전환 (일시정지 숨김, 취소→관전 종료) */
  setSpectatorMode(isSpectating) {
    this._isSpectatorMode = isSpectating;  // 플래그 설정
    if (!this.element) return;
    this.element.classList.toggle('bwbr-spectating', isSpectating);
    const btnPause = this.element.querySelector('#bwbr-btn-pause');
    if (btnPause) btnPause.style.display = isSpectating ? 'none' : '';
    const btnCancel = this.element.querySelector('#bwbr-btn-cancel');
    if (btnCancel) btnCancel.title = isSpectating ? '관전 종료' : '전투 중지';
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
      H0: '인간 특성', H00: '인간 특성 (잠재)',
      H1: '공석', H2: '공석', H3: '공석',
      H4: '피로 새겨진 역사',
      H40: '역사+인간', H400: '역사+인간',
      N0: '연격'
    };
    return '<div class="bwbr-trait-badges">' +
      fighter.traits
        .filter(t => TRAIT_NAMES[t] && TRAIT_NAMES[t] !== '공석')
        .map(t => `<span class="bwbr-trait-badge bwbr-trait-${t.toLowerCase()}" title="${t}: ${TRAIT_NAMES[t]}">${TRAIT_NAMES[t]}</span>`)
        .join('') +
      '</div>';
  }

  _firstName(name) {
    if (!name) return '';
    return name.trim().split(/\s+/)[0];
  }

  _esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
