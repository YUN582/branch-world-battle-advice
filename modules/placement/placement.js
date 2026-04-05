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
  shape: '<path fill="currentColor" d="M11,13.5V21.5H3V13.5H11M12,2L17.5,11H6.5L12,2M17.5,13C20,13 22,15 22,17.5C22,20 20,22 17.5,22C15,22 13,20 13,17.5C13,15 15,13 17.5,13Z"/>',
  draw: '<path fill="currentColor" d="M20.71 7.04C21.1 6.65 21.1 6 20.71 5.63L18.37 3.29C18 2.9 17.35 2.9 16.96 3.29L15.12 5.12L18.87 8.87M3 17.25V21H6.75L17.81 9.93L14.06 6.18L3 17.25Z"/>'
};

var MODE_ICONS = {
  select: '<path fill="currentColor" d="M7 2l12 11.2-5.8.5 3.3 7.3-2.2 1-3.2-7.4L7 18.5V2z"/>',
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

.bwbr-place-toolbar-sep {
  width: 48px;
  height: 1px;
  background: rgba(0,0,0,0.12);
  margin: 2px 0;
  flex-shrink: 0;
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
  padding: 6px 16px;
  border: none;
  background: #fafafa;
  font-size: 12px;
  cursor: pointer;
  color: #666;
  white-space: nowrap;
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

/* ── 배치 모드 텍스트 선택 차단 ─────────────────── */

body.bwbr-placement-noselect,
body.bwbr-placement-noselect * {
  -webkit-user-select: none !important;
  user-select: none !important;
}
/* 텍스트 편집기 내부는 선택 허용 */
body.bwbr-placement-noselect .bwbr-text-editor,
body.bwbr-placement-noselect .bwbr-text-editor * {
  -webkit-user-select: text !important;
  user-select: text !important;
}

/* ── 배치 오버레이 ─────────────────────────────── */

.bwbr-placement-overlay {
  position: fixed;
  inset: 0;
  z-index: 102;
  cursor: crosshair;
  display: none;
  touch-action: none;
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
  outline: 2px dashed rgba(66, 165, 245, 0.6);
  outline-offset: -2px;
  background: rgba(66, 165, 245, 0.08);
  box-sizing: border-box;
  pointer-events: none;
  z-index: 99999;
}

.bwbr-staged-item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  opacity: 0.65;
  pointer-events: none;
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
  z-index: 100001;
  pointer-events: none;
}

.bwbr-staged-item--selected {
  outline-color: rgba(255,152,0,0.85);
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

/* 리사이즈 핸들 */
.bwbr-resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #fff;
  border: 2px solid #ff9800;
  border-radius: 2px;
  z-index: 100000;
  pointer-events: auto;
  box-sizing: border-box;
}
.bwbr-resize-handle--nw { top:-5px; left:-5px; cursor:nw-resize; }
.bwbr-resize-handle--n  { top:-5px; left:50%; margin-left:-5px; cursor:n-resize; }
.bwbr-resize-handle--ne { top:-5px; right:-5px; cursor:ne-resize; }
.bwbr-resize-handle--e  { top:50%; margin-top:-5px; right:-5px; cursor:e-resize; }
.bwbr-resize-handle--se { bottom:-5px; right:-5px; cursor:se-resize; }
.bwbr-resize-handle--s  { bottom:-5px; left:50%; margin-left:-5px; cursor:s-resize; }
.bwbr-resize-handle--sw { bottom:-5px; left:-5px; cursor:sw-resize; }
.bwbr-resize-handle--w  { top:50%; margin-top:-5px; left:-5px; cursor:w-resize; }

/* 커스텀 툴팁 */
.bwbr-tooltip {
  position: fixed;
  background: rgba(40,40,40,0.95);
  color: #fff;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  pointer-events: none;
  z-index: 200000;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  opacity: 0;
  transition: opacity 0.15s;
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
  transform: translateX(-50%) translateY(20px);
  /* left는 JS에서 필드 영역 기준으로 재계산됨 */
  z-index: 105;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border-radius: 12px;
  padding: 8px 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.bwbr-place-confirm-bar--visible {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
  pointer-events: auto;
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

.bwbr-place-confirm-btn:disabled {
  background: #ccc;
  color: #fff;
  cursor: default;
}

/* ── 확인 설정 다이얼로그 ──────────────────────── */

.bwbr-place-confirm-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 200000;
  background: rgba(0,0,0,0.4);
  display: none;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.bwbr-place-confirm-dialog-overlay--open {
  opacity: 1;
}

.bwbr-place-confirm-dialog {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.22);
  padding: 20px 24px;
  width: 400px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transform: translateY(12px);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.bwbr-place-confirm-dialog-overlay--open .bwbr-place-confirm-dialog {
  transform: translateY(0);
}

.bwbr-place-confirm-dialog-title {
  font-size: 15px;
  font-weight: 600;
  color: #222;
  margin: 0;
  padding-bottom: 4px;
  border-bottom: 1px solid #eee;
}

.bwbr-place-confirm-dialog-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.bwbr-place-confirm-dialog-row .bwbr-place-field {
  flex: 0 0 auto;
}

.bwbr-place-confirm-dialog-row label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #333;
  white-space: nowrap;
}

.bwbr-place-confirm-dialog textarea {
  width: 100%;
  min-height: 80px;
  max-height: 200px;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  background: #fafafa;
  box-sizing: border-box;
  resize: vertical;
}

.bwbr-place-confirm-dialog input[type="number"] {
  width: 60px;
  padding: 4px 6px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  background: #fafafa;
  text-align: center;
}

.bwbr-place-confirm-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.bwbr-place-confirm-dialog-actions button {
  padding: 7px 20px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.bwbr-place-confirm-dialog-actions .bwbr-dlg-cancel {
  background: #f5f5f5;
  color: #666;
}

.bwbr-place-confirm-dialog-actions .bwbr-dlg-cancel:hover {
  background: #eee;
}

.bwbr-place-confirm-dialog-actions .bwbr-dlg-ok {
  background: #42a5f5;
  color: #fff;
}

.bwbr-place-confirm-dialog-actions .bwbr-dlg-ok:hover {
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

/* ── 정렬 바 (상단 메뉴 아래 중앙) ────────────────── */

.bwbr-place-align-bar {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  /* left는 JS에서 필드 영역 기준으로 재계산됨 */
  z-index: 106;
  display: none;
  align-items: center;
  gap: 2px;
  background: #fff;
  border-radius: 10px;
  padding: 4px 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.18);
}

.bwbr-place-align-bar--visible {
  display: flex;
}

.bwbr-place-align-bar-sep {
  width: 1px;
  height: 20px;
  background: #ddd;
  margin: 0 4px;
}

.bwbr-place-align-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(0,0,0,0.54);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  position: relative;
}

.bwbr-place-align-btn:hover {
  background: #f0f0f0;
  color: rgba(0,0,0,0.87);
}

.bwbr-place-align-btn svg {
  width: 18px;
  height: 18px;
}

.bwbr-place-align-btn .bwbr-place-tooltip {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(33,33,33,0.9);
  color: #fff;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
}

.bwbr-place-align-btn:hover .bwbr-place-tooltip {
  opacity: 1;
}

/* ── 텍스트 도구 패널 ──────────────────────────── */

.bwbr-place-text-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}

/* ── 도형 도구 패널 ────────────────────────────── */

.bwbr-place-shape-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 0;
}

.bwbr-shape-type-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

.bwbr-shape-type-btn {
  width: 100%;
  border: 1.5px solid rgba(0,0,0,0.12);
  border-radius: 6px;
  background: rgba(0,0,0,0.03);
  color: rgba(0,0,0,0.55);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: row;
  gap: 4px;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  padding: 5px 6px;
}

.bwbr-shape-type-btn:hover {
  background: rgba(0,0,0,0.08);
  color: rgba(0,0,0,0.7);
}

.bwbr-shape-type-btn--active {
  border-color: #42a5f5;
  background: rgba(66,165,245,0.1);
  color: #1976d2;
}

.bwbr-shape-type-btn svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.bwbr-shape-type-btn span {
  font-size: 10px;
  white-space: nowrap;
  color: inherit;
  font-weight: 500;
}

.bwbr-shape-section-label {
  font-size: 11px;
  color: #555;
  font-weight: 600;
  margin-top: 4px;
}

.bwbr-shape-prop-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bwbr-shape-color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #ccc;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.bwbr-shape-color-swatch:hover {
  border-color: #42a5f5;
}

.bwbr-shape-slider-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.bwbr-shape-slider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #888;
  font-weight: 500;
}

.bwbr-shape-slider-header span:last-child {
  color: #555;
  font-weight: 600;
  min-width: 32px;
  text-align: right;
}

.bwbr-shape-toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #555;
  cursor: pointer;
  user-select: none;
}

.bwbr-shape-toggle-row input[type="checkbox"] {
  accent-color: #42a5f5;
}

.bwbr-shape-extra-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

/* ── 그리기 도구 패널 ──────────────────────────── */

.bwbr-place-draw-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 0;
}

.bwbr-draw-compact-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bwbr-draw-slider-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.bwbr-draw-slider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #888;
  font-weight: 500;
}

.bwbr-draw-slider-header span:last-child {
  color: #555;
  font-weight: 600;
  min-width: 32px;
  text-align: right;
}

.bwbr-draw-color-swatch {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid #ccc;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.bwbr-draw-color-swatch:hover {
  border-color: #999;
  box-shadow: 0 0 0 3px rgba(66,165,245,0.2);
}
.bwbr-draw-color-swatch--sm {
  width: 24px;
  height: 24px;
}

.bwbr-draw-section-sep {
  height: 1px;
  background: #e0e0e0;
  margin: 2px 0;
}

.bwbr-brush-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

.bwbr-brush-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1.5px solid rgba(0,0,0,0.12);
  border-radius: 6px;
  background: rgba(0,0,0,0.03);
  color: rgba(0,0,0,0.55);
  cursor: pointer;
  padding: 4px 6px;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.bwbr-brush-btn:hover {
  background: rgba(0,0,0,0.08);
  color: rgba(0,0,0,0.7);
}

.bwbr-brush-btn--active {
  border-color: #42a5f5;
  background: rgba(66,165,245,0.1);
  color: #1976d2;
}

.bwbr-brush-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
.bwbr-brush-btn span { color: inherit; }

.bwbr-draw-range-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bwbr-draw-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: #ddd;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.bwbr-draw-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #42a5f5;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  cursor: pointer;
}

.bwbr-draw-range-val {
  font-size: 11px;
  color: #666;
  min-width: 32px;
  text-align: right;
  white-space: nowrap;
}

.bwbr-draw-color-btn {
  width: 32px;
  height: 24px;
  border: 2px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s;
}

.bwbr-draw-color-btn:hover {
  border-color: #999;
}

/* ── 그리기 캔버스 ─────────────────────────────── */

.bwbr-draw-canvas {
  image-rendering: auto;
}

/* ── 그리기 완료/취소 바 ───────────────────────── */

.bwbr-draw-finish-bar {
  position: fixed;
  bottom: 82px;
  transform: translateX(-50%);
  z-index: 105;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border-radius: 12px;
  padding: 8px 16px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}

/* ── 텍스트 영역 드래그 미리보기 ─────────────────── */

.bwbr-placement-preview--text {
  border: 2px dashed #42a5f5 !important;
  background: rgba(66,165,245,0.08) !important;
}

/* ── 텍스트 WYSIWYG 편집기 ───────────────────────── */

.bwbr-text-editor-wrap {
  position: absolute;
  display: flex;
  flex-direction: column;
  outline: 2px dashed #42a5f5;
  z-index: 107;
  box-sizing: border-box;
  overflow-y: auto;
}

.bwbr-text-editor {
  padding: 8px;
  font-size: 16px;
  font-family: sans-serif;
  line-height: 1.5;
  color: #fff;
  word-break: break-all;
  overflow-wrap: break-word;
  outline: none;
  box-sizing: border-box;
  min-height: 32px;
  cursor: text;
  text-shadow: 0 1px 3px rgba(0,0,0,0.7);
  width: 100%;
  background: transparent;
}

.bwbr-text-toolbar {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #fff;
  border-radius: 8px;
  padding: 4px 6px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.18);
  z-index: 108;
  user-select: none;
  width: max-content;
}
.bwbr-text-toolbar-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.bwbr-size-combo {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 26px;
}
.bwbr-size-combo-input {
  width: 34px;
  height: 26px;
  border: 1px solid #ddd;
  border-radius: 4px 0 0 4px;
  font-size: 11px;
  padding: 0 2px;
  outline: none;
  text-align: center;
  background: #fff;
}
.bwbr-size-combo-input:focus { border-color: #42a5f5; }
.bwbr-size-combo-btn {
  width: 16px;
  height: 26px;
  border: 1px solid #ddd;
  border-left: none;
  border-radius: 0 4px 4px 0;
  background: #f5f5f5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 9px;
  color: #666;
}
.bwbr-size-combo-btn:hover { background: #e0e0e0; }
.bwbr-size-combo-drop {
  display: none;
  position: absolute;
  top: 28px;
  left: 0;
  min-width: 54px;
  max-height: 180px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  z-index: 120;
}
.bwbr-size-combo-drop--open { display: block; }
.bwbr-size-combo-opt {
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
}
.bwbr-size-combo-opt:hover { background: #e3f2fd; }

.bwbr-toolbar-label {
  font-size: 10px;
  color: #666;
  margin: 0 1px;
  white-space: nowrap;
}

.bwbr-text-toolbar-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #333;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition: background 0.12s;
  flex-shrink: 0;
}
.bwbr-text-toolbar-btn:hover { background: #f0f0f0; }
.bwbr-text-toolbar-btn.bwbr-tb-active { background: #e0e7ff; color: #1a56db; }

.bwbr-text-toolbar-sep {
  width: 1px;
  height: 20px;
  background: #ddd;
  margin: 0 3px;
  flex-shrink: 0;
}

.bwbr-text-toolbar-color {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  flex-shrink: 0;
}
.bwbr-text-toolbar-color:hover { background: #f0f0f0; }
.bwbr-text-toolbar-color .bwbr-color-indicator {
  position: absolute;
  bottom: 1px;
  left: 4px;
  right: 4px;
  height: 3px;
  border-radius: 1px;
}

/* ── 커스텀 컬러 팝업 ── */
.bwbr-color-popup {
  position: fixed;
  z-index: 130;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.25);
  padding: 10px;
  width: 180px;
  box-sizing: border-box;
  user-select: none;
  -webkit-user-select: none;
}
.bwbr-color-popup canvas {
  display: block;
  touch-action: none;
}
.bwbr-color-popup-hue {
  margin-top: 6px;
}
.bwbr-color-popup-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.bwbr-color-popup-preview {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid #ccc;
  flex-shrink: 0;
}
.bwbr-color-popup-hex {
  flex: 1;
  min-width: 0;
  height: 24px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  padding: 0 4px;
  outline: none;
}
.bwbr-color-popup-hex:focus { border-color: #5b9bf5; }
.bwbr-color-popup-trans {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #555;
  cursor: pointer;
}
.bwbr-color-popup-trans input { cursor: pointer; margin: 0; }

.bwbr-text-toolbar-select {
  height: 28px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  padding: 0 4px;
  outline: none;
  cursor: pointer;
  background: #fff;
  flex: 1;
  min-width: 0;
  max-width: 130px;
}

.bwbr-text-toolbar-confirm {
  color: #4caf50 !important;
  font-weight: bold;
  font-size: 16px !important;
}
.bwbr-text-toolbar-cancel {
  color: #e53935 !important;
  font-weight: bold;
  font-size: 14px !important;
}
`;
  document.head.appendChild(style);
})();


// ── 커스텀 툴팁 ────────────────────────────────────────────────

var _tooltipEl = null;
var _tooltipTimer = null;

function _showTooltip(text, anchorEl) {
  if (!text) return;
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'bwbr-tooltip';
    document.body.appendChild(_tooltipEl);
  }
  _tooltipEl.textContent = text;
  _tooltipEl.style.opacity = '0';
  clearTimeout(_tooltipTimer);
  _tooltipTimer = setTimeout(function() {
    if (!_tooltipEl) return;
    var r = anchorEl.getBoundingClientRect();
    _tooltipEl.style.left = (r.left + r.width / 2 - _tooltipEl.offsetWidth / 2) + 'px';
    _tooltipEl.style.top = (r.bottom + 6) + 'px';
    _tooltipEl.style.opacity = '1';
  }, 400);
}

function _hideTooltip() {
  clearTimeout(_tooltipTimer);
  if (_tooltipEl) _tooltipEl.style.opacity = '0';
}

function _setTooltip(el, text) {
  el.removeAttribute('title');
  el.addEventListener('mouseenter', function() { _showTooltip(text, el); });
  el.addEventListener('mouseleave', _hideTooltip);
}


// ── 상태 ────────────────────────────────────────────────────────

var _state = {
  active: false,          // 배치 모드 활성
  mode: null,             // 'select' | 'edit' | null
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

  // 이전 편집 도구 기억
  lastTool: null,       // 선택 모드 전환 시 마지막 서브도구 저장

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
  selectedStagedIds: [],  // 선택된 스테이징 오브젝트 ID 목록 (다중 선택)

  // Undo 스택
  undoStack: [],          // [{ type, data }]

  // 클립보드
  clipboard: [],           // [{ mapCoords, angle, imageDataUrl, settings }]

  // 스탬프 모드: 이전 배치 크기 기억 (클릭만으로 연속 배치)
  lastStampSize: null,     // { w, h } (screen px) — 드래그 배치 후 저장됨

  // 텍스트 도구 (Phase 2 — area-first WYSIWYG)
  pendingTextDataUrl: null,
  textEditing: false           // contentEditable 편집 중 여부
};


// ── 그리기 도구 상태 ────────────────────────────────────────────

var _drawSettings = {
  penSize: 4,             // 펜 굵기 (px)
  penColor: '#ffffff',    // 펜 색상
  penOpacity: 1.0,        // 펜 투명도 (0~1)
  brushShape: 'round',    // 브러쉬 모양: 'round' | 'square' | 'triangle' | 'eraser'
  sketchJitter: 0,        // 연필 떨림 (0=부드러움, 1~10=자글자글)
  widthVariation: 0,      // 자동 굵기 변화 (0=없음, 1~10)
  eraserMode: false,      // 지우개 모드 (brushShape='eraser' 시 자동 true)
  outlineEnabled: false,  // 윤곽선 활성 (outlineSize > 0 시 자동 true)
  outlineSize: 0,         // 윤곽선 굵기 (px, 0=비활성)
  outlineColor: '#000000',// 윤곽선 색상
  outlineOpacity: 1.0     // 윤곽선 투명도 (0~1)
};

var _drawCanvas = null;    // 그리기 캔버스 (zoom container 내)
var _drawCtx = null;       // 캔버스 2D 컨텍스트
var _isDrawing = false;    // 현재 그리기 중
var _drawPoints = [];      // 현재 스트로크 포인트 [{x,y}]
var _drawStrokes = [];     // 완료된 스트로크 목록 [{points, penSize, penColor, penOpacity, outlineEnabled, outlineSize, outlineColor}]
var _drawSettingsMenu = null; // 그리기 설정 메뉴 DOM
var _drawFinishBar = null; // 그리기 완료/취소 바
var _colorHistories = { fill: [], outline: [] }; // 카테고리별 최근 사용 색상 (최대 8개)


// ── 도형 도구 상태 ──────────────────────────────────────────────

var _shapeSettings = {
  shapeType: 'rect',        // 'rect' | 'ellipse' | 'polygon' | 'donut'
  fillColor: '#ffffff',      // 채우기 색상
  fillOpacity: 1.0,          // 채우기 투명도 (0~1)
  strokeColor: '#000000',    // 윤곽선 색상
  strokeSize: 0,             // 윤곽선 두께 (px, 0=비활성)
  strokeOpacity: 1.0,        // 윤곽선 투명도 (0~1)
  cornerRadius: 0,           // 둥근 모서리 (사각형 전용, px)
  polygonSides: 5,           // 다각형 꼭짓점 수 (3~12)
  polygonInnerRatio: 1.0,    // 다각형 내부 비율 (0.1~1.0, 1.0=정다각형, <1=별)
  donutInnerRatio: 0.5       // 도넛 내경 비율 (0.1~0.9)
};

var _shapeSettingsMenu = null;  // 도형 설정 메뉴 DOM
var _shapeLastStampSize = null; // { w, h } (screen px) — 스탬프 모드용
var _shapePendingDataUrl = null; // 현재 도형의 렌더된 dataUrl (스탬프 미리보기용)


// ── DOM 요소 ────────────────────────────────────────────────────

var _toolbar = null;
var _settingsPanel = null;
var _overlay = null;
var _preview = null;
var _angleIndicator = null;
var _cachedZoomEl = null; // 줌 컨테이너 참조 캐시 (React 교체 감지용)
var _stagingGuardId = null; // 스테이징 아이템 보호 rAF ID

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
    var zVal = parseInt(_settingsEls.zInput.value, 10);
    _state.panelSettings.z = isNaN(zVal) ? 150 : zVal;
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
var _imageGridSep = null;
var _textSettingsMenu = null;
var _confirmBar = null;
var _stagedCountEl = null;
var _confirmBtnEl = null;
var _confirmDialogOverlay = null;
var _confirmDialogEls = {};


// ── 초기화 ──────────────────────────────────────────────────────

function init() {
  createToolbar();
  createOverlay();
  createConfirmBar();
  createConfirmDialog();
  createAlignBar();
  registerFabButton();
  setupMiddleClickPanning();  // 미들클릭 핸들러 먼저 (capture phase 우선순위)
  setupKeyboard();
  setupSelectModeHandlers();
  _startFieldCenterMonitor();
}


// ── FAB 버튼 등록 ───────────────────────────────────────────────

function registerFabButton() {
  if (!window.BWBR_FabButtons) {
    setTimeout(registerFabButton, 500);
    return;
  }
  window.BWBR_FabButtons.register('placement', {
    icon: PLACEMENT_ICON,
    tooltip: '배치 모드 (Alt+-)',
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
  // 텍스트 도구: 항상 crosshair (영역 드래그 가능)
}

function togglePlacementMode() {
  if (!_state.active) {
    // 전투 모드 활성화 중이면 차단
    if (window.__bwbrCombatMove && window.__bwbrCombatMove.combatMode) {
      if (window.BWBR_FabButtons) {
        window.BWBR_FabButtons.showToast('전투 모드가 활성화되어 있어 배치 모드를 사용할 수 없습니다', { bg: 'rgba(211,47,47,0.92)', color: '#fff', duration: 2500 });
      }
      return;
    }
  }

  _state.active = !_state.active;
  window.BWBR_PlacementActive = _state.active;

  if (window.BWBR_FabButtons) {
    window.BWBR_FabButtons.setActive('placement', _state.active);
    window.BWBR_FabButtons.showToast(
      _state.active ? '배치 모드 활성화' : '배치 모드 비활성화',
      { bg: 'rgba(255,255,255,0.95)', color: '#333', duration: 2000 }
    );
  }

  if (_state.active) {
    _toolbar.classList.add('bwbr-placement-toolbar--open');
    document.body.classList.add('bwbr-placement-noselect');
    activateMode('select');
    showPlacementHelp();
    _startStagingGuard();
    updateConfirmBar();
  } else {
    _toolbar.classList.remove('bwbr-placement-toolbar--open');
    document.body.classList.remove('bwbr-placement-noselect');
    deactivateMode();
    clearAllStaged();
    _state.undoStack = [];
    _state.clipboard = [];
    updatePlacementCursor();
    hidePlacementHelp();
    _stopStagingGuard();
    updateConfirmBar();
  }
}


// ── 배치 모드 안내 패널 (드로어 좌측 슬라이드인) ─────────────────

var _placementHelp = null;
var _helpPaperObserver = null;
var _helpTrackRAF = null;

function _findChatPaper() {
  // 채팅 패널(첫 번째 drawer)만 선택 — 두 번째 drawer는 다른 패널
  var papers = document.querySelectorAll('.MuiDrawer-paperAnchorDockedRight');
  if (papers.length > 0) return papers[0];
  papers = document.querySelectorAll('.MuiDrawer-paperAnchorRight');
  if (papers.length > 0) return papers[0];
  papers = document.querySelectorAll('.MuiDrawer-paper');
  if (papers.length > 0) return papers[0];
  return null;
}

function _syncHelpPosition() {
  if (!_placementHelp) return;
  var paper = _findChatPaper();
  if (!paper) {
    // paper 없으면 화면 밖으로
    _placementHelp.style.left = '100vw';
    return;
  }
  var rect = paper.getBoundingClientRect();
  // paper의 왼쪽 모서리에 맞춤 (도움말은 translateX(-100%)로 왼쪽 바깥에 표시)
  _placementHelp.style.left = rect.left + 'px';
}

function _startHelpTracking() {
  if (_helpTrackRAF) return;
  function track() {
    _syncHelpPosition();
    if (_placementHelp) {
      _helpTrackRAF = requestAnimationFrame(track);
    }
  }
  _helpTrackRAF = requestAnimationFrame(track);
}

function _stopHelpTracking() {
  if (_helpTrackRAF) {
    cancelAnimationFrame(_helpTrackRAF);
    _helpTrackRAF = null;
  }
}

function showPlacementHelp() {
  if (_placementHelp) return;

  _placementHelp = document.createElement('div');
  _placementHelp.id = 'bwbr-placement-help';
  _placementHelp.style.cssText =
    'position:fixed;top:140px;left:100vw;' +
    'transform:translateX(0);' +
    'z-index:10;width:250px;' +
    'background:rgba(255,255,255,0.96);color:#333;' +
    'border-radius:8px 0 0 8px;' +
    'box-shadow:-2px 0 16px rgba(0,0,0,0.15);' +
    'font-family:"Roboto","Helvetica","Arial",sans-serif;' +
    'font-size:12px;line-height:1.7;' +
    'pointer-events:auto;' +
    'border:1px solid rgba(0,0,0,0.08);border-right:none;' +
    'opacity:0;overflow:hidden;box-sizing:border-box;' +
    'transition:opacity 0.3s ease, width 0.35s cubic-bezier(0.2,0.8,0.3,1);';

  _placementHelp.innerHTML =
    '<div id="bwbr-place-help-content" style="padding:14px 18px;white-space:nowrap;transition:opacity 0.25s;">' +
      '<div style="font-size:13px;font-weight:bold;margin-bottom:8px;color:#42a5f5;">' +
      '\uD83D\uDDBC\uFE0F 배치 모드</div>' +
      '<div style="margin-bottom:4px;"><b>V</b> — 선택 모드</div>' +
      '<div style="margin-bottom:4px;"><b>A</b> — 편집 모드</div>' +
      '<div style="margin-bottom:4px;"><b>I / T / S / D</b> — 이미지 / 텍스트 / 도형 / 그리기</div>' +
      '<div style="margin-bottom:4px;">\uD83D\uDDB1\uFE0F <b>드래그</b> — 영역 지정 배치</div>' +
      '<div style="margin-bottom:4px;">\uD83D\uDDB1\uFE0F <b>클릭</b> — 스탬프 반복</div>' +
      '<div style="margin-bottom:4px;">\uD83D\uDDB1\uFE0F <b>중 클릭 드래그</b> — 패닝</div>' +
      '<div style="margin-bottom:4px;"><b>R / Shift+R</b> — 선택 회전</div>' +
      '<div style="margin-bottom:4px;"><b>Del</b> — 선택 삭제</div>' +
      '<div style="margin-bottom:4px;"><b>Ctrl+Z/C/V</b> — 되돌리기/복사/붙여넣기</div>' +
      '<div style="margin-bottom:4px;"><b>Shift+드래그</b> — 직선 / 정비율 / 축 고정</div>' +
      '<div style="margin-bottom:4px;"><b>Alt+드래그</b> — 범위 선택 / 복사 / 대칭 조절</div>' +
      '<div style="margin-bottom:2px;opacity:0.65;font-size:11px;color:#999;margin-top:6px;">' +
      'Esc — 단계별 취소</div>' +
      '<div style="margin-bottom:0;opacity:0.65;font-size:11px;color:#999;">' +
      'Alt+- — 진입/나가기</div>' +
    '</div>' +
    '<div id="bwbr-place-help-tab" style="position:absolute;top:0;left:0;right:0;bottom:0;' +
    'display:flex;align-items:center;justify-content:center;' +
    'writing-mode:vertical-rl;font-size:11px;font-weight:bold;color:#42a5f5;' +
    'letter-spacing:2px;cursor:pointer;' +
    'opacity:0;pointer-events:none;transition:opacity 0.25s;">\uD83D\uDDBC\uFE0F 배치</div>';

  // 클릭으로 접기/펼치기
  _placementHelp.addEventListener('click', function () {
    if (_placementHelp.style.width === '28px') {
      expandPlacementHelp();
    } else {
      collapsePlacementHelp();
    }
  });

  // body에 붙이고 rAF로 paper 위치 추적
  document.body.appendChild(_placementHelp);
  _startHelpTracking();

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (_placementHelp) {
        _placementHelp.style.opacity = '1';
        _placementHelp.style.transform = 'translateX(-100%)';
      }
    });
  });

  // 3초 후 자동 접기
  // setTimeout(function () { collapsePlacementHelp(); }, 3000); // 사용자 요청으로 툴팁 자동 닫힘 제거
}

function collapsePlacementHelp() {
  if (!_placementHelp) return;
  var content = _placementHelp.querySelector('#bwbr-place-help-content');
  var tab = _placementHelp.querySelector('#bwbr-place-help-tab');
  if (content) content.style.opacity = '0';
  if (tab) { tab.style.opacity = '1'; tab.style.pointerEvents = 'auto'; }
  _placementHelp.style.width = '28px';
  _placementHelp.style.opacity = '0.7';
  _placementHelp.style.cursor = 'pointer';
}

function expandPlacementHelp() {
  if (!_placementHelp) return;
  var content = _placementHelp.querySelector('#bwbr-place-help-content');
  var tab = _placementHelp.querySelector('#bwbr-place-help-tab');
  _placementHelp.style.width = '250px';
  _placementHelp.style.opacity = '1';
  _placementHelp.style.cursor = 'default';
  if (tab) { tab.style.opacity = '0'; tab.style.pointerEvents = 'none'; }
  if (content) {
    content.style.opacity = '1';
  }
}

function hidePlacementHelp() {
  _stopHelpTracking();
  if (_helpPaperObserver) {
    _helpPaperObserver.disconnect();
    _helpPaperObserver = null;
  }
  if (!_placementHelp) return;
  _placementHelp.style.opacity = '0';
  _placementHelp.style.transform = 'translateX(0)';
  var panel = _placementHelp;
  _placementHelp = null;
  setTimeout(function () { panel.remove(); }, 450);
}

function _waitForPaper() {
  // rAF 추적 방식이므로 별도 observer 불필요
}


// ── 모드 전환 (선택 / 추가) ─────────────────────────────────────

function activateMode(mode, skipToolRestore) {
  if (mode !== 'edit' && mode !== 'select') return;

  // 같은 모드 → 무시
  if (_state.mode === mode) return;

  // 이전 모드 정리
  Object.keys(_modeButtons).forEach(function(k) {
    if (_modeButtons[k]) _modeButtons[k].classList.remove('bwbr-place-tool-btn--active');
  });
  _overlay.classList.remove('bwbr-placement-overlay--active');
  _preview.classList.remove('bwbr-placement-preview--visible');
  _state.placing = false;

  _state.mode = mode;
  if (_modeButtons[mode]) _modeButtons[mode].classList.add('bwbr-place-tool-btn--active');

  if (mode === 'select') {
    // 현재 편집 도구 기억
    if (_state.currentTool) _state.lastTool = _state.currentTool;
    _state.currentTool = null;
    Object.keys(_subToolButtons).forEach(function(k) {
      _subToolButtons[k].classList.remove('bwbr-place-tool-btn--active');
    });
    // 선택 모드: 설정 패널 닫기
    _settingsPanel.classList.remove('bwbr-place-settings--open');
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    if (_textSettingsMenu) _textSettingsMenu.style.display = 'none';
    if (_drawSettingsMenu) _drawSettingsMenu.style.display = 'none';
    // 그리기 중이면 스트로크 자동 완료
    if (_drawStrokes && _drawStrokes.length > 0) {
      finishDrawing();
    } else {
      cleanupDrawCanvas();
    }
  } else if (mode === 'edit') {
    // 편집 모드: 이전 도구가 있을 때만 설정 패널 열기 (skipToolRestore면 호출자가 직접 설정)
    if (!skipToolRestore && _state.lastTool) {
      _settingsPanel.classList.add('bwbr-place-settings--open');
      setSubTool(_state.lastTool);
    }
  }
  updateAlignBar();
}

function deactivateMode() {
  Object.keys(_modeButtons).forEach(function(k) {
    if (_modeButtons[k]) _modeButtons[k].classList.remove('bwbr-place-tool-btn--active');
  });
  _state.mode = null;
  _state.currentTool = null;
  _state.placing = false;
  Object.keys(_subToolButtons).forEach(function(k) {
    _subToolButtons[k].classList.remove('bwbr-place-tool-btn--active');
  });
  _overlay.classList.remove('bwbr-placement-overlay--active');
  _preview.classList.remove('bwbr-placement-preview--visible');
  _settingsPanel.classList.remove('bwbr-place-settings--open');
  // 그리기 중이면 스트로크 자동 완료
  if (_drawStrokes && _drawStrokes.length > 0) {
    finishDrawing();
  } else {
    cleanupDrawCanvas();
  }
  cleanupShapeState();
  updatePlacementCursor();
  updateAlignBar();
}

function setSubTool(toolId) {
  Object.keys(_subToolButtons).forEach(function(k) {
    _subToolButtons[k].classList.remove('bwbr-place-tool-btn--active');
  });

  if (_state.currentTool === toolId) {
    // 그리기 툴 토글 OFF 시 스트로크 자동 완료
    if (toolId === 'draw' && _drawStrokes && _drawStrokes.length > 0) {
      finishDrawing();
    } else {
      cleanupDrawCanvas();
    }
    _state.currentTool = null;
    _overlay.classList.remove('bwbr-placement-overlay--active');
    _settingsPanel.classList.remove('bwbr-place-settings--open');
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    if (_textSettingsMenu) _textSettingsMenu.style.display = 'none';
    if (_shapeSettingsMenu) _shapeSettingsMenu.style.display = 'none';
    if (_drawSettingsMenu) _drawSettingsMenu.style.display = 'none';
    cleanupShapeState();
    updatePlacementCursor();
    return;
  }

  // 이전 도구가 draw였으면 스트로크가 있으면 자동 완료, 없으면 정리
  if (_state.currentTool === 'draw') {
    if (_drawStrokes && _drawStrokes.length > 0) {
      finishDrawing();
    } else {
      cleanupDrawCanvas();
    }
  }
  // 이전 도구가 shape이었으면 스탬프 상태 정리
  if (_state.currentTool === 'shape') {
    cleanupShapeState();
  }

  _state.currentTool = toolId;
  _subToolButtons[toolId].classList.add('bwbr-place-tool-btn--active');
  _settingsPanel.classList.add('bwbr-place-settings--open');

  // 모든 설정 메뉴 숨기기
  if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
  if (_textSettingsMenu) _textSettingsMenu.style.display = 'none';
  if (_shapeSettingsMenu) _shapeSettingsMenu.style.display = 'none';
  if (_drawSettingsMenu) _drawSettingsMenu.style.display = 'none';
  _overlay.classList.add('bwbr-placement-overlay--active');

  if (toolId === 'image') {
    if (_imageSourceMenu) _imageSourceMenu.style.display = '';
  } else if (toolId === 'text') {
    if (_textSettingsMenu) _textSettingsMenu.style.display = '';
  } else if (toolId === 'shape') {
    if (_shapeSettingsMenu) _shapeSettingsMenu.style.display = '';
  } else if (toolId === 'draw') {
    if (_drawSettingsMenu) _drawSettingsMenu.style.display = '';
    initDrawCanvas();
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

  // 선택 모드 버튼
  var selectBtn = document.createElement('button');
  selectBtn.className = 'bwbr-place-tool-btn';
  selectBtn.innerHTML =
    '<svg viewBox="0 0 24 24">' + MODE_ICONS.select + '</svg>' +
    '<span class="bwbr-place-tooltip">선택 (V)</span>';
  selectBtn.addEventListener('click', function () { activateMode('select'); });
  _toolbar.appendChild(selectBtn);
  _modeButtons['select'] = selectBtn;

  // 구분선
  var sep = document.createElement('div');
  sep.className = 'bwbr-place-toolbar-sep';
  _toolbar.appendChild(sep);

  // 서브 도구 버튼 (개별 48x48 버튼)
  // 툴바는 flex-direction: column-reverse이므로 DOM 마지막 = 시각적 최상단
  // 원하는 시각 순서(위→아래): 그리기→텍스트→도형→이미지
  // → DOM 순서(먼저→나중): 이미지→도형→텍스트→그리기
  var tools = [
    { id: 'image', label: '이미지 (I)', icon: TOOL_ICONS.image },
    { id: 'shape', label: '도형 (S)', icon: TOOL_ICONS.shape },
    { id: 'text',  label: '텍스트 (T)', icon: TOOL_ICONS.text },
    { id: 'draw',  label: '그리기 (D)', icon: TOOL_ICONS.draw }
  ];

  tools.forEach(function (tool) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-place-tool-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24">' + tool.icon + '</svg>' +
      '<span class="bwbr-place-tooltip">' + tool.label + '</span>';
    btn.addEventListener('click', function () {
      if (_state.mode !== 'edit') activateMode('edit', true);
      setSubTool(tool.id);
    });
    _toolbar.appendChild(btn);
    _subToolButtons[tool.id] = btn;
  });

  document.body.appendChild(_toolbar);
}


// ── 패널 설정 패널 ──────────────────────────────────────────────

function createSubToolRow() {
  var row = document.createElement('div');
  row.className = 'bwbr-place-subtool-row';

  var tools = [
    { id: 'draw',  label: '그리기 (D)', icon: TOOL_ICONS.draw },
    { id: 'text',  label: '텍스트 (T)', icon: TOOL_ICONS.text },
    { id: 'shape', label: '도형 (S)', icon: TOOL_ICONS.shape },
    { id: 'image', label: '이미지 (I)', icon: TOOL_ICONS.image }
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

  // 이미지 소스 메뉴 (이미지 도구용)
  _imageSourceMenu = createImageSourceMenu();
  panel.appendChild(_imageSourceMenu);

  // 텍스트 설정 메뉴 (텍스트 도구용)
  _textSettingsMenu = createTextSettingsMenu();
  panel.appendChild(_textSettingsMenu);

  // 도형 설정 메뉴 (도형 도구용)
  _shapeSettingsMenu = createShapeSettingsMenu();
  panel.appendChild(_shapeSettingsMenu);

  // 그리기 설정 메뉴 (그리기 도구용)
  _drawSettingsMenu = createDrawSettingsMenu();
  panel.appendChild(_drawSettingsMenu);

  return panel;
}


// ── 이미지 소스 메뉴 ────────────────────────────────────────────

function createImageSourceMenu() {
  var menu = document.createElement('div');
  menu.className = 'bwbr-place-source-menu';
  menu.style.display = 'none';

  // 등록된 이미지 그리드 (상단)
  _imageGrid = document.createElement('div');
  _imageGrid.className = 'bwbr-place-image-grid';
  menu.appendChild(_imageGrid);

  // 구분선 (이미지가 있을 때만 표시 — renderImageGrid에서 토글)
  _imageGridSep = document.createElement('div');
  _imageGridSep.style.cssText = 'height:1px;background:#eee;display:none';
  menu.appendChild(_imageGridSep);

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
  // 이미지가 있으면 구분선+그리드 표시
  var hasImages = _state.registeredImages.length > 0;
  _imageGrid.style.display = hasImages ? '' : 'none';
  if (_imageGridSep) {
    _imageGridSep.style.display = hasImages ? '' : 'none';
  }
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

// 이미지 등록 후 자동 선택 + 이미지 배치 모드 전환
function _autoSelectImage(id) {
  var entry = _state.registeredImages.find(function(e) { return e.id === id; });
  if (!entry) return;
  _state.pendingImage = entry;
  updateImageGridSelection();
  // 편집 모드 + 이미지 도구로 전환
  if (_state.mode !== 'edit') activateMode('edit');
  if (_state.currentTool !== 'image') setSubTool('image');
  _overlay.classList.add('bwbr-placement-overlay--active');
  updatePlacementCursor();
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
          // 마지막 이미지 자동 선택 + 이미지 배치 모드 전환
          _autoSelectImage(entry.id);
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
      _autoSelectImage(entry.id);
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
      _autoSelectImage(entry.id);
    };
    img.src = result.url;
  }

  document.addEventListener('bwbr-native-picker-result', onPickerResult);

  // 네이티브 이미지 피커 열기 (MAIN world)
  document.dispatchEvent(new CustomEvent('bwbr-open-native-image-picker'));
}


// ── 텍스트 도구 패널 ────────────────────────────────────────────
// Phase 2: area-first WYSIWYG 방식으로 재구현 예정 (PLACEMENT_PLAN.md 참고)

function createTextSettingsMenu() {
  var menu = document.createElement('div');
  menu.className = 'bwbr-place-text-menu';
  menu.style.display = 'none';

  var notice = document.createElement('div');
  notice.style.cssText = 'text-align:center;padding:16px 12px;color:#888;font-size:13px;line-height:1.8;';
  notice.innerHTML = '<div style="font-size:20px;margin-bottom:6px;">\uD83D\uDCDD</div>' +
    '<b>텍스트 도구</b><br>' +
    '<span style="font-size:12px;opacity:0.7;">오버레이에서 드래그하여<br>텍스트 영역을 지정하세요</span>';
  menu.appendChild(notice);

  return menu;
}


// ── 도형 도구 패널 + 렌더링 ─────────────────────────────────────

var _SHAPE_TYPES = [
  { id: 'rect',     label: '사각형', svg: '<path fill="currentColor" d="M8 3H16C18.76 3 21 5.24 21 8V16C21 18.76 18.76 21 16 21H8C5.24 21 3 18.76 3 16V8C3 5.24 5.24 3 8 3Z"/>' },
  { id: 'ellipse',  label: '원',     svg: '<path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>' },
  { id: 'polygon',  label: '다각형', svg: '<path fill="currentColor" d="M12,2.5L2,9.8L5.8,21.5H18.2L22,9.8L12,2.5Z"/>' },
  { id: 'donut',    label: '도넛',   svg: '<path fill="currentColor" d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2Z M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6Z"/>' }
];

function createShapeSettingsMenu() {
  var menu = document.createElement('div');
  menu.className = 'bwbr-place-shape-menu';
  menu.style.display = 'none';

  // ── 도형 타입 그리드 (2×2) ──
  var grid = document.createElement('div');
  grid.className = 'bwbr-shape-type-grid';
  var _shapeTypeBtns = {};

  _SHAPE_TYPES.forEach(function(shape) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-shape-type-btn' + (_shapeSettings.shapeType === shape.id ? ' bwbr-shape-type-btn--active' : '');
    btn.innerHTML = '<svg viewBox="0 0 24 24">' + shape.svg + '</svg><span>' + shape.label + '</span>';
    btn.addEventListener('click', function() {
      _shapeSettings.shapeType = shape.id;
      Object.values(_shapeTypeBtns).forEach(function(b) { b.classList.remove('bwbr-shape-type-btn--active'); });
      btn.classList.add('bwbr-shape-type-btn--active');
      _updateShapeExtraOptions();
    });
    grid.appendChild(btn);
    _shapeTypeBtns[shape.id] = btn;
  });
  menu.appendChild(grid);

  // ── 도형별 추가 옵션 (도형 선택과 색상 설정 사이) ──
  var extraOpts = document.createElement('div');
  extraOpts.className = 'bwbr-shape-extra-options';
  menu.appendChild(extraOpts);
  menu._extraOpts = extraOpts;
  menu._shapeTypeBtns = _shapeTypeBtns;

  // ── 채우기: 색상 + 투명도 (체크박스 없음) ──
  var fillLabel = document.createElement('div');
  fillLabel.className = 'bwbr-shape-section-label';
  fillLabel.textContent = '채우기';
  menu.appendChild(fillLabel);

  var fillRow = document.createElement('div');
  fillRow.className = 'bwbr-draw-compact-row';

  var fillSwatch = document.createElement('button');
  fillSwatch.className = 'bwbr-draw-color-swatch';
  fillSwatch.style.background = _shapeSettings.fillColor;
  fillSwatch.addEventListener('click', function() {
    _openColorPopup(fillSwatch, _shapeSettings.fillColor, false, false, function(hex) {
      _shapeSettings.fillColor = hex;
      fillSwatch.style.background = hex;
    }, 'fill');
  });
  fillRow.appendChild(fillSwatch);

  var fillOpGrp = _createShapeSlider('투명도', 0, 100, Math.round(_shapeSettings.fillOpacity * 100), '%', function(v) {
    _shapeSettings.fillOpacity = v / 100;
  });
  fillRow.appendChild(fillOpGrp);
  menu.appendChild(fillRow);

  // ── 윤곽선: 색상 + 투명도 (체크박스 없음) ──
  var strokeLabel = document.createElement('div');
  strokeLabel.className = 'bwbr-shape-section-label';
  strokeLabel.textContent = '윤곽선';
  menu.appendChild(strokeLabel);

  var strokeRow = document.createElement('div');
  strokeRow.className = 'bwbr-draw-compact-row';

  var strokeSwatch = document.createElement('button');
  strokeSwatch.className = 'bwbr-draw-color-swatch';
  strokeSwatch.style.background = _shapeSettings.strokeColor;
  strokeSwatch.addEventListener('click', function() {
    _openColorPopup(strokeSwatch, _shapeSettings.strokeColor, false, false, function(hex) {
      _shapeSettings.strokeColor = hex;
      strokeSwatch.style.background = hex;
    }, 'outline');
  });
  strokeRow.appendChild(strokeSwatch);

  var strokeOpGrp = _createShapeSlider('투명도', 0, 100, Math.round(_shapeSettings.strokeOpacity * 100), '%', function(v) {
    _shapeSettings.strokeOpacity = v / 100;
  });
  strokeRow.appendChild(strokeOpGrp);
  menu.appendChild(strokeRow);

  // ── 윤곽선 굵기 (0 = 윤곽선 없음) ──
  var strokeSizeGrp = _createShapeSlider('굵기', 0, 20, _shapeSettings.strokeSize, 'px', function(v) {
    _shapeSettings.strokeSize = v;
  });
  menu.appendChild(strokeSizeGrp);

  // 초기 추가 옵션 렌더
  _updateShapeExtraOptions();

  return menu;
}

function _createShapeSlider(label, min, max, value, unit, onChange) {
  var grp = document.createElement('div');
  grp.className = 'bwbr-shape-slider-group';
  var hdr = document.createElement('div');
  hdr.className = 'bwbr-shape-slider-header';
  var lbl = document.createElement('span');
  lbl.textContent = label;
  var val = document.createElement('span');
  val.textContent = value + unit;
  hdr.appendChild(lbl);
  hdr.appendChild(val);
  grp.appendChild(hdr);

  var slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'bwbr-draw-slider';
  slider.min = min;
  slider.max = max;
  slider.value = value;
  slider.addEventListener('input', function() {
    var v = parseInt(slider.value);
    val.textContent = v + unit;
    onChange(v);
  });
  grp.appendChild(slider);
  return grp;
}

function _updateShapeExtraOptions() {
  if (!_shapeSettingsMenu || !_shapeSettingsMenu._extraOpts) return;
  var container = _shapeSettingsMenu._extraOpts;
  container.innerHTML = '';

  var type = _shapeSettings.shapeType;

  if (type === 'rect') {
    var rGrp = _createShapeSlider('둥근 모서리', 0, 100, _shapeSettings.cornerRadius, 'px', function(v) {
      _shapeSettings.cornerRadius = v;
    });
    container.appendChild(rGrp);
  } else if (type === 'polygon') {
    var sGrp = _createShapeSlider('꼭짓점 수', 3, 12, _shapeSettings.polygonSides, '', function(v) {
      _shapeSettings.polygonSides = v;
    });
    container.appendChild(sGrp);
    var irGrp = _createShapeSlider('내부 비율', 10, 100, Math.round(_shapeSettings.polygonInnerRatio * 100), '%', function(v) {
      _shapeSettings.polygonInnerRatio = v / 100;
    });
    container.appendChild(irGrp);
  } else if (type === 'donut') {
    var diGrp = _createShapeSlider('내경 비율', 10, 90, Math.round(_shapeSettings.donutInnerRatio * 100), '%', function(v) {
      _shapeSettings.donutInnerRatio = v / 100;
    });
    container.appendChild(diGrp);
  }
}


// ── 도형 상태 정리 ─────────────────────────────────────────────

function cleanupShapeState() {
  _shapeLastStampSize = null;
  _shapePendingDataUrl = null;
}


// ── 도형 렌더링 함수들 ─────────────────────────────────────────

function _buildShapePath(ctx, type, x, y, w, h, settings) {
  // 모든 도형의 path를 ctx에 그린다 (fill/stroke는 호출자가)
  ctx.beginPath();
  switch (type) {
    case 'rect': {
      var r = Math.min(settings.cornerRadius || 0, Math.min(w, h) / 2);
      if (r > 0) {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
      } else {
        ctx.rect(x, y, w, h);
      }
      break;
    }
    case 'ellipse': {
      var cx = x + w / 2, cy = y + h / 2;
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    }
    case 'polygon': {
      var sides = settings.polygonSides || 5;
      var inner = settings.polygonInnerRatio != null ? settings.polygonInnerRatio : 1.0;
      // 단위 원 위 꼭짓점 계산
      var verts = [];
      if (inner >= 1.0) {
        for (var i = 0; i < sides; i++) {
          var angle = (Math.PI * 2 * i / sides) - Math.PI / 2;
          verts.push({ x: Math.cos(angle), y: Math.sin(angle) });
        }
      } else {
        for (var i = 0; i < sides * 2; i++) {
          var angle = (Math.PI * i / sides) - Math.PI / 2;
          var ratio = (i % 2 === 0) ? 1 : inner;
          verts.push({ x: ratio * Math.cos(angle), y: ratio * Math.sin(angle) });
        }
      }
      // 바운딩 박스 → 할당 영역에 맞춰 정렬+채우기
      var bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      verts.forEach(function(v) {
        if (v.x < bMinX) bMinX = v.x; if (v.y < bMinY) bMinY = v.y;
        if (v.x > bMaxX) bMaxX = v.x; if (v.y > bMaxY) bMaxY = v.y;
      });
      var bw = bMaxX - bMinX || 1, bh = bMaxY - bMinY || 1;
      verts.forEach(function(v, i) {
        var px = x + (v.x - bMinX) / bw * w;
        var py = y + (v.y - bMinY) / bh * h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      break;
    }
    case 'donut': {
      var cx = x + w / 2, cy = y + h / 2;
      var orx = w / 2, ory = h / 2;
      var irx = orx * (settings.donutInnerRatio || 0.5);
      var iry = ory * (settings.donutInnerRatio || 0.5);
      // 외부 원 (시계방향)
      ctx.ellipse(cx, cy, orx, ory, 0, 0, Math.PI * 2);
      // 내부 원 (반시계방향 — 구멍)
      ctx.moveTo(cx + irx, cy);
      ctx.ellipse(cx, cy, irx, iry, 0, 0, Math.PI * 2, true);
      break;
    }
  }
}

function _renderShapeToCtx(ctx, type, x, y, w, h, settings) {
  ctx.save();
  _buildShapePath(ctx, type, x, y, w, h, settings);

  if (settings.fillOpacity > 0) {
    ctx.globalAlpha = settings.fillOpacity;
    ctx.fillStyle = settings.fillColor;
    ctx.fill('evenodd');
  }
  if (settings.strokeSize > 0 && settings.strokeOpacity > 0) {
    ctx.globalAlpha = settings.strokeOpacity;
    ctx.strokeStyle = settings.strokeColor;
    ctx.lineWidth = settings.strokeSize;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}


// ── 도형 스탬프 배치 ────────────────────────────────────────────

// _renderShapeDataUrl: 도형을 렌더해서 dataUrl 반환 (스탬프/배치 공용)
function _renderShapeDataUrl(mapCoords) {
  var scale = COMPOSITE_PX_PER_TILE;  // 48px/tile
  var cw = mapCoords.width * scale;
  var ch = mapCoords.height * scale;
  if (cw < 1 || ch < 1) return null;
  var canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  var ctx = canvas.getContext('2d');
  // composite 해상도 보정: strokeSize/cornerRadius를 디스플레이→composite 비율로 스케일
  var compositeRatio = COMPOSITE_PX_PER_TILE / CELL_PX;  // 48/24 = 2
  var scaledSettings = {};
  for (var k in _shapeSettings) scaledSettings[k] = _shapeSettings[k];
  scaledSettings.strokeSize = (_shapeSettings.strokeSize || 0) * compositeRatio;
  scaledSettings.cornerRadius = (_shapeSettings.cornerRadius || 0) * compositeRatio;
  _renderShapeToCtx(ctx, _shapeSettings.shapeType, 0, 0, cw, ch, scaledSettings);
  return canvas.toDataURL('image/png');
}

// _stageShapeObject: 도형을 stageObject 경로로 배치 (이미지 도구와 동일 구조)
function _stageShapeObject(screenRect) {
  var mapCoords = screenToMapCoords(screenRect);
  if (!mapCoords) return;

  var dataUrl = _renderShapeDataUrl(mapCoords);
  if (!dataUrl) return;

  // 스탬프 미리보기용 dataUrl 저장
  _shapePendingDataUrl = dataUrl;

  readSettingsFromDOM();

  var obj = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    mapCoords: mapCoords,
    angle: 0,
    imageDataUrl: dataUrl,
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
  pushUndo({ type: 'stage', ids: [obj.id] });
  updateConfirmBar();
}


// ── 그리기 도구 패널 ────────────────────────────────────────────

function createDrawSettingsMenu() {
  var menu = document.createElement('div');
  menu.className = 'bwbr-place-draw-menu';
  menu.style.display = 'none';

  // ── 안내 문구 (맨 위) ──
  var notice = document.createElement('div');
  notice.style.cssText = 'text-align:center;padding:4px 4px 6px;color:#888;font-size:11.5px;line-height:1.5;';
  notice.innerHTML = '오버레이에서 자유롭게 그리세요.<br>Shift+드래그: 직선 · Ctrl+Z: 실행취소';
  menu.appendChild(notice);

  // ── 채우기 섹션 라벨 ──
  var fillLabel = document.createElement('div');
  fillLabel.className = 'bwbr-shape-section-label';
  fillLabel.textContent = '채우기';
  menu.appendChild(fillLabel);

  // ── 색상 + 투명도 (한 줄) ──
  var colorOpRow = document.createElement('div');
  colorOpRow.className = 'bwbr-draw-compact-row';

  var colorBtn = document.createElement('button');
  colorBtn.className = 'bwbr-draw-color-swatch';
  colorBtn.style.background = _drawSettings.penColor;
  colorBtn.addEventListener('click', function() {
    _openColorPopup(colorBtn, _drawSettings.penColor, false, false, function(hex) {
      _drawSettings.penColor = hex;
      colorBtn.style.background = hex;
    }, 'fill');
  });
  colorOpRow.appendChild(colorBtn);

  var opacityGroup = document.createElement('div');
  opacityGroup.className = 'bwbr-draw-slider-group';
  var opacityHeader = document.createElement('div');
  opacityHeader.className = 'bwbr-draw-slider-header';
  var opacityLabel = document.createElement('span');
  opacityLabel.textContent = '투명도';
  var opacityVal = document.createElement('span');
  opacityVal.textContent = Math.round(_drawSettings.penOpacity * 100) + '%';
  opacityHeader.appendChild(opacityLabel);
  opacityHeader.appendChild(opacityVal);
  var opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.min = '5';
  opacitySlider.max = '100';
  opacitySlider.value = String(Math.round(_drawSettings.penOpacity * 100));
  opacitySlider.className = 'bwbr-draw-slider';
  opacitySlider.addEventListener('input', function() {
    _drawSettings.penOpacity = parseInt(opacitySlider.value, 10) / 100;
    opacityVal.textContent = opacitySlider.value + '%';
  });
  opacityGroup.appendChild(opacityHeader);
  opacityGroup.appendChild(opacitySlider);
  colorOpRow.appendChild(opacityGroup);
  menu.appendChild(colorOpRow);

  // ── 브러쉬 모양 (아이콘+라벨, 지우개 포함) ──
  var brushGrid = document.createElement('div');
  brushGrid.className = 'bwbr-brush-grid';

  var brushes = [
    { id: 'round',    label: '원형 브러쉬',   svg: '<circle cx="10" cy="10" r="7" fill="currentColor"/>' },
    { id: 'square',   label: '사각 브러쉬',   svg: '<rect x="3" y="3" width="14" height="14" fill="currentColor"/>' },
    { id: 'triangle', label: '삼각 브러쉬',   svg: '<polygon points="10,2 18,17 2,17" fill="currentColor"/>' },
    { id: 'eraser',   label: '지우개',        svg: '<path d="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z" fill="currentColor"/>' }
  ];
  var brushBtns = {};

  function updateBrushStyles() {
    Object.keys(brushBtns).forEach(function(k) {
      var active = k === _drawSettings.brushShape;
      brushBtns[k].className = 'bwbr-brush-btn' + (active ? ' bwbr-brush-btn--active' : '');
    });
  }

  brushes.forEach(function(br) {
    var btn = document.createElement('button');
    var isActive = br.id === _drawSettings.brushShape;
    btn.className = 'bwbr-brush-btn' + (isActive ? ' bwbr-brush-btn--active' : '');
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20">' + br.svg + '</svg><span>' + br.label + '</span>';
    btn.addEventListener('click', function() {
      _drawSettings.brushShape = br.id;
      _drawSettings.eraserMode = (br.id === 'eraser');
      updateBrushStyles();
    });
    brushBtns[br.id] = btn;
    brushGrid.appendChild(btn);
  });
  menu.appendChild(brushGrid);

  // ── 굵기 ──
  var sizeGroup = document.createElement('div');
  sizeGroup.className = 'bwbr-draw-slider-group';
  var sizeHeader = document.createElement('div');
  sizeHeader.className = 'bwbr-draw-slider-header';
  var sizeLabel = document.createElement('span');
  sizeLabel.textContent = '굵기';
  var sizeVal = document.createElement('span');
  sizeVal.textContent = _drawSettings.penSize + 'px';
  sizeHeader.appendChild(sizeLabel);
  sizeHeader.appendChild(sizeVal);
  var sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = '1';
  sizeSlider.max = '40';
  sizeSlider.value = String(_drawSettings.penSize);
  sizeSlider.className = 'bwbr-draw-slider';
  sizeSlider.addEventListener('input', function() {
    _drawSettings.penSize = parseInt(sizeSlider.value, 10);
    sizeVal.textContent = _drawSettings.penSize + 'px';
  });
  sizeGroup.appendChild(sizeHeader);
  sizeGroup.appendChild(sizeSlider);
  menu.appendChild(sizeGroup);

  // ── 떨림 ──
  var jitterGroup = document.createElement('div');
  jitterGroup.className = 'bwbr-draw-slider-group';
  var jitterHeader = document.createElement('div');
  jitterHeader.className = 'bwbr-draw-slider-header';
  var jitterLabel = document.createElement('span');
  jitterLabel.textContent = '떨림';
  var jitterVal = document.createElement('span');
  jitterVal.textContent = _drawSettings.sketchJitter === 0 ? '없음' : String(_drawSettings.sketchJitter);
  jitterHeader.appendChild(jitterLabel);
  jitterHeader.appendChild(jitterVal);
  var jitterSlider = document.createElement('input');
  jitterSlider.type = 'range';
  jitterSlider.min = '0';
  jitterSlider.max = '10';
  jitterSlider.value = String(_drawSettings.sketchJitter);
  jitterSlider.className = 'bwbr-draw-slider';
  jitterSlider.addEventListener('input', function() {
    _drawSettings.sketchJitter = parseInt(jitterSlider.value, 10);
    jitterVal.textContent = _drawSettings.sketchJitter === 0 ? '없음' : String(_drawSettings.sketchJitter);
  });
  jitterGroup.appendChild(jitterHeader);
  jitterGroup.appendChild(jitterSlider);
  menu.appendChild(jitterGroup);

  // ── 굵기 변화 ──
  var varGroup = document.createElement('div');
  varGroup.className = 'bwbr-draw-slider-group';
  var varHeader = document.createElement('div');
  varHeader.className = 'bwbr-draw-slider-header';
  var varLabel = document.createElement('span');
  varLabel.textContent = '굵기 변화';
  var varVal = document.createElement('span');
  varVal.textContent = _drawSettings.widthVariation === 0 ? '없음' : String(_drawSettings.widthVariation);
  varHeader.appendChild(varLabel);
  varHeader.appendChild(varVal);
  var varSlider = document.createElement('input');
  varSlider.type = 'range';
  varSlider.min = '0';
  varSlider.max = '10';
  varSlider.value = String(_drawSettings.widthVariation);
  varSlider.className = 'bwbr-draw-slider';
  varSlider.addEventListener('input', function() {
    _drawSettings.widthVariation = parseInt(varSlider.value, 10);
    varVal.textContent = _drawSettings.widthVariation === 0 ? '없음' : String(_drawSettings.widthVariation);
  });
  varGroup.appendChild(varHeader);
  varGroup.appendChild(varSlider);
  menu.appendChild(varGroup);

  // ── 윤곽선 섹션 (토글 없음, 항상 노출, 굵기 0=비활성) ──
  var outlineLabel = document.createElement('div');
  outlineLabel.className = 'bwbr-shape-section-label';
  outlineLabel.textContent = '윤곽선';
  menu.appendChild(outlineLabel);

  // 윤곽선 색상 + 투명도
  var outlineBody = document.createElement('div');
  outlineBody.className = 'bwbr-draw-compact-row';

  var outlineColorBtn = document.createElement('button');
  outlineColorBtn.className = 'bwbr-draw-color-swatch';
  outlineColorBtn.style.background = _drawSettings.outlineColor;
  outlineColorBtn.addEventListener('click', function() {
    _openColorPopup(outlineColorBtn, _drawSettings.outlineColor, false, false, function(hex) {
      _drawSettings.outlineColor = hex;
      outlineColorBtn.style.background = hex;
    }, 'outline');
  });
  outlineBody.appendChild(outlineColorBtn);

  var outlineOpacityGroup = document.createElement('div');
  outlineOpacityGroup.className = 'bwbr-draw-slider-group';
  var outlineOpacityHeader = document.createElement('div');
  outlineOpacityHeader.className = 'bwbr-draw-slider-header';
  var outlineOpacityLabel = document.createElement('span');
  outlineOpacityLabel.textContent = '투명도';
  var outlineOpacityVal = document.createElement('span');
  outlineOpacityVal.textContent = Math.round(_drawSettings.outlineOpacity * 100) + '%';
  outlineOpacityHeader.appendChild(outlineOpacityLabel);
  outlineOpacityHeader.appendChild(outlineOpacityVal);
  var outlineOpacitySlider = document.createElement('input');
  outlineOpacitySlider.type = 'range';
  outlineOpacitySlider.min = '5';
  outlineOpacitySlider.max = '100';
  outlineOpacitySlider.value = String(Math.round(_drawSettings.outlineOpacity * 100));
  outlineOpacitySlider.className = 'bwbr-draw-slider';
  outlineOpacitySlider.addEventListener('input', function() {
    _drawSettings.outlineOpacity = parseInt(outlineOpacitySlider.value, 10) / 100;
    outlineOpacityVal.textContent = outlineOpacitySlider.value + '%';
  });
  outlineOpacityGroup.appendChild(outlineOpacityHeader);
  outlineOpacityGroup.appendChild(outlineOpacitySlider);
  outlineBody.appendChild(outlineOpacityGroup);
  menu.appendChild(outlineBody);

  // 윤곽선 굵기 (0=비활성)
  var outlineSizeGroup = document.createElement('div');
  outlineSizeGroup.className = 'bwbr-draw-slider-group';
  var outlineSizeHeader = document.createElement('div');
  outlineSizeHeader.className = 'bwbr-draw-slider-header';
  var outlineSizeLabel = document.createElement('span');
  outlineSizeLabel.textContent = '굵기';
  var outlineSizeVal = document.createElement('span');
  outlineSizeVal.textContent = _drawSettings.outlineSize + 'px';
  outlineSizeHeader.appendChild(outlineSizeLabel);
  outlineSizeHeader.appendChild(outlineSizeVal);
  var outlineSizeSlider = document.createElement('input');
  outlineSizeSlider.type = 'range';
  outlineSizeSlider.min = '0';
  outlineSizeSlider.max = '20';
  outlineSizeSlider.value = String(_drawSettings.outlineSize);
  outlineSizeSlider.className = 'bwbr-draw-slider';
  outlineSizeSlider.addEventListener('input', function() {
    _drawSettings.outlineSize = parseInt(outlineSizeSlider.value, 10);
    _drawSettings.outlineEnabled = _drawSettings.outlineSize > 0;
    outlineSizeVal.textContent = _drawSettings.outlineSize + 'px';
  });
  outlineSizeGroup.appendChild(outlineSizeHeader);
  outlineSizeGroup.appendChild(outlineSizeSlider);
  menu.appendChild(outlineSizeGroup);

  return menu;
}


// ── 그리기 캔버스 엔진 ──────────────────────────────────────────

function initDrawCanvas() {
  cleanupDrawCanvas();

  // 뷰포트 크기의 고정 캔버스 (오버레이 위에 배치하여 실시간 미리보기)
  _drawCanvas = document.createElement('canvas');
  _drawCanvas.className = 'bwbr-draw-canvas';
  _drawCanvas.width = window.innerWidth;
  _drawCanvas.height = window.innerHeight;
  _drawCanvas.style.cssText = 'position:fixed;inset:0;z-index:103;pointer-events:none;';
  document.body.appendChild(_drawCanvas);
  _drawCtx = _drawCanvas.getContext('2d');
  _drawStrokes = [];
  _drawPoints = [];
  _isDrawing = false;



  // 줌 변경 감시 (rAF 루프)
  _drawLastZoom = getZoomScale();
  _drawLastOrigin = getMapOriginOnScreen();
  _drawZoomWatchId = requestAnimationFrame(_drawZoomWatch);
}

// 줌/패닝 변경 감시 → 스트로크 재렌더
function _drawZoomWatch() {
  if (!_drawCanvas) return;
  _drawZoomWatchId = requestAnimationFrame(_drawZoomWatch);
  var z = getZoomScale();
  var o = getMapOriginOnScreen();
  if (!o || !_drawLastOrigin) { _drawLastZoom = z; _drawLastOrigin = o; return; }
  if (z !== _drawLastZoom || o.x !== _drawLastOrigin.x || o.y !== _drawLastOrigin.y) {
    _drawLastZoom = z;
    _drawLastOrigin = o;
    _redrawAllStrokes();
  }
}

var _drawLastZoom = 1;
var _drawLastOrigin = null;
var _drawZoomWatchId = null;

function cleanupDrawCanvas() {
  if (_drawCanvas && _drawCanvas.parentNode) {
    _drawCanvas.parentNode.removeChild(_drawCanvas);
  }
  _drawCanvas = null;
  _drawCtx = null;
  _isDrawing = false;
  _drawPoints = [];
  _drawStrokes = [];
  if (_drawZoomWatchId) {
    cancelAnimationFrame(_drawZoomWatchId);
    _drawZoomWatchId = null;
  }
  _hideDrawFinishBar();
}

function _showDrawFinishBar() {
  _hideDrawFinishBar();
  _drawFinishBar = document.createElement('div');
  _drawFinishBar.className = 'bwbr-draw-finish-bar';
  _drawFinishBar.style.left = _getFieldCenter() + 'px';

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'bwbr-place-confirm-bar-btn bwbr-place-cancel-btn';
  cancelBtn.textContent = '🗑 모두 지우기';
  cancelBtn.addEventListener('click', function() {
    _drawStrokes = [];
    _redrawAllStrokes();
  });

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'bwbr-place-confirm-bar-btn bwbr-place-confirm-btn';
  confirmBtn.textContent = '✓ 완료';
  confirmBtn.addEventListener('click', finishDrawing);

  _drawFinishBar.appendChild(cancelBtn);
  _drawFinishBar.appendChild(confirmBtn);
  document.body.appendChild(_drawFinishBar);
}

function _hideDrawFinishBar() {
  if (_drawFinishBar && _drawFinishBar.parentNode) {
    _drawFinishBar.parentNode.removeChild(_drawFinishBar);
  }
  _drawFinishBar = null;
}

// 화면 좌표 → 맵 픽셀 좌표 변환
function _screenToMapPx(clientX, clientY) {
  var origin = getMapOriginOnScreen();
  if (!origin) return null;
  var scale = getZoomScale();
  return { x: (clientX - origin.x) / scale, y: (clientY - origin.y) / scale };
}

// 맵 픽셀 좌표 → 화면 좌표 변환
function _mapPxToScreen(mx, my) {
  var origin = getMapOriginOnScreen();
  if (!origin) return null;
  var scale = getZoomScale();
  return { x: mx * scale + origin.x, y: my * scale + origin.y };
}

function onDrawMouseDown(e) {
  if (!_drawCanvas || !_drawCtx) return;
  // 첫 스트로크 시작 시 툴바 표시
  if (_drawStrokes.length === 0 && _drawPoints.length === 0 && !_drawFinishBar) {
    _showDrawFinishBar();
  }
  _isDrawing = true;
  var mapPt = _screenToMapPx(e.clientX, e.clientY);
  if (!mapPt) return;
  // 펜 굵기도 맵 픽셀 단위로 저장 (현재 줌에서의 화면 크기를 맵 단위로 변환)
  var scale = getZoomScale();
  var mapPenSize = _drawSettings.penSize / scale;
  var mapOutlineSize = _drawSettings.outlineSize / scale;
  _drawCurrentStrokeSettings = {
    penSize: mapPenSize,
    penColor: _drawSettings.penColor,
    penOpacity: _drawSettings.penOpacity,
    brushShape: _drawSettings.brushShape,
    sketchJitter: _drawSettings.sketchJitter,
    widthVariation: _drawSettings.widthVariation,
    isEraser: _drawSettings.eraserMode,
    outlineEnabled: _drawSettings.outlineSize > 0,
    outlineSize: mapOutlineSize,
    outlineColor: _drawSettings.outlineColor,
    outlineOpacity: _drawSettings.outlineOpacity
  };
  _drawPoints = [mapPt];
  _redrawAllStrokes(); // 이전 스트로크 + 현재 점 렌더
}

var _drawCurrentStrokeSettings = null;

function onDrawMouseMove(e) {
  if (!_isDrawing || !_drawCanvas || !_drawCtx) return;
  var mapPt = _screenToMapPx(e.clientX, e.clientY);
  if (!mapPt) return;
  if (e.shiftKey && _drawPoints.length > 0) {
    // Shift: 직선 모드 — 시작점에서 45° 단위 스냅, 보간점 생성 (떨림/굵기 변화 적용)
    var start = _drawPoints[0];
    var dx = mapPt.x - start.x;
    var dy = mapPt.y - start.y;
    var angle = Math.atan2(dy, dx);
    var len = Math.sqrt(dx * dx + dy * dy);
    var snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    var endPt = { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len };
    // 보간점 생성 (3px 간격)
    var interp = [start];
    var step = 3;
    if (len > step) {
      var cnt = Math.ceil(len / step);
      for (var si = 1; si < cnt; si++) {
        var t = si / cnt;
        interp.push({ x: start.x + (endPt.x - start.x) * t, y: start.y + (endPt.y - start.y) * t });
      }
    }
    interp.push(endPt);
    _drawPoints = interp;
  } else {
    _drawPoints.push(mapPt);
  }
  _redrawAllStrokes();
}

function onDrawMouseUp(e) {
  if (!_isDrawing) return;
  _isDrawing = false;
  if (_drawPoints.length > 0 && _drawCurrentStrokeSettings) {
    if (!_drawCurrentStrokeSettings.isEraser) {
      _pushColorToHistory('fill', _drawCurrentStrokeSettings.penColor);
      if (_drawCurrentStrokeSettings.outlineEnabled) {
        _pushColorToHistory('outline', _drawCurrentStrokeSettings.outlineColor);
      }
    }
    _drawStrokes.push({
      points: _drawPoints.slice(),
      penSize: _drawCurrentStrokeSettings.penSize,
      penColor: _drawCurrentStrokeSettings.penColor,
      penOpacity: _drawCurrentStrokeSettings.penOpacity,
      brushShape: _drawCurrentStrokeSettings.brushShape,
      outlineEnabled: _drawCurrentStrokeSettings.outlineEnabled,
      outlineSize: _drawCurrentStrokeSettings.outlineSize,
      outlineColor: _drawCurrentStrokeSettings.outlineColor,
      outlineOpacity: _drawCurrentStrokeSettings.outlineOpacity,
      sketchJitter: _drawCurrentStrokeSettings.sketchJitter,
      widthVariation: _drawCurrentStrokeSettings.widthVariation,
      isEraser: _drawCurrentStrokeSettings.isEraser
    });
  }
  _drawPoints = [];
  _drawCurrentStrokeSettings = null;
  _redrawAllStrokes();
}

function undoDrawStroke() {
  if (_drawStrokes.length === 0) return;
  _drawStrokes.pop();
  _redrawAllStrokes();
}

// ── 색상 히스토리 헬퍼 ──
function _pushColorToHistory(key, hex) {
  hex = hex.toLowerCase();
  var arr = _colorHistories[key] || (_colorHistories[key] = []);
  var idx = arr.indexOf(hex);
  if (idx !== -1) arr.splice(idx, 1);
  arr.unshift(hex);
  if (arr.length > 8) arr.pop();
}

// ── 가변 굵기 헬퍼 ──
function _computeStrokeWidths(pts, baseWidth, variation) {
  if (!variation || pts.length < 2) return null;
  var dists = [0];
  var total = 0;
  for (var i = 1; i < pts.length; i++) {
    var dx = pts[i].x - pts[i - 1].x;
    var dy = pts[i].y - pts[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    dists.push(total);
  }
  if (total === 0) return null;
  var taperLen = Math.min(total * 0.15, 30);
  var strength = variation / 10;
  var widths = [];
  for (var i = 0; i < pts.length; i++) {
    var t = dists[i] / total;
    var startFade = taperLen > 0 ? Math.min(dists[i] / taperLen, 1) : 1;
    var endFade = taperLen > 0 ? Math.min((total - dists[i]) / taperLen, 1) : 1;
    var taper = 0.3 + Math.min(startFade, endFade) * 0.7;
    var wave = Math.sin(t * Math.PI * 4) * 0.5 + 0.5;
    var seed = (Math.round(pts[i].x * 7) ^ Math.round(pts[i].y * 13)) * 49297 + i * 9301;
    var noise = ((seed & 0xFFFF) / 0xFFFF) * 2 - 1;
    var vary = 1 + (wave * 0.6 + noise * 0.4) * strength * 0.5;
    widths.push(Math.max(0.5, baseWidth * taper * vary));
  }
  return widths;
}

function _drawVariableWidthPath(ctx, pts, widths) {
  if (pts.length === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(0.5, widths[0] / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (var i = 0; i < pts.length - 1; i++) {
    var w = (widths[i] + widths[i + 1]) / 2;
    ctx.beginPath();
    ctx.lineWidth = w;
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
    ctx.stroke();
  }
}

// ── 브러쉬 모양별 스탬프 렌더링 ──

// 경로를 따라 일정 간격으로 보간 포인트 생성 (간격 = size * spacing)
function _interpolatePathPoints(pts, size, spacing) {
  if (pts.length === 0) return [];
  if (!spacing) spacing = 0.2;
  var step = Math.max(0.5, size * spacing);
  var result = [pts[0]];
  var carry = 0;
  for (var i = 1; i < pts.length; i++) {
    var dx = pts[i].x - pts[i - 1].x;
    var dy = pts[i].y - pts[i - 1].y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;
    var nx = dx / dist, ny = dy / dist;
    var pos = -carry;
    while (pos + step <= dist) {
      pos += step;
      result.push({ x: pts[i - 1].x + nx * pos, y: pts[i - 1].y + ny * pos });
    }
    carry = dist - pos;
  }
  // 마지막 점 항상 포함
  var last = pts[pts.length - 1];
  var rl = result[result.length - 1];
  if (Math.abs(rl.x - last.x) > 0.1 || Math.abs(rl.y - last.y) > 0.1) {
    result.push(last);
  }
  return result;
}

// 네모 스탬프 (angle = 진행 방향 라디안, 0이면 축 정렬)
function _stampSquare(ctx, x, y, size) {
  var half = size / 2;
  ctx.fillRect(x - half, y - half, size, size);
}

// 세모 스탬프 (정삼각형, 꼭짓점 위)
function _stampTriangle(ctx, x, y, size) {
  var half = size / 2;
  var h = size * 0.866; // √3/2
  var cy = y + (h / 3 - h / 2); // 중심 보정
  ctx.beginPath();
  ctx.moveTo(x, cy - h * 2 / 3);
  ctx.lineTo(x + half, cy + h / 3);
  ctx.lineTo(x - half, cy + h / 3);
  ctx.closePath();
  ctx.fill();
}

// 비원형 브러쉬로 경로 렌더 (스탬프 방식)
function _drawStampedPath(ctx, pts, size, shape, widths) {
  if (pts.length === 0) return;
  var stampFn = shape === 'square' ? _stampSquare : _stampTriangle;

  if (widths) {
    // 가변 굵기: 각 원본 점에 해당하는 굵기 사용, 보간 시 lerp
    // 보간 없이 원본 점마다 스탬프 (가변 굵기는 점 간격이 이미 촘촘)
    for (var i = 0; i < pts.length; i++) {
      var w = widths[i] || size;
      stampFn(ctx, pts[i].x, pts[i].y, w);
    }
    // 점 사이 보간 (빈틈 방지)
    for (var i = 0; i < pts.length - 1; i++) {
      var w1 = widths[i] || size, w2 = widths[i + 1] || size;
      var dx = pts[i + 1].x - pts[i].x;
      var dy = pts[i + 1].y - pts[i].y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var avgW = (w1 + w2) / 2;
      var step = Math.max(0.5, avgW * 0.2);
      var steps = Math.ceil(dist / step);
      if (steps <= 1) continue;
      for (var j = 1; j < steps; j++) {
        var t = j / steps;
        var w = w1 + (w2 - w1) * t;
        stampFn(ctx, pts[i].x + dx * t, pts[i].y + dy * t, w);
      }
    }
  } else {
    // 고정 굵기: 경로를 따라 촘촘하게 보간
    var interp = _interpolatePathPoints(pts, size, 0.2);
    for (var i = 0; i < interp.length; i++) {
      stampFn(ctx, interp[i].x, interp[i].y, size);
    }
  }
}

// 스트로크 하나를 ctx에 렌더 (펜 또는 윤곽선 전용)
// mode: 'outline' | 'pen' | 'eraser'
function _renderStrokePass(ctx, pts, stroke, lineWidth, mode) {
  var widths = null;
  if (stroke.widthVariation) {
    widths = _computeStrokeWidths(pts, lineWidth, stroke.widthVariation);
  }
  if (mode === 'outline') {
    ctx.strokeStyle = stroke.outlineColor;
    ctx.fillStyle = stroke.outlineColor;
  } else {
    ctx.strokeStyle = stroke.penColor;
    ctx.fillStyle = stroke.penColor;
  }

  var shape = stroke.brushShape || 'round';
  if (shape !== 'round' && mode !== 'eraser') {
    // 비원형 브러쉬: 스탬프 렌더링
    _drawStampedPath(ctx, pts, lineWidth, shape, widths);
  } else {
    // 원형 브러쉬 또는 지우개: 기존 스트로크 렌더링
    if (widths) {
      _drawVariableWidthPath(ctx, pts, widths);
    } else {
      ctx.lineWidth = lineWidth;
      _drawSmoothPath(ctx, pts);
      ctx.stroke();
    }
  }
}

function _redrawAllStrokes() {
  if (!_drawCanvas || !_drawCtx) return;
  _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);
  var origin = getMapOriginOnScreen();
  if (!origin) return;
  var scale = getZoomScale();

  // 모든 스트로크 수집 (완료 + 진행 중)
  var allStrokes = _drawStrokes.slice();
  if (_isDrawing && _drawPoints.length > 0 && _drawCurrentStrokeSettings) {
    allStrokes.push({
      points: _drawPoints,
      penSize: _drawCurrentStrokeSettings.penSize,
      penColor: _drawCurrentStrokeSettings.penColor,
      penOpacity: _drawCurrentStrokeSettings.penOpacity,
      brushShape: _drawCurrentStrokeSettings.brushShape,
      outlineEnabled: _drawCurrentStrokeSettings.outlineEnabled,
      outlineSize: _drawCurrentStrokeSettings.outlineSize,
      outlineColor: _drawCurrentStrokeSettings.outlineColor,
      outlineOpacity: _drawCurrentStrokeSettings.outlineOpacity,
      sketchJitter: _drawCurrentStrokeSettings.sketchJitter,
      widthVariation: _drawCurrentStrokeSettings.widthVariation,
      isEraser: _drawCurrentStrokeSettings.isEraser
    });
  }
  if (allStrokes.length === 0) return;

  var penAlpha = allStrokes[0].penOpacity != null ? allStrokes[0].penOpacity : 1;
  var outAlpha = allStrokes[0].outlineOpacity != null ? allStrokes[0].outlineOpacity : penAlpha;
  var hasOutlines = allStrokes.some(function(s) { return s.outlineEnabled && !s.isEraser; });
  var needsSeparate = hasOutlines && Math.abs(outAlpha - penAlpha) > 0.01;

  // 지우개가 윤곽선까지 완전히 지울 수 있도록 최대 윤곽선 크기 계산
  var maxOutlineExtra = 0;
  if (hasOutlines) {
    allStrokes.forEach(function(s) {
      if (!s.isEraser && s.outlineEnabled && s.outlineSize > maxOutlineExtra) {
        maxOutlineExtra = s.outlineSize;
      }
    });
    maxOutlineExtra *= 2; // 양쪽 합산
  }

  // 맵→화면 좌표 변환 + 지터 적용 헬퍼
  function toScreen(stroke) {
    var pts = stroke.points.map(function(p) {
      return { x: p.x * scale + origin.x, y: p.y * scale + origin.y };
    });
    if (stroke.sketchJitter) pts = _applyJitter(pts, stroke.sketchJitter * scale);
    return pts;
  }

  if (hasOutlines) {
    // 2캔버스: 윤곽선/펜 분리 → 지우개 윤곽선 보존 + 청크 경계 덧그려짐 방지
    var tmpOut = document.createElement('canvas');
    tmpOut.width = _drawCanvas.width; tmpOut.height = _drawCanvas.height;
    var tcO = tmpOut.getContext('2d');
    tcO.lineCap = 'round'; tcO.lineJoin = 'round';

    var tmpPen = document.createElement('canvas');
    tmpPen.width = _drawCanvas.width; tmpPen.height = _drawCanvas.height;
    var tcP = tmpPen.getContext('2d');
    tcP.lineCap = 'round'; tcP.lineJoin = 'round';

    allStrokes.forEach(function(stroke) {
      if (stroke.points.length === 0) return;
      var pts = toScreen(stroke);
      if (stroke.isEraser) {
        // 펜 캔버스: 항상 전체 지움
        tcP.globalCompositeOperation = 'destination-out';
        _renderStrokePass(tcP, pts, stroke, stroke.penSize * scale, 'pen');
        tcP.globalCompositeOperation = 'source-over';
        // 윤곽선 캔버스: 설정에 따라 처리
        if (stroke.outlineEnabled) {
          // 윤곽선 ON: 내부만 지워서 절단면에 윤곽선 링 보존
          var innerW = stroke.penSize - stroke.outlineSize * 2;
          if (innerW > 0) {
            tcO.globalCompositeOperation = 'destination-out';
            _renderStrokePass(tcO, pts, stroke, innerW * scale, 'pen');
            tcO.globalCompositeOperation = 'source-over';
          }
        } else {
          // 윤곽선 OFF: 윤곽선까지 완전히 지움
          tcO.globalCompositeOperation = 'destination-out';
          _renderStrokePass(tcO, pts, stroke, (stroke.penSize + maxOutlineExtra) * scale, 'pen');
          tcO.globalCompositeOperation = 'source-over';
        }
      } else {
        if (stroke.outlineEnabled) {
          _renderStrokePass(tcO, pts, stroke, (stroke.penSize + stroke.outlineSize * 2) * scale, 'outline');
        }
        _renderStrokePass(tcP, pts, stroke, stroke.penSize * scale, 'pen');
      }
    });

    _drawCtx.save();
    if (needsSeparate) {
      // 윤곽선/펜 알파가 다름: 각각 다른 알파로 합성
      _drawCtx.globalAlpha = outAlpha;
      _drawCtx.drawImage(tmpOut, 0, 0);
      _drawCtx.globalAlpha = penAlpha;
      _drawCtx.drawImage(tmpPen, 0, 0);
    } else {
      // 같은 알파: 먼저 병합 후 한 번에 합성 (알파 중첩 방지)
      var merged = document.createElement('canvas');
      merged.width = _drawCanvas.width; merged.height = _drawCanvas.height;
      var mc = merged.getContext('2d');
      mc.drawImage(tmpOut, 0, 0);
      mc.drawImage(tmpPen, 0, 0);
      _drawCtx.globalAlpha = penAlpha;
      _drawCtx.drawImage(merged, 0, 0);
    }
    _drawCtx.restore();
  } else {
    // 윤곽선 없음: 단일 캔버스
    var tmp = document.createElement('canvas');
    tmp.width = _drawCanvas.width;
    tmp.height = _drawCanvas.height;
    var tc = tmp.getContext('2d');
    tc.lineCap = 'round';
    tc.lineJoin = 'round';

    allStrokes.forEach(function(stroke) {
      if (stroke.points.length === 0) return;
      var pts = toScreen(stroke);
      if (stroke.isEraser) {
        tc.globalCompositeOperation = 'destination-out';
        _renderStrokePass(tc, pts, stroke, stroke.penSize * scale, 'pen');
        tc.globalCompositeOperation = 'source-over';
      } else {
        _renderStrokePass(tc, pts, stroke, stroke.penSize * scale, 'pen');
      }
    });

    _drawCtx.save();
    _drawCtx.globalAlpha = penAlpha;
    _drawCtx.drawImage(tmp, 0, 0);
    _drawCtx.restore();
  }
}

// 스케치 떨림 적용 (결정적 시드 기반, 재그리기 시 동일 결과)
function _applyJitter(pts, amount) {
  if (!amount || amount <= 0 || pts.length < 2) return pts;
  var result = [];
  // 첫/끝 점은 고정
  result.push(pts[0]);
  for (var i = 1; i < pts.length - 1; i++) {
    var prev = pts[i - 1];
    var next = pts[i + 1];
    // 경로 방향에 수직인 벡터
    var dx = next.x - prev.x;
    var dy = next.y - prev.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len;
    var ny = dx / len;
    // 결정적 의사 난수 (점 인덱스 + 좌표 기반)
    var seed = (i * 9301 + Math.round(pts[i].x * 100) * 49297 + Math.round(pts[i].y * 100) * 233) % 65521;
    var rand = ((seed / 65521) - 0.5) * 2; // -1 ~ 1
    var displacement = rand * amount;
    result.push({ x: pts[i].x + nx * displacement, y: pts[i].y + ny * displacement });
  }
  if (pts.length > 1) result.push(pts[pts.length - 1]);
  return result;
}

// 부드러운 경로 그리기 (2차 베지어 곡선 보간)
function _drawSmoothPath(ctx, pts) {
  if (pts.length === 0) return;
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, 0.5, 0, Math.PI * 2);
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (var i = 1; i < pts.length - 1; i++) {
    var mx = (pts[i].x + pts[i + 1].x) / 2;
    var my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

// 맵 픽셀 좌표의 스트로크 하나를 화면 캔버스에 렌더
// forceOpaque=true: 알파 무시하고 불투명 렌더 (외부에서 일괄 합성 시)
function _renderOneStrokeToScreen(ctx, stroke, origin, scale, forceOpaque) {
  if (stroke.points.length === 0) return;

  // 맵 → 화면 좌표 변환
  var pts = stroke.points.map(function(p) {
    return { x: p.x * scale + origin.x, y: p.y * scale + origin.y };
  });
  if (stroke.sketchJitter) pts = _applyJitter(pts, stroke.sketchJitter * scale);

  var outW = (stroke.penSize + stroke.outlineSize * 2) * scale;
  var penW = stroke.penSize * scale;
  var alpha = forceOpaque ? 1 : stroke.penOpacity;

  // 윤곽선+펜을 임시 캔버스에 불투명으로 그린 뒤 알파 합성 (겹침 방지)
  if (stroke.outlineEnabled && alpha < 1) {
    var tmp = document.createElement('canvas');
    tmp.width = ctx.canvas.width;
    tmp.height = ctx.canvas.height;
    var tc = tmp.getContext('2d');
    tc.lineCap = 'round';
    tc.lineJoin = 'round';

    tc.strokeStyle = stroke.outlineColor;
    tc.lineWidth = outW;
    _drawSmoothPath(tc, pts);
    tc.stroke();

    tc.strokeStyle = stroke.penColor;
    tc.lineWidth = penW;
    _drawSmoothPath(tc, pts);
    tc.stroke();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.outlineEnabled) {
    ctx.strokeStyle = stroke.outlineColor;
    ctx.lineWidth = outW;
    _drawSmoothPath(ctx, pts);
    ctx.stroke();
  }

  ctx.strokeStyle = stroke.penColor;
  ctx.lineWidth = penW;
  _drawSmoothPath(ctx, pts);
  ctx.stroke();

  ctx.restore();
}

function finishDrawing() {
  if (!_drawCanvas || _drawStrokes.length === 0) {
    cleanupDrawCanvas();
    return;
  }

  // 모든 스트로크의 바운딩 박스 계산 (맵 픽셀 좌표)
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  _drawStrokes.forEach(function(stroke) {
    var pad = (stroke.penSize + (stroke.outlineEnabled ? stroke.outlineSize * 2 : 0)) / 2 + 2;
    stroke.points.forEach(function(pt) {
      if (pt.x - pad < minX) minX = pt.x - pad;
      if (pt.y - pad < minY) minY = pt.y - pad;
      if (pt.x + pad > maxX) maxX = pt.x + pad;
      if (pt.y + pad > maxY) maxY = pt.y + pad;
    });
  });

  if (minX >= maxX || minY >= maxY) {
    cleanupDrawCanvas();
    return;
  }

  minX = Math.floor(minX);
  minY = Math.floor(minY);
  maxX = Math.ceil(maxX);
  maxY = Math.ceil(maxY);
  var bw = maxX - minX;
  var bh = maxY - minY;

  // 맵 픽셀 → 고해상도 캔버스 (기본 2x, 작은 그림은 최소 256px 보장)
  var compositeScale = COMPOSITE_PX_PER_TILE / CELL_PX;
  var minOutputPx = 256;
  var baseW = bw * compositeScale, baseH = bh * compositeScale;
  if (baseW < minOutputPx && baseH < minOutputPx) {
    compositeScale = Math.max(compositeScale, Math.min(minOutputPx / bw, minOutputPx / bh));
  }
  var cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.max(1, Math.round(bw * compositeScale));
  cropCanvas.height = Math.max(1, Math.round(bh * compositeScale));
  var cropCtx = cropCanvas.getContext('2d');
  cropCtx.scale(compositeScale, compositeScale);
  cropCtx.translate(-minX, -minY);

  // 맵 픽셀 좌표로 직접 렌더 (화면 변환 불필요)
  _renderStrokesToCtx(cropCtx, _drawStrokes);

  var dataUrl = cropCanvas.toDataURL('image/png');

  // 맵 픽셀 → 소수 타일 좌표 (그리드 스냅 없이 정확한 위치 유지)
  var mapCoords = {
    x: minX / CELL_PX,
    y: minY / CELL_PX,
    width: Math.max(1, bw / CELL_PX),
    height: Math.max(1, bh / CELL_PX)
  };

  // stageObject 변환 우회 — 그리기는 서브타일 정밀도 필요
  var zoomEl = getZoomContainer();
  if (zoomEl) {
    if (_cachedZoomEl && _cachedZoomEl !== zoomEl) _migrateStaged(zoomEl);
    _cachedZoomEl = zoomEl;
    readSettingsFromDOM();

    var obj = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      mapCoords: mapCoords,
      angle: 0,
      imageDataUrl: dataUrl,
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
    pushUndo({ type: 'stage', ids: [obj.id] });
    updateConfirmBar();
  }

  cleanupDrawCanvas();
  initDrawCanvas();
}

// 스트로크를 지정된 캔버스 컨텍스트에 렌더링 (재사용 가능)
// 윤곽선 있으면 2캔버스 분리, 없으면 단일 캔버스
function _renderStrokesToCtx(ctx, strokes) {
  if (strokes.length === 0) return;

  var penAlpha = strokes[0].penOpacity != null ? strokes[0].penOpacity : 1;
  var outAlpha = strokes[0].outlineOpacity != null ? strokes[0].outlineOpacity : penAlpha;
  var hasOutlines = strokes.some(function(s) { return s.outlineEnabled && !s.isEraser; });
  var needsSeparate = hasOutlines && Math.abs(outAlpha - penAlpha) > 0.01;

  // 지우개가 윤곽선까지 완전히 지울 수 있도록 최대 윤곽선 크기 계산
  var maxOutlineExtra = 0;
  if (hasOutlines) {
    strokes.forEach(function(s) {
      if (!s.isEraser && s.outlineEnabled && s.outlineSize > maxOutlineExtra) {
        maxOutlineExtra = s.outlineSize;
      }
    });
    maxOutlineExtra *= 2;
  }

  function prepPts(stroke) {
    var pts = stroke.points;
    if (stroke.sketchJitter) pts = _applyJitter(pts, stroke.sketchJitter);
    return pts;
  }

  if (hasOutlines) {
    // 2캔버스: 윤곽선/펜 분리 → 지우개 윤곽선 보존 + 청크 경계 덧그려짐 방지
    var tmpOut = document.createElement('canvas');
    tmpOut.width = ctx.canvas.width; tmpOut.height = ctx.canvas.height;
    var tcO = tmpOut.getContext('2d');
    tcO.setTransform(ctx.getTransform());
    tcO.lineCap = 'round'; tcO.lineJoin = 'round';

    var tmpPen = document.createElement('canvas');
    tmpPen.width = ctx.canvas.width; tmpPen.height = ctx.canvas.height;
    var tcP = tmpPen.getContext('2d');
    tcP.setTransform(ctx.getTransform());
    tcP.lineCap = 'round'; tcP.lineJoin = 'round';

    strokes.forEach(function(stroke) {
      if (stroke.points.length === 0) return;
      var pts = prepPts(stroke);
      if (stroke.isEraser) {
        // 펜 캔버스: 항상 전체 지움
        tcP.globalCompositeOperation = 'destination-out';
        _renderStrokePass(tcP, pts, stroke, stroke.penSize, 'pen');
        tcP.globalCompositeOperation = 'source-over';
        // 윤곽선 캔버스: 설정에 따라 처리
        if (stroke.outlineEnabled) {
          // 윤곽선 ON: 내부만 지워서 절단면에 윤곽선 링 보존
          var innerW = stroke.penSize - stroke.outlineSize * 2;
          if (innerW > 0) {
            tcO.globalCompositeOperation = 'destination-out';
            _renderStrokePass(tcO, pts, stroke, innerW, 'pen');
            tcO.globalCompositeOperation = 'source-over';
          }
        } else {
          // 윤곽선 OFF: 윤곽선까지 완전히 지움
          tcO.globalCompositeOperation = 'destination-out';
          _renderStrokePass(tcO, pts, stroke, stroke.penSize + maxOutlineExtra, 'pen');
          tcO.globalCompositeOperation = 'source-over';
        }
      } else {
        if (stroke.outlineEnabled) {
          _renderStrokePass(tcO, pts, stroke, stroke.penSize + stroke.outlineSize * 2, 'outline');
        }
        _renderStrokePass(tcP, pts, stroke, stroke.penSize, 'pen');
      }
    });

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (needsSeparate) {
      ctx.globalAlpha = outAlpha;
      ctx.drawImage(tmpOut, 0, 0);
      ctx.globalAlpha = penAlpha;
      ctx.drawImage(tmpPen, 0, 0);
    } else {
      var merged = document.createElement('canvas');
      merged.width = ctx.canvas.width; merged.height = ctx.canvas.height;
      var mc = merged.getContext('2d');
      mc.drawImage(tmpOut, 0, 0);
      mc.drawImage(tmpPen, 0, 0);
      ctx.globalAlpha = penAlpha;
      ctx.drawImage(merged, 0, 0);
    }
    ctx.restore();
  } else {
    // 윤곽선 없음: 단일 캔버스
    var tmp = document.createElement('canvas');
    tmp.width = ctx.canvas.width;
    tmp.height = ctx.canvas.height;
    var tc = tmp.getContext('2d');
    tc.setTransform(ctx.getTransform());
    tc.lineCap = 'round';
    tc.lineJoin = 'round';

    strokes.forEach(function(stroke) {
      if (stroke.points.length === 0) return;
      var pts = prepPts(stroke);
      if (stroke.isEraser) {
        tc.globalCompositeOperation = 'destination-out';
        _renderStrokePass(tc, pts, stroke, stroke.penSize, 'pen');
        tc.globalCompositeOperation = 'source-over';
      } else {
        _renderStrokePass(tc, pts, stroke, stroke.penSize, 'pen');
      }
    });

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = penAlpha;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }
}


// ── 텍스트 편집기 (Phase 2: area-first WYSIWYG) ────────────────

var _textEditorWrap = null; // 외부 래퍼 (zoom container 내 position:absolute)
var _textEditor = null;    // contentEditable div
var _textToolbar = null;   // 서식 바
var _textMapCoords = null; // 편집 시작 시점의 맵 좌표 (패닝/줌 드리프트 방지)
var _textBgColor = '';     // 텍스트 박스 배경색 ('' = 투명)
var _textAlign = 'left';   // 수평 정렬: left / center / right
var _textVAlign = 'top';   // 수직 정렬: top / middle / bottom
var _textFontFamily = 'sans-serif'; // 글꼴
var _textStrokeColor = '#000000'; // 윤곽선 색상
var _textStrokeWidth = 0;  // 윤곽선 두께 (0=없음)
var _savedTextRange = null; // 툴바 조작 시 보존할 선택 범위
var _reopenedObj = null;   // 재편집 시 원본 객체 (ESC로 복원용)
var _tbPosRaf = null;      // 툴바 위치 추적 rAF
var _loadedWebFonts = {};  // 이미 로드된 웹 폰트 캐시
var _localSystemFonts = null; // queryLocalFonts 결과 캐시

// 폰트 목록: { label, value, type: 'local'|'web'|'system', gfName? }
var _BUILTIN_FONTS = [
  { label: '기본 (sans-serif)', value: 'sans-serif', type: 'local' },
  { label: 'serif', value: 'serif', type: 'local' },
  { label: 'monospace', value: 'monospace', type: 'local' },
  { label: '─ 웹 폰트 (Google) ─', value: '__sep__', type: 'sep' },
  { label: 'Noto Sans KR (본고딕)', value: '"Noto Sans KR", sans-serif', type: 'web', gfName: 'Noto+Sans+KR' },
  { label: 'Noto Serif KR (본명조)', value: '"Noto Serif KR", serif', type: 'web', gfName: 'Noto+Serif+KR' },
  { label: 'Nanum Gothic (나눔고딕)', value: '"Nanum Gothic", sans-serif', type: 'web', gfName: 'Nanum+Gothic' },
  { label: 'Nanum Myeongjo (나눔명조)', value: '"Nanum Myeongjo", serif', type: 'web', gfName: 'Nanum+Myeongjo' },
  { label: 'Nanum Pen (나눔펜)', value: '"Nanum Pen Script", cursive', type: 'web', gfName: 'Nanum+Pen+Script' },
  { label: 'Black Han Sans (검은 한산스)', value: '"Black Han Sans", sans-serif', type: 'web', gfName: 'Black+Han+Sans' },
  { label: 'Jua (주아)', value: '"Jua", sans-serif', type: 'web', gfName: 'Jua' },
  { label: 'Gothic A1 (고딕 A1)', value: '"Gothic A1", sans-serif', type: 'web', gfName: 'Gothic+A1' },
  { label: 'Do Hyeon (도현)', value: '"Do Hyeon", sans-serif', type: 'web', gfName: 'Do+Hyeon' },
  { label: 'Gaegu (개구)', value: '"Gaegu", cursive', type: 'web', gfName: 'Gaegu' },
  { label: 'Sunflower (해바라기)', value: '"Sunflower", sans-serif', type: 'web', gfName: 'Sunflower' },
  { label: 'Gugi (구기)', value: '"Gugi", cursive', type: 'web', gfName: 'Gugi' },
  { label: 'East Sea Dokdo (동해독도)', value: '"East Sea Dokdo", cursive', type: 'web', gfName: 'East+Sea+Dokdo' },
  { label: 'Hi Melody (하이멜로디)', value: '"Hi Melody", cursive', type: 'web', gfName: 'Hi+Melody' },
  { label: 'Dokdo (독도)', value: '"Dokdo", cursive', type: 'web', gfName: 'Dokdo' },
  { label: 'Roboto', value: '"Roboto", sans-serif', type: 'web', gfName: 'Roboto' },
  { label: 'Playfair Display', value: '"Playfair Display", serif', type: 'web', gfName: 'Playfair+Display' },
  { label: 'Caveat', value: '"Caveat", cursive', type: 'web', gfName: 'Caveat' },
  { label: 'Permanent Marker', value: '"Permanent Marker", cursive', type: 'web', gfName: 'Permanent+Marker' }
];

var _CUSTOM_FONTS_KEY = 'bwbr-placement-custom-fonts';

function _loadCustomFonts() {
  try {
    var raw = localStorage.getItem(_CUSTOM_FONTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function _saveCustomFonts(arr) {
  try { localStorage.setItem(_CUSTOM_FONTS_KEY, JSON.stringify(arr)); } catch (e) {}
}

function _buildFontList() {
  var custom = _loadCustomFonts();
  var list = _BUILTIN_FONTS.slice();
  // 시스템 로컬 폰트
  if (_localSystemFonts && _localSystemFonts.length > 0) {
    list.push({ label: '─ 내 컴퓨터 폰트 ─', value: '__sep_sys__', type: 'sep' });
    _localSystemFonts.forEach(function(item) {
      list.push({ label: item.label, value: '"' + item.family + '"', type: 'system' });
    });
  }
  // 사용자 추가 웹 폰트
  if (custom.length > 0) {
    list.push({ label: '─ 사용자 웹 폰트 ─', value: '__sep2__', type: 'sep' });
    custom.forEach(function(c) { list.push(c); });
  }
  return list;
}

var _FONT_LIST = _buildFontList();

function _rebuildFontSelect(sel) {
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  _FONT_LIST.forEach(function(f) {
    var opt = document.createElement('option');
    if (f.type === 'sep') {
      opt.disabled = true;
      opt.textContent = f.label;
    } else {
      opt.value = f.value;
      opt.textContent = f.label;
      opt.style.fontFamily = f.value;
      if (f.value === _textFontFamily) opt.selected = true;
    }
    sel.appendChild(opt);
  });
  // 로컬 폰트 불러오기
  var loadLocalOpt = document.createElement('option');
  loadLocalOpt.value = '__load_local__';
  loadLocalOpt.textContent = '📁 내 컴퓨터 폰트 불러오기...';
  loadLocalOpt.style.color = '#ff9800';
  sel.appendChild(loadLocalOpt);
  // "웹 폰트 추가" 옵션
  var addOpt = document.createElement('option');
  addOpt.value = '__add_custom__';
  addOpt.textContent = '+ 웹 폰트 추가...';
  addOpt.style.color = '#42a5f5';
  sel.appendChild(addOpt);
}

function _loadLocalSystemFonts(cb) {
  if (!window.queryLocalFonts) {
    alert('이 브라우저에서 로컬 폰트 접근을 지원하지 않습니다.');
    cb(null); return;
  }
  window.queryLocalFonts().then(function(fonts) {
    // family별 대표 표시명 결정 (한국어 fullName 우선)
    var familyMap = {};
    fonts.forEach(function(f) {
      if (!familyMap[f.family]) {
        // fullName에 한글이 포함되어 있으면 한글 이름 사용
        var hasKorean = /[\uAC00-\uD7A3]/.test(f.fullName);
        var label = f.family;
        if (hasKorean) {
          // fullName에서 스타일 제거 (e.g. "맑은 고딕 Bold" → "맑은 고딕")
          var cleaned = f.fullName.replace(/\s*(Regular|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Thin|Black|Heavy|Condensed|Expanded)$/i, '').trim();
          if (cleaned && cleaned !== f.family) label = cleaned + ' (' + f.family + ')';
          else if (cleaned) label = cleaned;
        }
        familyMap[f.family] = label;
      }
    });
    var families = Object.keys(familyMap);
    families.sort(function(a, b) {
      return familyMap[a].localeCompare(familyMap[b], 'ko');
    });
    _localSystemFonts = families.map(function(fam) {
      return { family: fam, label: familyMap[fam] };
    });

    // 시스템 폰트를 _FONT_LIST에 추가
    _FONT_LIST = _buildFontList();
    cb(families);
  }).catch(function(err) {
    // 사용자가 권한 거부
    cb(null);
  });
}

function _promptAddCustomFont(cb) {
  var fontName = prompt('Google Fonts 이름을 입력하세요\n(예: Noto Sans JP, Kosugi Maru, Roboto Slab)');
  if (!fontName || !fontName.trim()) { cb(null); return; }
  fontName = fontName.trim();
  var gfName = fontName.replace(/\s+/g, '+');
  var cssFamily = '"' + fontName + '", sans-serif';

  // 중복 검사
  if (_FONT_LIST.some(function(f) { return f.gfName === gfName; })) {
    cb(null); return;
  }

  var entry = { label: fontName, value: cssFamily, type: 'web', gfName: gfName };
  var custom = _loadCustomFonts();
  custom.push(entry);
  _saveCustomFonts(custom);
  _FONT_LIST = _buildFontList();

  // 폰트 로드
  _loadWebFont(entry, function() { cb(entry); });
}

function _loadWebFont(fontEntry, cb) {
  if (!fontEntry || fontEntry.type !== 'web' || !fontEntry.gfName) { if (cb) cb(); return; }
  if (_loadedWebFonts[fontEntry.gfName]) { if (cb) cb(); return; }
  _loadedWebFonts[fontEntry.gfName] = true;
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + fontEntry.gfName + ':wght@400;700&display=swap';
  link.onload = function() { if (cb) cb(); };
  link.onerror = function() { if (cb) cb(); };
  document.head.appendChild(link);
}

function startTextEditing(rect) {
  if (_textEditor) cleanupTextEditor();

  _textMapCoords = screenToMapCoords(rect);
  if (!_textMapCoords) return;
  _textBgColor = '';
  _state.textEditing = true;

  var zoomEl = getZoomContainer();
  if (!zoomEl) return;
  if (getComputedStyle(zoomEl).position === 'static') zoomEl.style.position = 'relative';

  var mc = _textMapCoords;

  // 래퍼 (zoom container 내 absolute — 패닝/줌 자동 추종)
  _textEditorWrap = document.createElement('div');
  _textEditorWrap.className = 'bwbr-text-editor-wrap';
  _textEditorWrap.style.left = (mc.x * CELL_PX) + 'px';
  _textEditorWrap.style.top = (mc.y * CELL_PX) + 'px';
  _textEditorWrap.style.width = (mc.width * CELL_PX) + 'px';
  _textEditorWrap.style.minHeight = (mc.height * CELL_PX) + 'px';
  _applyVAlignCSS();
  zoomEl.appendChild(_textEditorWrap);

  // contentEditable (inner)
  _textEditor = document.createElement('div');
  _textEditor.className = 'bwbr-text-editor';
  _textEditor.contentEditable = 'true';
  _textEditor.style.textAlign = _textAlign;
  _textEditor.style.fontFamily = _textFontFamily;
  _textEditorWrap.appendChild(_textEditor);

  // 웹 폰트 선로드 + @font-face local() 등록
  _ensureFontFace(_textFontFamily);
  var fontEntry = _FONT_LIST.find(function(f) { return f.value === _textFontFamily; });
  if (fontEntry) _loadWebFont(fontEntry);

  // 서식 바 (screen 좌표 — body에 부착)
  _textToolbar = createTextToolbar();
  document.body.appendChild(_textToolbar);
  _startToolbarPosTracker();

  // 우클릭 컨텍스트 메뉴 차단
  _textEditor.addEventListener('contextmenu', function(ev) { ev.preventDefault(); });
  _textEditorWrap.addEventListener('contextmenu', function(ev) { ev.preventDefault(); });
  _textToolbar.addEventListener('contextmenu', function(ev) { ev.preventDefault(); });

  // 포커스
  _textEditor.focus();

  // 툴바 조작 시 선택 범위 보존 (포커스 잃으면 선택도 잃음)
  _textEditor.addEventListener('blur', function() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && _textEditor && _textEditor.contains(sel.anchorNode)) {
      _savedTextRange = sel.getRangeAt(0).cloneRange();
    }
  });

  // min-height 강제 (기본 폰트 사이즈 기준)
  _enforceMinHeight();

  // 오버레이 숨김 (편집 중 클릭/입력 방해 방지)
  if (_overlay) _overlay.style.pointerEvents = 'none';

  // 외부 클릭 감지 (약간 지연)
  setTimeout(function () {
    document.addEventListener('mousedown', _onTextClickOutside, true);
  }, 50);
}

function _applyVAlignCSS() {
  if (!_textEditorWrap) return;
  _textEditorWrap.style.justifyContent =
    _textVAlign === 'middle' ? 'center' :
    _textVAlign === 'bottom' ? 'flex-end' : 'flex-start';
}

function _startToolbarPosTracker() {
  _stopToolbarPosTracker();
  function tick() {
    if (!_textEditorWrap || !_textToolbar) return;
    var r = _textEditorWrap.getBoundingClientRect();
    var barH = _textToolbar.offsetHeight || 60;
    var gap = 8;
    var y = r.top - barH - gap;
    if (y < 4) y = r.bottom + gap;
    // 툴바가 텍스트 박스와 겹치면 아래로 이동
    if (y > r.top && y < r.bottom) y = r.bottom + gap;
    _textToolbar.style.left = r.left + 'px';
    _textToolbar.style.top = y + 'px';
    _tbPosRaf = requestAnimationFrame(tick);
  }
  _tbPosRaf = requestAnimationFrame(tick);
}

function _stopToolbarPosTracker() {
  if (_tbPosRaf) { cancelAnimationFrame(_tbPosRaf); _tbPosRaf = null; }
}

function _updateStrokePreview() {
  if (!_textEditor) return;
  if (_textStrokeWidth > 0) {
    _textEditor.style.webkitTextStroke = _textStrokeWidth + 'px ' + _textStrokeColor;
  } else {
    _textEditor.style.webkitTextStroke = '';
  }
}

function _restoreTextSelection() {
  if (_savedTextRange && _textEditor) {
    _textEditor.focus();
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedTextRange);
  }
}

function _applyStyleToSelection(prop, value) {
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  var range = sel.getRangeAt(0);
  if (range.collapsed) {
    var span = document.createElement('span');
    span.style[prop] = value;
    span.appendChild(document.createTextNode('\u200B'));
    range.insertNode(span);
    range.setStartAfter(span);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  var span2 = document.createElement('span');
  span2.style[prop] = value;
  try { range.surroundContents(span2); } catch (e) {
    var frag = range.extractContents();
    span2.appendChild(frag);
    range.insertNode(span2);
  }
  sel.removeAllRanges();
  var nr = document.createRange();
  nr.selectNodeContents(span2);
  sel.addRange(nr);
}

function createTextToolbar() {
  var bar = document.createElement('div');
  bar.className = 'bwbr-text-toolbar';

  // ── Row 1: 정렬 + 폰트 ──
  var row1 = document.createElement('div');
  row1.className = 'bwbr-text-toolbar-row';

  // 수평 정렬
  var alignBtns = [
    { val: 'left', tip: '왼쪽 정렬' },
    { val: 'center', tip: '가운데 정렬' },
    { val: 'right', tip: '오른쪽 정렬' }
  ];
  alignBtns.forEach(function(ab) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-text-toolbar-btn' + (_textAlign === ab.val ? ' bwbr-tb-active' : '');
    btn.dataset.alignH = ab.val;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
      (ab.val === 'left' ? '<path d="M3 3h18v2H3zm0 4h12v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h18v2H3z"/>' :
       ab.val === 'center' ? '<path d="M3 3h18v2H3zm3 4h12v2H6zm-3 4h18v2H3zm3 4h12v2H6zm-3 4h18v2H3z"/>' :
       '<path d="M3 3h18v2H3zm6 4h12v2H9zm-6 4h18v2H3zm6 4h12v2H9zm-6 4h18v2H3z"/>') +
      '</svg>';
    _setTooltip(btn, ab.tip);
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    btn.addEventListener('click', function() {
      _textAlign = ab.val;
      if (_textEditor) _textEditor.style.textAlign = ab.val;
      bar.querySelectorAll('[data-align-h]').forEach(function(b) {
        b.classList.toggle('bwbr-tb-active', b.dataset.alignH === ab.val);
      });
      _textEditor.focus();
    });
    row1.appendChild(btn);
  });

  // 수직 정렬
  var vAlignBtns = [
    { val: 'top', tip: '상단 정렬', icon: 'T\u2191' },
    { val: 'middle', tip: '중간 정렬', icon: 'M' },
    { val: 'bottom', tip: '하단 정렬', icon: 'B\u2193' }
  ];
  vAlignBtns.forEach(function(vb) {
    var btn = document.createElement('button');
    btn.className = 'bwbr-text-toolbar-btn' + (_textVAlign === vb.val ? ' bwbr-tb-active' : '');
    btn.dataset.alignV = vb.val;
    btn.textContent = vb.icon;
    _setTooltip(btn, vb.tip);
    btn.style.fontSize = '11px';
    btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    btn.addEventListener('click', function() {
      _textVAlign = vb.val;
      _applyVAlignCSS();
      bar.querySelectorAll('[data-align-v]').forEach(function(b) {
        b.classList.toggle('bwbr-tb-active', b.dataset.alignV === vb.val);
      });
      _textEditor.focus();
    });
    row1.appendChild(btn);
  });

  row1.appendChild(_makeToolbarSep());

  // 글꼴 선택
  var fontSelect = document.createElement('select');
  fontSelect.className = 'bwbr-text-toolbar-select';
  _setTooltip(fontSelect, '글꼴');
  _FONT_LIST.forEach(function(f) {
    var opt = document.createElement('option');
    if (f.type === 'sep') {
      opt.disabled = true;
      opt.textContent = f.label;
    } else {
      opt.value = f.value;
      opt.textContent = f.label;
      opt.style.fontFamily = f.value;
      if (f.value === _textFontFamily) opt.selected = true;
    }
    fontSelect.appendChild(opt);
  });
  var loadLocalOpt = document.createElement('option');
  loadLocalOpt.value = '__load_local__';
  loadLocalOpt.textContent = '\uD83D\uDCC1 내 컴퓨터 폰트 불러오기...';
  loadLocalOpt.style.color = '#ff9800';
  fontSelect.appendChild(loadLocalOpt);
  var addOpt = document.createElement('option');
  addOpt.value = '__add_custom__';
  addOpt.textContent = '+ 웹 폰트 추가...';
  addOpt.style.color = '#42a5f5';
  fontSelect.appendChild(addOpt);
  fontSelect.addEventListener('change', function() {
    var val = fontSelect.value;
    if (val === '__load_local__') {
      fontSelect.value = _textFontFamily;
      _loadLocalSystemFonts(function(families) {
        if (!families) return;
        _rebuildFontSelect(fontSelect);
        _textEditor.focus();
      });
      return;
    }
    if (val === '__add_custom__') {
      fontSelect.value = _textFontFamily;
      _promptAddCustomFont(function(newEntry) {
        if (!newEntry) return;
        _FONT_LIST = _buildFontList();
        _textFontFamily = newEntry.value;
        if (_textEditor) _textEditor.style.fontFamily = newEntry.value;
        _loadWebFont(newEntry);
        _rebuildFontSelect(fontSelect);
      });
      return;
    }
    _textFontFamily = val;
    if (_textEditor) _textEditor.style.fontFamily = val;
    _ensureFontFace(val);
    var entry = _FONT_LIST.find(function(f) { return f.value === val; });
    if (entry && entry.type === 'web') _loadWebFont(entry);
    _textEditor.focus();
  });
  row1.appendChild(fontSelect);

  bar.appendChild(row1);

  // ── Row 2: 서식 + 크기 + 색상 + 확인/취소 ──
  var row2 = document.createElement('div');
  row2.className = 'bwbr-text-toolbar-row';

  // Bold
  var btnB = _makeToolbarBtn('B', 'bold', '볼드 (Ctrl+B)');
  btnB.style.fontWeight = 'bold';
  row2.appendChild(btnB);

  // Italic
  var btnI = _makeToolbarBtn('I', 'italic', '이탤릭 (Ctrl+I)');
  btnI.style.fontStyle = 'italic';
  row2.appendChild(btnI);

  // Underline
  var btnU = _makeToolbarBtn('U', 'underline', '밑줄 (Ctrl+U)');
  btnU.style.textDecoration = 'underline';
  row2.appendChild(btnU);

  // Strikethrough
  var btnS = _makeToolbarBtn('S', 'strikethrough', '취소선');
  btnS.style.textDecoration = 'line-through';
  row2.appendChild(btnS);

  row2.appendChild(_makeToolbarSep());

  // 크기 라벨 + 입력
  var sizeLabel = document.createElement('span');
  sizeLabel.className = 'bwbr-toolbar-label';
  sizeLabel.textContent = '크기';
  row2.appendChild(sizeLabel);

  // 크기 콤보 (입력 + 드롭다운)
  var sizeCombo = document.createElement('div');
  sizeCombo.className = 'bwbr-size-combo';
  var sizeInput = document.createElement('input');
  sizeInput.type = 'text';
  sizeInput.className = 'bwbr-size-combo-input';
  sizeInput.value = '16';
  _setTooltip(sizeInput, '글꼴 크기');
  var sizeDropBtn = document.createElement('button');
  sizeDropBtn.className = 'bwbr-size-combo-btn';
  sizeDropBtn.type = 'button';
  sizeDropBtn.textContent = '\u25BC';
  _setTooltip(sizeDropBtn, '크기 목록');
  var sizeDrop = document.createElement('div');
  sizeDrop.className = 'bwbr-size-combo-drop';
  var _sizeSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96];
  _sizeSizes.forEach(function(s) {
    var opt = document.createElement('div');
    opt.className = 'bwbr-size-combo-opt';
    opt.textContent = s;
    opt.addEventListener('mousedown', function(ev) {
      ev.preventDefault(); // 포커스 이동 방지
      sizeInput.value = s;
      sizeDrop.classList.remove('bwbr-size-combo-drop--open');
      _restoreTextSelection();
      _applyFontSize(s);
      _textEditor.focus();
    });
    sizeDrop.appendChild(opt);
  });
  sizeDropBtn.addEventListener('click', function(ev) {
    ev.preventDefault();
    sizeDrop.classList.toggle('bwbr-size-combo-drop--open');
  });
  // 콤보 바깥 클릭 시 드롭다운 닫기
  document.addEventListener('mousedown', function(ev) {
    if (!sizeCombo.contains(ev.target)) sizeDrop.classList.remove('bwbr-size-combo-drop--open');
  });
  sizeInput.addEventListener('change', function() {
    var v = parseInt(sizeInput.value);
    if (v && v > 0 && v <= 200) {
      _restoreTextSelection();
      _applyFontSize(v);
      sizeInput.value = v;
    } else {
      sizeInput.value = '16';
    }
    _textEditor.focus();
  });
  sizeInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); sizeInput.blur(); }
    e.stopPropagation();
  });
  sizeInput.addEventListener('focus', function() { sizeInput.select(); });
  sizeCombo.appendChild(sizeInput);
  sizeCombo.appendChild(sizeDropBtn);
  sizeCombo.appendChild(sizeDrop);
  row2.appendChild(sizeCombo);

  // 윤곽 두께 콤보 (입력 + 드롭다운)
  var strokeLabel = document.createElement('span');
  strokeLabel.className = 'bwbr-toolbar-label';
  strokeLabel.textContent = '윤곽';
  row2.appendChild(strokeLabel);

  var strokeCombo = document.createElement('div');
  strokeCombo.className = 'bwbr-size-combo';
  var strokeInput = document.createElement('input');
  strokeInput.type = 'text';
  strokeInput.className = 'bwbr-size-combo-input';
  strokeInput.value = _textStrokeWidth || '0';
  _setTooltip(strokeInput, '윤곽선 두께');
  var strokeDropBtn = document.createElement('button');
  strokeDropBtn.className = 'bwbr-size-combo-btn';
  strokeDropBtn.type = 'button';
  strokeDropBtn.textContent = '\u25BC';
  _setTooltip(strokeDropBtn, '윤곽 두께 목록');
  var strokeDrop = document.createElement('div');
  strokeDrop.className = 'bwbr-size-combo-drop';
  [0, 1, 2, 3, 4, 5, 6, 8, 10].forEach(function(s) {
    var opt = document.createElement('div');
    opt.className = 'bwbr-size-combo-opt';
    opt.textContent = s;
    opt.addEventListener('mousedown', function(ev) {
      ev.preventDefault();
      strokeInput.value = s;
      strokeDrop.classList.remove('bwbr-size-combo-drop--open');
      _textStrokeWidth = s;
      _updateStrokePreview();
    });
    strokeDrop.appendChild(opt);
  });
  strokeDropBtn.addEventListener('click', function(ev) {
    ev.preventDefault();
    strokeDrop.classList.toggle('bwbr-size-combo-drop--open');
  });
  document.addEventListener('mousedown', function(ev) {
    if (!strokeCombo.contains(ev.target)) strokeDrop.classList.remove('bwbr-size-combo-drop--open');
  });
  strokeInput.addEventListener('change', function () {
    var v = parseInt(strokeInput.value);
    _textStrokeWidth = (v && v > 0) ? v : 0;
    strokeInput.value = _textStrokeWidth;
    _updateStrokePreview();
  });
  strokeInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); strokeInput.blur(); }
    e.stopPropagation();
  });
  strokeInput.addEventListener('focus', function() { strokeInput.select(); });
  strokeCombo.appendChild(strokeInput);
  strokeCombo.appendChild(strokeDropBtn);
  strokeCombo.appendChild(strokeDrop);
  row2.appendChild(strokeCombo);

  row2.appendChild(_makeToolbarSep());

  // 색상 버튼: 클릭 → 커스텀 컬러 팝업
  var _fgHex = '#000000', _fgTrans = false;
  var _bgHex = '#ffff00', _bgTrans = true;
  var _boxBgHex = '#ffffff', _boxBgTrans = true;

  // 색상 라이브 프리뷰 헬퍼: 처음에 선택을 span으로 wrapping하고, 이후 drag에서는 그 span의 style만 업데이트
  var _colorLiveSpan = null;
  var _colorLiveProp = null;

  function _colorOnChange(prop, color, isTrans, hex) {
    if (_colorLiveSpan && _colorLiveProp === prop) {
      // 이미 wrap된 span 재사용 — style만 변경
      _colorLiveSpan.style[prop] = color;
      return;
    }
    // 처음: 선택영역 wrap
    _restoreTextSelection();
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) {
      var span = document.createElement('span');
      span.style[prop] = color;
      span.appendChild(document.createTextNode('\u200B'));
      range.insertNode(span);
      range.setStartAfter(span);
      sel.removeAllRanges(); sel.addRange(range);
      _colorLiveSpan = span;
      _colorLiveProp = prop;
      return;
    }
    var span2 = document.createElement('span');
    span2.style[prop] = color;
    try { range.surroundContents(span2); } catch(e) {
      var frag = range.extractContents();
      span2.appendChild(frag);
      range.insertNode(span2);
    }
    sel.removeAllRanges();
    var nr = document.createRange();
    nr.selectNodeContents(span2);
    sel.addRange(nr);
    _savedTextRange = nr.cloneRange();
    _colorLiveSpan = span2;
    _colorLiveProp = prop;
  }

  // 글자 색상
  var fgWrap = document.createElement('div');
  fgWrap.className = 'bwbr-text-toolbar-color';
  _setTooltip(fgWrap, '글자 색상');
  var fgLabel = document.createElement('span');
  fgLabel.textContent = 'A';
  fgLabel.style.cssText = 'font-weight:bold;pointer-events:none;position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);font-size:14px;';
  var fgInd = document.createElement('div');
  fgInd.className = 'bwbr-color-indicator';
  fgInd.style.background = _fgHex;
  fgWrap.appendChild(fgLabel);
  fgWrap.appendChild(fgInd);
  fgWrap.addEventListener('mousedown', function(e) { e.preventDefault(); });
  fgWrap.addEventListener('click', function() {
    _colorLiveSpan = null; _colorLiveProp = null;
    _openColorPopup(fgWrap, _fgHex, _fgTrans, true, function(color, isTrans, hex) {
      _fgHex = hex; _fgTrans = isTrans;
      fgInd.style.background = isTrans ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/6px 6px' : hex;
      _colorOnChange('color', color, isTrans, hex);
    }, 'fill');
  });
  row2.appendChild(fgWrap);

  // 윤곽선 색상
  var strokeColorWrap = document.createElement('div');
  strokeColorWrap.className = 'bwbr-text-toolbar-color';
  _setTooltip(strokeColorWrap, '윤곽선 색상');
  var strokeColorLabel = document.createElement('span');
  strokeColorLabel.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><text x="4" y="18" font-size="18" font-weight="bold" fill="none" stroke="currentColor" stroke-width="2">A</text></svg>';
  strokeColorLabel.style.cssText = 'pointer-events:none;position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);display:flex;';
  var strokeInd = document.createElement('div');
  strokeInd.className = 'bwbr-color-indicator';
  strokeInd.style.background = _textStrokeColor;
  strokeColorWrap.appendChild(strokeColorLabel);
  strokeColorWrap.appendChild(strokeInd);
  strokeColorWrap.addEventListener('mousedown', function(e) { e.preventDefault(); });
  strokeColorWrap.addEventListener('click', function() {
    _openColorPopup(strokeColorWrap, _textStrokeColor, false, false, function(color, isTrans, hex) {
      _textStrokeColor = hex;
      strokeInd.style.background = hex;
      _updateStrokePreview();
    }, 'outline');
  });
  row2.appendChild(strokeColorWrap);

  // 글자 배경색
  var bgWrap = document.createElement('div');
  bgWrap.className = 'bwbr-text-toolbar-color';
  _setTooltip(bgWrap, '글자 배경색');
  var bgLabel = document.createElement('span');
  bgLabel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z"/></svg>';
  bgLabel.style.cssText = 'pointer-events:none;position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);display:flex;';
  var bgInd = document.createElement('div');
  bgInd.className = 'bwbr-color-indicator';
  bgInd.style.background = 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/6px 6px';
  bgWrap.appendChild(bgLabel);
  bgWrap.appendChild(bgInd);
  bgWrap.addEventListener('mousedown', function(e) { e.preventDefault(); });
  bgWrap.addEventListener('click', function() {
    _colorLiveSpan = null; _colorLiveProp = null;
    _openColorPopup(bgWrap, _bgHex, _bgTrans, true, function(color, isTrans, hex) {
      _bgHex = hex; _bgTrans = isTrans;
      bgInd.style.background = isTrans ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/6px 6px' : hex;
      _colorOnChange('backgroundColor', color, isTrans, hex);
    }, 'fill');
  });
  row2.appendChild(bgWrap);

  // 박스 배경색
  var boxBgWrap = document.createElement('div');
  boxBgWrap.className = 'bwbr-text-toolbar-color';
  _setTooltip(boxBgWrap, '박스 배경색');
  var boxBgLabel = document.createElement('span');
  boxBgLabel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>';
  boxBgLabel.style.cssText = 'pointer-events:none;position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);display:flex;';
  var boxBgInd = document.createElement('div');
  boxBgInd.className = 'bwbr-color-indicator';
  boxBgInd.style.background = 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/6px 6px';
  boxBgWrap.appendChild(boxBgLabel);
  boxBgWrap.appendChild(boxBgInd);
  boxBgWrap.addEventListener('mousedown', function(e) { e.preventDefault(); });
  boxBgWrap.addEventListener('click', function() {
    _openColorPopup(boxBgWrap, _boxBgHex, _boxBgTrans, true, function(color, isTrans, hex) {
      _boxBgHex = hex; _boxBgTrans = isTrans;
      boxBgInd.style.background = isTrans ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/6px 6px' : hex;
      _textBgColor = isTrans ? '' : hex;
      if (_textEditorWrap) _textEditorWrap.style.background = isTrans ? 'transparent' : hex;
    }, 'fill');
  });
  row2.appendChild(boxBgWrap);

  row2.appendChild(_makeToolbarSep());

  // 확인
  var btnOk = document.createElement('button');
  btnOk.className = 'bwbr-text-toolbar-btn bwbr-text-toolbar-confirm';
  btnOk.textContent = '\u2713';
  _setTooltip(btnOk, '확인');
  btnOk.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btnOk.addEventListener('click', function () { finishTextEditing(true); });
  row2.appendChild(btnOk);

  // 취소
  var btnX = document.createElement('button');
  btnX.className = 'bwbr-text-toolbar-btn bwbr-text-toolbar-cancel';
  btnX.textContent = '\u2715';
  _setTooltip(btnX, '취소 (Esc)');
  btnX.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btnX.addEventListener('click', function () { finishTextEditing(false); });
  row2.appendChild(btnX);

  bar.appendChild(row2);

  return bar;
}

function _makeToolbarBtn(label, cmd, tipText) {
  var btn = document.createElement('button');
  btn.className = 'bwbr-text-toolbar-btn';
  btn.textContent = label;
  if (tipText) _setTooltip(btn, tipText);
  btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btn.addEventListener('click', function () {
    document.execCommand(cmd);
    _textEditor.focus();
  });
  return btn;
}

function _makeToolbarSep() {
  var s = document.createElement('div');
  s.className = 'bwbr-text-toolbar-sep';
  return s;
}

/* ── 커스텀 컬러 팝업 (SV + Hue + 투명 체크) ── */
var _colorPopupEl = null;
var _colorPopupClose = null;

function _hsvToRgb(h, s, v) {
  var i = Math.floor(h * 6), f = h * 6 - i;
  var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  var r, g, b;
  switch (i % 6) {
    case 0: r=v;g=t;b=p; break; case 1: r=q;g=v;b=p; break;
    case 2: r=p;g=v;b=t; break; case 3: r=p;g=q;b=v; break;
    case 4: r=t;g=p;b=v; break; case 5: r=v;g=p;b=q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function _rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  var h = 0, s = mx ? d / mx : 0, v = mx;
  if (d) {
    switch (mx) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h, s, v];
}
function _hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  if (hex.length !== 6) return [0, 0, 0];
  return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
}
function _rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function _clamp01(x) { return Math.max(0, Math.min(1, x)); }

// ── EyeDropper (MAIN world 경유) ────────────────────────────
// ISOLATED world에서는 EyeDropper API 접근 불가 → script 태그로 MAIN world에서 실행
function _pickColorFromScreen(cb) {
  var evtName = '__ce_eyedrop_' + Date.now();
  function onResult() {
    document.removeEventListener(evtName, onResult);
    var hex = document.documentElement.getAttribute('data-ce-eyedrop');
    document.documentElement.removeAttribute('data-ce-eyedrop');
    cb(hex || null);
  }
  document.addEventListener(evtName, onResult);
  var s = document.createElement('script');
  s.textContent = '(' + function(evName) {
    if (typeof EyeDropper === 'undefined') {
      document.documentElement.setAttribute('data-ce-eyedrop', '');
      document.dispatchEvent(new CustomEvent(evName));
      return;
    }
    new EyeDropper().open().then(function(r) {
      document.documentElement.setAttribute('data-ce-eyedrop', r.sRGBHex);
      document.dispatchEvent(new CustomEvent(evName));
    }).catch(function() {
      document.documentElement.setAttribute('data-ce-eyedrop', '');
      document.dispatchEvent(new CustomEvent(evName));
    });
  }.toString() + ')(' + JSON.stringify(evtName) + ');';
  (document.head || document.documentElement).appendChild(s);
  s.remove();
}

function _closeColorPopup() {
  if (_colorPopupEl) {
    // 팝업 닫힐 때 마지막 선택 색상을 히스토리에 추가
    if (_colorPopupEl._lastHex && !_colorPopupEl._isTrans) {
      var key = _colorPopupEl._histKey || 'fill';
      var arr = _colorHistories[key] || (_colorHistories[key] = []);
      var hex = _colorPopupEl._lastHex.toLowerCase();
      var idx = arr.indexOf(hex);
      if (idx !== -1) arr.splice(idx, 1);
      arr.unshift(hex);
      if (arr.length > 8) arr.pop();
    }
    if (_colorPopupEl.parentNode) _colorPopupEl.parentNode.removeChild(_colorPopupEl);
  }
  _colorPopupEl = null;
  if (_colorPopupClose) { document.removeEventListener('mousedown', _colorPopupClose, true); _colorPopupClose = null; }
}

function _openColorPopup(anchorEl, currentHex, isTransparent, allowTransparent, onChange, historyKey) {
  _closeColorPopup();
  var PW = 160, SV_H = 100, HUE_H = 12;
  var _histKey = historyKey || 'fill';
  var _histArr = _colorHistories[_histKey] || (_colorHistories[_histKey] = []);

  // 현재 색상 파싱
  var rgb = _hexToRgb(currentHex || '#000000');
  var hsv = _rgbToHsv(rgb[0], rgb[1], rgb[2]);
  var ch = hsv[0], cs = hsv[1], cv = hsv[2];
  var trans = !!isTransparent;

  var popup = document.createElement('div');
  popup.className = 'bwbr-color-popup';
  popup.addEventListener('contextmenu', function(ev) { ev.preventDefault(); });
  // 팝업 내 모든 클릭에서 에디터 포커스 유지 (선택 보존)
  popup.addEventListener('mousedown', function(ev) {
    if (ev.target.tagName === 'INPUT') return; // hex input은 포커스 허용
    ev.preventDefault();
  });
  popup.addEventListener('pointerdown', function(ev) {
    if (ev.target.tagName === 'INPUT') return;
    ev.preventDefault();
  });

  // SV canvas
  var svC = document.createElement('canvas');
  svC.width = PW * 2; svC.height = SV_H * 2;
  svC.style.cssText = 'width:' + PW + 'px;height:' + SV_H + 'px;cursor:crosshair;border-radius:4px;';
  popup.appendChild(svC);

  // Hue canvas
  var hueC = document.createElement('canvas');
  hueC.width = PW * 2; hueC.height = HUE_H * 2;
  hueC.style.cssText = 'width:' + PW + 'px;height:' + HUE_H + 'px;cursor:pointer;border-radius:3px;';
  hueC.className = 'bwbr-color-popup-hue';
  popup.appendChild(hueC);

  var svCtx = svC.getContext('2d');
  var hueCtx = hueC.getContext('2d');
  svCtx.scale(2, 2);
  hueCtx.scale(2, 2);

  // 하단 행: 스포이드 / 미리보기 / hex / 체크박스 투명
  var row = document.createElement('div');
  row.className = 'bwbr-color-popup-row';

  // 스포이드 버튼 (EyeDropper API — MAIN world 경유)
  var eyeBtn = document.createElement('button');
  eyeBtn.className = 'bwbr-color-popup-eyedropper';
  eyeBtn.title = '스포이드';
  eyeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.71 5.63l-2.34-2.34a1 1 0 00-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12a1 1 0 000-1.42zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z"/></svg>';
  eyeBtn.style.cssText = 'background:rgba(0,0,0,0.05);border:1px solid rgba(0,0,0,0.2);border-radius:4px;color:#555;cursor:pointer;padding:2px 4px;display:flex;align-items:center;justify-content:center;';
  eyeBtn.addEventListener('mouseenter', function() { eyeBtn.style.background = 'rgba(0,0,0,0.1)'; });
  eyeBtn.addEventListener('mouseleave', function() { eyeBtn.style.background = 'rgba(0,0,0,0.05)'; });
  eyeBtn.addEventListener('click', function() {
    _pickColorFromScreen(function(hex) {
      if (!hex) return;
      var rgb2 = _hexToRgb(hex);
      var hsv2 = _rgbToHsv(rgb2[0], rgb2[1], rgb2[2]);
      ch = hsv2[0]; cs = hsv2[1]; cv = hsv2[2];
      if (trans && transCheck) { trans = false; transCheck.checked = false; }
      redraw(); commit();
    });
  });
  row.appendChild(eyeBtn);

  var preview = document.createElement('div');
  preview.className = 'bwbr-color-popup-preview';
  row.appendChild(preview);
  var hexIn = document.createElement('input');
  hexIn.className = 'bwbr-color-popup-hex';
  hexIn.value = currentHex || '#000000';
  row.appendChild(hexIn);

  var transLabel = null;
  var transCheck = null;
  if (allowTransparent) {
    transLabel = document.createElement('label');
    transLabel.className = 'bwbr-color-popup-trans';
    transCheck = document.createElement('input');
    transCheck.type = 'checkbox';
    transCheck.checked = trans;
    transLabel.appendChild(transCheck);
    transLabel.appendChild(document.createTextNode('투명'));
    row.appendChild(transLabel);
  }

  popup.appendChild(row);

  // ── 색상 히스토리 (팝업 하단) ──
  var histRow = document.createElement('div');
  histRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;padding-top:4px;margin-top:2px;';
  function _rebuildHistRow() {
    histRow.innerHTML = '';
    _histArr.forEach(function(hx) {
      var hBtn = document.createElement('button');
      hBtn.style.cssText = 'width:16px;height:16px;border-radius:50%;border:1.5px solid rgba(0,0,0,0.15);cursor:pointer;padding:0;background:' + hx + ';transition:border-color 0.15s,transform 0.15s;';
      hBtn.addEventListener('mouseenter', function() { hBtn.style.borderColor = '#666'; hBtn.style.transform = 'scale(1.15)'; });
      hBtn.addEventListener('mouseleave', function() { hBtn.style.borderColor = 'rgba(0,0,0,0.15)'; hBtn.style.transform = ''; });
      hBtn.addEventListener('click', function() {
        var rgb2 = _hexToRgb(hx);
        var hsv2 = _rgbToHsv(rgb2[0], rgb2[1], rgb2[2]);
        ch = hsv2[0]; cs = hsv2[1]; cv = hsv2[2];
        if (trans && transCheck) { trans = false; transCheck.checked = false; }
        redraw(); commit();
      });
      histRow.appendChild(hBtn);
    });
  }
  _rebuildHistRow();
  popup.appendChild(histRow);
  popup._histKey = _histKey;
  popup._histArr = _histArr;
  popup._rebuildHistRow = _rebuildHistRow;

  // 그리기
  function drawSV() {
    var c = _hsvToRgb(ch, 1, 1);
    svCtx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    svCtx.fillRect(0, 0, PW, SV_H);
    var wg = svCtx.createLinearGradient(0, 0, PW, 0);
    wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    svCtx.fillStyle = wg; svCtx.fillRect(0, 0, PW, SV_H);
    var bg = svCtx.createLinearGradient(0, 0, 0, SV_H);
    bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, '#000');
    svCtx.fillStyle = bg; svCtx.fillRect(0, 0, PW, SV_H);
    var cx = cs * PW, cy = (1 - cv) * SV_H;
    svCtx.beginPath(); svCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    svCtx.strokeStyle = (cv > 0.5 && cs < 0.5) ? '#000' : '#fff';
    svCtx.lineWidth = 1.5; svCtx.stroke();
  }
  function drawHue() {
    var grad = hueCtx.createLinearGradient(0, 0, PW, 0);
    for (var i = 0; i <= 6; i++) {
      var c = _hsvToRgb(i / 6, 1, 1);
      grad.addColorStop(Math.min(i / 6, 1), 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')');
    }
    hueCtx.fillStyle = grad; hueCtx.fillRect(0, 0, PW, HUE_H);
    var ix = ch * PW;
    hueCtx.fillStyle = '#fff'; hueCtx.fillRect(ix - 3, -1, 6, HUE_H + 2);
    hueCtx.strokeStyle = 'rgba(0,0,0,0.4)'; hueCtx.lineWidth = 1;
    hueCtx.strokeRect(ix - 3, -1, 6, HUE_H + 2);
  }
  function updatePreview() {
    var c = _hsvToRgb(ch, cs, cv);
    var hex = _rgbToHex(c[0], c[1], c[2]);
    hexIn.value = hex;
    if (trans) {
      preview.style.background = 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/8px 8px';
    } else {
      preview.style.background = hex;
    }
  }
  function commit() {
    var c = _hsvToRgb(ch, cs, cv);
    var hex = _rgbToHex(c[0], c[1], c[2]);
    popup._lastHex = hex;
    popup._isTrans = trans;
    onChange(trans ? 'transparent' : hex, trans, hex);
  }
  function redraw() { drawSV(); drawHue(); updatePreview(); }

  // 드래그 헬퍼
  function addDrag(canvas, onMove) {
    var dragging = false;
    function pick(e) {
      var r = canvas.getBoundingClientRect();
      onMove((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }
    canvas.addEventListener('pointerdown', function(e) {
      dragging = true; canvas.setPointerCapture(e.pointerId); pick(e);
    });
    canvas.addEventListener('pointermove', function(e) { if (dragging) pick(e); });
    canvas.addEventListener('pointerup', function() { dragging = false; });
    canvas.addEventListener('lostpointercapture', function() { dragging = false; });
  }

  addDrag(svC, function(xr, yr) {
    cs = _clamp01(xr); cv = 1 - _clamp01(yr);
    if (trans && transCheck) { trans = false; transCheck.checked = false; }
    redraw(); commit();
  });
  addDrag(hueC, function(xr) {
    ch = _clamp01(xr) * 0.9999;
    if (trans && transCheck) { trans = false; transCheck.checked = false; }
    redraw(); commit();
  });

  if (transCheck) {
    transCheck.addEventListener('change', function() {
      trans = transCheck.checked;
      redraw(); commit();
    });
  }

  hexIn.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      var val = hexIn.value.trim();
      if (!/^#/.test(val)) val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
        var rgb2 = _hexToRgb(val);
        var hsv2 = _rgbToHsv(rgb2[0], rgb2[1], rgb2[2]);
        ch = hsv2[0]; cs = hsv2[1]; cv = hsv2[2];
        if (trans && transCheck) { trans = false; transCheck.checked = false; }
        redraw(); commit();
      }
    }
  });
  hexIn.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    // hex input 클릭 시 에디터 블러 허용 (입력을 위해 포커스 필요)
    // 하지만 _savedTextRange는 blur 핸들러에서 이미 저장됨
  });

  // 팝업 위치
  document.body.appendChild(popup);
  _colorPopupEl = popup;
  var ar = anchorEl.getBoundingClientRect();
  var ph = popup.offsetHeight;
  var py = ar.bottom + 4;
  if (py + ph > window.innerHeight - 8) py = ar.top - ph - 4;
  if (py < 4) py = 4;
  var px = ar.left;
  if (px + popup.offsetWidth > window.innerWidth - 8) px = window.innerWidth - popup.offsetWidth - 8;
  popup.style.left = px + 'px';
  popup.style.top = py + 'px';

  redraw();

  // 외부 클릭 닫기
  _colorPopupClose = function(e) {
    if (!popup.contains(e.target) && !anchorEl.contains(e.target)) {
      _closeColorPopup();
    }
  };
  setTimeout(function() {
    document.addEventListener('mousedown', _colorPopupClose, true);
  }, 0);
}

function _enforceMinHeight() {
  if (!_textEditorWrap || !_textEditor) return;
  var maxFs = parseFloat(window.getComputedStyle(_textEditor).fontSize) || 16;
  _textEditor.querySelectorAll('[style*="font-size"]').forEach(function(el) {
    var fs = parseFloat(el.style.fontSize);
    if (fs > maxFs) maxFs = fs;
  });
  var needed = Math.ceil(maxFs * 1.6) + 16;
  _textEditorWrap.style.minHeight = Math.max(needed, parseInt(_textEditorWrap.style.minHeight) || 0) + 'px';
}

function _applyFontSize(px) {
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  var range = sel.getRangeAt(0);
  if (range.collapsed) {
    var span = document.createElement('span');
    span.style.fontSize = px + 'px';
    span.appendChild(document.createTextNode('\u200B'));
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    _enforceMinHeight();
    return;
  }
  var frag = range.extractContents();
  // 자식 노드의 기존 fontSize 제거 (축소가 적용되도록)
  _stripFontSize(frag);
  var span2 = document.createElement('span');
  span2.style.fontSize = px + 'px';
  span2.appendChild(frag);
  range.insertNode(span2);
  sel.removeAllRanges();
  var nr = document.createRange();
  nr.selectNodeContents(span2);
  sel.addRange(nr);
  _enforceMinHeight();
}

function _stripFontSize(node) {
  if (node.nodeType === 1) {
    if (node.style && node.style.fontSize) node.style.fontSize = '';
    for (var i = 0; i < node.childNodes.length; i++) _stripFontSize(node.childNodes[i]);
  }
}

function positionTextToolbar() {
  // 이제 _startToolbarPosTracker()로 rAF 기반 추적 (패닝/줌 추종)
}

function _onTextClickOutside(e) {
  if (!_textEditor) return;
  if (e.button !== 0) return; // 좌클릭만 외부 클릭으로 인식
  if (_textEditorWrap && _textEditorWrap.contains(e.target)) return;
  if (_textToolbar && _textToolbar.contains(e.target)) return;
  if (_colorPopupEl && _colorPopupEl.contains(e.target)) return;
  finishTextEditing(true);
}

function finishTextEditing(confirm) {
  document.removeEventListener('mousedown', _onTextClickOutside, true);

  if (confirm && _textEditor && _textEditor.textContent.trim() && _textMapCoords) {
    var mapCoords = _textMapCoords;

    // 에디터 높이: 드래그로 지정한 원래 높이를 유지, 텍스트가 넘치면 확장
    var contentH = _textEditor.scrollHeight;
    mapCoords.height = Math.max(mapCoords.height, Math.ceil(contentH / CELL_PX));

    // 폰트 로드 완료 대기 후 캔버스 렌더링
    // async 전에 필요한 값을 캡처
    var _capturedEditor = _textEditor;
    var _capturedBgColor = _textBgColor;
    var _capturedAlign = _textAlign;
    var _capturedVAlign = _textVAlign;
    var _capturedFont = _textFontFamily;
    var _capturedStrokeColor = _textStrokeColor;
    var _capturedStrokeWidth = _textStrokeWidth;
    var _capturedHtml = _textEditor ? _textEditor.innerHTML : '';
    var _capturedReopened = _reopenedObj;

    // @font-face 등록 + 폰트 프리로드
    _ensureFontFace(_capturedFont);
    var fontLoadPromise;
    try {
      var baseName = _capturedFont.replace(/["']/g, '').split(',')[0].trim();
      fontLoadPromise = document.fonts.load('16px "' + baseName + '"').catch(function() {});
    } catch (e) {
      fontLoadPromise = Promise.resolve();
    }

    fontLoadPromise.then(function() {
      return document.fonts.ready;
    }).then(function() {
      var dataUrl = renderTextEditorToCanvas();
      if (dataUrl) {
        readSettingsFromDOM();
        var obj = {
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          mapCoords: mapCoords,
          angle: 0,
          imageDataUrl: dataUrl,
          textHtml: _capturedHtml,
          textBgColor: _capturedBgColor,
          textAlign: _capturedAlign,
          textVAlign: _capturedVAlign,
          textFontFamily: _capturedFont,
          textStrokeColor: _capturedStrokeColor,
          textStrokeWidth: _capturedStrokeWidth,
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
        pushUndo({ type: 'stage', ids: [obj.id] });
        updateConfirmBar();
      }
      _reopenedObj = null;
      cleanupTextEditor();
    });
  } else {
    // 취소: 재편집 중이면 원본 복원
    if (_reopenedObj) {
      _state.stagedObjects.push(_reopenedObj);
      renderStagedItem(_reopenedObj);
      updateConfirmBar();
      _reopenedObj = null;
    }
    cleanupTextEditor();
  }
}

function cleanupTextEditor() {
  _closeColorPopup();
  _stopToolbarPosTracker();
  if (_textEditorWrap) { _textEditorWrap.remove(); _textEditorWrap = null; }
  _textEditor = null;
  if (_textToolbar) { _textToolbar.remove(); _textToolbar = null; }
  _textMapCoords = null;
  _textBgColor = '';
  _textAlign = 'left';
  _textVAlign = 'top';
  _textFontFamily = 'sans-serif';
  _textStrokeColor = '#000000';
  _textStrokeWidth = 0;
  _savedTextRange = null;
  _state.textEditing = false;
  // 오버레이 복원
  if (_overlay) _overlay.style.pointerEvents = '';
}

var _registeredFontFaces = {};

function _ensureFontFace(family) {
  // CSS font-family 값에서 1차 폰트 이름을 추출하여 @font-face local() 등록
  // Canvas API가 시스템 설치 폰트를 인식하도록 보장
  var name = family.replace(/["']/g, '').split(',')[0].trim();
  if (!name || name === 'sans-serif' || name === 'serif' || name === 'monospace' || name === 'cursive') return;
  if (_registeredFontFaces[name]) return;
  _registeredFontFaces[name] = true;
  var style = document.createElement('style');
  style.textContent = '@font-face { font-family: "' + name + '"; src: local("' + name + '"); font-weight: 100 900; }';
  document.head.appendChild(style);
}

function renderTextEditorToCanvas() {
  if (!_textEditor || !_textMapCoords) return null;

  var PAD = 8;
  // 타일 단위 치수와 정확히 일치하는 캔버스 크기 사용 (패널과 1:1 매칭)
  var w = _textMapCoords.width * CELL_PX;
  var h = _textMapCoords.height * CELL_PX;
  if (w < 1 || h < 1) return null;

  var scaleF = 2;
  var canvas = document.createElement('canvas');
  canvas.width = w * scaleF;
  canvas.height = h * scaleF;
  var ctx = canvas.getContext('2d');
  ctx.scale(scaleF, scaleF);

  if (_textBgColor) {
    ctx.fillStyle = _textBgColor;
    ctx.fillRect(0, 0, w, h);
  }

  var edCS = getComputedStyle(_textEditor);
  var defaultFS = parseInt(edCS.fontSize) || 16;
  var defaultColor = edCS.color || '#fff';
  var defaultFamily = _textFontFamily || 'sans-serif';

  // Canvas가 폰트를 인식하도록 @font-face local() 등록
  _ensureFontFace(defaultFamily);

  var runs = [];
  _extractRuns(_textEditor, {
    fontSize: defaultFS, fontWeight: 'normal', fontStyle: 'normal',
    fontFamily: defaultFamily,
    color: defaultColor, bgColor: '', underline: false, strikethrough: false
  }, runs);

  var maxW = w - PAD * 2;
  var baseLH = 1.5;

  // ── 1차 패스: 시각적 라인 구축 ──
  var lines = [{ chars: [], height: defaultFS * baseLH }];
  var xPos = 0;

  for (var ri = 0; ri < runs.length; ri++) {
    var run = runs[ri];

    if (run.newline) {
      lines.push({ chars: [], height: (run.fontSize || defaultFS) * baseLH });
      xPos = 0;
      continue;
    }

    var fs = run.fontSize || defaultFS;
    var lh = fs * baseLH;
    var runFamily = run.fontFamily || defaultFamily;
    var fontStr = (run.fontStyle === 'italic' ? 'italic ' : '') +
                  (run.fontWeight === 'bold' ? 'bold ' : '') +
                  fs + 'px ' + runFamily;
    ctx.font = fontStr;

    var curLine = lines[lines.length - 1];
    if (lh > curLine.height) curLine.height = lh;

    var text = run.text;
    for (var ci = 0; ci < text.length; ci++) {
      var ch = text[ci];
      var cw = ctx.measureText(ch).width;

      if (xPos + cw > maxW && xPos > 0) {
        lines.push({ chars: [], height: lh });
        xPos = 0;
      }

      curLine = lines[lines.length - 1];
      if (lh > curLine.height) curLine.height = lh;
      curLine.chars.push({ ch: ch, cw: cw, run: run, fs: fs, fontStr: fontStr, lh: lh });
      xPos += cw;
    }
  }

  // ── 2차: 전체 높이 계산 + 수직 정렬 오프셋 ──
  var totalH = 0;
  for (var li = 0; li < lines.length; li++) totalH += lines[li].height;

  var yStart = PAD;
  if (_textVAlign === 'middle') {
    yStart = Math.max(PAD, (h - totalH) / 2);
  } else if (_textVAlign === 'bottom') {
    yStart = Math.max(PAD, h - totalH - PAD);
  }

  // ── 3차: 렌더 ──
  var y = yStart;
  for (var li2 = 0; li2 < lines.length; li2++) {
    var line = lines[li2];
    var lineH = line.height;

    var lineW = 0;
    for (var ci2 = 0; ci2 < line.chars.length; ci2++) lineW += line.chars[ci2].cw;

    var x = PAD;
    if (_textAlign === 'center') {
      x = (w - lineW) / 2;
    } else if (_textAlign === 'right') {
      x = w - PAD - lineW;
    }

    for (var ci3 = 0; ci3 < line.chars.length; ci3++) {
      var c = line.chars[ci3];

      if (c.run.bgColor) {
        ctx.fillStyle = c.run.bgColor;
        ctx.fillRect(x, y, c.cw, lineH);
      }

      ctx.fillStyle = c.run.color || defaultColor;
      ctx.font = c.fontStr;
      ctx.textBaseline = 'top';
      var charY = y + (lineH - c.fs) / 2;
      // 윤곽선 (stroke) 렌더: fill 뒤에 그려서 fill 위에 겹침 방지 → stroke 먼저
      if (_textStrokeWidth > 0) {
        ctx.strokeStyle = _textStrokeColor;
        ctx.lineWidth = _textStrokeWidth * 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(c.ch, x, charY);
      }
      ctx.fillText(c.ch, x, charY);

      if (c.run.underline) {
        ctx.strokeStyle = c.run.color || defaultColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + lineH - 2);
        ctx.lineTo(x + c.cw, y + lineH - 2);
        ctx.stroke();
      }

      if (c.run.strikethrough) {
        ctx.strokeStyle = c.run.color || defaultColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + lineH / 2);
        ctx.lineTo(x + c.cw, y + lineH / 2);
        ctx.stroke();
      }

      x += c.cw;
    }

    y += lineH;
  }

  try {
    return canvas.toDataURL('image/webp', 0.9);
  } catch (ex) {
    return canvas.toDataURL('image/png');
  }
}

// 스테이지된 텍스트 블록을 새 크기로 캔버스 리렌더
function _reRenderTextBlock(obj) {
  if (!obj || !obj.textHtml) return;
  // 임시 편집기 DOM 생성
  var tmp = document.createElement('div');
  tmp.contentEditable = 'true';
  tmp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;white-space:pre-wrap;word-break:break-all;font-size:16px;color:#fff;font-family:' + (obj.textFontFamily || 'sans-serif') + ';';
  tmp.innerHTML = obj.textHtml;
  document.body.appendChild(tmp);
  // 전역 변수 백업 → 임시 설정
  var prevEditor = _textEditor, prevCoords = _textMapCoords;
  var prevBg = _textBgColor, prevAlign = _textAlign, prevVAlign = _textVAlign, prevFont = _textFontFamily;
  _textEditor = tmp;
  _textMapCoords = obj.mapCoords;
  _textBgColor = obj.textBgColor || '';
  _textAlign = obj.textAlign || 'left';
  _textVAlign = obj.textVAlign || 'top';
  _textFontFamily = obj.textFontFamily || 'sans-serif';
  _textStrokeColor = obj.textStrokeColor || '#000000';
  _textStrokeWidth = obj.textStrokeWidth || 0;
  _ensureFontFace(_textFontFamily);
  var dataUrl = renderTextEditorToCanvas();
  // 전역 변수 복원
  _textEditor = prevEditor; _textMapCoords = prevCoords;
  _textBgColor = prevBg; _textAlign = prevAlign; _textVAlign = prevVAlign; _textFontFamily = prevFont;
  tmp.remove();
  if (dataUrl) {
    obj.imageDataUrl = dataUrl;
    var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
    if (el) {
      var img = el.querySelector('img');
      if (img) img.src = dataUrl;
    }
  }
}

function _extractRuns(node, style, runs) {
  if (node.nodeType === 3) {
    var txt = node.textContent;
    if (txt) runs.push({ text: txt, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle, fontFamily: style.fontFamily, color: style.color, bgColor: style.bgColor, underline: style.underline, strikethrough: style.strikethrough });
    return;
  }
  if (node.nodeType !== 1) return;

  var tag = node.tagName.toLowerCase();

  // 블록 요소 = 줄바꿈
  if ((tag === 'div' || tag === 'p') && runs.length > 0 && !runs[runs.length - 1].newline) {
    runs.push({ newline: true, fontSize: style.fontSize });
  }
  if (tag === 'br') {
    runs.push({ newline: true, fontSize: style.fontSize });
    return;
  }

  var s = Object.assign({}, style);
  if (tag === 'b' || tag === 'strong') s.fontWeight = 'bold';
  if (tag === 'i' || tag === 'em') s.fontStyle = 'italic';
  if (tag === 'u') s.underline = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') s.strikethrough = true;

  var ns = node.style;
  if (ns) {
    if (ns.color) s.color = ns.color;
    if (ns.backgroundColor) s.bgColor = ns.backgroundColor;
    if (ns.fontSize) s.fontSize = parseInt(ns.fontSize) || s.fontSize;
    if (ns.fontWeight === 'bold' || parseInt(ns.fontWeight) >= 700) s.fontWeight = 'bold';
    if (ns.fontStyle === 'italic') s.fontStyle = 'italic';
    if (ns.textDecoration && ns.textDecoration.indexOf('underline') >= 0) s.underline = true;
    if (ns.textDecoration && ns.textDecoration.indexOf('line-through') >= 0) s.strikethrough = true;
    if (ns.fontFamily) s.fontFamily = ns.fontFamily;
  }

  // <font color="..."> (execCommand foreColor 결과)
  if (tag === 'font' && node.getAttribute('color')) s.color = node.getAttribute('color');

  for (var i = 0; i < node.childNodes.length; i++) {
    _extractRuns(node.childNodes[i], s, runs);
  }
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

  _overlay.addEventListener('pointerdown', onOverlayMouseDown);
  _overlay.addEventListener('pointermove', onOverlayMouseMove);
  _overlay.addEventListener('pointerup', onOverlayMouseUp);

  // 휠 줌 패스스루: 오버레이 아래 요소에 전달 + 줌 캐시 갱신
  _overlay.addEventListener('wheel', function(e) {
    _overlay.style.pointerEvents = 'none';
    var below = document.elementFromPoint(e.clientX, e.clientY);
    _overlay.style.pointerEvents = '';
    if (below) {
      below.dispatchEvent(new WheelEvent(e.type, e));
    }
    // ccfolia가 transform을 업데이트한 뒤 캐시 갱신 + 스탬프 미리보기 동기화
    _invalidateZoomCache();
    requestAnimationFrame(function() {
      _invalidateZoomCache();
      _updateStampPreview(e.clientX, e.clientY);
    });
  }, { passive: true });
}


// ── 오버레이 마우스 이벤트 ──────────────────────────────────────

function onOverlayMouseDown(e) {
  if (e.button !== 0) return;

  // 텍스트 편집 중이면 오버레이 클릭 = 편집 완료
  if (_state.textEditing) {
    finishTextEditing(true);
    return;
  }

  // Alt+드래그 → 스테이징 아이템 범위 선택 (오버레이 위에서도 동작)
  if (e.altKey) {
    _altBoxSelect.active = true;
    _altBoxSelect.startX = e.clientX;
    _altBoxSelect.startY = e.clientY;
    _altBoxSelect.additive = true;
    var rect = document.createElement('div');
    rect.className = 'bwbr-place-select-rect';
    rect.style.left = e.clientX + 'px';
    rect.style.top = e.clientY + 'px';
    rect.style.width = '0';
    rect.style.height = '0';
    document.body.appendChild(rect);
    _altBoxSelect.rectEl = rect;
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

  // 텍스트 도구: 항상 드래그 가능 (영역 지정)
  if (_state.currentTool === 'text') {
    _state.placing = true;
    updatePreview();
    _preview.classList.add('bwbr-placement-preview--visible', 'bwbr-placement-preview--text');
    _preview.innerHTML = '';
    return;
  }

  // 그리기 도구: 캔버스에 직접 그리기
  if (_state.currentTool === 'draw') {
    _overlay.setPointerCapture(e.pointerId);
    onDrawMouseDown(e);
    return;
  }

  // 도형 도구: 이미지 도구와 동일한 드래그/스탬프 배치
  if (_state.currentTool === 'shape') {
    _state.placing = true;
    _preview.innerHTML = '';  // 스탬프 미리보기 이미지 제거
    updatePreview();
    _preview.classList.add('bwbr-placement-preview--visible');
    return;
  }

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
  // 그리기 도구: 드래그 중 실시간 렌더
  if (_isDrawing && _state.currentTool === 'draw') {
    onDrawMouseMove(e);
    return;
  }
  if (_state.placing) {
    _state.drag.currentX = e.clientX;
    _state.drag.currentY = e.clientY;

    // Shift: 정사각형 제약 (이미지/도형 배치 드래그)
    if (e.shiftKey && (_state.currentTool === 'image' || _state.currentTool === 'shape')) {
      var dw = Math.abs(_state.drag.currentX - _state.drag.startX);
      var dh = Math.abs(_state.drag.currentY - _state.drag.startY);
      var side = Math.max(dw, dh);
      _state.drag.currentX = _state.drag.startX + (_state.drag.currentX >= _state.drag.startX ? side : -side);
      _state.drag.currentY = _state.drag.startY + (_state.drag.currentY >= _state.drag.startY ? side : -side);
    }

    updatePreview();
    return;
  }
  // 스탬프 미리보기: 드래그 중이 아닐 때 이전 크기로 커서 위치에 표시 (이미지/도형)
  _updateStampPreview(e.clientX, e.clientY);
}

// 스탬프 미리보기 크기/위치 업데이트 (줌 변경 시에도 호출)
var _lastStampMouse = { x: 0, y: 0 };
function _updateStampPreview(cx, cy) {
  if (cx != null) { _lastStampMouse.x = cx; _lastStampMouse.y = cy; }
  else { cx = _lastStampMouse.x; cy = _lastStampMouse.y; }
  if (_state.mode !== 'edit' || _state.placing) return;
  var isImageStamp = _state.lastStampSize && _state.currentTool === 'image' && _state.pendingImage;
  var isShapeStamp = _shapeLastStampSize && _state.currentTool === 'shape' && _shapePendingDataUrl;
  if (!isImageStamp && !isShapeStamp) return;
  var stampTiles = isImageStamp ? _state.lastStampSize : _shapeLastStampSize;
  var zoom = getZoomScale();
  var sw = stampTiles.tw * CELL_PX * zoom;
  var sh = stampTiles.th * CELL_PX * zoom;
  var imgSrc = isImageStamp ? _state.pendingImage.dataUrl : _shapePendingDataUrl;
  _preview.style.left = (cx - sw / 2) + 'px';
  _preview.style.top = (cy - sh / 2) + 'px';
  _preview.style.width = sw + 'px';
  _preview.style.height = sh + 'px';
  _preview.style.transform = '';
  if (!_preview.classList.contains('bwbr-placement-preview--visible')) {
    _preview.classList.add('bwbr-placement-preview--visible');
    _preview.innerHTML = '<img src="' + imgSrc + '" alt="">';
  }
}

function onOverlayMouseUp(e) {
  // Alt 범위 선택 완료
  if (_altBoxSelect.active) {
    finishAltBoxSelect();
    return;
  }
  // 그리기 도구: 스트로크 완료
  if (_isDrawing && _state.currentTool === 'draw') {
    onDrawMouseUp(e);
    return;
  }
  if (!_state.placing) return;
  _state.placing = false;
  _preview.classList.remove('bwbr-placement-preview--visible', 'bwbr-placement-preview--text');
  _preview.innerHTML = '';

  var rect = getPreviewRect();

  // 텍스트 도구: 드래그 완료 → contentEditable 편집기 생성
  if (_state.currentTool === 'text') {
    if (rect.w < 30 || rect.h < 20) return; // 너무 작음
    startTextEditing(rect);
    return;
  }

  if (rect.w < 5 && rect.h < 5) {
    // 클릭(드래그 없음) → 스탬프 모드: 타일 단위 크기를 현재 줌으로 화면 px 변환
    var zoom = getZoomScale();
    if (_state.currentTool === 'image' && _state.lastStampSize && _state.pendingImage) {
      var sw = _state.lastStampSize.tw * CELL_PX * zoom;
      var sh = _state.lastStampSize.th * CELL_PX * zoom;
      var stampRect = {
        x: _state.drag.startX - sw / 2,
        y: _state.drag.startY - sh / 2,
        w: sw,
        h: sh
      };
      deselectStaged();
      stageObject(stampRect);
      _preview.classList.add('bwbr-placement-preview--visible');
      if (!_preview.querySelector('img')) {
        _preview.innerHTML = '<img src="' + _state.pendingImage.dataUrl + '" alt="">';
      }
    } else if (_state.currentTool === 'shape' && _shapeLastStampSize) {
      var sw = _shapeLastStampSize.tw * CELL_PX * zoom;
      var sh = _shapeLastStampSize.th * CELL_PX * zoom;
      var stampRect = {
        x: _state.drag.startX - sw / 2,
        y: _state.drag.startY - sh / 2,
        w: sw,
        h: sh
      };
      deselectStaged();
      _stageShapeObject(stampRect);
      _preview.classList.add('bwbr-placement-preview--visible');
      if (_shapePendingDataUrl && !_preview.querySelector('img')) {
        _preview.innerHTML = '<img src="' + _shapePendingDataUrl + '" alt="">';
      }
    }
    return;
  }

  // 드래그 배치 — 스탬프 크기를 타일 단위로 저장
  var mapCoords = screenToMapCoords(rect);
  if (_state.currentTool === 'shape') {
    _shapeLastStampSize = { tw: mapCoords ? mapCoords.width : 1, th: mapCoords ? mapCoords.height : 1 };
    deselectStaged();
    _stageShapeObject(rect);
    if (_shapePendingDataUrl) {
      _preview.classList.add('bwbr-placement-preview--visible');
      _preview.innerHTML = '<img src="' + _shapePendingDataUrl + '" alt="">';
    }
    return;
  }

  // 이미지 드래그 배치 → 타일 단위 크기 저장 (스탬프 모드용)
  _state.lastStampSize = { tw: mapCoords ? mapCoords.width : 1, th: mapCoords ? mapCoords.height : 1 };

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

  // zoom 컨테이너 교체 감지
  var zoomEl = getZoomContainer();
  if (zoomEl && _cachedZoomEl && _cachedZoomEl !== zoomEl) {
    _migrateStaged(zoomEl);
  }
  if (zoomEl) _cachedZoomEl = zoomEl;

  // DOM에서 직접 설정값 읽기 (이벤트 리스너 불발 대비)
  readSettingsFromDOM();

  if (window._BWBR_DEBUG) console.log('[CE 배치] 스테이징:', screenRect, '→ 타일:', mapCoords);
  if (window._BWBR_DEBUG) console.log('[CE 배치] panelSettings:', JSON.stringify(_state.panelSettings));

  var obj = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    mapCoords: mapCoords,
    angle: 0,
    imageDataUrl: _state.pendingImage ? _state.pendingImage.dataUrl :
                  _state.pendingTextDataUrl ? _state.pendingTextDataUrl : null,
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
  pushUndo({ type: 'stage', ids: [obj.id] });
  updateConfirmBar();
  // 오버레이 유지 → 연속 배치 가능
}


// ── 스테이징 렌더링 (맵 위 프리뷰) ─────────────────────────────

// zoom 컨테이너 교체 시 기존 스테이징 아이템 → 새 컨테이너로 이동
function _migrateStaged(newZoomEl) {
  if (window._BWBR_DEBUG) console.log('[CE 배치] zoom 컨테이너 교체 감지, 스테이징 아이템 재부착');
  document.querySelectorAll('.bwbr-staged-item').forEach(function (el) {
    newZoomEl.appendChild(el);
  });
  // 새 컨테이너도 containing block 보장
  if (getComputedStyle(newZoomEl).position === 'static') {
    newZoomEl.style.position = 'relative';
  }
}

// 스테이징 아이템 보호: React가 zoom 컨테이너를 교체할 때 아이템 유실 방지
// 배치 모드 활성 + 스테이징 아이템이 있을 때 주기적으로 체크
function _startStagingGuard() {
  if (_stagingGuardId) return;
  function guard() {
    _stagingGuardId = requestAnimationFrame(guard);
    if (_state.stagedObjects.length === 0) return;
    var zoomEl = getZoomContainer();
    if (!zoomEl) return;
    // zoom 컨테이너 교체 감지
    if (_cachedZoomEl && _cachedZoomEl !== zoomEl) {
      _migrateStaged(zoomEl);
      _cachedZoomEl = zoomEl;
    }
    // 아이템이 DOM에서 제거됐는지 확인 (React reconciliation 등)
    var first = document.querySelector('.bwbr-staged-item');
    if (!first && _state.stagedObjects.length > 0) {
      // 아이템이 모두 사라짐 → 재렌더링
      console.warn('[CE 배치] 스테이징 아이템 유실 감지, 복원 중...');
      _state.stagedObjects.forEach(function(obj) { renderStagedItem(obj); });
      renumberStagedBadges();
    }
  }
  _stagingGuardId = requestAnimationFrame(guard);
}

function _stopStagingGuard() {
  if (_stagingGuardId) { cancelAnimationFrame(_stagingGuardId); _stagingGuardId = null; }
}

function renderStagedItem(obj) {
  var zoomEl = getZoomContainer();
  if (!zoomEl) return;

  // zoom 컨테이너 교체 감지: React가 DOM 노드를 교체하면 기존 스테이징 아이템 재부착
  if (_cachedZoomEl && _cachedZoomEl !== zoomEl) {
    _migrateStaged(zoomEl);
  }
  _cachedZoomEl = zoomEl;

  // position:static이면 transform 제거 시 containing block이 사라짐 → 드리프트 방지
  if (getComputedStyle(zoomEl).position === 'static') {
    zoomEl.style.position = 'relative';
  }

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

  // 더블클릭으로 텍스트 다시 편집 (textHtml이 있는 객체만)
  if (obj.textHtml) {
    el.addEventListener('dblclick', function(ev) {
      ev.stopPropagation();
      reopenTextEditor(obj.id);
    });
  }

  zoomEl.appendChild(el);
}

function reopenTextEditor(objId) {
  var idx = _state.stagedObjects.findIndex(function(o) { return o.id === objId; });
  if (idx === -1) return;
  var obj = _state.stagedObjects[idx];
  if (!obj.textHtml) return;

  // 원본 보관 (ESC 취소 시 복원용)
  _reopenedObj = cloneObj(obj);

  // Remove from staged
  _state.stagedObjects.splice(idx, 1);
  var selIdx = _state.selectedStagedIds.indexOf(objId);
  if (selIdx !== -1) _state.selectedStagedIds.splice(selIdx, 1);
  var el = document.querySelector('[data-staged-id="' + objId + '"]');
  if (el) el.remove();
  renumberStagedBadges();
  updateConfirmBar();

  // mapCoords → screen rect (startTextEditing에서 screenToMapCoords 역변환)
  var origin = getMapOriginOnScreen();
  if (!origin) return;
  var scale = getZoomScale();
  var rect = {
    x: origin.x + obj.mapCoords.x * CELL_PX * scale,
    y: origin.y + obj.mapCoords.y * CELL_PX * scale,
    w: obj.mapCoords.width * CELL_PX * scale,
    h: obj.mapCoords.height * CELL_PX * scale
  };

  // Restore alignment state before opening editor
  _textAlign = obj.textAlign || 'left';
  _textVAlign = obj.textVAlign || 'top';
  _textFontFamily = obj.textFontFamily || 'sans-serif';
  _textStrokeColor = obj.textStrokeColor || '#000000';
  _textStrokeWidth = obj.textStrokeWidth || 0;

  startTextEditing(rect);

  // Restore content + bgColor + font + stroke preview
  if (_textEditor) {
    _textEditor.innerHTML = obj.textHtml;
    if (obj.textBgColor) {
      _textBgColor = obj.textBgColor;
      if (_textEditorWrap) _textEditorWrap.style.background = obj.textBgColor;
    }
    _updateStrokePreview();
  }
}

function clearAllStaged() {
  _state.stagedObjects = [];
  _state.selectedStagedIds = [];
  document.querySelectorAll('.bwbr-staged-item').forEach(function (el) { el.remove(); });
  // 그리기 모드일 때 획도 함께 삭제
  if (_drawCanvas && _drawStrokes.length > 0) {
    _drawStrokes = [];
    _redrawAllStrokes();
  }
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


// ── Undo 시스템 ─────────────────────────────────────────────────

var MAX_UNDO = 50;

function pushUndo(action) {
  _state.undoStack.push(action);
  if (_state.undoStack.length > MAX_UNDO) _state.undoStack.shift();
}

function cloneObj(obj) {
  var c = {
    id: obj.id,
    mapCoords: { x: obj.mapCoords.x, y: obj.mapCoords.y, width: obj.mapCoords.width, height: obj.mapCoords.height },
    angle: obj.angle || 0,
    imageDataUrl: obj.imageDataUrl,
    settings: {
      type: obj.settings.type,
      z: obj.settings.z,
      memo: obj.settings.memo,
      locked: obj.settings.locked,
      freezed: obj.settings.freezed
    }
  };
  if (obj.textHtml) c.textHtml = obj.textHtml;
  if (obj.textBgColor) c.textBgColor = obj.textBgColor;
  if (obj.textAlign) c.textAlign = obj.textAlign;
  if (obj.textVAlign) c.textVAlign = obj.textVAlign;
  return c;
}

function undo() {
  if (_state.undoStack.length === 0) return;
  var action = _state.undoStack.pop();

  if (action.type === 'stage') {
    // 역: 추가된 오브젝트 제거
    action.ids.forEach(function(id) {
      var idx = _state.stagedObjects.findIndex(function(o) { return o.id === id; });
      if (idx !== -1) _state.stagedObjects.splice(idx, 1);
      var selIdx = _state.selectedStagedIds.indexOf(id);
      if (selIdx !== -1) _state.selectedStagedIds.splice(selIdx, 1);
      var el = document.querySelector('[data-staged-id="' + id + '"]');
      if (el) el.remove();
    });
  } else if (action.type === 'remove') {
    // 역: 제거된 오브젝트 복원
    action.objects.forEach(function(snap) {
      var obj = cloneObj(snap);
      _state.stagedObjects.push(obj);
      renderStagedItem(obj);
    });
  } else if (action.type === 'move') {
    // 역: 이전 좌표로 복원
    action.prev.forEach(function(p) {
      var obj = _state.stagedObjects.find(function(o) { return o.id === p.id; });
      if (!obj) return;
      obj.mapCoords.x = p.x;
      obj.mapCoords.y = p.y;
      var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
      if (el) {
        el.style.left = (obj.mapCoords.x * CELL_PX) + 'px';
        el.style.top = (obj.mapCoords.y * CELL_PX) + 'px';
      }
    });
  } else if (action.type === 'rotate') {
    // 역: 이전 각도로 복원
    action.prev.forEach(function(p) {
      var obj = _state.stagedObjects.find(function(o) { return o.id === p.id; });
      if (!obj) return;
      obj.angle = p.angle;
      var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
      if (el) {
        el.style.transform = obj.angle ? 'rotate(' + obj.angle + 'deg)' : '';
      }
    });
  } else if (action.type === 'align') {
    // 역: 이전 좌표로 복원
    action.prev.forEach(function(p) {
      var obj = _state.stagedObjects.find(function(o) { return o.id === p.id; });
      if (!obj) return;
      obj.mapCoords.x = p.x;
      obj.mapCoords.y = p.y;
      var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
      if (el) {
        el.style.left = (obj.mapCoords.x * CELL_PX) + 'px';
        el.style.top = (obj.mapCoords.y * CELL_PX) + 'px';
      }
    });
  } else if (action.type === 'resize') {
    var obj = _state.stagedObjects.find(function(o) { return o.id === action.id; });
    if (obj) {
      obj.mapCoords.x = action.prev.x;
      obj.mapCoords.y = action.prev.y;
      obj.mapCoords.width = action.prev.width;
      obj.mapCoords.height = action.prev.height;
      var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
      if (el) {
        el.style.left = (obj.mapCoords.x * CELL_PX) + 'px';
        el.style.top = (obj.mapCoords.y * CELL_PX) + 'px';
        el.style.width = (obj.mapCoords.width * CELL_PX) + 'px';
        el.style.height = (obj.mapCoords.height * CELL_PX) + 'px';
      }
    }
    _updateResizeHandles();
  }

  renumberStagedBadges();
  updateConfirmBar();
  updateAlignBar();
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
      _state.selectedStagedIds.splice(idx, 1);
      var el = document.querySelector('[data-staged-id="' + id + '"]');
      if (el) el.classList.remove('bwbr-staged-item--selected');
      _updateResizeHandles();
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
  _updateResizeHandles();
}

function deselectStaged() {
  _state.selectedStagedIds.forEach(function(id) {
    var el = document.querySelector('[data-staged-id="' + id + '"]');
    if (el) el.classList.remove('bwbr-staged-item--selected');
  });
  _state.selectedStagedIds = [];
  _removeResizeHandles();
}

// ── 리사이즈 핸들 ───────────────────────────────────────────────

var _resizeHandles = [];
var _resizeDrag = null;

var HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function _removeResizeHandles() {
  _resizeHandles.forEach(function(h) { h.remove(); });
  _resizeHandles = [];
}

function _updateResizeHandles() {
  _removeResizeHandles();
  // 단일 선택인 경우에만 핸들 표시
  if (_state.selectedStagedIds.length !== 1) return;
  var id = _state.selectedStagedIds[0];
  var el = document.querySelector('[data-staged-id="' + id + '"]');
  if (!el) return;

  HANDLE_DIRS.forEach(function(dir) {
    var h = document.createElement('div');
    h.className = 'bwbr-resize-handle bwbr-resize-handle--' + dir;
    _setTooltip(h, '크기 조절 (Shift: 비율 유지 / Alt: 양쪽)');
    h.addEventListener('mousedown', function(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      _startResize(id, dir, ev);
    });
    el.appendChild(h);
    _resizeHandles.push(h);
  });
}

function _startResize(objId, dir, e) {
  var obj = _state.stagedObjects.find(function(o) { return o.id === objId; });
  if (!obj) return;
  _resizeDrag = {
    objId: objId,
    dir: dir,
    startX: e.clientX,
    startY: e.clientY,
    origX: obj.mapCoords.x,
    origY: obj.mapCoords.y,
    origW: obj.mapCoords.width,
    origH: obj.mapCoords.height,
    aspect: obj.mapCoords.width / (obj.mapCoords.height || 1),
    angle: obj.angle || 0
  };

  function onMove(ev) {
    if (!_resizeDrag) return;
    var scale = getZoomScale();
    var d = _resizeDrag.dir;
    var alt = ev.altKey;
    var angle = _resizeDrag.angle;
    var hasRotation = Math.abs(angle % 360) > 0.01;

    // 마우스 델타 → 타일 단위 (회전 시 로컬 좌표계로 변환)
    var rawDx = (ev.clientX - _resizeDrag.startX) / (scale * CELL_PX);
    var rawDy = (ev.clientY - _resizeDrag.startY) / (scale * CELL_PX);
    var dx, dy;
    if (hasRotation) {
      var invRad = -(angle * Math.PI / 180);
      dx = Math.round(rawDx * Math.cos(invRad) - rawDy * Math.sin(invRad));
      dy = Math.round(rawDx * Math.sin(invRad) + rawDy * Math.cos(invRad));
    } else {
      dx = Math.round(rawDx);
      dy = Math.round(rawDy);
    }

    var nw = _resizeDrag.origW, nh = _resizeDrag.origH;

    if (d.indexOf('w') >= 0) { nw -= dx; if (alt) nw -= dx; }
    if (d.indexOf('e') >= 0) { nw += dx; if (alt) nw += dx; }
    if (d.indexOf('n') >= 0) { nh -= dy; if (alt) nh -= dy; }
    if (d.indexOf('s') >= 0) { nh += dy; if (alt) nh += dy; }

    // Shift: 비율 유지 리사이즈
    if (ev.shiftKey && _resizeDrag.aspect > 0) {
      var isCorner = d.length === 2;
      var isHoriz = d === 'e' || d === 'w';
      var isVert = d === 'n' || d === 's';
      if (isCorner) {
        var dw = nw - _resizeDrag.origW;
        var dh = nh - _resizeDrag.origH;
        if (Math.abs(dw) / _resizeDrag.aspect >= Math.abs(dh)) {
          nh = Math.max(1, Math.round(nw / _resizeDrag.aspect));
        } else {
          nw = Math.max(1, Math.round(nh * _resizeDrag.aspect));
        }
      } else if (isHoriz) {
        nh = Math.max(1, Math.round(nw / _resizeDrag.aspect));
      } else if (isVert) {
        nw = Math.max(1, Math.round(nh * _resizeDrag.aspect));
      }
    }

    if (nw < 1) nw = 1;
    if (nh < 1) nh = 1;

    // 텍스트 블록: 최소 높이
    if (obj.textHtml) {
      var minH = 2;
      if (nh < minH) nh = minH;
    }

    // 위치 계산
    var nx, ny;
    if (alt) {
      // Alt: 중심 고정 대칭 리사이즈
      var origCx = _resizeDrag.origX + _resizeDrag.origW / 2;
      var origCy = _resizeDrag.origY + _resizeDrag.origH / 2;
      nx = origCx - nw / 2;
      ny = origCy - nh / 2;
    } else if (hasRotation) {
      // 회전된 오브젝트: 앵커 포인트 방식
      var rad = angle * Math.PI / 180;
      var cosR = Math.cos(rad), sinR = Math.sin(rad);
      var oldCx = _resizeDrag.origX + _resizeDrag.origW / 2;
      var oldCy = _resizeDrag.origY + _resizeDrag.origH / 2;
      // 드래그 반대쪽 = 앵커
      var aFx = 0, aFy = 0;
      if (d.indexOf('e') >= 0) aFx = -1; else if (d.indexOf('w') >= 0) aFx = 1;
      if (d.indexOf('s') >= 0) aFy = -1; else if (d.indexOf('n') >= 0) aFy = 1;
      // 기존 앵커 위치 (로컬 → 월드)
      var oaLx = aFx * _resizeDrag.origW / 2, oaLy = aFy * _resizeDrag.origH / 2;
      var anchorWx = oldCx + oaLx * cosR - oaLy * sinR;
      var anchorWy = oldCy + oaLx * sinR + oaLy * cosR;
      // 새 앵커 오프셋 (로컬)
      var naLx = aFx * nw / 2, naLy = aFy * nh / 2;
      // 새 중심 = anchor_world - rotate(new_anchor_local)
      var newCx = anchorWx - (naLx * cosR - naLy * sinR);
      var newCy = anchorWy - (naLx * sinR + naLy * cosR);
      nx = newCx - nw / 2;
      ny = newCy - nh / 2;
    } else {
      // 미회전: 기존 로직
      nx = _resizeDrag.origX;
      ny = _resizeDrag.origY;
      if (d.indexOf('w') >= 0) nx = _resizeDrag.origX + _resizeDrag.origW - nw;
      if (d.indexOf('n') >= 0) ny = _resizeDrag.origY + _resizeDrag.origH - nh;
    }

    obj.mapCoords.x = nx; obj.mapCoords.y = ny;
    obj.mapCoords.width = nw; obj.mapCoords.height = nh;

    var el = document.querySelector('[data-staged-id="' + objId + '"]');
    if (el) {
      el.style.left = (nx * CELL_PX) + 'px';
      el.style.top = (ny * CELL_PX) + 'px';
      el.style.width = (nw * CELL_PX) + 'px';
      el.style.height = (nh * CELL_PX) + 'px';
    }
  }

  function onUp() {
    if (_resizeDrag) {
      // 실제 변경이 있을 때만 undo 기록
      var mc = obj.mapCoords;
      if (mc.x !== _resizeDrag.origX || mc.y !== _resizeDrag.origY ||
          mc.width !== _resizeDrag.origW || mc.height !== _resizeDrag.origH) {
        pushUndo({
          type: 'resize',
          id: objId,
          prev: { x: _resizeDrag.origX, y: _resizeDrag.origY, width: _resizeDrag.origW, height: _resizeDrag.origH }
        });
        // 텍스트 블록이면 새 크기로 캔버스 리렌더 (찌그러짐 방지)
        if (obj.textHtml) _reRenderTextBlock(obj);
      }
    }
    _resizeDrag = null;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    _updateResizeHandles();
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);
}

function finishAltBoxSelect() {
  if (!_altBoxSelect.rectEl) { _altBoxSelect.active = false; return; }
  var selR = _altBoxSelect.rectEl.getBoundingClientRect();
  _altBoxSelect.rectEl.remove();
  _altBoxSelect.rectEl = null;
  var wasAdditive = _altBoxSelect.additive;
  _altBoxSelect.active = false;
  _altBoxSelect.additive = false;

  var isClick = (selR.width < 5 && selR.height < 5);

  // 모든 스테이징 DOM 요소와 교차 검사
  var items = document.querySelectorAll('.bwbr-staged-item');
  var found = false;
  items.forEach(function(el) {
    var r = el.getBoundingClientRect();
    var intersects;
    if (isClick) {
      var cx = _altBoxSelect.startX, cy = _altBoxSelect.startY;
      intersects = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    } else {
      intersects =
        r.left < selR.right && r.right > selR.left &&
        r.top < selR.bottom && r.bottom > selR.top;
    }
    if (intersects) {
      var sid = el.getAttribute('data-staged-id');
      if (!sid) return;
      if (wasAdditive && isClick) {
        // Alt+클릭 = 토글
        selectStagedItem(sid, true);
        found = true;
      } else if (_state.selectedStagedIds.indexOf(sid) === -1) {
        _state.selectedStagedIds.push(sid);
        el.classList.add('bwbr-staged-item--selected');
        found = true;
      }
    }
  });
  if (found && window._BWBR_DEBUG) console.log('[CE 배치] 선택:', _state.selectedStagedIds.length + '개');
  updateAlignBar();
  _updateResizeHandles();
}

function removeSelectedStaged() {
  if (_state.selectedStagedIds.length === 0) return;
  var removedObjs = [];
  _state.selectedStagedIds.forEach(function(id) {
    var obj = _state.stagedObjects.find(function(o) { return o.id === id; });
    if (obj) removedObjs.push(cloneObj(obj));
    var el = document.querySelector('[data-staged-id="' + id + '"]');
    if (el) el.remove();
    var idx = _state.stagedObjects.findIndex(function(o) { return o.id === id; });
    if (idx !== -1) _state.stagedObjects.splice(idx, 1);
  });
  if (removedObjs.length > 0) pushUndo({ type: 'remove', objects: removedObjs });
  _state.selectedStagedIds = [];
  renumberStagedBadges();
  updateConfirmBar();
  updateAlignBar();
}

function rotateSelectedStaged(delta) {
  if (_state.selectedStagedIds.length === 0) return;
  var prevAngles = [];
  var lastAngle = 0;
  _state.selectedStagedIds.forEach(function(id) {
    var obj = _state.stagedObjects.find(function(o) { return o.id === id; });
    if (!obj) return;
    prevAngles.push({ id: id, angle: obj.angle || 0 });
    obj.angle = ((obj.angle || 0) + delta) % 360;
    if (obj.angle < 0) obj.angle += 360;
    lastAngle = obj.angle;
    var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
    if (el) {
      el.style.transform = obj.angle ? 'rotate(' + obj.angle + 'deg)' : '';
    }
  });
  if (prevAngles.length > 0) pushUndo({ type: 'rotate', prev: prevAngles });
  showAngleIndicator(lastAngle);
}


// ── 선택 모드 상호작용 ──────────────────────────────────────────

var _selectDrag = { start: null, dragging: false };
var _altBoxSelect = { active: false, startX: 0, startY: 0, rectEl: null, additive: false };

function onStagedItemMouseDown(stagedId, e) {
  if (e.button !== 0 || !_state.active) return;
  e.stopPropagation();
  e.preventDefault();

  // 편집 모드에서 스테이징 아이템 클릭 → 선택 모드로 전환
  if (_state.mode === 'edit') {
    activateMode('select');
  }

  // Alt+클릭 = 추가/토글 선택, Alt+드래그 = 복사 (deferred)
  if (e.altKey) {
    // 이미 선택된 아이템을 Alt+클릭으로 복사 드래그 시작하려는 경우: 토글하지 않고 선택 유지
    if (_state.selectedStagedIds.indexOf(stagedId) === -1) {
      // 선택 안 된 아이템 → 추가 선택
      selectStagedItem(stagedId, true);
    }
    // 이미 선택된 아이템 → 그냥 유지 (토글 안 함)
    updateAlignBar();
    if (_state.selectedStagedIds.length === 0) return;
    // Alt+드래그 복사를 위해 deferred 플래그 설정
    var origins = {};
    _state.selectedStagedIds.forEach(function(id) {
      var o = _state.stagedObjects.find(function(so) { return so.id === id; });
      if (o) origins[id] = { x: o.mapCoords.x, y: o.mapCoords.y };
    });
    _selectDrag.start = {
      screenX: e.clientX, screenY: e.clientY,
      origins: origins,
      altCopy: true, copied: false
    };
    _selectDrag.dragging = false;
    return;
  }

  // 이미 선택된 아이템 → 기존 다중 선택 유지, 미선택 → 단일 선택
  if (_state.selectedStagedIds.indexOf(stagedId) === -1) {
    selectStagedItem(stagedId, false);
  }
  updateAlignBar();

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

      // Alt+드래그 복사: 드래그 시작 시 복사본 생성
      if (_selectDrag.start.altCopy && !_selectDrag.start.copied) {
        _selectDrag.start.copied = true;
        var oldIds = _state.selectedStagedIds.slice();
        var newIds = [];
        var newOrigins = {};
        oldIds.forEach(function(id) {
          var orig = _state.stagedObjects.find(function(o) { return o.id === id; });
          if (!orig) return;
          var copy = JSON.parse(JSON.stringify(orig));
          copy.id = 'staged_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
          _state.stagedObjects.push(copy);
          renderStagedItem(copy);
          newIds.push(copy.id);
          newOrigins[copy.id] = { x: copy.mapCoords.x, y: copy.mapCoords.y };
        });
        // undo: 복사본 추가
        pushUndo({ type: 'stage', ids: newIds });
        // 원본 선택 해제, 복사본 선택
        deselectStaged();
        newIds.forEach(function(id) { selectStagedItem(id, true); });
        _selectDrag.start.origins = newOrigins;
        renumberStagedBadges();
        updateConfirmBar();
      }

      _state.selectedStagedIds.forEach(function(id) {
        var el = document.querySelector('[data-staged-id="' + id + '"]');
        if (el) el.classList.add('bwbr-staged-item--dragging');
      });
    }
    if (!_selectDrag.dragging) return;
    var scale = getZoomScale();
    var tileDx = Math.round(dx / (scale * CELL_PX));
    var tileDy = Math.round(dy / (scale * CELL_PX));
    // Shift: 축 고정 이동
    if (e.shiftKey) {
      if (Math.abs(tileDx) >= Math.abs(tileDy)) tileDy = 0;
      else tileDx = 0;
    }
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
    if (_selectDrag.dragging && _selectDrag.start && _selectDrag.start.origins) {
      // undo 기록: 이동 전 좌표
      var prevCoords = [];
      Object.keys(_selectDrag.start.origins).forEach(function(id) {
        var orig = _selectDrag.start.origins[id];
        prevCoords.push({ id: id, x: orig.x, y: orig.y });
      });
      if (prevCoords.length > 0) pushUndo({ type: 'move', prev: prevCoords });

      _state.selectedStagedIds.forEach(function(id) {
        var el = document.querySelector('[data-staged-id="' + id + '"]');
        if (el) el.classList.remove('bwbr-staged-item--dragging');
      });
    }
    _selectDrag.start = null;
    _selectDrag.dragging = false;
  });

  // 빈 공간 클릭/드래그 → 선택 모드: 범위 선택 / 일반 모드: Alt+범위선택
  document.addEventListener('mousedown', function(e) {
    if (!_state.active || e.button !== 0) return;
    if (_overlay.classList.contains('bwbr-placement-overlay--active')) return;
    if (e.target.closest('.bwbr-staged-item')) return;
    if (e.target.closest('.bwbr-placement-toolbar')) return;
    if (e.target.closest('.bwbr-place-confirm-bar')) return;
    if (e.target.closest('.bwbr-place-align-bar')) return;
    if (e.target.closest('.bwbr-text-toolbar')) return;
    if (e.target.closest('.bwbr-text-editor-wrap')) return;
    if (e.target.closest('.bwbr-place-confirm-dialog-overlay')) return;
    if (e.target.closest('.bwbr-color-popup')) return;

    // 선택 모드: 드래그 = 범위 선택
    // 편집 모드: Alt+드래그 → 자동으로 선택 모드 전환 후 범위 선택
    if (_state.mode === 'edit' && e.altKey && _state.stagedObjects.length > 0) {
      activateMode('select');
    }
    var shouldBoxSelect = _state.mode === 'select' && _state.stagedObjects.length > 0;

    if (shouldBoxSelect) {
      _altBoxSelect.active = true;
      _altBoxSelect.startX = e.clientX;
      _altBoxSelect.startY = e.clientY;
      _altBoxSelect.additive = e.altKey; // Alt 누르면 기존 선택 유지
      var rect = document.createElement('div');
      rect.className = 'bwbr-place-select-rect';
      rect.style.left = e.clientX + 'px';
      rect.style.top = e.clientY + 'px';
      rect.style.width = '0';
      rect.style.height = '0';
      document.body.appendChild(rect);
      _altBoxSelect.rectEl = rect;
      if (!e.altKey) deselectStaged();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    deselectStaged();
    updateAlignBar();
  });

  // 배치 모드 중 ccfolia 전경 더블클릭(설정 창) 차단
  document.addEventListener('dblclick', function(e) {
    if (!_state.active) return;
    if (e.target.closest('.bwbr-placement-toolbar') ||
        e.target.closest('.bwbr-place-confirm-bar') || e.target.closest('.bwbr-place-align-bar') ||
        e.target.closest('.bwbr-text-toolbar') || e.target.closest('.bwbr-placement-overlay') ||
        e.target.closest('.bwbr-place-confirm-dialog-overlay') ||
        e.target.closest('.bwbr-color-popup') || e.target.closest('.bwbr-text-editor-wrap')) return;
    // 스테이징 아이템 dblclick은 통과 (텍스트 편집기 열기)
    if (e.target.closest('.bwbr-staged-item')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  // 배치 모드 중 ccfolia 패닝 방지 (capture phase에서 pointer 이벤트 차단)
  document.addEventListener('pointerdown', function(e) {
    if (!e.isTrusted) return;
    if (!_state.active || e.button !== 0) return;
    if (e.target.closest('.bwbr-placement-toolbar') ||
        e.target.closest('.bwbr-place-confirm-bar') || e.target.closest('.bwbr-place-align-bar') ||
        e.target.closest('.bwbr-text-toolbar') ||
        e.target.closest('.bwbr-text-editor-wrap') ||
        e.target.closest('.bwbr-place-confirm-dialog-overlay') ||
        e.target.closest('.bwbr-color-popup') ||
        e.target.closest('.bwbr-placement-overlay')) return;

    // 편집 모드: 항상 좌클릭 패닝 차단
    if (_state.mode === 'edit') { e.stopImmediatePropagation(); return; }

    // 선택 모드: 항상 좌클릭 패닝 차단
    if (_state.mode === 'select') { e.stopImmediatePropagation(); return; }
  }, true);

  // mousedown도 캡처 단계에서 차단 (ccfolia가 mousedown으로 패닝할 수 있음)
  // stopImmediatePropagation이 기존 버블 핸들러도 차단하므로 여기서 직접 처리
  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0 || !_state.active) return;
    // 미들클릭 패닝 중에는 합성 mousedown 통과 (midpan-main.js → 보드)
    if (document.documentElement.hasAttribute('data-bwbr-midpan')) return;
    if (_state.mode !== 'select' && _state.mode !== 'edit') return;
    if (e.target.closest('.bwbr-placement-toolbar') ||
        e.target.closest('.bwbr-place-confirm-bar') || e.target.closest('.bwbr-place-align-bar') ||
        e.target.closest('.bwbr-text-toolbar') ||
        e.target.closest('.bwbr-placement-overlay') ||
        e.target.closest('.bwbr-place-confirm-dialog-overlay') ||
        e.target.closest('.bwbr-color-popup')) return; // 오버레이/컬러팝업 클릭은 통과

    // 리사이즈 핸들 클릭: 핸들 자체 mousedown이 처리하도록 통과
    // 패닝 차단은 pointerdown capture에서 이미 처리됨
    if (e.target.closest('.bwbr-resize-handle')) return;

    // 텍스트 에디터 영역 클릭: 통과
    if (e.target.closest('.bwbr-text-editor-wrap')) return;

    // 스테이징 아이템 클릭: 텍스트 편집 중이면 무시 (툴바 Z 아래 스테이지 관통 방지)
    var stagedEl = e.target.closest('.bwbr-staged-item');
    if (stagedEl) {
      if (_state.textEditing) { e.stopImmediatePropagation(); return; }
      var stagedId = stagedEl.getAttribute('data-staged-id');
      if (stagedId) onStagedItemMouseDown(stagedId, e);
      e.stopImmediatePropagation();
      return;
    }

    // 편집 모드: Alt+드래그 → 선택 모드 전환
    if (_state.mode === 'edit' && e.altKey && _state.stagedObjects.length > 0) {
      activateMode('select');
    }

    // 빈 공간 클릭: 범위 선택 또는 선택 해제
    if (_state.mode === 'select' && _state.stagedObjects.length > 0) {
      _altBoxSelect.active = true;
      _altBoxSelect.startX = e.clientX;
      _altBoxSelect.startY = e.clientY;
      _altBoxSelect.additive = e.altKey;
      var rect = document.createElement('div');
      rect.className = 'bwbr-place-select-rect';
      rect.style.left = e.clientX + 'px';
      rect.style.top = e.clientY + 'px';
      rect.style.width = '0';
      rect.style.height = '0';
      document.body.appendChild(rect);
      _altBoxSelect.rectEl = rect;
      if (!e.altKey) deselectStaged();
      e.preventDefault();
    } else {
      deselectStaged();
      updateAlignBar();
    }

    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('pointermove', function(e) {
    if (!e.isTrusted) return;
    // 오버레이 자체 이벤트는 통과 (그리기/배치/범위선택 모두 오버레이의 pointer 핸들러가 처리)
    if (e.target.closest('.bwbr-placement-overlay')) return;
    if (_altBoxSelect.active || _selectDrag.dragging) { e.stopImmediatePropagation(); }
    // 편집 모드: 오버레이 드래그/그리기 중 패닝 차단
    if (_state.mode === 'edit' && (_state.placing || _isDrawing)) { e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('pointerup', function(e) {
    if (!e.isTrusted) return;
    if (e.target.closest('.bwbr-placement-overlay')) return;
    if (_altBoxSelect.active || _selectDrag.dragging) { e.stopImmediatePropagation(); }
    if (_isDrawing) { e.stopImmediatePropagation(); }
  }, true);

  // 범위 선택용 mousemove/mouseup (document 레벨)
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


// ── 정렬 바 ────────────────────────────────────────────────────

var ALIGN_ICONS = {
  left:    '<path fill="currentColor" d="M4 22H2V2h2v20zM22 7H6v3h16V7zm-6 7H6v3h16v-3z"/>',
  hcenter: '<path fill="currentColor" d="M11 2h2v4h7v3H13v2h5v3h-5v2h7v3H13v4h-2v-4H4v-3h7v-2H6V11h5V9H4V6h7V2z"/>',
  right:   '<path fill="currentColor" d="M20 2h2v20h-2V2zM2 7h16v3H2V7zm6 7h10v3H2v-3z"/>',
  top:     '<path fill="currentColor" d="M22 2v2H2V2h20zM7 22V6h3v16H7zm7-6V6h3v10h-3z"/>',
  vcenter: '<path fill="currentColor" d="M2 11v2h4v7h3V13h2v5h3v-5h2v7h3V13h4v-2h-4V4h-3v7h-2V6h-3v5H9V4H6v7H2z"/>',
  bottom:  '<path fill="currentColor" d="M22 20v2H2v-2h20zM7 2v16h3V2H7zm7 6v10h3V2h-3z"/>',
  distH:   '<path fill="currentColor" d="M4 22H2V2h2v20zm16 0h2V2h-2v20zM13 7h-2v10h2V7z"/>',
  distV:   '<path fill="currentColor" d="M22 2v2H2V2h20zm0 16v2H2v-2h20zM7 13v-2h10v2H7z"/>'
};

var _alignBar = null;

function createAlignBar() {
  _alignBar = document.createElement('div');
  _alignBar.className = 'bwbr-place-align-bar';

  var buttons = [
    { id: 'left', label: '좌측 정렬', icon: ALIGN_ICONS.left },
    { id: 'hcenter', label: '가로 중앙', icon: ALIGN_ICONS.hcenter },
    { id: 'right', label: '우측 정렬', icon: ALIGN_ICONS.right },
    { id: 'sep1' },
    { id: 'top', label: '상단 정렬', icon: ALIGN_ICONS.top },
    { id: 'vcenter', label: '세로 중앙', icon: ALIGN_ICONS.vcenter },
    { id: 'bottom', label: '하단 정렬', icon: ALIGN_ICONS.bottom },
    { id: 'sep2' },
    { id: 'distH', label: '가로 균등', icon: ALIGN_ICONS.distH },
    { id: 'distV', label: '세로 균등', icon: ALIGN_ICONS.distV }
  ];

  buttons.forEach(function(b) {
    if (b.id.startsWith('sep')) {
      var sep = document.createElement('div');
      sep.className = 'bwbr-place-align-bar-sep';
      _alignBar.appendChild(sep);
      return;
    }
    var btn = document.createElement('button');
    btn.className = 'bwbr-place-align-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24">' + b.icon + '</svg>' +
      '<span class="bwbr-place-tooltip">' + b.label + '</span>';
    btn.addEventListener('click', function() { alignSelected(b.id); });
    _alignBar.appendChild(btn);
  });

  document.body.appendChild(_alignBar);
}

function updateAlignBar() {
  if (!_alignBar) return;
  if (_state.selectedStagedIds.length >= 2) {
    _alignBar.classList.add('bwbr-place-align-bar--visible');
    // 상단 위치: MuiAppBar-positionFixed (메인 상단 바) 아래
    var topBar = document.querySelector('.MuiAppBar-positionFixed');
    if (topBar) {
      _alignBar.style.top = (topBar.getBoundingClientRect().bottom + 8) + 'px';
    }
    // 수평 중앙: 필드 영역 기준
    _alignBar.style.left = _getFieldCenter() + 'px';
  } else {
    _alignBar.classList.remove('bwbr-place-align-bar--visible');
  }
}

function alignSelected(type) {
  var ids = _state.selectedStagedIds;
  if (ids.length < 2) return;

  var objs = [];
  ids.forEach(function(id) {
    var obj = _state.stagedObjects.find(function(o) { return o.id === id; });
    if (obj) objs.push(obj);
  });
  if (objs.length < 2) return;

  // undo용 이전 좌표 저장
  var prevCoords = objs.map(function(o) {
    return { id: o.id, x: o.mapCoords.x, y: o.mapCoords.y };
  });

  if (type === 'left') {
    var minX = Infinity;
    objs.forEach(function(o) { if (o.mapCoords.x < minX) minX = o.mapCoords.x; });
    objs.forEach(function(o) { o.mapCoords.x = minX; });
  } else if (type === 'right') {
    var maxRight = -Infinity;
    objs.forEach(function(o) {
      var r = o.mapCoords.x + o.mapCoords.width;
      if (r > maxRight) maxRight = r;
    });
    objs.forEach(function(o) { o.mapCoords.x = maxRight - o.mapCoords.width; });
  } else if (type === 'hcenter') {
    var minX2 = Infinity, maxRight2 = -Infinity;
    objs.forEach(function(o) {
      if (o.mapCoords.x < minX2) minX2 = o.mapCoords.x;
      var r = o.mapCoords.x + o.mapCoords.width;
      if (r > maxRight2) maxRight2 = r;
    });
    var centerX = (minX2 + maxRight2) / 2;
    objs.forEach(function(o) { o.mapCoords.x = Math.round(centerX - o.mapCoords.width / 2); });
  } else if (type === 'top') {
    var minY = Infinity;
    objs.forEach(function(o) { if (o.mapCoords.y < minY) minY = o.mapCoords.y; });
    objs.forEach(function(o) { o.mapCoords.y = minY; });
  } else if (type === 'bottom') {
    var maxBottom = -Infinity;
    objs.forEach(function(o) {
      var b = o.mapCoords.y + o.mapCoords.height;
      if (b > maxBottom) maxBottom = b;
    });
    objs.forEach(function(o) { o.mapCoords.y = maxBottom - o.mapCoords.height; });
  } else if (type === 'vcenter') {
    var minY2 = Infinity, maxBottom2 = -Infinity;
    objs.forEach(function(o) {
      if (o.mapCoords.y < minY2) minY2 = o.mapCoords.y;
      var b = o.mapCoords.y + o.mapCoords.height;
      if (b > maxBottom2) maxBottom2 = b;
    });
    var centerY = (minY2 + maxBottom2) / 2;
    objs.forEach(function(o) { o.mapCoords.y = Math.round(centerY - o.mapCoords.height / 2); });
  } else if (type === 'distH') {
    if (objs.length < 3) return;
    objs.sort(function(a, b) { return a.mapCoords.x - b.mapCoords.x; });
    var first = objs[0], last = objs[objs.length - 1];
    var totalWidth = 0;
    objs.forEach(function(o) { totalWidth += o.mapCoords.width; });
    var span = (last.mapCoords.x + last.mapCoords.width) - first.mapCoords.x;
    var gap = (span - totalWidth) / (objs.length - 1);
    var cx = first.mapCoords.x;
    objs.forEach(function(o) {
      o.mapCoords.x = Math.round(cx);
      cx += o.mapCoords.width + gap;
    });
  } else if (type === 'distV') {
    if (objs.length < 3) return;
    objs.sort(function(a, b) { return a.mapCoords.y - b.mapCoords.y; });
    var firstV = objs[0], lastV = objs[objs.length - 1];
    var totalHeight = 0;
    objs.forEach(function(o) { totalHeight += o.mapCoords.height; });
    var spanV = (lastV.mapCoords.y + lastV.mapCoords.height) - firstV.mapCoords.y;
    var gapV = (spanV - totalHeight) / (objs.length - 1);
    var cy2 = firstV.mapCoords.y;
    objs.forEach(function(o) {
      o.mapCoords.y = Math.round(cy2);
      cy2 += o.mapCoords.height + gapV;
    });
  }

  // DOM 업데이트
  objs.forEach(function(o) {
    var el = document.querySelector('[data-staged-id="' + o.id + '"]');
    if (el) {
      el.style.left = (o.mapCoords.x * CELL_PX) + 'px';
      el.style.top = (o.mapCoords.y * CELL_PX) + 'px';
    }
  });

  pushUndo({ type: 'align', prev: prevCoords });
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

  _confirmBtnEl = document.createElement('button');
  _confirmBtnEl.className = 'bwbr-place-confirm-bar-btn bwbr-place-confirm-btn';
  _confirmBtnEl.textContent = '✓ 확인';
  _confirmBtnEl.addEventListener('click', showConfirmDialog);

  _confirmBar.appendChild(cancelBtn);
  _confirmBar.appendChild(_stagedCountEl);
  _confirmBar.appendChild(_confirmBtnEl);

  document.body.appendChild(_confirmBar);
}

function updateConfirmBar() {
  if (!_state.active) {
    _confirmBar.classList.remove('bwbr-place-confirm-bar--visible');
    return;
  }
  var count = _state.stagedObjects.length;
  _confirmBar.classList.add('bwbr-place-confirm-bar--visible');
  _stagedCountEl.textContent = count > 0 ? count + '개 배치됨' : '배치 없음';
  if (_confirmBtnEl) {
    _confirmBtnEl.disabled = count === 0;
  }
  _confirmBar.style.left = _getFieldCenter() + 'px';
}


// ── 확인 설정 다이얼로그 ────────────────────────────────────────

function createConfirmDialog() {
  _confirmDialogOverlay = document.createElement('div');
  _confirmDialogOverlay.className = 'bwbr-place-confirm-dialog-overlay';

  var dialog = document.createElement('div');
  dialog.className = 'bwbr-place-confirm-dialog';

  // 제목
  var title = document.createElement('div');
  title.className = 'bwbr-place-confirm-dialog-title';
  title.textContent = '패널 설정';
  dialog.appendChild(title);

  // 타입 토글
  var typeRow = document.createElement('div');
  typeRow.className = 'bwbr-place-confirm-dialog-row';
  var typeLabel = document.createElement('span');
  typeLabel.textContent = '타입';
  typeLabel.style.cssText = 'font-size:13px;color:#555;flex-shrink:0;min-width:44px';
  var typeToggle = document.createElement('div');
  typeToggle.className = 'bwbr-place-type-toggle';
  typeToggle.style.minWidth = '120px';
  var btnMarker = document.createElement('button');
  btnMarker.textContent = '마커';
  btnMarker.className = 'active';
  var btnScreen = document.createElement('button');
  btnScreen.textContent = '스크린';
  btnMarker.addEventListener('click', function () {
    btnMarker.className = 'active';
    btnScreen.className = '';
  });
  btnScreen.addEventListener('click', function () {
    btnScreen.className = 'active';
    btnMarker.className = '';
  });
  typeToggle.appendChild(btnMarker);
  typeToggle.appendChild(btnScreen);
  typeRow.appendChild(typeLabel);
  typeRow.appendChild(typeToggle);
  dialog.appendChild(typeRow);
  _confirmDialogEls.typePlaneBtn = btnMarker;
  _confirmDialogEls.typeObjectBtn = btnScreen;

  // 겹침 우선도 + 위치 고정 + 사이즈 고정 (한 줄)
  var optRow = document.createElement('div');
  optRow.className = 'bwbr-place-confirm-dialog-row';

  var zLabel = document.createElement('span');
  zLabel.textContent = '우선도';
  zLabel.style.cssText = 'font-size:13px;color:#555;flex-shrink:0;min-width:44px';
  var zInput = document.createElement('input');
  zInput.type = 'number';
  zInput.value = '150';
  zInput.min = '0';
  zInput.max = '9999';
  optRow.appendChild(zLabel);
  optRow.appendChild(zInput);
  _confirmDialogEls.zInput = zInput;

  // 간격
  var spacer = document.createElement('div');
  spacer.style.flex = '1';
  optRow.appendChild(spacer);

  // 위치 고정
  var lockedLabel = document.createElement('label');
  var lockedSpan = document.createElement('span');
  lockedSpan.textContent = '위치 고정';
  var lockedToggle = document.createElement('div');
  lockedToggle.className = 'bwbr-place-toggle';
  var lockedInput = document.createElement('input');
  lockedInput.type = 'checkbox';
  var lockedSlider = document.createElement('span');
  lockedSlider.className = 'bwbr-place-slider';
  lockedToggle.appendChild(lockedInput);
  lockedToggle.appendChild(lockedSlider);
  lockedLabel.appendChild(lockedSpan);
  lockedLabel.appendChild(lockedToggle);
  optRow.appendChild(lockedLabel);
  _confirmDialogEls.lockedInput = lockedInput;

  // 사이즈 고정
  var freezedLabel = document.createElement('label');
  var freezedSpan = document.createElement('span');
  freezedSpan.textContent = '사이즈 고정';
  var freezedToggle = document.createElement('div');
  freezedToggle.className = 'bwbr-place-toggle';
  var freezedInput = document.createElement('input');
  freezedInput.type = 'checkbox';
  var freezedSlider = document.createElement('span');
  freezedSlider.className = 'bwbr-place-slider';
  freezedToggle.appendChild(freezedInput);
  freezedToggle.appendChild(freezedSlider);
  freezedLabel.appendChild(freezedSpan);
  freezedLabel.appendChild(freezedToggle);
  optRow.appendChild(freezedLabel);
  _confirmDialogEls.freezedInput = freezedInput;

  dialog.appendChild(optRow);

  // 패널 메모 (크게)
  var memoLabel = document.createElement('span');
  memoLabel.textContent = '패널 메모';
  memoLabel.style.cssText = 'font-size:13px;color:#555';
  dialog.appendChild(memoLabel);
  var memoInput = document.createElement('textarea');
  memoInput.placeholder = '메모 입력...';
  dialog.appendChild(memoInput);
  _confirmDialogEls.memoInput = memoInput;

  // 액션 버튼
  var actions = document.createElement('div');
  actions.className = 'bwbr-place-confirm-dialog-actions';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'bwbr-dlg-cancel';
  cancelBtn.textContent = '취소';
  cancelBtn.addEventListener('click', hideConfirmDialog);
  var okBtn = document.createElement('button');
  okBtn.className = 'bwbr-dlg-ok';
  okBtn.textContent = '확인';
  okBtn.addEventListener('click', function () {
    readSettingsFromDialog();
    hideConfirmDialog();
    compositeAndCommit();
  });
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  dialog.appendChild(actions);

  _confirmDialogOverlay.appendChild(dialog);
  _confirmDialogOverlay.addEventListener('click', function (e) {
    if (e.target === _confirmDialogOverlay) hideConfirmDialog();
  });
  document.body.appendChild(_confirmDialogOverlay);
}

function showConfirmDialog() {
  if (_state.stagedObjects.length === 0) return;
  // 다이얼로그 필드에 현재 설정 반영
  var s = _state.panelSettings;
  if (_confirmDialogEls.typePlaneBtn) {
    _confirmDialogEls.typePlaneBtn.className = s.type === 'plane' ? 'active' : '';
    _confirmDialogEls.typeObjectBtn.className = s.type === 'object' ? 'active' : '';
  }
  if (_confirmDialogEls.zInput) _confirmDialogEls.zInput.value = s.z;
  if (_confirmDialogEls.memoInput) _confirmDialogEls.memoInput.value = s.memo || '';
  if (_confirmDialogEls.lockedInput) _confirmDialogEls.lockedInput.checked = !!s.locked;
  if (_confirmDialogEls.freezedInput) _confirmDialogEls.freezedInput.checked = !!s.freezed;

  _confirmDialogOverlay.style.display = 'flex';
  // force reflow for animation
  _confirmDialogOverlay.offsetHeight;
  _confirmDialogOverlay.classList.add('bwbr-place-confirm-dialog-overlay--open');
}

function hideConfirmDialog() {
  _confirmDialogOverlay.classList.remove('bwbr-place-confirm-dialog-overlay--open');
  setTimeout(function () {
    _confirmDialogOverlay.style.display = 'none';
  }, 200);
}

function readSettingsFromDialog() {
  if (_confirmDialogEls.typePlaneBtn) {
    _state.panelSettings.type = _confirmDialogEls.typePlaneBtn.classList.contains('active') ? 'plane' : 'object';
  }
  if (_confirmDialogEls.zInput) {
    var zVal = parseInt(_confirmDialogEls.zInput.value, 10);
    _state.panelSettings.z = isNaN(zVal) ? 150 : zVal;
  }
  if (_confirmDialogEls.memoInput) {
    _state.panelSettings.memo = _confirmDialogEls.memoInput.value || '';
  }
  if (_confirmDialogEls.lockedInput) {
    _state.panelSettings.locked = !!_confirmDialogEls.lockedInput.checked;
  }
  if (_confirmDialogEls.freezedInput) {
    _state.panelSettings.freezed = !!_confirmDialogEls.freezedInput.checked;
  }
}

// type에 따라 스크린(items) 또는 마커(room.markers)로 생성
function _dispatchCreatePanelOrMarker(panelData) {
  if (panelData.type === 'plane') {
    // 마커 생성 결과 리스너 (1회)
    var onResult = function() {
      document.removeEventListener('bwbr-create-marker-result', onResult);
      var raw = document.documentElement.getAttribute('data-bwbr-create-marker-result');
      document.documentElement.removeAttribute('data-bwbr-create-marker-result');
      try {
        var res = raw ? JSON.parse(raw) : {};
        if (!res.success && res.error) {
          var msg = '마커 생성 실패: ' + res.error;
          if (window.BWBR_FabButtons && window.BWBR_FabButtons.showToast) {
            window.BWBR_FabButtons.showToast(msg, { bg: 'rgba(211,47,47,0.92)', color: '#fff', duration: 4000 });
          }
          console.error('[CE 배치] 마커 생성 실패:', res.error);
        }
      } catch (e) { /* ignore parse error */ }
    };
    document.addEventListener('bwbr-create-marker-result', onResult);
    document.documentElement.setAttribute('data-bwbr-create-marker', JSON.stringify(panelData));
    document.dispatchEvent(new CustomEvent('bwbr-create-marker'));
  } else {
    document.documentElement.setAttribute('data-bwbr-create-panel', JSON.stringify(panelData));
    document.dispatchEvent(new CustomEvent('bwbr-create-panel'));
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

  // 1. 바운딩 박스 계산 (타일 좌표, 회전 반영)
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  _state.stagedObjects.forEach(function (obj) {
    var mc = obj.mapCoords;
    if (obj.angle && Math.abs(obj.angle % 360) > 0.01) {
      // 회전된 오브젝트: 4개 꼬지점 계산
      var cx = mc.x + mc.width / 2, cy = mc.y + mc.height / 2;
      var hw = mc.width / 2, hh = mc.height / 2;
      var rad = obj.angle * Math.PI / 180;
      var cosA = Math.cos(rad), sinA = Math.sin(rad);
      var corners = [
        { x: cx + (-hw * cosA - (-hh) * sinA), y: cy + (-hw * sinA + (-hh) * cosA) },
        { x: cx + ( hw * cosA - (-hh) * sinA), y: cy + ( hw * sinA + (-hh) * cosA) },
        { x: cx + ( hw * cosA -   hh  * sinA), y: cy + ( hw * sinA +   hh  * cosA) },
        { x: cx + (-hw * cosA -   hh  * sinA), y: cy + (-hw * sinA +   hh  * cosA) }
      ];
      corners.forEach(function(c) {
        minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y);
      });
    } else {
      minX = Math.min(minX, mc.x);
      minY = Math.min(minY, mc.y);
      maxX = Math.max(maxX, mc.x + mc.width);
      maxY = Math.max(maxY, mc.y + mc.height);
    }
  });
  var bboxW = maxX - minX;
  var bboxH = maxY - minY;
  var s = _state.stagedObjects[0].settings;

  if (window._BWBR_DEBUG) console.log('[CE 배치] 확인 → settings:', JSON.stringify(s), '/ bbox:', bboxW + '×' + bboxH);

  // 단일 오브젝트 + URL 이미지 + 회전 없음 → 합성 없이 직접 생성
  // (회전이 있으면 이미지에 회전을 베이킹해야 하므로 합성 경로로)
  if (_state.stagedObjects.length === 1 && _state.stagedObjects[0].imageDataUrl &&
      !_state.stagedObjects[0].imageDataUrl.startsWith('data:') &&
      !(_state.stagedObjects[0].angle || 0)) {
    var obj0 = _state.stagedObjects[0];
    var panelData = {
      type: s.type, x: obj0.mapCoords.x, y: obj0.mapCoords.y, z: s.z,
      width: obj0.mapCoords.width, height: obj0.mapCoords.height,
      angle: obj0.angle || 0, memo: s.memo, locked: s.locked, freezed: s.freezed,
      imageUrl: obj0.imageDataUrl
    };
    _dispatchCreatePanelOrMarker(panelData);
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
    // data URL은 redux-injector에서 Firebase Storage에 업로드 후 CDN URL로 변환됨
    var compressMax = 900000;
    try {
      dataUrl = compressCanvasToDataUrl(canvas, compressMax);
    } catch (err) {
      console.warn('[CE 배치] 캔버스 합성 실패 (CORS), 개별 패널 생성으로 대체:', err.message);
      commitIndividualPanels();
      return;
    }

    if (window._BWBR_DEBUG) console.log('[CE 배치] 합성 완료:', bboxW + '×' + bboxH + '타일,', total + '개 이미지,', Math.round(dataUrl.length / 1024) + 'KB');

    var panelData = {
      type: s.type, x: minX, y: minY, z: s.z,
      width: bboxW, height: bboxH, angle: 0,
      memo: s.memo, locked: s.locked, freezed: s.freezed,
      imageUrl: dataUrl
    };

    _dispatchCreatePanelOrMarker(panelData);
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
      _dispatchCreatePanelOrMarker(panelData);
    });
    clearAllStaged();
  }
}

function compressCanvasToDataUrl(canvas, maxLen) {
  if (!maxLen) maxLen = 900000;
  var qualities = [0.85, 0.7, 0.5, 0.3, 0.15];
  for (var i = 0; i < qualities.length; i++) {
    var url = canvas.toDataURL('image/webp', qualities[i]);
    if (url.length < maxLen) return url;
  }
  // 1/2 해상도
  var half = document.createElement('canvas');
  half.width = Math.max(1, Math.floor(canvas.width / 2));
  half.height = Math.max(1, Math.floor(canvas.height / 2));
  half.getContext('2d').drawImage(canvas, 0, 0, half.width, half.height);
  for (var j = 0; j < qualities.length; j++) {
    var url2 = half.toDataURL('image/webp', qualities[j]);
    if (url2.length < maxLen) return url2;
  }
  // 1/4 해상도 최종 폴백
  var quarter = document.createElement('canvas');
  quarter.width = Math.max(1, Math.floor(canvas.width / 4));
  quarter.height = Math.max(1, Math.floor(canvas.height / 4));
  quarter.getContext('2d').drawImage(canvas, 0, 0, quarter.width, quarter.height);
  return quarter.toDataURL('image/webp', 0.3);
}


// ── 맵 좌표 유틸리티 ────────────────────────────────────────────

function getZoomContainer() {
  var m = document.querySelector('.movable');
  return m ? m.parentElement : null;
}

var _cachedZoom = 1;
var _zoomDirty = true;

function getZoomScale() {
  if (_zoomDirty) {
    var zoomEl = getZoomContainer();
    if (zoomEl) {
      var t = zoomEl.style.transform || '';
      var m = t.match(/matrix\(([^,]+)/);
      if (m) { _cachedZoom = parseFloat(m[1]); }
      else {
        var ct = getComputedStyle(zoomEl).transform;
        if (ct && ct !== 'none') {
          var cm = ct.match(/matrix\(([^,]+)/);
          if (cm) _cachedZoom = parseFloat(cm[1]);
          else _cachedZoom = 1;
        } else { _cachedZoom = 1; }
      }
    } else { _cachedZoom = 1; }
    _zoomDirty = false;
  }
  return _cachedZoom;
}

function _invalidateZoomCache() {
  _zoomDirty = true;
}

// 필드 영역(채팅 드로어 제외) 가로 중앙 px 계산
function _getFieldCenter() {
  var boardRight = window.innerWidth;
  // 1순위: MUI Drawer paper (showPlacementHelp과 동일 셀렉터)
  var paper = document.querySelector('.MuiDrawer-paperAnchorDockedRight')
    || document.querySelector('.MuiDrawer-paperAnchorRight')
    || document.querySelector('.MuiDrawer-paper');
  if (paper) {
    var r = paper.getBoundingClientRect();
    if (r.width > 50 && r.left > 0 && r.left < window.innerWidth) {
      boardRight = r.left;
    }
  }
  // 2순위: textarea 기준 역추적
  if (boardRight === window.innerWidth) {
    var ta = document.querySelector('textarea[name="text"]');
    if (ta) {
      var ancestor = ta.parentElement;
      while (ancestor && ancestor !== document.body) {
        var ar = ancestor.getBoundingClientRect();
        if (ar.width > 50 && ar.width < window.innerWidth * 0.6
            && ar.right >= window.innerWidth - 5 && ar.left > 0) {
          boardRight = ar.left;
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }
  }
  return boardRight / 2;
}
window.BWBR_getFieldCenter = _getFieldCenter;

// ── 드로어 열림/닫힘 감시 → 센터 재계산 ───────────────────────
var _lastFC = null;
var _fcTimer = null;

function _onFieldCenterChanged() {
  if (_confirmBar && _confirmBar.classList.contains('bwbr-place-confirm-bar--visible')) {
    _confirmBar.style.left = _getFieldCenter() + 'px';
  }
  if (_alignBar && _alignBar.classList.contains('bwbr-place-align-bar--visible')) {
    _alignBar.style.left = _getFieldCenter() + 'px';
  }
  // 토스트 컨테이너도 갱신 (fab-buttons.js)
  var toastBox = document.getElementById('bwbr-fab-toast-container');
  if (toastBox) {
    toastBox.style.left = _getFieldCenter() + 'px';
  }
}

function _startFieldCenterMonitor() {
  if (_fcTimer) return;
  _lastFC = _getFieldCenter();
  _fcTimer = setInterval(function() {
    var fc = _getFieldCenter();
    if (fc !== _lastFC) {
      _lastFC = fc;
      _onFieldCenterChanged();
    }
  }, 400);
  window.addEventListener('resize', function() {
    var fc = _getFieldCenter();
    if (fc !== _lastFC) {
      _lastFC = fc;
      _onFieldCenterChanged();
    }
  });
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


// ── 복사/붙여넣기 ──────────────────────────────────────────────

function copySelected() {
  if (_state.selectedStagedIds.length === 0) return;
  _state.clipboard = [];
  _state.selectedStagedIds.forEach(function(id) {
    var obj = _state.stagedObjects.find(function(o) { return o.id === id; });
    if (obj) _state.clipboard.push(cloneObj(obj));
  });
}

function pasteClipboard() {
  if (_state.clipboard.length === 0) return;
  deselectStaged();
  var newIds = [];
  _state.clipboard.forEach(function(snap) {
    var obj = cloneObj(snap);
    obj.id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    // 1타일 오프셋
    obj.mapCoords.x += 1;
    obj.mapCoords.y += 1;
    _state.stagedObjects.push(obj);
    renderStagedItem(obj);
    newIds.push(obj.id);
    // 자동 선택
    _state.selectedStagedIds.push(obj.id);
    var el = document.querySelector('[data-staged-id="' + obj.id + '"]');
    if (el) el.classList.add('bwbr-staged-item--selected');
  });
  pushUndo({ type: 'stage', ids: newIds });
  renumberStagedBadges();
  updateConfirmBar();
  updateAlignBar();
}


// ── 키보드 단축키 ───────────────────────────────────────────────

function setupKeyboard() {
  // Alt+- 글로벌 단축키: 배치 모드 토글 (배치 모드 비활성 상태에서도 작동)
  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === '-' || e.key === '–')) {
      // 입력 필드에서는 무시
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      togglePlacementMode();
    }
  }, false);

  document.addEventListener('keydown', function (e) {
    if (!_state.active) return;

    // ── 텍스트 편집 중: ESC만 처리, 나머지는 브라우저에 위임 ──
    if (_state.textEditing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finishTextEditing(false);
      }
      // Ctrl+B/I/U 등은 contentEditable 네이티브 처리에 위임
      return;
    }

    // Ctrl+Z/C/V: capture 단계에서 네이티브 차단
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (_state.currentTool === 'draw' && _drawCanvas) { undoDrawStroke(); } else { undo(); }
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault(); e.stopImmediatePropagation();
        copySelected(); return;
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault(); e.stopImmediatePropagation();
        pasteClipboard(); return;
      }
    }

    // Escape: 단계별 취소 (입력 중에도 동작)
    if (e.key === 'Escape') {
      if (_state.placing) {
        _state.placing = false;
        _preview.classList.remove('bwbr-placement-preview--visible', 'bwbr-placement-preview--text');
        _preview.innerHTML = '';
      } else if ((_state.lastStampSize || _shapeLastStampSize) && _state.mode === 'edit') {
        // 스탬프 모드 해제
        _state.lastStampSize = null;
        _shapeLastStampSize = null;
        _shapePendingDataUrl = null;
        _preview.classList.remove('bwbr-placement-preview--visible');
        _preview.innerHTML = '';
      } else if (_state.selectedStagedIds.length > 0) {
        deselectStaged();
        updateAlignBar();
      } else if (_state.stagedObjects.length > 0) {
        clearAllStaged();
        _state.undoStack = [];
      } else if (_state.mode === 'edit') {
        activateMode('select');
      } else {
        togglePlacementMode();
      }
      return;
    }

    // 입력 필드에서는 나머지 단축키 무시
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    // V: 선택 모드
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      activateMode('select');
      return;
    }

    // I / T / D: 편집 모드 서브 도구 (어떤 모드에서든 편집 모드로 전환)
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      if (_state.mode !== 'edit') activateMode('edit', true);
      setSubTool('image'); return;
    }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      if (_state.mode !== 'edit') activateMode('edit', true);
      setSubTool('text'); return;
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (_state.mode !== 'edit') activateMode('edit', true);
      setSubTool('shape'); return;
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      if (_state.mode !== 'edit') activateMode('edit', true);
      setSubTool('draw'); return;
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
  }, true);
}

var _angleTimeout = null;

function showAngleIndicator(angle) {
  _angleIndicator.textContent = angle + '°';

  // 선택된 오브젝트 근처에 표시
  var positioned = false;
  if (_state.selectedStagedIds.length > 0) {
    var lastId = _state.selectedStagedIds[_state.selectedStagedIds.length - 1];
    var el = document.querySelector('[data-staged-id="' + lastId + '"]');
    if (el) {
      var r = el.getBoundingClientRect();
      _angleIndicator.style.left = (r.left + r.width / 2) + 'px';
      _angleIndicator.style.top = (r.top - 30) + 'px';
      _angleIndicator.style.transform = 'translateX(-50%)';
      positioned = true;
    }
  }
  if (!positioned) {
    var fc = _getFieldCenter();
    _angleIndicator.style.left = fc + 'px';
    _angleIndicator.style.top = '50%';
    _angleIndicator.style.transform = 'translate(-50%, -50%)';
  }

  _angleIndicator.classList.add('bwbr-placement-angle-indicator--visible');
  clearTimeout(_angleTimeout);
  _angleTimeout = setTimeout(function () {
    _angleIndicator.classList.remove('bwbr-placement-angle-indicator--visible');
  }, 1200);
}


// ── 미들클릭 패닝 (코어 기능 — 배치 모드 여부 무관) ─────────────

function setupMiddleClickPanning() {
  // MAIN world 스크립트 주입 — Object.defineProperty는 같은 JS world에서만 적용됨
  // ccfolia React(MAIN world)의 n.nativeEvent.button을 0으로 위장하려면 MAIN world 실행 필요
  // ISOLATED world에서는 e.button이 원래 값(1)을 유지하므로 select/edit 핸들러가 자연스럽게 무시
  var script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/midpan-main.js');
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}


// ── 모듈 시작 ───────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
