/**
 * face-bulk-add.js  — 표정(faces) 일괄 추가
 *
 * 캐릭터 편집 다이얼로그가 열려 있는 상태에서 이미지 피커가 열리면
 * 툴바에 "선택 추가" 버튼이 주입된다 (기본은 단일 선택).
 * "선택 추가" 클릭 시 다중 선택 모드가 활성화된다.
 * 네이티브 "선택 삭제" 스타일과 동일한 SVG 체크 서클을 사용한다.
 *
 * ● 네이티브 "선택 삭제" 모드와 공존:
 *   삭제 모드 진입 시 확장 UI를 자동 비활성화 (pointer-events: none)
 *   → 네이티브 삭제 동작을 보장한다.
 *
 * 파일명(img.alt)에서 확장자를 제거하여 @파일명 형태로 표정 이름을 자동 설정한다.
 * 크로스-월드: BWBR_Bridge.request() (window, DOM 속성 브릿지)
 */
(function () {
  'use strict';

  const TAG = '[CE 표정일괄]';
  const SVGNS = 'http://www.w3.org/2000/svg';
  // 네이티브 체크마크 SVG 패스 (ccfolia 원본과 동일)
  const CHECK_D = 'M6.57109 11.5L3.24609 8.175L4.07734 7.34375L6.57109 9.8375L11.9232 4.48541L12.7544 5.31666L6.57109 11.5Z';

  /* ── state ───────────────────────────────────────────── */
  let _active    = false;
  let _selected  = new Map();     // src → { label, iconUrl }
  let _pickerObs = null;

  /* ══════════════════════════════════════════════════════════
   *  DOM 헬퍼
   * ══════════════════════════════════════════════════════════ */

  function getPickerDialog() {
    return document.querySelector('.MuiDialog-paperWidthMd[role="dialog"]');
  }

  function getCharEditDialog() {
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      if (d.classList.contains('MuiDialog-paperWidthMd')) continue;
      for (const h of d.querySelectorAll('h6')) {
        const t = h.textContent.trim();
        if (t === 'スタンド' || t === '스탠딩') return d;
      }
    }
    return null;
  }

  function getPickerImages(picker) {
    const out = [];
    for (const img of picker.querySelectorAll('img')) {
      if (!img.src || !img.src.startsWith('https://')) continue;
      if (img.closest('button') || img.closest('header') || img.closest('[role="tab"]')) continue;
      if (img.naturalWidth > 0 && img.naturalWidth < 40) continue;
      out.push(img);
    }
    return out;
  }

  function getDialogActions(picker) {
    return picker.querySelector('.MuiDialogActions-root');
  }

  /** 네이티브 "선택 삭제" 모드 여부 (툴바에 "취소" 버튼 존재 확인) */
  function isNativeDeleteMode(picker) {
    const toolbar = picker.querySelector('.MuiToolbar-root');
    if (!toolbar) return false;
    for (const btn of toolbar.querySelectorAll('button')) {
      const t = btn.textContent.trim();
      if (t === '취소' || t === 'キャンセル' || t === 'Cancel') return true;
    }
    return false;
  }

  /* ══════════════════════════════════════════════════════════
   *  네이티브 스타일 SVG 체크마크 (ccfolia "선택 삭제" 와 동일)
   *
   *  ● 미선택: 반투명 원 (fill rgba(0,0,0,0.3), stroke rgba(255,255,255,0.8))
   *  ● 선택됨: 파란 원 (fill #2196F3, stroke white) + 체크마크 path
   *  ● 위치: position absolute, top 4px, left 4px (원본과 동일)
   * ══════════════════════════════════════════════════════════ */

  function createCheckSVG() {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.classList.add('bwbr-check');
    Object.assign(svg.style, {
      position: 'absolute', top: '4px', left: '4px',
      width: '16px', height: '16px', zIndex: '15',
      pointerEvents: 'none', transition: 'opacity .12s'
    });

    const circle = document.createElementNS(SVGNS, 'circle');
    circle.setAttribute('cx', '8');
    circle.setAttribute('cy', '8');
    circle.setAttribute('r', '7.5');
    circle.setAttribute('fill', 'rgba(0,0,0,0.3)');
    circle.setAttribute('stroke', 'rgba(255,255,255,0.8)');
    svg.appendChild(circle);

    return svg;
  }

  function paintCheck(svg, selected) {
    const circle = svg.querySelector('circle');
    if (selected) {
      circle.setAttribute('fill', '#2196F3');
      circle.setAttribute('stroke', 'white');
      if (!svg.querySelector('path')) {
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', CHECK_D);
        p.setAttribute('fill', 'white');
        svg.appendChild(p);
      }
    } else {
      circle.setAttribute('fill', 'rgba(0,0,0,0.3)');
      circle.setAttribute('stroke', 'rgba(255,255,255,0.8)');
      const p = svg.querySelector('path');
      if (p) p.remove();
    }
  }

  /* ══════════════════════════════════════════════════════════
   *  하단 "추가" 버튼 — 닫기 옆
   * ══════════════════════════════════════════════════════════ */

  function injectAddButton(picker) {
    const actions = getDialogActions(picker);
    if (!actions || actions.querySelector('.bwbr-face-add-btn')) return;

    const closeBtn = actions.querySelector('button');
    const addBtn = closeBtn
      ? closeBtn.cloneNode(false)
      : document.createElement('button');
    addBtn.className = (closeBtn ? closeBtn.className : '') + ' bwbr-face-add-btn';
    addBtn.textContent = '추가 (0)';
    addBtn.disabled = true;
    addBtn.style.opacity = '0.5';

    addBtn.addEventListener('click', onConfirm);

    if (closeBtn) actions.insertBefore(addBtn, closeBtn);
    else actions.appendChild(addBtn);

    refreshAddButton();
  }

  function refreshAddButton() {
    const n = _selected.size;
    const btn = document.querySelector('.bwbr-face-add-btn');
    if (!btn) return;
    btn.disabled = n === 0;
    btn.style.opacity = n > 0 ? '1' : '0.5';
    btn.textContent = `추가 (${n})`;
  }

  /* ══════════════════════════════════════════════════════════
   *  다중 선택 — 투명 오버레이 + 네이티브 SVG 체크
   * ══════════════════════════════════════════════════════════ */

  function enableMultiSelect(picker) {
    _active  = true;
    _selected.clear();
    applyMarkers(picker);
    injectAddButton(picker);

    // 탭 전환 / 이미지 로드 시 마커 재적용
    if (_pickerObs) _pickerObs.disconnect();
    _pickerObs = new MutationObserver(() => {
      if (_active) {
        applyMarkers(picker);
        syncDeleteModeVisibility(picker);
      }
    });
    _pickerObs.observe(picker, { childList: true, subtree: true });
  }

  function applyMarkers(picker) {
    for (const img of getPickerImages(picker)) {
      const wrapper = img.parentElement;
      if (!wrapper || wrapper.querySelector('.bwbr-img-overlay')) continue;

      if (getComputedStyle(wrapper).position === 'static') {
        wrapper.style.position = 'relative';
      }

      // 투명 오버레이 (클릭 인터셉트 전용, 배경 없음)
      const overlay = document.createElement('div');
      overlay.className = 'bwbr-img-overlay';
      Object.assign(overlay.style, {
        position: 'absolute', inset: '0', zIndex: '10',
        cursor: 'pointer', background: 'transparent',
        borderRadius: '4px'
      });

      // 네이티브 스타일 SVG 체크마크
      const svg = createCheckSVG();
      overlay.appendChild(svg);

      // 파일명 라벨
      const rawName = (img.alt || '').replace(/\.[^.]+$/, '').trim();
      if (rawName) {
        const label = document.createElement('div');
        label.className = 'bwbr-img-label';
        label.textContent = rawName;
        Object.assign(label.style, {
          position: 'absolute', bottom: '0', left: '0', right: '0',
          background: 'rgba(0,0,0,0.65)', color: '#eee',
          fontSize: '10px', padding: '2px 4px', textAlign: 'center',
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          pointerEvents: 'none', borderRadius: '0 0 4px 4px'
        });
        overlay.appendChild(label);
      }

      // 선택 상태 복원 (탭 전환 대응)
      if (_selected.has(img.src)) {
        paintCheck(svg, true);
        overlay.style.background = 'rgba(33,150,243,0.25)';
      }

      // 클릭 → 토글
      overlay.addEventListener('click', e => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        const src = img.src;
        if (_selected.has(src)) {
          _selected.delete(src);
          paintCheck(svg, false);
          overlay.style.background = 'transparent';
        } else {
          const rawLabel = (img.alt || '').replace(/\.[^.]+$/, '').trim() || 'face';
          _selected.set(src, { label: '@' + rawLabel, iconUrl: src });
          paintCheck(svg, true);
          overlay.style.background = 'rgba(33,150,243,0.25)';
        }
        refreshAddButton();
      }, true);

      wrapper.appendChild(overlay);
    }

    syncDeleteModeVisibility(picker);
  }

  /** 네이티브 삭제 모드 ↔ 확장 선택 모드 자동 전환 */
  function syncDeleteModeVisibility(picker) {
    const deleteMode = isNativeDeleteMode(picker);
    // 오버레이 이벤트 투과 전환
    for (const ov of picker.querySelectorAll('.bwbr-img-overlay')) {
      ov.style.pointerEvents = deleteMode ? 'none' : 'auto';
    }
    // 확장 SVG 체크 + 라벨 숨기기
    for (const el of picker.querySelectorAll('.bwbr-check, .bwbr-img-label')) {
      el.style.display = deleteMode ? 'none' : '';
    }
    // 추가 버튼 숨기기
    const addBtn = document.querySelector('.bwbr-face-add-btn');
    if (addBtn) addBtn.style.display = deleteMode ? 'none' : '';
    // "선택 추가" 버튼 숨기기
    const bulkBtn = picker.querySelector('.bwbr-bulk-add-btn');
    if (bulkBtn) bulkBtn.style.display = deleteMode ? 'none' : '';
  }

  /* ══════════════════════════════════════════════════════════
   *  "선택 추가" 툴바 버튼 — 복수 선택 모드 진입/종료
   * ══════════════════════════════════════════════════════════ */

  function injectBulkAddButton(picker) {
    const toolbar = picker.querySelector('.MuiToolbar-root');
    if (!toolbar) {
      // 툴바가 아직 없으면 재시도
      setTimeout(() => { if (getPickerDialog()) injectBulkAddButton(picker); }, 300);
      return;
    }
    if (toolbar.querySelector('.bwbr-bulk-add-btn')) return;

    // 네이티브 "선택 삭제" 버튼 찾기 (스타일 + 위치 참조)
    let refBtn = null;
    for (const b of toolbar.querySelectorAll('button')) {
      const t = b.textContent.trim();
      if (t.includes('삭제') || t.includes('削除')) { refBtn = b; break; }
    }

    const btn = document.createElement('button');
    btn.className = 'bwbr-bulk-add-btn';
    // 네이티브 버튼 클래스 복사 → 동일 MUI 스타일 적용
    if (refBtn) {
      for (const cls of refBtn.classList) {
        if (!cls.startsWith('bwbr')) btn.classList.add(cls);
      }
    }
    btn.textContent = '선택 추가';

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (isNativeDeleteMode(picker)) return;

      if (_active) {
        disableMultiSelect();
        btn.textContent = '선택 추가';
      } else {
        enableMultiSelect(picker);
        btn.textContent = '선택 완료';
      }
    });

    if (refBtn) refBtn.parentElement.insertBefore(btn, refBtn);
    else toolbar.appendChild(btn);
  }

  /** 다중 선택 모드 비활성화 (툴바 버튼은 유지) */
  function disableMultiSelect() {
    _active = false;
    _selected.clear();
    if (_pickerObs) { _pickerObs.disconnect(); _pickerObs = null; }
    document.querySelectorAll('.bwbr-img-overlay, .bwbr-face-add-btn').forEach(el => el.remove());
  }

  /* ══════════════════════════════════════════════════════════
   *  확인 → Firestore (BWBR_Bridge)
   * ══════════════════════════════════════════════════════════ */

  async function onConfirm() {
    const faces = Array.from(_selected.values());
    if (faces.length === 0) return;

    console.log(TAG, `표정 ${faces.length}장 추가 요청`);

    const btn = document.querySelector('.bwbr-face-add-btn');
    if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

    try {
      const result = await BWBR_Bridge.request(
        'bwbr-add-faces-bulk', 'bwbr-add-faces-bulk-result',
        { faces },
        {
          sendAttr: 'data-bwbr-add-faces-bulk',
          recvAttr: 'data-bwbr-add-faces-bulk-result',
          timeout: 10000
        }
      );

      if (result?.success) {
        console.log(TAG, `✅ ${result.count}장 추가 완료`);
      } else {
        console.error(TAG, '❌ 추가 실패:', result?.error);
        window.alert('표정 추가 실패: ' + (result?.error || '알 수 없는 오류'));
      }
    } catch (err) {
      console.error(TAG, '❌ 타임아웃/오류:', err.message);
      window.alert('표정 추가 실패: ' + err.message);
    }

    disableMultiSelect();
    const bulkBtn = document.querySelector('.bwbr-bulk-add-btn');
    if (bulkBtn) bulkBtn.textContent = '선택 추가';
  }

  /* ══════════════════════════════════════════════════════════
   *  정리
   * ══════════════════════════════════════════════════════════ */

  function fullCleanup() {
    _active = false;
    _selected.clear();
    if (_pickerObs) { _pickerObs.disconnect(); _pickerObs = null; }
    document.querySelectorAll('.bwbr-img-overlay, .bwbr-face-add-btn, .bwbr-bulk-add-btn').forEach(el => el.remove());
  }

  /* ══════════════════════════════════════════════════════════
   *  메인 옵저버: 피커 등장 → 툴바 버튼 주입
   * ══════════════════════════════════════════════════════════ */

  let _lastPickerState = false;

  const _mainObs = new MutationObserver(() => {
    const picker = getPickerDialog();
    const nowOpen = !!picker;

    if (!nowOpen) {
      if (_lastPickerState) fullCleanup();
      _lastPickerState = false;
      return;
    }

    if (_lastPickerState) return;   // 이미 처리됨
    _lastPickerState = true;

    // 캐릭터 편집 다이얼로그가 없으면 무시
    if (!getCharEditDialog()) return;

    // 툴바에 "선택 추가" 버튼 주입 (기본: 단일 선택)
    injectBulkAddButton(picker);
  });

  _mainObs.observe(document.body, { childList: true, subtree: true });

  console.log(
    '%c[CE]%c 표정 일괄 추가 모듈 로드',
    'color: #2196F3; font-weight: bold;', 'color: inherit;'
  );
})();
