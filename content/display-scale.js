// ============================================================
// Ccofolia Extension - 화면 표시 스케일링 (대화창 / 스탠딩)
// 채팅 대화창(말풍선)과 그 안의 스탠딩 이미지 크기를 조절합니다.
//
// DOM 구조 (2026-03-10 진단):
//   sc-geBDJh (뷰포트)
//   └─ MuiPaper-root.MuiPaper-elevation6 (대화창, position:absolute, z:102)
//      ├─ IMG (스탠딩 이미지)
//      └─ MuiPaper-root (텍스트 컨테이너)
//         └─ P.MuiTypography-body1 (메시지 텍스트)
// ============================================================

(function () {
  'use strict';

  const STYLE_ID = 'bwbr-display-scale-style';

  // ── 현재 스케일 값 ──
  let _standingScale = 1.0;
  let _chatBubbleScale = 1.0;

  /**
   * 대화창(말풍선) DOM 셀렉터
   * MuiPaper-elevation6 + position:absolute + 높은 z-index
   * sc-* 클래스는 빌드마다 변경되므로 MUI 클래스만 사용
   */
  const CHAT_BUBBLE_SELECTOR = '.MuiPaper-root.MuiPaper-elevation6[class*="sc-"]';

  /**
   * 스케일 CSS를 주입/갱신합니다.
   */
  function applyScale(standingScale, chatBubbleScale) {
    _standingScale = standingScale;
    _chatBubbleScale = chatBubbleScale;

    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }

    let css = '';

    // ── 대화창(말풍선) 전체 스케일 ──
    // position: absolute + z-index: 102인 MuiPaper-elevation6
    if (chatBubbleScale !== 1.0) {
      css += `
        ${CHAT_BUBBLE_SELECTOR} {
          transform: scale(${chatBubbleScale});
          transform-origin: bottom center;
        }
      `;
    }

    // ── 대화창 내 스탠딩 이미지 스케일 ──
    // 대화창 직접 자식 또는 손자 img
    if (standingScale !== 1.0) {
      css += `
        ${CHAT_BUBBLE_SELECTOR} > img,
        ${CHAT_BUBBLE_SELECTOR} > div > img {
          transform: scale(${standingScale});
          transform-origin: bottom center;
        }
      `;
    }

    styleEl.textContent = css;
  }

  /**
   * 스케일 설정을 업데이트합니다.
   * @param {number} standingScale - 스탠딩 이미지 스케일 (0.5~3.0)
   * @param {number} chatBubbleScale - 대화창 스케일 (0.5~3.0)
   */
  function updateScale(standingScale, chatBubbleScale) {
    const ss = Math.max(0.5, Math.min(3.0, standingScale || 1.0));
    const cs = Math.max(0.5, Math.min(3.0, chatBubbleScale || 1.0));
    applyScale(ss, cs);
  }

  /**
   * 현재 스케일 값을 반환합니다.
   */
  function getScale() {
    return { standingScale: _standingScale, chatBubbleScale: _chatBubbleScale };
  }

  /**
   * 설정을 완전히 제거합니다. (스케일 1.0으로 복원)
   */
  function removeScale() {
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.textContent = '';
    _standingScale = 1.0;
    _chatBubbleScale = 1.0;
  }

  // ── 공개 API ──
  window.BWBR_DisplayScale = {
    updateScale,
    getScale,
    removeScale,
    CHAT_BUBBLE_SELECTOR
  };

})();
