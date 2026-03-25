// MAIN world: 중클릭(button=1) → 좌클릭(button=0) 위장
// Chrome MV3에서 Object.defineProperty는 같은 JS world에서만 이벤트 객체에 적용됨
// ccfolia React가 MAIN world에서 n.nativeEvent.button을 읽으므로 MAIN world에서 실행 필요
// ccfolia onMouseDown: n.nativeEvent.button !== 0 이면 return (패닝 안 함)
(function() {
  var _midPanning = false;

  document.addEventListener('pointerdown', function(e) {
    if (e.button !== 1 || !e.isTrusted) return;
    _midPanning = true;
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
      // mouseup에서 _midPanning을 끄므로 여기서는 유지
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
      Object.defineProperty(e, 'button', { value: 0, configurable: true });
      Object.defineProperty(e, 'buttons', { value: 0, configurable: true });
    }
  }, true);
})();
