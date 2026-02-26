// ============================================================
// Branch World Battle Roll - Background Service Worker
// 확장 프로그램 설치, 설정 초기화, 메시지 라우팅, 업데이트 확인
// ============================================================

const UPDATE_CHECK_URL = 'https://api.github.com/repos/YUN582/branch-world-battle-advice/contents/manifest.json';
const GITHUB_REPO_URL = 'https://github.com/YUN582/branch-world-battle-advice';
const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4시간

// content script에서 chrome.storage.session 접근 허용 (서비스 워커 시작 시마다 보장)
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

// ── 설치 / 업데이트 ───────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {

  if (details.reason === 'install') {
    console.log('[BWBR] 확장 프로그램 설치 완료');
    chrome.storage.sync.set({ bwbr_config: null });
    // 설치 직후 업데이트 확인
    checkForUpdate();
  } else if (details.reason === 'update') {
    console.log('[BWBR] 확장 프로그램 업데이트: ' + details.previousVersion + ' → ' + chrome.runtime.getManifest().version);
    // 업데이트 후 이전 알림 초기화
    chrome.storage.local.remove('bwbr_update');
    chrome.action.setBadgeText({ text: '' });
  }
});

// ── 브라우저 시작 시 업데이트 확인 ─────────────────────────

chrome.runtime.onStartup.addListener(() => {
  checkForUpdate();
});

// ── 주기적 업데이트 확인 (알람) ────────────────────────────

chrome.alarms.create('bwbr-update-check', {
  delayInMinutes: 5,          // 시작 5분 후 첫 체크
  periodInMinutes: 4 * 60     // 4시간마다
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bwbr-update-check') {
    checkForUpdate();
  }
});

// ── 업데이트 확인 로직 ─────────────────────────────────────

async function checkForUpdate() {
  try {
    const localVersion = chrome.runtime.getManifest().version;
    
    const response = await fetch(UPDATE_CHECK_URL + '?t=' + Date.now(), {
      cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    
    const data = await response.json();
    // GitHub API는 파일 내용을 base64로 인코딩해서 반환함
    const content = atob(data.content);
    const remoteManifest = JSON.parse(content);
    const remoteVersion = remoteManifest.version;
    
    if (isNewerVersion(remoteVersion, localVersion)) {
      const updateInfo = {
        available: true,
        remoteVersion: remoteVersion,
        localVersion: localVersion,
        checkedAt: Date.now(),
        repoUrl: GITHUB_REPO_URL
      };
      await chrome.storage.local.set({ bwbr_update: updateInfo });
      
      // 배지 표시
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ffab40' });
      
      console.log('[BWBR] 업데이트 가능: v' + localVersion + ' → v' + remoteVersion);
      return updateInfo;
    } else {
      // 최신 버전이면 알림 제거
      await chrome.storage.local.remove('bwbr_update');
      chrome.action.setBadgeText({ text: '' });
      return { available: false, isLatest: true };
    }
  } catch (err) {
    console.warn('[BWBR] 업데이트 확인 실패:', err.message);
    return { available: false, error: err.message };
  }
}

/**
 * 버전 비교: remoteVersion > localVersion 이면 true
 * 예: "0.9.1" > "0.9.0" → true
 */
function isNewerVersion(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

// ── 메시지 라우팅 (popup ↔ content) ───────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 업데이트 확인 요청 (popup → background)
  if (message.type === 'BWBR_CHECK_UPDATE') {
    checkForUpdate().then((result) => {
      if (result && result.available) {
        sendResponse(result);
      } else {
        sendResponse({ available: false, isLatest: true });
      }
    });
    return true;
  }

  // 업데이트 알림 해제
  if (message.type === 'BWBR_DISMISS_UPDATE') {
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
    return;
  }

  // popup → content 메시지 전달
  if (message.target === 'content') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          // content script가 없는 탭에서 발생하는 lastError 억제
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
            return;
          }
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
