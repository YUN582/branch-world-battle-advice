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

var CELL_PX = 24;  // ccfolia 1타일 = 24px
var COMPOSITE_PX_PER_TILE = 96;  // 합성 이미지 해상도 (1타일 = 96px)

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
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.18);
  padding: 12px;
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 4px;
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              padding 0.25s;
  padding: 0 12px;
}

.bwbr-place-settings--open {
  max-height: 600px;
  opacity: 1;
  padding: 12px;
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

.bwbr-placement-overlay--no-image {
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
  border-color: #ff9800;
  border-width: 3px;
  box-shadow: 0 0 12px rgba(255, 152, 0, 0.5);
}

.bwbr-staged-item--selected .bwbr-staged-badge {
  background: #ff9800;
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
  currentTool: null,      // 'image' | 'text' | 'draw' | null
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
  pendingImage: null,     // { dataUrl, file, width, height }

  // 스테이징 (일괄 배치)
  stagedObjects: [],      // [{ id, mapCoords, angle, imageDataUrl, settings }]
  selectedStagedId: null  // 선택된 스테이징 오브젝트 ID
};


// ── DOM 요소 ────────────────────────────────────────────────────

var _toolbar = null;
var _settingsPanel = null;
var _overlay = null;
var _preview = null;
var _angleIndicator = null;
var _toolButtons = {};
var _imageSourceMenu = null;
var _currentImagePreview = null;
var _confirmBar = null;
var _stagedCountEl = null;


// ── 초기화 ──────────────────────────────────────────────────────

function init() {
  createToolbar();
  createOverlay();
  createConfirmBar();
  registerFabButton();
  setupKeyboard();
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

function togglePlacementMode() {
  _state.active = !_state.active;

  if (window.BWBR_FabButtons) {
    window.BWBR_FabButtons.setActive('placement', _state.active);
  }

  if (_state.active) {
    _toolbar.classList.add('bwbr-placement-toolbar--open');
  } else {
    _toolbar.classList.remove('bwbr-placement-toolbar--open');
    deactivateTool();
    clearAllStaged();
  }
}


// ── 도구 전환 ───────────────────────────────────────────────────

function activateTool(toolId) {
  // 이전 도구 비활성화 (스타일만)
  if (_state.currentTool && _toolButtons[_state.currentTool]) {
    _toolButtons[_state.currentTool].classList.remove('bwbr-place-tool-btn--active');
  }

  if (_state.currentTool === toolId) {
    deactivateTool();
    return;
  }

  _state.currentTool = toolId;
  if (_toolButtons[toolId]) {
    _toolButtons[toolId].classList.add('bwbr-place-tool-btn--active');
  }

  // 패널 설정 열기
  _settingsPanel.classList.add('bwbr-place-settings--open');

  // 이미지 소스 메뉴 표시/숨김
  if (toolId === 'image') {
    if (_imageSourceMenu) _imageSourceMenu.style.display = '';
    // 오버레이 활성화 (이미지 미선택 시 커서 변경)
    _overlay.classList.add('bwbr-placement-overlay--active');
    updateOverlayCursor();
  } else {
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    _overlay.classList.add('bwbr-placement-overlay--active');
    _overlay.classList.remove('bwbr-placement-overlay--no-image');
  }
}

function deactivateTool() {
  if (_state.currentTool && _toolButtons[_state.currentTool]) {
    _toolButtons[_state.currentTool].classList.remove('bwbr-place-tool-btn--active');
  }
  _state.currentTool = null;
  _state.placing = false;
  _overlay.classList.remove('bwbr-placement-overlay--active');
  _overlay.classList.remove('bwbr-placement-overlay--no-image');
  _preview.classList.remove('bwbr-placement-preview--visible');
  _settingsPanel.classList.remove('bwbr-place-settings--open');
}

function updateOverlayCursor() {
  if (_state.currentTool === 'image' && !_state.pendingImage) {
    _overlay.classList.add('bwbr-placement-overlay--no-image');
  } else {
    _overlay.classList.remove('bwbr-placement-overlay--no-image');
  }
}


// ── 툴바 생성 ───────────────────────────────────────────────────

function createToolbar() {
  _toolbar = document.createElement('div');
  _toolbar.className = 'bwbr-placement-toolbar';

  // 패널 설정 영역
  _settingsPanel = createSettingsPanel();
  _toolbar.appendChild(_settingsPanel);

  // 도구 버튼들
  var tools = [
    { id: 'image', label: '이미지 배치', icon: TOOL_ICONS.image },
    { id: 'text',  label: '텍스트 · 도형', icon: TOOL_ICONS.text },
    { id: 'draw',  label: '그리기', icon: TOOL_ICONS.draw }
  ];

  tools.forEach(function (tool) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-place-tool-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24">' + tool.icon + '</svg>' +
      '<span class="bwbr-place-tooltip">' + tool.label + '</span>';
    btn.addEventListener('click', function () { activateTool(tool.id); });
    _toolbar.appendChild(btn);
    _toolButtons[tool.id] = btn;
  });

  document.body.appendChild(_toolbar);
}


// ── 패널 설정 패널 ──────────────────────────────────────────────

function createSettingsPanel() {
  var panel = document.createElement('div');
  panel.className = 'bwbr-place-settings';

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

  // 메모
  var memoField = createField('패널 메모');
  var memoInput = document.createElement('textarea');
  memoInput.placeholder = '메모 입력...';
  memoInput.addEventListener('input', function () {
    _state.panelSettings.memo = memoInput.value;
  });
  memoField.appendChild(memoInput);
  panel.appendChild(memoField);

  // 위치 고정
  panel.appendChild(createToggleField('위치 고정', false, function (val) {
    _state.panelSettings.locked = val;
  }));

  // 사이즈 고정
  panel.appendChild(createToggleField('사이즈 고정', false, function (val) {
    _state.panelSettings.freezed = val;
  }));

  return panel;
}


// ── 이미지 소스 메뉴 ────────────────────────────────────────────

function createImageSourceMenu() {
  var menu = document.createElement('div');
  menu.className = 'bwbr-place-source-menu';
  menu.style.display = 'none'; // 이미지 도구 선택 시에만 보임

  var localBtn = document.createElement('button');
  localBtn.className = 'bwbr-place-source-btn';
  localBtn.textContent = '📁 로컬 이미지';
  localBtn.addEventListener('click', selectLocalImage);
  menu.appendChild(localBtn);

  var ccoBtn = document.createElement('button');
  ccoBtn.className = 'bwbr-place-source-btn';
  ccoBtn.textContent = '🖼️ 코코포리아 이미지';
  ccoBtn.addEventListener('click', selectCcofoliaImage);
  menu.appendChild(ccoBtn);

  // 현재 선택된 이미지 프리뷰
  _currentImagePreview = document.createElement('div');
  _currentImagePreview.className = 'bwbr-place-current-image';
  _currentImagePreview.style.display = 'none';
  menu.appendChild(_currentImagePreview);

  return menu;
}

function updateCurrentImagePreview() {
  if (!_currentImagePreview) return;

  if (_state.pendingImage) {
    var fileName = _state.pendingImage.file
      ? _state.pendingImage.file.name
      : '이미지';
    _currentImagePreview.innerHTML = '';

    var img = document.createElement('img');
    img.src = _state.pendingImage.dataUrl;
    _currentImagePreview.appendChild(img);

    var name = document.createElement('span');
    name.textContent = fileName;
    _currentImagePreview.appendChild(name);

    var clearBtn = document.createElement('button');
    clearBtn.className = 'bwbr-place-clear-img';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', function () {
      _state.pendingImage = null;
      updateCurrentImagePreview();
      updateOverlayCursor();
    });
    _currentImagePreview.appendChild(clearBtn);

    _currentImagePreview.style.display = '';
  } else {
    _currentImagePreview.style.display = 'none';
  }
}


// ── 로컬 이미지 선택 ────────────────────────────────────────────

function selectLocalImage() {
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) {
      var file = fileInput.files[0];
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          _state.pendingImage = {
            dataUrl: e.target.result,
            file: file,
            width: img.naturalWidth,
            height: img.naturalHeight
          };
          updateCurrentImagePreview();
          updateOverlayCursor();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
    fileInput.remove();
  });

  fileInput.addEventListener('cancel', function () {
    fileInput.remove();
    // 취소해도 도구 해제하지 않음 — 연속 배치 지원
  });

  fileInput.click();
}


// ── 코코포리아 이미지 선택 (TODO) ───────────────────────────────

function selectCcofoliaImage() {
  // TODO: ccfolia 이미지 피커 브릿지 연동
  console.log('[CE 배치] 코코포리아 이미지 선택 — 미구현');
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
}


// ── 오버레이 마우스 이벤트 ──────────────────────────────────────

function onOverlayMouseDown(e) {
  if (e.button !== 0) return;

  // 드래그 시작 좌표 기록 (클릭 감지용)
  _state.drag.startX = e.clientX;
  _state.drag.startY = e.clientY;
  _state.drag.currentX = e.clientX;
  _state.drag.currentY = e.clientY;

  // 이미지 도구에서 이미지 미선택 시 클릭만 허용 (선택용)
  if (_state.currentTool === 'image' && !_state.pendingImage) return;

  _state.placing = true;
  updatePreview();
  _preview.classList.add('bwbr-placement-preview--visible');

  if (_state.currentTool === 'image' && _state.pendingImage) {
    _preview.innerHTML = '<img src="' + _state.pendingImage.dataUrl + '" alt="">';
  }
}

function onOverlayMouseMove(e) {
  if (!_state.placing) return;
  _state.drag.currentX = e.clientX;
  _state.drag.currentY = e.clientY;
  updatePreview();
}

function onOverlayMouseUp(e) {
  var dx = Math.abs(e.clientX - _state.drag.startX);
  var dy = Math.abs(e.clientY - _state.drag.startY);
  var isClick = dx < 5 && dy < 5;

  if (isClick) {
    // 클릭 → 스테이징 오브젝트 선택/해제
    _state.placing = false;
    _preview.classList.remove('bwbr-placement-preview--visible');
    _preview.innerHTML = '';
    var hit = hitTestStaged(e.clientX, e.clientY);
    if (hit) {
      selectStagedItem(hit.id);
    } else {
      deselectStaged();
    }
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

  console.log('[CE 배치] 스테이징:', screenRect, '→ 타일:', mapCoords);

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
  el.className = 'bwbr-staged-item';
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

  zoomEl.appendChild(el);
}

function clearAllStaged() {
  _state.stagedObjects = [];
  _state.selectedStagedId = null;
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
  if (_state.selectedStagedId === last.id) _state.selectedStagedId = null;
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

function selectStagedItem(id) {
  deselectStaged();
  _state.selectedStagedId = id;
  var el = document.querySelector('[data-staged-id="' + id + '"]');
  if (el) el.classList.add('bwbr-staged-item--selected');
}

function deselectStaged() {
  if (_state.selectedStagedId) {
    var el = document.querySelector('[data-staged-id="' + _state.selectedStagedId + '"]');
    if (el) el.classList.remove('bwbr-staged-item--selected');
  }
  _state.selectedStagedId = null;
}

function removeSelectedStaged() {
  if (!_state.selectedStagedId) return;
  var idx = _state.stagedObjects.findIndex(function (o) { return o.id === _state.selectedStagedId; });
  if (idx === -1) return;
  var el = document.querySelector('[data-staged-id="' + _state.selectedStagedId + '"]');
  if (el) el.remove();
  _state.stagedObjects.splice(idx, 1);
  _state.selectedStagedId = null;
  renumberStagedBadges();
  updateConfirmBar();
}

function rotateSelectedStaged(delta) {
  if (!_state.selectedStagedId) return;
  var obj = _state.stagedObjects.find(function (o) { return o.id === _state.selectedStagedId; });
  if (!obj) return;
  obj.angle = ((obj.angle || 0) + delta) % 360;
  if (obj.angle < 0) obj.angle += 360;
  var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
  if (el) {
    el.style.transform = obj.angle ? 'rotate(' + obj.angle + 'deg)' : '';
  }
  showAngleIndicator(obj.angle);
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

    var dataUrl = canvas.toDataURL('image/png');
    console.log('[CE 배치] 합성 완료:', bboxW + '×' + bboxH + '타일,', total + '개 이미지');

    // 설정은 첫 번째 오브젝트의 settings 사용
    var s = _state.stagedObjects[0].settings;
    var panelData = {
      type: s.type,
      x: minX,
      y: minY,
      z: s.z,
      width: bboxW,
      height: bboxH,
      angle: 0,
      memo: s.memo,
      locked: s.locked,
      freezed: s.freezed,
      imageUrl: dataUrl
    };

    document.documentElement.setAttribute(
      'data-bwbr-create-panel',
      JSON.stringify(panelData)
    );
    window.dispatchEvent(new CustomEvent('bwbr-create-panel'));

    clearAllStaged();
  }
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

    // R: 선택된 스테이징 오브젝트 회전 (15도 단위)
    if (e.key === 'r' || e.key === 'R') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!_state.selectedStagedId) return;
      e.preventDefault();
      rotateSelectedStaged(e.shiftKey ? -15 : 15);
    }

    // Delete / Backspace: 선택된 스테이징 오브젝트 삭제
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (_state.selectedStagedId) {
        e.preventDefault();
        removeSelectedStaged();
      }
    }

    // Escape: 단계별 취소
    if (e.key === 'Escape') {
      if (_state.placing) {
        _state.placing = false;
        _preview.classList.remove('bwbr-placement-preview--visible');
        _preview.innerHTML = '';
      } else if (_state.selectedStagedId) {
        deselectStaged();
      } else if (_state.stagedObjects.length > 0) {
        clearAllStaged();
      } else if (_state.currentTool) {
        deactivateTool();
      } else {
        togglePlacementMode();
      }
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
