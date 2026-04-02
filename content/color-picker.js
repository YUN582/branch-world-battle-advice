// ============================================================
// Ccofolia Extension — Color Picker Enhancement
// 코코포리아 네이티브 색상 다이얼로그(TwitterPicker)에 HSV 컬러피커 추가
// MutationObserver로 다이얼로그 감지 → SV캔버스 + Hue바 주입
// ============================================================
(function () {
  'use strict';

  var PICKER_ID = 'ce-color-picker';
  var W = 246, SV_H = 130, HUE_H = 12;

  /* ── HSV ↔ RGB ↔ Hex ───────────────────────────────────── */

  function hsvToRgb(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (i % 6) {
      case 0: r=v;g=t;b=p; break; case 1: r=q;g=v;b=p; break;
      case 2: r=p;g=v;b=t; break; case 3: r=p;g=q;b=v; break;
      case 4: r=t;g=p;b=v; break; case 5: r=v;g=p;b=q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = mx ? d / mx : 0, v = mx;
    if (d) {
      switch (mx) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h, s, v];
  }

  function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length !== 6) return [224, 224, 224];
    return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
  }

  function rgbToHex(r, g, b) {
    return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
  }

  /* ── React controlled input bridge ──────────────────────── */
  // ISOLATED world의 native setter로 값 변경 → React의 value tracker를
  // 우회하여 onChange가 정상 동작함 (tracked value ≠ DOM value → change 감지)

  var _nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  ).set;

  function pushHex(input, hex) {
    if (!_nativeSetter) return;
    _nativeSetter.call(input, hex);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ── MutationObserver: 색상 다이얼로그 감지 ─────────────── */

  function tryInject() {
    var tp = document.querySelector('.MuiDialog-paper .twitter-picker');
    if (!tp) return;
    var paper = tp.closest('.MuiDialog-paper');
    if (!paper || paper.querySelector('#' + PICKER_ID)) return;
    inject(tp, paper);
  }

  var obs = new MutationObserver(tryInject);
  obs.observe(document.body, { childList: true, subtree: true });

  /* ── 컬러피커 주입 ─────────────────────────────────────── */

  function inject(tp, paper) {
    var hexInput = tp.querySelector('input[id^="rc-editable-input"]');
    if (!hexInput) return;

    // 현재 색상 파싱
    var rgb = hexToRgb(hexInput.value);
    var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    var h = hsv[0], s = hsv[1], v = hsv[2];

    // ── DOM 구성 ──
    var root = document.createElement('div');
    root.id = PICKER_ID;
    root.style.cssText = 'padding:15px 15px 6px;user-select:none;-webkit-user-select:none;';

    var svC = mkCanvas(W, SV_H, 'crosshair', '4px');
    root.appendChild(svC);

    var hueC = mkCanvas(W, HUE_H, 'pointer', '3px');
    hueC.style.marginTop = '8px';
    root.appendChild(hueC);

    // 다이얼로그 콘텐츠 최상단에 삽입
    var content = paper.querySelector('.MuiDialogContent-root');
    if (content) content.insertBefore(root, content.firstChild);

    // 2x 렌더링 (Retina)
    var svCtx = svC.getContext('2d');
    var hueCtx = hueC.getContext('2d');
    svCtx.scale(2, 2);
    hueCtx.scale(2, 2);

    // ── 그리기 ──

    function drawSV() {
      var c = hsvToRgb(h, 1, 1);
      svCtx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      svCtx.fillRect(0, 0, W, SV_H);

      var wg = svCtx.createLinearGradient(0, 0, W, 0);
      wg.addColorStop(0, '#fff');
      wg.addColorStop(1, 'rgba(255,255,255,0)');
      svCtx.fillStyle = wg;
      svCtx.fillRect(0, 0, W, SV_H);

      var bg = svCtx.createLinearGradient(0, 0, 0, SV_H);
      bg.addColorStop(0, 'rgba(0,0,0,0)');
      bg.addColorStop(1, '#000');
      svCtx.fillStyle = bg;
      svCtx.fillRect(0, 0, W, SV_H);

      // 선택 인디케이터
      var cx = s * W, cy = (1 - v) * SV_H;
      svCtx.beginPath();
      svCtx.arc(cx, cy, 6, 0, Math.PI * 2);
      svCtx.strokeStyle = (v > 0.5 && s < 0.5) ? '#000' : '#fff';
      svCtx.lineWidth = 1.5;
      svCtx.stroke();
    }

    function drawHue() {
      var grad = hueCtx.createLinearGradient(0, 0, W, 0);
      for (var i = 0; i <= 6; i++) {
        var c = hsvToRgb(i / 6, 1, 1);
        grad.addColorStop(Math.min(i / 6, 1), 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')');
      }
      hueCtx.fillStyle = grad;
      hueCtx.fillRect(0, 0, W, HUE_H);

      // 슬라이더 인디케이터
      var ix = h * W;
      hueCtx.fillStyle = '#fff';
      hueCtx.fillRect(ix - 3, -1, 6, HUE_H + 2);
      hueCtx.strokeStyle = 'rgba(0,0,0,0.4)';
      hueCtx.lineWidth = 1;
      hueCtx.strokeRect(ix - 3, -1, 6, HUE_H + 2);
    }

    function redraw() { drawSV(); drawHue(); }

    function commit() {
      var c = hsvToRgb(h, s, v);
      pushHex(hexInput, rgbToHex(c[0], c[1], c[2]));
    }

    // ── 포인터 드래그 ──

    addDrag(svC, function (xr, yr) {
      s = clamp01(xr);
      v = 1 - clamp01(yr);
      redraw();
      commit();
    });

    addDrag(hueC, function (xr) {
      h = clamp01(xr) * 0.9999;
      redraw();
      commit();
    });

    // ── 스와치 클릭 동기화 (외부 색상 변경 감지) ──

    var lastVal = hexInput.value;
    var poll = setInterval(function () {
      if (!document.body.contains(root)) { clearInterval(poll); return; }
      var cur = hexInput.value;
      if (cur !== lastVal) {
        lastVal = cur;
        var rgb2 = hexToRgb(cur.replace(/^#/, ''));
        var hsv2 = rgbToHsv(rgb2[0], rgb2[1], rgb2[2]);
        h = hsv2[0]; s = hsv2[1]; v = hsv2[2];
        redraw();
      }
    }, 150);

    // 초기 렌더
    redraw();
  }

  /* ── 유틸리티 ────────────────────────────────────────────── */

  function mkCanvas(w, h, cursor, radius) {
    var c = document.createElement('canvas');
    c.width = w * 2;
    c.height = h * 2;
    c.style.cssText = 'width:' + w + 'px;height:' + h + 'px;cursor:' + cursor +
      ';border-radius:' + radius + ';display:block;touch-action:none;';
    return c;
  }

  function addDrag(canvas, onMove) {
    var dragging = false;
    function pick(e) {
      var r = canvas.getBoundingClientRect();
      onMove((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }
    canvas.addEventListener('pointerdown', function (e) {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (dragging) pick(e);
    });
    canvas.addEventListener('pointerup', function () { dragging = false; });
    canvas.addEventListener('lostpointercapture', function () { dragging = false; });
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
})();
