// ============================================================
// Ccofolia Extension - 화면 표시 스케일링 (스탠딩 / 대화창)
// 캐릭터 스탠딩(토큰)과 채팅 말풍선(대화창)의 크기를 확대/축소합니다.
// ============================================================

(function () {
  'use strict';

  const STYLE_ID = 'bwbr-display-scale-style';

  // ── 현재 스케일 값 ──
  let _standingScale = 1.0;
  let _chatBubbleScale = 1.0;

  // ── 발견된 셀렉터 캐시 ──
  let _chatBubbleSelector = null;

  /**
   * 채팅 말풍선(대화창) DOM 요소를 탐지합니다.
   * ccfolia의 대화창은 하단에 고정된 styled-components 기반 요소입니다.
   * 
   * 탐지 전략:
   * 1. 화면 하단 (bottom < 150px)에 위치한 fixed/absolute 요소
   * 2. 닫기(✕) 버튼과 재생(▶) 버튼이 포함됨
   * 3. MuiDrawer 외부에 위치 (채팅 사이드바가 아님)
   * 4. sc-* 클래스를 가짐 (styled-components)
   */
  function discoverChatBubble() {
    // 이미 발견했으면 유효성 체크만
    if (_chatBubbleSelector) {
      const el = document.querySelector(_chatBubbleSelector);
      if (el && el.isConnected) return _chatBubbleSelector;
      _chatBubbleSelector = null;
    }

    // 전략 1: 커스텀 data 속성이 이미 마킹된 경우
    const marked = document.querySelector('[data-bwbr-chat-bubble]');
    if (marked && marked.isConnected) {
      _chatBubbleSelector = '[data-bwbr-chat-bubble]';
      return _chatBubbleSelector;
    }

    // 전략 2: 화면 하단에 fixed/absolute로 배치된 말풍선 탐지
    // ccfolia 대화창 특징: 하단 고정, 닫기(✕) 버튼 포함, #root의 직계 자손
    const root = document.getElementById('root');
    if (!root) return null;

    // root 직접 자식 중 sc-* 클래스를 가진 것을 탐색
    // (MuiDrawer, MuiAppBar는 MUI 클래스로 구분 가능)
    const candidates = root.querySelectorAll(':scope > div');
    for (const el of candidates) {
      // MUI 컴포넌트 제외
      if (el.className && (
        el.className.includes('Mui') ||
        el.id === 'bwbr-panel'
      )) continue;

      const rect = el.getBoundingClientRect();
      // 화면 하단 배치 확인 (bottom이 뷰포트 하단 근처)
      if (rect.bottom < window.innerHeight * 0.7) continue;
      if (rect.width < 200 || rect.height < 40) continue;

      // 닫기 버튼(✕ 또는 SVG close) 확인
      const buttons = el.querySelectorAll('button, [role="button"]');
      const hasCloseBtn = Array.from(buttons).some(btn => {
        const text = btn.textContent || '';
        const svg = btn.querySelector('svg');
        return text.includes('✕') || text.includes('×') || text.includes('close') || svg;
      });

      if (hasCloseBtn && buttons.length >= 1) {
        el.setAttribute('data-bwbr-chat-bubble', 'true');
        _chatBubbleSelector = '[data-bwbr-chat-bubble]';
        return _chatBubbleSelector;
      }
    }

    // 전략 3: form 요소를 기준으로 거슬러 올라가서 탐색
    // ccfolia 채팅 입력 form의 형제 또는 부모 요소에 대화창이 있을 수 있음
    // (대화창은 채팅 영역과 별개의 위치에 렌더링됨)

    return null;
  }

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

    // ── 캐릭터 스탠딩(토큰) 스케일 ──
    // .movable 자체는 position transform이 있으므로 내부 콘텐츠를 스케일합니다.
    // .movable 내부의 직접 자식 div(토큰 렌더 컨테이너)를 확대합니다.
    if (standingScale !== 1.0) {
      css += `
        .movable > div {
          transform: scale(${standingScale});
          transform-origin: bottom center;
        }
      `;
    }

    // ── 채팅 말풍선(대화창) 스케일 ──
    if (chatBubbleScale !== 1.0) {
      const selector = discoverChatBubble();
      if (selector) {
        css += `
          ${selector} {
            transform: scale(${chatBubbleScale}) !important;
            transform-origin: bottom center;
          }
        `;
      }
    }

    styleEl.textContent = css;
  }

  /**
   * 주기적으로 채팅 말풍선을 재탐지합니다.
   * (React 재렌더링으로 DOM이 교체될 수 있음)
   */
  function startBubbleWatcher() {
    // 말풍선이 필요한 경우에만 감시
    if (_chatBubbleScale === 1.0) return;

    const observer = new MutationObserver(() => {
      if (!_chatBubbleSelector || !document.querySelector(_chatBubbleSelector)) {
        _chatBubbleSelector = null;
        // 재탐지 후 CSS 갱신
        const found = discoverChatBubble();
        if (found) {
          applyScale(_standingScale, _chatBubbleScale);
        }
      }
    });

    const root = document.getElementById('root');
    if (root) {
      observer.observe(root, { childList: true, subtree: false });
    }

    // 초기 탐지 시도 (대화창은 메시지가 있어야 나타남)
    // 3초 간격으로 최대 10회 재시도
    let retries = 0;
    const retryInterval = setInterval(() => {
      if (_chatBubbleSelector || retries >= 10) {
        clearInterval(retryInterval);
        return;
      }
      const found = discoverChatBubble();
      if (found) {
        applyScale(_standingScale, _chatBubbleScale);
        clearInterval(retryInterval);
      }
      retries++;
    }, 3000);
  }

  /**
   * 스케일 설정을 업데이트합니다.
   * @param {number} standingScale - 캐릭터 스탠딩 스케일 (0.5~3.0)
   * @param {number} chatBubbleScale - 채팅 말풍선 스케일 (0.5~3.0)
   */
  function updateScale(standingScale, chatBubbleScale) {
    const ss = Math.max(0.5, Math.min(3.0, standingScale || 1.0));
    const cs = Math.max(0.5, Math.min(3.0, chatBubbleScale || 1.0));
    applyScale(ss, cs);

    // 말풍선 감시 시작 (필요 시)
    if (cs !== 1.0) {
      startBubbleWatcher();
    }
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
    _chatBubbleSelector = null;
  }

  // ── 공개 API ──
  window.BWBR_DisplayScale = {
    updateScale,
    getScale,
    removeScale,
    discoverChatBubble
  };

})();
