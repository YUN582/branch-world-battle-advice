// ============================================================
// Ccofolia Extension - Audio Editor & Auto-Compressor
// BGM 업로드 인터셉트 → 파형 편집기 → 10MB 자동 압축 → 코코포리아 임포트
// ============================================================

(function () {
  'use strict';

  // ── 상수 ─────────────────────────────────────────────────
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const WAVEFORM_HEIGHT = 100;
  const WAVEFORM_COLORS = {
    bg: '#1a1a2e',
    wave: '#2196f3',
    waveLight: '#64b5f6',
    selection: 'rgba(33,150,243,0.25)',
    selectionBorder: '#2196f3',
    cursor: '#fff',
    handle: '#ff9800',
    grid: 'rgba(255,255,255,0.06)',
    text: 'rgba(255,255,255,0.5)',
  };

  let _interceptInstalled = false;
  let _editorOpen = false;
  let _pendingFiles = null; // 원본 파일 리스트
  let _currentFileInput = null; // 인터셉트한 file input 참조

  // ── 스타일 주입 ──────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('bwbr-audio-editor-style')) return;
    const s = document.createElement('style');
    s.id = 'bwbr-audio-editor-style';
    s.textContent = `
      /* === 에디터 오버레이 === */
      .bwbr-ae-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.7);
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .bwbr-ae-dialog {
        background: #1e1e2e; color: #e0e0e0;
        border-radius: 12px; width: 720px; max-width: 95vw;
        max-height: 90vh; overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      }
      .bwbr-ae-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .bwbr-ae-header h3 {
        margin: 0; font-size: 16px; font-weight: 600; color: #fff;
      }
      .bwbr-ae-close {
        background: none; border: none; color: rgba(255,255,255,0.5);
        font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 4px;
      }
      .bwbr-ae-close:hover { background: rgba(255,255,255,0.1); color: #fff; }

      /* === 파일 정보 === */
      .bwbr-ae-file-info {
        padding: 12px 20px; display: flex; gap: 16px; flex-wrap: wrap;
        font-size: 12px; color: rgba(255,255,255,0.5);
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .bwbr-ae-file-info span { white-space: nowrap; }
      .bwbr-ae-file-info .warn { color: #ff9800; font-weight: 600; }
      .bwbr-ae-file-info .ok { color: #4caf50; }

      /* === 파형 캔버스 === */
      .bwbr-ae-waveform-wrap {
        position: relative; margin: 16px 20px; height: ${WAVEFORM_HEIGHT}px;
        background: ${WAVEFORM_COLORS.bg}; border-radius: 8px; overflow: hidden;
        cursor: crosshair; user-select: none; touch-action: none;
      }
      .bwbr-ae-waveform-wrap canvas {
        display: block; width: 100%; height: 100%;
      }
      /* 선택 영역 오버레이 */
      .bwbr-ae-selection {
        position: absolute; top: 0; bottom: 0;
        background: ${WAVEFORM_COLORS.selection};
        border-left: 2px solid ${WAVEFORM_COLORS.selectionBorder};
        border-right: 2px solid ${WAVEFORM_COLORS.selectionBorder};
        pointer-events: none;
      }
      /* 재생 커서 */
      .bwbr-ae-cursor {
        position: absolute; top: 0; bottom: 0; width: 2px;
        background: ${WAVEFORM_COLORS.cursor};
        pointer-events: none; transform: translateX(-1px);
      }
      /* 트림 핸들 */
      .bwbr-ae-handle {
        position: absolute; top: 0; bottom: 0; width: 8px;
        cursor: ew-resize; z-index: 2;
      }
      .bwbr-ae-handle::after {
        content: ''; position: absolute; top: 50%; transform: translateY(-50%);
        width: 4px; height: 24px; border-radius: 2px;
        background: ${WAVEFORM_COLORS.handle};
      }
      .bwbr-ae-handle.left { left: 0; }
      .bwbr-ae-handle.left::after { left: 2px; }
      .bwbr-ae-handle.right { right: 0; }
      .bwbr-ae-handle.right::after { right: 2px; }

      /* 시간 라벨 */
      .bwbr-ae-time-labels {
        display: flex; justify-content: space-between;
        padding: 2px 20px 0; font-size: 11px; color: rgba(255,255,255,0.35);
        font-family: 'Roboto Mono', monospace;
      }

      /* === 컨트롤 바 === */
      .bwbr-ae-controls {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .bwbr-ae-btn {
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
        color: #e0e0e0; padding: 6px 14px; border-radius: 6px;
        font-size: 13px; cursor: pointer; white-space: nowrap;
        transition: background 0.15s;
      }
      .bwbr-ae-btn:hover { background: rgba(255,255,255,0.15); }
      .bwbr-ae-btn:disabled { opacity: 0.35; cursor: default; }
      .bwbr-ae-btn.primary {
        background: #2196f3; border-color: #2196f3; color: #fff;
      }
      .bwbr-ae-btn.primary:hover { background: #1e88e5; }
      .bwbr-ae-btn.danger { color: #ef5350; border-color: rgba(239,83,80,0.3); }
      .bwbr-ae-btn.danger:hover { background: rgba(239,83,80,0.12); }
      .bwbr-ae-play-btn {
        width: 36px; height: 36px; border-radius: 50%;
        background: #2196f3; border: none; color: #fff;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0;
      }
      .bwbr-ae-play-btn:hover { background: #1e88e5; }
      .bwbr-ae-play-btn svg { width: 18px; height: 18px; fill: currentColor; }
      .bwbr-ae-spacer { flex: 1; }
      .bwbr-ae-time-display {
        font-size: 12px; color: rgba(255,255,255,0.6);
        font-family: 'Roboto Mono', monospace; min-width: 100px;
        text-align: center;
      }

      /* === 편집 도구 === */
      .bwbr-ae-tools {
        display: flex; align-items: center; gap: 6px;
        padding: 8px 20px;
      }
      .bwbr-ae-tool-btn {
        background: none; border: 1px solid rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.6); padding: 5px 12px; border-radius: 5px;
        font-size: 12px; cursor: pointer; transition: all 0.15s;
      }
      .bwbr-ae-tool-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
      .bwbr-ae-tool-btn:disabled { opacity: 0.3; cursor: default; }
      .bwbr-ae-tool-btn .icon { margin-right: 4px; }

      /* === 프로그레스 === */
      .bwbr-ae-progress-wrap {
        padding: 16px 20px; display: none;
      }
      .bwbr-ae-progress-wrap.active { display: block; }
      .bwbr-ae-progress-bar {
        height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px;
        overflow: hidden;
      }
      .bwbr-ae-progress-fill {
        height: 100%; background: #2196f3; border-radius: 2px;
        transition: width 0.2s;
      }
      .bwbr-ae-progress-text {
        font-size: 12px; color: rgba(255,255,255,0.5);
        margin-top: 6px; text-align: center;
      }

      /* === 하단 액션 === */
      .bwbr-ae-footer {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.08);
      }
      .bwbr-ae-size-info {
        font-size: 12px; color: rgba(255,255,255,0.4);
      }
      .bwbr-ae-size-info .size { font-weight: 600; }
      .bwbr-ae-size-info .over { color: #ff9800; }
      .bwbr-ae-footer-btns { display: flex; gap: 8px; }

      /* === D&D 오버레이 === */
      .bwbr-ae-dropzone {
        position: absolute; inset: 0; z-index: 10;
        display: none; align-items: center; justify-content: center;
        background: rgba(33,150,243,0.08);
        border: 2px dashed rgba(33,150,243,0.4);
        border-radius: 8px; pointer-events: all;
      }
      .bwbr-ae-dropzone.active {
        display: flex;
      }
      .bwbr-ae-dropzone-text {
        color: #2196f3; font-size: 14px; font-weight: 500;
        pointer-events: none;
      }

      /* 멀티 파일 편집 탭 */
      .bwbr-ae-tabs {
        display: flex; gap: 0; padding: 0 20px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        overflow-x: auto;
      }
      .bwbr-ae-tab {
        padding: 8px 16px; font-size: 12px; cursor: pointer;
        color: rgba(255,255,255,0.5); border-bottom: 2px solid transparent;
        white-space: nowrap; transition: all 0.15s;
      }
      .bwbr-ae-tab:hover { color: rgba(255,255,255,0.8); }
      .bwbr-ae-tab.active {
        color: #2196f3; border-bottom-color: #2196f3;
      }
      .bwbr-ae-tab .size {
        margin-left: 6px; font-size: 10px; opacity: 0.6;
      }
    `;
    document.head.appendChild(s);
  }

  // ── 유틸리티 ─────────────────────────────────────────────

  const SVG_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const SVG_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ── AudioBuffer 유틸 ─────────────────────────────────────

  /** File/Blob → AudioBuffer */
  async function decodeFile(file) {
    const ctx = new AudioContext();
    try {
      const ab = await file.arrayBuffer();
      return await ctx.decodeAudioData(ab);
    } finally {
      ctx.close();
    }
  }

  /** AudioBuffer에서 피크 데이터 추출 (모노 다운믹스) */
  function extractPeaks(buffer, numBins) {
    const ch = buffer.numberOfChannels;
    const len = buffer.length;
    const step = Math.max(1, Math.floor(len / numBins));
    const peaks = new Float32Array(numBins);

    for (let b = 0; b < numBins; b++) {
      let max = 0;
      const start = b * step;
      const end = Math.min(start + step, len);
      for (let c = 0; c < ch; c++) {
        const data = buffer.getChannelData(c);
        for (let i = start; i < end; i++) {
          const v = Math.abs(data[i]);
          if (v > max) max = v;
        }
      }
      peaks[b] = max;
    }
    return peaks;
  }

  /** AudioBuffer 일부를 잘라 새 buffer 반환 (startSample ~ endSample) */
  function sliceBuffer(buffer, startSample, endSample) {
    const sr = buffer.sampleRate;
    const ch = buffer.numberOfChannels;
    const length = endSample - startSample;
    if (length <= 0) return null;

    const ctx = new OfflineAudioContext(ch, length, sr);
    const newBuf = ctx.createBuffer(ch, length, sr);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(c);
      const dst = newBuf.getChannelData(c);
      for (let i = 0; i < length; i++) {
        dst[i] = src[startSample + i];
      }
    }
    return newBuf;
  }

  /** AudioBuffer에서 선택 구간을 제거 (앞 + 뒤를 연결) */
  function removeSection(buffer, cutStart, cutEnd) {
    const sr = buffer.sampleRate;
    const ch = buffer.numberOfChannels;
    const beforeLen = cutStart;
    const afterLen = buffer.length - cutEnd;
    const newLen = beforeLen + afterLen;
    if (newLen <= 0) return null;

    const newBuf = new OfflineAudioContext(ch, newLen, sr).createBuffer(ch, newLen, sr);
    for (let c = 0; c < ch; c++) {
      const src = buffer.getChannelData(c);
      const dst = newBuf.getChannelData(c);
      // 앞 부분
      for (let i = 0; i < beforeLen; i++) dst[i] = src[i];
      // 뒷 부분
      for (let i = 0; i < afterLen; i++) dst[beforeLen + i] = src[cutEnd + i];
    }
    return newBuf;
  }

  // ── 인코딩: AudioBuffer → Blob ──────────────────────────

  /**
   * AudioBuffer를 Opus/WebM으로 인코딩. targetSize가 지정되면 이진탐색으로 최적 비트레이트 탐색.
   * @param {AudioBuffer} buffer
   * @param {number|null} targetSize - 목표 바이트 (null이면 기본 128kbps)
   * @param {function} onProgress - (0~1)
   * @returns {Promise<Blob>}
   */
  async function encodeAudioBuffer(buffer, targetSize, onProgress) {
    const duration = buffer.duration;

    // 비트레이트 계산. targetSize가 있으면 그에 맞춤
    let bitrate;
    if (targetSize) {
      // 비트 = bytes * 8, bps = bits / seconds
      bitrate = Math.floor((targetSize * 8) / duration * 0.92); // 약간 여유
      bitrate = clamp(bitrate, 16000, 320000);
    } else {
      bitrate = 128000;
    }

    return await _encodeWithBitrate(buffer, bitrate, onProgress);
  }

  /** 지정 비트레이트로 인코딩 */
  async function _encodeWithBitrate(buffer, bitrate, onProgress) {
    // OfflineAudioContext로 렌더링
    const ctx = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    const rendered = await ctx.startRendering();

    // 렌더된 AudioBuffer → MediaStream
    const streamCtx = new AudioContext({ sampleRate: rendered.sampleRate });
    const streamBuf = streamCtx.createBuffer(
      rendered.numberOfChannels,
      rendered.length,
      rendered.sampleRate
    );
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      streamBuf.getChannelData(c).set(rendered.getChannelData(c));
    }

    const streamSrc = streamCtx.createBufferSource();
    streamSrc.buffer = streamBuf;
    const dest = streamCtx.createMediaStreamDestination();
    streamSrc.connect(dest);

    return new Promise((resolve, reject) => {
      const chunks = [];
      let recorder;

      try {
        recorder = new MediaRecorder(dest.stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: bitrate,
        });
      } catch (e) {
        // 폴백: 기본 설정
        try {
          recorder = new MediaRecorder(dest.stream, {
            mimeType: 'audio/webm',
            audioBitsPerSecond: bitrate,
          });
        } catch (e2) {
          streamCtx.close();
          reject(new Error('MediaRecorder not supported for audio'));
          return;
        }
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        streamCtx.close();
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (onProgress) onProgress(1);
        resolve(blob);
      };

      recorder.onerror = (e) => {
        streamCtx.close();
        reject(e.error || new Error('Recording failed'));
      };

      // 진행률 시뮬레이션
      const totalMs = streamBuf.duration * 1000;
      const startTime = Date.now();
      let progressIv;
      if (onProgress) {
        progressIv = setInterval(() => {
          const elapsed = Date.now() - startTime;
          onProgress(clamp(elapsed / totalMs, 0, 0.95));
        }, 100);
      }

      streamSrc.start();
      recorder.start();

      // buffer 길이 + 200ms 여유 후 중지
      setTimeout(() => {
        if (progressIv) clearInterval(progressIv);
        if (recorder.state === 'recording') recorder.stop();
        streamSrc.stop?.();
      }, totalMs + 200);
    });
  }

  /**
   * 10MB 이하로 자동 압축 (이진 탐색)
   */
  async function autoCompress(buffer, originalFile, onProgress) {
    // 1) 먼저 원본 크기가 10MB 이하인지 확인
    if (originalFile.size <= MAX_FILE_SIZE) {
      if (onProgress) onProgress(1);
      return originalFile; // 압축 불필요
    }

    // 2) 이진 탐색으로 적절한 비트레이트 찾기
    const duration = buffer.duration;
    let lo = 32000;
    let hi = Math.min(320000, Math.floor((MAX_FILE_SIZE * 8) / duration * 0.95));
    let bestBlob = null;
    let attempts = 0;
    const maxAttempts = 5;

    if (onProgress) onProgress(0);

    while (attempts < maxAttempts && hi - lo > 4000) {
      const mid = Math.floor((lo + hi) / 2);
      const progress = attempts / maxAttempts;
      if (onProgress) onProgress(progress * 0.9);

      const blob = await _encodeWithBitrate(buffer, mid, null);

      if (blob.size <= MAX_FILE_SIZE) {
        bestBlob = blob;
        lo = mid + 1; // 더 높은 비트레이트 시도 가능
      } else {
        hi = mid - 1; // 비트레이트 낮춰야 함
      }
      attempts++;
    }

    // 최종: bestBlob이 없으면 lo로 한 번 더
    if (!bestBlob) {
      bestBlob = await _encodeWithBitrate(buffer, lo, null);
    }

    if (onProgress) onProgress(1);
    return bestBlob;
  }

  // ── 파형 렌더러 ──────────────────────────────────────────

  function drawWaveform(canvas, peaks, trimStart, trimEnd, selStart, selEnd) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const numBins = peaks.length;

    ctx.clearRect(0, 0, w, h);

    // 배경
    ctx.fillStyle = WAVEFORM_COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // 그리드 (시간 눈금)
    ctx.strokeStyle = WAVEFORM_COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const x = Math.round(w * i / 10) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    // 중앙선
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    const cy = h / 2;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

    // 트림 영역 밖 어둡게
    if (trimStart > 0 || trimEnd < 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      if (trimStart > 0) ctx.fillRect(0, 0, w * trimStart, h);
      if (trimEnd < 1) ctx.fillRect(w * trimEnd, 0, w * (1 - trimEnd), h);
    }

    // 선택 영역
    if (selStart !== null && selEnd !== null && selStart !== selEnd) {
      const sx = w * Math.min(selStart, selEnd);
      const sw = w * Math.abs(selEnd - selStart);
      ctx.fillStyle = WAVEFORM_COLORS.selection;
      ctx.fillRect(sx, 0, sw, h);
    }

    // 파형
    const barW = Math.max(1, w / numBins);
    for (let i = 0; i < numBins; i++) {
      const x = (i / numBins) * w;
      const amp = peaks[i];
      const barH = amp * (h * 0.9);
      const pos = (i / numBins);
      const inTrim = pos >= trimStart && pos <= trimEnd;

      ctx.fillStyle = inTrim ? WAVEFORM_COLORS.wave : 'rgba(100,100,100,0.3)';
      ctx.fillRect(x, cy - barH / 2, Math.max(1, barW - 0.5), barH);
    }
  }

  // ── 에디터 UI ────────────────────────────────────────────

  /**
   * 에디터 다이얼로그 열기
   * @param {File[]} files - 편집할 오디오 파일들
   * @param {HTMLInputElement} fileInput - 원본 file input (완료 후 주입용)
   */
  async function openEditor(files, fileInput) {
    if (_editorOpen) return;
    _editorOpen = true;
    _currentFileInput = fileInput;
    injectStyles();

    // 파일별 상태 관리
    const fileStates = [];
    for (const file of files) {
      fileStates.push({
        file,
        originalFile: file,
        buffer: null, // AudioBuffer
        peaks: null,
        trimStart: 0, // 0~1 비율
        trimEnd: 1,
        history: [], // undo 스택
        editedBuffer: null, // 편집된 버퍼
      });
    }

    let activeIdx = 0;

    // 오버레이
    const overlay = document.createElement('div');
    overlay.className = 'bwbr-ae-overlay';
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) closeEditor();
    });

    // 다이얼로그
    const dialog = document.createElement('div');
    dialog.className = 'bwbr-ae-dialog';
    overlay.appendChild(dialog);

    // 헤더
    const header = document.createElement('div');
    header.className = 'bwbr-ae-header';
    header.innerHTML = `<h3>🎵 오디오 편집기</h3>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'bwbr-ae-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = closeEditor;
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // 멀티 파일 탭
    let tabsEl = null;
    if (files.length > 1) {
      tabsEl = document.createElement('div');
      tabsEl.className = 'bwbr-ae-tabs';
      dialog.appendChild(tabsEl);
    }

    // 파일 정보
    const fileInfoEl = document.createElement('div');
    fileInfoEl.className = 'bwbr-ae-file-info';
    dialog.appendChild(fileInfoEl);

    // 파형 영역
    const waveWrap = document.createElement('div');
    waveWrap.className = 'bwbr-ae-waveform-wrap';
    const canvas = document.createElement('canvas');
    waveWrap.appendChild(canvas);

    // 선택 영역 표시
    const selDiv = document.createElement('div');
    selDiv.className = 'bwbr-ae-selection';
    selDiv.style.display = 'none';
    waveWrap.appendChild(selDiv);

    // 재생 커서
    const cursorDiv = document.createElement('div');
    cursorDiv.className = 'bwbr-ae-cursor';
    cursorDiv.style.left = '0%';
    waveWrap.appendChild(cursorDiv);

    // 트림 핸들
    const handleL = document.createElement('div');
    handleL.className = 'bwbr-ae-handle left';
    waveWrap.appendChild(handleL);
    const handleR = document.createElement('div');
    handleR.className = 'bwbr-ae-handle right';
    waveWrap.appendChild(handleR);

    dialog.appendChild(waveWrap);

    // 시간 라벨
    const timeLabels = document.createElement('div');
    timeLabels.className = 'bwbr-ae-time-labels';
    timeLabels.innerHTML = '<span>0:00</span><span>0:00</span>';
    dialog.appendChild(timeLabels);

    // 컨트롤 바
    const controls = document.createElement('div');
    controls.className = 'bwbr-ae-controls';

    const playBtn = document.createElement('button');
    playBtn.className = 'bwbr-ae-play-btn';
    playBtn.innerHTML = SVG_PLAY;
    controls.appendChild(playBtn);

    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'bwbr-ae-time-display';
    timeDisplay.textContent = '0:00 / 0:00';
    controls.appendChild(timeDisplay);

    const spacer = document.createElement('div');
    spacer.className = 'bwbr-ae-spacer';
    controls.appendChild(spacer);

    dialog.appendChild(controls);

    // 편집 도구
    const tools = document.createElement('div');
    tools.className = 'bwbr-ae-tools';

    const btnTrimSel = _makeToolBtn('✂️', '선택 구간만 남기기', 'trimSel');
    const btnCutSel = _makeToolBtn('🗑️', '선택 구간 제거', 'cutSel');
    const btnTrimLeft = _makeToolBtn('◁|', '트림 시작점까지 자르기', 'trimL');
    const btnTrimRight = _makeToolBtn('|▷', '트림 끝점부터 자르기', 'trimR');
    const btnUndo = _makeToolBtn('↩️', '되돌리기', 'undo');
    const btnReset = _makeToolBtn('🔄', '원본 복원', 'reset');

    tools.append(btnTrimSel, btnCutSel, btnTrimLeft, btnTrimRight, btnUndo, btnReset);
    dialog.appendChild(tools);

    // 프로그레스
    const progressWrap = document.createElement('div');
    progressWrap.className = 'bwbr-ae-progress-wrap';
    progressWrap.innerHTML = `
      <div class="bwbr-ae-progress-bar"><div class="bwbr-ae-progress-fill" style="width:0%"></div></div>
      <div class="bwbr-ae-progress-text">준비 중...</div>
    `;
    dialog.appendChild(progressWrap);

    // 하단
    const footer = document.createElement('div');
    footer.className = 'bwbr-ae-footer';
    const sizeInfo = document.createElement('div');
    sizeInfo.className = 'bwbr-ae-size-info';
    footer.appendChild(sizeInfo);
    const footerBtns = document.createElement('div');
    footerBtns.className = 'bwbr-ae-footer-btns';
    const btnCancel = document.createElement('button');
    btnCancel.className = 'bwbr-ae-btn';
    btnCancel.textContent = '취소';
    btnCancel.onclick = closeEditor;
    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'bwbr-ae-btn primary';
    btnConfirm.textContent = '확정 및 임포트';
    footerBtns.append(btnCancel, btnConfirm);
    footer.appendChild(footerBtns);
    dialog.appendChild(footer);

    document.body.appendChild(overlay);

    // ── 상태 ──

    let _audioCtx = null;
    let _sourceNode = null;
    let _playing = false;
    let _startedAt = 0;
    let _pausedAt = 0;
    let _rafId = null;
    let _selStart = null;
    let _selEnd = null;
    let _dragging = null; // 'select' | 'handleL' | 'handleR' | null

    // ── 헬퍼 함수들 ──

    function _makeToolBtn(icon, label, id) {
      const btn = document.createElement('button');
      btn.className = 'bwbr-ae-tool-btn';
      btn.innerHTML = `<span class="icon">${icon}</span>${label}`;
      btn.dataset.action = id;
      btn.addEventListener('click', () => handleToolAction(id));
      return btn;
    }

    function st() { return fileStates[activeIdx]; }

    function getEffectiveBuffer() {
      const s = st();
      return s.editedBuffer || s.buffer;
    }

    function getEditedDuration() {
      const buf = getEffectiveBuffer();
      if (!buf) return 0;
      const s = st();
      return buf.duration * (s.trimEnd - s.trimStart);
    }

    function estimateSize() {
      const s = st();
      const buf = getEffectiveBuffer();
      if (!buf || !s.file) return 0;
      const ratio = (s.trimEnd - s.trimStart);
      const editLen = s.editedBuffer ? s.editedBuffer.length : s.buffer.length;
      const origLen = s.buffer.length;
      return Math.round(s.file.size * (editLen / origLen) * ratio);
    }

    // ── 탭 구성 ──

    function buildTabs() {
      if (!tabsEl) return;
      tabsEl.innerHTML = '';
      fileStates.forEach((fs, i) => {
        const tab = document.createElement('div');
        tab.className = 'bwbr-ae-tab' + (i === activeIdx ? ' active' : '');
        tab.innerHTML = `${fs.file.name}<span class="size">(${formatSize(fs.file.size)})</span>`;
        tab.addEventListener('click', () => { switchTab(i); });
        tabsEl.appendChild(tab);
      });
    }

    async function switchTab(idx) {
      stopPlayback();
      activeIdx = idx;
      buildTabs();
      await loadCurrentFile();
    }

    // ── 파일 로드 ──

    async function loadCurrentFile() {
      const s = st();

      fileInfoEl.innerHTML = '<span>디코딩 중...</span>';

      if (!s.buffer) {
        try {
          s.buffer = await decodeFile(s.file);
        } catch (e) {
          fileInfoEl.innerHTML = `<span class="warn">⚠ 디코딩 실패: ${e.message}</span>`;
          return;
        }
      }

      updateFileInfo();
      drawCurrentWaveform();
      updateControls();
    }

    function updateFileInfo() {
      const s = st();
      const buf = getEffectiveBuffer();
      if (!buf) return;

      const estSize = estimateSize();
      const overLimit = estSize > MAX_FILE_SIZE;
      const duration = getEditedDuration();

      fileInfoEl.innerHTML = `
        <span>📁 ${s.file.name}</span>
        <span>⏱ ${formatTime(duration)} (원본 ${formatTime(buf.duration)})</span>
        <span>🎵 ${buf.sampleRate}Hz ${buf.numberOfChannels}ch</span>
        <span class="${overLimit ? 'warn' : 'ok'}">
          💾 약 ${formatSize(estSize)} ${overLimit ? '⚠ (10MB 초과 → 자동 압축)' : '✓'}
        </span>
      `;

      sizeInfo.innerHTML = `
        원본: <span class="size">${formatSize(s.file.size)}</span> →
        예상: <span class="size ${overLimit ? 'over' : ''}">${formatSize(estSize)}</span>
        ${overLimit ? ' (자동 압축 예정)' : ''}
      `;
    }

    function drawCurrentWaveform() {
      const s = st();
      const buf = getEffectiveBuffer();
      if (!buf) return;

      const rect = waveWrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const numBins = Math.min(Math.floor(rect.width), 512);
      s.peaks = extractPeaks(buf, numBins);
      drawWaveform(canvas, s.peaks, s.trimStart, s.trimEnd, _selStart, _selEnd);

      // 시간 라벨 업데이트
      const dur = buf.duration;
      timeLabels.children[0].textContent = formatTime(dur * s.trimStart);
      timeLabels.children[1].textContent = formatTime(dur * s.trimEnd);

      // 핸들 위치
      handleL.style.left = (s.trimStart * 100) + '%';
      handleR.style.right = ((1 - s.trimEnd) * 100) + '%';
    }

    // ── 재생 ──

    function togglePlayback() {
      if (_playing) {
        stopPlayback();
      } else {
        startPlayback();
      }
    }

    function startPlayback() {
      const buf = getEffectiveBuffer();
      if (!buf) return;
      const s = st();

      if (!_audioCtx) _audioCtx = new AudioContext();

      _sourceNode = _audioCtx.createBufferSource();
      _sourceNode.buffer = buf;
      _sourceNode.connect(_audioCtx.destination);

      const startOffset = s.trimStart * buf.duration + _pausedAt;
      const endTime = s.trimEnd * buf.duration;
      const playDuration = endTime - startOffset;

      if (playDuration <= 0) { _pausedAt = 0; return; }

      _sourceNode.start(0, startOffset, playDuration);
      _startedAt = _audioCtx.currentTime - _pausedAt;
      _playing = true;

      _sourceNode.onended = () => {
        if (_playing) {
          _playing = false;
          _pausedAt = 0;
          playBtn.innerHTML = SVG_PLAY;
          cursorDiv.style.left = (s.trimStart * 100) + '%';
          if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        }
      };

      playBtn.innerHTML = SVG_PAUSE;
      _updateCursor();
    }

    function stopPlayback() {
      if (_sourceNode) {
        try { _sourceNode.stop(); } catch {}
        _sourceNode = null;
      }
      if (_playing && _audioCtx) {
        _pausedAt = _audioCtx.currentTime - _startedAt;
      }
      _playing = false;
      playBtn.innerHTML = SVG_PLAY;
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    }

    function _updateCursor() {
      if (!_playing || !_audioCtx) return;
      const buf = getEffectiveBuffer();
      const s = st();
      if (!buf) return;

      const elapsed = _audioCtx.currentTime - _startedAt;
      const offset = s.trimStart * buf.duration + elapsed;
      const pct = offset / buf.duration;
      cursorDiv.style.left = (clamp(pct, 0, 1) * 100) + '%';

      const trimDur = (s.trimEnd - s.trimStart) * buf.duration;
      timeDisplay.textContent = formatTime(elapsed) + ' / ' + formatTime(trimDur);

      _rafId = requestAnimationFrame(_updateCursor);
    }

    // ── 파형 인터랙션 ──

    function posFromEvent(e) {
      const rect = waveWrap.getBoundingClientRect();
      return clamp((e.clientX - rect.left) / rect.width, 0, 1);
    }

    waveWrap.addEventListener('pointerdown', (e) => {
      if (e.target === handleL || e.target === handleR) return;
      if (e.button !== 0) return;
      e.preventDefault();
      waveWrap.setPointerCapture(e.pointerId);

      _selStart = posFromEvent(e);
      _selEnd = _selStart;
      _dragging = 'select';
      selDiv.style.display = 'block';
      updateSelectionUI();
    });

    handleL.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      waveWrap.setPointerCapture(e.pointerId);
      _dragging = 'handleL';
    });

    handleR.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      waveWrap.setPointerCapture(e.pointerId);
      _dragging = 'handleR';
    });

    waveWrap.addEventListener('pointermove', (e) => {
      if (!_dragging) return;
      const pos = posFromEvent(e);
      const s = st();

      if (_dragging === 'select') {
        _selEnd = pos;
        updateSelectionUI();
      } else if (_dragging === 'handleL') {
        s.trimStart = clamp(pos, 0, s.trimEnd - 0.01);
        drawCurrentWaveform();
        updateFileInfo();
      } else if (_dragging === 'handleR') {
        s.trimEnd = clamp(pos, s.trimStart + 0.01, 1);
        drawCurrentWaveform();
        updateFileInfo();
      }
    });

    waveWrap.addEventListener('pointerup', () => {
      if (_dragging === 'select') {
        // 선택이 너무 작으면 해제
        if (_selStart !== null && _selEnd !== null && Math.abs(_selEnd - _selStart) < 0.005) {
          _selStart = null; _selEnd = null;
          selDiv.style.display = 'none';
        }
      }
      _dragging = null;
      drawCurrentWaveform();
      updateControls();
    });

    function updateSelectionUI() {
      if (_selStart === null || _selEnd === null) return;
      const left = Math.min(_selStart, _selEnd);
      const right = Math.max(_selStart, _selEnd);
      selDiv.style.left = (left * 100) + '%';
      selDiv.style.width = ((right - left) * 100) + '%';
      drawCurrentWaveform();
    }

    // ── 편집 도구 ──

    function handleToolAction(action) {
      const s = st();
      const buf = getEffectiveBuffer();
      if (!buf) return;

      stopPlayback();
      _pausedAt = 0;

      switch (action) {
        case 'trimSel': { // 선택 구간만 남기기
          if (_selStart === null || _selEnd === null) return;
          const lo = Math.min(_selStart, _selEnd);
          const hi = Math.max(_selStart, _selEnd);
          const startSample = Math.floor(lo * buf.length);
          const endSample = Math.floor(hi * buf.length);
          pushHistory(s);
          s.editedBuffer = sliceBuffer(buf, startSample, endSample);
          s.trimStart = 0; s.trimEnd = 1;
          clearSelection();
          break;
        }
        case 'cutSel': { // 선택 구간 제거
          if (_selStart === null || _selEnd === null) return;
          const lo = Math.min(_selStart, _selEnd);
          const hi = Math.max(_selStart, _selEnd);
          const startSample = Math.floor(lo * buf.length);
          const endSample = Math.floor(hi * buf.length);
          pushHistory(s);
          s.editedBuffer = removeSection(buf, startSample, endSample);
          s.trimStart = 0; s.trimEnd = 1;
          clearSelection();
          break;
        }
        case 'trimL': { // 트림 시작점까지 자르기
          if (s.trimStart <= 0) return;
          const startSample = Math.floor(s.trimStart * buf.length);
          pushHistory(s);
          s.editedBuffer = sliceBuffer(buf, startSample, buf.length);
          s.trimStart = 0; s.trimEnd = 1;
          clearSelection();
          break;
        }
        case 'trimR': { // 트림 끝점부터 자르기
          if (s.trimEnd >= 1) return;
          const endSample = Math.floor(s.trimEnd * buf.length);
          pushHistory(s);
          s.editedBuffer = sliceBuffer(buf, 0, endSample);
          s.trimStart = 0; s.trimEnd = 1;
          clearSelection();
          break;
        }
        case 'undo': {
          if (s.history.length === 0) return;
          const prev = s.history.pop();
          s.editedBuffer = prev.editedBuffer;
          s.trimStart = prev.trimStart;
          s.trimEnd = prev.trimEnd;
          clearSelection();
          break;
        }
        case 'reset': {
          if (!s.editedBuffer && s.trimStart === 0 && s.trimEnd === 1) return;
          pushHistory(s);
          s.editedBuffer = null;
          s.trimStart = 0; s.trimEnd = 1;
          clearSelection();
          break;
        }
      }

      drawCurrentWaveform();
      updateFileInfo();
      updateControls();
    }

    function pushHistory(s) {
      s.history.push({
        editedBuffer: s.editedBuffer,
        trimStart: s.trimStart,
        trimEnd: s.trimEnd,
      });
      // 히스토리 최대 20개
      if (s.history.length > 20) s.history.shift();
    }

    function clearSelection() {
      _selStart = null; _selEnd = null;
      selDiv.style.display = 'none';
    }

    function updateControls() {
      const s = st();
      const hasSel = _selStart !== null && _selEnd !== null && Math.abs(_selEnd - _selStart) > 0.005;
      btnTrimSel.disabled = !hasSel;
      btnCutSel.disabled = !hasSel;
      btnTrimLeft.disabled = s.trimStart <= 0;
      btnTrimRight.disabled = s.trimEnd >= 1;
      btnUndo.disabled = s.history.length === 0;
      btnReset.disabled = !s.editedBuffer && s.trimStart === 0 && s.trimEnd === 1;

      const buf = getEffectiveBuffer();
      if (buf) {
        const trimDur = (s.trimEnd - s.trimStart) * buf.duration;
        timeDisplay.textContent = '0:00 / ' + formatTime(trimDur);
      }
    }

    // ── 확정 & 임포트 ──

    btnConfirm.addEventListener('click', async () => {
      btnConfirm.disabled = true;
      btnConfirm.textContent = '처리 중...';
      progressWrap.classList.add('active');
      const pgFill = progressWrap.querySelector('.bwbr-ae-progress-fill');
      const pgText = progressWrap.querySelector('.bwbr-ae-progress-text');

      try {
        const resultFiles = [];

        for (let i = 0; i < fileStates.length; i++) {
          const s = fileStates[i];
          const buf = s.editedBuffer || s.buffer;
          if (!buf) { resultFiles.push(s.file); continue; }

          pgText.textContent = `${s.file.name} 처리 중... (${i + 1}/${fileStates.length})`;

          // 트림 적용
          let finalBuf = buf;
          if (s.trimStart > 0 || s.trimEnd < 1) {
            const startSample = Math.floor(s.trimStart * buf.length);
            const endSample = Math.floor(s.trimEnd * buf.length);
            finalBuf = sliceBuffer(buf, startSample, endSample);
          }

          // 예상 크기 검사
          // 편집된 결과를 먼저 Blob으로 만들어야 함
          let resultBlob;

          // 편집이 있었으면 무조건 재인코딩
          const wasEdited = s.editedBuffer || s.trimStart > 0 || s.trimEnd < 1;

          if (wasEdited) {
            // 먼저 기본 비트레이트로 인코딩해서 크기 확인
            pgText.textContent = `${s.file.name} 인코딩 중...`;
            resultBlob = await encodeAudioBuffer(finalBuf, null, (p) => {
              pgFill.style.width = ((i + p * 0.5) / fileStates.length * 100) + '%';
            });

            // 10MB 초과면 압축
            if (resultBlob.size > MAX_FILE_SIZE) {
              pgText.textContent = `${s.file.name} 압축 중... (${formatSize(resultBlob.size)} → 10MB 이하)`;
              resultBlob = await autoCompress(finalBuf, resultBlob, (p) => {
                pgFill.style.width = ((i + 0.5 + p * 0.5) / fileStates.length * 100) + '%';
              });
            }
          } else {
            // 편집 없음 — 원본이 10MB 넘으면 압축
            if (s.file.size > MAX_FILE_SIZE) {
              pgText.textContent = `${s.file.name} 압축 중... (${formatSize(s.file.size)} → 10MB 이하)`;
              resultBlob = await autoCompress(finalBuf, s.file, (p) => {
                pgFill.style.width = ((i + p) / fileStates.length * 100) + '%';
              });
            } else {
              resultBlob = s.file;
            }
          }

          // Blob → File 객체로 변환
          const ext = wasEdited ? '.webm' : s.file.name.split('.').pop();
          const fileName = wasEdited
            ? s.file.name.replace(/\.[^.]+$/, '') + '.webm'
            : s.file.name;
          const resultFile = new File([resultBlob], fileName, {
            type: resultBlob.type || 'audio/webm',
          });
          resultFiles.push(resultFile);
        }

        pgFill.style.width = '100%';
        pgText.textContent = '코코포리아에 전달 중...';

        // file input에 주입
        injectFilesToInput(_currentFileInput, resultFiles);

        // 에디터 닫기
        setTimeout(closeEditor, 300);

      } catch (err) {
        pgText.textContent = `⚠ 오류: ${err.message}`;
        btnConfirm.disabled = false;
        btnConfirm.textContent = '확정 및 임포트';
      }
    });

    // ── file input에 결과 주입 ──

    function injectFilesToInput(input, files) {
      input.dataset.bwbrEditorInjected = '1';
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── 에디터 닫기 ──

    function closeEditor() {
      stopPlayback();
      if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      _editorOpen = false;
      _currentFileInput = null;
      _pendingFiles = null;
    }

    // ── 재생 버튼 ──
    playBtn.addEventListener('click', togglePlayback);

    // ── 키보드 단축키 ──
    function onKeydown(e) {
      if (!_editorOpen) return;
      if (e.key === 'Escape') { closeEditor(); return; }
      if (e.key === ' ') { e.preventDefault(); togglePlayback(); return; }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleToolAction('undo');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (_selStart !== null && _selEnd !== null) {
          e.preventDefault();
          handleToolAction('cutSel');
        }
      }
    }
    document.addEventListener('keydown', onKeydown, true);

    // ── 초기화 ──
    buildTabs();
    await loadCurrentFile();
  }

  // ── 인터셉트 설치 ────────────────────────────────────────

  function installIntercept() {
    if (_interceptInstalled) return;
    _interceptInstalled = true;

    // 1) file input change 인터셉트 (업로드 버튼 경로)
    document.addEventListener('change', (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.type !== 'file') return;
      if (!input.accept || !input.accept.includes('audio')) return;
      if (!input.files || input.files.length === 0) return;

      // 에디터가 주입한 change는 무시
      if (input.dataset.bwbrEditorInjected) {
        delete input.dataset.bwbrEditorInjected;
        return;
      }

      // 이벤트 가로채기
      e.stopImmediatePropagation();
      e.preventDefault();

      const files = [...input.files];
      // input 값 초기화 (코코포리아가 처리하지 못하게)
      input.value = '';

      // 에디터 열기
      openEditor(files, input);
    }, true); // capture phase에서 먼저 잡아야 함

    // 2) D&D 인터셉트 — BGM 드로어 위에 드롭존 오버레이
    installDndIntercept();
  }

  function installDndIntercept() {
    let _dragCounter = 0;
    let _dropzoneOverlay = null;

    // 드래그가 BGM 드로어 영역 안인지 확인
    function findBgmDrawer() {
      return document.querySelector('.MuiDrawer-modal .MuiDialogContent-root');
    }

    document.addEventListener('dragenter', (e) => {
      // 오디오 파일이 드래그되고 있는지 확인
      if (!e.dataTransfer?.types?.includes('Files')) return;

      // BGM 드로어가 열려있는지 확인
      const drawer = findBgmDrawer();
      if (!drawer) return;

      _dragCounter++;
      if (_dragCounter === 1 && !_dropzoneOverlay) {
        _dropzoneOverlay = createDropzone(drawer);
      }
    }, true);

    document.addEventListener('dragleave', (e) => {
      _dragCounter--;
      if (_dragCounter <= 0) {
        _dragCounter = 0;
        removeDropzone();
      }
    }, true);

    document.addEventListener('dragover', (e) => {
      if (_dropzoneOverlay) {
        e.preventDefault(); // 드롭을 허용하기 위해 필수
      }
    }, true);

    document.addEventListener('drop', (e) => {
      _dragCounter = 0;

      if (!_dropzoneOverlay) return;
      removeDropzone();

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // 오디오 파일만 필터
      const audioFiles = [...files].filter(f =>
        f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|webm|aac|wma)$/i.test(f.name)
      );
      if (audioFiles.length === 0) return;

      // 네이티브 drop 방지
      e.preventDefault();
      e.stopImmediatePropagation();

      // file input 찾기
      const fileInput = document.querySelector('input[type="file"][accept*="audio"]');
      if (!fileInput) return;

      openEditor(audioFiles, fileInput);
    }, true);

    function createDropzone(container) {
      const dz = document.createElement('div');
      dz.className = 'bwbr-ae-dropzone active';
      dz.innerHTML = '<div class="bwbr-ae-dropzone-text">🎵 여기에 놓으면 편집기가 열립니다</div>';
      const parent = container.closest('.MuiPaper-root') || container;
      parent.style.position = 'relative';
      parent.appendChild(dz);
      return dz;
    }

    function removeDropzone() {
      if (_dropzoneOverlay) {
        _dropzoneOverlay.remove();
        _dropzoneOverlay = null;
      }
    }
  }

  // ── 초기화 ──────────────────────────────────────────────

  function init() {
    installIntercept();
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  // ── 전역 공개 ──
  window.BWBR_AudioEditor = {
    open: openEditor,
  };
})();
