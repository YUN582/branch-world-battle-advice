/**
 * home-display.js — 코코포리아 홈 페이지에 최근 방문 기록 표시
 * SPA 내비게이션을 감지하여 홈으로 돌아올 때마다 렌더링합니다.
 */
(function () {
  let styleInjected = false;

  // 안전한 chrome.storage 래퍼 (컨텍스트 무효화 대응)
  function safeStorageGet(area, key, fallback) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(fallback), 3000);
      try {
        chrome.storage[area].get(key, data => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) { resolve(fallback); return; }
          resolve(typeof key === 'string' ? data[key] : data[Object.keys(key)[0]]);
        });
      } catch { clearTimeout(timer); resolve(fallback); }
    });
  }

  function safeStorageSet(area, obj) {
    return new Promise(resolve => {
      try {
        chrome.storage[area].set(obj, () => resolve());
      } catch { resolve(); }
    });
  }

  async function getRoomData() {
    return safeStorageGet('local', { bwbrRoomHistory: {} }, {});
  }

  async function setRoomData(roomData) {
    return safeStorageSet('local', { bwbrRoomHistory: roomData });
  }

  function isHomePage() {
    const path = window.location.pathname;
    return path === '/' || path === '/home' || path.startsWith('/home');
  }

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;
    const styles = `
    #bwbr-visit-history-container {
      margin-top: 20px;
    }
    #bwbr-visit-history-container h6 {
      color: #ccc;
      margin: 24px 16px 8px;
      font-size: 14px;
      font-weight: 500;
    }
    #bwbr-visit-history-container ul {
      list-style: none;
      margin: 0 16px;
      padding: 0;
      border: 1px solid #444;
      border-radius: 8px;
      overflow: hidden;
    }
    #bwbr-visit-history-container li {
      padding: 12px 16px;
      border-bottom: 1px solid #444;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #bwbr-visit-history-container li:last-child {
      border-bottom: none;
    }
    #bwbr-visit-history-container a {
      color: #fff;
      text-decoration: none;
      font-weight: 500;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #bwbr-visit-history-container a:hover {
      text-decoration: underline;
    }
    #bwbr-visit-history-container .bwbr-visit-time {
      color: #888;
      font-size: 12px;
      margin: 0 12px;
      white-space: nowrap;
    }
    #bwbr-visit-history-container .bwbr-del-btn {
      background: transparent;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 16px;
      padding: 0 4px;
    }
    #bwbr-visit-history-container .bwbr-del-btn:hover {
      color: #f44;
    }
    `;
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
  }

  function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}일 전`;
    const months = Math.floor(days / 30);
    return `${months}개월 전`;
  }

  async function renderVisitHistory() {
    try {
    // 홈이 아니면 기존 컨테이너만 제거하고 리턴
    if (!isHomePage()) {
      const existing = document.getElementById('bwbr-visit-history-container');
      if (existing) existing.remove();
      return;
    }

    injectStyles();

    // 설정 확인
    const settings = await safeStorageGet('sync', 'bwbr_config', null);
    const isVisible = settings?.general?.showVisitHistory !== false;

    // 기존 컨테이너 제거
    const existing = document.getElementById('bwbr-visit-history-container');
    if (existing) existing.remove();

    if (!isVisible) return;

    const map = await getRoomData();
    let rooms = Object.keys(map)
      .map(url => ({ url, name: map[url].name, time: map[url].lastVisitTime }))
      .sort((a, b) => b.time - a.time);

    if (rooms.length === 0) return;

    const container = document.createElement('div');
    container.id = 'bwbr-visit-history-container';

    const title = document.createElement('h6');
    title.textContent = '최근 방문 기록';
    container.appendChild(title);

    const listEl = document.createElement('ul');
    container.appendChild(listEl);

    function renderList() {
      listEl.innerHTML = '';
      rooms.slice(0, 5).forEach(({ url, name, time }) => {
        const li = document.createElement('li');

        const a = document.createElement('a');
        a.href = url;
        a.textContent = name || '이름 없는 방';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'bwbr-visit-time';
        timeSpan.textContent = formatRelativeTime(time);

        const delBtn = document.createElement('button');
        delBtn.className = 'bwbr-del-btn';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', async () => {
          if (confirm(`'${name || url}' 방문 기록을 삭제하시겠습니까?`)) {
            const allData = await getRoomData();
            delete allData[url];
            await setRoomData(allData);
            rooms = rooms.filter(r => r.url !== url);
            if (rooms.length === 0) {
              container.remove();
            } else {
              renderList();
            }
          }
        });

        li.appendChild(a);
        li.appendChild(timeSpan);
        li.appendChild(delBtn);
        listEl.appendChild(li);
      });
    }

    renderList();

    // 헤더 메뉴바(탭 네비게이션) 아래에 삽입
    const header = document.querySelector('header')
      || document.querySelector('[class*="MuiAppBar"]')
      || document.querySelector('nav');
    if (header && header.nextSibling) {
      header.parentElement.insertBefore(container, header.nextSibling);
    } else {
      // 폴백: body 맨 앞
      document.body.insertBefore(container, document.body.firstChild);
    }
    } catch (e) {
      console.warn('[BWBR home-display] renderVisitHistory 오류:', e);
    }
  }

  // ★ SPA 내비게이션 감지: pushState는 content script에서 훅 불가
  //   → popstate/hashchange 이벤트 + 2초 폴백 (500ms→2000ms 최적화)
  let lastUrl = location.href;
  function checkUrlChange() {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      setTimeout(renderVisitHistory, 500);
    }
  }
  window.addEventListener('popstate', checkUrlChange);
  window.addEventListener('hashchange', checkUrlChange);
  setInterval(checkUrlChange, 2000);

  // 초기 렌더링
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderVisitHistory());
  } else {
    renderVisitHistory();
  }

  // storage 변경 감지
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.bwbr_config) {
        if (isHomePage()) renderVisitHistory();
      }
      if (areaName === 'local' && changes.bwbrRoomHistory) {
        if (isHomePage()) renderVisitHistory();
      }
    });
  } catch { /* 컨텍스트 무효화 시 무시 */ }
})();
