// ============================================================
// [TRIGGER] Branch World Advice - 트리거 관리 UI
// 코코포리아 룸 변수 다이얼로그와 동일한 MUI Dialog 구조 복제
// ============================================================

(function () {
  'use strict';

  var DIALOG_ID = 'bwbr-trigger-mgr';
  var STYLE_ID  = 'bwbr-trigger-mgr-style';
  var BTN_ID    = 'bwbr-toolbar-trigger-btn';

  var triggerEngine = null;
  var overlayEl     = null;
  var dialogEl      = null;
  var editingId     = null;

  // ══════════════════════════════════════════════════════════
  //  방 변수 다이얼로그에서 확인된 정확한 값 (2026-02-27)
  //
  //  paper bg     : rgba(44,44,44,0.87)   ← 반투명!
  //  backdrop bg  : rgba(0,0,0,0.5)
  //  backdrop fade: opacity 0.225s cubic-bezier(0.4,0,0.2,1)
  //  title        : H6, 14px, 700, white
  //  action btn   : rgb(33,150,243), transparent bg, 14px
  //  content pad  : 20px 24px
  //  paper        : 600px, 4px radius, 32px margin, elev-24
  // ══════════════════════════════════════════════════════════

  var T = {
    paper:     'rgba(44,44,44,0.87)',
    paperSolid:'rgb(50,50,50)',
    bg:        'rgba(0,0,0,0.5)',
    text:      'rgb(255,255,255)',
    textSec:   'rgba(255,255,255,0.7)',
    textDis:   'rgba(255,255,255,0.5)',
    divider:   'rgba(255,255,255,0.08)',
    border:    'rgba(255,255,255,0.23)',
    primary:   'rgb(33,150,243)',
    primaryHi: 'rgb(144,202,249)',
    error:     '#f44336',
    warn:      '#ff9800',
    font:      '"Noto Sans KR"'
  };

  function _sampleOnce() {
    var dlg = document.querySelector('.MuiDialogActions-root button');
    if (dlg) {
      var c = getComputedStyle(dlg).color;
      if (c && c !== 'rgba(0, 0, 0, 0)') T.primary = c;
    }
    var dw = document.querySelector('.MuiDrawer-paper');
    if (dw) T.font = getComputedStyle(dw).fontFamily || T.font;
  }

  // ══════════════════════════════════════════════════════════
  //  캐릭터 데이터 캐시 (표정 드롭다운 등)
  // ══════════════════════════════════════════════════════════

  var _cachedCharacters = null;
  var _cachedPanelTags = null;

  function _fetchCharactersForUI() {
    return BWBR_Bridge.request(
      'bwbr-request-all-characters', 'bwbr-all-characters-data', null,
      { recvAttr: 'data-bwbr-all-characters-data', timeout: 3000 }
    ).then(function (parsed) {
      if (parsed && parsed.characters) _cachedCharacters = parsed.characters;
      return _cachedCharacters || [];
    }).catch(function () { return _cachedCharacters || []; });
  }

  function _populateFaceDropdowns(cardEl) {
    var charSel = cardEl.querySelector('.tmgr-face-char');
    var faceSel = cardEl.querySelector('.tmgr-face-idx');
    if (!charSel || !faceSel) return;

    var currentTarget = charSel.getAttribute('data-current') || '';
    var currentFace = faceSel.getAttribute('data-current') || '0';

    _fetchCharactersForUI().then(function (characters) {
      // 캐릭터 드롭다운 구성
      var activeChars = characters.filter(function (c) { return c.active; });
      var h = '<option value="">캐릭터 선택...</option>';
      h += '<option value="{내캐릭터}"' + (currentTarget === '{내캐릭터}' || currentTarget === '{_자신}' || currentTarget === '{자신}' || currentTarget === '{_화자}' || currentTarget === '{화자}' ? ' selected' : '') + '>내 캐릭터 (선택한 발화 캐릭터)</option>';
      h += '<option value="{차례}"' + (currentTarget === '{차례}' || currentTarget === '{_차례}' ? ' selected' : '') + '>차례 캐릭터 (전투 보조 전용)</option>';
      for (var i = 0; i < activeChars.length; i++) {
        var c = activeChars[i];
        var sel = (c.name === currentTarget) ? ' selected' : '';
        h += '<option value="' + _ea(c.name) + '"' + sel + '>' + _esc(c.name) + '</option>';
      }
      // 현재 값이 특수 변수도 아니고 목록에도 없으면 추가
      if (currentTarget && currentTarget !== '{내캐릭터}' && currentTarget !== '{차례}' && currentTarget !== '{_자신}' && currentTarget !== '{_화자}' && currentTarget !== '{자신}' && currentTarget !== '{화자}') {
        var found = activeChars.some(function (c) { return c.name === currentTarget; });
        if (!found) {
          h += '<option value="' + _ea(currentTarget) + '" selected>' + _esc(currentTarget) + ' (직접 입력)</option>';
        }
      }
      charSel.innerHTML = h;

      // 선택된 캐릭터의 표정 목록
      _updateFaceOptions(faceSel, characters, charSel.value, currentFace);

      // 캐릭터 변경 시 표정 목록 갱신
      charSel.addEventListener('change', function () {
        _updateFaceOptions(faceSel, characters, charSel.value, '0');
      });
      // 표정 변경 시 미리보기 갱신
      faceSel.addEventListener('change', function () {
        _updateFaceOptions(faceSel, characters, charSel.value, faceSel.value);
      });
    });
  }

  function _updateFaceOptions(faceSel, characters, charName, currentFace) {
    var h = '<option value="0"' + (currentFace === '0' ? ' selected' : '') + '>기본 표정</option>';
    var faceList = []; // [{label, iconUrl}]
    var char = null;
    // 특수 변수인 경우 일반 번호만 표시
    if (charName && charName.charAt(0) !== '{') {
      for (var i = 0; i < characters.length; i++) {
        if (characters[i].name === charName) { char = characters[i]; break; }
      }
      if (char && char.faces && char.faces.length > 0) {
        for (var j = 0; j < char.faces.length; j++) {
          var face = char.faces[j];
          // faces는 {label, iconUrl} 객체 또는 URL 문자열 (하위 호환)
          var url = typeof face === 'object' ? (face.iconUrl || '') : face;
          var label = typeof face === 'object' ? (face.label || '') : '';
          // @ 접두사 제거, 빈 라벨은 번호로 표시
          if (label.charAt(0) === '@') label = label.slice(1);
          if (!label) label = '표정 ' + (j + 1);
          faceList.push({ label: label, url: url });
          var idx = j + 1;
          var sel = (String(idx) === String(currentFace)) ? ' selected' : '';
          h += '<option value="' + idx + '"' + sel + '>' + _esc(label) + '</option>';
        }
      }
    } else {
      // 변수 대상: 0~13 까지 표시
      for (var k = 1; k <= 13; k++) {
        var sel = (String(k) === String(currentFace)) ? ' selected' : '';
        h += '<option value="' + k + '"' + sel + '>표정 ' + k + '</option>';
      }
    }
    faceSel.innerHTML = h;
    // 표정 미리보기 업데이트
    var preview = faceSel.closest('.tmgr-afrow')?.querySelector('.tmgr-face-preview');
    if (preview) {
      var fIdx = parseInt(currentFace, 10) || 0;
      if (fIdx === 0 && char) {
        preview.src = char.iconUrl || '';
        preview.style.display = char.iconUrl ? '' : 'none';
      } else if (fIdx > 0 && faceList[fIdx - 1]) {
        preview.src = faceList[fIdx - 1].url;
        preview.style.display = '';
      } else {
        preview.style.display = 'none';
      }
    }
  }

  // ── 패널 태그 드롭다운 ──

  function _fetchPanelTags() {
    return BWBR_Bridge.request(
      'bwbr-request-panel-tags', 'bwbr-panel-tags-data', null,
      { recvAttr: 'data-bwbr-panel-tags-data', timeout: 3000 }
    ).then(function (parsed) {
      if (parsed && parsed.panels) _cachedPanelTags = parsed.panels;
      return _cachedPanelTags || [];
    }).catch(function () { return _cachedPanelTags || []; });
  }

  function _populatePanelDropdowns(cardEl) {
    var sel = cardEl.querySelector('.tmgr-panel-tag');
    if (!sel) return;

    var currentTarget = sel.getAttribute('data-current') || '';
    var filterType = ''; // panelType 필터 (카드에서 읽기)
    var ptSel = cardEl.querySelector('[data-f="panelType"]');
    if (!ptSel) ptSel = cardEl.querySelector('[data-f="memoTarget"]'); // memo 동작용 폴백
    if (ptSel) filterType = ptSel.value || '';

    _fetchPanelTags().then(function (panels) {
      var h = '<option value="">패널 선택 (〔태그〕 권장)...</option>';
      // 태그 있는 패널 먼저
      for (var i = 0; i < panels.length; i++) {
        var p = panels[i];
        if (filterType && p.type !== filterType) continue;
        if (!p.tag) continue;
        var label = p.tag + (p.type === 'plane' ? ' (마커)' : ' (스크린)');
        var sel2 = (p.tag === currentTarget) ? ' selected' : '';
        h += '<option value="' + _ea(p.tag) + '"' + sel2 + '>' + _esc(label) + '</option>';
      }
      // 태그 없는 패널 (구분선 + memo/id로 표시)
      var untagged = panels.filter(function (p) {
        if (p.tag) return false;
        if (filterType && p.type !== filterType) return false;
        return true;
      });
      if (untagged.length > 0) {
        h += '<option disabled>── 태그 없는 패널 ──</option>';
        for (var j = 0; j < untagged.length; j++) {
          var u = untagged[j];
          var uLabel = (u.memo || '').substring(0, 30) || u._id.substring(0, 12);
          uLabel += u.type === 'plane' ? ' (마커)' : ' (스크린)';
          h += '<option value="" disabled title="memo에 〔태그〕를 추가해야 선택 가능">' + _esc(uLabel) + '</option>';
        }
      }
      // 현재 값이 목록에 없으면 직접 입력 옵션 추가
      if (currentTarget) {
        var found = panels.some(function (p) { return p.tag === currentTarget; });
        if (!found) {
          h += '<option value="' + _ea(currentTarget) + '" selected>' + _esc(currentTarget) + ' (직접 입력)</option>';
        }
      }
      sel.innerHTML = h;

      // panelType 변경 시 패널 목록 필터
      if (ptSel) {
        ptSel.addEventListener('change', function () {
          _populatePanelDropdowns(cardEl);
        });
      }
    });
  }

  // ── 네이티브 이미지 선택 ──

  /**
   * 코코포리아 네이티브 이미지 선택창을 연다.
   * @param {string} currentUrl - 현재 선택된 URL (참고용)
   * @param {Function} callback - (selectedUrl) => void  (취소 시 호출 안 됨)
   */
  function _showImagePicker(currentUrl, callback) {
    BWBR_Bridge.request(
      'bwbr-open-native-image-picker', 'bwbr-native-picker-result', null,
      { recvAttr: 'data-bwbr-native-picker-result', timeout: 60000 }
    ).then(function (data) {
      if (data && data.url !== null && data.url !== undefined) {
        callback(data.url);
      }
    }).catch(function () { /* 타임아웃 또는 취소 */ });
  }

  /** 이미지 선택 인라인 래퍼의 썸네일/없음 텍스트를 갱신 */
  function _updateImgPickThumb(wrap, url) {
    var clearBtn = wrap.querySelector('.tmgr-imgpick-clear');
    // data-mode="lg" : panel_create용 (항상 img+btn 둘 다 존재, 토글)
    if (wrap.getAttribute('data-mode') === 'lg') {
      var lgThumb = wrap.querySelector('.tmgr-imgpick-thumb-lg');
      var lgBtn = wrap.querySelector('.tmgr-btn.tmgr-imgpick-btn');
      if (url) {
        if (lgThumb) { lgThumb.src = url; lgThumb.style.display = ''; }
        if (lgBtn) lgBtn.style.display = 'none';
        if (clearBtn) clearBtn.style.display = '';
      } else {
        if (lgThumb) { lgThumb.src = ''; lgThumb.style.display = 'none'; }
        if (lgBtn) lgBtn.style.display = '';
        if (clearBtn) clearBtn.style.display = 'none';
      }
      return;
    }
    // 기본 모드 (cutin 등): thumb/none 요소 교체
    var oldThumb = wrap.querySelector('.tmgr-imgpick-thumb');
    var oldNone = wrap.querySelector('.tmgr-imgpick-none');
    if (oldThumb) oldThumb.remove();
    if (oldNone) oldNone.remove();
    if (url) {
      var img = document.createElement('img');
      img.className = 'tmgr-imgpick-thumb';
      img.src = url;
      wrap.appendChild(img);
    } else {
      var sp = document.createElement('span');
      sp.className = 'tmgr-imgpick-none';
      sp.textContent = '없음';
      wrap.appendChild(sp);
    }
    if (clearBtn) clearBtn.style.display = url ? '' : 'none';
  }

  // ══════════════════════════════════════════════════════════
  //  CSS 주입
  // ══════════════════════════════════════════════════════════

  function _injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var c = '';

    c += '#' + DIALOG_ID + '{position:fixed;inset:0;z-index:1300;display:flex;justify-content:center;align-items:center}';
    c += '#' + DIALOG_ID + '-bd{position:fixed;inset:0;background:' + T.bg + ';opacity:0;transition:opacity .225s cubic-bezier(.4,0,.2,1);-webkit-tap-highlight-color:transparent}';
    c += '#' + DIALOG_ID + '-bd.open{opacity:1}';

    c += '.tmgr-paper{position:relative;display:flex;flex-direction:column;background:' + T.paper + ';color:' + T.text + ';border-radius:4px;width:600px;max-width:calc(100% - 64px);max-height:calc(100% - 64px);margin:32px;';
    c += 'box-shadow:0 11px 15px -7px rgba(0,0,0,.2),0 24px 38px 3px rgba(0,0,0,.14),0 9px 46px 8px rgba(0,0,0,.12);font-family:' + T.font + ';font-size:14px;line-height:1.5;opacity:0;transform:scale(.95);';
    c += 'transition:opacity .225s cubic-bezier(.4,0,.2,1),transform .225s cubic-bezier(.4,0,.2,1);overflow:hidden}';
    c += '.tmgr-paper.open{opacity:1;transform:scale(1)}';

    c += '.tmgr-title{display:flex;align-items:center;padding:0 24px;height:64px;min-height:64px;flex-shrink:0;background:rgb(33,33,33);box-shadow:0 2px 4px -1px rgba(0,0,0,.2),0 4px 5px rgba(0,0,0,.14),0 1px 10px rgba(0,0,0,.12)}';
    c += '.tmgr-title-text{flex:1;font-size:20px;font-weight:700;font-family:Roboto,Helvetica,Arial,sans-serif;letter-spacing:.19px;line-height:30px}';
    c += '.tmgr-title-actions{display:flex;gap:4px;align-items:center}';
    c += '.tmgr-title .tmgr-ib{color:' + T.text + '}';

    c += '.tmgr-content{flex:1;overflow-y:auto;padding:20px 24px}';

    c += '.tmgr-actions{display:flex;align-items:center;justify-content:flex-end;padding:8px;flex-shrink:0;gap:8px}';

    c += '.tmgr-btn{display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;min-width:64px;padding:6px 8px;border-radius:4px;border:none;cursor:pointer;font-family:Roboto,Helvetica,Arial,sans-serif;background:transparent;color:' + T.primary + ';transition:background-color .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1),border-color .25s cubic-bezier(.4,0,.2,1),color .25s cubic-bezier(.4,0,.2,1);text-transform:uppercase;letter-spacing:.4px;line-height:24.5px}';
    c += '.tmgr-btn:hover{background:rgba(33,150,243,.08)}';
    c += '.tmgr-btn-c{background:' + T.primary + ';color:rgba(0,0,0,.87);padding:6px 16px}';
    c += '.tmgr-btn-c:hover{background:rgb(25,118,210)}';
    c += '.tmgr-btn-sm{min-width:auto;padding:4px 8px;font-size:12px}';

    c += '.tmgr-ib{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:none;background:transparent;color:' + T.textSec + ';cursor:pointer;transition:background-color .15s cubic-bezier(.4,0,.2,1);padding:8px}';
    c += '.tmgr-ib:hover{background:rgba(255,255,255,.08);color:' + T.text + '}';
    c += '.tmgr-ib.danger:hover{color:' + T.error + ';background:rgba(244,67,54,.08)}';
    c += '.tmgr-ib-close{width:48px;height:48px;padding:12px;margin:0 -12px 0 0}';
    c += '.tmgr-ib-sm{width:32px;height:32px;padding:4px}';

    c += '.tmgr-inp{font:inherit;color:currentColor;padding:8.5px 14px;box-sizing:border-box;width:100%;border:1px solid ' + T.border + ';border-radius:4px;background:transparent;outline:none;font-size:14px}';
    c += '.tmgr-inp:hover{border-color:rgba(255,255,255,.87)}';
    c += '.tmgr-inp:focus{border-color:' + T.primary + ';border-width:2px;padding:7.5px 13px}';
    c += '.tmgr-inp::placeholder{color:' + T.textDis + '}';
    c += '.tmgr-inp:disabled{color:' + T.textDis + ';border-color:' + T.divider + '}';
    c += '.tmgr-textarea{resize:vertical;min-height:56px;max-height:160px;line-height:1.5;font-family:inherit}';

    c += '.tmgr-sel{font:inherit;color:currentColor;padding:8.5px 14px;border:1px solid ' + T.border + ';border-radius:4px;background:transparent;outline:none;font-size:14px;cursor:pointer}';
    c += '.tmgr-sel:hover{border-color:rgba(255,255,255,.87)}';
    c += '.tmgr-sel:focus{border-color:' + T.primary + '}';
    c += '.tmgr-sel option{background:' + T.paperSolid + ';color:' + T.text + '}';

    c += '.tmgr-lbl{font-size:12px;color:' + T.textSec + ';margin-bottom:4px;display:block}';
    c += '.tmgr-hint{font-size:12px;color:' + T.textDis + ';margin-top:3px}';

    c += '.tmgr-row{margin-bottom:16px}';
    c += '.tmgr-row-i{display:flex;gap:16px}';
    c += '.tmgr-row-i>div{flex:1}';

    c += '.tmgr-item{display:flex;align-items:center;padding:8px 16px;gap:12px;border-bottom:1px solid ' + T.divider + '}';
    c += '.tmgr-item:last-child{border-bottom:none}';

    c += '.tmgr-sw{display:inline-flex;width:42px;height:24px;padding:0;cursor:pointer;position:relative;flex-shrink:0;border-radius:12px;background:rgba(255,255,255,.3);transition:background .15s}';
    c += '.tmgr-sw.on{background:rgba(33,150,243,.5)}';
    c += '.tmgr-sw-thumb{width:18px;height:18px;border-radius:50%;background:#fafafa;position:absolute;top:3px;left:3px;transition:transform .15s cubic-bezier(.4,0,.2,1);box-shadow:0 1px 3px rgba(0,0,0,.3)}';
    c += '.tmgr-sw.on .tmgr-sw-thumb{transform:translateX(18px);background:' + T.primary + '}';

    c += '.tmgr-info{flex:1;min-width:0;cursor:pointer}';
    c += '.tmgr-info:hover .tmgr-name{color:' + T.primaryHi + '}';
    c += '.tmgr-name{font-size:14px;font-weight:700;font-family:Roboto,Helvetica,Arial,sans-serif;letter-spacing:.1px;line-height:22px;color:rgb(224,224,224);transition:color .15s}';
    c += '.tmgr-sub{font-size:14px;font-family:Roboto,Helvetica,Arial,sans-serif;letter-spacing:.15px;line-height:20px;color:' + T.text + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';

    c += '.tmgr-badge{font-size:10px;font-weight:500;padding:2px 6px;border-radius:4px;background:rgba(33,150,243,.12);color:' + T.primaryHi + ';flex-shrink:0}';

    c += '.tmgr-empty{text-align:center;color:' + T.textDis + ';padding:48px 0;font-size:14px}';

    // 동작 카드
    c += '.tmgr-acard{background:rgba(255,255,255,.04);border-radius:4px;padding:12px;margin-bottom:8px;border:1px solid ' + T.divider + '}';
    c += '.tmgr-ahdr{display:flex;align-items:center;gap:4px;margin-bottom:8px}';
    c += '.tmgr-ahdr .tmgr-sel{flex:1}';
    c += '.tmgr-afields{display:flex;flex-direction:column;gap:8px}';
    c += '.tmgr-afrow{display:flex;gap:8px;align-items:center}';
    c += '.tmgr-afrow .tmgr-inp{flex:1}';
    c += '.tmgr-afrow .tmgr-sel{flex:0 0 auto}';

    // 조건 카드 (다른 색상으로 구분)
    c += '.tmgr-ccard{background:rgba(255,152,0,.06);border-radius:4px;padding:12px;margin-bottom:8px;border:1px solid rgba(255,152,0,.25)}';
    c += '.tmgr-ccard .tmgr-ahdr{margin-bottom:6px}';
    c += '.tmgr-ccard-label{font-size:12px;font-weight:500;color:' + T.warn + '}';
    // 조건 아래 종속 동작 (들여쓰기)
    c += '.tmgr-acard-nested{margin-left:16px;padding-left:8px}';
    // 드래그 핸들
    c += '.tmgr-drag{display:inline-flex;align-items:center;justify-content:center;width:18px;cursor:grab;opacity:0.35;flex-shrink:0;user-select:none;-webkit-user-select:none;transition:opacity .15s}';
    c += '.tmgr-drag:hover{opacity:0.7}';
    c += '.tmgr-drag:active{cursor:grabbing;opacity:0.9}';
    c += '[data-idx].tmgr-dragging{opacity:0.25}';
    c += '[data-idx].tmgr-drop-above{border-top:2px solid ' + T.primary + '}';
    c += '[data-idx].tmgr-drop-below{border-bottom:2px solid ' + T.primary + '}';
    // 조건 접기/펼치기
    c += '.tmgr-cond-fold{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;background:transparent;color:' + T.warn + ';cursor:pointer;font-size:14px;padding:0;margin-right:2px;opacity:0.7;flex-shrink:0;transition:opacity .15s}';
    c += '.tmgr-cond-fold:hover{opacity:1}';
    c += '.tmgr-cond-count{font-size:11px;color:' + T.textSec + ';margin-left:8px}';

    // 추가 드롭다운
    c += '.tmgr-add-menu{position:relative;display:inline-block}';
    c += '.tmgr-add-dd{position:fixed;background:' + T.paperSolid + ';border-radius:4px;border:1px solid ' + T.divider + ';box-shadow:0 5px 5px -3px rgba(0,0,0,.2),0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12);z-index:9999;min-width:180px;padding:4px 0;display:none;max-height:60vh;overflow-y:auto}';
    c += '.tmgr-face-preview{width:36px;height:36px;object-fit:cover;border-radius:3px;border:1px solid ' + T.divider + ';flex-shrink:0;background:' + T.bg + '}';
    c += '.tmgr-add-dd.open{display:block}';
    c += '.tmgr-add-dd-item{padding:8px 16px;cursor:pointer;font-size:14px;color:' + T.text + ';transition:background .1s;white-space:nowrap}';
    c += '.tmgr-add-dd-item:hover{background:rgba(255,255,255,.08)}';
    c += '.tmgr-add-dd-item.cond{color:' + T.warn + '}';
    c += '.tmgr-add-dd-sep{height:1px;background:' + T.divider + ';margin:4px 0}';

    // 이미지 선택 인라인
    c += '.tmgr-imgpick-wrap{display:flex;gap:8px;align-items:center}';
    c += '.tmgr-imgpick-thumb{width:32px;height:32px;object-fit:cover;border-radius:3px;border:1px solid ' + T.divider + ';flex-shrink:0;background:rgba(0,0,0,.3)}';
    c += '.tmgr-imgpick-none{font-size:11px;color:' + T.textDis + '}';
    c += '.tmgr-imgpick-clear{min-width:auto;padding:2px 6px;font-size:11px;color:' + T.textSec + ';border:1px solid ' + T.border + ';border-radius:3px;background:transparent;cursor:pointer;line-height:1}';
    c += '.tmgr-imgpick-clear:hover{color:' + T.error + ';border-color:' + T.error + '}';
    c += '.tmgr-imgpick-thumb-lg{width:40px;height:40px;cursor:pointer;transition:border-color .15s}';
    c += '.tmgr-imgpick-thumb-lg:hover{border-color:' + T.primary + '}';

    // 토스트
    c += '.tmgr-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#323232;color:#fff;padding:6px 16px;border-radius:4px;font-size:14px;z-index:1400;min-width:288px;text-align:center;';
    c += 'box-shadow:0 3px 5px -1px rgba(0,0,0,.2),0 6px 10px rgba(0,0,0,.14),0 1px 18px rgba(0,0,0,.12);animation:tmgr-sn .225s cubic-bezier(0,0,.2,1)}';
    c += '@keyframes tmgr-sn{from{opacity:0;transform:translateX(-50%) scale(.8)}}';

    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = c;
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════
  //  SVG 아이콘
  // ══════════════════════════════════════════════════════════

  var I = {
    close:  'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    back:   'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    del:    'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    add:    'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    down:   'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    up:     'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    arrowU: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z',
    arrowD: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
    grip:   'M9 7h2v2H9zm4 0h2v2h-2zM9 11h2v2H9zm4 0h2v2h-2zM9 15h2v2H9zm4 0h2v2h-2z',
    copy:   'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'
  };
  function _svg(name, sz) {
    sz = sz || 20;
    return '<svg viewBox="0 0 24 24" width="' + sz + '" height="' + sz + '" style="fill:currentColor"><path d="' + I[name] + '"/></svg>';
  }

  // ══════════════════════════════════════════════════════════
  //  툴바 버튼 삽입
  // ══════════════════════════════════════════════════════════

  function _findToolbar() {
    var bars = document.querySelectorAll('.MuiAppBar-root');
    for (var i = 0; i < bars.length; i++) {
      var r = bars[i].getBoundingClientRect();
      if (r.top < 10 && r.width > 500) return bars[i].querySelector('.MuiToolbar-root');
    }
    return null;
  }

  function injectToolbarButton() {
    if (document.getElementById(BTN_ID)) return;
    var toolbar = _findToolbar();
    if (!toolbar) return;

    var menuBtn = toolbar.querySelector('[aria-label="メニュー"],[aria-label="메뉴"]');
    if (!menuBtn) return;

    var ref = null;
    var cands = toolbar.querySelectorAll('button.MuiIconButton-root.MuiIconButton-sizeMedium');
    for (var i = 0; i < cands.length; i++) {
      if (cands[i].getAttribute('aria-label') !== '메뉴' && cands[i].getAttribute('aria-label') !== 'メニュー' && cands[i].id !== BTN_ID) {
        ref = cands[i]; break;
      }
    }

    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', '[GM] 트리거 목록');
    btn.className = ref ? ref.className : 'MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeMedium';
    btn.innerHTML = '<svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeMedium" focusable="false" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" style="fill:currentColor;width:1em;height:1em;font-size:1.5rem"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>';

    var tip = null;
    var _tipTimer = null;
    btn.addEventListener('mouseenter', function () {
      if (tip || _tipTimer) return;
      // MUI enterDelay (~100ms) 재현
      _tipTimer = setTimeout(function () {
        _tipTimer = null;
        tip = document.createElement('div');
        tip.textContent = '[GM] 트리거 목록';
        tip.style.cssText = 'position:fixed;z-index:1500;background:rgb(22,22,22);color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:500;font-family:Roboto,Helvetica,Arial,sans-serif;pointer-events:none;white-space:nowrap;max-width:300px;word-wrap:break-word;box-shadow:rgba(0,0,0,0.2) 0px 1px 3px 0px,rgba(0,0,0,0.14) 0px 1px 1px 0px,rgba(0,0,0,0.12) 0px 2px 1px -1px;opacity:0;transition:opacity 0.2s cubic-bezier(0.4,0,0.2,1)';
        document.body.appendChild(tip);
        var r = btn.getBoundingClientRect();
        tip.style.left = (r.left + r.width / 2 - tip.offsetWidth / 2) + 'px';
        tip.style.top  = (r.bottom + 14) + 'px';
        requestAnimationFrame(function () { requestAnimationFrame(function () { if (tip) tip.style.opacity = '1'; }); });
      }, 100);
    });
    btn.addEventListener('mouseleave', function () {
      if (_tipTimer) { clearTimeout(_tipTimer); _tipTimer = null; }
      if (tip) {
        var _t = tip; tip = null;
        _t.style.opacity = '0';
        setTimeout(function () { _t.remove(); }, 200);
      }
    });

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (tip) { tip.remove(); tip = null; }
      openDialog();
    });

    var first = cands[0] || menuBtn;
    first.parentNode.insertBefore(btn, first);
  }

  // ══════════════════════════════════════════════════════════
  //  다이얼로그 열기/닫기
  // ══════════════════════════════════════════════════════════

  function openDialog() {
    if (document.getElementById(DIALOG_ID)) return;
    _sampleOnce();
    _injectCSS();
    editingId = null;
    _cachedCharacters = null; // 캐릭터 캐시 초기화

    var root = document.createElement('div');
    root.id = DIALOG_ID;
    root.setAttribute('role', 'presentation');

    var bd = document.createElement('div');
    bd.id = DIALOG_ID + '-bd';
    root.appendChild(bd);

    var paper = document.createElement('div');
    paper.className = 'tmgr-paper';
    paper.setAttribute('role', 'dialog');
    root.appendChild(paper);

    bd.addEventListener('click', function () { closeDialog(); });

    overlayEl = root;
    dialogEl  = paper;
    document.body.appendChild(root);

    renderList();

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        bd.classList.add('open');
        paper.classList.add('open');
      });
    });
  }

  function closeDialog() {
    if (!overlayEl) return;
    var bd    = overlayEl.querySelector('#' + DIALOG_ID + '-bd');
    var paper = overlayEl.querySelector('.tmgr-paper');
    if (bd) bd.classList.remove('open');
    if (paper) paper.classList.remove('open');
    setTimeout(function () {
      if (overlayEl) overlayEl.remove();
      overlayEl = null;
      dialogEl  = null;
      editingId = null;
    }, 230);
  }

  // ══════════════════════════════════════════════════════════
  //  리스트 뷰
  // ══════════════════════════════════════════════════════════

  function renderList() {
    if (!dialogEl) return;
    var trigs = triggerEngine ? triggerEngine.getTriggers() : [];
    var h = '';

    h += '<div class="tmgr-title">';
    h += '  <span class="tmgr-title-text">트리거 관리</span>';
    h += '  <div class="tmgr-title-actions">';
    h += '    <button class="tmgr-ib tmgr-ib-close" data-a="close" title="닫기">' + _svg('close', 24) + '</button>';
    h += '  </div>';
    h += '</div>';

    h += '<div class="tmgr-content">';
    if (trigs.length === 0) {
      h += '<div class="tmgr-empty">등록된 트리거가 없습니다</div>';
    } else {
      for (var i = 0; i < trigs.length; i++) {
        var t = trigs[i];
        var src = { input:'입력', message:'수신', both:'전체' }[t.source] || t.source;

        h += '<div class="tmgr-item" data-id="' + t.id + '">';
        h += '<div class="tmgr-sw' + (t.enabled ? ' on' : '') + '" data-a="toggle"><span class="tmgr-sw-thumb"></span></div>';
        h += '<div class="tmgr-info" data-a="edit">';
        h += '  <div class="tmgr-name">' + _esc(t.name || '(이름 없음)') + '</div>';
        h += '  <div class="tmgr-sub">' + _esc(t.pattern || '(패턴 없음 — 조건 기반)') + (t.isRegex ? ' <span style="font-size:10px;opacity:0.6">[정규식]</span>' : '') + '</div>';
        h += '</div>';
        h += '<span class="tmgr-badge">' + src + '</span>';
        h += '<button class="tmgr-ib tmgr-ib-sm" data-a="copy" title="복사">' + _svg('copy', 16) + '</button>';
        h += '<button class="tmgr-ib tmgr-ib-sm danger" data-a="delete" title="삭제">' + _svg('del', 16) + '</button>';
        h += '</div>';
      }
    }
    h += '</div>';

    h += '<div class="tmgr-actions">';
    h += '  <button class="tmgr-btn" data-a="import">' + _svg('up', 16) + '&nbsp;가져오기</button>';
    h += '  <button class="tmgr-btn" data-a="export">' + _svg('down', 16) + '&nbsp;내보내기</button>';
    h += '  <span style="flex:1"></span>';
    h += '  <button class="tmgr-btn tmgr-btn-c" data-a="add">' + _svg('add', 18) + '&nbsp;새 트리거</button>';
    h += '</div>';

    dialogEl.innerHTML = h;
    // overlayEl에 남은 드롭다운 정리
    if (overlayEl) { var staleDD = overlayEl.querySelector('#tf-add-dd'); if (staleDD) staleDD.remove(); }
    _bindList();
  }

  function _bindList() {
    if (!dialogEl) return;
    dialogEl.querySelectorAll('[data-a]').forEach(function (el) {
      el.addEventListener('click', function () {
        var a  = el.getAttribute('data-a');
        var it = el.closest('.tmgr-item');
        var id = it ? it.getAttribute('data-id') : null;
        switch (a) {
          case 'close':  closeDialog(); break;
          case 'add':    renderEdit(null); break;
          case 'import': _doImport(); break;
          case 'export': _doExport(); break;
          case 'toggle':
            if (id && triggerEngine) {
              var list = triggerEngine.getTriggers();
              var f = list.find(function (x) { return x.id === id; });
              if (f) { triggerEngine.updateTrigger(id, { enabled: !f.enabled }); renderList(); }
            }
            break;
          case 'edit':   if (id) renderEdit(id); break;
          case 'delete':
            if (id && triggerEngine) { triggerEngine.removeTrigger(id); renderList(); _toast('삭제됨'); }
            break;
          case 'copy':
            if (id && triggerEngine) {
              var list = triggerEngine.getTriggers();
              var orig = list.find(function (x) { return x.id === id; });
              if (orig) {
                var clone = JSON.parse(JSON.stringify(orig));
                delete clone.id;
                clone.name = (clone.name || '') + ' (복사)';
                triggerEngine.addTrigger(clone);
                renderList();
                _toast('복사됨');
              }
            }
            break;
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  //  편집 뷰
  // ══════════════════════════════════════════════════════════

  function renderEdit(id) {
    if (!dialogEl) return;
    editingId = id;

    var trig = null;
    if (id && triggerEngine) {
      var list = triggerEngine.getTriggers();
      trig = list.find(function (x) { return x.id === id; });
    }

    var d = trig ? JSON.parse(JSON.stringify(trig)) : {
      id: null, name: '', pattern: '',
      source: 'input',
      conditions: { states: [] },
      actions: [{ type: 'message', template: '' }],
      delay: 300, priority: 0
    };
    if (!d.conditions) d.conditions = { states: [] };
    var h = '';

    // 타이틀
    h += '<div class="tmgr-title">';
    h += '  <button class="tmgr-ib" data-a="back">' + _svg('back', 24) + '</button>';
    h += '  <span class="tmgr-title-text" style="margin-left:8px">' + (id ? '트리거 편집' : '새 트리거') + '</span>';
    h += '  <div class="tmgr-title-actions"><button class="tmgr-ib tmgr-ib-close" data-a="close">' + _svg('close', 24) + '</button></div>';
    h += '</div>';

    h += '<div class="tmgr-content">';

    // 이름
    h += '<div class="tmgr-row"><label class="tmgr-lbl">이름</label>';
    h += '<input class="tmgr-inp" id="tf-name" value="' + _ea(d.name) + '"></div>';

    // 패턴
    h += '<div class="tmgr-row"><label class="tmgr-lbl">패턴</label>';
    h += '<div style="display:flex;gap:8px;align-items:center">';
    h += '<input class="tmgr-inp" id="tf-pat" value="' + _ea(d.pattern) + '" placeholder="' + (d.isRegex ? '정규식 패턴 (예: ^(?<대상>.+?)에게 공격$)' : '예: 《공격》| {대상} 또는 【방어】| {대상} 또는 자유 형식') + '" style="flex:1">';
    h += '<label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:12px;color:' + T.textSec + ';cursor:pointer"><input type="checkbox" id="tf-regex"' + (d.isRegex ? ' checked' : '') + '> 정규식</label>';
    h += '</div>';
    h += '<div class="tmgr-hint" id="tf-pat-hint">' + (d.isRegex ? '정규식 모드: JavaScript 정규식을 직접 입력합니다. (?&lt;파라미터명&gt;...) 이름 있는 캡처 그룹으로 파라미터를 정의합니다.' : '{파라미터명}으로 파라미터 정의·추출 (예: {대상}, {값}). 비워두면 조건만으로 트리거.') + '</div>';
    h += '<div class="tmgr-hint" style="margin-top:2px">💡 <b>내장 변수</b>: {내캐릭터} = 발화 캐릭터, {보낸이} = 메시지 발신자, {차례} = 전투 현재 턴</div>';
    h += '<div class="tmgr-hint" style="margin-top:1px">📐 <b>스탯 참조</b>: {#캐릭터!스탯} → 값 (예: {#홍길동!HP}) &nbsp; 🧮 <b>수식</b>: {계산:1+2*3} → 7</div></div>';

    // 감지 대상 + 딜레이 + 우선순위
    h += '<div class="tmgr-row tmgr-row-i">';
    h += '<div><label class="tmgr-lbl">감지 대상</label><select class="tmgr-sel" id="tf-src" style="width:100%">';
    h += '<option value="input"'   + (d.source === 'input'   ? ' selected' : '') + '>내 입력만</option>';
    h += '<option value="message"' + (d.source === 'message' ? ' selected' : '') + '>수신 메시지</option>';
    h += '<option value="both"'    + (d.source === 'both'    ? ' selected' : '') + '>전체</option>';
    h += '</select></div>';
    h += '<div><label class="tmgr-lbl">딜레이 (ms)</label><input class="tmgr-inp" id="tf-delay" type="number" min="0" max="10000" value="' + (d.delay || 300) + '"></div>';
    h += '<div><label class="tmgr-lbl">우선순위</label><input class="tmgr-inp" id="tf-pri" type="number" value="' + (d.priority || 0) + '"></div>';
    h += '</div>';

    // 동작 체인
    h += '<div class="tmgr-row"><label class="tmgr-lbl">동작 체인</label>';
    h += '<div id="tf-acts">';
    var _condGroupIdx = -1;
    var _condCollapsed = false;
    for (var i = 0; i < d.actions.length; i++) {
      var _isCond = d.actions[i].type === 'condition_dice' || d.actions[i].type === 'condition_text';
      if (_isCond) {
        _condGroupIdx++;
        _condCollapsed = d.actions[i].collapsed === true;
        if (_condCollapsed) {
          var _cnt = 0;
          for (var j = i + 1; j < d.actions.length; j++) {
            if (d.actions[j].type === 'condition_dice' || d.actions[j].type === 'condition_text') break;
            if (d.actions[j].inGroup !== false) _cnt++;
          }
          d.actions[i]._collapsedCount = _cnt;
        } else { d.actions[i]._collapsedCount = 0; }
      }
      var _hidden = !_isCond && d.actions[i].inGroup !== false && _condCollapsed;
      h += _renderChainCard(i, d.actions[i], _condGroupIdx, _hidden);
    }
    h += '</div>';

    // 추가 드롭다운 메뉴 (버튼만 여기에, 드롭다운 본체는 dialogEl 레벨에 렌더)
    h += '<div class="tmgr-add-menu">';
    h += '<button class="tmgr-btn tmgr-btn-sm" id="tf-add-btn">' + _svg('add', 16) + '&nbsp;추가</button>';
    h += '</div>';

    h += '</div>';

    h += '</div>'; // tmgr-content

    h += '<div class="tmgr-actions">';
    h += '<button class="tmgr-btn" data-a="back">취소</button>';
    h += '<button class="tmgr-btn" id="tf-save">저장</button>';
    h += '</div>';

    // 드롭다운은 paper 밖, dialogEl 레벨에 (position:fixed가 transform 영향 안 받도록)
    h += '<div class="tmgr-add-dd" id="tf-add-dd">';
    h += '<div class="tmgr-add-dd-item" data-add="message">시스템 메시지</div>';
    h += '<div class="tmgr-add-dd-item" data-add="char_message">캐릭터 메시지</div>';
    h += '<div class="tmgr-add-dd-item" data-add="cutin">컷인</div>';
    h += '<div class="tmgr-add-dd-item" data-add="stat">스탯 변경</div>';
    h += '<div class="tmgr-add-dd-item" data-add="stat_all">전체 스탯 변경</div>';
    h += '<div class="tmgr-add-dd-item" data-add="param">파라미터 변경</div>';
    h += '<div class="tmgr-add-dd-item" data-add="dice">주사위</div>';
    h += '<div class="tmgr-add-dd-item" data-add="face">표정 변경</div>';
    h += '<div class="tmgr-add-dd-item" data-add="move">캐릭터 이동</div>';
    h += '<div class="tmgr-add-dd-item" data-add="initiative">이니셔티브 변경</div>';
    h += '<div class="tmgr-add-dd-item" data-add="memo">메모 변경</div>';
    h += '<div class="tmgr-add-dd-item" data-add="sound">사운드 재생</div>';
    h += '<div class="tmgr-add-dd-item" data-add="load_scene">장면 불러오기</div>';
    h += '<div class="tmgr-add-dd-sep"></div>';
    h += '<div class="tmgr-add-dd-item" data-add="panel_move">패널 이동</div>';
    h += '<div class="tmgr-add-dd-item" data-add="panel_rotate">패널 회전</div>';
    h += '<div class="tmgr-add-dd-item" data-add="panel_copy">패널 복사</div>';
    h += '<div class="tmgr-add-dd-item" data-add="panel_delete">패널 삭제</div>';
    h += '<div class="tmgr-add-dd-item" data-add="panel_create">패널 생성</div>';
    h += '<div class="tmgr-add-dd-sep"></div>';
    h += '<div class="tmgr-add-dd-item" data-add="wait">대기 (딜레이)</div>';
    h += '<div class="tmgr-add-dd-sep"></div>';
    h += '<div class="tmgr-add-dd-item cond" data-add="condition_dice">조건: 주사위 결과</div>';
    h += '<div class="tmgr-add-dd-item cond" data-add="condition_text">조건: 파라미터 비교</div>';
    h += '</div>';

    dialogEl.innerHTML = h;
    _bindEdit(d);
  }

  // ── 체인 카드 렌더링 (동작 + 조건 공용) ──

  var COND_COLORS = [
    'rgba(76,175,80,0.7)',   // green
    'rgba(171,71,188,0.7)',  // purple
    'rgba(0,188,212,0.7)',   // cyan
    'rgba(236,64,118,0.7)',  // pink
    'rgba(255,179,0,0.7)'    // amber
  ];

  function _renderChainCard(idx, item, condGroupIdx, hidden) {
    var isCondition = item.type === 'condition_dice' || item.type === 'condition_text';
    var inGroup = !isCondition && item.inGroup !== false;
    var groupColor = condGroupIdx >= 0 ? COND_COLORS[condGroupIdx % COND_COLORS.length] : '';
    var borderStyle = '';
    if (isCondition && groupColor) {
      borderStyle = 'border-left:3px solid ' + groupColor + ';';
    } else if (inGroup && groupColor) {
      borderStyle = 'border-left:3px solid ' + groupColor + ';';
    }
    var cls = isCondition ? 'tmgr-ccard' : ('tmgr-acard' + (inGroup && groupColor ? ' tmgr-acard-nested' : ''));
    var style = '';
    if (borderStyle) style += borderStyle;
    if (hidden) style += 'display:none;';
    var h = '<div class="' + cls + '" data-idx="' + idx + '"' + (style ? ' style="' + style + '"' : '') + '>';

    h += '<div class="tmgr-ahdr">';
    h += '<span class="tmgr-drag" title="드래그하여 순서 변경">' + _svg('grip', 14) + '</span>';
    if (isCondition) {
      var collapsed = item.collapsed ? true : false;
      h += '<button class="tmgr-cond-fold" data-fold title="' + (collapsed ? '펼치기' : '접기') + '">' + (collapsed ? '▶' : '▼') + '</button>';
      h += '<span class="tmgr-ccard-label">' + (item.type === 'condition_dice' ? '⚡ 조건: 주사위 결과' : '📝 조건: 파라미터 비교') + '</span>';
      if (collapsed && item._collapsedCount > 0) {
        h += '<span class="tmgr-cond-count">(' + item._collapsedCount + '개 동작 접힘)</span>';
      }
    } else {
      h += '<select class="tmgr-sel tmgr-atype" style="flex:1">';
      h += '<option value="message"'      + (item.type === 'message'      ? ' selected' : '') + '>시스템 메시지</option>';
      h += '<option value="char_message"' + (item.type === 'char_message' ? ' selected' : '') + '>캐릭터 메시지</option>';
      h += '<option value="cutin"'        + (item.type === 'cutin'        ? ' selected' : '') + '>컷인</option>';
      h += '<option value="stat"'         + (item.type === 'stat'         ? ' selected' : '') + '>스탯 변경</option>';
      h += '<option value="stat_all"'     + (item.type === 'stat_all'     ? ' selected' : '') + '>전체 스탯 변경</option>';
      h += '<option value="param"'        + (item.type === 'param'        ? ' selected' : '') + '>파라미터 변경</option>';
      h += '<option value="dice"'         + (item.type === 'dice'         ? ' selected' : '') + '>주사위</option>';
      h += '<option value="face"'         + (item.type === 'face'         ? ' selected' : '') + '>표정 변경</option>';
      h += '<option value="move"'         + (item.type === 'move'         ? ' selected' : '') + '>캐릭터 이동</option>';
      h += '<option value="initiative"'   + (item.type === 'initiative'   ? ' selected' : '') + '>이니셔티브 변경</option>';
      h += '<option value="memo"'         + (item.type === 'memo'         ? ' selected' : '') + '>메모 변경</option>';
      h += '<option value="sound"'        + (item.type === 'sound'        ? ' selected' : '') + '>사운드 재생</option>';
      h += '<option value="load_scene"'   + (item.type === 'load_scene'   ? ' selected' : '') + '>장면 불러오기</option>';
      h += '<option value="panel_move"'    + (item.type === 'panel_move'   ? ' selected' : '') + '>패널 이동</option>';
      h += '<option value="panel_rotate"'  + (item.type === 'panel_rotate' ? ' selected' : '') + '>패널 회전</option>';
      h += '<option value="panel_copy"'    + (item.type === 'panel_copy'   ? ' selected' : '') + '>패널 복사</option>';
      h += '<option value="panel_delete"'  + (item.type === 'panel_delete' ? ' selected' : '') + '>패널 삭제</option>';
      h += '<option value="panel_create"'  + (item.type === 'panel_create' ? ' selected' : '') + '>패널 생성</option>';
      h += '<option value="wait"'         + (item.type === 'wait'         ? ' selected' : '') + '>대기 (딜레이)</option>';
      h += '</select>';
    }
    h += '<span style="flex:1"></span>';
    h += '<button class="tmgr-ib tmgr-ib-sm danger" data-move="del" title="삭제">' + _svg('close', 14) + '</button>';
    h += '</div>';

    h += '<div class="tmgr-afields">';
    if (isCondition) {
      h += _renderCondFields(item);
    } else {
      h += _renderActionFields(item);
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  function _renderCondFields(item) {
    var h = '';
    if (item.type === 'condition_dice') {
      var op = item.op || '>=';
      h += '<div class="tmgr-afrow">';
      h += '<span style="font-size:13px;color:' + T.textSec + ';white-space:nowrap">주사위 결과 ({주사위})</span>';
      h += '<select class="tmgr-sel" data-f="op" style="flex:0 0 52px">';
      h += '<option value=">="' + (op === '>=' ? ' selected' : '') + '>≥</option>';
      h += '<option value="<="' + (op === '<=' ? ' selected' : '') + '>≤</option>';
      h += '<option value=">"'  + (op === '>'  ? ' selected' : '') + '>&gt;</option>';
      h += '<option value="<"'  + (op === '<'  ? ' selected' : '') + '>&lt;</option>';
      h += '<option value="=="' + (op === '==' ? ' selected' : '') + '>=</option>';
      h += '<option value="!="' + (op === '!=' ? ' selected' : '') + '>≠</option>';
      h += '</select>';
      h += '<input class="tmgr-inp" data-f="value" value="' + _ea(item.value || '') + '" placeholder="비교값" style="max-width:80px">';
      h += '</div>';
      h += '<div class="tmgr-hint">조건 불충족 시 그룹 내 동작을 건너뜁니다 (→ 버튼으로 그룹 설정)</div>';
    } else {
      // condition_text
      var op = item.op || '==';
      var isUnary = op === 'empty' || op === 'exists';
      h += '<div class="tmgr-afrow">';
      h += '<input class="tmgr-inp" data-f="field" value="' + _ea(item.field || '') + '" placeholder="파라미터명 (예: 대상)" style="flex:2">';
      h += '<select class="tmgr-sel tmgr-cond-op" data-f="op" style="flex:0 0 80px">';
      h += '<option value="=="' + (op === '==' ? ' selected' : '') + '>=</option>';
      h += '<option value="!="' + (op === '!=' ? ' selected' : '') + '>≠</option>';
      h += '<option value=">="' + (op === '>=' ? ' selected' : '') + '>≥</option>';
      h += '<option value="<="' + (op === '<=' ? ' selected' : '') + '>≤</option>';
      h += '<option value=">"'  + (op === '>'  ? ' selected' : '') + '>&gt;</option>';
      h += '<option value="<"'  + (op === '<'  ? ' selected' : '') + '>&lt;</option>';
      h += '<option value="empty"' + (op === 'empty' ? ' selected' : '') + '>비어있음</option>';
      h += '<option value="exists"' + (op === 'exists' ? ' selected' : '') + '>존재함</option>';
      h += '<option value="stat_exists"' + (op === 'stat_exists' ? ' selected' : '') + '>스탯 실존</option>';
      h += '<option value="stat_not_exists"' + (op === 'stat_not_exists' ? ' selected' : '') + '>스탯 미존재</option>';
      h += '</select>';
      var isStatOp = op === 'stat_exists' || op === 'stat_not_exists';
      h += '<input class="tmgr-inp tmgr-cond-val" data-f="value" value="' + _ea(item.value || '') + '" placeholder="' + (isStatOp ? '캐릭터 이름 (비우면 화자)' : '비교값') + '" style="flex:1' + (isUnary ? ';display:none' : '') + '">';
      h += '</div>';
      h += '<div class="tmgr-hint">조건 불충족 시 그룹 내 동작을 건너뜁니다 (→ 버튼으로 그룹 설정)</div>';
    }
    return h;
  }

  /** 패널 대상 지정 ROW (panelType 셀렉트 + 태그 드롭다운) — panel_move/rotate/copy/delete 공용 */
  function _renderPanelTargetRow(a) {
    var pt = a.panelType || '';
    var h = '<div class="tmgr-afrow">';
    h += '<select class="tmgr-sel" data-f="panelType" style="flex:0 0 100px">';
    h += '<option value=""'       + (pt === ''       ? ' selected' : '') + '>전체</option>';
    h += '<option value="object"' + (pt === 'object' ? ' selected' : '') + '>스크린</option>';
    h += '<option value="plane"'  + (pt === 'plane'  ? ' selected' : '') + '>마커</option>';
    h += '</select>';
    h += '<select class="tmgr-sel tmgr-panel-tag" data-f="target" data-current="' + _ea(a.target || '') + '" style="flex:2">';
    h += '<option value="">로딩 중...</option>';
    if (a.target) h += '<option value="' + _ea(a.target) + '" selected>' + _esc(a.target) + '</option>';
    h += '</select>';
    h += '</div>';
    return h;
  }

  function _renderActionFields(a) {
    var h = '';
    switch (a.type) {
      case 'message':
        h += '<textarea class="tmgr-inp tmgr-textarea" data-f="template" placeholder="메시지 ({파라미터명} 사용 가능, {#캐릭터!스탯}, {계산:수식} 지원). 여러 줄 입력 가능">' + _esc(a.template || '') + '</textarea>';
        break;
      case 'char_message':
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="target" value="' + _ea(a.target || '') + '" placeholder="캐릭터 이름 ({내캐릭터} = 선택 캐릭터, {차례} = 전투 차례)">';
        h += '</div>';
        h += '<textarea class="tmgr-inp tmgr-textarea" data-f="template" placeholder="메시지 ({파라미터명} 사용 가능, {#캐릭터!스탯}, {계산:수식} 지원). 여러 줄 입력 가능">' + _esc(a.template || '') + '</textarea>';
        break;
      case 'cutin':
        h += '<input class="tmgr-inp" data-f="tag" value="' + _ea(a.tag || '') + '" placeholder="컷인 태그명">';
        break;
      case 'stat':
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="target" value="' + _ea(a.target || '') + '" placeholder="캐릭터 이름 ({내캐릭터} = 선택 캐릭터, {차례} = 전투 차례)">';
        h += '</div>';
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="stat" value="' + _ea(a.stat || '') + '" placeholder="스탯 라벨" style="flex:2">';
        var vt = a.valueType || 'value';
        h += '<select class="tmgr-sel" data-f="valueType" style="flex:0 0 90px">';
        h += '<option value="value"' + (vt === 'value' ? ' selected' : '') + '>현재 값</option>';
        h += '<option value="max"'   + (vt === 'max'   ? ' selected' : '') + '>최대 값</option>';
        h += '</select>';
        h += '</div>';
        h += '<div class="tmgr-afrow">';
        h += '<select class="tmgr-sel" data-f="op" style="flex:0 0 52px">';
        h += '<option value="+"' + (a.op === '+' ? ' selected' : '') + '>+</option>';
        h += '<option value="-"' + (a.op === '-' ? ' selected' : '') + '>−</option>';
        h += '<option value="="' + (a.op === '=' ? ' selected' : '') + '>=</option>';
        h += '</select>';
        h += '<input class="tmgr-inp" data-f="value" value="' + _ea(a.value != null ? String(a.value) : '') + '" placeholder="값 ({주사위} 등 사용 가능)">';
        h += '</div>';
        break;
      case 'stat_all':
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="stat" value="' + _ea(a.stat || '') + '" placeholder="스탯 라벨 (모든 활성 캐릭터 대상)" style="flex:2">';
        var vtA = a.valueType || 'value';
        h += '<select class="tmgr-sel" data-f="valueType" style="flex:0 0 90px">';
        h += '<option value="value"' + (vtA === 'value' ? ' selected' : '') + '>현재 값</option>';
        h += '<option value="max"'   + (vtA === 'max'   ? ' selected' : '') + '>최대 값</option>';
        h += '</select>';
        h += '</div>';
        h += '<div class="tmgr-afrow">';
        h += '<select class="tmgr-sel" data-f="op" style="flex:0 0 80px">';
        h += '<option value="+"'    + (a.op === '+'    ? ' selected' : '') + '>+</option>';
        h += '<option value="-"'    + (a.op === '-'    ? ' selected' : '') + '>−</option>';
        h += '<option value="="'    + (a.op === '='    ? ' selected' : '') + '>=</option>';
        h += '<option value="=max"' + (a.op === '=max' ? ' selected' : '') + '>최대치 충전</option>';
        h += '</select>';
        h += '<input class="tmgr-inp" data-f="value" value="' + _ea(a.value != null ? String(a.value) : '') + '" placeholder="값 (=max 시 무시)"' + (a.op === '=max' ? ' disabled' : '') + '>';
        h += '</div>';
        break;
      case 'param':
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="target" value="' + _ea(a.target || '') + '" placeholder="캐릭터 이름">';
        h += '</div>';
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="param" value="' + _ea(a.param || '') + '" placeholder="파라미터 라벨 (예: STR, DEX)" style="flex:2">';
        h += '<select class="tmgr-sel" data-f="op" style="flex:0 0 52px">';
        h += '<option value="="' + (a.op === '=' ? ' selected' : '') + '>=</option>';
        h += '<option value="+"' + (a.op === '+' ? ' selected' : '') + '>+</option>';
        h += '<option value="-"' + (a.op === '-' ? ' selected' : '') + '>−</option>';
        h += '</select>';
        h += '</div>';
        h += '<input class="tmgr-inp" data-f="value" value="' + _ea(a.value != null ? String(a.value) : '') + '" placeholder="값 ({주사위} 등 사용 가능)">';
        break;
      case 'dice':
        h += '<input class="tmgr-inp" data-f="command" value="' + _ea(a.command || '') + '" placeholder="주사위 명령 (예: 2d6+3). 결과는 {주사위}에 저장됩니다">';
        break;
      case 'face':
        h += '<div class="tmgr-afrow">';
        h += '<img class="tmgr-face-preview" src="" style="display:none" />';
        h += '<select class="tmgr-sel tmgr-face-char" data-f="target" data-current="' + _ea(a.target || '') + '" style="flex:2">';
        h += '<option value="">로딩 중...</option>';
        if (a.target) h += '<option value="' + _ea(a.target) + '" selected>' + _esc(a.target) + '</option>';
        h += '</select>';
        h += '<select class="tmgr-sel tmgr-face-idx" data-f="faceIndex" data-current="' + _ea(a.faceIndex != null ? String(a.faceIndex) : '0') + '" style="flex:0 0 140px">';
        h += '<option value="' + _ea(a.faceIndex != null ? String(a.faceIndex) : '0') + '" selected>표정 ' + _esc(a.faceIndex != null ? String(a.faceIndex) : '0') + '</option>';
        h += '</select>';
        h += '</div>';
        break;
      case 'move':
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="target" value="' + _ea(a.target || '') + '" placeholder="캐릭터 이름" style="flex:2">';
        var rel = (a.relative === true || a.relative === 'true') ? 'true' : 'false';
        h += '<select class="tmgr-sel" data-f="relative" style="flex:0 0 100px">';
        h += '<option value="false"' + (rel === 'false' ? ' selected' : '') + '>절대 좌표</option>';
        h += '<option value="true"'  + (rel === 'true'  ? ' selected' : '') + '>상대 좌표</option>';
        h += '</select>';
        h += '</div>';
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="x" value="' + _ea(a.x != null ? String(a.x) : '0') + '" placeholder="X ({파라미터} 사용 가능)" style="flex:1">';
        h += '<input class="tmgr-inp" data-f="y" value="' + _ea(a.y != null ? String(a.y) : '0') + '" placeholder="Y ({파라미터} 사용 가능)" style="flex:1">';
        h += '</div>';
        h += '<div class="tmgr-hint">상대 좌표: 현재 위치 기준 이동량, 절대 좌표: 맵 좌표 직접 지정. {파라미터}, {계산:}, {#캐릭터!스탯} 사용 가능</div>';
        break;
      case 'initiative':
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="target" value="' + _ea(a.target || '') + '" placeholder="캐릭터 이름" style="flex:2">';
        h += '<input class="tmgr-inp" data-f="value" value="' + _ea(a.value != null ? String(a.value) : '0') + '" placeholder="이니셔티브 값 ({파라미터} 사용 가능)" style="flex:0 0 160px">';
        h += '</div>';
        break;
      case 'memo':
        var mt = a.memoTarget || 'character';
        h += '<div class="tmgr-afrow">';
        h += '<div style="flex:0 0 95px"><label class="tmgr-lbl">대상 유형</label>';
        h += '<select class="tmgr-sel" data-f="memoTarget" style="width:100%">';
        h += '<option value="character"' + (mt === 'character' ? ' selected' : '') + '>캐릭터</option>';
        h += '<option value="object"'   + (mt === 'object'    ? ' selected' : '') + '>스크린</option>';
        h += '<option value="plane"'    + (mt === 'plane'     ? ' selected' : '') + '>마커</option>';
        h += '</select></div>';
        if (mt === 'character') {
          h += '<div style="flex:2"><label class="tmgr-lbl">캐릭터 이름</label>';
          h += '<input class="tmgr-inp" data-f="target" value="' + _ea(a.target || '') + '" placeholder="캐릭터 이름 ({파라미터} 사용 가능)"></div>';
        } else {
          h += '<div style="flex:2"><label class="tmgr-lbl">패널 태그</label>';
          h += '<select class="tmgr-sel tmgr-panel-tag" data-f="target" data-current="' + _ea(a.target || '') + '" style="width:100%">';
          h += '<option value="">로딩 중...</option>';
          if (a.target) h += '<option value="' + _ea(a.target) + '" selected>' + _esc(a.target) + '</option>';
          h += '</select></div>';
        }
        h += '</div>';
        h += '<textarea class="tmgr-inp tmgr-textarea" data-f="memo" placeholder="메모 내용 ({파라미터명} 사용 가능). 여러 줄 입력 가능">' + _esc(a.memo || '') + '</textarea>';
        h += '<div class="tmgr-hint">' + (mt === 'character' ? '캐릭터의 메모를 변경합니다.' : '패널(〔태그〕)의 메모를 변경합니다. 기존 태그는 유지됩니다.') + '</div>';
        break;
      case 'sound':
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="file" value="' + _ea(a.file || '') + '" placeholder="파일명 (예: parry1.mp3, shield1.wav)" style="flex:2">';
        h += '<input class="tmgr-inp" data-f="volume" type="number" min="0" max="1" step="0.05" value="' + _ea(a.volume != null ? String(a.volume) : '0.5') + '" placeholder="볼륨" style="flex:0 0 80px">';
        h += '</div>';
        h += '<div class="tmgr-hint">확장 sounds/ 폴더 내 파일명. 볼륨 0~1</div>';
        break;
      case 'load_scene':
        h += '<input class="tmgr-inp" data-f="sceneName" value="' + _ea(a.sceneName || '') + '" placeholder="장면 이름 ({파라미터명} 사용 가능)">';
        h += '<div class="tmgr-afrow">';
        h += '<span style="font-size:13px;color:' + T.textSec + ';white-space:nowrap">적용 옵션</span>';
        h += '<select class="tmgr-sel" data-f="applyOption" style="flex:1">';
        h += '<option value="all"' + ((a.applyOption || 'all') === 'all' ? ' selected' : '') + '>전체 적용</option>';
        h += '<option value="noBgm"' + (a.applyOption === 'noBgm' ? ' selected' : '') + '>BGM 없이 적용</option>';
        h += '<option value="noText"' + (a.applyOption === 'noText' ? ' selected' : '') + '>텍스트 없이 적용</option>';
        h += '</select></div>';
        h += '<div class="tmgr-hint">네이티브 장면 목록에 등록된 장면 이름을 정확히 입력</div>';
        break;
      case 'panel_move':
        h += _renderPanelTargetRow(a);
        var pmRel = (a.relative === true || a.relative === 'true') ? 'true' : 'false';
        h += '<div class="tmgr-afrow">';
        h += '<select class="tmgr-sel" data-f="relative" style="flex:0 0 100px">';
        h += '<option value="false"' + (pmRel === 'false' ? ' selected' : '') + '>절대 좌표</option>';
        h += '<option value="true"'  + (pmRel === 'true'  ? ' selected' : '') + '>상대 좌표</option>';
        h += '</select>';
        h += '<input class="tmgr-inp" data-f="x" value="' + _ea(a.x != null ? String(a.x) : '0') + '" placeholder="X" style="flex:1">';
        h += '<input class="tmgr-inp" data-f="y" value="' + _ea(a.y != null ? String(a.y) : '0') + '" placeholder="Y" style="flex:1">';
        h += '</div>';
        h += '<div class="tmgr-hint">패널 memo에 〔태그〕 형식으로 작성 → 태그명으로 식별. {파라미터}, {계산:} 사용 가능</div>';
        break;
      case 'panel_rotate':
        h += _renderPanelTargetRow(a);
        var prRel = (a.relative === true || a.relative === 'true') ? 'true' : 'false';
        h += '<div class="tmgr-afrow">';
        h += '<select class="tmgr-sel" data-f="relative" style="flex:0 0 100px">';
        h += '<option value="false"' + (prRel === 'false' ? ' selected' : '') + '>절대 각도</option>';
        h += '<option value="true"'  + (prRel === 'true'  ? ' selected' : '') + '>상대 각도</option>';
        h += '</select>';
        h += '<input class="tmgr-inp" data-f="angle" value="' + _ea(a.angle != null ? String(a.angle) : '0') + '" placeholder="각도 (0~360)" style="flex:1">';
        h += '<span style="font-size:12px;color:' + T.textSec + '">°</span>';
        h += '</div>';
        h += '<div class="tmgr-hint">패널 memo에 〔태그〕 형식으로 작성 → 태그명으로 식별. {파라미터} 사용 가능</div>';
        break;
      case 'panel_copy':
        h += _renderPanelTargetRow(a);
        h += '<div class="tmgr-afrow">';
        h += '<input class="tmgr-inp" data-f="offsetX" value="' + _ea(a.offsetX != null ? String(a.offsetX) : '50') + '" placeholder="X 오프셋" style="flex:1">';
        h += '<input class="tmgr-inp" data-f="offsetY" value="' + _ea(a.offsetY != null ? String(a.offsetY) : '50') + '" placeholder="Y 오프셋" style="flex:1">';
        h += '</div>';
        h += '<div class="tmgr-hint">원본 위치에서 오프셋만큼 이동한 위치에 복사됨. {파라미터} 사용 가능</div>';
        break;
      case 'panel_delete':
        h += _renderPanelTargetRow(a);
        h += '<div class="tmgr-hint">⚠️ 패널이 영구 삭제됩니다. memo에 〔태그〕로 대상 식별</div>';
        break;
      case 'panel_create':
        var pcPt = a.panelType || 'object';
        // Row 1: 유형 + 이미지 + 태그명
        h += '<div class="tmgr-afrow" style="align-items:flex-end">';
        h += '<div style="flex:0 0 95px"><label class="tmgr-lbl">유형</label>';
        h += '<select class="tmgr-sel" data-f="panelType" style="width:100%">';
        h += '<option value="object"' + (pcPt === 'object' ? ' selected' : '') + '>스크린</option>';
        h += '<option value="plane"'  + (pcPt === 'plane'  ? ' selected' : '') + '>마커</option>';
        h += '</select></div>';
        h += '<div style="flex:0 0 auto"><label class="tmgr-lbl">이미지</label>';
        h += '<div class="tmgr-imgpick-wrap" data-mode="lg">';
        h += '<input type="hidden" class="tmgr-imgpick-url" data-f="imageUrl" value="' + _ea(a.imageUrl || '') + '">';
        h += '<img class="tmgr-imgpick-thumb tmgr-imgpick-thumb-lg tmgr-imgpick-btn" src="' + _ea(a.imageUrl || '') + '" title="클릭하여 이미지 변경" style="' + (a.imageUrl ? '' : 'display:none') + '">';
        h += '<button class="tmgr-btn tmgr-btn-sm tmgr-imgpick-btn" type="button" style="' + (a.imageUrl ? 'display:none' : '') + '">선택</button>';
        h += '<button class="tmgr-imgpick-clear" type="button" title="이미지 제거" style="' + (a.imageUrl ? '' : 'display:none') + '">✕</button>';
        h += '</div></div>';
        h += '<div style="flex:1"><label class="tmgr-lbl">태그명</label>';
        h += '<input class="tmgr-inp" data-f="target" value="' + _ea(a.target || '') + '" placeholder="〔태그〕로 저장됨"></div>';
        h += '</div>';
        // Row 2: 메모
        h += '<div style="margin-top:2px"><label class="tmgr-lbl">메모</label>';
        h += '<textarea class="tmgr-inp tmgr-textarea" data-f="description" placeholder="패널 메모 (여러 줄 가능). 태그명 아래에 저장됩니다." style="min-height:40px">' + _esc(a.description || '') + '</textarea>';
        h += '</div>';
        // Row 3: 좌표 + 크기 + 각도 한 줄
        h += '<div class="tmgr-afrow" style="margin-top:4px">';
        h += '<div style="flex:1"><label class="tmgr-lbl">X</label><input class="tmgr-inp" data-f="x" value="' + _ea(a.x != null ? String(a.x) : '0') + '"></div>';
        h += '<div style="flex:1"><label class="tmgr-lbl">Y</label><input class="tmgr-inp" data-f="y" value="' + _ea(a.y != null ? String(a.y) : '0') + '"></div>';
        h += '<div style="flex:1"><label class="tmgr-lbl">너비</label><input class="tmgr-inp" data-f="width" value="' + _ea(a.width != null ? String(a.width) : '4') + '"></div>';
        h += '<div style="flex:1"><label class="tmgr-lbl">높이</label><input class="tmgr-inp" data-f="height" value="' + _ea(a.height != null ? String(a.height) : '4') + '"></div>';
        h += '<div style="flex:1"><label class="tmgr-lbl">각도</label>';
        h += '<input class="tmgr-inp" data-f="angle" value="' + _ea(a.angle != null ? String(a.angle) : '0') + '"></div>';
        h += '</div>';
        h += '<div class="tmgr-hint">좌표·크기는 칸 단위 (1칸 = 24px). 태그명은 memo에 〔태그〕 형식으로 저장됩니다.</div>';
        break;
      case 'wait':
        h += '<div class="tmgr-afrow">';
        h += '<span style="font-size:13px;color:' + T.textSec + ';white-space:nowrap">대기 시간</span>';
        h += '<input class="tmgr-inp" data-f="ms" value="' + _ea(a.ms != null ? String(a.ms) : '300') + '" placeholder="밀리초 ({파라미터} 사용 가능)" style="flex:1">';
        h += '<span style="font-size:12px;color:' + T.textSec + '">ms</span>';
        h += '</div>';
        h += '<div class="tmgr-hint">다음 동작 실행 전 대기할 시간 (1000ms = 1초)</div>';
        break;
    }
    return h;
  }

  // ── 편집 뷰 바인딩 ──

  function _bindEdit(data) {
    if (!dialogEl) return;

    dialogEl.querySelectorAll('[data-a="back"]').forEach(function (b) {
      b.addEventListener('click', function () { renderList(); });
    });
    dialogEl.querySelectorAll('[data-a="close"]').forEach(function (b) {
      b.addEventListener('click', function () { closeDialog(); });
    });

    // 정규식 토글 바인딩
    var regexCb = dialogEl.querySelector('#tf-regex');
    if (regexCb) {
      regexCb.addEventListener('change', function () {
        var patInp = dialogEl.querySelector('#tf-pat');
        var hintEl = dialogEl.querySelector('#tf-pat-hint');
        if (patInp) {
          patInp.placeholder = regexCb.checked
            ? '정규식 패턴 (예: ^(?<대상>.+?)에게 공격$)'
            : '예: 《공격》| {대상} 또는 【방어】| {대상} 또는 자유 형식';
        }
        if (hintEl) {
          hintEl.innerHTML = regexCb.checked
            ? '정규식 모드: JavaScript 정규식을 직접 입력합니다. (?&lt;파라미터명&gt;...) 이름 있는 캡처 그룹으로 파라미터를 정의합니다.'
            : '{파라미터명}으로 파라미터 정의·추출 (예: {대상}, {값}). 비워두면 조건만으로 트리거.';
        }
      });
    }

    // 추가 드롭다운 — paper 밖(overlayEl)으로 이동 (transform 컨텍스트에서 position:fixed 문제 회피)
    var addBtn = dialogEl.querySelector('#tf-add-btn');
    var addDD  = dialogEl.querySelector('#tf-add-dd');
    if (addBtn && addDD && overlayEl) {
      // 기존 드롭다운 정리 후 overlayEl(transform 없음)로 이동
      var oldDD = overlayEl.querySelector('#tf-add-dd');
      if (oldDD && oldDD !== addDD) oldDD.remove();
      overlayEl.appendChild(addDD);
      addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = addDD.classList.contains('open');
        if (isOpen) {
          addDD.classList.remove('open');
        } else {
          // 먼저 보이게 하되 화면 밖에 둬서 scrollHeight 측정
          addDD.style.left = '-9999px';
          addDD.style.top = '0';
          addDD.style.maxHeight = '';
          addDD.classList.add('open');
          var rect = addBtn.getBoundingClientRect();
          var ddH = addDD.scrollHeight || 400;
          var maxH = window.innerHeight * 0.6;
          var actualH = Math.min(ddH, maxH);
          // 버튼 위에 표시, 벗어나면 아래로
          var top = rect.top - actualH - 4;
          if (top < 8) top = rect.bottom + 4;
          // 화면 하단 벗어남 방지
          if (top + actualH > window.innerHeight - 8) top = window.innerHeight - actualH - 8;
          if (top < 8) { top = 8; addDD.style.maxHeight = (window.innerHeight - 16) + 'px'; }
          addDD.style.left = rect.left + 'px';
          addDD.style.top = top + 'px';
        }
      });
      // 드롭다운 외부 클릭 시 닫기 (overlayEl 레벨에서 감지)
      overlayEl.addEventListener('click', function (e) {
        if (!e.target.closest('#tf-add-btn') && !e.target.closest('#tf-add-dd')) addDD.classList.remove('open');
      });
      addDD.querySelectorAll('[data-add]').forEach(function (item) {
        item.addEventListener('click', function () {
          _syncChainDOM(data);
          var type = item.getAttribute('data-add');
          var newItem;
          switch (type) {
            case 'message':        newItem = { type: 'message', template: '' }; break;
            case 'char_message':   newItem = { type: 'char_message', target: '', template: '' }; break;
            case 'cutin':          newItem = { type: 'cutin', tag: '' }; break;
            case 'stat':           newItem = { type: 'stat', target: '', stat: '', op: '+', value: '', valueType: 'value' }; break;
            case 'stat_all':       newItem = { type: 'stat_all', stat: '', op: '=', value: '0', valueType: 'value' }; break;
            case 'param':          newItem = { type: 'param', target: '', param: '', op: '=', value: '' }; break;
            case 'dice':           newItem = { type: 'dice', command: '' }; break;
            case 'face':           newItem = { type: 'face', target: '', faceIndex: '0' }; break;
            case 'move':           newItem = { type: 'move', target: '', x: '0', y: '0', relative: 'false' }; break;
            case 'initiative':     newItem = { type: 'initiative', target: '', value: '0' }; break;
            case 'memo':           newItem = { type: 'memo', target: '', memo: '', memoTarget: 'character' }; break;
            case 'sound':          newItem = { type: 'sound', file: '', volume: '0.5' }; break;
            case 'load_scene':     newItem = { type: 'load_scene', sceneName: '', applyOption: 'all' }; break;
            case 'panel_move':     newItem = { type: 'panel_move', target: '', panelType: '', x: '0', y: '0', relative: 'false' }; break;
            case 'panel_rotate':   newItem = { type: 'panel_rotate', target: '', panelType: '', angle: '0', relative: 'false' }; break;
            case 'panel_copy':     newItem = { type: 'panel_copy', target: '', panelType: '', offsetX: '50', offsetY: '50' }; break;
            case 'panel_delete':   newItem = { type: 'panel_delete', target: '', panelType: '' }; break;
            case 'panel_create':   newItem = { type: 'panel_create', target: '', panelType: 'object', x: '0', y: '0', width: '4', height: '4', angle: '0', imageUrl: '', description: '' }; break;
            case 'wait':           newItem = { type: 'wait', ms: '300' }; break;
            case 'condition_dice': newItem = { type: 'condition_dice', op: '>=', value: '' }; break;
            case 'condition_text': newItem = { type: 'condition_text', field: '', op: '==', value: '' }; break;
            default: return;
          }
          data.actions.push(newItem);
          _rerenderChain(data);
          addDD.classList.remove('open');
        });
      });
    }

    _bindChainCards(data);

    var save = dialogEl.querySelector('#tf-save');
    if (save) save.addEventListener('click', function () { _doSave(data); });
  }

  function _bindChainCards(data) {
    if (!dialogEl) return;

    // 타입 변경
    dialogEl.querySelectorAll('.tmgr-atype').forEach(function (sel) {
      sel.addEventListener('change', function () {
        _syncChainDOM(data);
        var card = sel.closest('[data-idx]');
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        var nw = { type: sel.value };
        switch (sel.value) {
          case 'message':      nw.template = ''; break;
          case 'char_message': nw.target = ''; nw.template = ''; break;
          case 'cutin':        nw.tag = ''; break;
          case 'stat':         nw.target = ''; nw.stat = ''; nw.op = '+'; nw.value = ''; nw.valueType = 'value'; break;
          case 'stat_all':     nw.stat = ''; nw.op = '='; nw.value = '0'; nw.valueType = 'value'; break;
          case 'param':        nw.target = ''; nw.param = ''; nw.op = '='; nw.value = ''; break;
          case 'dice':         nw.command = ''; break;
          case 'face':         nw.target = ''; nw.faceIndex = '0'; break;
          case 'move':         nw.target = ''; nw.x = '0'; nw.y = '0'; nw.relative = 'false'; break;
          case 'initiative':   nw.target = ''; nw.value = '0'; break;
          case 'memo':         nw.target = ''; nw.memo = ''; nw.memoTarget = 'character'; break;
          case 'sound':        nw.file = ''; nw.volume = '0.5'; break;
          case 'load_scene':   nw.sceneName = ''; nw.applyOption = 'all'; break;
          case 'panel_move':   nw.target = ''; nw.panelType = ''; nw.x = '0'; nw.y = '0'; nw.relative = 'false'; break;
          case 'panel_rotate': nw.target = ''; nw.panelType = ''; nw.angle = '0'; nw.relative = 'false'; break;
          case 'panel_copy':   nw.target = ''; nw.panelType = ''; nw.offsetX = '50'; nw.offsetY = '50'; break;
          case 'panel_delete': nw.target = ''; nw.panelType = ''; break;
          case 'panel_create': nw.target = ''; nw.panelType = 'object'; nw.x = '0'; nw.y = '0'; nw.width = '4'; nw.height = '4'; nw.angle = '0'; nw.imageUrl = ''; nw.description = ''; break;
          case 'wait':         nw.ms = '300'; break;
        }
        data.actions[idx] = nw;
        _rerenderChain(data);
      });
    });

    // 삭제
    dialogEl.querySelectorAll('[data-move="del"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _syncChainDOM(data);
        var card = btn.closest('[data-idx]');
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        data.actions.splice(idx, 1);
        _rerenderChain(data);
      });
    });

    // 조건 연산자 변경 시 비교값 입력 표시/숨기기
    dialogEl.querySelectorAll('.tmgr-cond-op').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var valInp = sel.closest('.tmgr-afrow').querySelector('.tmgr-cond-val');
        var isHidden = sel.value === 'empty' || sel.value === 'exists';
        var isStatOp = sel.value === 'stat_exists' || sel.value === 'stat_not_exists';
        if (valInp) {
          valInp.style.display = isHidden ? 'none' : '';
          valInp.placeholder = isStatOp ? '캐릭터 이름 (비우면 화자)' : '비교값';
        }
      });
    });

    // 조건 접기/펼치기
    dialogEl.querySelectorAll('[data-fold]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _syncChainDOM(data);
        var card = btn.closest('[data-idx]');
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        var a = data.actions[idx];
        if (!a) return;
        a.collapsed = !a.collapsed;
        _rerenderChain(data);
      });
    });

    // 드래그 앤 드롭 순서변경
    (function () {
      var actsContainer = dialogEl.querySelector('#tf-acts');
      if (!actsContainer) return;
      var _dragIdx = -1;
      if (!actsContainer._dndBound) {
        actsContainer._dndBound = true;
        actsContainer.addEventListener('mousedown', function (e) {
          var handle = e.target.closest('.tmgr-drag');
          if (handle) {
            var _card = handle.closest('[data-idx]');
            if (_card) _card.setAttribute('draggable', 'true');
          }
        });
        actsContainer.addEventListener('mouseup', function () {
          actsContainer.querySelectorAll('[draggable="true"]').forEach(function (c) {
            if (!c.classList.contains('tmgr-dragging')) c.removeAttribute('draggable');
          });
        });
      }
      actsContainer.querySelectorAll('[data-idx]').forEach(function (card) {
        card.addEventListener('dragstart', function (e) {
          _dragIdx = parseInt(card.getAttribute('data-idx'), 10);
          card.classList.add('tmgr-dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(_dragIdx));
        });
        card.addEventListener('dragend', function () {
          card.classList.remove('tmgr-dragging');
          card.removeAttribute('draggable');
          _dragIdx = -1;
          actsContainer.querySelectorAll('[data-idx]').forEach(function (c) {
            c.classList.remove('tmgr-drop-above', 'tmgr-drop-below');
          });
        });
        card.addEventListener('dragover', function (e) {
          e.preventDefault();
          var ci = parseInt(card.getAttribute('data-idx'), 10);
          if (_dragIdx < 0 || ci === _dragIdx) return;
          e.dataTransfer.dropEffect = 'move';
          actsContainer.querySelectorAll('[data-idx]').forEach(function (c) {
            c.classList.remove('tmgr-drop-above', 'tmgr-drop-below');
          });
          var rect = card.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            card.classList.add('tmgr-drop-above');
          } else {
            card.classList.add('tmgr-drop-below');
          }
        });
        card.addEventListener('dragleave', function () {
          card.classList.remove('tmgr-drop-above', 'tmgr-drop-below');
        });
        card.addEventListener('drop', function (e) {
          e.preventDefault();
          var toIdx = parseInt(card.getAttribute('data-idx'), 10);
          if (_dragIdx < 0 || _dragIdx === toIdx) return;
          var rect = card.getBoundingClientRect();
          var dropAfter = e.clientY >= rect.top + rect.height / 2;
          _syncChainDOM(data);
          var moved = data.actions.splice(_dragIdx, 1)[0];
          var insertPos = _dragIdx < toIdx ? toIdx - 1 : toIdx;
          if (dropAfter) insertPos++;
          data.actions.splice(insertPos, 0, moved);
          _rerenderChain(data);
        });
      });
    })();

    // 표정 변경 드롭다운 비동기 채우기
    dialogEl.querySelectorAll('[data-idx]').forEach(function (card) {
      if (card.querySelector('.tmgr-face-char')) {
        _populateFaceDropdowns(card);
      }
      if (card.querySelector('.tmgr-panel-tag')) {
        _populatePanelDropdowns(card);
      }
      // memoTarget 변경 시 카드 다시 렌더링
      var memoTargetSel = card.querySelector('[data-f="memoTarget"]');
      if (memoTargetSel) {
        memoTargetSel.addEventListener('change', function () {
          _syncChainDOM(data);
          var idx = parseInt(card.getAttribute('data-idx'), 10);
          data.actions[idx].memoTarget = memoTargetSel.value;
          _rerenderChain(data);
        });
      }
      // 이미지 선택 버튼 바인딩
      card.querySelectorAll('.tmgr-imgpick-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var wrap = btn.closest('.tmgr-imgpick-wrap');
          if (!wrap) return;
          var hiddenInput = wrap.querySelector('.tmgr-imgpick-url');
          _showImagePicker(hiddenInput ? hiddenInput.value : '', function (url) {
            if (hiddenInput) hiddenInput.value = url || '';
            _updateImgPickThumb(wrap, url);
          });
        });
      });
      // 이미지 제거 버튼 바인딩
      card.querySelectorAll('.tmgr-imgpick-clear').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var wrap = btn.closest('.tmgr-imgpick-wrap');
          if (!wrap) return;
          var hiddenInput = wrap.querySelector('.tmgr-imgpick-url');
          if (hiddenInput) hiddenInput.value = '';
          _updateImgPickThumb(wrap, '');
        });
      });
    });
  }

  function _rerenderChain(data) {
    var list = dialogEl.querySelector('#tf-acts');
    if (!list) return;
    var h = '';
    var _condGroupIdx = -1;
    var _condCollapsed = false;
    for (var i = 0; i < data.actions.length; i++) {
      var _isCond = data.actions[i].type === 'condition_dice' || data.actions[i].type === 'condition_text';
      if (_isCond) {
        _condGroupIdx++;
        _condCollapsed = data.actions[i].collapsed === true;
        if (_condCollapsed) {
          var _cnt = 0;
          for (var j = i + 1; j < data.actions.length; j++) {
            if (data.actions[j].type === 'condition_dice' || data.actions[j].type === 'condition_text') break;
            if (data.actions[j].inGroup !== false) _cnt++;
          }
          data.actions[i]._collapsedCount = _cnt;
        } else { data.actions[i]._collapsedCount = 0; }
      }
      var _hidden = !_isCond && data.actions[i].inGroup !== false && _condCollapsed;
      h += _renderChainCard(i, data.actions[i], _condGroupIdx, _hidden);
    }
    list.innerHTML = h;
    _bindChainCards(data);
  }

  function _syncChainDOM(data) {
    if (!dialogEl) return;
    dialogEl.querySelectorAll('[data-idx]').forEach(function (card) {
      var idx = parseInt(card.getAttribute('data-idx'), 10);
      if (!data.actions[idx]) return;
      var a = data.actions[idx];
      // 동작 타입 셀렉트 (조건은 타입 변경 불가)
      var ts = card.querySelector('.tmgr-atype');
      if (ts) a.type = ts.value;
      // 필드값 동기화
      card.querySelectorAll('[data-f]').forEach(function (el) {
        a[el.getAttribute('data-f')] = el.value;
      });
    });
  }

  function _doSave(data) {
    if (!triggerEngine || !dialogEl) return;

    var name    = (dialogEl.querySelector('#tf-name')?.value || '').trim();
    var pattern = (dialogEl.querySelector('#tf-pat')?.value || '').trim();
    var isRegex = dialogEl.querySelector('#tf-regex')?.checked || false;
    var source  = dialogEl.querySelector('#tf-src')?.value || 'input';
    var delay   = parseInt(dialogEl.querySelector('#tf-delay')?.value, 10) || 300;
    var pri     = parseInt(dialogEl.querySelector('#tf-pri')?.value, 10) || 0;

    if (!name) { _toast('이름을 입력하세요'); return; }

    _syncChainDOM(data);

    // 조건 아이템은 항상 유효, 동작은 필수 필드 확인
    var actions = data.actions.filter(function (a) {
      delete a.collapsed; delete a._collapsedCount;
      if (a.type === 'condition_dice') return a.value !== '';
      if (a.type === 'condition_text') return a.field !== '' && (a.op === 'empty' || a.op === 'exists' || a.op === 'stat_exists' || a.op === 'stat_not_exists' || a.value !== '');
      switch (a.type) {
        case 'message':      return !!a.template;
        case 'char_message': return !!a.target && !!a.template;
        case 'cutin':        return !!a.tag;
        case 'stat':         return !!a.target && !!a.stat;
        case 'stat_all':     return !!a.stat;
        case 'param':        return !!a.target && !!a.param;
        case 'dice':         return !!a.command;
        case 'face':         return !!a.target;
        case 'move':         return !!a.target;
        case 'initiative':   return !!a.target;
        case 'memo':         return !!a.target;
        case 'sound':        return !!a.file;
        case 'load_scene':   return !!a.sceneName;
        case 'panel_move':   return !!a.target;
        case 'panel_rotate': return !!a.target;
        case 'panel_copy':   return !!a.target;
        case 'panel_delete': return !!a.target;
        case 'panel_create': return true;
        case 'wait':         return parseInt(a.ms, 10) >= 0;
        default: return false;
      }
    });
    var hasRealAction = actions.some(function (a) {
      return a.type !== 'condition_dice' && a.type !== 'condition_text';
    });
    if (!hasRealAction) { _toast('최소 1개의 동작을 추가하세요'); return; }

    var upd = {
      name: name, pattern: pattern, isRegex: isRegex, source: source,
      delay: delay, priority: pri, actions: actions,
      conditions: {
        states: (data.conditions && data.conditions.states) || []
      }
    };

    if (editingId) {
      triggerEngine.updateTrigger(editingId, upd);
      _toast('저장됨');
    } else {
      upd.enabled = true;
      triggerEngine.addTrigger(upd);
      _toast('추가됨');
    }
    renderList();
  }

  // ══════════════════════════════════════════════════════════
  //  가져오기 / 내보내기
  // ══════════════════════════════════════════════════════════

  function _doExport() {
    if (!triggerEngine) return;
    var json = triggerEngine.exportJSON();
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'bwbr-triggers-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    _toast('내보내기 완료');
  }

  function _doImport() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.addEventListener('change', function () {
      if (!inp.files || !inp.files[0]) return;
      var r = new FileReader();
      r.onload = function () {
        if (!triggerEngine) return;
        var res = triggerEngine.importJSON(r.result);
        if (res.success) { _toast(res.count + '개 가져오기 완료'); renderList(); }
        else { _toast('실패: ' + res.error); }
      };
      r.readAsText(inp.files[0]);
    });
    inp.click();
  }

  // ══════════════════════════════════════════════════════════
  //  유틸
  // ══════════════════════════════════════════════════════════

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }
  function _ea(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _toast(msg) {
    var old = document.querySelector('.tmgr-toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'tmgr-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2500);
  }

  // ══════════════════════════════════════════════════════════
  //  전역 API
  // ══════════════════════════════════════════════════════════

  window.BWBR_TriggerUI = {
    init: function (engine) {
      triggerEngine = engine;
      if (_findToolbar()) {
        injectToolbarButton();
      } else {
        var obs = new MutationObserver(function () {
          if (_findToolbar()) { obs.disconnect(); injectToolbarButton(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () { obs.disconnect(); }, 30000);
      }
    },
    open:  function () { openDialog(); },
    close: function () { closeDialog(); }
  };

})();
