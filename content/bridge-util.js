// ============================================================
// [CORE] 크로스월드 브릿지 유틸리티
//
// ISOLATED ↔ MAIN 세계 간 통신을 표준화합니다.
// 반복되는 setAttribute/addEventListener/setTimeout 보일러플레이트를
// request() / send() / on() 세 메서드로 캡슐화합니다.
//
// ※ redux-injector.js (MAIN world)는 변경하지 않습니다.
//    기존 이벤트명·속성명을 그대로 사용합니다.
// ============================================================

window.BWBR_Bridge = (() => {
  'use strict';

  const _el = document.documentElement;

  // ──────────────────────────────────────────────────
  //  request()  — 요청-응답 패턴 (Promise 기반)
  // ──────────────────────────────────────────────────
  //
  //  사용 예:
  //    const chars = await BWBR_Bridge.request(
  //      'bwbr-request-characters', 'bwbr-characters-data',
  //      null,
  //      { recvAttr: 'data-bwbr-characters-data', timeout: 5000 }
  //    );
  //
  //  payload 가 null/undefined 이면 sendAttr 쓰기를 건너뜁니다.
  //  recvAttr 가 null(기본) 이면 e.detail 을 사용합니다.
  //  timeout 초과 시 reject — 필요하면 .catch(() => null) 로 흡수.
  //
  /**
   * @param {string}  reqEvent  요청 이벤트명
   * @param {string}  resEvent  응답 이벤트명
   * @param {*}       [payload] 전송 데이터 (null → 속성 쓰기 생략)
   * @param {Object}  [opts]
   * @param {string}  [opts.sendAttr]  요청 속성명 (기본 'data-'+reqEvent)
   * @param {string}  [opts.recvAttr]  응답 속성명 (null → e.detail 사용)
   * @param {number}  [opts.timeout]   타임아웃 ms (기본 5000)
   * @param {EventTarget} [opts.on]    수신 이벤트 타겟 (기본 window)
   * @param {EventTarget} [opts.emit]  송신 이벤트 타겟 (기본 on 과 동일)
   * @returns {Promise<*>}
   */
  function request(reqEvent, resEvent, payload, opts) {
    const o = opts || {};
    const timeout     = o.timeout  ?? 5000;
    const listenTarget = o.on      ?? window;
    const emitTarget   = o.emit    ?? listenTarget;
    const recvAttr     = o.recvAttr ?? null;
    const sendAttr     = o.sendAttr ?? ('data-' + reqEvent);

    return new Promise((resolve, reject) => {
      let settled = false;

      const handler = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        listenTarget.removeEventListener(resEvent, handler);

        if (recvAttr) {
          const raw = _el.getAttribute(recvAttr);
          _el.removeAttribute(recvAttr);
          try { resolve(raw ? JSON.parse(raw) : null); }
          catch { resolve(raw); }
        } else {
          resolve(e.detail ?? null);
        }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        listenTarget.removeEventListener(resEvent, handler);
        reject(new Error(`[CE Bridge] timeout: ${resEvent} (${timeout}ms)`));
      }, timeout);

      listenTarget.addEventListener(resEvent, handler);

      // 페이로드 쓰기
      if (payload !== undefined && payload !== null) {
        _el.setAttribute(sendAttr,
          typeof payload === 'string' ? payload : JSON.stringify(payload));
      }

      emitTarget.dispatchEvent(new CustomEvent(reqEvent));
    });
  }

  // ──────────────────────────────────────────────────
  //  send()  — 단방향 전송 (fire-and-forget)
  // ──────────────────────────────────────────────────
  /**
   * @param {string}  eventName  이벤트명
   * @param {*}       [payload]  전송 데이터
   * @param {Object}  [opts]
   * @param {string}  [opts.attr]    속성명 (기본 'data-'+eventName)
   * @param {EventTarget} [opts.target] 이벤트 타겟 (기본 window)
   */
  function send(eventName, payload, opts) {
    const o = opts || {};
    const target = o.target ?? window;
    if (payload !== undefined && payload !== null) {
      const attr = o.attr ?? ('data-' + eventName);
      _el.setAttribute(attr,
        typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    target.dispatchEvent(new CustomEvent(eventName));
  }

  // ──────────────────────────────────────────────────
  //  on()  — 지속 리스너 등록
  // ──────────────────────────────────────────────────
  /**
   * @param {string}   eventName  이벤트명
   * @param {Function} callback   (data, event) => void
   * @param {Object}   [opts]
   * @param {string}   [opts.attr]    응답 속성명 (null → e.detail)
   * @param {EventTarget} [opts.target] (기본 window)
   * @returns {Function} 해제 함수
   */
  function on(eventName, callback, opts) {
    const o = opts || {};
    const attr = o.attr ?? null;
    const target = o.target ?? window;

    const handler = (e) => {
      if (attr) {
        const raw = _el.getAttribute(attr);
        _el.removeAttribute(attr);
        let data;
        try { data = raw ? JSON.parse(raw) : null; }
        catch { data = raw; }
        callback(data, e);
      } else {
        callback(e.detail ?? null, e);
      }
    };

    target.addEventListener(eventName, handler);
    return () => target.removeEventListener(eventName, handler);
  }

  // ──────────────────────────────────────────────────
  //  setAttr() / getAttr()  — 저수준 속성 헬퍼
  //  (여러 속성을 직접 쓸 때 사용)
  // ──────────────────────────────────────────────────
  function setAttr(name, value) {
    _el.setAttribute(name,
      typeof value === 'string' ? value : JSON.stringify(value));
  }

  function getAttr(name, remove) {
    const raw = _el.getAttribute(name);
    if (remove !== false) _el.removeAttribute(name);
    try { return raw ? JSON.parse(raw) : null; }
    catch { return raw; }
  }

  return { request, send, on, setAttr, getAttr };
})();


// ============================================================
// [CORE] 캐릭터 데이터 캐시
//
// bwbr-request-characters / bwbr-request-all-characters 를 캐시하여
// 동일 프레임 내 중복 요청을 제거합니다.
// ============================================================

window.BWBR_CharCache = (() => {
  'use strict';

  const TTL = 800; // ms
  let _chars    = null, _charsTime    = 0;
  let _allChars = null, _allCharsTime = 0;

  /**
   * 활성 캐릭터 목록 (bwbr-request-characters).
   * @returns {Promise<Array>}
   */
  async function getActive() {
    const now = Date.now();
    if (_chars && (now - _charsTime) < TTL) return _chars;
    try {
      const data = await BWBR_Bridge.request(
        'bwbr-request-characters', 'bwbr-characters-data',
        null,
        { recvAttr: 'data-bwbr-characters-data', timeout: 3000 }
      );
      _chars = data?.characters ?? data ?? [];
      _charsTime = Date.now();
      return _chars;
    } catch {
      return _chars || [];
    }
  }

  /**
   * 전체 캐릭터 목록 (bwbr-request-all-characters).
   * @returns {Promise<Array>}
   */
  async function getAll() {
    const now = Date.now();
    if (_allChars && (now - _allCharsTime) < TTL) return _allChars;
    try {
      const data = await BWBR_Bridge.request(
        'bwbr-request-all-characters', 'bwbr-all-characters-data',
        null,
        { recvAttr: 'data-bwbr-all-characters-data', timeout: 3000 }
      );
      _allChars = data?.characters ?? data ?? [];
      _allCharsTime = Date.now();
      return _allChars;
    } catch {
      return _allChars || [];
    }
  }

  /** 캐시 무효화 */
  function invalidate() {
    _chars = null;
    _allChars = null;
  }

  return { getActive, getAll, invalidate };
})();
