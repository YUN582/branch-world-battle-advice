// ============================================================
// Ccofolia Extension - BGM 미리듣기 플레이어
// BGM 편집 팝오버의 "미리듣기" 버튼을 시크바 포함 오디오 플레이어로 교체
// ============================================================

(function () {
  'use strict';

  const PLAYER_ID = 'bwbr-bgm-player';
  let _audio = null;
  let _rafId = null;
  let _currentPopover = null;

  // ── 스타일 주입 ──────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('bwbr-bgm-player-style')) return;
    const style = document.createElement('style');
    style.id = 'bwbr-bgm-player-style';
    style.textContent = `
      .bwbr-bgm-player {
        display: flex;
        flex-direction: column;
        width: 100%;
        box-sizing: border-box;
        margin: 4px 0 16px 0;
        padding: 0 4px;
      }
      .bwbr-bgm-player-row {
        display: flex;
        align-items: center;
        gap: 16px;
        width: 100%;
      }
      .bwbr-bgm-play-btn {
        width: 24px; height: 24px;
        border: none; background: none;
        cursor: pointer; padding: 0;
        display: flex; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.7);
        border-radius: 50%;
        transition: color 0.15s;
        flex-shrink: 0;
      }
      .bwbr-bgm-play-btn:hover {
        color: #fff;
      }
      .bwbr-bgm-play-btn svg {
        width: 24px; height: 24px;
        fill: currentColor;
      }
      .bwbr-bgm-seekbar-wrap {
        flex: 1;
        height: 24px;
        display: flex;
        align-items: center;
        cursor: pointer;
        position: relative;
        touch-action: none;
        user-select: none;
      }
      .bwbr-bgm-seekbar-rail {
        position: absolute;
        left: 0; right: 0;
        height: 2px;
        border-radius: 1px;
        background: rgba(255,255,255,0.3);
      }
      .bwbr-bgm-seekbar-track {
        position: absolute;
        left: 0;
        height: 2px;
        border-radius: 1px;
        background: #3fa2f6;
        pointer-events: none;
      }
      .bwbr-bgm-seekbar-thumb {
        position: absolute;
        width: 14px; height: 14px;
        border-radius: 50%;
        background: #3fa2f6;
        transform: translate(-50%, -50%);
        top: 50%;
        pointer-events: none;
        box-shadow: 0px 1px 3px rgba(0,0,0,0.4);
        transition: box-shadow 0.15s;
      }
      .bwbr-bgm-seekbar-wrap:hover .bwbr-bgm-seekbar-thumb,
      .bwbr-bgm-seekbar-wrap.seeking .bwbr-bgm-seekbar-thumb {
        box-shadow: 0 0 0 8px rgba(63, 162, 246, 0.16);
      }
      .bwbr-bgm-time {
        font-size: 14px;
        font-family: inherit;
        color: rgba(255,255,255,0.85);
        white-space: nowrap;
        min-width: 40px;
        text-align: right;
        flex-shrink: 0;
        user-select: none;
        line-height: 1;
      }
      .bwbr-bgm-loading {
        font-size: 12px;
        color: rgba(255,255,255,0.5);
        text-align: center;
        padding: 4px 0;
      }
      .bwbr-bgm-stop-btn {
        width: 24px; height: 24px;
        border: none; background: none;
        cursor: pointer; padding: 0;
        display: flex; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.5);
        border-radius: 50%;
        transition: color 0.15s;
        flex-shrink: 0;
      }
      .bwbr-bgm-stop-btn:hover {
        color: #fff;
      }
      .bwbr-bgm-stop-btn svg {
        width: 14px; height: 14px;
        fill: currentColor;
      }
    `;
    document.head.appendChild(style);
  }

  // ── 유틸리티 ─────────────────────────────────────────────

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  const SVG_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const SVG_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  const SVG_STOP = '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>';

  // ── 플레이어 UI 빌드 ────────────────────────────────────

  function buildPlayer(container, audioUrl, volume) {
    // 기존 플레이어 제거
    cleanupAudio();
    const existing = document.getElementById(PLAYER_ID);
    if (existing) existing.remove();

    injectStyles();

    const player = document.createElement('div');
    player.className = 'bwbr-bgm-player';
    player.id = PLAYER_ID;

    _audio = new Audio();
    _audio.crossOrigin = 'anonymous';
    _audio.preload = 'auto';
    _audio.volume = Math.max(0, Math.min(1, volume || 0.5));
    _audio.src = audioUrl;

    // 로딩 표시
    const loading = document.createElement('div');
    loading.className = 'bwbr-bgm-loading';
    loading.textContent = '로딩 중...';
    player.appendChild(loading);
    
    // sliderContainer 바로 위에 삽입
    container.parentNode.insertBefore(player, container);

    let uiBuilt = false;
    function onReady() {
      if (uiBuilt) return;
      uiBuilt = true;
      loading.remove();
      buildPlayerControls(player);
      // 자동 재생
      if (_audio) _audio.play().catch(() => {});
    }

    _audio.addEventListener('loadedmetadata', onReady);
    _audio.addEventListener('canplay', onReady);
    _audio.addEventListener('error', () => {
      loading.textContent = '오디오 로드 실패';
    });
  }

  function buildPlayerControls(player) {
    if (!_audio) return;

    const row = document.createElement('div');
    row.className = 'bwbr-bgm-player-row';

    // Play/Pause 버튼
    const playBtn = document.createElement('button');
    playBtn.className = 'bwbr-bgm-play-btn';
    playBtn.type = 'button';
    playBtn.innerHTML = SVG_PAUSE; // 자동재생이므로 일시정지 아이콘으로 시작
    playBtn.title = '일시정지';

    // 시크바
    const seekWrap = document.createElement('div');
    seekWrap.className = 'bwbr-bgm-seekbar-wrap';

    const rail = document.createElement('div');
    rail.className = 'bwbr-bgm-seekbar-rail';
    const track = document.createElement('div');
    track.className = 'bwbr-bgm-seekbar-track';
    const thumb = document.createElement('div');
    thumb.className = 'bwbr-bgm-seekbar-thumb';

    seekWrap.appendChild(rail);
    seekWrap.appendChild(track);
    seekWrap.appendChild(thumb);

    // 시간 표시
    const timeEl = document.createElement('span');
    timeEl.className = 'bwbr-bgm-time';
    const dur = _audio.duration || 0;
    timeEl.textContent = '0:00 / ' + formatTime(dur);

    // 정지 버튼
    const stopBtn = document.createElement('button');
    stopBtn.className = 'bwbr-bgm-stop-btn';
    stopBtn.type = 'button';
    stopBtn.innerHTML = SVG_STOP;
    stopBtn.title = '정지';

    row.appendChild(playBtn);
    row.appendChild(seekWrap);
    row.appendChild(timeEl);
    row.appendChild(stopBtn);
    player.appendChild(row);

    // ── 상태 관리 ──

    let seeking = false;

    function updateUI() {
      if (!_audio) return;
      const cur = _audio.currentTime || 0;
      const total = _audio.duration || 1;
      const pct = Math.min(100, (cur / total) * 100);

      if (!seeking) {
        track.style.width = pct + '%';
        thumb.style.left = pct + '%';
      }
      timeEl.textContent = formatTime(cur) + ' / ' + formatTime(total);

      if (!_audio.paused) {
        _rafId = requestAnimationFrame(updateUI);
      }
    }

    // Play/Pause
    playBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!_audio) return;

      if (_audio.paused) {
        _audio.play().catch(() => {});
      } else {
        _audio.pause();
      }
    });

    // Stop
    stopBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!_audio) return;
      _audio.pause();
      _audio.currentTime = 0;
      track.style.width = '0%';
      thumb.style.left = '0%';
      timeEl.textContent = '0:00 / ' + formatTime(_audio.duration || 0);
    });

    _audio.addEventListener('ended', () => {
      playBtn.innerHTML = SVG_PLAY;
      playBtn.title = '재생';
      track.style.width = '0%';
      thumb.style.left = '0%';
      _audio.currentTime = 0;
      timeEl.textContent = '0:00 / ' + formatTime(_audio.duration || 0);
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    });

    _audio.addEventListener('pause', () => {
      playBtn.innerHTML = SVG_PLAY;
      playBtn.title = '재생';
    });

    _audio.addEventListener('play', () => {
      playBtn.innerHTML = SVG_PAUSE;
      playBtn.title = '일시정지';
      _rafId = requestAnimationFrame(updateUI);
    });

    // ── 시크바 드래그 ──

    function seekFromEvent(e) {
      const rect = seekWrap.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    seekWrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      seeking = true;
      seekWrap.classList.add('seeking');
      seekWrap.setPointerCapture(e.pointerId);
      const pct = seekFromEvent(e);
      track.style.width = (pct * 100) + '%';
      thumb.style.left = (pct * 100) + '%';
    });

    seekWrap.addEventListener('pointermove', (e) => {
      if (!seeking) return;
      const pct = seekFromEvent(e);
      track.style.width = (pct * 100) + '%';
      thumb.style.left = (pct * 100) + '%';
      if (_audio && isFinite(_audio.duration)) {
        timeEl.textContent = formatTime(pct * _audio.duration) + ' / ' + formatTime(_audio.duration);
      }
    });

    seekWrap.addEventListener('pointerup', (e) => {
      if (!seeking) return;
      seeking = false;
      seekWrap.classList.remove('seeking');
      const pct = seekFromEvent(e);
      if (_audio && isFinite(_audio.duration)) {
        _audio.currentTime = pct * _audio.duration;
      }
      if (_audio && !_audio.paused) {
        _rafId = requestAnimationFrame(updateUI);
      }
    });

    seekWrap.addEventListener('pointercancel', () => {
      seeking = false;
      seekWrap.classList.remove('seeking');
    });

    // 시작 시 updateUI 1회
    _rafId = requestAnimationFrame(updateUI);

    // 볼륨 슬라이더 연동 (팝오버 내 MUI 슬라이더 변경 감시)
    if (_currentPopover) {
      const volInput = _currentPopover.querySelector('input[name="volume"]');
      if (volInput) {
        const volObs = new MutationObserver(() => {
          if (_audio) {
            _audio.volume = Math.max(0, Math.min(1, parseFloat(volInput.value) || 0.5));
          }
        });
        volObs.observe(volInput, { attributes: true, attributeFilter: ['value', 'aria-valuenow'] });
      }
    }
  }

  // ── Redux에서 BGM URL 가져오기 ─────────────────────────

  function getAudioUrlForItem(name) {
    return new Promise((resolve) => {
      let settled = false;
      const handler = () => {
        if (settled) return;
        settled = true;
        const raw = document.documentElement.getAttribute('data-bwbr-bgm-url-result');
        document.documentElement.removeAttribute('data-bwbr-bgm-url-result');
        document.removeEventListener('bwbr-bgm-url-result', handler);
        try {
          const data = JSON.parse(raw);
          resolve(data.url || null);
        } catch (e) {
          resolve(null);
        }
      };
      document.addEventListener('bwbr-bgm-url-result', handler);
      document.documentElement.setAttribute('data-bwbr-bgm-url-request', JSON.stringify({ name }));
      document.dispatchEvent(new CustomEvent('bwbr-bgm-url-request'));

      // 타임아웃
      setTimeout(() => {
        if (settled) return;
        settled = true;
        document.removeEventListener('bwbr-bgm-url-result', handler);
        resolve(null);
      }, 3000);
    });
  }

  // ── 정리 ────────────────────────────────────────────────

  function cleanupAudio() {
    if (_audio) {
      _audio.pause();
      _audio.removeAttribute('src');
      _audio.load();
      _audio = null;
    }
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
  }

  function cleanup() {
    cleanupAudio();
    const existing = document.getElementById(PLAYER_ID);
    if (existing) existing.remove();
    _currentPopover = null;
  }

  // ── BGM 편집 팝오버 감지 & 미리듣기 버튼 교체 ─────────

  function tryEnhancePopover(popoverNode) {
    // double-rAF로 React 렌더 완료 대기
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!popoverNode || !document.contains(popoverNode)) return;

      // 미리듣기 버튼 찾기
      const buttons = popoverNode.querySelectorAll('button');
      let previewBtn = null;

      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text === '미리듣기') previewBtn = btn;
      }

      if (!previewBtn) return;

      // name 입력 필드가 있는 form 확인 (BGM 편집 팝오버 특징)
      const form = popoverNode.querySelector('form');
      if (!form) return;
      const nameInput = form.querySelector('input[name="name"]');
      if (!nameInput) return;

      // 볼륨 슬라이더 확인 (추가 검증)
      const volInput = form.querySelector('input[name="volume"]');
      if (!volInput) return;
      const sliderContainer = volInput.closest('.sc-fpAljo') || volInput.parentNode;

      _currentPopover = popoverNode;

      async function injectPlayer() {
        const name = nameInput.value?.trim();
        if (!name) return;

        // 이미 플레이어가 있으면 스킵
        const existingPlayer = document.getElementById(PLAYER_ID);
        if (existingPlayer) return;

        const volume = parseFloat(volInput.value) || 0.5;
        const url = await getAudioUrlForItem(name);

        if (!url) return;

        // 사운드 음량바 위에 재생바 넣기
        buildPlayer(sliderContainer, url, volume);
        
        // 미리듣기 버튼은 숨기기
        previewBtn.style.display = 'none';
      }

      injectPlayer();
    }));
  }

  // ── body MutationObserver — 팝오버 등장 감지 ─────────

  function init() {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList?.contains?.('MuiPopover-root') ||
              node.getAttribute?.('role') === 'presentation') {
            tryEnhancePopover(node);
          }
        }
        // Popover 제거 시 정리
        for (const node of m.removedNodes) {
          if (node.nodeType !== 1) continue;
          if (node === _currentPopover ||
              (node.classList?.contains?.('MuiPopover-root') && _currentPopover && !document.contains(_currentPopover))) {
            cleanup();
          }
        }
      }
    });
    obs.observe(document.body, { childList: true });
  }

  // document.body가 존재하면 바로 시작, 아니면 대기
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  // 전역 공개
  window.BWBR_BgmPlayer = {
    cleanup: cleanup
  };
})();
