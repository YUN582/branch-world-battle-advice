/**
 * room-copy.js — 룸 데이터 내보내기/가져오기 (확장 프로그램 커스텀 버전)
 *
 * 코코포리아의 "룸 설정 → 룸 데이터" 섹션에 커스텀 내보내기/가져오기 버튼을 삽입합니다.
 * - 내보내기: Redux 상태에서 방 설정 + 캐릭터 + 스크린패널 데이터를 JSON으로 저장
 * - 가져오기: JSON 파일을 읽어 현재 방에 Firestore 직접 쓰기로 복원
 *
 * 통신:
 *   ISOLATED → bwbr-room-export → bwbr-room-export-result (MAIN)
 *   ISOLATED → DOM attr + bwbr-room-import → bwbr-room-import-result (MAIN)
 */
(function () {
  'use strict';

  // 중복 로드 방지
  if (window.__BWBR_ROOM_COPY_LOADED) return;
  window.__BWBR_ROOM_COPY_LOADED = true;

  const LOG_PREFIX = '%c[BWBR 룸복사]%c';
  const LOG_STYLE = 'color: #ce93d8; font-weight: bold;';
  const LOG_RESET = 'color: inherit;';

  function log(...args) {
    console.log(LOG_PREFIX, LOG_STYLE, LOG_RESET, ...args);
  }

  // ── 내보내기 섹션 탐지 키워드 (JP + KR) ─────────────────
  // "룸 데이터 내보내기" 섹션의 헤딩 텍스트
  const EXPORT_HEADING_KW = [
    '룸 데이터 내보내기',
    'ルームデータのエクスポート',
    'ルームデータをエクスポート',
    'Export room data'
  ];
  // "출력" 버튼 텍스트
  const EXPORT_BTN_KW = ['출력', 'エクスポート', 'Export'];

  // ── 사이드바 탭 "룸 데이터" 활성 상태 감지 키워드 ──────────
  const ROOM_DATA_TAB_KW = ['룸 데이터', 'ルームデータ', 'Room Data', 'Room data'];

  // ── 폴링 방식: 다이얼로그 & 탭 전환 감시 ─────────────────
  // 사이드바 모든 탭의 컨텐츠가 하나의 스크롤 영역에 있으므로,
  // "룸 데이터" 사이드바 탭이 활성(선택)일 때만 주입하고 다른 탭이면 제거

  let _pollTimer = null;

  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(pollForExportSection, 1000);
  }

  /**
   * 사이드바에서 "룸 데이터" 탭이 현재 활성(선택)인지 확인합니다.
   * 활성 탭은 backgroundColor가 투명이 아닌 값(rgba(255,255,255,0.06) 등)을 가짐.
   */
  function isRoomDataTabActive() {
    const lis = document.querySelectorAll('li[role="button"]');
    for (const li of lis) {
      const text = li.textContent.trim();
      let match = false;
      for (const kw of ROOM_DATA_TAB_KW) {
        if (text === kw) { match = true; break; }
      }
      if (!match) continue;
      const bg = getComputedStyle(li).backgroundColor;
      // 활성 탭: rgba(255,255,255,0.06) 등 불투명, 비활성: rgba(0,0,0,0) / transparent
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    }
    return false; // 탭을 찾지 못한 경우 (다이얼로그가 닫혀있음)
  }

  function pollForExportSection() {
    const existing = document.querySelector('.bwbr-room-copy-export-h2');
    const tabActive = isRoomDataTabActive();

    if (existing) {
      // 이미 삽입됨 → "룸 데이터" 탭이 비활성이면 제거
      if (!tabActive) {
        removeInjectedElements();
      }
      return;
    }

    // "룸 데이터" 탭이 활성일 때만 주입
    if (!tabActive) return;

    const info = findVisibleExportSection();
    if (info) {
      injectCopyButtons(info);
    }
  }

  /** 주입된 모든 확장 요소를 제거합니다. (탭 전환 시 정리) */
  function removeInjectedElements() {
    document.querySelectorAll('.bwbr-room-copy-export-h2, .bwbr-room-copy-section').forEach(el => el.remove());
    log('탭 전환 감지 — 주입 요소 제거');
  }

  /**
   * 페이지에서 "룸 데이터 내보내기" h2 헤딩을 찾고,
   * 그 바로 다음 형제 div (내용+출력 버튼)를 반환합니다.
   *
   * DOM 구조 (2026-02-25 확인):
   *   div.sc-eQlJbV (컨테이너, flat 구조)
   *     [0] h2 "룸 데이터 공개 링크 PRO"
   *     [1] div.sc-jMZZvJ (내용+버튼)
   *     [2] hr.MuiDivider
   *     [3] h2 "룸 데이터 가져오기"
   *     [4] div.sc-jMZZvJ (내용+버튼)
   *     [5] hr.MuiDivider
   *     [6] h2 "룸 데이터 내보내기 PRO"   ← 이것을 찾음
   *     [7] div.sc-jMZZvJ (내용+출력버튼) ← 이것 뒤에 삽입
   *
   * 반환: { heading: h2 요소, contentDiv: 내용 div, container: 부모 컨테이너 }
   */
  function findVisibleExportSection() {
    // 모든 h2에서 키워드 검색
    const headings = document.querySelectorAll('h2');
    for (const h2 of headings) {
      // 직접 텍스트 노드 확인
      let hasKeyword = false;
      for (const ch of h2.childNodes) {
        if (ch.nodeType === Node.TEXT_NODE) {
          const text = ch.textContent.trim();
          for (const kw of EXPORT_HEADING_KW) {
            if (text.includes(kw)) { hasKeyword = true; break; }
          }
        }
        if (hasKeyword) break;
      }
      if (!hasKeyword) continue;

      // 다음 형제 = 내용+출력 버튼 div
      const contentDiv = h2.nextElementSibling;
      if (!contentDiv || contentDiv.tagName !== 'DIV') continue;

      return {
        heading: h2,
        contentDiv: contentDiv,
        container: h2.parentElement
      };
    }
    return null;
  }

  /**
   * "룸 데이터 내보내기" 섹션 바로 아래에 네이티브와 동일한 패턴으로
   * hr + h2 + div(내용+버튼)을 삽입합니다.
   */
  function injectCopyButtons(info) {
    // 이미 삽입됨
    if (document.querySelector('.bwbr-room-copy-export-h2')) return;

    const { contentDiv, container } = info;
    log('룸 데이터 내보내기 섹션 발견 — 네이티브 스타일로 삽입');

    // ── 참조할 네이티브 스타일 클래스 복사 ──
    const nativeH2 = info.heading;
    const nativeDivider = container.querySelector('hr');
    const nativeContentDiv = contentDiv;

    // ── 구분선 (hr) — 네이티브 hr을 cloneNode(false) 해서 styled-components 마진 포함 ──
    const hr = nativeDivider ? nativeDivider.cloneNode(false) : document.createElement('hr');
    if (!nativeDivider) hr.className = 'MuiDivider-root MuiDivider-fullWidth';
    hr.style.margin = '40px 0px';
    hr.classList.add('bwbr-room-copy-section');

    // ── 네이티브 "출력" 버튼 & 텍스트 div 찾기 (클래스 복제용) ──
    const nativeBtn = contentDiv.querySelector('button');
    // 네이티브 contentDiv 구조: <div.sc-jMZZvJ> → [0]<div>(텍스트) + [1]<button>
    const nativeTextDiv = contentDiv.children[0]; // 텍스트를 감싸는 div

    // ── 내보내기 헤딩 (h2) ──
    const exportH2 = document.createElement('h2');
    exportH2.className = nativeH2.className;
    exportH2.classList.add('bwbr-room-copy-export-h2');
    exportH2.textContent = '확장 프로그램 룸 데이터 내보내기';
    exportH2.style.color = '#ce93d8';

    // ── 내보내기 내용 div — 네이티브 구조 완전 복제 ──
    const exportDiv = nativeContentDiv.cloneNode(false);
    exportDiv.classList.add('bwbr-room-copy-section');

    const exportDesc = nativeTextDiv ? nativeTextDiv.cloneNode(false) : document.createElement('div');
    exportDesc.textContent = '방 설정, 캐릭터, 스크린 패널 데이터를 JSON 파일로 저장합니다.';

    const exportBtn = cloneNativeButton(nativeBtn, '내보내기');
    exportBtn.classList.remove('Mui-disabled');
    exportBtn.disabled = false;
    exportBtn.addEventListener('click', handleExport);
    exportDiv.appendChild(exportDesc);
    exportDiv.appendChild(exportBtn);

    // ── 구분선 (hr) #2 ──
    const hr2 = nativeDivider ? nativeDivider.cloneNode(false) : document.createElement('hr');
    if (!nativeDivider) hr2.className = 'MuiDivider-root MuiDivider-fullWidth';
    hr2.style.margin = '40px 0px';
    hr2.classList.add('bwbr-room-copy-section');

    // ── 가져오기 헤딩 (h2) ──
    const importH2 = document.createElement('h2');
    importH2.className = nativeH2.className;
    importH2.classList.add('bwbr-room-copy-section');
    importH2.textContent = '확장 프로그램 룸 데이터 가져오기';
    importH2.style.color = '#90caf9';

    // ── 가져오기 내용 div ──
    const importDiv = nativeContentDiv.cloneNode(false);
    importDiv.classList.add('bwbr-room-copy-section');

    const importDesc = nativeTextDiv ? nativeTextDiv.cloneNode(false) : document.createElement('div');
    importDesc.textContent = '내보낸 JSON 파일을 현재 방에 가져옵니다. 기존 캐릭터/아이템은 유지되며 새로 추가됩니다.';

    const importBtn = cloneNativeButton(nativeBtn, '가져오기');
    importBtn.classList.remove('Mui-disabled');
    importBtn.disabled = false;
    importBtn.addEventListener('click', handleImport);

    // 숨겨진 파일 입력
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.classList.add('bwbr-room-import-file');

    importDiv.appendChild(importDesc);
    importDiv.appendChild(importBtn);
    importDiv.appendChild(fileInput);

    // ── 삽입: contentDiv (네이티브 내보내기의 내용div) 바로 뒤에 순서대로 ──
    contentDiv.insertAdjacentElement('afterend', hr);
    hr.insertAdjacentElement('afterend', exportH2);
    exportH2.insertAdjacentElement('afterend', exportDiv);
    exportDiv.insertAdjacentElement('afterend', hr2);
    hr2.insertAdjacentElement('afterend', importH2);
    importH2.insertAdjacentElement('afterend', importDiv);

    log('네이티브 스타일로 주입 완료');
  }

  /**
   * 네이티브 MUI 버튼을 복제하여 텍스트만 교체합니다.
   * 클래스, 인라인 스타일 등을 그대로 유지하여 완벽히 동일한 외형을 보장합니다.
   */
  function cloneNativeButton(nativeBtn, text) {
    if (nativeBtn) {
      const btn = nativeBtn.cloneNode(false);
      btn.textContent = text;
      btn.removeAttribute('id');
      return btn;
    }
    // 네이티브 버튼을 찾지 못했을 때 fallback
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = `
      min-width: 120px; padding: 7px 21px;
      border: 1px solid rgba(255,255,255,0.5); border-radius: 4px;
      background: transparent; color: #fff;
      font-size: 15px; font-weight: 500; cursor: pointer;
      white-space: nowrap; line-height: 1.75;
    `;
    return btn;
  }

  // ── 내보내기 핸들러 ─────────────────────────────────────

  let _exportBusy = false;

  function handleExport() {
    if (_exportBusy) return;
    _exportBusy = true;

    log('룸 데이터 내보내기 시작...');

    const handler = (e) => {
      window.removeEventListener('bwbr-room-export-result', handler);
      _exportBusy = false;

      const result = e.detail;

      if (!result || !result.success) {
        showToast('❌ 룸 데이터 내보내기 실패: ' + (result?.error || '알 수 없는 오류'), true);
        return;
      }

      // JSON 파일 다운로드
      const jsonStr = JSON.stringify(result.data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // 파일명: bwbr-room-{방이름}-{날짜}.json
      const safeName = (result.roomName || 'room')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 50);
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `bwbr-room-${safeName}-${dateStr}.json`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const charCount = result.data?.characters?.length || 0;
      const itemCount = result.data?.items?.length || 0;

      log(`✅ 룸 데이터 내보내기 완료: ${a.download} (캐릭터 ${charCount}, 아이템 ${itemCount})`);
      showToast(`📦 룸 데이터를 내보냈습니다 (캐릭터 ${charCount}개, 아이템 ${itemCount}개)`);
    };

    // 5초 타임아웃
    const timeout = setTimeout(() => {
      window.removeEventListener('bwbr-room-export-result', handler);
      _exportBusy = false;
      showToast('❌ 룸 데이터 내보내기 시간 초과', true);
    }, 5000);

    window.addEventListener('bwbr-room-export-result', (e) => {
      clearTimeout(timeout);
      handler(e);
    }, { once: true });

    window.dispatchEvent(new CustomEvent('bwbr-room-export'));
  }

  // ── 가져오기 핸들러 ─────────────────────────────────────

  let _importBusy = false;

  function handleImport() {
    if (_importBusy) return;

    const fileInput = document.querySelector('.bwbr-room-import-file');
    if (!fileInput) return;

    fileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      fileInput.value = ''; // 리셋

      log('룸 데이터 가져오기 파일 선택:', file.name);

      try {
        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          showToast('❌ JSON 파싱 실패: 올바른 파일인지 확인하세요', true);
          return;
        }

        // 기본 검증
        if (!data.version || !data.roomSettings) {
          showToast('❌ 유효하지 않은 룸 데이터 파일입니다', true);
          return;
        }

        // 선별 다이얼로그 표시
        showImportSelectionDialog(data, text);

      } catch (err) {
        _importBusy = false;
        showToast('❌ 파일을 읽을 수 없습니다: ' + err.message, true);
      }
    };

    fileInput.click();
  }

  // ── 가져오기 선별 다이얼로그 ───────────────────────────

  /**
   * 가져올 데이터를 선별할 수 있는 모달 다이얼로그를 표시합니다.
   * 체크박스로 방 설정 / 캐릭터(개별) / 아이템(개별)을 선택 가능합니다.
   */
  function showImportSelectionDialog(data, rawText) {
    // 기존 다이얼로그 제거
    const old = document.getElementById('bwbr-import-dialog');
    if (old) old.remove();

    const charCount = data.characters?.length || 0;
    const itemCount = data.items?.length || 0;
    const sourceName = data.roomName || '알 수 없음';

    // ── 오버레이 ──
    const overlay = document.createElement('div');
    overlay.id = 'bwbr-import-dialog';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 100000;
      background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
    `;

    // ── 다이얼로그 패널 ──
    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1e1e1e; border-radius: 8px;
      padding: 24px; width: 520px; max-height: 80vh;
      overflow-y: auto; color: #fff; font-size: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;

    // 타이틀
    const title = document.createElement('h2');
    title.style.cssText = 'margin: 0 0 8px; font-size: 18px; color: #90caf9;';
    title.textContent = '📥 룸 데이터 가져오기';
    panel.appendChild(title);

    // 원본 정보
    const info = document.createElement('div');
    info.style.cssText = 'margin-bottom: 16px; color: #aaa; font-size: 13px;';
    info.textContent = `원본 방: ${sourceName}`;
    panel.appendChild(info);

    // ── 카테고리별 체크박스 ──

    // 1. 방 설정
    const settingsSection = createCategorySection(
      '⚙️ 방 설정',
      '배경, 전경, 그리드, 필드 등의 방 설정을 덮어씁니다.',
      null // 개별 항목 없음
    );
    panel.appendChild(settingsSection.container);

    // 2. 캐릭터
    let charCheckboxes = [];
    if (charCount > 0) {
      const charItems = data.characters.map((c, i) => ({
        label: c.name || `캐릭터 #${i + 1}`,
        sublabel: c.active ? '활성' : '비활성',
        index: i
      }));
      const charSection = createCategorySection(
        `👤 캐릭터 (${charCount}개)`,
        '선택한 캐릭터를 현재 방에 추가합니다.',
        charItems
      );
      panel.appendChild(charSection.container);
      charCheckboxes = charSection.itemCheckboxes;
    }

    // 3. 아이템/스크린패널
    let itemCheckboxes = [];
    if (itemCount > 0) {
      const itemItems = data.items.map((item, i) => {
        const typeLabel = item.type === 'plane' ? '배경 패널' : '오브젝트';
        const name = item.memo?.split('\n')[0]?.slice(0, 30) || item.imageUrl?.split('/').pop()?.slice(0, 20) || `아이템 #${i + 1}`;
        return {
          label: name,
          sublabel: `${typeLabel} (${item.width}×${item.height})`,
          index: i
        };
      });
      const itemSection = createCategorySection(
        `🖼️ 스크린 패널/아이템 (${itemCount}개)`,
        '선택한 아이템을 현재 방에 추가합니다.',
        itemItems
      );
      panel.appendChild(itemSection.container);
      itemCheckboxes = itemSection.itemCheckboxes;
    }

    // ── 안내 문구 ──
    const note = document.createElement('div');
    note.style.cssText = 'margin-top: 12px; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 4px; color: #aaa; font-size: 12px; line-height: 1.5;';
    note.innerHTML = '※ 기존 캐릭터/아이템은 유지되고 새로 추가됩니다.<br>※ 방 설정을 선택하면 배경, 전경, 그리드 등이 가져온 데이터로 변경됩니다.';
    panel.appendChild(note);

    // ── 버튼 영역 ──
    const btnArea = document.createElement('div');
    btnArea.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '취소';
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = `
      padding: 8px 20px; border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
      background: transparent; color: #fff; font-size: 14px; cursor: pointer;
    `;
    cancelBtn.addEventListener('click', () => overlay.remove());

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '가져오기';
    confirmBtn.type = 'button';
    confirmBtn.style.cssText = `
      padding: 8px 20px; border: none; border-radius: 4px;
      background: #1976d2; color: #fff; font-size: 14px; cursor: pointer; font-weight: 500;
    `;
    confirmBtn.addEventListener('mouseenter', () => { confirmBtn.style.background = '#1565c0'; });
    confirmBtn.addEventListener('mouseleave', () => { confirmBtn.style.background = '#1976d2'; });

    confirmBtn.addEventListener('click', () => {
      const includeSettings = settingsSection.categoryCheckbox.checked;

      // 선택된 캐릭터 필터링
      const selectedChars = [];
      charCheckboxes.forEach((cb, i) => {
        if (cb.checked) selectedChars.push(data.characters[i]);
      });

      // 선택된 아이템 필터링
      const selectedItems = [];
      itemCheckboxes.forEach((cb, i) => {
        if (cb.checked) selectedItems.push(data.items[i]);
      });

      // 아무것도 선택하지 않은 경우
      if (!includeSettings && selectedChars.length === 0 && selectedItems.length === 0) {
        showToast('⚠️ 가져올 항목을 선택하세요', true);
        return;
      }

      overlay.remove();

      // 필터링된 데이터 조립
      const filteredData = {
        version: data.version,
        exportedAt: data.exportedAt,
        sourceRoomId: data.sourceRoomId,
        roomName: data.roomName,
        roomSettings: includeSettings ? data.roomSettings : null,
        characters: selectedChars,
        items: selectedItems
      };

      executeImport(filteredData);
    });

    btnArea.appendChild(cancelBtn);
    btnArea.appendChild(confirmBtn);
    panel.appendChild(btnArea);

    overlay.appendChild(panel);

    // 오버레이 클릭으로 닫기 (패널 외부)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  /**
   * 카테고리 섹션 (전체 선택 체크박스 + 개별 항목 체크박스)을 생성합니다.
   * @param {string} title - 카테고리 제목
   * @param {string} desc - 설명 텍스트
   * @param {Array|null} items - 개별 항목 목록 (null이면 개별 선택 없음)
   * @returns {{ container, categoryCheckbox, itemCheckboxes: HTMLInputElement[] }}
   */
  function createCategorySection(title, desc, items) {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden;';

    // 헤더 (카테고리 체크박스 + 제목)
    const header = document.createElement('label');
    header.style.cssText = `
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      background: rgba(255,255,255,0.05); cursor: pointer; user-select: none;
    `;

    const categoryCheckbox = document.createElement('input');
    categoryCheckbox.type = 'checkbox';
    categoryCheckbox.checked = true;
    categoryCheckbox.style.cssText = 'width: 16px; height: 16px; cursor: pointer; accent-color: #90caf9;';

    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = 'font-weight: 500; font-size: 14px;';
    titleSpan.textContent = title;

    header.appendChild(categoryCheckbox);
    header.appendChild(titleSpan);
    container.appendChild(header);

    // 설명
    const descEl = document.createElement('div');
    descEl.style.cssText = 'padding: 4px 12px 8px 36px; color: #aaa; font-size: 12px;';
    descEl.textContent = desc;
    container.appendChild(descEl);

    const itemCheckboxes = [];

    if (items && items.length > 0) {
      // 개별 항목 리스트
      const list = document.createElement('div');
      list.style.cssText = 'max-height: 200px; overflow-y: auto; border-top: 1px solid rgba(255,255,255,0.05);';

      for (const item of items) {
        const row = document.createElement('label');
        row.style.cssText = `
          display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 36px;
          cursor: pointer; user-select: none; font-size: 13px;
        `;
        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.03)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.style.cssText = 'width: 14px; height: 14px; cursor: pointer; accent-color: #90caf9;';

        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        labelSpan.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

        const sub = document.createElement('span');
        sub.textContent = item.sublabel;
        sub.style.cssText = 'color: #888; font-size: 11px; flex-shrink: 0;';

        row.appendChild(cb);
        row.appendChild(labelSpan);
        row.appendChild(sub);
        list.appendChild(row);
        itemCheckboxes.push(cb);
      }

      container.appendChild(list);

      // 카테고리 체크박스 ↔ 개별 항목 연동
      categoryCheckbox.addEventListener('change', () => {
        for (const cb of itemCheckboxes) cb.checked = categoryCheckbox.checked;
      });
      // 개별 항목 변경 시 카테고리 체크박스 상태 업데이트
      for (const cb of itemCheckboxes) {
        cb.addEventListener('change', () => {
          const allChecked = itemCheckboxes.every(c => c.checked);
          const noneChecked = itemCheckboxes.every(c => !c.checked);
          categoryCheckbox.checked = allChecked;
          categoryCheckbox.indeterminate = !allChecked && !noneChecked;
        });
      }
    }

    return { container, categoryCheckbox, itemCheckboxes };
  }

  /**
   * 필터링된 데이터를 MAIN world로 전달하여 가져오기를 실행합니다.
   */
  function executeImport(filteredData) {
    _importBusy = true;
    showToast('📥 룸 데이터 가져오는 중...', false, 0);

    // DOM 속성으로 데이터 전달 (ISOLATED → MAIN)
    document.documentElement.setAttribute(
      'data-bwbr-room-import',
      JSON.stringify(filteredData)
    );

    const handler = (e) => {
      _importBusy = false;
      clearToasts();
      const result = e.detail;

      if (result?.success) {
        const parts = [];
        if (result.settingsUpdated) parts.push('방 설정');
        if (result.charCount > 0) parts.push(`캐릭터 ${result.charCount}개`);
        if (result.itemCount > 0) parts.push(`아이템 ${result.itemCount}개`);
        const summary = parts.join(', ');
        log(`✅ 룸 데이터 가져오기 완료 (${summary})`);
        showToast(`📥 룸 데이터를 가져왔습니다! (${summary})`);
      } else {
        showToast('❌ 룸 데이터 가져오기 실패: ' + (result?.error || '알 수 없는 오류'), true);
      }
    };

    // 60초 타임아웃
    const timeout = setTimeout(() => {
      window.removeEventListener('bwbr-room-import-result', handler);
      _importBusy = false;
      clearToasts();
      showToast('❌ 룸 데이터 가져오기 시간 초과', true);
    }, 60000);

    window.addEventListener('bwbr-room-import-result', (e) => {
      clearTimeout(timeout);
      handler(e);
    }, { once: true });

    window.dispatchEvent(new CustomEvent('bwbr-room-import'));
  }

  // ── 토스트 메시지 ───────────────────────────────────────

  function getToastContainer() {
    let container = document.getElementById('bwbr-room-copy-toast');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bwbr-room-copy-toast';
      container.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        z-index: 99999; pointer-events: none;
        display: flex; flex-direction: column; align-items: center; gap: 8px;
      `;
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * 토스트 메시지를 표시합니다.
   * @param {string} msg - 표시할 메시지
   * @param {boolean} isError - 에러 스타일 적용 여부
   * @param {number} duration - 자동 소멸 시간(ms). 0이면 수동으로 clearToasts() 호출 필요.
   */
  function showToast(msg, isError = false, duration = 3500) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = 'bwbr-room-copy-toast-item';
    toast.style.cssText = `
      background: ${isError ? '#d32f2f' : '#323232'};
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.3s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      white-space: nowrap;
    `;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    if (duration > 0) {
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  }

  function clearToasts() {
    const container = document.getElementById('bwbr-room-copy-toast');
    if (container) {
      const items = container.querySelectorAll('.bwbr-room-copy-toast-item');
      items.forEach(t => t.remove());
    }
  }

  // ── 초기화 ──────────────────────────────────────────────
  startPolling();

  // 사이드바 탭 클릭 시 즉시 반응 (폴링 1초 딜레이 보완)
  document.addEventListener('click', (e) => {
    const li = e.target.closest?.('li[role="button"]');
    if (!li) return;
    // 탭 클릭 직후 즉시 체크 (DOM 업데이트 후)
    requestAnimationFrame(() => pollForExportSection());
  }, true);

  log('룸 복사 모듈 로드됨 (폴링 + 탭 클릭 감지)');

})();
