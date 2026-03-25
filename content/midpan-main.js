// MAIN world: 중클릭(button=1) → 좌클릭(button=0) 위장
// Chrome MV3에서 Object.defineProperty는 같은 JS world에서만 이벤트 객체에 적용됨
// ccfolia React가 MAIN world에서 n.nativeEvent.button을 읽으므로 MAIN world에서 실행 필요
// ccfolia onMouseDown: n.nativeEvent.button !== 0 이면 return (패닝 안 함)
(function() {
  var _midPanning = false;
  var _overlayEl = null;  // 배치 오버레이 참조 (패닝 중 pointer-events: none)

  document.addEventListener('pointerdown', function(e) {
    if (e.button !== 1 || !e.isTrusted) return;
    // 텍스트 편집 중 패닝 차단
    if (document.documentElement.getAttribute('data-bwbr-text-editing') === '1') return;
    _midPanning = true;
    document.documentElement.setAttribute('data-bwbr-midpan', '1');

    // 배치 오버레이가 이벤트를 흡수하면 보드에 직접 전달
    var overlay = e.target.closest ? e.target.closest('.bwbr-placement-overlay') : null;
    if (overlay) {
      _overlayEl = overlay;
      _overlayEl.style.pointerEvents = 'none';
      var under = document.elementFromPoint(e.clientX, e.clientY);
      if (under) {
        under.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, composed: true,
          clientX: e.clientX, clientY: e.clientY,
          screenX: e.screenX, screenY: e.screenY,
          button: 0, buttons: 1,
          pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary
        }));
        under.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, composed: true,
          clientX: e.clientX, clientY: e.clientY,
          screenX: e.screenX, screenY: e.screenY,
          button: 0, buttons: 1
        }));
      }
    }

    Object.defineProperty(e, 'button', { value: 0, configurable: true });
    Object.defineProperty(e, 'buttons', { value: 1, configurable: true });
  }, true);

  document.addEventListener('pointermove', function(e) {
    if (!_midPanning || !e.isTrusted) return;
    Object.defineProperty(e, 'buttons', { value: 1, configurable: true });
  }, true);

  document.addEventListener('pointerup', function(e) {
    if (!_midPanning || !e.isTrusted) return;
    if (e.button === 1) {
      Object.defineProperty(e, 'button', { value: 0, configurable: true });
      Object.defineProperty(e, 'buttons', { value: 0, configurable: true });
    }
  }, true);

  document.addEventListener('mousedown', function(e) {
    if (e.button === 1) e.preventDefault(); // 자동 스크롤 방지
    if (!_midPanning || !e.isTrusted) return;
    if (e.button === 1) {
      Object.defineProperty(e, 'button', { value: 0, configurable: true });
      Object.defineProperty(e, 'buttons', { value: 1, configurable: true });
    }
  }, true);

  document.addEventListener('mousemove', function(e) {
    if (!_midPanning || !e.isTrusted) return;
    Object.defineProperty(e, 'buttons', { value: 1, configurable: true });
  }, true);

  document.addEventListener('mouseup', function(e) {
    if (!_midPanning || !e.isTrusted) return;
    if (e.button === 1) {
      _midPanning = false;
      document.documentElement.removeAttribute('data-bwbr-midpan');
      Object.defineProperty(e, 'button', { value: 0, configurable: true });
      Object.defineProperty(e, 'buttons', { value: 0, configurable: true });
      if (_overlayEl) {
        _overlayEl.style.pointerEvents = '';
        _overlayEl = null;
      }
    }
  }, true);
})();
