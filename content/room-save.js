/**
 * room-save.js — 방 입장 시 방 이름 + 방문 시간을 chrome.storage.local에 저장
 * 코코포리아 방(/rooms/*) 페이지에서만 실행됩니다.
 */
(async function () {
  const roomUrl = window.location.href;
  const targetSelector = 'h6[class*="MuiTypography-subtitle2"]';

  function saveRoomInfo(name) {
    chrome.storage.local.get({ bwbrRoomHistory: {} }, data => {
      const map = data.bwbrRoomHistory;
      const existing = map[roomUrl] || {};
      map[roomUrl] = {
        ...existing,
        name,
        lastVisitTime: Date.now()
      };
      if (!map[roomUrl].memo) map[roomUrl].memo = '';
      chrome.storage.local.set({ bwbrRoomHistory: map });
    });
  }

  function findAndSave() {
    const found = document.querySelector(targetSelector);
    if (found) {
      const textNode = Array.from(found.childNodes).find(
        c => c.nodeType === Node.TEXT_NODE && c.textContent.trim() !== ''
      );
      if (textNode) {
        saveRoomInfo(textNode.textContent.trim());
        return true;
      }
    }
    return false;
  }

  const interval = setInterval(() => {
    if (findAndSave()) {
      clearInterval(interval);
    }
  }, 1000);
})();
