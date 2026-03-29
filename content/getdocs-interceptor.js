/**
 * getdocs-interceptor.js — MAIN world, document_start
 *
 * ccfolia의 webpack 번들이 Firestore getDocs를 import하기 전에
 * 함수를 래핑하여, _fileOverrides가 있으면 쿼리 결과에 반영합니다.
 *
 * 주입 순서: site-volume-page.js → getdocs-interceptor.js → (ccfolia 번들) → redux-injector.js
 * 통신: window.__ceFileOverrides (redux-injector.js가 설정)
 */
(function () {
  'use strict';

  // _FS_CONFIG와 동일한 값 (redux-injector.js와 동기화 필요)
  const FS_MODULE_ID = 49631;
  const GETDOCS_KEY = 'PL';

  // redux-injector.js가 나중에 설정하는 오버라이드 맵
  // window.__ceFileOverrides = Map<docId, { dir, updatedAt }>
  // window.__ceFileOverrideVer = number (변경 시 증가)

  let _wrapped = false;

  /**
   * webpack 모듈 팩토리를 래핑하여 getDocs export를 가로챕니다.
   */
  function wrapModuleFactory(moreModules) {
    if (_wrapped || !moreModules || !moreModules[FS_MODULE_ID]) return;
    _wrapped = true;

    const origFactory = moreModules[FS_MODULE_ID];
    moreModules[FS_MODULE_ID] = function (module, exports, require) {
      // 원본 팩토리 실행
      origFactory.call(this, module, exports, require);

      // getDocs 래핑
      const origGetDocs = exports[GETDOCS_KEY];
      if (typeof origGetDocs !== 'function') {
        console.warn('[CE getDocs] key', GETDOCS_KEY, '가 함수가 아님, 래핑 스킵');
        return;
      }

      exports[GETDOCS_KEY] = async function wrappedGetDocs() {
        const snapshot = await origGetDocs.apply(this, arguments);

        // 오버라이드가 없으면 원본 그대로 반환
        const overrides = window.__ceFileOverrides;
        if (!overrides || overrides.size === 0) return snapshot;

        // 쿼리가 files 컬렉션인지 확인 (users/{uid}/files)
        const queryRef = arguments[0];
        const path = queryRef?._query?.path?.segments?.join?.('/') ||
                     queryRef?.path?.segments?.join?.('/') || '';
        if (!path.includes('/files')) return snapshot;

        // QuerySnapshot의 docs를 래핑
        let patchCount = 0;
        const origDocs = snapshot.docs;
        const patchedDocs = origDocs.map(doc => {
          const docId = doc.id;
          const ov = overrides.get(docId);
          if (!ov) return doc;

          // 이 문서의 data()를 래핑하여 오버라이드 적용
          patchCount++;
          return new Proxy(doc, {
            get(target, prop) {
              if (prop === 'data') {
                return function () {
                  const orig = target.data.apply(target, arguments);
                  return { ...orig, ...ov };
                };
              }
              return target[prop];
            }
          });
        });

        if (patchCount > 0) {
          console.log(`[CE getDocs] ${patchCount}개 문서 오버라이드 적용 (path: ${path.slice(-30)})`);

          // QuerySnapshot을 Proxy로 래핑하여 docs/forEach/size 등 오버라이드
          return new Proxy(snapshot, {
            get(target, prop) {
              if (prop === 'docs') return patchedDocs;
              if (prop === 'forEach') {
                return function (cb, ctx) {
                  patchedDocs.forEach(cb, ctx);
                };
              }
              if (prop === 'size') return patchedDocs.length;
              if (prop === Symbol.iterator) {
                return function* () {
                  yield* patchedDocs;
                };
              }
              return typeof target[prop] === 'function'
                ? target[prop].bind(target)
                : target[prop];
            }
          });
        }

        return snapshot;
      };

      console.log('[CE getDocs] ✅ getDocs 래핑 완료 (모듈', FS_MODULE_ID, ')');
    };
  }

  // webpackChunkccfolia.push 가로채기
  const chunks = window.webpackChunkccfolia = window.webpackChunkccfolia || [];

  // 이미 로드된 청크에서 모듈 확인 (거의 없지만 안전장치)
  for (const chunk of chunks) {
    if (chunk?.[1]) wrapModuleFactory(chunk[1]);
  }

  // 향후 push 가로채기
  const origPush = chunks.push.bind(chunks);
  chunks.push = function (chunk) {
    if (chunk?.[1]) wrapModuleFactory(chunk[1]);
    return origPush(chunk);
  };

  console.log('[CE getDocs] webpack 인터셉터 설정 완료');
})();
