// ================================================================
//  placement.js — 배치 모드 모듈 (ISOLATED world)
//  좌측 세로 툴바 + 이미지/텍스트/도형/그리기 배치 도구
//  modules/placement/ 에 위치, module-loader.js 에서 import() 로 로드
// ================================================================

// ── 상수 ────────────────────────────────────────────────────────

var PLACEMENT_ICON = '<path fill="currentColor" d="M13 3V11H21V3H13M3 21H11V13H3V21M3 3V11H11V3H3M13 16H16V13H18V16H21V18H18V21H16V18H13V16Z"/>';

var TOOL_ICONS = {
  image: '<path fill="currentColor" d="M21 3H3C2 3 1 4 1 5V19C1 20.1 1.9 21 3 21H21C22 21 23 20 23 19V5C23 3.9 22.1 3 21 3M5 17L8.5 12.5L11 15.5L14.5 11L19 17H5Z"/>',
  text: '<path fill="currentColor" d="M18.5 4L19.66 8.35L18.7 8.61C18.25 7.74 17.79 6.87 17.26 6.43C16.73 6 16.11 6 15.5 6H13V16.5C13 17 13 17.5 13.33 17.75C13.67 18 14.33 18 15 18V19H9V18C9.67 18 10.33 18 10.67 17.75C11 17.5 11 17 11 16.5V6H8.5C7.89 6 7.27 6 6.74 6.43C6.21 6.87 5.75 7.74 5.3 8.61L4.34 8.35L5.5 4H18.5Z"/>',
  draw: '<path fill="currentColor" d="M20.71 7.04C21.1 6.65 21.1 6 20.71 5.63L18.37 3.29C18 2.9 17.35 2.9 16.96 3.29L15.12 5.12L18.87 8.87M3 17.25V21H6.75L17.81 9.93L14.06 6.18L3 17.25Z"/>'
};

var MODE_ICONS = {
  edit: '<path fill="currentColor" d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13 0h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3z"/>'
};

var CELL_PX = 24;  // ccfolia 1타일 = 24px
var COMPOSITE_PX_PER_TILE = 48;  // 합성 이미지 해상도 (1타일 = 48px)

// ── CSS 주입 ────────────────────────────────────────────────────

(function injectStyles() {
  var style = document.createElement('style');
  style.textContent = `
/* ── 배치 모드 툴바 ─────────────────────────────── */

.bwbr-placement-toolbar {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 104;
  display: flex;
  flex-direction: column-reverse;
  gap: 4px;
  transform: translateX(-80px);
  opacity: 0;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

.bwbr-placement-toolbar--open {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

/* ── 도구 버튼 ─────────────────────────────────── */

.bwbr-place-tool-btn {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: none;
  background: #fff;
  color: rgba(0,0,0,0.54);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  position: relative;
}

.bwbr-place-tool-btn:hover {
  background: #f5f5f5;
  box-shadow: 0 4px 12px rgba(0,0,0,0.22);
}

.bwbr-place-tool-btn--active {
  background: #42a5f5;
  color: #fff;
}

.bwbr-place-tool-btn--active:hover {
  background: #2196f3;
}

.bwbr-place-tool-btn svg {
  width: 22px;
  height: 22px;
}

/* ── 툴팁 ──────────────────────────────────────── */

.bwbr-place-tool-btn .bwbr-place-tooltip {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  background: rgba(33,33,33,0.9);
  color: #fff;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
}

.bwbr-place-tool-btn:hover .bwbr-place-tooltip {
  opacity: 1;
}

/* ── 패널 설정 영역 ────────────────────────────── */

.bwbr-place-settings {
  position: absolute;
  left: calc(100% + 8px);
  bottom: 0;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.18);
  padding: 12px;
  width: 320px;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transform: translateX(-20px);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.bwbr-place-settings--open {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

.bwbr-place-settings label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #333;
  gap: 8px;
}

.bwbr-place-settings .bwbr-place-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bwbr-place-settings .bwbr-place-field-label {
  font-size: 11px;
  color: #888;
  font-weight: 500;
}

.bwbr-place-settings input[type="number"] {
  width: 60px;
  padding: 4px 6px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  background: #fafafa;
  text-align: center;
}

.bwbr-place-settings input[type="text"],
.bwbr-place-settings textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  background: #fafafa;
  box-sizing: border-box;
  resize: vertical;
}

.bwbr-place-settings textarea {
  min-height: 40px;
  max-height: 80px;
}

/* ── 토글 스위치 ───────────────────────────────── */

.bwbr-place-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.bwbr-place-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.bwbr-place-toggle .bwbr-place-slider {
  position: absolute;
  inset: 0;
  background: #ccc;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
}

.bwbr-place-toggle .bwbr-place-slider::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.bwbr-place-toggle input:checked + .bwbr-place-slider {
  background: #42a5f5;
}

.bwbr-place-toggle input:checked + .bwbr-place-slider::before {
  transform: translateX(16px);
}

/* ── 타입 토글 (스크린/마커) ───────────────────── */

.bwbr-place-type-toggle {
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #ddd;
}

.bwbr-place-type-toggle button {
  flex: 1;
  padding: 4px 0;
  border: none;
  background: #fafafa;
  font-size: 12px;
  cursor: pointer;
  color: #666;
  transition: background 0.15s, color 0.15s;
}

.bwbr-place-type-toggle button.active {
  background: #42a5f5;
  color: #fff;
}

/* ── 서브 도구 선택 행 ─────────────────────────── */

.bwbr-place-subtool-row {
  display: flex;
  gap: 4px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
  margin-bottom: 4px;
}

.bwbr-place-subtool-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
  font-size: 12px;
  white-space: nowrap;
  color: #666;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.bwbr-place-subtool-btn:hover {
  background: #f0f0f0;
  border-color: #bbb;
}

.bwbr-place-subtool-btn--active {
  background: #42a5f5;
  color: #fff;
  border-color: #42a5f5;
}

.bwbr-place-subtool-btn svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* ── 이미지 소스 메뉴 ──────────────────────────── */

.bwbr-place-source-menu {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
  margin-bottom: 4px;
}

.bwbr-place-source-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
  font-size: 13px;
  color: #333;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.bwbr-place-source-btn:hover {
  background: #f0f0f0;
  border-color: #bbb;
}

.bwbr-place-current-image {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-top: 4px;
}

.bwbr-place-current-image img {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #ddd;
}

.bwbr-place-current-image span {
  font-size: 12px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.bwbr-place-current-image .bwbr-place-clear-img {
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  flex-shrink: 0;
}

.bwbr-place-current-image .bwbr-place-clear-img:hover {
  color: #e53935;
}

/* ── 이미지 등록 목록 ──────────────────────────── */

.bwbr-place-image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.bwbr-place-image-thumb {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 6px;
  border: 2px solid #ddd;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.bwbr-place-image-thumb:hover {
  border-color: #aaa;
  box-shadow: 0 0 6px rgba(0,0,0,0.15);
}

.bwbr-place-image-thumb--active {
  border-color: #42a5f5;
  box-shadow: 0 0 8px rgba(66,165,245,0.5);
}

.bwbr-place-image-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bwbr-place-image-thumb .bwbr-place-thumb-remove {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(211,47,47,0.9);
  color: #fff;
  font-size: 10px;
  border: none;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 0;
}

.bwbr-place-image-thumb:hover .bwbr-place-thumb-remove {
  display: flex;
}

/* ── 배치 오버레이 ─────────────────────────────── */

.bwbr-placement-overlay {
  position: fixed;
  inset: 0;
  z-index: 102;
  cursor: crosshair;
  display: none;
}

.bwbr-placement-overlay--active {
  display: block;
}

.bwbr-placement-overlay--blocked {
  cursor: not-allowed;
}

/* ── 배치 프리뷰 (드래그 중) ───────────────────── */

.bwbr-placement-preview {
  position: fixed;
  border: 2px dashed #42a5f5;
  background: rgba(66, 165, 245, 0.1);
  pointer-events: none;
  z-index: 103;
  display: none;
}

.bwbr-placement-preview--visible {
  display: block;
}

.bwbr-placement-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.7;
}

/* ── 스테이징된 오브젝트 (맵 위 프리뷰) ────────── */

.bwbr-staged-item {
  position: absolute;
  border: 2px solid #42a5f5;
  background: rgba(66, 165, 245, 0.08);
  box-sizing: border-box;
  pointer-events: none;
  z-index: 99999;
}

.bwbr-staged-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.65;
}

.bwbr-staged-badge {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #42a5f5;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}

.bwbr-staged-item--selected {
  outline: 2px dashed rgba(255,152,0,0.85);
  outline-offset: 2px;
  border-color: rgba(255,152,0,0.85);
}

.bwbr-staged-item--selected .bwbr-staged-badge {
  background: #ff9800;
}

.bwbr-staged-item--interactive {
  pointer-events: auto;
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.bwbr-staged-item--interactive:hover {
  box-shadow: 0 0 8px rgba(66, 165, 245, 0.6);
}

.bwbr-staged-item--interactive.bwbr-staged-item--selected {
  cursor: move;
}

.bwbr-staged-item--dragging {
  opacity: 0.7;
  box-shadow: 0 0 16px rgba(255, 152, 0, 0.7) !important;
}

/* ── Alt+드래그 선택 사각형 ───────────────── */

.bwbr-place-select-rect {
  position: fixed;
  border: 2px dashed rgba(255,152,0,0.85);
  background: rgba(255,152,0,0.08);
  z-index: 100000;
  pointer-events: none;
}

/* ── 확인 바 (하단 중앙) ───────────────────────── */

.bwbr-place-confirm-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 105;
  display: none;
  align-items: center;
  gap: 12px;
  background: #fff;
  border-radius: 12px;
  padding: 8px 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}

.bwbr-place-confirm-bar--visible {
  display: flex;
}

.bwbr-place-staged-count {
  font-size: 13px;
  color: #666;
  white-space: nowrap;
  min-width: 60px;
  text-align: center;
}

.bwbr-place-confirm-bar-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.bwbr-place-cancel-btn {
  background: #f5f5f5;
  color: #666;
}

.bwbr-place-cancel-btn:hover {
  background: #eee;
  color: #e53935;
}

.bwbr-place-confirm-btn {
  background: #42a5f5;
  color: #fff;
}

.bwbr-place-confirm-btn:hover {
  background: #2196f3;
}

/* ── 회전 표시 ─────────────────────────────────── */

.bwbr-placement-angle-indicator {
  position: fixed;
  background: rgba(33,33,33,0.85);
  color: #fff;
  font-size: 14px;
  padding: 4px 12px;
  border-radius: 6px;
  pointer-events: none;
  z-index: 106;
  display: none;
  white-space: nowrap;
}

.bwbr-placement-angle-indicator--visible {
  display: block;
}
`;
  document.head.appendChild(style);
})();


// ── 상태 ────────────────────────────────────────────────────────

var _state = {
  active: false,          // 배치 모드 활성
  mode: null,             // 'edit' | null (기본 = 선택 모드)
  currentTool: null,      // 'image' | 'text' | 'draw' (편집 모드 하위 도구)
  placing: false,         // 현재 배치 중 (드래그)

  // 패널 설정 기본값
  panelSettings: {
    z: 150,
    memo: '',
    type: 'plane',        // 'plane' (마커) or 'object' (스크린)
    locked: false,
    freezed: false
  },

  // 드래그 상태
  drag: {
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
  },

  // 이미지 배치용
  pendingImage: null,     // { id, dataUrl, name, width, height }
  registeredImages: [],   // [{ id, dataUrl, name, width, height }]

  // 스테이징 (일괄 배치)
  stagedObjects: [],      // [{ id, mapCoords, angle, imageDataUrl, settings }]
  selectedStagedIds: []   // 선택된 스테이징 오브젝트 ID 목록 (다중 선택)
};


// ── DOM 요소 ────────────────────────────────────────────────────

var _toolbar = null;
var _settingsPanel = null;
var _overlay = null;
var _preview = null;
var _angleIndicator = null;

// 설정 DOM 요소 참조 (이벤트 의존 없이 직접 읽기 위함)
var _settingsEls = {
  typePlaneBtn: null,
  typeObjectBtn: null,
  zInput: null,
  memoInput: null,
  lockedInput: null,
  freezedInput: null
};

function readSettingsFromDOM() {
  if (_settingsEls.typePlaneBtn) {
    _state.panelSettings.type = _settingsEls.typePlaneBtn.classList.contains('active') ? 'plane' : 'object';
  }
  if (_settingsEls.zInput) {
    _state.panelSettings.z = parseInt(_settingsEls.zInput.value, 10) || 150;
  }
  if (_settingsEls.memoInput) {
    _state.panelSettings.memo = _settingsEls.memoInput.value || '';
  }
  if (_settingsEls.lockedInput) {
    _state.panelSettings.locked = !!_settingsEls.lockedInput.checked;
  }
  if (_settingsEls.freezedInput) {
    _state.panelSettings.freezed = !!_settingsEls.freezedInput.checked;
  }
}
var _modeButtons = {};
var _subToolRow = null;
var _subToolButtons = {};
var _imageSourceMenu = null;
var _imageGrid = null;
var _confirmBar = null;
var _stagedCountEl = null;


// ── 초기화 ──────────────────────────────────────────────────────

function init() {
  createToolbar();
  createOverlay();
  createConfirmBar();
  registerFabButton();
  setupKeyboard();
  setupSelectModeHandlers();
}


// ── FAB 버튼 등록 ───────────────────────────────────────────────

function registerFabButton() {
  if (!window.BWBR_FabButtons) {
    setTimeout(registerFabButton, 500);
    return;
  }
  window.BWBR_FabButtons.register('placement', {
    icon: PLACEMENT_ICON,
    tooltip: '배치 모드',
    onClick: togglePlacementMode,
    order: 1
  });
}


// ── 모드 토글 ───────────────────────────────────────────────────

function updatePlacementCursor() {
  if (!_overlay) return;
  _overlay.classList.remove('bwbr-placement-overlay--blocked');
  if (_state.currentTool === 'image' && !_state.pendingImage) {
    _overlay.classList.add('bwbr-placement-overlay--blocked');
  }
}

function togglePlacementMode() {
  _state.active = !_state.active;
  window.BWBR_PlacementActive = _state.active;

  if (window.BWBR_FabButtons) {
    window.BWBR_FabButtons.setActive('placement', _state.active);
  }

  if (_state.active) {
    _toolbar.classList.add('bwbr-placement-toolbar--open');
  } else {
    _toolbar.classList.remove('bwbr-placement-toolbar--open');
    deactivateMode();
    clearAllStaged();
    updatePlacementCursor();
  }
}


// ── 모드 전환 (선택 / 추가) ─────────────────────────────────────

function activateMode(mode) {
  if (mode !== 'edit') return;
  if (_state.mode === 'edit') { deactivateMode(); return; }

  _state.mode = 'edit';
  if (_modeButtons.edit) _modeButtons.edit.classList.add('bwbr-place-tool-btn--active');
  _settingsPanel.classList.add('bwbr-place-settings--open');

  // 서브도구가 이미 선택된 경우 오버레이 복원
  if (_state.currentTool === 'image' && _state.pendingImage) {
    _overlay.classList.add('bwbr-placement-overlay--active');
  } else if (_state.currentTool && _state.currentTool !== 'image') {
    _overlay.classList.add('bwbr-placement-overlay--active');
  }
}

function deactivateMode() {
  if (_modeButtons.edit) _modeButtons.edit.classList.remove('bwbr-place-tool-btn--active');
  _state.mode = null;
  _state.currentTool = null;
  _state.placing = false;
  Object.keys(_subToolButtons).forEach(function(k) {
    _subToolButtons[k].classList.remove('bwbr-place-subtool-btn--active');
  });
  _overlay.classList.remove('bwbr-placement-overlay--active');
  _preview.classList.remove('bwbr-placement-preview--visible');
  _settingsPanel.classList.remove('bwbr-place-settings--open');
  updatePlacementCursor();
}

function setSubTool(toolId) {
  Object.keys(_subToolButtons).forEach(function(k) {
    _subToolButtons[k].classList.remove('bwbr-place-subtool-btn--active');
  });

  if (_state.currentTool === toolId) {
    _state.currentTool = null;
    _overlay.classList.remove('bwbr-placement-overlay--active');
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    updatePlacementCursor();
    return;
  }

  _state.currentTool = toolId;
  _subToolButtons[toolId].classList.add('bwbr-place-subtool-btn--active');

  if (toolId === 'image') {
    if (_imageSourceMenu) _imageSourceMenu.style.display = '';
    _overlay.classList.add('bwbr-placement-overlay--active');
    if (_state.pendingImage) {
      // has image
    }
  } else {
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    _overlay.classList.add('bwbr-placement-overlay--active');
  }
  updatePlacementCursor();
}


// ── 툴바 생성 ───────────────────────────────────────────────────

function createToolbar() {
  _toolbar = document.createElement('div');
  _toolbar.className = 'bwbr-placement-toolbar';

  // 패널 설정 영역
  _settingsPanel = createSettingsPanel();
  _toolbar.appendChild(_settingsPanel);

  // 편집 모드 버튼 (기본 = 선택 모드)
  var modes = [
    { id: 'edit', label: '편집 (A)', icon: MODE_ICONS.edit }
  ];

  modes.forEach(function (mode) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-place-tool-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24">' + mode.icon + '</svg>' +
      '<span class="bwbr-place-tooltip">' + mode.label + '</span>';
    btn.addEventListener('click', function () { activateMode(mode.id); });
    _toolbar.appendChild(btn);
    _modeButtons[mode.id] = btn;
  });

  document.body.appendChild(_toolbar);
}


// ── 패널 설정 패널 ──────────────────────────────────────────────

function createSubToolRow() {
  var row = document.createElement('div');
  row.className = 'bwbr-place-subtool-row';

  var tools = [
    { id: 'image', label: '이미지 (I)', icon: TOOL_ICONS.image },
    { id: 'text',  label: '텍스트 (T)', icon: TOOL_ICONS.text },
    { id: 'draw',  label: '그리기 (D)', icon: TOOL_ICONS.draw }
  ];

  tools.forEach(function (tool) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-place-subtool-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24">' + tool.icon + '</svg> ' + tool.label;
    btn.addEventListener('click', function () { setSubTool(tool.id); });
    row.appendChild(btn);
    _subToolButtons[tool.id] = btn;
  });

  return row;
}

function createSettingsPanel() {
  var panel = document.createElement('div');
  panel.className = 'bwbr-place-settings';

  // 서브 도구 선택 행
  _subToolRow = createSubToolRow();
  panel.appendChild(_subToolRow);

  // 이미지 소스 메뉴 (이미지 도구용)
  _imageSourceMenu = createImageSourceMenu();
  panel.appendChild(_imageSourceMenu);

  // 타입 토글
  var typeField = createField('타입');
  var typeToggle = document.createElement('div');
  typeToggle.className = 'bwbr-place-type-toggle';
  var btnMarker = document.createElement('button');
  btnMarker.textContent = '마커';
  btnMarker.className = 'active';
  var btnScreen = document.createElement('button');
  btnScreen.textContent = '스크린';
  btnMarker.addEventListener('click', function () {
    _state.panelSettings.type = 'plane';
    btnMarker.className = 'active';
    btnScreen.className = '';
  });
  btnScreen.addEventListener('click', function () {
    _state.panelSettings.type = 'object';
    btnScreen.className = 'active';
    btnMarker.className = '';
  });
  typeToggle.appendChild(btnMarker);
  typeToggle.appendChild(btnScreen);
  typeField.appendChild(typeToggle);
  panel.appendChild(typeField);
  _settingsEls.typePlaneBtn = btnMarker;
  _settingsEls.typeObjectBtn = btnScreen;

  // 겹침 우선도
  var zField = createField('겹침 우선도');
  var zInput = document.createElement('input');
  zInput.type = 'number';
  zInput.value = '150';
  zInput.min = '0';
  zInput.max = '9999';
  zInput.addEventListener('input', function () {
    _state.panelSettings.z = parseInt(zInput.value, 10) || 150;
  });
  zField.appendChild(zInput);
  panel.appendChild(zField);
  _settingsEls.zInput = zInput;

  // 메모
  var memoField = createField('패널 메모');
  var memoInput = document.createElement('textarea');
  memoInput.placeholder = '메모 입력...';
  memoInput.addEventListener('input', function () {
    _state.panelSettings.memo = memoInput.value;
  });
  memoField.appendChild(memoInput);
  panel.appendChild(memoField);
  _settingsEls.memoInput = memoInput;

  // 위치 고정
  var lockedField = createToggleField('위치 고정', false, function (val) {
    _state.panelSettings.locked = val;
  });
  panel.appendChild(lockedField);
  _settingsEls.lockedInput = lockedField.querySelector('input[type="checkbox"]');

  // 사이즈 고정
  var freezedField = createToggleField('사이즈 고정', false, function (val) {
    _state.panelSettings.freezed = val;
  });
  panel.appendChild(freezedField);
  _settingsEls.freezedInput = freezedField.querySelector('input[type="checkbox"]');

  return panel;
}


// ── 이미지 소스 메뉴 ────────────────────────────────────────────

function createImageSourceMenu() {
  var menu = document.createElement('div');
  menu.className = 'bwbr-place-source-menu';
  menu.style.display = 'none';

  var localBtn = document.createElement('button');
  localBtn.className = 'bwbr-place-source-btn';
  localBtn.textContent = '📁 로컬 이미지';
  localBtn.addEventListener('click', selectLocalImage);
  menu.appendChild(localBtn);

  var ccoBtn = document.createElement('button');
  ccoBtn.className = 'bwbr-place-source-btn';
  ccoBtn.textContent = '🎲 코코포리아 이미지';
  ccoBtn.addEventListener('click', openCcofoliaImagePicker);
  menu.appendChild(ccoBtn);

  // 등록된 이미지 그리드
  _imageGrid = document.createElement('div');
  _imageGrid.className = 'bwbr-place-image-grid';
  menu.appendChild(_imageGrid);

  return menu;
}


// ── 이미지 등록 목록 ────────────────────────────────────────────

function renderImageGrid() {
  if (!_imageGrid) return;
  _imageGrid.innerHTML = '';
  _state.registeredImages.forEach(function(entry) {
    var thumb = document.createElement('div');
    thumb.className = 'bwbr-place-image-thumb';
    thumb.dataset.imageId = entry.id;
    if (_state.pendingImage && _state.pendingImage.id === entry.id) {
      thumb.classList.add('bwbr-place-image-thumb--active');
    }

    var img = document.createElement('img');
    img.src = entry.dataUrl;
    img.alt = entry.name;
    thumb.appendChild(img);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'bwbr-place-thumb-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      removeRegisteredImage(entry.id);
    });
    thumb.appendChild(removeBtn);

    thumb.addEventListener('click', function() {
      selectRegisteredImage(entry.id);
    });

    _imageGrid.appendChild(thumb);
  });
}

function selectRegisteredImage(id) {
  if (_state.pendingImage && _state.pendingImage.id === id) {
    // 같은 이미지 클릭 → 선택 해제 → 오버레이 숨김
    _state.pendingImage = null;
    _overlay.classList.remove('bwbr-placement-overlay--active');
  } else {
    var entry = _state.registeredImages.find(function(e) { return e.id === id; });
    if (!entry) return;
    _state.pendingImage = entry;
    if (_state.currentTool === 'image') {
      _overlay.classList.add('bwbr-placement-overlay--active');
    }
  }
  updatePlacementCursor();
  updateImageGridSelection();
}

function removeRegisteredImage(id) {
  _state.registeredImages = _state.registeredImages.filter(function(e) { return e.id !== id; });
  if (_state.pendingImage && _state.pendingImage.id === id) {
    _state.pendingImage = null;
    _overlay.classList.remove('bwbr-placement-overlay--active');
  }
  renderImageGrid();
  updatePlacementCursor();
}

function updateImageGridSelection() {
  if (!_imageGrid) return;
  _imageGrid.querySelectorAll('.bwbr-place-image-thumb').forEach(function(el) {
    var isActive = _state.pendingImage && el.dataset.imageId === _state.pendingImage.id;
    el.classList.toggle('bwbr-place-image-thumb--active', !!isActive);
  });
}


// ── 로컬 이미지 추가 ────────────────────────────────────────────

function selectLocalImage() {
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  fileInput.addEventListener('change', function () {
    if (!fileInput.files) { fileInput.remove(); return; }
    Array.from(fileInput.files).forEach(function(file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
          var entry = {
            id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            dataUrl: ev.target.result,
            name: file.name,
            width: img.naturalWidth,
            height: img.naturalHeight
          };
          _state.registeredImages.push(entry);
          renderImageGrid();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    fileInput.remove();
  });

  fileInput.addEventListener('cancel', function () {
    fileInput.remove();
  });

  fileInput.click();
}

function openCcofoliaImagePicker() {
  // 결과 리스너 등록
  function onPickerResult() {
    var raw = document.documentElement.getAttribute('data-bwbr-native-picker-result');
    document.documentElement.removeAttribute('data-bwbr-native-picker-result');
    document.removeEventListener('bwbr-native-picker-result', onPickerResult);

    if (!raw) return;
    var result = JSON.parse(raw);
    if (!result.url) return;

    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      var entry = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        dataUrl: result.url,
        name: result.url.split('/').pop().split('?')[0] || '코코포리아 이미지',
        width: img.naturalWidth,
        height: img.naturalHeight
      };
      _state.registeredImages.push(entry);
      renderImageGrid();
    };
    img.onerror = function () {
      var entry = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        dataUrl: result.url,
        name: '코코포리아 이미지',
        width: 1,
        height: 1
      };
      _state.registeredImages.push(entry);
      renderImageGrid();
    };
    img.src = result.url;
  }

  document.addEventListener('bwbr-native-picker-result', onPickerResult);

  // 네이티브 이미지 피커 열기 (MAIN world)
  document.dispatchEvent(new CustomEvent('bwbr-open-native-image-picker'));
}


// ── 유틸: 필드/토글 생성 ────────────────────────────────────────

function createField(label) {
  var div = document.createElement('div');
  div.className = 'bwbr-place-field';
  var lbl = document.createElement('span');
  lbl.className = 'bwbr-place-field-label';
  lbl.textContent = label;
  div.appendChild(lbl);
  return div;
}

function createToggleField(label, defaultVal, onChange) {
  var row = document.createElement('label');
  var span = document.createElement('span');
  span.textContent = label;
  row.appendChild(span);
  var toggle = document.createElement('div');
  toggle.className = 'bwbr-place-toggle';
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!defaultVal;
  var slider = document.createElement('span');
  slider.className = 'bwbr-place-slider';
  input.addEventListener('change', function () { onChange(input.checked); });
  toggle.appendChild(input);
  toggle.appendChild(slider);
  row.appendChild(toggle);
  return row;
}


// ── 배치 오버레이 ───────────────────────────────────────────────

function createOverlay() {
  _overlay = document.createElement('div');
  _overlay.className = 'bwbr-placement-overlay';
  document.body.appendChild(_overlay);

  _preview = document.createElement('div');
  _preview.className = 'bwbr-placement-preview';
  document.body.appendChild(_preview);

  _angleIndicator = document.createElement('div');
  _angleIndicator.className = 'bwbr-placement-angle-indicator';
  document.body.appendChild(_angleIndicator);

  _overlay.addEventListener('mousedown', onOverlayMouseDown);
  _overlay.addEventListener('mousemove', onOverlayMouseMove);
  _overlay.addEventListener('mouseup', onOverlayMouseUp);

  // 휠 줌 패스스루: 오버레이 아래 요소에 전달
  _overlay.addEventListener('wheel', function(e) {
    _overlay.style.pointerEvents = 'none';
    var below = document.elementFromPoint(e.clientX, e.clientY);
    _overlay.style.pointerEvents = '';
    if (below) {
      below.dispatchEvent(new WheelEvent(e.type, e));
    }
  }, { passive: true });
}


// ── 오버레이 마우스 이벤트 ──────────────────────────────────────

function onOverlayMouseDown(e) {
  if (e.button !== 0) return;

  // Alt+드래그 → 스테이징 아이템 범위 선택 (오버레이 위에서도 동작)
  if (e.altKey) {
    _altBoxSelect.active = true;
    _altBoxSelect.startX = e.clientX;
    _altBoxSelect.startY = e.clientY;
    var rect = document.createElement('div');
    rect.className = 'bwbr-place-select-rect';
    rect.style.left = e.clientX + 'px';
    rect.style.top = e.clientY + 'px';
    rect.style.width = '0';
    rect.style.height = '0';
    document.body.appendChild(rect);
    _altBoxSelect.rectEl = rect;
    deselectStaged();
    return;
  }

  // 드래그 시작 좌표 기록
  _state.drag.startX = e.clientX;
  _state.drag.startY = e.clientY;
  _state.drag.currentX = e.clientX;
  _state.drag.currentY = e.clientY;

  // 선택 모드(기본): 드래그 배치 없음
  if (!_state.mode) return;

  // 편집 모드: 이미지 미선택 시 배치 불가
  if (_state.currentTool === 'image' && !_state.pendingImage) return;

  _state.placing = true;
  updatePreview();
  _preview.classList.add('bwbr-placement-preview--visible');

  if (_state.currentTool === 'image' && _state.pendingImage) {
    _preview.innerHTML = '<img src="' + _state.pendingImage.dataUrl + '" alt="">';
  }
}

function onOverlayMouseMove(e) {
  // Alt 범위 선택 사각형 업데이트
  if (_altBoxSelect.active && _altBoxSelect.rectEl) {
    var l = Math.min(_altBoxSelect.startX, e.clientX);
    var t = Math.min(_altBoxSelect.startY, e.clientY);
    _altBoxSelect.rectEl.style.left = l + 'px';
    _altBoxSelect.rectEl.style.top = t + 'px';
    _altBoxSelect.rectEl.style.width = Math.abs(e.clientX - _altBoxSelect.startX) + 'px';
    _altBoxSelect.rectEl.style.height = Math.abs(e.clientY - _altBoxSelect.startY) + 'px';
    return;
  }
  if (!_state.placing) return;
  _state.drag.currentX = e.clientX;
  _state.drag.currentY = e.clientY;
  updatePreview();
}

function onOverlayMouseUp(e) {
  // Alt 범위 선택 완료
  if (_altBoxSelect.active) {
    finishAltBoxSelect();
    return;
  }
  if (!_state.placing) return;
  _state.placing = false;
  _preview.classList.remove('bwbr-placement-preview--visible');
  _preview.innerHTML = '';

  var rect = getPreviewRect();
  if (rect.w < 5 && rect.h < 5) return;

  deselectStaged();
  stageObject(rect);
}

function updatePreview() {
  var rect = getPreviewRect();
  _preview.style.left = rect.x + 'px';
  _preview.style.top = rect.y + 'px';
  _preview.style.width = rect.w + 'px';
  _preview.style.height = rect.h + 'px';
  _preview.style.transform = '';
}

function getPreviewRect() {
  var x = Math.min(_state.drag.startX, _state.drag.currentX);
  var y = Math.min(_state.drag.startY, _state.drag.currentY);
  var w = Math.abs(_state.drag.currentX - _state.drag.startX);
  var h = Math.abs(_state.drag.currentY - _state.drag.startY);
  return { x: x, y: y, w: w, h: h };
}


// ── 스테이징 시스템 ─────────────────────────────────────────────

function stageObject(screenRect) {
  var mapCoords = screenToMapCoords(screenRect);
  if (!mapCoords) return;

  // DOM에서 직접 설정값 읽기 (이벤트 리스너 불발 대비)
  readSettingsFromDOM();

  console.log('[CE 배치] 스테이징:', screenRect, '→ 타일:', mapCoords);
  console.log('[CE 배치] panelSettings:', JSON.stringify(_state.panelSettings));

  var obj = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    mapCoords: mapCoords,
    angle: 0,
    imageDataUrl: _state.pendingImage ? _state.pendingImage.dataUrl : null,
    settings: {
      type: _state.panelSettings.type,
      z: _state.panelSettings.z,
      memo: _state.panelSettings.memo,
      locked: _state.panelSettings.locked,
      freezed: _state.panelSettings.freezed
    }
  };

  _state.stagedObjects.push(obj);
  renderStagedItem(obj);
  updateConfirmBar();
  // 오버레이 유지 → 연속 배치 가능
}


// ── 스테이징 렌더링 (맵 위 프리뷰) ─────────────────────────────

function renderStagedItem(obj) {
  var zoomEl = getZoomContainer();
  if (!zoomEl) return;

  var mc = obj.mapCoords;
  var el = document.createElement('div');
  el.className = 'bwbr-staged-item bwbr-staged-item--interactive';
  el.dataset.stagedId = obj.id;
  el.style.left = (mc.x * CELL_PX) + 'px';
  el.style.top = (mc.y * CELL_PX) + 'px';
  el.style.width = (mc.width * CELL_PX) + 'px';
  el.style.height = (mc.height * CELL_PX) + 'px';

  if (obj.angle) {
    el.style.transform = 'rotate(' + obj.angle + 'deg)';
  }

  if (obj.imageDataUrl) {
    var img = document.createElement('img');
    img.src = obj.imageDataUrl;
    el.appendChild(img);
  }

  // 번호 배지
  var badge = document.createElement('span');
  badge.className = 'bwbr-staged-badge';
  badge.textContent = _state.stagedObjects.length;
  el.appendChild(badge);

  // 직접 mousedown 처리 (stopPropagation으로 ccfolia 팬 방지)
  el.addEventListener('mousedown', function(ev) {
    onStagedItemMouseDown(obj.id, ev);
  });

  zoomEl.appendChild(el);
}

function clearAllStaged() {
  _state.stagedObjects = [];
  _state.selectedStagedIds = [];
  document.querySelectorAll('.bwbr-staged-item').forEach(function (el) { el.remove(); });
  updateConfirmBar();
}

function renumberStagedBadges() {
  _state.stagedObjects.forEach(function (obj, i) {
    var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
    if (el) {
      var badge = el.querySelector('.bwbr-staged-badge');
      if (badge) badge.textContent = i + 1;
    }
  });
}

function undoLastStaged() {
  if (_state.stagedObjects.length === 0) return;
  var last = _state.stagedObjects.pop();
  var selIdx = _state.selectedStagedIds.indexOf(last.id);
  if (selIdx !== -1) _state.selectedStagedIds.splice(selIdx, 1);
  var el = document.querySelector('[data-staged-id="' + last.id + '"]');
  if (el) el.remove();
  renumberStagedBadges();
  updateConfirmBar();
}


// ── 스테이징 선택/회전 ──────────────────────────────────────────

function hitTestStaged(screenX, screenY) {
  var origin = getMapOriginOnScreen();
  if (!origin) return null;
  var scale = getZoomScale();
  var mapPxX = (screenX - origin.x) / scale;
  var mapPxY = (screenY - origin.y) / scale;

  for (var i = _state.stagedObjects.length - 1; i >= 0; i--) {
    var obj = _state.stagedObjects[i];
    var mc = obj.mapCoords;
    var left = mc.x * CELL_PX;
    var top = mc.y * CELL_PX;
    var right = left + mc.width * CELL_PX;
    var bottom = top + mc.height * CELL_PX;
    if (mapPxX >= left && mapPxX <= right && mapPxY >= top && mapPxY <= bottom) {
      return obj;
    }
  }
  return null;
}

function selectStagedItem(id, additive) {
  if (additive) {
    var idx = _state.selectedStagedIds.indexOf(id);
    if (idx !== -1) {
      // 이미 선택됨 → 해제
      _state.selectedStagedIds.splice(idx, 1);
      var el = document.querySelector('[data-staged-id="' + id + '"]');
      if (el) el.classList.remove('bwbr-staged-item--selected');
      return;
    }
    _state.selectedStagedIds.push(id);
    var el2 = document.querySelector('[data-staged-id="' + id + '"]');
    if (el2) el2.classList.add('bwbr-staged-item--selected');
  } else {
    deselectStaged();
    _state.selectedStagedIds.push(id);
    var el3 = document.querySelector('[data-staged-id="' + id + '"]');
    if (el3) el3.classList.add('bwbr-staged-item--selected');
  }
}

function deselectStaged() {
  _state.selectedStagedIds.forEach(function(id) {
    var el = document.querySelector('[data-staged-id="' + id + '"]');
    if (el) el.classList.remove('bwbr-staged-item--selected');
  });
  _state.selectedStagedIds = [];
}

function finishAltBoxSelect() {
  if (!_altBoxSelect.rectEl) { _altBoxSelect.active = false; return; }
  var selR = _altBoxSelect.rectEl.getBoundingClientRect();
  _altBoxSelect.rectEl.remove();
  _altBoxSelect.rectEl = null;
  _altBoxSelect.active = false;

  var isClick = (selR.width < 5 && selR.height < 5);

  // 모든 스테이징 DOM 요소와 교차 검사
  var items = document.querySelectorAll('.bwbr-staged-item');
  var found = false;
  items.forEach(function(el) {
    var r = el.getBoundingClientRect();
    var intersects;
    if (isClick) {
      // 클릭 → 클릭 지점이 아이템 내부인지 확인
      var cx = _altBoxSelect.startX, cy = _altBoxSelect.startY;
      intersects = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    } else {
      // 드래그 → 사각형 교차 검사
      intersects =
        r.left < selR.right && r.right > selR.left &&
        r.top < selR.bottom && r.bottom > selR.top;
    }
    if (intersects) {
      var sid = el.getAttribute('data-staged-id');
      if (sid && _state.selectedStagedIds.indexOf(sid) === -1) {
        _state.selectedStagedIds.push(sid);
        el.classList.add('bwbr-staged-item--selected');
        found = true;
      }
    }
  });
  if (found) console.log('[CE 배치] Alt 선택:', _state.selectedStagedIds.length + '개');
}

function removeSelectedStaged() {
  if (_state.selectedStagedIds.length === 0) return;
  _state.selectedStagedIds.forEach(function(id) {
    var el = document.querySelector('[data-staged-id="' + id + '"]');
    if (el) el.remove();
    var idx = _state.stagedObjects.findIndex(function(o) { return o.id === id; });
    if (idx !== -1) _state.stagedObjects.splice(idx, 1);
  });
  _state.selectedStagedIds = [];
  renumberStagedBadges();
  updateConfirmBar();
}

function rotateSelectedStaged(delta) {
  if (_state.selectedStagedIds.length === 0) return;
  var lastAngle = 0;
  _state.selectedStagedIds.forEach(function(id) {
    var obj = _state.stagedObjects.find(function(o) { return o.id === id; });
    if (!obj) return;
    obj.angle = ((obj.angle || 0) + delta) % 360;
    if (obj.angle < 0) obj.angle += 360;
    lastAngle = obj.angle;
    var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
    if (el) {
      el.style.transform = obj.angle ? 'rotate(' + obj.angle + 'deg)' : '';
    }
  });
  showAngleIndicator(lastAngle);
}


// ── 선택 모드 상호작용 ──────────────────────────────────────────

var _selectDrag = { start: null, dragging: false };
var _altBoxSelect = { active: false, startX: 0, startY: 0, rectEl: null };

function onStagedItemMouseDown(stagedId, e) {
  if (e.button !== 0 || !_state.active) return;
  e.stopPropagation();
  e.preventDefault();

  var additive = e.altKey;
  selectStagedItem(stagedId, additive);

  // 드래그 시작: 선택된 모든 아이템의 원본 좌표 저장
  var origins = {};
  _state.selectedStagedIds.forEach(function(id) {
    var o = _state.stagedObjects.find(function(so) { return so.id === id; });
    if (o) origins[id] = { x: o.mapCoords.x, y: o.mapCoords.y };
  });
  _selectDrag.start = {
    screenX: e.clientX, screenY: e.clientY,
    origins: origins
  };
  _selectDrag.dragging = false;
}

function setupSelectModeHandlers() {
  document.addEventListener('mousemove', function(e) {
    if (!_selectDrag.start || _state.selectedStagedIds.length === 0) return;
    var dx = e.clientX - _selectDrag.start.screenX;
    var dy = e.clientY - _selectDrag.start.screenY;
    if (!_selectDrag.dragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      _selectDrag.dragging = true;
      _state.selectedStagedIds.forEach(function(id) {
        var el = document.querySelector('[data-staged-id="' + id + '"]');
        if (el) el.classList.add('bwbr-staged-item--dragging');
      });
    }
    if (!_selectDrag.dragging) return;
    var scale = getZoomScale();
    var tileDx = Math.round(dx / (scale * CELL_PX));
    var tileDy = Math.round(dy / (scale * CELL_PX));
    _state.selectedStagedIds.forEach(function(id) {
      var obj = _state.stagedObjects.find(function(o) { return o.id === id; });
      var orig = _selectDrag.start.origins && _selectDrag.start.origins[id];
      if (!obj || !orig) return;
      obj.mapCoords.x = orig.x + tileDx;
      obj.mapCoords.y = orig.y + tileDy;
      var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
      if (el) {
        el.style.left = (obj.mapCoords.x * CELL_PX) + 'px';
        el.style.top = (obj.mapCoords.y * CELL_PX) + 'px';
      }
    });
  });

  document.addEventListener('mouseup', function(e) {
    if (e.button !== 0) return;
    if (_selectDrag.dragging) {
      _state.selectedStagedIds.forEach(function(id) {
        var el = document.querySelector('[data-staged-id="' + id + '"]');
        if (el) el.classList.remove('bwbr-staged-item--dragging');
      });
    }
    _selectDrag.start = null;
    _selectDrag.dragging = false;
  });

  // 빈 공간 클릭 → 선택 해제
  document.addEventListener('mousedown', function(e) {
    if (!_state.active || e.button !== 0) return;
    if (_overlay.classList.contains('bwbr-placement-overlay--active')) return;
    if (e.target.closest('.bwbr-staged-item')) return;
    if (e.target.closest('.bwbr-placement-toolbar')) return;
    if (e.target.closest('.bwbr-place-confirm-bar')) return;
    // Alt+드래그 → 범위 선택 (오버레이 없을 때도 동작)
    if (e.altKey && _state.stagedObjects.length > 0) {
      _altBoxSelect.active = true;
      _altBoxSelect.startX = e.clientX;
      _altBoxSelect.startY = e.clientY;
      var rect = document.createElement('div');
      rect.className = 'bwbr-place-select-rect';
      rect.style.left = e.clientX + 'px';
      rect.style.top = e.clientY + 'px';
      rect.style.width = '0';
      rect.style.height = '0';
      document.body.appendChild(rect);
      _altBoxSelect.rectEl = rect;
      deselectStaged();
      e.preventDefault();
      return;
    }
    deselectStaged();
  });

  // Alt 범위 선택용 mousemove/mouseup (document 레벨)
  document.addEventListener('mousemove', function(e) {
    if (_altBoxSelect.active && _altBoxSelect.rectEl) {
      var l = Math.min(_altBoxSelect.startX, e.clientX);
      var t = Math.min(_altBoxSelect.startY, e.clientY);
      _altBoxSelect.rectEl.style.left = l + 'px';
      _altBoxSelect.rectEl.style.top = t + 'px';
      _altBoxSelect.rectEl.style.width = Math.abs(e.clientX - _altBoxSelect.startX) + 'px';
      _altBoxSelect.rectEl.style.height = Math.abs(e.clientY - _altBoxSelect.startY) + 'px';
    }
  });
  document.addEventListener('mouseup', function(e) {
    if (_altBoxSelect.active) {
      finishAltBoxSelect();
    }
  });
}


// ── 확인 바 (하단 중앙) ─────────────────────────────────────────

function createConfirmBar() {
  _confirmBar = document.createElement('div');
  _confirmBar.className = 'bwbr-place-confirm-bar';

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'bwbr-place-confirm-bar-btn bwbr-place-cancel-btn';
  cancelBtn.textContent = '전체 취소';
  cancelBtn.addEventListener('click', clearAllStaged);

  _stagedCountEl = document.createElement('span');
  _stagedCountEl.className = 'bwbr-place-staged-count';
  _stagedCountEl.textContent = '0개';

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'bwbr-place-confirm-bar-btn bwbr-place-confirm-btn';
  confirmBtn.textContent = '✓ 확인';
  confirmBtn.addEventListener('click', compositeAndCommit);

  _confirmBar.appendChild(cancelBtn);
  _confirmBar.appendChild(_stagedCountEl);
  _confirmBar.appendChild(confirmBtn);

  document.body.appendChild(_confirmBar);
}

function updateConfirmBar() {
  var count = _state.stagedObjects.length;
  if (count > 0) {
    _confirmBar.classList.add('bwbr-place-confirm-bar--visible');
    _stagedCountEl.textContent = count + '개 배치됨';
  } else {
    _confirmBar.classList.remove('bwbr-place-confirm-bar--visible');
  }
}


// ── 합성 확정 (하나의 이미지로 합성 → Firestore) ────────────────

function compositeAndCommit() {
  if (_state.stagedObjects.length === 0) return;

  // 확인 시에도 DOM에서 설정 다시 읽기 → 모든 스테이징에 반영
  readSettingsFromDOM();
  _state.stagedObjects.forEach(function(obj) {
    obj.settings.type = _state.panelSettings.type;
    obj.settings.z = _state.panelSettings.z;
    obj.settings.memo = _state.panelSettings.memo;
    obj.settings.locked = _state.panelSettings.locked;
    obj.settings.freezed = _state.panelSettings.freezed;
  });

  // 1. 바운딩 박스 계산 (타일 좌표)
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  _state.stagedObjects.forEach(function (obj) {
    var mc = obj.mapCoords;
    minX = Math.min(minX, mc.x);
    minY = Math.min(minY, mc.y);
    maxX = Math.max(maxX, mc.x + mc.width);
    maxY = Math.max(maxY, mc.y + mc.height);
  });
  var bboxW = maxX - minX;
  var bboxH = maxY - minY;
  var s = _state.stagedObjects[0].settings;

  console.log('[CE 배치] 확인 → settings:', JSON.stringify(s), '/ bbox:', bboxW + '×' + bboxH);

  // 단일 오브젝트 + URL 이미지 → 합성 없이 직접 생성
  if (_state.stagedObjects.length === 1 && _state.stagedObjects[0].imageDataUrl &&
      !_state.stagedObjects[0].imageDataUrl.startsWith('data:')) {
    var obj0 = _state.stagedObjects[0];
    var panelData = {
      type: s.type, x: obj0.mapCoords.x, y: obj0.mapCoords.y, z: s.z,
      width: obj0.mapCoords.width, height: obj0.mapCoords.height,
      angle: obj0.angle || 0, memo: s.memo, locked: s.locked, freezed: s.freezed,
      imageUrl: obj0.imageDataUrl
    };
    document.documentElement.setAttribute('data-bwbr-create-panel', JSON.stringify(panelData));
    document.dispatchEvent(new CustomEvent('bwbr-create-panel'));
    clearAllStaged();
    return;
  }

  // 2. 캔버스 생성
  var canvas = document.createElement('canvas');
  canvas.width = bboxW * COMPOSITE_PX_PER_TILE;
  canvas.height = bboxH * COMPOSITE_PX_PER_TILE;
  var ctx = canvas.getContext('2d');

  // 3. 모든 이미지 로드 후 합성
  var total = _state.stagedObjects.length;
  var loaded = 0;
  var images = new Array(total);

  _state.stagedObjects.forEach(function (obj, i) {
    if (!obj.imageDataUrl) {
      images[i] = null;
      loaded++;
      if (loaded === total) finishComposite();
      return;
    }
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      images[i] = img;
      loaded++;
      if (loaded === total) finishComposite();
    };
    img.onerror = function () {
      images[i] = null;
      loaded++;
      if (loaded === total) finishComposite();
    };
    img.src = obj.imageDataUrl;
  });

  function finishComposite() {
    _state.stagedObjects.forEach(function (obj, i) {
      if (!images[i]) return;
      var mc = obj.mapCoords;
      var dx = (mc.x - minX) * COMPOSITE_PX_PER_TILE;
      var dy = (mc.y - minY) * COMPOSITE_PX_PER_TILE;
      var dw = mc.width * COMPOSITE_PX_PER_TILE;
      var dh = mc.height * COMPOSITE_PX_PER_TILE;

      ctx.save();
      if (obj.angle) {
        ctx.translate(dx + dw / 2, dy + dh / 2);
        ctx.rotate(obj.angle * Math.PI / 180);
        ctx.drawImage(images[i], -dw / 2, -dh / 2, dw, dh);
      } else {
        ctx.drawImage(images[i], dx, dy, dw, dh);
      }
      ctx.restore();
    });

    var dataUrl;
    try {
      dataUrl = compressCanvasToDataUrl(canvas);
    } catch (err) {
      console.warn('[CE 배치] 캔버스 합성 실패 (CORS), 개별 패널 생성으로 대체:', err.message);
      commitIndividualPanels();
      return;
    }

    console.log('[CE 배치] 합성 완료:', bboxW + '×' + bboxH + '타일,', total + '개 이미지,', Math.round(dataUrl.length / 1024) + 'KB');

    var panelData = {
      type: s.type, x: minX, y: minY, z: s.z,
      width: bboxW, height: bboxH, angle: 0,
      memo: s.memo, locked: s.locked, freezed: s.freezed,
      imageUrl: dataUrl
    };

    document.documentElement.setAttribute('data-bwbr-create-panel', JSON.stringify(panelData));
    document.dispatchEvent(new CustomEvent('bwbr-create-panel'));
    clearAllStaged();
  }

  // CORS 실패 시 개별 패널 생성 펴백
  function commitIndividualPanels() {
    _state.stagedObjects.forEach(function(obj) {
      var mc = obj.mapCoords;
      var panelData = {
        type: s.type, x: mc.x, y: mc.y, z: s.z,
        width: mc.width, height: mc.height, angle: obj.angle || 0,
        memo: s.memo, locked: s.locked, freezed: s.freezed,
        imageUrl: obj.imageDataUrl || ''
      };
      document.documentElement.setAttribute('data-bwbr-create-panel', JSON.stringify(panelData));
      document.dispatchEvent(new CustomEvent('bwbr-create-panel'));
    });
    clearAllStaged();
  }
}

function compressCanvasToDataUrl(canvas) {
  var maxLen = 900000;
  var qualities = [0.85, 0.7, 0.5, 0.3];
  for (var i = 0; i < qualities.length; i++) {
    var url = canvas.toDataURL('image/webp', qualities[i]);
    if (url.length < maxLen) return url;
  }
  var half = document.createElement('canvas');
  half.width = Math.floor(canvas.width / 2);
  half.height = Math.floor(canvas.height / 2);
  half.getContext('2d').drawImage(canvas, 0, 0, half.width, half.height);
  return half.toDataURL('image/webp', 0.5);
}


// ── 맵 좌표 유틸리티 ────────────────────────────────────────────

function getZoomContainer() {
  var m = document.querySelector('.movable');
  return m ? m.parentElement : null;
}

function getZoomScale() {
  var zoomEl = getZoomContainer();
  if (!zoomEl) return 1;
  var t = getComputedStyle(zoomEl).transform;
  if (!t || t === 'none') return 1;
  var m = t.match(/matrix\(([^,]+)/);
  return m ? parseFloat(m[1]) : 1;
}

function getMapOriginOnScreen() {
  var zoomEl = getZoomContainer();
  if (!zoomEl) return null;
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;';
  zoomEl.appendChild(probe);
  var rect = probe.getBoundingClientRect();
  zoomEl.removeChild(probe);
  return { x: rect.left, y: rect.top };
}

function screenToMapCoords(screenRect) {
  var origin = getMapOriginOnScreen();
  if (!origin) {
    console.warn('[CE 배치] 맵 요소를 찾을 수 없습니다.');
    return null;
  }
  var scale = getZoomScale();
  var mapPxX = (screenRect.x - origin.x) / scale;
  var mapPxY = (screenRect.y - origin.y) / scale;
  var mapPxW = screenRect.w / scale;
  var mapPxH = screenRect.h / scale;
  return {
    x: Math.round(mapPxX / CELL_PX),
    y: Math.round(mapPxY / CELL_PX),
    width: Math.max(1, Math.round(mapPxW / CELL_PX)),
    height: Math.max(1, Math.round(mapPxH / CELL_PX))
  };
}


// ── 키보드 단축키 ───────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (!_state.active) return;

    // Escape: 단계별 취소 (입력 중에도 동작)
    if (e.key === 'Escape') {
      if (_state.placing) {
        _state.placing = false;
        _preview.classList.remove('bwbr-placement-preview--visible');
        _preview.innerHTML = '';
      } else if (_state.selectedStagedIds.length > 0) {
        deselectStaged();
      } else if (_state.stagedObjects.length > 0) {
        clearAllStaged();
      } else if (_state.mode) {
        deactivateMode();
      } else {
        togglePlacementMode();
      }
      return;
    }

    // 입력 필드에서는 나머지 단축키 무시
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // V: 선택 모드 (편집 해제)
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      deactivateMode();
      return;
    }

    // A: 편집 모드 토글
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      activateMode('edit');
      return;
    }

    // I / T / D: 편집 모드 서브 도구
    if (_state.mode === 'edit') {
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setSubTool('image'); return; }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); setSubTool('text'); return; }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setSubTool('draw'); return; }
    }

    // R: 선택된 스테이징 오브젝트 회전 (15도 단위)
    if ((e.key === 'r' || e.key === 'R') && _state.selectedStagedIds.length > 0) {
      e.preventDefault();
      rotateSelectedStaged(e.shiftKey ? -15 : 15);
    }

    // Delete / Backspace: 선택된 스테이징 오브젝트 삭제
    if ((e.key === 'Delete' || e.key === 'Backspace') && _state.selectedStagedIds.length > 0) {
      e.preventDefault();
      removeSelectedStaged();
    }
  });
}

var _angleTimeout = null;

function showAngleIndicator(angle) {
  _angleIndicator.textContent = angle + '°';
  _angleIndicator.style.left = '50%';
  _angleIndicator.style.top = '50%';
  _angleIndicator.style.transform = 'translate(-50%, -50%)';
  _angleIndicator.classList.add('bwbr-placement-angle-indicator--visible');
  clearTimeout(_angleTimeout);
  _angleTimeout = setTimeout(function () {
    _angleIndicator.classList.remove('bwbr-placement-angle-indicator--visible');
  }, 1200);
}


// ── 모듈 시작 ───────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
