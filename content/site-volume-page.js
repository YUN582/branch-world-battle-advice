// ============================================================
// Branch World Battle Roll - 페이지 레벨 음량 패치
// 이 파일은 페이지 컨텍스트에서 실행됩니다 (content script 아님).
// ============================================================

(function () {
  if (window.__BWBR_SITE_VOL) return;
  var _vol = 1.0;

  /* ── 1. HTMLMediaElement.volume 오버라이드 ── */
  var _vDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
  var _media = new Set();

  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    get: function () { return this.__bv !== undefined ? this.__bv : _vDesc.get.call(this); },
    set: function (v) {
      this.__bv = v;
      _vDesc.set.call(this, Math.max(0, Math.min(1, v * _vol)));
      _media.add(this);
    },
    configurable: true
  });

  /* ── 2. Audio 생성자 래핑 ── */
  var _Audio = window.Audio;
  function A(src) { var a = new _Audio(src); _media.add(a); return a; }
  A.prototype = _Audio.prototype;
  window.Audio = A;

  /* ── 3. Web Audio API: destination 앞에 마스터 게인 삽입 ── */
  var _gains = [];
  var _origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest) {
    if (dest instanceof AudioDestinationNode) {
      var ctx = dest.context;
      if (!ctx.__bwg) {
        ctx.__bwg = ctx.createGain();
        ctx.__bwg.gain.value = _vol;
        _origConnect.call(ctx.__bwg, dest);
        _gains.push(ctx.__bwg);
      }
      var args = Array.prototype.slice.call(arguments);
      args[0] = ctx.__bwg;
      return _origConnect.apply(this, args);
    }
    return _origConnect.apply(this, arguments);
  };

  /* ── 볼륨 변경 ── */
  function apply() {
    // GC 대상 media element 정리 (DOM에서 제거됐고 참조 없는 것들)
    _media.forEach(function (el) {
      if (!el.parentNode && el.paused && el.readyState === 0) {
        _media.delete(el);
      }
    });
    _media.forEach(function (el) {
      if (el.__bv !== undefined) _vDesc.set.call(el, Math.max(0, Math.min(1, el.__bv * _vol)));
    });
    _gains.forEach(function (g) { g.gain.value = _vol; });
  }

  window.addEventListener('bwbr-set-site-volume', function (e) {
    _vol = e.detail.volume;
    apply();
  });

  window.__BWBR_SITE_VOL = { apply: apply, vol: function () { return _vol; } };
})();
