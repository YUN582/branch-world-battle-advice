// ================================================================
//  fab-buttons.js — 연필 FAB 왼쪽 외부 버튼 인프라
//  FAB 버튼 옆에 소형 원형 버튼을 배치하는 공용 시스템
//  다른 모듈에서 BWBR_FabButtons.register() 로 버튼 등록
// ================================================================
(function () {
  'use strict';

  var CONTAINER_ID = 'bwbr-fab-buttons';
  var _registered = [];  // { id, icon, tooltip, onClick, order }
  var _activeStates = {};  // id → boolean
  var _container = null;
  var _fabWatcher = null;

  // ── 공용 API ──

  window.BWBR_FabButtons = {
    /**
     * FAB 왼쪽에 소형 원형 버튼 등록
     * @param {string} id      - 고유 ID (data-bwbr-fab-btn="id")
     * @param {object} opts
     *   @param {string}   opts.icon     - SVG innerHTML (viewBox 0 0 24 24 가정)
     *   @param {string}   opts.tooltip  - 호버 시 표시할 텍스트
     *   @param {Function} opts.onClick  - 클릭 콜백
     *   @param {number}   [opts.order=0]- 정렬 순서 (낮을수록 FAB에 가까움)
     */
    register: function (id, opts) {
      // 중복 방지
      for (var i = 0; i < _registered.length; i++) {
        if (_registered[i].id === id) {
          _registered[i] = { id: id, icon: opts.icon, tooltip: opts.tooltip, onClick: opts.onClick, order: opts.order || 0 };
          _rebuild();
          return;
        }
      }
      _registered.push({ id: id, icon: opts.icon, tooltip: opts.tooltip, onClick: opts.onClick, order: opts.order || 0 });
      _registered.sort(function (a, b) { return a.order - b.order; });
      _rebuild();
    },

    /**
     * 버튼 활성 상태 토글 (색상 변경)
     * @param {string} id
     * @param {boolean} active
     */
    setActive: function (id, active) {
      _activeStates[id] = !!active;
      var btn = document.querySelector('[data-bwbr-fab-btn="' + id + '"]');
      if (btn) {
        btn.classList.toggle('bwbr-fab-btn--active', !!active);
      }
    },

    /** 버튼 등록 해제 */
    unregister: function (id) {
      _registered = _registered.filter(function (r) { return r.id !== id; });
      delete _activeStates[id];
      _rebuild();
    }
  };

  // ── 내부 ──

  /** FAB 버튼 요소 찾기 */
  function _findFab() {
    return document.querySelector('.MuiFab-root.MuiFab-sizeLarge');
  }

  /** FAB의 위치 기준 (grandpa = sc-geBDJh) 을 찾아 컨테이너를 배치 */
  function _ensureContainer() {
    // 이미 DOM에 있으면 재사용
    var existing = document.getElementById(CONTAINER_ID);
    if (existing) {
      _container = existing;
      return _container;
    }

    var fab = _findFab();
    if (!fab) return null;

    // FAB의 wrapper (부모) 에 삽입
    var wrapper = fab.parentElement;
    if (!wrapper) return null;

    _container = document.createElement('div');
    _container.id = CONTAINER_ID;
    _container.className = 'bwbr-fab-buttons';

    wrapper.appendChild(_container);
    return _container;
  }

  /** 등록된 버튼들로 컨테이너 재구축 */
  function _rebuild() {
    var c = _ensureContainer();
    if (!c) return;

    // 기존 버튼 제거
    c.innerHTML = '';

    for (var i = 0; i < _registered.length; i++) {
      var reg = _registered[i];
      var btn = _createButton(reg);
      c.appendChild(btn);
    }
  }

  /** 소형 FAB 버튼 DOM 생성 */
  function _createButton(reg) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-fab-btn';
    btn.setAttribute('data-bwbr-fab-btn', reg.id);
    btn.setAttribute('type', 'button');
    if (_activeStates[reg.id]) btn.classList.add('bwbr-fab-btn--active');

    // SVG 아이콘
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.style.cssText = 'fill:currentColor;pointer-events:none;';
    svg.innerHTML = reg.icon;
    btn.appendChild(svg);

    // 클릭
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (reg.onClick) reg.onClick(e);
    });

    // 툴팁
    var tip = null;
    btn.addEventListener('mouseenter', function (e) {
      if (tip) tip.remove();
      tip = document.createElement('div');
      tip.className = 'bwbr-fab-tooltip';
      tip.textContent = reg.tooltip || '';
      // 버튼 위에 배치 (position 계산)
      var r = btn.getBoundingClientRect();
      tip.style.left = (r.left + r.width / 2) + 'px';
      tip.style.top = (r.top - 6) + 'px';
      document.body.appendChild(tip);
    });
    btn.addEventListener('mouseleave', function () {
      if (tip) { tip.remove(); tip = null; }
    });

    return btn;
  }

  // ── FAB 출현 감시 ──
  // FAB이 늦게 렌더링될 수 있으므로 MutationObserver로 감시

  function _startWatching() {
    if (_fabWatcher) return;

    // 초기 시도
    if (_findFab() && _registered.length > 0) _rebuild();

    _fabWatcher = new MutationObserver(function () {
      // 컨테이너가 DOM에서 사라졌으면 재생성
      if (_registered.length > 0 && !document.getElementById(CONTAINER_ID)) {
        if (_findFab()) _rebuild();
      }
    });
    _fabWatcher.observe(document.body, { childList: true, subtree: true });
  }

  // ccfolia 방 페이지에서만 실행
  if (/\/rooms\//.test(window.location.pathname)) {
    _startWatching();
  }

  // SPA 네비게이션 대응
  window.addEventListener('popstate', function () {
    if (/\/rooms\//.test(window.location.pathname)) _startWatching();
  });

})();
