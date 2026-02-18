// ============================================================
// Branch World Battle Roll - 사이트 음량 컨트롤러 (로더)
// document_start 에 실행되어 코코포리아보다 먼저 오디오 API를 패치합니다.
// 실제 패치 코드는 site-volume-page.js에 있으며, CSP를 우회하기 위해
// script.src 방식으로 주입합니다.
// ============================================================

(function () {
  'use strict';

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/site-volume-page.js');

  // document_start 시점에서는 documentElement만 존재
  (document.documentElement || document).appendChild(script);
  script.remove();
})();
