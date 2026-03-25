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
  object-fit: cover;
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

/* ── 정렬 바 (상단 메뉴 아래 중앙) ────────────────── */

.bwbr-place-align-bar {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
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
  align-items: center;
  gap: 2px;
  background: #fff;
  border-radius: 8px;
  padding: 4px 6px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.18);
  z-index: 108;
  user-select: none;
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
}

.bwbr-text-toolbar-btn:hover {
  background: #f0f0f0;
}

.bwbr-text-toolbar-btn.bwbr-tb-active {
  background: #e0e7ff;
  color: #1a56db;
}

.bwbr-text-toolbar-sep {
  width: 1px;
  height: 20px;
  background: #ddd;
  margin: 0 3px;
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
}

.bwbr-text-toolbar-color:hover {
  background: #f0f0f0;
}

.bwbr-text-toolbar-color input[type=color] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}

.bwbr-text-toolbar-select {
  height: 28px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  padding: 0 4px;
  outline: none;
  cursor: pointer;
  background: #fff;
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
var _textSettingsMenu = null;
var _confirmBar = null;
var _stagedCountEl = null;


// ── 초기화 ──────────────────────────────────────────────────────

function init() {
  createToolbar();
  createOverlay();
  createConfirmBar();
  createAlignBar();
  registerFabButton();
  setupMiddleClickPanning();  // 미들클릭 핸들러 먼저 (capture phase 우선순위)
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
    activateMode('select');
    showPlacementHelp();
    _startStagingGuard();
  } else {
    _toolbar.classList.remove('bwbr-placement-toolbar--open');
    deactivateMode();
    clearAllStaged();
    _state.undoStack = [];
    _state.clipboard = [];
    updatePlacementCursor();
    hidePlacementHelp();
    _stopStagingGuard();
  }
}


// ── 배치 모드 안내 패널 (드로어 좌측 슬라이드인) ─────────────────

var _placementHelp = null;

function showPlacementHelp() {
  if (_placementHelp) return;

  var paper = document.querySelector('.MuiDrawer-paperAnchorDockedRight')
    || document.querySelector('.MuiDrawer-paperAnchorRight')
    || document.querySelector('.MuiDrawer-paper');
  if (!paper) return;

  var paperLeft = paper.getBoundingClientRect().left;

  _placementHelp = document.createElement('div');
  _placementHelp.id = 'bwbr-placement-help';
  _placementHelp.style.cssText =
    'position:fixed;top:140px;' +
    'left:' + paperLeft + 'px;' +
    'transform:translateX(0);' +
    'z-index:10;width:220px;' +
    'background:rgba(255,255,255,0.96);color:#333;' +
    'border-radius:8px 0 0 8px;' +
    'box-shadow:-2px 0 16px rgba(0,0,0,0.15);' +
    'font-family:"Roboto","Helvetica","Arial",sans-serif;' +
    'font-size:12px;line-height:1.7;' +
    'pointer-events:auto;' +
    'border:1px solid rgba(0,0,0,0.08);border-right:none;' +
    'opacity:0;overflow:hidden;box-sizing:border-box;' +
    'transition:transform 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease, width 0.35s cubic-bezier(0.2,0.8,0.3,1);';

  _placementHelp.innerHTML =
    '<div id="bwbr-place-help-content" style="padding:14px 18px;white-space:nowrap;transition:opacity 0.25s;">' +
      '<div style="font-size:13px;font-weight:bold;margin-bottom:8px;color:#42a5f5;">' +
      '\uD83D\uDDBC\uFE0F 배치 모드</div>' +
      '<div style="margin-bottom:4px;"><b>V</b> — 선택 모드</div>' +
      '<div style="margin-bottom:4px;"><b>A</b> — 편집 모드</div>' +
      '<div style="margin-bottom:4px;"><b>I / T / D</b> — 이미지 / 텍스트 / 그리기</div>' +
      '<div style="margin-bottom:4px;">\uD83D\uDDB1\uFE0F <b>드래그</b> — 영역 지정 배치</div>' +
      '<div style="margin-bottom:4px;">\uD83D\uDDB1\uFE0F <b>클릭</b> — 스탬프 반복</div>' +
      '<div style="margin-bottom:4px;"><b>R / Shift+R</b> — 선택 회전</div>' +
      '<div style="margin-bottom:4px;"><b>Del</b> — 선택 삭제</div>' +
      '<div style="margin-bottom:4px;"><b>Ctrl+Z/C/V</b> — 되돌리기/복사/붙여넣기</div>' +
      '<div style="margin-bottom:4px;"><b>Alt+드래그</b> — 범위 선택 / 복사</div>' +
      '<div style="margin-bottom:0;opacity:0.5;font-size:11px;margin-top:6px;">' +
      'Esc로 단계별 취소 · 중클릭 패닝</div>' +
    '</div>' +
    '<div id="bwbr-place-help-tab" style="position:absolute;top:0;left:0;right:0;bottom:0;' +
    'display:flex;align-items:center;justify-content:center;' +
    'writing-mode:vertical-rl;font-size:11px;font-weight:bold;color:#42a5f5;' +
    'letter-spacing:2px;cursor:pointer;' +
    'opacity:0;pointer-events:none;transition:opacity 0.25s;">\uD83D\uDDBC\uFE0F 배치</div>';

  paper.appendChild(_placementHelp);

  // 클릭으로 접기/펼치기
  _placementHelp.addEventListener('click', function () {
    if (_placementHelp.style.width === '28px') {
      expandPlacementHelp();
    } else {
      collapsePlacementHelp();
    }
  });

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (_placementHelp) {
        _placementHelp.style.opacity = '1';
        _placementHelp.style.transform = 'translateX(-100%)';
      }
    });
  });

  // 3초 후 자동 접기
  setTimeout(function () { collapsePlacementHelp(); }, 3000);
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
  _placementHelp.style.width = '220px';
  _placementHelp.style.opacity = '1';
  _placementHelp.style.cursor = 'default';
  if (tab) { tab.style.opacity = '0'; tab.style.pointerEvents = 'none'; }
  if (content) {
    setTimeout(function () { content.style.opacity = '1'; }, 150);
  }
}

function hidePlacementHelp() {
  if (!_placementHelp) return;
  _placementHelp.style.opacity = '0';
  _placementHelp.style.transform = 'translateX(0)';
  var panel = _placementHelp;
  _placementHelp = null;
  setTimeout(function () { panel.remove(); }, 450);
}


// ── 모드 전환 (선택 / 추가) ─────────────────────────────────────

function activateMode(mode) {
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
      _subToolButtons[k].classList.remove('bwbr-place-subtool-btn--active');
    });
    // 선택 모드: 설정 패널 닫기
    _settingsPanel.classList.remove('bwbr-place-settings--open');
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    if (_textSettingsMenu) _textSettingsMenu.style.display = 'none';
  } else if (mode === 'edit') {
    // 편집 모드: 설정 패널 열기
    _settingsPanel.classList.add('bwbr-place-settings--open');
    // 이전 도구 복원
    if (_state.lastTool) {
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
    _subToolButtons[k].classList.remove('bwbr-place-subtool-btn--active');
  });
  _overlay.classList.remove('bwbr-placement-overlay--active');
  _preview.classList.remove('bwbr-placement-preview--visible');
  _settingsPanel.classList.remove('bwbr-place-settings--open');
  updatePlacementCursor();
  updateAlignBar();
}

function setSubTool(toolId) {
  Object.keys(_subToolButtons).forEach(function(k) {
    _subToolButtons[k].classList.remove('bwbr-place-subtool-btn--active');
  });

  if (_state.currentTool === toolId) {
    _state.currentTool = null;
    _overlay.classList.remove('bwbr-placement-overlay--active');
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    if (_textSettingsMenu) _textSettingsMenu.style.display = 'none';
    updatePlacementCursor();
    return;
  }

  _state.currentTool = toolId;
  _subToolButtons[toolId].classList.add('bwbr-place-subtool-btn--active');

  if (toolId === 'image') {
    if (_imageSourceMenu) _imageSourceMenu.style.display = '';
    if (_textSettingsMenu) _textSettingsMenu.style.display = 'none';
    _overlay.classList.add('bwbr-placement-overlay--active');
  } else if (toolId === 'text') {
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    if (_textSettingsMenu) _textSettingsMenu.style.display = '';
    _overlay.classList.add('bwbr-placement-overlay--active');
  } else {
    if (_imageSourceMenu) _imageSourceMenu.style.display = 'none';
    if (_textSettingsMenu) _textSettingsMenu.style.display = 'none';
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

  // 모드 버튼 (column-reverse: 배열 첫번째=맨 아래, 마지막=맨 위)
  var modes = [
    { id: 'select', label: '선택 (V)', icon: MODE_ICONS.select },
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

  // 텍스트 설정 메뉴 (텍스트 도구용)
  _textSettingsMenu = createTextSettingsMenu();
  panel.appendChild(_textSettingsMenu);

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
  notice.style.cssText = 'text-align:center;padding:16px 12px;color:#888;font-size:13px;line-height:1.6;';
  notice.innerHTML = '<div style="font-size:20px;margin-bottom:6px;">\uD83D\uDCDD</div>' +
    '<b>텍스트 도구</b><br>' +
    '<span style="font-size:11px;opacity:0.7;">오버레이에서 드래그하여<br>텍스트 영역을 지정하세요</span>';
  menu.appendChild(notice);

  return menu;
}


// ── 텍스트 편집기 (Phase 2: area-first WYSIWYG) ────────────────

var _textEditorWrap = null; // 외부 래퍼 (zoom container 내 position:absolute)
var _textEditor = null;    // contentEditable div
var _textToolbar = null;   // 서식 바
var _textMapCoords = null; // 편집 시작 시점의 맵 좌표 (패닝/줌 드리프트 방지)
var _textBgColor = '';     // 텍스트 박스 배경색 ('' = 투명)
var _textAlign = 'left';   // 수평 정렬: left / center / right
var _textVAlign = 'top';   // 수직 정렬: top / middle / bottom
var _reopenedObj = null;   // 재편집 시 원본 객체 (ESC로 복원용)
var _tbPosRaf = null;      // 툴바 위치 추적 rAF

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
  _textEditorWrap.appendChild(_textEditor);

  // 서식 바 (screen 좌표 — body에 부착)
  _textToolbar = createTextToolbar();
  document.body.appendChild(_textToolbar);
  _startToolbarPosTracker();

  // 포커스
  _textEditor.focus();

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
    var barH = 40;
    var y = r.top - barH - 4;
    if (y < 4) y = r.bottom + 4;
    _textToolbar.style.left = r.left + 'px';
    _textToolbar.style.top = y + 'px';
    _tbPosRaf = requestAnimationFrame(tick);
  }
  _tbPosRaf = requestAnimationFrame(tick);
}

function _stopToolbarPosTracker() {
  if (_tbPosRaf) { cancelAnimationFrame(_tbPosRaf); _tbPosRaf = null; }
}

function createTextToolbar() {
  var bar = document.createElement('div');
  bar.className = 'bwbr-text-toolbar';

  // Bold
  var btnB = _makeToolbarBtn('B', 'bold', '볼드 (Ctrl+B)');
  btnB.style.fontWeight = 'bold';
  bar.appendChild(btnB);

  // Italic
  var btnI = _makeToolbarBtn('I', 'italic', '이탤릭 (Ctrl+I)');
  btnI.style.fontStyle = 'italic';
  bar.appendChild(btnI);

  // Underline
  var btnU = _makeToolbarBtn('U', 'underline', '밑줄 (Ctrl+U)');
  btnU.style.textDecoration = 'underline';
  bar.appendChild(btnU);

  // Strikethrough
  var btnS = _makeToolbarBtn('S', 'strikethrough', '취소선');
  btnS.style.textDecoration = 'line-through';
  bar.appendChild(btnS);

  bar.appendChild(_makeToolbarSep());

  // Font color
  var fgWrap = document.createElement('div');
  fgWrap.className = 'bwbr-text-toolbar-color';
  _setTooltip(fgWrap, '글자 색상');
  var fgInput = document.createElement('input');
  fgInput.type = 'color';
  fgInput.value = '#000000';
  fgInput.addEventListener('input', function () {
    document.execCommand('foreColor', false, fgInput.value);
    _textEditor.focus();
  });
  var fgLabel = document.createElement('span');
  fgLabel.textContent = 'A';
  fgLabel.style.cssText = 'font-weight:bold;pointer-events:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:14px;';
  fgWrap.appendChild(fgInput);
  fgWrap.appendChild(fgLabel);
  bar.appendChild(fgWrap);

  // Background color
  var bgWrap = document.createElement('div');
  bgWrap.className = 'bwbr-text-toolbar-color';
  _setTooltip(bgWrap, '배경 색상');
  var bgInput = document.createElement('input');
  bgInput.type = 'color';
  bgInput.value = '#ffff00';
  bgInput.addEventListener('input', function () {
    document.execCommand('hiliteColor', false, bgInput.value);
    _textEditor.focus();
  });
  var bgLabel = document.createElement('span');
  bgLabel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z"/></svg>';
  bgLabel.style.cssText = 'pointer-events:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;';
  bgWrap.appendChild(bgInput);
  bgWrap.appendChild(bgLabel);
  bar.appendChild(bgWrap);

  bar.appendChild(_makeToolbarSep());

  // Font size
  var sizeSelect = document.createElement('select');
  sizeSelect.className = 'bwbr-text-toolbar-select';
  _setTooltip(sizeSelect, '글꼴 크기');
  [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s + 'px';
    if (s === 16) opt.selected = true;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.addEventListener('change', function () {
    _applyFontSize(sizeSelect.value);
    _textEditor.focus();
  });
  bar.appendChild(sizeSelect);

  bar.appendChild(_makeToolbarSep());

  // 수평 정렬 (좌/가운데/우)
  var alignBtns = [
    { val: 'left', icon: '\u2261', tip: '왼쪽 정렬' },
    { val: 'center', icon: '\u2263', tip: '가운데 정렬' },
    { val: 'right', icon: '\u2262', tip: '오른쪽 정렬' }
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
    bar.appendChild(btn);
  });

  // 수직 정렬 (상/중/하)
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
    bar.appendChild(btn);
  });

  bar.appendChild(_makeToolbarSep());

  // Text box background color
  var boxBgWrap = document.createElement('div');
  boxBgWrap.className = 'bwbr-text-toolbar-color';
  _setTooltip(boxBgWrap, '텍스트 박스 배경색 (우클릭: 투명)');
  var boxBgInput = document.createElement('input');
  boxBgInput.type = 'color';
  boxBgInput.value = '#ffffff';
  boxBgInput.addEventListener('input', function () {
    _textBgColor = boxBgInput.value;
    if (_textEditorWrap) _textEditorWrap.style.background = boxBgInput.value;
  });
  boxBgInput.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    _textBgColor = '';
    if (_textEditorWrap) _textEditorWrap.style.background = 'transparent';
  });
  var boxBgLabel = document.createElement('span');
  boxBgLabel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>';
  boxBgLabel.style.cssText = 'pointer-events:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;';
  boxBgWrap.appendChild(boxBgInput);
  boxBgWrap.appendChild(boxBgLabel);
  bar.appendChild(boxBgWrap);

  bar.appendChild(_makeToolbarSep());

  // Confirm
  var btnOk = document.createElement('button');
  btnOk.className = 'bwbr-text-toolbar-btn bwbr-text-toolbar-confirm';
  btnOk.textContent = '\u2713';
  _setTooltip(btnOk, '확인');
  btnOk.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btnOk.addEventListener('click', function () { finishTextEditing(true); });
  bar.appendChild(btnOk);

  // Cancel
  var btnX = document.createElement('button');
  btnX.className = 'bwbr-text-toolbar-btn bwbr-text-toolbar-cancel';
  btnX.textContent = '\u2715';
  _setTooltip(btnX, '취소 (Esc)');
  btnX.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btnX.addEventListener('click', function () { finishTextEditing(false); });
  bar.appendChild(btnX);

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

function _applyFontSize(px) {
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  var range = sel.getRangeAt(0);
  if (range.collapsed) {
    // 커서만 있을 때 → 이후 입력에 적용되도록 빈 span 삽입
    var span = document.createElement('span');
    span.style.fontSize = px + 'px';
    span.appendChild(document.createTextNode('\u200B')); // zero-width space
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  var span2 = document.createElement('span');
  span2.style.fontSize = px + 'px';
  try {
    range.surroundContents(span2);
  } catch (ex) {
    // 복합 노드 선택 시 fallback
    var frag = range.extractContents();
    span2.appendChild(frag);
    range.insertNode(span2);
  }
  sel.removeAllRanges();
  var nr = document.createRange();
  nr.selectNodeContents(span2);
  sel.addRange(nr);
}

function positionTextToolbar() {
  // 이제 _startToolbarPosTracker()로 rAF 기반 추적 (패닝/줌 추종)
}

function _onTextClickOutside(e) {
  if (!_textEditor) return;
  if (e.button !== 0) return; // 좌클릭만 외부 클릭으로 인식
  if (_textEditorWrap && _textEditorWrap.contains(e.target)) return;
  if (_textToolbar && _textToolbar.contains(e.target)) return;
  finishTextEditing(true);
}

function finishTextEditing(confirm) {
  document.removeEventListener('mousedown', _onTextClickOutside, true);

  if (confirm && _textEditor && _textEditor.textContent.trim() && _textMapCoords) {
    var mapCoords = _textMapCoords;

    // 에디터 높이가 입력으로 변경됐을 수 있으므로 현재 높이로 mapCoords 갱신
    // 에디터는 zoom container 내부 → scrollHeight가 이미 언스케일드 px
    var actualH = _textEditor.scrollHeight;
    mapCoords.height = Math.max(1, Math.ceil(actualH / CELL_PX));

    var dataUrl = renderTextEditorToCanvas();
    if (dataUrl) {
      readSettingsFromDOM();
      var obj = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        mapCoords: mapCoords,
        angle: 0,
        imageDataUrl: dataUrl,
        textHtml: _textEditor ? _textEditor.innerHTML : '',
        textBgColor: _textBgColor,
        textAlign: _textAlign,
        textVAlign: _textVAlign,
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
  _stopToolbarPosTracker();
  if (_textEditorWrap) { _textEditorWrap.remove(); _textEditorWrap = null; }
  _textEditor = null;
  if (_textToolbar) { _textToolbar.remove(); _textToolbar = null; }
  _textMapCoords = null;
  _textBgColor = '';
  _textAlign = 'left';
  _textVAlign = 'top';
  _state.textEditing = false;
  // 오버레이 복원
  if (_overlay) _overlay.style.pointerEvents = '';
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
  var defaultFamily = edCS.fontFamily || 'sans-serif';

  var runs = [];
  _extractRuns(_textEditor, {
    fontSize: defaultFS, fontWeight: 'normal', fontStyle: 'normal',
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
    var fontStr = (run.fontStyle === 'italic' ? 'italic ' : '') +
                  (run.fontWeight === 'bold' ? 'bold ' : '') +
                  fs + 'px ' + defaultFamily;
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
      ctx.fillText(c.ch, x, y + (lineH - c.fs) / 2);

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

function _extractRuns(node, style, runs) {
  if (node.nodeType === 3) {
    var txt = node.textContent;
    if (txt) runs.push({ text: txt, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle, color: style.color, bgColor: style.bgColor, underline: style.underline, strikethrough: style.strikethrough });
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
  if (_state.placing) {
    _state.drag.currentX = e.clientX;
    _state.drag.currentY = e.clientY;
    updatePreview();
    return;
  }
  // 스탬프 미리보기: 드래그 중이 아닐 때 이전 크기로 커서 위치에 표시 (이미지 전용)
  if (_state.lastStampSize && _state.mode === 'edit' && _state.currentTool === 'image') {
    if (_state.pendingImage) {
      var sw = _state.lastStampSize.w;
      var sh = _state.lastStampSize.h;
      _preview.style.left = (e.clientX - sw / 2) + 'px';
      _preview.style.top = (e.clientY - sh / 2) + 'px';
      _preview.style.width = sw + 'px';
      _preview.style.height = sh + 'px';
      _preview.style.transform = '';
      if (!_preview.classList.contains('bwbr-placement-preview--visible')) {
        _preview.classList.add('bwbr-placement-preview--visible');
        _preview.innerHTML = '<img src="' + _state.pendingImage.dataUrl + '" alt="">';
      }
    }
  }
}

function onOverlayMouseUp(e) {
  // Alt 범위 선택 완료
  if (_altBoxSelect.active) {
    finishAltBoxSelect();
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
    // 클릭(드래그 없음) → 스탬프 모드: 이전 크기로 배치
    if (_state.lastStampSize && _state.currentTool === 'image' && _state.pendingImage) {
      var sw = _state.lastStampSize.w;
      var sh = _state.lastStampSize.h;
      var stampRect = {
        x: _state.drag.startX - sw / 2,
        y: _state.drag.startY - sh / 2,
        w: sw,
        h: sh
      };
      deselectStaged();
      stageObject(stampRect);
      // 스탬프 미리보기 유지 (다음 클릭을 위해)
      _preview.classList.add('bwbr-placement-preview--visible');
      if (!_preview.querySelector('img')) {
        _preview.innerHTML = '<img src="' + _state.pendingImage.dataUrl + '" alt="">';
      }
    }
    return;
  }

  // 드래그 배치 → 크기 저장 (스탬프 모드용)
  _state.lastStampSize = { w: rect.w, h: rect.h };

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

  console.log('[CE 배치] 스테이징:', screenRect, '→ 타일:', mapCoords);
  console.log('[CE 배치] panelSettings:', JSON.stringify(_state.panelSettings));

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
  console.log('[CE 배치] zoom 컨테이너 교체 감지, 스테이징 아이템 재부착');
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

  startTextEditing(rect);

  // Restore content + bgColor
  if (_textEditor) {
    _textEditor.innerHTML = obj.textHtml;
    if (obj.textBgColor) {
      _textBgColor = obj.textBgColor;
      if (_textEditorWrap) _textEditorWrap.style.background = obj.textBgColor;
    }
  }
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
    origH: obj.mapCoords.height
  };

  function onMove(ev) {
    if (!_resizeDrag) return;
    var scale = getZoomScale();
    var dx = Math.round((ev.clientX - _resizeDrag.startX) / (scale * CELL_PX));
    var dy = Math.round((ev.clientY - _resizeDrag.startY) / (scale * CELL_PX));
    var d = _resizeDrag.dir;
    var nx = _resizeDrag.origX, ny = _resizeDrag.origY;
    var nw = _resizeDrag.origW, nh = _resizeDrag.origH;

    if (d.indexOf('w') >= 0) { nx += dx; nw -= dx; }
    if (d.indexOf('e') >= 0) { nw += dx; }
    if (d.indexOf('n') >= 0) { ny += dy; nh -= dy; }
    if (d.indexOf('s') >= 0) { nh += dy; }

    if (nw < 1) { nw = 1; nx = _resizeDrag.origX + _resizeDrag.origW - 1; }
    if (nh < 1) { nh = 1; ny = _resizeDrag.origY + _resizeDrag.origH - 1; }

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
  if (found) console.log('[CE 배치] 선택:', _state.selectedStagedIds.length + '개');
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

  // 배치 모드 중 ccfolia 패닝 방지 (capture phase에서 pointer 이벤트 차단)
  document.addEventListener('pointerdown', function(e) {
    if (!e.isTrusted) return;
    if (!_state.active || e.button !== 0) return;
    if (e.target.closest('.bwbr-placement-toolbar') ||
        e.target.closest('.bwbr-place-confirm-bar') || e.target.closest('.bwbr-place-align-bar')) return;

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
        e.target.closest('.bwbr-placement-overlay')) return; // 오버레이 클릭은 통과 (배치 동작)

    // 리사이즈 핸들 클릭: 핸들 자체 mousedown이 처리하도록 통과
    // 패닝 차단은 pointerdown capture에서 이미 처리됨
    if (e.target.closest('.bwbr-resize-handle')) return;

    // 스테이징 아이템 클릭: 기존 핸들러 대신 여기서 직접 호출
    var stagedEl = e.target.closest('.bwbr-staged-item');
    if (stagedEl) {
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
    if (_altBoxSelect.active || _selectDrag.dragging) { e.stopImmediatePropagation(); }
    // 편집 모드: 오버레이 드래그 중 패닝 차단
    if (_state.mode === 'edit' && _state.placing) { e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('pointerup', function(e) {
    if (!e.isTrusted) return;
    if (_altBoxSelect.active || _selectDrag.dragging) { e.stopImmediatePropagation(); }
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
    // 수평 중앙: 화면 왼쪽 ~ 우측 채팅 드로어 사이의 보드 영역 기준
    var boardRight = window.innerWidth;
    var drawers = document.querySelectorAll('[class*="MuiDrawer"]');
    drawers.forEach(function(d) {
      var r = d.getBoundingClientRect();
      // 화면 안에 보이는 우측 드로어 (left < viewport, right > 0, width > 50)
      if (r.left > 0 && r.left < window.innerWidth && r.width > 50 && r.right <= window.innerWidth + 5) {
        boardRight = Math.min(boardRight, r.left);
      }
    });
    _alignBar.style.left = (boardRight / 2) + 'px';
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
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault(); e.stopImmediatePropagation();
        undo(); return;
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
      } else if (_state.lastStampSize && _state.mode === 'edit') {
        // 스탬프 모드 해제
        _state.lastStampSize = null;
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

    // A: 편집 모드 토글
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      activateMode('edit');
      return;
    }

    // I / T / D: 편집 모드 서브 도구 (어떤 모드에서든 편집 모드로 전환)
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      if (_state.mode !== 'edit') activateMode('edit');
      setSubTool('image'); return;
    }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      if (_state.mode !== 'edit') activateMode('edit');
      setSubTool('text'); return;
    }
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      if (_state.mode !== 'edit') activateMode('edit');
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
  _angleIndicator.style.left = '50%';
  _angleIndicator.style.top = '50%';
  _angleIndicator.style.transform = 'translate(-50%, -50%)';
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
