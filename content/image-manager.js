/**
 * image-manager.js — 이미지 피커 드래그 관리
 *
 * 네이티브 코코포리아 이미지 선택 다이얼로그에서:
 * 1. 이미지를 카테고리 탭으로 드래그 → 탭 이동(dir 변경, Firestore 서버 반영)
 * 2. Ctrl/Shift+클릭 → 네이티브 선택 모드 진입 후 복수 선택
 * 3. 복수 선택 상태에서 드래그 → 선택 전체 일괄 탭 이동
 *
 * 크로스월드: BWBR_Bridge.request() (ISOLATED ↔ MAIN)
 */
(function () {
  'use strict';

  const TAG = '[CE 이미지매니저]';

  /* ── 카테고리 탭 ↔ dir 값 매핑 ───────────────────── */
  const TAB_DIR_MAP = {
    '전경': 'foreground',
    '배경': 'background',
    '캐릭터': 'characters',
    'キャラクター': 'characters',           // 일본어
    '스크린': 'item',
    'スクリーン': 'item',
    '스크린 뒷면': 'coverItem',
    'スクリーン裏面': 'coverItem',
    '마커': 'marker',
    'マーカー': 'marker',
    '컷인': 'effect',
    'カットイン': 'effect'
  };

  /* dir → 탭 텍스트 역매핑 */
  const DIR_TAB_MAP = {};
  for (const [txt, dir] of Object.entries(TAB_DIR_MAP)) DIR_TAB_MAP[dir] = txt;

  /* ── 상태 ─────────────────────────────────────────── */
  let _pickerObs = null;            // MutationObserver
  let _fileCache = [];              // 현재 dir의 파일 목록 캐시
  let _currentDir = null;           // 현재 표시 중인 dir
  let _currentRoomId = null;        // 현재 방 ID (ROOM 탭) 또는 null (ALL)
  let _dragHashes = [];             // 드래그 중인 파일 해시 (URL에서 추출, 캐시 무관)
  let _lastClickedIdx = -1;        // Shift 클릭용 마지막 클릭 인덱스
  let _isGroupRoom = true;         // ROOM 탭인지 ALL인지
  let _suppressObserver = false;    // 자체 쓰기 중 옵저버 억제
  let _dropLock = false;            // 동시 드롭 방지 락

  /* ══════════════════════════════════════════════════════
   *  DOM 헬퍼
   * ══════════════════════════════════════════════════════ */

  function getPickerDialog() {
    return document.querySelector('.MuiDialog-paperWidthMd[role="dialog"]');
  }

  /** 카테고리 탭 목록 (전경/배경/캐릭터/스크린/...) */
  function getCategoryTabs(picker) {
    // ROOM/ALL/Unsplash는 button이므로 tablist에 포함되지 않음
    // 피커 내 tablist은 카테고리 탭 1개뿐
    const tabLists = picker.querySelectorAll('[role="tablist"]');
    if (tabLists.length === 0) return [];
    // 카테고리 탭이 포함된 tablist 찾기 (known 카테고리명 매칭)
    for (const tl of tabLists) {
      const tabs = tl.querySelectorAll('[role="tab"]');
      for (const t of tabs) {
        const txt = t.textContent.trim();
        if (TAB_DIR_MAP[txt]) return Array.from(tabs);
      }
    }
    // fallback: 마지막 tablist
    return Array.from(tabLists[tabLists.length - 1].querySelectorAll('[role="tab"]'));
  }

  /** 현재 선택된 카테고리 탭의 dir 값 */
  function getCurrentDir(picker) {
    const tabs = getCategoryTabs(picker);
    for (const tab of tabs) {
      if (tab.classList.contains('Mui-selected') || tab.getAttribute('aria-selected') === 'true') {
        const text = tab.textContent.trim();
        return TAB_DIR_MAP[text] || text;
      }
    }
    return null;
  }

  /** 현재 그룹 (ROOM/ALL/Unsplash) 감지 — toolbar 버튼에서 찾음 */
  function getCurrentGroup(picker) {
    const toolbar = picker.querySelector('.MuiToolbar-root');
    if (!toolbar) return 'room';
    // ROOM/ALL/Unsplash 버튼 중 활성 상태인 것 찾기
    const groupBtns = [];
    for (const btn of toolbar.querySelectorAll('button')) {
      const t = btn.textContent.trim().toUpperCase();
      if (t === 'ROOM' || t === 'ALL' || t === 'UNSPLASH') {
        groupBtns.push({ btn, text: t });
      }
    }
    // MUI: contained variant = 활성, 또는 aria-pressed, 또는 배경색 비교
    for (const { btn, text } of groupBtns) {
      const cl = btn.className;
      const isActive = cl.includes('contained') ||
                       btn.getAttribute('aria-pressed') === 'true' ||
                       cl.includes('Mui-selected');
      if (isActive) {
        if (text === 'ALL') return 'all';
        if (text === 'UNSPLASH') return 'unsplash';
        return 'room';
      }
    }
    // fallback: 배경색 비교 (active 버튼은 배경이 있음)
    for (const { btn, text } of groupBtns) {
      const bg = getComputedStyle(btn).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        if (text === 'ALL') return 'all';
        if (text === 'UNSPLASH') return 'unsplash';
        return 'room';
      }
    }
    return 'room';
  }

  /** 제외할 이미지인지 판단 (toolbar/tab/header 내부, 아이콘) */
  function isExcludedImage(img) {
    if (img.closest('.MuiToolbar-root, .MuiAppBar-root, header, [role="tablist"]')) return true;
    if (img.naturalWidth > 0 && img.naturalWidth < 40) return true;
    return false;
  }

  /** 피커 내 이미지 요소 목록 (유효한 것만) */
  function getPickerImages(picker) {
    const out = [];
    for (const img of picker.querySelectorAll('img')) {
      if (!img.src || !img.src.startsWith('https://')) continue;
      if (isExcludedImage(img)) continue;
      out.push(img);
    }
    return out;
  }

  /* ── 해시 인덱스 (O(1) URL→fileId 매핑) ──────────── */
  let _hashToFileId = new Map();   // hash → fileId
  let _urlToFileIdCache = new Map(); // 전체 URL → fileId

  function buildHashIndex() {
    _hashToFileId.clear();
    _urlToFileIdCache.clear();
    for (const f of _fileCache) {
      if (f.url) _urlToFileIdCache.set(f.url, f._id);
      const h = extractUrlHash(f.url);
      if (h) _hashToFileId.set(h, f._id);
    }
  }

  /** 이미지 URL → 파일 _id 매핑 (해시 인덱스 사용, O(1)) */
  function urlToFileId(url) {
    if (!url) return null;
    // 정확한 URL 매칭
    if (_urlToFileIdCache.has(url)) return _urlToFileIdCache.get(url);
    // 해시 매칭 (CDN ↔ Firestore 도메인 차이 허용)
    const h = extractUrlHash(url);
    if (h && _hashToFileId.has(h)) return _hashToFileId.get(h);
    return null;
  }

  /** 해시 배열 → fileId 배열 변환 (캐시 미스 시 전체 재로딩 후 재시도) */
  async function resolveHashes(hashes) {
    let ids = hashes.map(h => _hashToFileId.get(h)).filter(Boolean);
    if (ids.length === hashes.length) return ids;

    // 캐시 미스 — 전체 파일 재로딩 후 재시도
    const missing = hashes.filter(h => !_hashToFileId.get(h));
    console.warn(TAG, `캐시 미스: ${missing.length}개 해시 미해석, 전체 재로딩...`, missing);
    await refreshFileCache(_currentDir, _currentRoomId);
    ids = hashes.map(h => _hashToFileId.get(h)).filter(Boolean);
    if (ids.length < hashes.length) {
      const still = hashes.filter(h => !_hashToFileId.get(h));
      console.error(TAG, `최종 미해석 해시 (Redux에 없는 파일):`, still);
    }
    return ids;
  }

  /** URL에서 파일 ID/해시 추출 (%2F 인코딩 허용, hex + 영숫자 Firestore ID 모두 지원) */
  function extractUrlHash(url) {
    try {
      const decoded = decodeURIComponent(url);
      // /files/{id} 패턴 — hex 해시 또는 Firestore 문서 ID (영숫자)
      const match = decoded.match(/\/files\/([a-zA-Z0-9_-]+)/);
      if (match) return match[1];
    } catch {}
    return null;
  }

  /** 이벤트 타겟에서 이미지 래퍼를 찾음 — DOM 상위 탐색 */
  function findImageWrapper(target, picker) {
    let el = target;
    while (el && el !== picker) {
      // 이 요소가 img 자체이면 부모가 래퍼
      if (el.tagName === 'IMG' && el.src?.startsWith('https://')) {
        if (isExcludedImage(el)) return null;
        const wrapper = el.parentElement;
        return (wrapper && picker.contains(wrapper)) ? wrapper : null;
      }
      // 이 요소가 직접 img를 자식으로 가지면 이 요소가 래퍼
      const childImg = el.querySelector(':scope > img');
      if (childImg?.src?.startsWith('https://')) {
        if (isExcludedImage(childImg)) return null;
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /** 네이티브 "선택 삭제" 모드 여부 */
  function isNativeDeleteMode(picker) {
    const toolbar = picker.querySelector('.MuiToolbar-root');
    if (!toolbar) return false;
    for (const btn of toolbar.querySelectorAll('button')) {
      const t = btn.textContent.trim();
      if (t === '취소' || t === 'キャンセル' || t === 'Cancel') return true;
    }
    return false;
  }

  /** 네이티브 선택된 이미지 해시 목록 (DOM 체크마크로 감지, 캐시 무관) */
  function getNativeSelectedHashes(picker) {
    const hashes = [];
    for (const img of getPickerImages(picker)) {
      const wrapper = img.parentElement;
      if (!wrapper) continue;
      const svgs = wrapper.querySelectorAll('svg:not(.bwbr-check):not(.bwbr-img-drag-badge)');
      for (const svg of svgs) {
        const circle = svg.querySelector('circle');
        if (circle && circle.getAttribute('fill') === '#2196F3') {
          const h = extractUrlHash(img.src);
          if (h) hashes.push(h);
        }
      }
    }
    return hashes;
  }

  /* ══════════════════════════════════════════════════════
   *  파일 목록 캐시 로드
   * ══════════════════════════════════════════════════════ */

  async function refreshFileCache(dir, roomId) {
    try {
      // dir 필터 없이 전체 파일 로드 — ALL 탭에서 다른 dir 이미지도 해시 매칭 가능
      const payload = {};
      const result = await BWBR_Bridge.request(
        'bwbr-get-user-files', 'bwbr-user-files-data',
        payload,
        {
          sendAttr: 'data-bwbr-get-user-files',
          recvAttr: 'data-bwbr-user-files-data',
          timeout: 5000,
          on: document,
          emit: document
        }
      );
      _fileCache = result?.files || [];
      buildHashIndex();
      _currentDir = dir;
      _currentRoomId = roomId || null;

      // Redux lazy load — 결과 0이면 1초 후 재시도 (최대 1회)
      if (_fileCache.length === 0) {
        setTimeout(async () => {
          if (_currentDir !== dir) return; // 이미 다른 탭으로 전환
          try {
            const retry = await BWBR_Bridge.request(
              'bwbr-get-user-files', 'bwbr-user-files-data',
              payload,
              {
                sendAttr: 'data-bwbr-get-user-files',
                recvAttr: 'data-bwbr-user-files-data',
                timeout: 5000,
                on: document,
                emit: document
              }
            );
            if (retry?.files?.length > 0 && _currentDir === dir) {
              _fileCache = retry.files;
              buildHashIndex();
              console.log(TAG, `재시도 캐시: ${_fileCache.length}개`);
            }
          } catch {}
        }, 1000);
      }
    } catch (err) {
      console.error(TAG, '파일 캐시 로드 실패:', err);
      _fileCache = [];
    }
  }

  /* ══════════════════════════════════════════════════════
   *  드래그 앤 드롭: 이벤트 위임 방식 (React re-render 안전)
   * ══════════════════════════════════════════════════════ */

  /** 이미지 아이템에 draggable 속성 + dragstart/dragend 추가 */
  function setupDraggableImages(picker) {
    const images = getPickerImages(picker);

    let newCount = 0;
    images.forEach((img, idx) => {
      const wrapper = img.parentElement;
      if (!wrapper || wrapper.dataset.bwbrDrag === '1') return;
      wrapper.dataset.bwbrDrag = '1';
      wrapper.draggable = true;
      wrapper.style.cursor = 'grab';
      newCount++;
    });

    if (newCount > 0) {
      console.log(TAG, `이미지 ${newCount}개 draggable 설정 (전체 ${images.length}개)`);
    }
  }

  /** 피커에 이벤트 위임 핸들러 등록 (1회) */
  function setupPickerDelegation(picker) {
    if (picker.dataset.bwbrDelegation === '1') return;
    picker.dataset.bwbrDelegation = '1';
    console.log(TAG, '이벤트 위임 설정');

    // ── mousedown (capture) — just-in-time draggable 설정 ──
    picker.addEventListener('mousedown', e => {
      const wrapper = findImageWrapper(e.target, picker);
      if (wrapper) {
        wrapper.draggable = true;
        wrapper.style.cursor = 'grab';
      }
    }, true);

    // ── dragstart (capture) ──────────────────────────
    picker.addEventListener('dragstart', e => {
      const wrapper = findImageWrapper(e.target, picker);
      if (!wrapper) return;
      const img = wrapper.querySelector('img');
      if (!img?.src) return;

      const hash = extractUrlHash(img.src);
      if (!hash) { e.preventDefault(); return; }

      if (isNativeDeleteMode(picker)) {
        const selectedHashes = getNativeSelectedHashes(picker);
        _dragHashes = selectedHashes.includes(hash) ? selectedHashes : [hash];
      } else {
        _dragHashes = [hash];
      }

      console.log(TAG, `dragstart: ${_dragHashes.length}개`);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragHashes.join(','));
      wrapper.style.opacity = '0.4';

      if (_dragHashes.length > 1) {
        const badge = createDragBadge(_dragHashes.length);
        document.body.appendChild(badge);
        e.dataTransfer.setDragImage(badge, 20, 20);
        setTimeout(() => badge.remove(), 0);
      }
    }, true);

    // ── dragend (capture) ────────────────────────────
    picker.addEventListener('dragend', e => {
      const wrapper = findImageWrapper(e.target, picker);
      if (wrapper) wrapper.style.opacity = '1';
      clearDropIndicators(picker);
      _dragHashes = [];
    }, true);

    // ── dragover (capture — MUI 이벤트 가로채기 방지) ──
    picker.addEventListener('dragover', e => {
      if (_dragHashes.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      // 탭 위 하이라이트
      const tab = e.target.closest('[role="tab"]');
      if (tab) {
        clearTabHighlights(picker);
        tab.style.borderBottom = '3px solid #2196F3';
        tab.style.transition = 'border-bottom 0.15s';
        return;
      }
    }, true);

    // ── dragleave (capture) ──────────────────────────
    picker.addEventListener('dragleave', e => {
      const tab = e.target.closest('[role="tab"]');
      if (tab) { tab.style.borderBottom = ''; }
    }, true);

    // ── drop (capture — 내부 이미지 드래그만 가로채기) ──────────
    picker.addEventListener('drop', async e => {
      // 내부 이미지 드래그가 아니면 네이티브 동작 허용 (파일 업로드 등)
      if (_dragHashes.length === 0) {
        clearDropIndicators(picker);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // 탭에 드롭
      const tab = e.target.closest('[role="tab"]');
      if (tab) {
        clearDropIndicators(picker);
        if (_dropLock) {
          console.warn(TAG, '이전 이동 처리 중 — 대기');
          return;
        }
        _dropLock = true;
        try {
          const fileIds = await resolveHashes(_dragHashes);
          if (fileIds.length === 0) {
            console.error(TAG, '❌ 탭 이동 실패: 파일 해석 불가');
            return;
          }
          await handleTabDrop(picker, tab, fileIds);
        } finally {
          _dropLock = false;
        }
        return;
      }

      console.log(TAG, 'drop 대상 미매칭 (탭 외 영역)');
      clearDropIndicators(picker);
    }, true);
  }

  /** 탭 드롭 처리 (fileIds는 drop 핸들러에서 해시→ID 변환 완료) */
  async function handleTabDrop(picker, tab, fileIds) {
    const tabText = tab.textContent.trim();
    const targetDir = TAB_DIR_MAP[tabText];
    if (!targetDir) {
      console.warn(TAG, '알 수 없는 탭:', tabText);
      return;
    }
    if (targetDir === _currentDir) {
      console.log(TAG, '같은 탭 드롭 무시');
      return;
    }
    if (fileIds.length === 0) return;

    console.log(TAG, `${fileIds.length}개 파일 → ${tabText}(${targetDir}) 이동`);

    _suppressObserver = true;
    try {
      const result = await BWBR_Bridge.request(
        'bwbr-move-files-dir', 'bwbr-move-files-dir-result',
        { fileIds, targetDir },
        {
          sendAttr: 'data-bwbr-move-files-dir',
          recvAttr: 'data-bwbr-move-files-dir-result',
          timeout: 10000,
          on: document,
          emit: document
        }
      );

      if (result?.success) {
        console.log(TAG, `✅ ${result.movedCount}개 이동 완료`,
          `(Redux: ${result.reduxWait}, ${result.reduxMs}ms)`);

        // 1) DOM에서 이동한 이미지 즉시 숨김 (드래그 원본)
        const movedHashSet = new Set(_dragHashes);
        for (const img of getPickerImages(picker)) {
          const h = extractUrlHash(img.src);
          if (h && movedHashSet.has(h)) {
            const wrapper = img.parentElement;
            if (wrapper) {
              wrapper.style.display = 'none';
              wrapper.dataset.bwbrMoved = '1';
            }
          }
        }

        // 2) 캐시에서 이동된 파일의 dir 업데이트
        for (const f of _fileCache) {
          if (fileIds.includes(f._id)) f.dir = targetDir;
        }
        buildHashIndex();

        // 3) 대상 탭 클릭
        tab.click();

        setTimeout(async () => {
          _suppressObserver = false;
          const p = getPickerDialog();
          if (p) {
            await refreshFileCache(getCurrentDir(p) || targetDir, _isGroupRoom ? getRoomIdFromUrl() : null);
            console.log(TAG, `탭 이동 후 캐시 갱신: ${_fileCache.length}개`);
            setupDraggableImages(p);
          }
        }, 400);
      } else {
        console.error(TAG, '이동 실패:', result?.error || '응답에 error 필드 없음', result);
        _suppressObserver = false;
      }
    } catch (err) {
      console.error(TAG, '이동 요청 실패:', err);
      _suppressObserver = false;
    }
  }

  /* ── 드래그 UI 헬퍼 ──────────────────────────────── */

  function clearTabHighlights(picker) {
    getCategoryTabs(picker).forEach(t => { t.style.borderBottom = ''; });
  }

  function clearDropIndicators(picker) {
    clearTabHighlights(picker);
  }

  /* ══════════════════════════════════════════════════════
   *  Ctrl/Shift 클릭 → 네이티브 선택 모드 진입
   * ══════════════════════════════════════════════════════ */

  function setupCtrlShiftClick(picker) {
    // capture phase에서 Ctrl/Shift 감지
    if (picker.dataset.bwbrCtrlShift === '1') return;
    picker.dataset.bwbrCtrlShift = '1';

    picker.addEventListener('click', e => {
      if (!e.ctrlKey && !e.shiftKey && !e.metaKey) return;

      // 이미지 클릭인지 확인
      const img = e.target.closest('img') || e.target.querySelector('img');
      if (!img || !img.src.startsWith('https://')) return;

      // tab 이나 button 클릭이면 무시
      if (e.target.closest('[role="tab"]') || e.target.closest('button')) return;

      e.preventDefault();
      e.stopPropagation();

      // 네이티브 선택 모드가 아니면 활성화
      if (!isNativeDeleteMode(picker)) {
        activateNativeSelectMode(picker);
        // 선택 모드 활성화 후 약간의 딜레이로 클릭 시뮬레이션
        setTimeout(() => simulateNativeCheck(picker, img, e.shiftKey), 100);
      } else {
        simulateNativeCheck(picker, img, e.shiftKey);
      }
    }, true);
  }

  /** 네이티브 "선택 삭제" 버튼 클릭 → 선택 모드 진입 */
  function activateNativeSelectMode(picker) {
    const toolbar = picker.querySelector('.MuiToolbar-root');
    if (!toolbar) return;
    for (const btn of toolbar.querySelectorAll('button')) {
      const t = btn.textContent.trim();
      if (t.includes('선택') && t.includes('삭제') || t.includes('選択') && t.includes('削除')) {
        btn.click();
        return;
      }
    }
  }

  /** 네이티브 체크를 시뮬레이션 (이미지 클릭) */
  function simulateNativeCheck(picker, img, isShift) {
    if (isShift && _lastClickedIdx >= 0) {
      // 범위 선택
      const images = getPickerImages(picker);
      const currentIdx = images.indexOf(img);
      if (currentIdx === -1) return;

      const start = Math.min(_lastClickedIdx, currentIdx);
      const end = Math.max(_lastClickedIdx, currentIdx);

      for (let i = start; i <= end; i++) {
        const wrapper = images[i].parentElement;
        if (wrapper) {
          // 이미 선택된 건 건너뜀 (체크 상태 확인)
          const svgs = wrapper.querySelectorAll('svg:not(.bwbr-check):not(.bwbr-img-drag-badge)');
          let alreadySelected = false;
          for (const svg of svgs) {
            const circle = svg.querySelector('circle');
            if (circle && circle.getAttribute('fill') === '#2196F3') {
              alreadySelected = true;
              break;
            }
          }
          if (!alreadySelected) {
            wrapper.click();
          }
        }
      }
    } else {
      // 단일 클릭 — 래퍼 클릭으로 네이티브 토글
      const wrapper = img.parentElement;
      if (wrapper) wrapper.click();

      const images = getPickerImages(picker);
      _lastClickedIdx = images.indexOf(img);
    }
  }

  /* ══════════════════════════════════════════════════════
   *  드래그 배지 (복수 드래그 시 개수 표시)
   * ══════════════════════════════════════════════════════ */

  function createDragBadge(count) {
    const badge = document.createElement('div');
    badge.className = 'bwbr-img-drag-badge';
    Object.assign(badge.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      width: '40px', height: '40px', borderRadius: '50%',
      background: '#2196F3', color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '14px', fontWeight: 'bold',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)', zIndex: '10000'
    });
    badge.textContent = count;
    return badge;
  }

  /* ══════════════════════════════════════════════════════
   *  피커 초기화 & 정리
   * ══════════════════════════════════════════════════════ */

  async function initPicker(picker) {
    const group = getCurrentGroup(picker);
    _isGroupRoom = group === 'room';
    console.log(TAG, '피커 감지됨, group:', group);

    // Unsplash는 드래그 불가
    if (group === 'unsplash') return;

    const dir = getCurrentDir(picker);
    console.log(TAG, 'currentDir:', dir, 'tabs:', getCategoryTabs(picker).map(t => t.textContent.trim()));
    if (!dir) {
      console.warn(TAG, '⚠️ 카테고리 감지 실패 — tablist 구조 확인 필요');
      return;
    }

    // 파일 캐시 로드
    const roomId = _isGroupRoom ? getRoomIdFromUrl() : null;
    await refreshFileCache(dir, roomId);
    console.log(TAG, `파일 캐시: ${_fileCache.length}개 (dir=${dir}, roomId=${roomId})`);

    // 이벤트 위임 (1회) + draggable 속성
    setupPickerDelegation(picker);
    setupDraggableImages(picker);
    setupCtrlShiftClick(picker);

    // 탭 전환 / 이미지 로드 시 재설정 (디바운스)
    if (_pickerObs) _pickerObs.disconnect();
    let _debounceTimer = null;
    _pickerObs = new MutationObserver(() => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(async () => {
        const p = getPickerDialog();
        if (!p) return;

        // 항상 draggable 재설정 (React re-render 후에도)
        setupDraggableImages(p);

        // 자체 쓰기 중이면 캐시 갱신만 스킵
        if (_suppressObserver) return;

        const newGroup = getCurrentGroup(p);
        if (newGroup === 'unsplash') return;

        const newDir = getCurrentDir(p);
        const newIsRoom = newGroup === 'room';

        if (newDir && (newDir !== _currentDir || newIsRoom !== _isGroupRoom)) {
          _isGroupRoom = newIsRoom;
          await refreshFileCache(newDir, newIsRoom ? getRoomIdFromUrl() : null);
          _lastClickedIdx = -1;
          console.log(TAG, `탭 전환: group=${newGroup}, dir=${newDir}, 캐시 ${_fileCache.length}개`);
        }
      }, 150);
    });
    _pickerObs.observe(picker, { childList: true, subtree: true });
  }

  function cleanupPicker() {
    if (_pickerObs) { _pickerObs.disconnect(); _pickerObs = null; }
    _fileCache = [];
    _hashToFileId.clear();
    _urlToFileIdCache.clear();
    _currentDir = null;
    _dragHashes = [];
    _lastClickedIdx = -1;
  }

  /** URL에서 roomId 추출 */
  function getRoomIdFromUrl() {
    const m = window.location.pathname.match(/\/rooms\/([^/]+)/);
    return m ? m[1] : null;
  }

  /* ══════════════════════════════════════════════════════
   *  메인 옵저버: 피커 등장 → 초기화
   * ══════════════════════════════════════════════════════ */

  let _lastPickerState = false;

  const _mainObs = new MutationObserver(() => {
    const picker = getPickerDialog();
    const nowOpen = !!picker;

    if (!nowOpen) {
      if (_lastPickerState) cleanupPicker();
      _lastPickerState = false;
      return;
    }

    if (_lastPickerState) return;
    _lastPickerState = true;

    // 약간의 딜레이로 DOM 안정화 후 초기화
    setTimeout(() => {
      const p = getPickerDialog();
      if (p) initPicker(p);
    }, 200);
  });

  _mainObs.observe(document.body, { childList: true, subtree: true });

  console.log(TAG, '✅ 이미지 매니저 로드됨');

})();
