// === 진단 스크립트: 네이티브 호버 버튼 + 수정 다이얼로그 DOM 캡처 ===
// F12 콘솔에 붙여넣기
// 1단계: 자신이 보낸 텍스트 메시지 위에 마우스 올리기 → 호버 컨테이너 DOm 출력
// 2단계: 네이티브 수정 버튼 클릭 → 수정 다이얼로그 DOM/스타일 출력

(function() {
  console.log('=== 진단 시작 ===');

  // 1단계: 호버 컨테이너 관찰
  var msgList = document.querySelector('ul.MuiList-root');
  if (!msgList) { console.error('메시지 리스트 없음'); return; }

  function describeNode(el, depth) {
    if (!el || depth > 8) return '';
    var indent = '  '.repeat(depth);
    var tag = el.tagName;
    var cn = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
    var attrs = '';
    if (el.getAttribute('role')) attrs += ' role=' + el.getAttribute('role');
    if (el.getAttribute('aria-label')) attrs += ' aria-label="' + el.getAttribute('aria-label') + '"';
    if (el.getAttribute('title')) attrs += ' title="' + el.getAttribute('title') + '"';
    if (el.getAttribute('type')) attrs += ' type=' + el.getAttribute('type');
    if (tag === 'BUTTON' || tag === 'INPUT') attrs += ' tabIndex=' + el.tabIndex;
    if (tag === 'SVG' || tag === 'svg') {
      var path = el.querySelector('path');
      if (path) attrs += ' d="' + (path.getAttribute('d') || '').slice(0, 40) + '..."';
    }
    var text = '';
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      text = ' → "' + el.textContent.trim().slice(0, 50) + '"';
    }

    var line = indent + tag + (cn ? '.' + cn.split(/\s+/).slice(0, 3).join('.') : '') + attrs + text;
    var result = line + '\n';

    for (var i = 0; i < el.children.length; i++) {
      result += describeNode(el.children[i], depth + 1);
    }
    return result;
  }

  // 리스트 아이템에 mouseenter 감시
  var captured = false;
  msgList.addEventListener('mouseover', function handler(e) {
    if (captured) return;
    var item = e.target.closest('.MuiListItem-root');
    if (!item) return;

    // 호버 후 500ms 대기 (네이티브 호버 버튼이 나타날 시간)
    setTimeout(function() {
      console.log('\n=== [1단계] MuiListItem-root 전체 DOM ===');
      console.log(describeNode(item, 0));

      // MuiListItem-root의 직접 자식들 목록
      console.log('\n=== 직접 자식 (direct children) ===');
      for (var i = 0; i < item.children.length; i++) {
        var c = item.children[i];
        var cname = typeof c.className === 'string' ? c.className : (c.className.baseVal || '');
        console.log(i + ': <' + c.tagName + '> class="' + cname.slice(0, 80) + '"');
      }

      // 모든 버튼 찾기
      var btns = item.querySelectorAll('button');
      console.log('\n=== 아이템 내 모든 <button> (' + btns.length + '개) ===');
      for (var j = 0; j < btns.length; j++) {
        var b = btns[j];
        var bcn = typeof b.className === 'string' ? b.className : '';
        console.log(j + ': class="' + bcn.slice(0, 80) + '"');
        console.log('   title="' + (b.title || '') + '" aria-label="' + (b.getAttribute('aria-label') || '') + '"');
        console.log('   parent class="' + (typeof b.parentElement.className === 'string' ? b.parentElement.className.slice(0, 80) : '') + '"');
        console.log('   parent tag=' + b.parentElement.tagName);
        console.log('   computed visibility=' + getComputedStyle(b).visibility + ' opacity=' + getComputedStyle(b).opacity);
        console.log('   computed display=' + getComputedStyle(b).display);
        // SVG path
        var svg = b.querySelector('svg path');
        if (svg) console.log('   svg d="' + (svg.getAttribute('d') || '').slice(0, 60) + '..."');
      }

      // 네이티브 호버 컨테이너 (마지막 직접 자식 DIV 중 sc- 또는 styled)
      var lastChild = item.children[item.children.length - 1];
      if (lastChild && lastChild.tagName === 'DIV') {
        var lcn = lastChild.className || '';
        console.log('\n=== 마지막 자식 DIV (호버 컨테이너 후보) ===');
        console.log('class="' + lcn + '"');
        console.log('computed: position=' + getComputedStyle(lastChild).position +
          ' display=' + getComputedStyle(lastChild).display +
          ' opacity=' + getComputedStyle(lastChild).opacity +
          ' visibility=' + getComputedStyle(lastChild).visibility);
        console.log('innerHTML 길이: ' + lastChild.innerHTML.length);
        console.log(describeNode(lastChild, 1));
      }

      captured = true;
      console.log('\n✅ 1단계 완료! 이제 네이티브 수정 버튼(연필)을 클릭하세요.');
    }, 500);
  }, { once: false });

  // 2단계: 수정 다이얼로그 감시 (MUI Dialog / Backdrop)
  var dialogObserver = new MutationObserver(function(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      for (var n = 0; n < mutations[m].addedNodes.length; n++) {
        var node = mutations[m].addedNodes[n];
        if (node.nodeType !== 1) continue;

        // MUI Dialog 또는 role="dialog" 또는 role="presentation"
        var dialog = node.querySelector ? (
          node.querySelector('[role="dialog"]') ||
          node.querySelector('[role="presentation"]') ||
          (node.getAttribute && node.getAttribute('role') === 'presentation' ? node : null) ||
          (node.getAttribute && node.getAttribute('role') === 'dialog' ? node : null)
        ) : null;

        // Backdrop 감지
        var backdrop = node.querySelector ? node.querySelector('.MuiBackdrop-root') : null;
        if (!backdrop && node.classList && node.classList.contains('MuiBackdrop-root')) backdrop = node;

        if (dialog || backdrop || (node.querySelector && node.querySelector('textarea'))) {
          console.log('\n=== [2단계] 수정 다이얼로그 감지! ===');

          // 전체 모달 컨테이너
          var modalRoot = dialog || node;
          var parent = modalRoot;
          // 최상위 모달 래퍼 찾기
          for (var up = 0; up < 5; up++) {
            if (parent.parentElement && parent.parentElement !== document.body) {
              parent = parent.parentElement;
            }
          }

          console.log('\n--- 모달 최상위 ---');
          console.log('tag=' + parent.tagName + ' class="' + (parent.className || '').slice(0, 100) + '"');
          console.log('role=' + (parent.getAttribute('role') || 'none'));

          // 모달 루트의 직접 자식들
          console.log('\n--- 모달 루트 직접 자식 ---');
          for (var ci = 0; ci < parent.children.length; ci++) {
            var ch = parent.children[ci];
            console.log(ci + ': <' + ch.tagName + '> class="' + (ch.className || '').slice(0, 80) + '"');
            var cs = getComputedStyle(ch);
            console.log('   bg=' + cs.backgroundColor + ' opacity=' + cs.opacity);
            if (ch.classList && ch.classList.contains('MuiBackdrop-root')) {
              console.log('   ★ BACKDROP transition=' + cs.transition);
              console.log('   ★ BACKDROP animation=' + cs.animation);
            }
          }

          // Backdrop 상세
          if (backdrop) {
            var bs = getComputedStyle(backdrop);
            console.log('\n--- Backdrop 상세 ---');
            console.log('class="' + (backdrop.className || '') + '"');
            console.log('bg=' + bs.backgroundColor);
            console.log('opacity=' + bs.opacity);
            console.log('transition=' + bs.transition);
            console.log('z-index=' + bs.zIndex);
          }

          // textarea 찾기
          var ta = parent.querySelector('textarea');
          if (ta) {
            var tas = getComputedStyle(ta);
            console.log('\n--- Textarea ---');
            console.log('class="' + (ta.className || '').slice(0, 80) + '"');
            console.log('rows=' + ta.rows + ' value길이=' + ta.value.length);
            console.log('bg=' + tas.backgroundColor + ' color=' + tas.color);
            console.log('border=' + tas.border);
            console.log('fontSize=' + tas.fontSize + ' fontFamily=' + tas.fontFamily.slice(0, 40));
            console.log('padding=' + tas.padding);
            console.log('width=' + tas.width + ' height=' + tas.height);
          }

          // 다이얼로그 박스(Paper) 찾기
          var paper = parent.querySelector('.MuiDialog-paper, .MuiPaper-root, [role="dialog"]');
          if (paper) {
            var ps = getComputedStyle(paper);
            console.log('\n--- Dialog Paper ---');
            console.log('class="' + (paper.className || '').slice(0, 100) + '"');
            console.log('bg=' + ps.backgroundColor + ' color=' + ps.color);
            console.log('borderRadius=' + ps.borderRadius);
            console.log('padding=' + ps.padding);
            console.log('maxWidth=' + ps.maxWidth + ' width=' + ps.width);
            console.log('boxShadow=' + ps.boxShadow.slice(0, 80));
            console.log('transition=' + ps.transition);
            console.log('transform=' + ps.transform);
          }

          // 버튼들
          var dbtns = parent.querySelectorAll('button');
          console.log('\n--- 다이얼로그 버튼들 (' + dbtns.length + '개) ---');
          for (var bi = 0; bi < dbtns.length; bi++) {
            var db = dbtns[bi];
            var dbs = getComputedStyle(db);
            console.log(bi + ': "' + db.textContent.trim().slice(0, 20) + '" class="' + (db.className || '').slice(0, 80) + '"');
            console.log('   bg=' + dbs.backgroundColor + ' color=' + dbs.color);
            console.log('   padding=' + dbs.padding + ' borderRadius=' + dbs.borderRadius);
            console.log('   fontSize=' + dbs.fontSize);
          }

          // 전체 DOM 트리
          console.log('\n--- 다이얼로그 DOM 트리 ---');
          console.log(describeNode(parent, 0));

          dialogObserver.disconnect();
          console.log('\n✅ 2단계 완료!');
          return;
        }
      }
    }
  });

  dialogObserver.observe(document.body, { childList: true, subtree: true });
  console.log('✅ 준비 완료!');
  console.log('1) 자신이 보낸 텍스트 메시지 위에 마우스를 올려주세요');
  console.log('2) 그 다음 네이티브 수정 버튼(연필)을 클릭하세요');
})();
