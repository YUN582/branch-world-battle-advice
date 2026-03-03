/**
 * drag-reorder.js — 캐릭터 편집 다이얼로그에서
 * 스테이터스 / 매개변수 행을 드래그 앤 드롭으로 순서 변경
 *
 * React controlled input이므로 DOM 노드를 이동하지 않고,
 * 드롭 시 input 값만 재배치한 뒤 native setter → input/change 이벤트로
 * React 상태를 갱신한다.
 */
(function () {
  'use strict';

  const TAG = '[CE 순서변경]';

  /* ── React input value 브릿지 ────────────────────────── */
  const _nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  ).set;

  function setInputValue(input, val) {
    _nativeSetter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ── DOM 헬퍼 ─────────────────────────────────────────── */

  /** 편집 다이얼로그 내 "스테이터스" / "매개변수" 섹션의 행 목록 반환 */
  function getSectionRows(dlg, sectionTitle) {
    for (const h of dlg.querySelectorAll('h6')) {
      if (h.textContent.trim() !== sectionTitle) continue;
      const toolbar = h.parentElement; // MuiToolbar-root
      const rows = [];
      let sib = toolbar.nextElementSibling;
      while (sib) {
        // 다음 섹션 헤더(Toolbar)에 도달하면 중단
        if (sib.classList.contains('MuiToolbar-root')) break;
        // sc-ganImS 행만 수집 (SPAN 설명문 등 건너뜀)
        if (sib.tagName === 'DIV' && sib.querySelectorAll('input').length >= 2) {
          rows.push(sib);
        }
        sib = sib.nextElementSibling;
      }
      return rows;
    }
    return [];
  }

  /** 행에서 input 값 읽기 → {label, value, max?} */
  function readRow(row) {
    const inputs = row.querySelectorAll('input');
    const d = { label: inputs[0]?.value || '' };
    if (inputs[1]) d.value = inputs[1].value || '';
    if (inputs[2]) d.max = inputs[2].value || '';
    return d;
  }

  /** 행에 값 쓰기 (React bridge) */
  function writeRow(row, data) {
    const inputs = row.querySelectorAll('input');
    if (inputs[0]) setInputValue(inputs[0], data.label);
    if (inputs[1]) setInputValue(inputs[1], data.value);
    if (inputs[2] && data.max !== undefined) setInputValue(inputs[2], data.max);
  }

  /* ── 드래그 앤 드롭 ──────────────────────────────────── */

  let _dragIdx = -1;  // 드래그 시작 인덱스
  let _rows = [];     // 현재 섹션의 행 목록

  function addDragHandles(rows) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.querySelector('.bwbr-drag-handle')) continue;

      // row를 relative로
      row.style.position = 'relative';

      const handle = document.createElement('div');
      handle.className = 'bwbr-drag-handle';
      handle.textContent = '⠿';
      handle.draggable = true;
      handle.dataset.idx = i;
      Object.assign(handle.style, {
        position: 'absolute', left: '-24px', top: '50%', transform: 'translateY(-50%)',
        width: '20px', height: '24px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'grab', color: 'rgba(255,255,255,0.4)',
        fontSize: '14px', userSelect: 'none', zIndex: '5',
        borderRadius: '3px', transition: 'color .15s, background .15s'
      });
      handle.addEventListener('mouseenter', () => {
        handle.style.color = 'rgba(255,255,255,0.8)';
        handle.style.background = 'rgba(255,255,255,0.08)';
      });
      handle.addEventListener('mouseleave', () => {
        handle.style.color = 'rgba(255,255,255,0.4)';
        handle.style.background = 'transparent';
      });

      // 행 전체를 드래그 가능하게
      row.draggable = true;
      row.style.transition = 'background .15s, transform .15s';

      // ── 드래그 이벤트 (handle에서 시작) ──
      handle.addEventListener('dragstart', e => {
        _dragIdx = parseInt(handle.dataset.idx, 10);
        _rows = rows;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setDragImage(row, 30, row.offsetHeight / 2);
        requestAnimationFrame(() => {
          row.style.opacity = '0.4';
        });
      });

      // 행에서도 dragstart (핸들이 아닌 곳에서 시작하면 취소)
      row.addEventListener('dragstart', e => {
        if (!e.target.classList.contains('bwbr-drag-handle') &&
            !e.target.closest('.bwbr-drag-handle')) {
          e.preventDefault();
        }
      });

      row.addEventListener('dragend', () => {
        row.style.opacity = '1';
        clearHighlights(rows);
      });

      row.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearHighlights(rows);
        // 드롭 위치 표시: 상/하단에 파란 라인
        const rect = row.getBoundingClientRect();
        const isAbove = e.clientY < rect.top + rect.height / 2;
        row.style.borderTop = isAbove ? '2px solid #2196F3' : '';
        row.style.borderBottom = isAbove ? '' : '2px solid #2196F3';
      });

      row.addEventListener('dragleave', () => {
        row.style.borderTop = '';
        row.style.borderBottom = '';
      });

      row.addEventListener('drop', e => {
        e.preventDefault();
        const dropIdx = parseInt(handle.dataset.idx, 10);
        if (_dragIdx >= 0 && _dragIdx !== dropIdx && _rows === rows) {
          reorder(rows, _dragIdx, dropIdx);
        }
        _dragIdx = -1;
        clearHighlights(rows);
      });

      row.insertBefore(handle, row.firstChild);
    }
  }

  function clearHighlights(rows) {
    for (const r of rows) {
      r.style.borderTop = '';
      r.style.borderBottom = '';
      r.style.background = '';
    }
  }

  /** 행 배열에서 fromIdx → toIdx로 이동, 모든 input 값 재배치 */
  function reorder(rows, fromIdx, toIdx) {
    // 1) 모든 행의 현재 값 읽기
    const data = rows.map(readRow);

    // 2) 배열 내 이동
    const [item] = data.splice(fromIdx, 1);
    data.splice(toIdx, 0, item);

    // 3) 모든 행에 새 값 쓰기
    for (let i = 0; i < rows.length; i++) {
      writeRow(rows[i], data[i]);
    }

    // 4) 시각 피드백
    rows[toIdx].style.background = 'rgba(33,150,243,0.15)';
    setTimeout(() => { rows[toIdx].style.background = ''; }, 400);

    console.log(TAG, `${fromIdx} → ${toIdx} 이동 완료`);
  }

  /* ── 메인 옵저버: 편집 다이얼로그 감지 ──────────────── */

  let _lastDlg = null;

  const _obs = new MutationObserver(() => {
    const dlg = document.querySelector(
      '[role="dialog"]:not(.MuiDialog-paperWidthMd)'
    );
    if (!dlg || dlg === _lastDlg) return;

    // 스테이터스 / 매개변수 섹션이 있는지 확인
    let hasSection = false;
    for (const h of dlg.querySelectorAll('h6')) {
      const t = h.textContent.trim();
      if (t === '스테이터스' || t === '매개변수' ||
          t === 'ステータス' || t === 'パラメータ') {
        hasSection = true;
        break;
      }
    }
    if (!hasSection) return;
    _lastDlg = dlg;

    // rows가 React 렌더링으로 약간 지연될 수 있으니 짧은 대기
    setTimeout(() => inject(dlg), 150);
  });

  function inject(dlg) {
    const pairs = [
      ['스테이터스', 'ステータス'],
      ['매개변수', 'パラメータ']
    ];
    for (const [ko, ja] of pairs) {
      let rows = getSectionRows(dlg, ko);
      if (!rows.length) rows = getSectionRows(dlg, ja);
      if (rows.length >= 2) {
        addDragHandles(rows);
      }
    }
  }

  _obs.observe(document.body, { childList: true, subtree: true });

  console.log(
    '%c[CE]%c 스탯/매개변수 순서 변경 모듈 로드',
    'color: #4caf50; font-weight: bold;', 'color: inherit;'
  );
})();
