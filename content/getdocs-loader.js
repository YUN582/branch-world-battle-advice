// ============================================================
// [CORE] getDocs 인터셉터 로더
// document_start에 실행되어 ccfolia보다 먼저 Firestore getDocs를 래핑합니다.
// ============================================================
(function () {
  'use strict';
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/getdocs-interceptor.js');
  (document.documentElement || document).appendChild(script);
  script.remove();
})();
