/**
 * getdocs-interceptor.js — MAIN world, document_start
 *
 * webpack chunk push를 defineProperty로 인터셉트하여
 * Firestore 모듈(49631)의 팩토리를 래핑합니다.
 *
 * 팩토리 실행 후 module.exports를 Proxy로 교체하여
 * PL(getDocs) 접근 시 window.__ceWrappedGetDocs를 반환합니다.
 * (getter-only + non-configurable export 우회)
 *
 * redux-injector.js가 나중에 설정:
 *   window.__ceFileOverrides = Map<docId, { dir, updatedAt }>
 *   window.__ceWrappedGetDocs = async function(...)
 */
(function () {
  'use strict';

  const FS_MODULE_ID = '49631';
  const GETDOCS_KEY = 'PL';
  // Firestore 모듈 식별용 키 (오탐 방지)
  const FS_VERIFY_KEYS = ['PL', 'hJ', 'JU', 'pl'];

  let _wpPush = null;   // webpack의 실제 push 함수
  let _wrapped = false;

  function wrapFactory(moreModules) {
    if (_wrapped) return;
    const factory = moreModules[FS_MODULE_ID];
    if (typeof factory !== 'function') return;
    _wrapped = true;

    moreModules[FS_MODULE_ID] = function (module, exports, require) {
      // 원본 팩토리 실행 (getter-only exports 설정됨)
      factory.call(this, module, exports, require);

      // Firestore 모듈인지 검증 (알려진 키 3개 이상 매칭)
      let keyMatch = 0;
      for (const k of FS_VERIFY_KEYS) {
        try { if (typeof exports[k] === 'function') keyMatch++; } catch {}
      }
      if (keyMatch < 3) {
        console.warn('[CE early] 모듈 ' + FS_MODULE_ID + ' 키 매칭 부족:', keyMatch);
        _wrapped = false;
        return;
      }

      const origGetDocs = exports[GETDOCS_KEY];
      if (typeof origGetDocs !== 'function') {
        _wrapped = false;
        return;
      }

      // module.exports를 Proxy로 교체
      // webpack 컴파일 코드: (0, module.PL)(query) → Proxy.get 트리거
      const origExports = module.exports;
      module.exports = new Proxy(origExports, {
        get(target, prop) {
          if (prop === GETDOCS_KEY && window.__ceWrappedGetDocs) {
            return window.__ceWrappedGetDocs;
          }
          return Reflect.get(target, prop);
        }
      });

      // 원본 getDocs를 window에 노출 (redux-injector.js에서 래퍼 생성 시 사용)
      window.__ceOrigGetDocs = origGetDocs;

      console.log('[CE early] ✅ Firestore getDocs Proxy 설정 완료');
    };
  }

  // Push 인터셉터 (재귀 방지 플래그)
  let _inPush = false;
  function interceptPush() {
    if (_inPush) {
      // 재귀 호출 — webpack 내부 push, 원본으로 바이패스
      return Array.prototype.push.apply(this, arguments);
    }
    _inPush = true;
    try {
      const chunk = arguments[0];
      if (Array.isArray(chunk) && chunk[1] && typeof chunk[1] === 'object') {
        wrapFactory(chunk[1]);
      }
      if (_wpPush) {
        return _wpPush.apply(this, arguments);
      }
      return Array.prototype.push.apply(this, arguments);
    } finally {
      _inPush = false;
    }
  }

  // webpackChunkccfolia 배열 생성/획득
  const arr = window.webpackChunkccfolia = window.webpackChunkccfolia || [];

  // 이미 존재하는 청크 처리 (거의 없지만 안전장치)
  for (const chunk of arr) {
    if (Array.isArray(chunk) && chunk[1]) wrapFactory(chunk[1]);
  }

  // defineProperty로 push를 인터셉트:
  // - get: 항상 interceptPush 반환 → ccfolia가 push()할 때 우리 코드 실행
  // - set: webpack이 push를 자체 함수로 교체할 때 실제 함수를 캡처
  Object.defineProperty(arr, 'push', {
    get() { return interceptPush; },
    set(fn) { _wpPush = fn; },
    configurable: true,
    enumerable: false
  });

  console.log('[CE early] webpack 인터셉터 설정 완료');
})();
