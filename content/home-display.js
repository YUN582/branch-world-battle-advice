/**
 * home-display.js — 코코포리아 홈 페이지에 최근 방문 기록 표시
 * SPA 내비게이션을 감지하여 홈으로 돌아올 때마다 렌더링합니다.
 */
(function () {
  let styleInjected = false;

  async function getRoomData() {
    return new Promise(r =>
      chrome.storage.local.get({ bwbrRoomHistory: {} }, data => r(data.bwbrRoomHistory))
    );
  }

  async function setRoomData(roomData) {
    return new Promise(r =>
      chrome.storage.local.set({ bwbrRoomHistory: roomData }, r)
    );
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
    // 홈이 아니면 기존 컨테이너만 제거하고 리턴
    if (!isHomePage()) {
      const existing = document.getElementById('bwbr-visit-history-container');
      if (existing) existing.remove();
      return;
    }

    injectStyles();

    // 설정 확인
    const settings = await new Promise(r =>
      chrome.storage.sync.get('bwbr_config', data => r(data.bwbr_config))
    );
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
  }

  // ★ SPA 내비게이션 감지: URL 폴링 (content script에서 pushState 훅이 안 먹힘)
  let lastUrl = location.href;
  setInterval(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      setTimeout(renderVisitHistory, 500);
    }
  }, 500);

  // 초기 렌더링
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderVisitHistory());
  } else {
    renderVisitHistory();
  }

  // storage 변경 감지
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.bwbr_config) {
      if (isHomePage()) renderVisitHistory();
    }
    if (areaName === 'local' && changes.bwbrRoomHistory) {
      if (isHomePage()) renderVisitHistory();
    }
  });
})();
