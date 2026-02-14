// ============================================================
// Branch World Battle Roll - Background Service Worker
// 확장 프로그램 설치, 설정 초기화, 메시지 라우팅
// ============================================================

// ── 설치 / 업데이트 ───────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[BWBR] 확장 프로그램 설치 완료');

    // 기본 설정 저장
    chrome.storage.sync.set({
      bwbr_config: null  // null = 기본값 사용
    });
  } else if (details.reason === 'update') {
    console.log('[BWBR] 확장 프로그램 업데이트: ' + details.previousVersion + ' → ' + chrome.runtime.getManifest().version);
  }
});

// ── 메시지 라우팅 (popup ↔ content) ───────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // popup → content 메시지 전달
  if (message.target === 'content') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ error: '활성 탭을 찾을 수 없습니다.' });
      }
    });
    return true; // 비동기 응답
  }

  // content → popup 메시지 전달 (필요 시)
  if (message.target === 'popup') {
    // popup이 열려 있으면 전달
    chrome.runtime.sendMessage(message).catch(() => {
      // popup이 닫혀 있으면 무시
    });
  }
});

// ── 탭 업데이트 시 상태 확인 ──────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('ccfolia.com')) {
    console.log('[BWBR] 코코포리아 탭 감지:', tab.url);
  }
});
