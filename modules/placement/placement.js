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
  max-height: 400px;
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

/* ── 배치 오버레이 (캔버스 영역) ───────────────── */

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

/* ── 배치 프리뷰 (드래그 중 표시) ──────────────── */

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

/* ── 회전 표시 ─────────────────────────────────── */

.bwbr-placement-angle-indicator {
  position: fixed;
  background: rgba(33,33,33,0.85);
  color: #fff;
  font-size: 14px;
  padding: 4px 12px;
  border-radius: 6px;
  pointer-events: none;
  z-index: 105;
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
  angle: 0,               // 현재 회전 각도

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
  pendingImage: null      // { url, file, width, height }
};


// ── DOM 요소 ────────────────────────────────────────────────────

var _toolbar = null;
var _settingsPanel = null;
var _overlay = null;
var _preview = null;
var _angleIndicator = null;
var _toolButtons = {};


// ── 초기화 ──────────────────────────────────────────────────────

function init() {
  createToolbar();
  createOverlay();
  registerFabButton();
  setupKeyboard();
}


// ── FAB 버튼 등록 ───────────────────────────────────────────────

function registerFabButton() {
  if (!window.BWBR_FabButtons) {
    // FAB 인프라 아직 미로드 → 재시도
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
    _settingsPanel.classList.remove('bwbr-place-settings--open');
  }
}


// ── 도구 전환 ───────────────────────────────────────────────────

function activateTool(toolId) {
  // 이전 도구 비활성화
  if (_state.currentTool && _toolButtons[_state.currentTool]) {
    _toolButtons[_state.currentTool].classList.remove('bwbr-place-tool-btn--active');
  }

  if (_state.currentTool === toolId) {
    // 같은 도구 다시 클릭 → 해제
    deactivateTool();
    return;
  }

  _state.currentTool = toolId;
  if (_toolButtons[toolId]) {
    _toolButtons[toolId].classList.add('bwbr-place-tool-btn--active');
  }

  // 패널 설정 열기
  _settingsPanel.classList.add('bwbr-place-settings--open');

  // 도구별 초기화
  if (toolId === 'image') {
    promptImageSource();
  }
}

function deactivateTool() {
  if (_state.currentTool && _toolButtons[_state.currentTool]) {
    _toolButtons[_state.currentTool].classList.remove('bwbr-place-tool-btn--active');
  }
  _state.currentTool = null;
  _state.placing = false;
  _state.pendingImage = null;
  _overlay.classList.remove('bwbr-placement-overlay--active');
  _preview.classList.remove('bwbr-placement-preview--visible');
  _settingsPanel.classList.remove('bwbr-place-settings--open');
}


// ── 툴바 생성 ───────────────────────────────────────────────────

function createToolbar() {
  _toolbar = document.createElement('div');
  _toolbar.className = 'bwbr-placement-toolbar';

  // 패널 설정 영역 (맨 위 = flex column-reverse이므로 DOM 첫번째)
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

  // 타입 토글 (마커/스크린)
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

  // 겹침 우선도 (z)
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

  // 패널 메모
  var memoField = createField('패널 메모');
  var memoInput = document.createElement('textarea');
  memoInput.placeholder = '메모 입력...';
  memoInput.addEventListener('input', function () {
    _state.panelSettings.memo = memoInput.value;
  });
  memoField.appendChild(memoInput);
  panel.appendChild(memoField);

  // 위치 고정
  var lockField = createToggleField('위치 고정', false, function (val) {
    _state.panelSettings.locked = val;
  });
  panel.appendChild(lockField);

  // 사이즈 고정
  var freezeField = createToggleField('사이즈 고정', false, function (val) {
    _state.panelSettings.freezed = val;
  });
  panel.appendChild(freezeField);

  return panel;
}

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


// ── 배치 오버레이 (투명 캔버스) ─────────────────────────────────

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

  // 드래그 이벤트
  _overlay.addEventListener('mousedown', onOverlayMouseDown);
  _overlay.addEventListener('mousemove', onOverlayMouseMove);
  _overlay.addEventListener('mouseup', onOverlayMouseUp);
}


// ── 이미지 소스 선택 ────────────────────────────────────────────

function promptImageSource() {
  // 간단한 선택 다이얼로그: 로컬 파일 vs ccfolia 피커
  // 우선 로컬 파일 업로드부터 구현
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
          // 오버레이 활성화 → 사용자가 맵에 클릭/드래그로 배치
          _overlay.classList.add('bwbr-placement-overlay--active');
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
    fileInput.remove();
  });

  fileInput.addEventListener('cancel', function () {
    fileInput.remove();
    deactivateTool();
  });

  fileInput.click();
}


// ── 오버레이 마우스 이벤트 ──────────────────────────────────────

function onOverlayMouseDown(e) {
  if (e.button !== 0) return;

  _state.placing = true;
  _state.drag.startX = e.clientX;
  _state.drag.startY = e.clientY;
  _state.drag.currentX = e.clientX;
  _state.drag.currentY = e.clientY;

  updatePreview();
  _preview.classList.add('bwbr-placement-preview--visible');

  // 이미지 프리뷰
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
  if (!_state.placing) return;
  _state.placing = false;
  _preview.classList.remove('bwbr-placement-preview--visible');
  _preview.innerHTML = '';

  var rect = getPreviewRect();
  if (rect.w < 5 && rect.h < 5) return; // 너무 작은 클릭 무시

  // ccfolia 맵 좌표로 변환 후 패널 생성 요청
  commitPlacement(rect);
}

function updatePreview() {
  var rect = getPreviewRect();
  _preview.style.left = rect.x + 'px';
  _preview.style.top = rect.y + 'px';
  _preview.style.width = rect.w + 'px';
  _preview.style.height = rect.h + 'px';
  if (_state.angle !== 0) {
    _preview.style.transform = 'rotate(' + _state.angle + 'deg)';
  } else {
    _preview.style.transform = '';
  }
}

function getPreviewRect() {
  var x = Math.min(_state.drag.startX, _state.drag.currentX);
  var y = Math.min(_state.drag.startY, _state.drag.currentY);
  var w = Math.abs(_state.drag.currentX - _state.drag.startX);
  var h = Math.abs(_state.drag.currentY - _state.drag.startY);
  return { x: x, y: y, w: w, h: h };
}


// ── 배치 확정 (Firestore 패널 생성) ─────────────────────────────

function commitPlacement(screenRect) {
  // 화면 좌표 → ccfolia 맵 좌표 변환
  var mapCoords = screenToMapCoords(screenRect);
  if (!mapCoords) return;

  console.log('[CE 배치] 화면:', screenRect, '→ 타일:', mapCoords, '(zoom:', getZoomScale().toFixed(2) + ')');

  var panelData = {
    type: _state.panelSettings.type,
    x: mapCoords.x,
    y: mapCoords.y,
    z: _state.panelSettings.z,
    width: mapCoords.width,
    height: mapCoords.height,
    angle: _state.angle,
    memo: _state.panelSettings.memo,
    locked: _state.panelSettings.locked,
    freezed: _state.panelSettings.freezed,
    imageUrl: '',
    active: true,
    visible: true,
    closed: false,
    withoutOwner: false,
    owner: '',
    ownerName: '',
    ownerColor: '',
    coverImageUrl: '',
    clickAction: '',
    deckId: null,
    order: -1
  };

  // 이미지 배치: 이미지 URL 설정 필요
  if (_state.currentTool === 'image' && _state.pendingImage) {
    // TODO: 이미지를 Firebase Storage에 업로드하고 URL을 받아야 함
    // 임시: dataUrl을 직접 사용 (작동하지 않을 수 있음)
    panelData.imageUrl = _state.pendingImage.dataUrl;
  }

  // 브릿지 이벤트로 MAIN world에 패널 생성 요청
  document.documentElement.setAttribute(
    'data-bwbr-create-panel',
    JSON.stringify(panelData)
  );
  window.dispatchEvent(new CustomEvent('bwbr-create-panel'));

  // 상태 초기화
  _state.angle = 0;
  _state.pendingImage = null;

  // 오버레이 비활성화 (계속 배치하려면 도구 다시 클릭)
  _overlay.classList.remove('bwbr-placement-overlay--active');
}


// ── 맵 좌표 유틸리티 ────────────────────────────────────────────

var CELL_PX = 24;  // ccfolia 1타일 = 24px

/**
 * zoom 컨테이너 찾기 (.movable 토큰의 부모)
 */
function getZoomContainer() {
  var m = document.querySelector('.movable');
  return m ? m.parentElement : null;
}

/**
 * zoom 컨테이너의 scale 값 추출
 * transform: matrix(scale, 0, 0, scale, ...) 또는 scale(N) 파싱
 */
function getZoomScale() {
  var zoomEl = getZoomContainer();
  if (!zoomEl) return 1;
  var t = getComputedStyle(zoomEl).transform;
  if (!t || t === 'none') return 1;
  var m = t.match(/matrix\(([^,]+)/);
  return m ? parseFloat(m[1]) : 1;
}

/**
 * 맵 원점의 화면 좌표를 구합니다.
 * zoom 컨테이너 내부 (0,0)에 임시 probe 요소를 삽입하여
 * getBoundingClientRect()로 화면 위치를 측정합니다.
 * @returns {{ x: number, y: number } | null}
 */
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

/**
 * 화면 좌표(screenRect) → ccfolia 맵 타일 좌표 변환
 *
 * 변환 체인:
 *   screen position
 *   → (- mapOrigin) : 맵 원점 기준 상대 위치 (화면 픽셀)
 *   → (÷ zoomScale) : zoom 보정 → 맵 픽셀
 *   → (÷ 24)        : 맵 픽셀 → 타일 좌표
 *
 * @param {{ x: number, y: number, w: number, h: number }} screenRect
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function screenToMapCoords(screenRect) {
  var origin = getMapOriginOnScreen();
  if (!origin) {
    console.warn('[CE 배치] 맵 요소를 찾을 수 없습니다. (.movable 토큰이 없음)');
    return null;
  }

  var scale = getZoomScale();

  // 화면 픽셀 → 맵 픽셀 (zoom 역변환)
  var mapPxX = (screenRect.x - origin.x) / scale;
  var mapPxY = (screenRect.y - origin.y) / scale;
  var mapPxW = screenRect.w / scale;
  var mapPxH = screenRect.h / scale;

  // 맵 픽셀 → 타일 좌표
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

    // R: 회전 (15도 단위)
    if (e.key === 'r' || e.key === 'R') {
      // 입력 필드 내에서는 무시
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      e.preventDefault();
      _state.angle = (_state.angle + (e.shiftKey ? -15 : 15)) % 360;
      if (_state.angle < 0) _state.angle += 360;

      // 프리뷰 업데이트
      if (_state.placing) {
        updatePreview();
      }

      // 각도 표시
      showAngleIndicator();
    }

    // Escape: 배치 모드 종료
    if (e.key === 'Escape') {
      if (_state.placing) {
        // 배치 중이면 배치 취소
        _state.placing = false;
        _preview.classList.remove('bwbr-placement-preview--visible');
        _preview.innerHTML = '';
        _overlay.classList.remove('bwbr-placement-overlay--active');
      } else if (_state.currentTool) {
        deactivateTool();
      } else {
        togglePlacementMode();
      }
    }
  });
}

var _angleTimeout = null;

function showAngleIndicator() {
  _angleIndicator.textContent = _state.angle + '°';
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

// DOM 준비 후 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
