// ============================================================
// Redux Store Injector - 페이지 컨텍스트에서 Redux Store 획득
// MAIN world에서 실행되어 React internals에 접근
// Content Script와 CustomEvent로 통신
//
// [모듈 분류 가이드]
//   [CORE]    = 범용 코코포리아 확장 (채팅, 캐릭터, 컷인, 로그, 방복사)
//   [COMBAT]  = 가지세계 전투 모듈 (스탯변경, 토큰바인딩, 그리드, 이동)
//   [TRIGGER] = 트리거 자동화 모듈 (패널조작, 씨/룸필드, 체릭터필드)
//   [DEBUG]   = 진단/디버그 전용 (덤프, 스냅샷, 로깅)
// ============================================================

(function() {
  'use strict';

  // 이미 로드되었으면 스킵
  if (window.__BWBR_REDUX_INJECTED) return;
  window.__BWBR_REDUX_INJECTED = true;

  let reduxStore = null;

  // ── [COMBAT] 토큰 바인딩 캐시 (ISOLATED world에서 동기화) ──
  let _tokenBindings = {};      // { panelId: charId }
  let _tokenBindingsRoomId = null;

  // ── 디버그 모드 (ISOLATED world에서 전달) ──
  let _debugMode = false;
  function _dbg(...args) {
    if (!_debugMode) return;
    console.log(...args);
  }
  document.addEventListener('bwbr-set-debug', () => {
    _debugMode = document.documentElement.getAttribute('data-bwbr-debug') === 'true';
  });
  // 초기 값 (이미 설정된 경우)
  if (document.documentElement.getAttribute('data-bwbr-debug') === 'true') _debugMode = true;

  // ================================================================
  //  Firestore 직접 메시지 전송 설정
  //  코코포리아 업데이트 시 아래 값들을 COCOFOLIA_DATA_API.md 섹션 8 참조하여 갱신
  // ================================================================
  const _FS_CONFIG = {
    firestoreModId: 49631,   // Firestore SDK 함수 모듈
    dbModId: 5156,           // Firestore DB 인스턴스 모듈
    fsKeys: { setDoc: 'pl', doc: 'JU', collection: 'hJ', getDocs: 'PL', deleteDoc: 'oe' },
    dbKey: 'db'
  };

  let _wpRequire = null;
  let _firestoreSDK = null;  // { db, setDoc, doc, collection, getDocs, deleteDoc }

  /**
   * React Fiber 트리를 순회하여 Redux Store를 찾습니다.
   */
  function getReduxStore() {
    const root = document.getElementById('root');
    if (!root) return null;

    // React Fiber 키 찾기
    const fiberKey = Object.keys(root).find(k =>
      k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')
    );
    if (!fiberKey) return null;

    let fiber = root[fiberKey];
    let depth = 0;
    const maxDepth = 50;

    while (fiber && depth < maxDepth) {
      // Provider의 context에서 store 찾기
      const ctx = fiber.memoizedProps?.value?.store;
      if (ctx && typeof ctx.getState === 'function') {
        return ctx;
      }
      
      // memoizedProps.store 직접 체크 (다른 패턴)
      const directStore = fiber.memoizedProps?.store;
      if (directStore && typeof directStore.getState === 'function') {
        return directStore;
      }

      // Fiber 트리 순회 (child → sibling → parent's sibling)
      fiber = fiber.child || fiber.sibling || fiber.return?.sibling;
      depth++;
    }

    return null;
  }

  /**
   * Redux Store에서 활성 캐릭터 데이터 추출
   * "화면 캐릭터 목록"에서 활성화(체크)된 캐릭터만 반환
   * hideStatus가 true인 캐릭터는 사이드바에서 숨겨진 상태
   */
  function getCharacterData() {
    if (!reduxStore) return null;

    try {
      const state = reduxStore.getState();
      const rc = state.entities?.roomCharacters;
      if (!rc) return null;

      const characters = [];
      for (const id of (rc.ids || [])) {
        const char = rc.entities?.[id];
        if (!char) continue;
        
        // 사이드바에서 표시된 캐릭터만 (hideStatus가 true가 아닌 것)
        if (char.hideStatus === true) continue;

        characters.push({
          _id: char._id || id,
          name: char.name || '이름 없음',
          initiative: char.initiative || 0,
          params: char.params || [],
          status: char.status || [],
          active: char.active,
          iconUrl: char.iconUrl || null,
          memo: char.memo || ''
        });
      }

      _dbg(`%c[CE Redux]%c 사이드바 캐릭터 ${characters.length}명 선택됨`, 
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      return characters;
    } catch (e) {
      console.error('[CE Redux] 캐릭터 데이터 추출 실패:', e);
      return null;
    }
  }

  /**
   * Redux Store를 찾아 초기화
   */
  function setupStore() {
    reduxStore = getReduxStore();
    
    if (reduxStore) {
      const chars = getCharacterData();
      const charCount = chars?.length || 0;
      
      console.log('%c[CE Redux]%c ✅ Store 획득 성공! 캐릭터 수: ' + charCount, 
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      // Content Script에 성공 알림
      window.dispatchEvent(new CustomEvent('bwbr-redux-ready', {
        detail: { success: true, characterCount: charCount }
      }));

      // ★ speaking 캐릭터 변경 감시 (Redux subscription)
      let _prevSpeakingName = null;
      reduxStore.subscribe(() => {
        try {
          const rc = reduxStore.getState().entities?.roomCharacters;
          if (!rc?.ids) return;
          let currentSpeaker = null;
          for (const id of rc.ids) {
            const c = rc.entities?.[id];
            if (c?.speaking) { currentSpeaker = c.name || null; break; }
          }
          if (currentSpeaker !== _prevSpeakingName) {
            _prevSpeakingName = currentSpeaker;
            // DOM 속성 브릿지로 ISOLATED world에 통보
            document.documentElement.setAttribute('data-bwbr-speaker-name', currentSpeaker || '');
            document.dispatchEvent(new CustomEvent('bwbr-speaker-changed'));
          }
        } catch (e) {}
      });

      // 초기 발화 캐릭터 즉시 브로드캐스트 (subscribe는 변경 시에만 동작하므로)
      try {
        const rc = reduxStore.getState().entities?.roomCharacters;
        if (rc?.ids) {
          for (const id of rc.ids) {
            const c = rc.entities?.[id];
            if (c?.speaking) {
              _prevSpeakingName = c.name || null;
              document.documentElement.setAttribute('data-bwbr-speaker-name', _prevSpeakingName || '');
              document.dispatchEvent(new CustomEvent('bwbr-speaker-changed'));
              break;
            }
          }
        }
      } catch (e) {}

      return true;
    }

    return false;
  }

  // 초기 시도
  if (!setupStore()) {
    // 실패 시 재시도 (React 로드 대기)
    let attempts = 0;
    const maxAttempts = 10;
    const interval = setInterval(() => {
      attempts++;
      if (setupStore() || attempts >= maxAttempts) {
        clearInterval(interval);
        if (attempts >= maxAttempts && !reduxStore) {
          console.log('%c[CE Redux]%c ⚠️ Store를 찾을 수 없습니다.', 
            'color: #ff9800; font-weight: bold;', 'color: inherit;');
          window.dispatchEvent(new CustomEvent('bwbr-redux-ready', {
            detail: { success: false }
          }));
        }
      }
    }, 1000);
  }

  // ================================================================
  //  채팅 메시지 실시간 관찰 (roomMessages via store.subscribe)
  // ================================================================

  let _messageObserverActive = false;
  let _prevMessageIdSet = new Set();
  let _storeUnsubscribe = null;
  let _messageStructureLogged = false;

  /**
   * 메시지 엔티티에서 텍스트를 추출합니다.
   * 코코포리아 roomMessages 엔티티 구조에 맞춰 여러 필드를 시도합니다.
   */
  function extractMessageText(entity) {
    // 코코포리아 roomMessages 엔티티: text 필드가 메시지 본문
    if (entity.text && typeof entity.text === 'string') {
      return entity.text;
    }
    // 폴백 (구조 변경 대비)
    for (const key of ['body', 'message', 'content', 'msg']) {
      if (entity[key] && typeof entity[key] === 'string') {
        return entity[key];
      }
    }
    return null;
  }

  /**
   * extend 필드에서 주사위 결과를 추출합니다.
   * 코코포리아는 주사위 결과를 text가 아닌 extend 객체에 저장합니다.
   * DOM에서는 둘 다 렌더링되지만 Redux에서는 text만 가져오므로 별도 추출 필요.
   *
   * extend.roll 구조 (2026-02-20 확인):
   * {
   *   critical: false,       // 대성공 여부
   *   dices: [{...}],         // 개별 주사위 결과 배열
   *   failure: false,         // 실패 여부
   *   fumble: false,          // 대실패 여부
   *   result: "(1D20) > 15",  // ★ 결과 문자열 (> 또는 → + 숫자)
   *   secret: false,          // 비밀 굴림 여부
   *   skin: {d4:'basic',...}, // 주사위 스킨 설정
   *   success: false          // 성공 여부
   * }
   *
   * @param {object} entity - 메시지 엔티티
   * @returns {string|null} 주사위 결과 텍스트 (예: "(1D20) > 15") 또는 null
   */
  function extractDiceFromExtend(entity) {
    const ext = entity.extend;
    if (!ext || typeof ext !== 'object') return null;

    const text = entity.text || '';
    const isDiceCmd = /\d+[dD]\d+/.test(text);
    if (!isDiceCmd) return null;

    // ★ 확인된 구조: extend.roll.result (예: "(1D20) > 15")
    if (ext.roll && typeof ext.roll.result === 'string') {
      return ext.roll.result;
    }

    // 폴백: extend.result 직접 접근
    if (ext.result && typeof ext.result === 'string') {
      return ext.result;
    }

    // 폴백: JSON stringify 후 숫자 패턴 검색
    try {
      const extStr = JSON.stringify(ext);
      const m = extStr.match(/[\u2192\uff1e>=]+\s*(\d+)/);
      if (m) return `\u2192 ${m[1]}`;
    } catch (e) {}

    return null;
  }

  /**
   * roomMessages에 store.subscribe()를 걸어 새 메시지를 실시간으로 감지합니다.
   * 탭 전환, DOM 갱신 등에 영향을 받지 않아 100% 신뢰성을 보장합니다.
   */
  function startMessageObserver() {
    if (!reduxStore || _messageObserverActive) return false;

    const state = reduxStore.getState();
    const rm = state.entities?.roomMessages;
    if (!rm) {
      console.log('%c[CE Redux]%c ⚠️ roomMessages를 찾을 수 없습니다.',
        'color: #ff9800; font-weight: bold;', 'color: inherit;');
      return false;
    }

    // 기존 메시지 ID를 모두 등록 (기존 메시지는 무시)
    _prevMessageIdSet = new Set(rm.ids || []);
    _messageObserverActive = true;

    // ★ 관찰 시작 시각 — 스크롤업으로 로드된 과거 메시지 필터용
    const _observerStartTime = Date.now();

    _storeUnsubscribe = reduxStore.subscribe(() => {
      if (!_messageObserverActive) return;

      try {
        const currentState = reduxStore.getState();
        const currentRm = currentState.entities?.roomMessages;
        if (!currentRm) return;

        const currentIds = currentRm.ids || [];

        // 새 메시지 ID 찾기
        const newIds = [];
        for (const id of currentIds) {
          if (!_prevMessageIdSet.has(id)) {
            newIds.push(id);
            _prevMessageIdSet.add(id);
          }
        }

        // Set 크기 관리 (메모리 누수 방지)
        if (_prevMessageIdSet.size > 2000) {
          _prevMessageIdSet = new Set(currentIds.slice(-1000));
        }

        if (newIds.length === 0) return;

        for (const id of newIds) {
          const entity = currentRm.entities?.[id];
          if (!entity) continue;

          // ★ 스크롤업 방지: 관찰 시작 전에 생성된 과거 메시지 무시
          // 채팅 로그를 위로 올리면 Firestore에서 과거 메시지가 로드되어
          // Redux store에 추가됨 → 이전 합/차례 메시지가 잘못 처리되는 것을 방지
          const createdAt = entity.createdAt;
          if (createdAt) {
            let msgTime = 0;
            if (typeof createdAt.toMillis === 'function') {
              msgTime = createdAt.toMillis();
            } else if (typeof createdAt.seconds === 'number') {
              msgTime = createdAt.seconds * 1000;
            } else if (createdAt instanceof Date) {
              msgTime = createdAt.getTime();
            } else if (typeof createdAt === 'number') {
              msgTime = createdAt;
            }
            if (msgTime > 0 && msgTime < _observerStartTime - 10000) {
              // 관찰 시작 10초 전보다 오래된 메시지 → 히스토리 로드로 간주, 스킵
              continue;
            }
          }

          // 첫 번째 메시지 구조 로깅 (디버깅용)
          if (!_messageStructureLogged) {
            _messageStructureLogged = true;
            try {
              _dbg('%c[CE Redux]%c 📋 메시지 엔티티 구조:',
                'color: #4caf50; font-weight: bold;', 'color: inherit;',
                '\n  키:', Object.keys(entity),
                '\n  전체:', JSON.parse(JSON.stringify(entity)));
            } catch (e) {}
          }

          let text = extractMessageText(entity);
          if (!text) {
            console.log('%c[CE Redux]%c ⚠️ 텍스트 필드 없음:',
              'color: #ff9800; font-weight: bold;', 'color: inherit;',
              Object.keys(entity));
            continue;
          }

          // 🎲 주사위 결과 추출 (extend 필드에서)
          const diceResult = extractDiceFromExtend(entity);
          if (diceResult) {
            text = text + '\n' + diceResult;
          }

          // 코코포리아 필드: name = 캐릭터명, channel = 채널 ID, channelName = 채널 표시명
          const charName = entity.name || entity.characterName || entity.senderName || '';
          const channel = entity.channel || entity.tab || '';
          const channelName = entity.channelName || '';

          // Content Script로 전달
          window.dispatchEvent(new CustomEvent('bwbr-new-chat-message', {
            detail: {
              id: id,
              text: text,
              name: charName,
              channel: channel,
              channelName: channelName,
              type: entity.type || '',
              from: entity.from || '',
              to: entity.to || null
            }
          }));
        }
      } catch (e) {
        console.error('[CE Redux] 메시지 관찰 오류:', e);
      }
    });

    console.log('%c[CE Redux]%c ✅ 메시지 관찰 시작 (기존 %d개 등록)',
      'color: #4caf50; font-weight: bold;', 'color: inherit;', _prevMessageIdSet.size);

    return true;
  }

  function stopMessageObserver() {
    _messageObserverActive = false;
    if (_storeUnsubscribe) {
      _storeUnsubscribe();
      _storeUnsubscribe = null;
    }
    _prevMessageIdSet.clear();
    console.log('%c[CE Redux]%c 메시지 관찰 중지',
      'color: #4caf50; font-weight: bold;', 'color: inherit;');
  }

  // ================================================================
  //  Firestore 직접 메시지 전송
  // ================================================================

  /**
   * webpack require 함수를 획득합니다.
   * webpackChunkccfolia에 가짜 chunk를 push하여 __webpack_require__를 탈취합니다.
   */
  function acquireWebpackRequire() {
    if (_wpRequire) return _wpRequire;
    const chunks = window.webpackChunkccfolia;
    if (!chunks) return null;
    chunks.push([[Date.now()], {}, (req) => { _wpRequire = req; }]);
    return _wpRequire;
  }

  /**
   * Firestore SDK 함수 자동 탐색 (프로퍼티 키가 변경된 경우 대응)
   * collection/doc는 안전하게 테스트 가능 (네트워크 요청 없음)
   * setDoc는 toString()에서 'merge' 키워드로 식별
   */
  function autoDiscoverFirestoreFunctions(fsMod, db) {
    let collectionFn = null, collectionKey = null;
    let docFn = null, docKey = null;
    let setDocFn = null, setDocKey = null;

    // Phase 1: collection() 찾기 — db + 문자열로 호출 시 .type === 'collection' 반환
    for (const [key, fn] of Object.entries(fsMod)) {
      if (typeof fn !== 'function') continue;
      try {
        const ref = fn(db, '__bwbr_probe__');
        if (ref && typeof ref === 'object' && ref.type === 'collection' &&
            typeof ref.path === 'string' && ref.path.includes('__bwbr_probe__')) {
          collectionFn = fn; collectionKey = key;
          break;
        }
      } catch (e) {}
    }
    if (!collectionFn) return null;

    // Phase 2: doc() 찾기 — collectionRef + ID로 호출 시 .type === 'document' 반환
    const testCol = collectionFn(db, '__bwbr_probe__');
    for (const [key, fn] of Object.entries(fsMod)) {
      if (typeof fn !== 'function' || fn === collectionFn) continue;
      try {
        const ref = fn(testCol, '__bwbr_probe_id__');
        if (ref && typeof ref === 'object' && ref.type === 'document' &&
            typeof ref.path === 'string' && ref.path.includes('__bwbr_probe_id__')) {
          docFn = fn; docKey = key;
          break;
        }
      } catch (e) {}
    }
    if (!docFn) return null;

    // Phase 3: setDoc() 찾기 — toString()에서 'merge' 문자열 포함 여부로 식별
    // (Firestore의 setDoc은 { merge: true } 옵션을 처리하므로 'merge'가 코드에 남아있음)
    for (const [key, fn] of Object.entries(fsMod)) {
      if (typeof fn !== 'function' || fn === collectionFn || fn === docFn) continue;
      try {
        if (fn.toString().includes('merge')) {
          setDocFn = fn; setDocKey = key;
          break;
        }
      } catch (e) {}
    }
    if (!setDocFn) return null;

    console.log(`%c[CE]%c ✅ Firestore 함수 자동 발견: collection=${collectionKey}, doc=${docKey}, setDoc=${setDocKey}`,
      'color: #4caf50; font-weight: bold;', 'color: inherit;');
    return { collection: collectionFn, doc: docFn, setDoc: setDocFn, getDocs: null };
  }

  /**
   * Firestore deleteField() 센티널을 모듈에서 탐색합니다.
   * deleteField()는 호출 시 내부적으로 isEqual 같은 인터페이스를 가진 센티널 객체를 반환합니다.
   */
  let _deleteFieldFn = null;
  function _getDeleteField() {
    if (_deleteFieldFn) return _deleteFieldFn;
    const req = acquireWebpackRequire();
    if (!req) return null;
    let fsMod;
    try { fsMod = req(_FS_CONFIG.firestoreModId); } catch { return null; }
    if (!fsMod) return null;

    for (const [key, fn] of Object.entries(fsMod)) {
      if (typeof fn !== 'function') continue;
      try {
        const result = fn();
        // deleteField() 센티널: _methodName === 'deleteField' 또는 type === 'deleteField' 등
        if (result && typeof result === 'object' &&
            (result._methodName === 'deleteField' || result.type === 'deleteField' ||
             (result.isEqual && JSON.stringify(result).includes('delete')))) {
          _deleteFieldFn = fn;
          _dbg(`%c[CE]%c ✅ deleteField 발견: key=${key}`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          return fn;
        }
      } catch {}
    }
    console.warn('[CE] deleteField 함수를 찾을 수 없음');
    return null;
  }

  /**
   * writeBatch 함수를 Firestore 모듈에서 자동 탐색합니다.
   * writeBatch(db)를 호출하면 commit/set/delete/update 메서드를 가진 WriteBatch 객체가 반환됩니다.
   * 네트워크 요청 없이 로컬 객체만 생성하므로 안전합니다.
   */
  function _discoverWriteBatch(fsMod, db) {
    for (const [key, fn] of Object.entries(fsMod)) {
      if (typeof fn !== 'function') continue;
      try {
        const result = fn(db);
        if (result && typeof result === 'object' &&
            typeof result.commit === 'function' &&
            typeof result.set === 'function' &&
            typeof result.delete === 'function' &&
            typeof result.update === 'function') {
          _dbg(`%c[CE]%c ✅ writeBatch 발견: key=${key}`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          return fn;
        }
      } catch (e) {}
    }
    console.warn('[CE] writeBatch를 찾을 수 없음 — 순차 쓰기 폴백');
    return null;
  }

  /**
   * Firestore SDK (collection, doc, setDoc, db)를 획득합니다.
   * 1차: 알려진 모듈 ID + 프로퍼티 키로 시도 (빠름)
   * 2차: 자동 탐색으로 프로퍼티 키 재발견 (프로퍼티 키만 변경된 경우)
   * 실패 시: 에러 로그 + 진단 방법 안내
   */
  function acquireFirestoreSDK() {
    if (_firestoreSDK) return _firestoreSDK;

    const req = acquireWebpackRequire();
    if (!req) {
      console.warn('[CE] webpack require 획득 실패');
      return null;
    }

    // Firestore 모듈 로드
    let fsMod = null;
    try { fsMod = req(_FS_CONFIG.firestoreModId); } catch (e) {}
    if (!fsMod || typeof fsMod !== 'object') {
      console.error('[CE] Firestore 모듈 로드 실패 (모듈 ID: ' + _FS_CONFIG.firestoreModId + ')');
      console.error('[CE] → 콘솔에서 실행: window.dispatchEvent(new CustomEvent("bwbr-discover-firestore"))');
      return null;
    }

    // DB 인스턴스 획득
    let db = null;
    try { db = req(_FS_CONFIG.dbModId)?.[_FS_CONFIG.dbKey]; } catch (e) {}
    if (!db) {
      console.error('[CE] Firestore DB 인스턴스 획득 실패 (모듈: ' + _FS_CONFIG.dbModId + ', 키: ' + _FS_CONFIG.dbKey + ')');
      return null;
    }

    // 1차: 알려진 키로 함수 찾기
    let setDocFn = fsMod[_FS_CONFIG.fsKeys.setDoc];
    let docFn = fsMod[_FS_CONFIG.fsKeys.doc];
    let collectionFn = fsMod[_FS_CONFIG.fsKeys.collection];
    let getDocsFn = fsMod[_FS_CONFIG.fsKeys.getDocs];
    let deleteDocFn = fsMod[_FS_CONFIG.fsKeys.deleteDoc];

    // 진단 로깅
    console.log('[CE SDK] db:', !!db, 'db.type:', db?.type,
      'col:', typeof collectionFn, 'doc:', typeof docFn, 'setDoc:', typeof setDocFn,
      'getDocs:', typeof getDocsFn, 'deleteDoc:', typeof deleteDocFn);

    // 검증
    if (typeof collectionFn === 'function' && typeof docFn === 'function' && typeof setDocFn === 'function') {
      try {
        const testRef = collectionFn(db, '__bwbr_validate__');
        console.log('[CE SDK] testRef:', !!testRef, 'type:', testRef?.type, 'path:', testRef?.path);
        if (testRef && testRef.type === 'collection') {
          _firestoreSDK = {
            db, setDoc: setDocFn, doc: docFn, collection: collectionFn,
            getDocs: typeof getDocsFn === 'function' ? getDocsFn : null,
            deleteDoc: typeof deleteDocFn === 'function' ? deleteDocFn : null,
            writeBatch: _discoverWriteBatch(fsMod, db)
          };
          console.log('%c[CE]%c ✅ Firestore SDK 획득 성공 (알려진 키)',
            'color: #4caf50; font-weight: bold;', 'color: inherit;');

          return _firestoreSDK;
        }
      } catch (e) {
        console.error('[CE SDK] 알려진 키 검증 예외:', e);
      }
    }

    // 2차: 자동 탐색 (안전 모드 — 진단만 출력, Firestore 호출 금지)
    console.error('[CE] 알려진 키 검증 실패 — 모듈 키가 변경되었을 수 있음');
    console.error('[CE] 모듈 ' + _FS_CONFIG.firestoreModId + ' export 키 목록:', Object.keys(fsMod).filter(k => typeof fsMod[k] === 'function').join(', '));
    console.error('[CE] → 콘솔에서 실행: window.dispatchEvent(new CustomEvent("bwbr-discover-firestore"))');
    return null;
  }

  /**
   * Firestore writeBatch를 사용한 일괄 쓰기.
   * 최대 500개 작업을 하나의 원자적 트랜잭션으로 커밋합니다.
   * writeBatch가 없으면 순차 폴백합니다.
   *
   * @param {object} sdk - Firestore SDK
   * @param {Array<{type: 'set'|'delete'|'update', ref, data?, options?}>} ops - 작업 목록
   * @returns {Promise<number>} 커밋된 작업 수
   */
  async function _batchCommit(sdk, ops) {
    if (!ops.length) return 0;

    // writeBatch 미지원 시 순차 폴백
    if (!sdk.writeBatch) {
      for (const op of ops) {
        if (op.type === 'delete') await sdk.deleteDoc(op.ref);
        else if (op.type === 'update') {
          if (sdk.updateDoc) await sdk.updateDoc(op.ref, op.data);
          else await sdk.setDoc(op.ref, op.data, { merge: true });
        }
        else await sdk.setDoc(op.ref, op.data, op.options || {});
      }
      return ops.length;
    }

    // 500개씩 분할 커밋
    const BATCH_SIZE = 500;
    let committed = 0;
    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const chunk = ops.slice(i, i + BATCH_SIZE);
      const batch = sdk.writeBatch(sdk.db);
      for (const op of chunk) {
        if (op.type === 'delete') batch.delete(op.ref);
        else if (op.type === 'update') batch.update(op.ref, op.data);
        else batch.set(op.ref, op.data, op.options || {});
      }
      await batch.commit();
      committed += chunk.length;
    }
    return committed;
  }

  /**
   * 현재 유저/채널/캐릭터 정보를 Redux 상태에서 추출합니다.
   *
   * UID 획득: app.state.uid 등 여러 경로를 시도하고,
   * 없으면 uid 없이도 진행 가능 (Firestore 쓰기에 from은 빈 문자열 허용)
   *
   * 캐릭터 정보: speaking=true인 캐릭터(현재 발화 중) 우선 사용
   * 채널 정보: 마지막 메시지에서 채널 복사
   */
  function getMessageContext() {
    if (!reduxStore) return null;

    const state = reduxStore.getState();
    const rm = state.entities?.roomMessages;
    const rc = state.entities?.roomCharacters;

    // UID 획득 — 여러 경로 시도
    const uid = state.app?.state?.uid
      || state.app?.user?.uid
      || null;

    // 현재 발화 중인(speaking) 캐릭터 찾기
    let speakingChar = null;
    if (rc?.ids) {
      for (const id of rc.ids) {
        const char = rc.entities?.[id];
        if (char?.speaking) {
          speakingChar = char;
          break;
        }
      }
    }

    // 마지막 메시지에서 채널 정보 가져오기
    let channel = '';
    let channelName = '';
    let fallbackFrom = '';
    if (rm?.ids?.length > 0) {
      const lastId = rm.ids[rm.ids.length - 1];
      const last = rm.entities?.[lastId];
      if (last) {
        channel = last.channel || '';
        channelName = last.channelName || '';
      }

      // uid가 있으면 유저 메시지에서 상세 정보 추출
      if (uid) {
        for (let i = rm.ids.length - 1; i >= 0; i--) {
          const entity = rm.entities?.[rm.ids[i]];
          if (entity?.from === uid) {
            return {
              name: speakingChar?.name || entity.name || '',
              channel: entity.channel || channel,
              channelName: entity.channelName || channelName,
              color: speakingChar?.color || entity.color || '#e0e0e0',
              iconUrl: speakingChar?.iconUrl || entity.iconUrl || '',
              from: uid
            };
          }
        }
      }

      // uid 없으면 마지막 메시지의 from을 폴백으로 사용
      if (!uid && rm.ids.length > 0) {
        const lastEntity = rm.entities?.[rm.ids[rm.ids.length - 1]];
        fallbackFrom = lastEntity?.from || '';
      }
    }

    // uid 매칭 메시지 없어도, 발화 캐릭터/채널 정보가 있으면 진행
    if (channel || speakingChar) {
      return {
        name: speakingChar?.name || '시스템',
        channel: channel,
        channelName: channelName,
        color: speakingChar?.color || '#e0e0e0',
        iconUrl: speakingChar?.iconUrl || '',
        from: uid || fallbackFrom
      };
    }

    console.warn('[CE] getMessageContext: uid=' + uid +
      ', 메시지 수=' + (rm?.ids?.length || 0) +
      ', speaking=' + (speakingChar?.name || 'none'));
    return null;
  }

  /**
   * @태그 컷인 이펙트를 재생합니다.
   * roomEffects에서 태그 이름과 일치하는 이펙트를 찾아 playTime을 업데이트합니다.
   * playTime 변경 시 코코포리아가 자동으로 해당 이펙트를 모든 클라이언트에서 재생합니다.
   *
   * @param {string} tag - 이펙트 태그명 (@ 제외)
   */
  async function triggerCutin(tag) {
    const sdk = acquireFirestoreSDK();
    if (!sdk || !reduxStore) return;

    const state = reduxStore.getState();
    const roomId = state.app?.state?.roomId
      || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
    if (!roomId) return;

    const re = state.entities?.roomEffects;
    if (!re?.ids) return;

    // 이펙트 이름으로 찾기 (태그 또는 @태그 형태)
    let effectId = null;
    for (const id of re.ids) {
      const effect = re.entities?.[id];
      if (!effect) continue;
      const name = (effect.name || '').trim();
      if (name === tag || name === '@' + tag || name === tag.replace(/^@/, '')) {
        effectId = effect._id || id;
        break;
      }
    }

    if (!effectId) {
      console.log(`%c[CE]%c 🔔 컷인 이펙트 없음: "${tag}"`,
        'color: #ff9800; font-weight: bold;', 'color: inherit;');
      return;
    }

    try {
      const effectsCol = sdk.collection(sdk.db, 'rooms', roomId, 'effects');
      const effectRef = sdk.doc(effectsCol, effectId);
      await sdk.setDoc(effectRef, { playTime: Date.now() }, { merge: true });
      _dbg(`%c[CE]%c 🔊 컷인 재생: "${tag}" (${effectId})`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
    } catch (e) {
      console.error('[CE] 컷인 재생 실패:', e);
    }
  }

  /**
   * 메시지 텍스트에서 @태그 컷인을 추출합니다.
   * roomEffects에 존재하는 이펙트만 추출하고 텍스트에서 제거합니다.
   *
   * @param {string} text - 원본 메시지 텍스트
   * @returns {{ cleanText: string, cutinTags: string[] }}
   */
  function extractCutinTags(text) {
    const cutinTags = [];
    if (!reduxStore) return { cleanText: text, cutinTags };

    const re = reduxStore.getState().entities?.roomEffects;
    if (!re?.ids) return { cleanText: text, cutinTags };

    // roomEffects 이름 세트 생성
    const effectNames = new Set();
    for (const id of re.ids) {
      const effect = re.entities?.[id];
      if (effect?.name) {
        const name = effect.name.trim();
        effectNames.add(name);
        if (name.startsWith('@')) effectNames.add(name.slice(1));
      }
    }

    const cleanText = text.replace(/@([^\s@]+)/g, (match, tag) => {
      if (effectNames.has(tag) || effectNames.has('@' + tag)) {
        cutinTags.push(tag);
        return '';
      }
      return match;
    }).replace(/\s{2,}/g, ' ').trim();

    return { cleanText, cutinTags };
  }

  /**
   * Firestore에 직접 메시지를 작성합니다.
   * 코코포리아의 textarea를 경유하지 않으므로 유저 입력을 차단하지 않습니다.
   *
   * @param {string} text - 전송할 메시지 텍스트
   * @param {object} [overrides] - 메시지 필드 오버라이드 (name, color 등)
   * @returns {Promise<boolean>} 성공 여부
   */
  async function sendDirectMessage(text, overrides) {
    const sdk = acquireFirestoreSDK();
    if (!sdk) return false;

    const ctx = getMessageContext();
    if (!ctx) {
      // 컨텍스트 없어도 시스템 메시지는 최소한의 정보만으로 전송 가능
      if (!overrides) {
        console.warn('[CE] 메시지 컨텍스트 없음 (아직 메시지를 보낸 적 없음?)');
        return false;
      }
    }

    const state = reduxStore.getState();
    const roomId = state.app?.state?.roomId ||
      window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
    if (!roomId) {
      console.warn('[CE] roomId를 찾을 수 없음');
      return false;
    }

    try {
      const messagesCol = sdk.collection(sdk.db, 'rooms', roomId, 'messages');
      const newRef = sdk.doc(messagesCol, generateFirestoreId());

      const msg = {
        text: text,
        type: 'text',
        name: ctx?.name || '',
        channel: ctx?.channel || '',
        channelName: ctx?.channelName || '',
        color: ctx?.color || '#e0e0e0',
        iconUrl: ctx?.iconUrl || '',
        imageUrl: null,
        from: ctx?.from || state.app?.state?.uid || '',
        to: null,
        toName: '',
        extend: {},
        edited: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      if (overrides) Object.assign(msg, overrides);

      await sdk.setDoc(newRef, msg);

      return true;
    } catch (e) {
      console.error('[CE] Firestore 직접 전송 실패:', e);
      return false;
    }
  }

  /**
   * 현재 보고 있는 채팅 탭의 채널 정보를 감지합니다 (MAIN world).
   * 1) Redux store의 app state에서 현재 채널 확인 시도
   * 2) DOM에서 선택된 탭 텍스트로 채널 매핑
   * @returns {{ channel: string, channelName: string } | null}
   */
  function _detectCurrentChannel() {
    try {
      // 방법 1: Redux store에서 현재 채널 확인
      if (reduxStore) {
        const appState = reduxStore.getState().app;
        const ch = appState?.chat?.channel
          || appState?.state?.channel
          || appState?.chat?.channelId
          || appState?.state?.channelId;
        const chName = appState?.chat?.channelName
          || appState?.state?.channelName;
        if (ch !== undefined && ch !== null) {
          return { channel: ch || '', channelName: chName || '' };
        }
      }

      // 방법 2: DOM에서 채팅 패널의 탭 인덱스로 채널 결정
      // 코코포리아 기본 탭 순서 (고정):
      //   [0] 메인 → channel:'main'  [1] 정보 → channel:'info'  [2] 잡담 → channel:'other'
      //   [3+] 커스텀 → 고유 channel ID (메시지에서 조회)
      const BUILTIN_CHANNELS = [
        { channel: 'main',  channelName: 'main' },   // 탭 0
        { channel: 'info',  channelName: 'info' },   // 탭 1
        { channel: 'other', channelName: 'other' }    // 탭 2
      ];

      // 채팅 패널에 속한 탭 목록을 인덱스 포함으로 찾기
      let chatTabs = null;   // [role="tablist"] 안의 모든 탭들
      let selectedIdx = -1;  // 선택된 탭의 인덱스
      let selectedText = ''; // 선택된 탭의 텍스트

      // textarea 기준으로 올라가며 탭리스트 찾기
      const textarea = document.querySelector('textarea[name="text"]');
      if (textarea) {
        let node = textarea.parentElement;
        for (let i = 0; i < 30 && node; i++) {
          const tablist = node.querySelector('[role="tablist"]');
          if (tablist) {
            chatTabs = tablist.querySelectorAll('[role="tab"]');
            break;
          }
          // 형제 요소도 확인
          if (node.parentElement) {
            for (const sibling of node.parentElement.children) {
              if (sibling === node) continue;
              const tl = sibling.querySelector('[role="tablist"]');
              if (tl) {
                chatTabs = tl.querySelectorAll('[role="tab"]');
                break;
              }
            }
          }
          if (chatTabs) break;
          node = node.parentElement;
        }
      }

      // 폴백: 전역에서 선택된 탭 찾기
      if (!chatTabs) {
        const allTabs = document.querySelectorAll('[role="tab"]');
        // textarea가 같은 컨테이너에 있는 탭 그룹 찾기
        for (const tab of allTabs) {
          if (tab.getAttribute('aria-selected') === 'true') {
            let container = tab.parentElement;
            for (let j = 0; j < 10 && container; j++) {
              if (container.querySelector('textarea[name="text"]')) {
                // 이 탭의 tablist 찾기
                const parent = tab.parentElement;
                if (parent) chatTabs = parent.querySelectorAll('[role="tab"]');
                break;
              }
              container = container.parentElement;
            }
          }
          if (chatTabs) break;
        }
      }

      if (!chatTabs || chatTabs.length === 0) return null;

      // 선택된 탭의 인덱스와 텍스트 확인
      chatTabs.forEach((tab, idx) => {
        if (tab.getAttribute('aria-selected') === 'true' ||
            tab.classList.contains('Mui-selected')) {
          selectedIdx = idx;
          selectedText = tab.textContent?.trim() || '';
        }
      });

      if (selectedIdx < 0) return null;

      // 기본 탭 (인덱스 0, 1, 2) → 고정 채널 매핑
      if (selectedIdx < BUILTIN_CHANNELS.length) {
        return BUILTIN_CHANNELS[selectedIdx];
      }

      // 커스텀 탭 (인덱스 3+) → 메시지에서 channelName으로 고유 ID 조회
      if (selectedText && reduxStore) {
        const rm = reduxStore.getState().entities?.roomMessages;
        if (rm?.ids) {
          const BUILTIN_IDS = ['', 'main', 'info', 'other'];
          for (let i = rm.ids.length - 1; i >= 0; i--) {
            const entity = rm.entities?.[rm.ids[i]];
            if (!entity) continue;
            if (entity.type === 'system' || entity.name === 'system') continue;
            if (entity.channelName === selectedText
                && entity.channel
                && !BUILTIN_IDS.includes(entity.channel)) {
              return { channel: entity.channel, channelName: selectedText };
            }
          }
        }
      }
      // 커스텀 탭이지만 매핑 실패 → other 폴백
      return { channel: 'other', channelName: 'other' };
    } catch (e) {
      console.warn('[CE] _detectCurrentChannel error:', e);
      return null;
    }
  }

  /**
   * Firestore 문서 ID 생성 (20자 영숫자)
   * Firestore auto-ID와 동일한 형식
   */
  function generateFirestoreId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 20; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  // ================================================================
  //  [CORE] Firestore 직접 메시지 전송
  // ================================================================

  // Firestore 직접 전송 이벤트 수신
  // ★ ISOLATED→MAIN에서는 CustomEvent.detail이 전달되지 않으므로
  //    DOM attribute(data-bwbr-send-text)를 통해 텍스트를 받습니다.
  window.addEventListener('bwbr-send-message-direct', async () => {
    const el = document.documentElement;
    const text = el.getAttribute('data-bwbr-send-text');
    const sendType = el.getAttribute('data-bwbr-send-type') || 'normal';
    el.removeAttribute('data-bwbr-send-text');
    el.removeAttribute('data-bwbr-send-type');
    if (!text) {
      console.warn('[CE] bwbr-send-message-direct: 텍스트 없음 (data-bwbr-send-text 비어있음)');
      window.dispatchEvent(new CustomEvent('bwbr-send-message-result', {
        detail: { success: false, text: '', error: 'no-text' }
      }));
      return;
    }

    // 시스템 메시지 모드
    let overrides;
    if (sendType === 'system') {
      overrides = { name: 'system', type: 'system', color: '#888888', iconUrl: null };
      // ★ 현재 보고 있는 탭의 채널로 전송 (DOM에서 탐지)
      const chInfo = _detectCurrentChannel();
      if (chInfo) {
        overrides.channel = chInfo.channel;
        overrides.channelName = chInfo.channelName;
      }
    } else {
      overrides = null;
    }

    // @태그 컷인 추출 및 텍스트 분리
    const { cleanText, cutinTags } = extractCutinTags(text);

    try {
      let success = true;
      // 텍스트가 남아있으면 메시지 전송
      if (cleanText) {
        success = await sendDirectMessage(cleanText, overrides);
      }
      // 컷인 트리거 (메시지 전송 성공 또는 텍스트 없이 컷인만 있는 경우)
      // ★ 순차 실행 + 딜레이: 동시 Firestore 쓰기 시 ccfolia가 일부만 재생하는 문제 방지
      if (success && cutinTags.length > 0) {
        for (let i = 0; i < cutinTags.length; i++) {
          await triggerCutin(cutinTags[i]);
          if (i < cutinTags.length - 1) {
            await new Promise(r => setTimeout(r, 150));
          }
        }
      }
      // MAIN→ISOLATED: detail 전달 가능
      window.dispatchEvent(new CustomEvent('bwbr-send-message-result', {
        detail: { success, text }
      }));
    } catch (err) {
      console.error('[CE] Direct send error:', err);
      window.dispatchEvent(new CustomEvent('bwbr-send-message-result', {
        detail: { success: false, text, error: err.message }
      }));
    }
  });

  // ================================================================
  //  특정 캐릭터로 채팅 전송 (combat-move 등에서 사용)
  //  DOM attribute: data-bwbr-char-msg-text, data-bwbr-char-msg-name,
  //                 data-bwbr-char-msg-icon, data-bwbr-char-msg-color
  // ================================================================
  window.addEventListener('bwbr-send-message-as-char', async () => {
    const el = document.documentElement;
    const text = el.getAttribute('data-bwbr-char-msg-text') || '';
    const charName = el.getAttribute('data-bwbr-char-msg-name') || '';
    const iconUrl = el.getAttribute('data-bwbr-char-msg-icon') || '';
    const color = el.getAttribute('data-bwbr-char-msg-color') || '#e0e0e0';
    el.removeAttribute('data-bwbr-char-msg-text');
    el.removeAttribute('data-bwbr-char-msg-name');
    el.removeAttribute('data-bwbr-char-msg-icon');
    el.removeAttribute('data-bwbr-char-msg-color');

    if (!text) {
      window.dispatchEvent(new CustomEvent('bwbr-char-msg-result', {
        detail: { success: false, error: 'no-text' }
      }));
      return;
    }

    try {
      const chInfo = _detectCurrentChannel();
      const overrides = {
        name: charName,
        iconUrl: iconUrl,
        color: color
      };
      if (chInfo) {
        overrides.channel = chInfo.channel;
        overrides.channelName = chInfo.channelName;
      }
      const success = await sendDirectMessage(text, overrides);
      window.dispatchEvent(new CustomEvent('bwbr-char-msg-result', {
        detail: { success, text }
      }));
    } catch (err) {
      console.error('[CE] char-msg send error:', err);
      window.dispatchEvent(new CustomEvent('bwbr-char-msg-result', {
        detail: { success: false, text, error: err.message }
      }));
    }
  });

  // ================================================================
  //  주사위를 특정 캐릭터로 직접 굴림 (Firestore 직접 기록)
  //  textarea 경유 없이 자체 난수 생성 + extend.roll 구성
  //  DOM attribute:
  //    data-bwbr-dice-notation   "1D20" 또는 "1D20+3"
  //    data-bwbr-dice-label      라벨 텍스트 (예: "⚔️ 스칼라")
  //    data-bwbr-dice-char-name  캐릭터 이름
  // ================================================================
  window.addEventListener('bwbr-send-dice-as-char', async () => {
    const el = document.documentElement;
    const notation  = el.getAttribute('data-bwbr-dice-notation')  || '1D20';
    const label     = el.getAttribute('data-bwbr-dice-label')     || '';
    const charName  = el.getAttribute('data-bwbr-dice-char-name') || '';
    el.removeAttribute('data-bwbr-dice-notation');
    el.removeAttribute('data-bwbr-dice-label');
    el.removeAttribute('data-bwbr-dice-char-name');

    try {
      // 주사위 표기법 파싱: NdM 또는 NdM+B
      const diceMatch = notation.match(/^(\d+)[dD](\d+)(?:([+\-])(\d+))?$/);
      if (!diceMatch) {
        window.dispatchEvent(new CustomEvent('bwbr-dice-char-result', {
          detail: { success: false, error: 'invalid-notation', notation }
        }));
        return;
      }
      const count = parseInt(diceMatch[1], 10);
      const sides = parseInt(diceMatch[2], 10);
      const bonus = diceMatch[4] ? parseInt(diceMatch[4], 10) * (diceMatch[3] === '-' ? -1 : 1) : 0;

      // 주사위 굴림
      const dices = [];
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const val = Math.floor(Math.random() * sides) + 1;
        dices.push({ faces: sides, value: val });
        sum += val;
      }
      const total = sum + bonus;

      // 결과 문자열 구성 (코코포리아 형식)
      // ★ 항상 total을 ＞ 직후에 배치 — extractDiceValue 패턴이 첫 번째 ＞ 뒤 숫자를 캡처
      const diceStr = `(${notation.toUpperCase()})`;
      const resultStr = `${diceStr} ＞ ${total}`;

      // 캐릭터 정보 조회 (iconUrl, color)
      let iconUrl = '';
      let color = '#e0e0e0';
      if (charName && reduxStore) {
        const rc = reduxStore.getState().entities?.roomCharacters;
        if (rc?.ids) {
          for (const id of rc.ids) {
            const c = rc.entities?.[id];
            if (c && c.name === charName) {
              iconUrl = c.iconUrl || '';
              color = c.color || '#e0e0e0';
              break;
            }
          }
        }
      }

      // 텍스트 = 주사위 표기 + 라벨
      const text = label ? `${notation.toUpperCase()} ${label}` : notation.toUpperCase();

      // Firestore 메시지 구성 (extend.roll 포함)
      const sdk = acquireFirestoreSDK();
      if (!sdk) {
        window.dispatchEvent(new CustomEvent('bwbr-dice-char-result', {
          detail: { success: false, error: 'no-firestore', total }
        }));
        return;
      }

      const ctx = getMessageContext();
      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId ||
        window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) {
        window.dispatchEvent(new CustomEvent('bwbr-dice-char-result', {
          detail: { success: false, error: 'no-room', total }
        }));
        return;
      }

      const chInfo = _detectCurrentChannel();
      const messagesCol = sdk.collection(sdk.db, 'rooms', roomId, 'messages');
      const newRef = sdk.doc(messagesCol, generateFirestoreId());

      const msg = {
        text: text,
        type: 'text',
        name: charName || ctx?.name || '',
        channel: chInfo?.channel || ctx?.channel || '',
        channelName: chInfo?.channelName || ctx?.channelName || '',
        color: color,
        iconUrl: iconUrl,
        imageUrl: null,
        from: ctx?.from || state.app?.state?.uid || '',
        to: null,
        toName: '',
        extend: {
          roll: {
            result: resultStr,
            dices: dices,
            critical: false,
            fumble: false,
            success: false,
            failure: false,
            secret: false,
            skin: {}
          }
        },
        edited: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await sdk.setDoc(newRef, msg);

      _dbg(`%c[CE]%c 🎲 ${charName}: ${text} → ${resultStr}`,
        'color:#ffa726;font-weight:bold', 'color:inherit');

      window.dispatchEvent(new CustomEvent('bwbr-dice-char-result', {
        detail: { success: true, total, resultStr, text, charName }
      }));
    } catch (err) {
      console.error('[CE] dice-as-char error:', err);
      window.dispatchEvent(new CustomEvent('bwbr-dice-char-result', {
        detail: { success: false, error: err.message }
      }));
    }
  });

  // ================================================================
  //  Content Script ↔ Page Context 이벤트 통신
  // ================================================================

  // 메시지 관찰 시작 요청
  window.addEventListener('bwbr-start-message-observer', () => {
    if (reduxStore) {
      const success = startMessageObserver();
      window.dispatchEvent(new CustomEvent('bwbr-message-observer-status', {
        detail: { active: success }
      }));
    } else {
      if (setupStore()) {
        const success = startMessageObserver();
        window.dispatchEvent(new CustomEvent('bwbr-message-observer-status', {
          detail: { active: success }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('bwbr-message-observer-status', {
          detail: { active: false }
        }));
      }
    }
  });

  // 메시지 관찰 중지 요청
  window.addEventListener('bwbr-stop-message-observer', () => {
    stopMessageObserver();
  });

  // ================================================================
  //  현재 발화(선택) 캐릭터 조회
  // ================================================================
  window.addEventListener('bwbr-get-speaker', () => {
    let speakerName = null;
    if (reduxStore) {
      const rc = reduxStore.getState().entities?.roomCharacters;
      // 1) speaking: true 캐릭터 우선
      if (rc?.ids) {
        for (const id of rc.ids) {
          const c = rc.entities?.[id];
          if (c?.speaking) {
            speakerName = c.name || null;
            break;
          }
        }
      }
      // 2) speaking 없으면 마지막 사용자 메시지의 캐릭터명 폴백
      if (!speakerName) {
        const ctx = getMessageContext();
        if (ctx && ctx.name && ctx.name !== 'system' && ctx.name !== '시스템') {
          speakerName = ctx.name;
        }
      }
    }
    // DOM 속성 브릿지 (크로스-월드 안정성)
    document.documentElement.setAttribute('data-bwbr-speaker-name', speakerName || '');
    window.dispatchEvent(new CustomEvent('bwbr-speaker-data'));
  });

  // Content Script에서 캐릭터 데이터 요청 시 처리
  // ================================================================
  //  [CORE] 캐릭터 데이터 조회 / 전환
  //  bwbr-request-characters, bwbr-request-all-characters,
  //  bwbr-switch-character, bwbr-request-speaking-character,
  //  bwbr-request-cutins
  // ================================================================
  window.addEventListener('bwbr-request-characters', () => {
    let result;
    if (!reduxStore) {
      if (setupStore()) {
        const chars = getCharacterData();
        result = { success: true, characters: chars };
      } else {
        result = { success: false, characters: null };
      }
    } else {
      const chars = getCharacterData();
      result = { success: !!chars, characters: chars };
    }
    // DOM 속성 브릿지 (MAIN → ISOLATED 크로스-월드 안정성)
    document.documentElement.setAttribute('data-bwbr-characters-data', JSON.stringify(result));
    window.dispatchEvent(new CustomEvent('bwbr-characters-data', {
      detail: result
    }));
  });

  // ================================================================
  //  캐릭터 단축키: 전체 캐릭터 목록 (숨김 포함)
  // ================================================================
  window.addEventListener('bwbr-request-all-characters', () => {
    const characters = [];
    if (reduxStore) {
      const state = reduxStore.getState();
      const rc = state.entities?.roomCharacters;
      if (rc?.ids) {
        for (const id of rc.ids) {
          const char = rc.entities?.[id];
          if (!char) continue;
          characters.push({
            _id: char._id || id,
            name: char.name || '',
            iconUrl: char.iconUrl || '',
            active: char.active,
            speaking: !!char.speaking,
            color: char.color || '',
            faces: char.faces || []
          });
        }
      }
    }
    // DOM 속성 브릿지 (MAIN → ISOLATED 크로스-월드 안정성)
    document.documentElement.setAttribute('data-bwbr-all-characters-data', JSON.stringify({ characters }));
    window.dispatchEvent(new CustomEvent('bwbr-all-characters-data', {
      detail: { characters }
    }));
  });

  // ================================================================
  //  [COMBAT] 캐릭터 이미지 식별
  // ================================================================
  window.addEventListener('bwbr-identify-character-by-image', (e) => {
    const targetUrl = e.detail?.imageUrl;
    if (!targetUrl || !reduxStore) {
      window.dispatchEvent(new CustomEvent('bwbr-character-identified', { detail: null }));
      return;
    }

    const state = reduxStore.getState();
    const rc = state.entities?.roomCharacters;
    let found = null;

    if (rc?.ids) {
      for (const id of rc.ids) {
        const char = rc.entities?.[id];
        if (!char?.iconUrl) continue;
        // URL 부분 일치로 매칭 (이미지 프록시/리사이즈 대응)
        if (targetUrl.includes(char.iconUrl) || char.iconUrl.includes(targetUrl)
          || extractStoragePath(targetUrl) === extractStoragePath(char.iconUrl)) {
          found = { name: char.name, iconUrl: char.iconUrl, _id: char._id || id };
          break;
        }
      }
    }

    window.dispatchEvent(new CustomEvent('bwbr-character-identified', { detail: found }));
  });

  /** Firebase Storage URL에서 경로 부분 추출 (비교용) */
  function extractStoragePath(url) {
    if (!url) return '';
    try {
      // /o/path%2Fto%2Ffile 형태 추출
      const match = url.match(/\/o\/([^?]+)/);
      return match ? decodeURIComponent(match[1]) : url;
    } catch { return url; }
  }

  // ================================================================
  //  캐릭터 단축키: 발화 캐릭터 변경
  // ================================================================
  window.addEventListener('bwbr-switch-character', (e) => {
    const name = e.detail?.name;
    if (!name) return;

    // 코코포리아의 캐릭터 이름 입력 필드 찾기
    const input = document.querySelector(
      '#root > div > div.MuiDrawer-root.MuiDrawer-docked > div > div > form > div:nth-child(2) > div > div > input'
    );

    if (!input) {
      console.warn('[CE] 캐릭터 이름 입력 필드를 찾을 수 없습니다');
      return;
    }

    // React controlled input 값 변경
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, name);
    } else {
      input.value = name;
    }

    // React가 변경을 감지하도록 이벤트 디스패치
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    _dbg(`%c[CE]%c 🔄 발화 캐릭터 변경: ${name}`,
      'color: #82b1ff; font-weight: bold;', 'color: inherit;');
  });

  // Content Script에서 현재 발화(speaking) 캐릭터 요청
  window.addEventListener('bwbr-request-speaking-character', () => {
    let name = null;
    if (reduxStore) {
      const state = reduxStore.getState();
      const rc = state.entities?.roomCharacters;
      if (rc?.ids) {
        for (const id of rc.ids) {
          const char = rc.entities?.[id];
          if (char?.speaking) { name = char.name; break; }
        }
      }
    }
    window.dispatchEvent(new CustomEvent('bwbr-speaking-character-data', {
      detail: { name }
    }));
  });

  // Content Script에서 컷인(이펙트) 목록 요청
  window.addEventListener('bwbr-request-cutins', () => {
    const cutins = [];
    if (reduxStore) {
      const re = reduxStore.getState().entities?.roomEffects;
      if (re?.ids) {
        for (const id of re.ids) {
          const effect = re.entities?.[id];
          if (effect?.name) {
            cutins.push({ name: effect.name.trim() });
          }
        }
      }
    }
    window.dispatchEvent(new CustomEvent('bwbr-cutins-data', {
      detail: { success: cutins.length > 0, cutins }
    }));
  });

  // Content Script에서 Redux 재시도 요청 시 처리
  window.addEventListener('bwbr-request-redux', () => {
    if (!reduxStore) {
      setupStore();
    }
    window.dispatchEvent(new CustomEvent('bwbr-redux-ready', {
      detail: { success: !!reduxStore }
    }));
  });

  // ================================================================
  //  스탯 존재 여부 확인 (조건 연산자용)
  //  Content Script에서 bwbr-check-stat-exists 이벤트로 요청
  // ================================================================
  window.addEventListener('bwbr-check-stat-exists', () => {
    const raw = document.documentElement.getAttribute('data-bwbr-check-stat-exists');
    document.documentElement.removeAttribute('data-bwbr-check-stat-exists');
    const { charName, statLabel } = raw ? JSON.parse(raw) : {};
    const respond = (result) => {
      document.documentElement.setAttribute('data-bwbr-check-stat-exists-result', JSON.stringify(result));
      window.dispatchEvent(new CustomEvent('bwbr-check-stat-exists-result'));
    };
    try {
      if (!reduxStore) throw new Error('Redux Store 없음');
      const state = reduxStore.getState();
      const rc = state.entities?.roomCharacters;
      if (!rc) throw new Error('캐릭터 데이터 없음');
      let target = null;
      for (const id of (rc.ids || [])) {
        const c = rc.entities?.[id];
        if (c && c.name === charName) { target = c; break; }
      }
      if (!target) { respond({ exists: false, charFound: false }); return; }
      const found = (target.status || []).some(s => s.label === statLabel);
      respond({ exists: found, charFound: true });
    } catch (err) {
      console.error('[CE] 스탯 존재 확인 실패:', err.message);
      respond({ exists: false, charFound: false, error: err.message });
    }
  });

  // ================================================================
  //  스탯 값 조회 (트리거 {#캐릭터!스탯} 구문용)
  //  Content Script에서 bwbr-get-stat-value 이벤트로 요청
  // ================================================================
  window.addEventListener('bwbr-get-stat-value', () => {
    const raw = document.documentElement.getAttribute('data-bwbr-get-stat-value');
    document.documentElement.removeAttribute('data-bwbr-get-stat-value');
    const { charName, statLabel } = raw ? JSON.parse(raw) : {};
    const respond = (result) => {
      document.documentElement.setAttribute('data-bwbr-get-stat-value-result', JSON.stringify(result));
      window.dispatchEvent(new CustomEvent('bwbr-get-stat-value-result'));
    };
    try {
      if (!reduxStore) throw new Error('Redux Store 없음');
      const state = reduxStore.getState();
      const rc = state.entities?.roomCharacters;
      if (!rc) throw new Error('캐릭터 데이터 없음');
      let target = null;
      for (const id of (rc.ids || [])) {
        const c = rc.entities?.[id];
        if (c && c.name === charName) { target = c; break; }
      }
      if (!target) { respond({ found: false, error: 'char not found' }); return; }

      // 이니셔티브 조회
      if (statLabel === '이니셔티브' || statLabel === 'initiative') {
        respond({ found: true, value: target.initiative || 0 });
        return;
      }

      // .max / .value 접미사 처리
      let field = 'value';
      let label = statLabel;
      if (statLabel.endsWith('.max')) {
        field = 'max';
        label = statLabel.slice(0, -4);
      } else if (statLabel.endsWith('.value')) {
        label = statLabel.slice(0, -6);
      }

      const stat = (target.status || []).find(s => s.label === label);
      if (!stat) { respond({ found: false, error: 'stat not found' }); return; }
      respond({ found: true, value: stat[field] || 0, max: stat.max || 0 });
    } catch (err) {
      console.error('[CE] 스탯 값 조회 실패:', err.message);
      respond({ found: false, error: err.message });
    }
  });

  // ================================================================
  //  :# 스테이터스 변경 명령 처리
  //  Content Script에서 bwbr-modify-status 이벤트로 요청
  // ================================================================
  // ================================================================
  //  [COMBAT] 스탯 수정 (bwbr-modify-status, bwbr-modify-status-all)
  //  → 트리거 모듈도 사용하므로 코어 유지 검토 필요
  // ================================================================
  window.addEventListener('bwbr-modify-status', async (e) => {
    // DOM 속성 브릿지 (크로스-월드 안정성)
    const _raw = document.documentElement.getAttribute('data-bwbr-modify-status');
    document.documentElement.removeAttribute('data-bwbr-modify-status');
    const { targetName, statusLabel, operation, value, valueType, silent } = _raw ? JSON.parse(_raw) : (e.detail || {});
    const field = valueType === 'max' ? 'max' : 'value';
    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-modify-status-result', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-status-result', { detail }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const rc = state.entities?.roomCharacters;
      if (!rc) throw new Error('캐릭터 데이터 없음');

      // 대상 캐릭터 찾기
      let target = null, targetId = null;
      for (const id of (rc.ids || [])) {
        const c = rc.entities?.[id];
        if (c && c.name === targetName) { target = c; targetId = c._id || id; break; }
      }
      if (!target) throw new Error(`캐릭터 "${targetName}" 없음`);

      // 스테이터스 찾기 (정확 매칭 → 포함 매칭 폴백)
      const statusArr = target.status || [];
      let idx = statusArr.findIndex(s => s.label === statusLabel);
      if (idx < 0) idx = statusArr.findIndex(s => s.label.includes(statusLabel) || statusLabel.includes(s.label));
      if (idx < 0) {
        const allLabels = statusArr.map(s => `"${s.label}"`).join(', ');
        throw new Error(`스테이터스 "${statusLabel}" 없음 (보유: [${allLabels}])`);
      }

      const oldVal = parseInt(statusArr[idx][field], 10) || 0;
      let newVal;
      if (operation === '=max') {
        // value를 max로 설정 (최대치 충전)
        newVal = parseInt(statusArr[idx].max, 10) || 0;
      } else {
        switch (operation) {
          case '+': newVal = oldVal + value; break;
          case '-': newVal = oldVal - value; break;
          case '=': newVal = value; break;
          default: throw new Error(`잘못된 연산: ${operation}`);
        }
      }

      // 새 status 배열 생성
      const newStatus = statusArr.map((s, i) => {
        if (i === idx) return { ...s, [field]: newVal };
        return { ...s };
      });

      // Firestore에 쓰기
      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      const targetRef = sdk.doc(charsCol, targetId);
      await sdk.setDoc(targetRef, { status: newStatus, updatedAt: Date.now() }, { merge: true });

      _dbg(`%c[CE]%c ✅ ${targetName} ${statusLabel}: ${oldVal} → ${newVal}`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
      respond({ success: true, target: targetName, status: statusLabel, oldVal, newVal });

      // 코코포리아 시스템 메시지 형식으로 변경 내역 전송 (silent 미적용 시만)
      if (!silent) {
        sendDirectMessage(
          `[ ${targetName} ] ${statusLabel} : ${oldVal} → ${newVal}`,
          { name: 'system', type: 'system', color: '#888888', iconUrl: null }
        ).catch(() => {});
      }

    } catch (err) {
      console.error('[CE] 스테이터스 변경 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  트리거: 전체 캐릭터 스탯 일괄 변경
  //  Content Script에서 bwbr-modify-status-all 이벤트로 요청
  //  활성화된(hideStatus !== true) 모든 캐릭터를 대상으로 함
  //  op: '+', '-', '=', '=max' (=max → value를 max 값으로 설정)
  // ================================================================
  window.addEventListener('bwbr-modify-status-all', async (e) => {
    // DOM 속성 브릿지 (크로스-월드 안정성)
    const _raw = document.documentElement.getAttribute('data-bwbr-modify-status-all');
    document.documentElement.removeAttribute('data-bwbr-modify-status-all');
    const { statusLabel, operation, value, valueType, silent } = _raw ? JSON.parse(_raw) : (e.detail || {});
    const field = valueType === 'max' ? 'max' : 'value';
    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-modify-status-all-result', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-status-all-result', { detail }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const rc = state.entities?.roomCharacters;
      if (!rc) throw new Error('캐릭터 데이터 없음');

      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      let affected = 0;
      const changes = [];

      for (const id of (rc.ids || [])) {
        const char = rc.entities?.[id];
        if (!char) continue;
        // 사이드바에서 숨겨진 캐릭터 제외
        if (char.hideStatus === true) continue;

        const charId = char._id || id;
        const statusArr = char.status || [];
        let idx = statusArr.findIndex(s => s.label === statusLabel);
        if (idx < 0) idx = statusArr.findIndex(s => s.label.includes(statusLabel) || statusLabel.includes(s.label));
        if (idx < 0) continue; // 해당 스탯이 없는 캐릭터는 건너뜀

        const oldVal = parseInt(statusArr[idx][field], 10) || 0;
        let newVal;
        if (operation === '=max') {
          // value를 max로 설정 (최대치까지 채우기)
          newVal = parseInt(statusArr[idx].max, 10) || 0;
        } else {
          switch (operation) {
            case '+': newVal = oldVal + value; break;
            case '-': newVal = oldVal - value; break;
            case '=': newVal = value; break;
            default: continue;
          }
        }

        if (oldVal === newVal) continue; // 변화 없으면 건너뜀

        const newStatus = statusArr.map((s, i) => {
          if (i === idx) return { ...s, [field]: newVal };
          return { ...s };
        });

        const charRef = sdk.doc(charsCol, charId);
        await sdk.setDoc(charRef, { status: newStatus, updatedAt: Date.now() }, { merge: true });
        affected++;
        changes.push({ name: char.name, oldVal, newVal });
      }

      if (affected > 0) {
        const opLabel = operation === '=max' ? '최대치 충전' : `${operation}${value}`;
        _dbg(`%c[CE]%c ✅ 전체 ${statusLabel} ${opLabel}: ${affected}명`,
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
        // 일괄 변경 시스템 메시지 (silent 미적용 시만)
        if (!silent) {
          const changeStr = changes.map(c => `${c.name}: ${c.oldVal}→${c.newVal}`).join(', ');
          sendDirectMessage(
            `[ 전체 ] ${statusLabel} ${opLabel} → ${affected}명 적용 (${changeStr})`,
            { name: 'system', type: 'system', color: '#888888', iconUrl: null }
          ).catch(() => {});
        }
      }

      respond({ success: true, affected, label: statusLabel, changes });

    } catch (err) {
      console.error('[CE] 전체 스테이터스 변경 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  트리거: 캐릭터 메시지 (특정 캐릭터 이름/아이콘으로 전송)
  //  Content Script에서 bwbr-trigger-char-msg 이벤트로 요청
  // ================================================================
  // ================================================================
  //  [TRIGGER] 트리거 액션: 캐릭터 메시지/필드/파람 수정
  //  bwbr-trigger-char-msg, bwbr-modify-param, bwbr-trigger-char-field
  // ================================================================
  window.addEventListener('bwbr-trigger-char-msg', async (e) => {
    // DOM 속성 브릿지 (크로스-월드 안정성)
    const _raw = document.documentElement.getAttribute('data-bwbr-trigger-char-msg');
    document.documentElement.removeAttribute('data-bwbr-trigger-char-msg');
    const { targetName, text } = _raw ? JSON.parse(_raw) : (e.detail || {});
    const respond = (detail) => window.dispatchEvent(
      new CustomEvent('bwbr-char-msg-result', { detail })
    );

    try {
      if (!reduxStore) throw new Error('Redux Store 없음');
      if (!text) throw new Error('텍스트 없음');

      // 캐릭터 정보 조회
      const char = getCharacterByName(targetName);
      if (!char) throw new Error(`캐릭터 "${targetName}" 없음`);

      const chInfo = _detectCurrentChannel();
      const overrides = {
        name: char.name || targetName,
        iconUrl: char.iconUrl || '',
        color: char.color || '#e0e0e0'
      };
      if (chInfo) {
        overrides.channel = chInfo.channel;
        overrides.channelName = chInfo.channelName;
      }
      const success = await sendDirectMessage(text, overrides);
      respond({ success, text });
    } catch (err) {
      console.error('[CE] 캐릭터 메시지 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  트리거: 파라미터 변경 (캐릭터 params[] 배열 수정)
  //  Content Script에서 bwbr-modify-param 이벤트로 요청
  //  silent: true 시 시스템 메시지 미전송
  // ================================================================
  window.addEventListener('bwbr-modify-param', async (e) => {
    // DOM 속성 브릿지 (크로스-월드 안정성)
    const _raw = document.documentElement.getAttribute('data-bwbr-modify-param');
    document.documentElement.removeAttribute('data-bwbr-modify-param');
    const { targetName, paramLabel, operation, value, silent } = _raw ? JSON.parse(_raw) : (e.detail || {});
    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-modify-param-result', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-param-result', { detail }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const char = getCharacterByName(targetName);
      if (!char) throw new Error(`캐릭터 "${targetName}" 없음`);

      const paramsArr = char.params || [];
      const idx = paramsArr.findIndex(p => p.label === paramLabel);
      if (idx < 0) throw new Error(`파라미터 "${paramLabel}" 없음`);

      const oldVal = paramsArr[idx].value || '';
      let newVal;
      const numOld = parseFloat(oldVal);
      const numNew = parseFloat(value);

      if (operation === '=' || isNaN(numOld) || isNaN(numNew)) {
        // 문자열 대입 또는 숫자가 아닌 경우
        newVal = value;
      } else {
        switch (operation) {
          case '+': newVal = String(numOld + numNew); break;
          case '-': newVal = String(numOld - numNew); break;
          default:  newVal = value; break;
        }
      }

      const newParams = paramsArr.map((p, i) => {
        if (i === idx) return { ...p, value: String(newVal) };
        return { ...p };
      });

      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      const charRef = sdk.doc(charsCol, char.__id);
      await sdk.setDoc(charRef, { params: newParams, updatedAt: Date.now() }, { merge: true });

      _dbg(`%c[CE]%c ✅ ${targetName} ${paramLabel}: ${oldVal} → ${newVal}`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
      respond({ success: true, target: targetName, param: paramLabel, oldVal, newVal });

      if (!silent) {
        sendDirectMessage(
          `[ ${targetName} ] ${paramLabel} : ${oldVal} → ${newVal}`,
          { name: 'system', type: 'system', color: '#888888', iconUrl: null }
        ).catch(() => {});
      }

    } catch (err) {
      console.error('[CE] 파라미터 변경 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  전투 보조: 전체 캐릭터 파라미터 일괄 변경
  //  Content Script에서 bwbr-modify-param-all 이벤트로 요청
  //  활성화된(hideStatus !== true) 모든 캐릭터를 대상으로 함
  //  op: '+', '-', '='
  // ================================================================
  window.addEventListener('bwbr-modify-param-all', async (e) => {
    const _raw = document.documentElement.getAttribute('data-bwbr-modify-param-all');
    document.documentElement.removeAttribute('data-bwbr-modify-param-all');
    const { paramLabel, operation, value, silent } = _raw ? JSON.parse(_raw) : (e.detail || {});
    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-modify-param-all-result', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-modify-param-all-result', { detail }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const state = reduxStore.getState();
      const rc = state.entities?.roomCharacters;
      if (!rc) throw new Error('캐릭터 데이터 없음');

      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      let affected = 0;
      const changes = [];

      for (const id of (rc.ids || [])) {
        const char = rc.entities?.[id];
        if (!char) continue;
        if (char.hideStatus === true) continue;

        const charId = char._id || id;
        const paramsArr = char.params || [];
        const idx = paramsArr.findIndex(p => p.label === paramLabel);
        if (idx < 0) continue;

        const oldVal = paramsArr[idx].value || '';
        const numOld = parseFloat(oldVal);
        const numNew = parseFloat(value);
        let newVal;

        if (operation === '=' || isNaN(numOld) || isNaN(numNew)) {
          newVal = String(value);
        } else {
          switch (operation) {
            case '+': newVal = String(numOld + numNew); break;
            case '-': newVal = String(numOld - numNew); break;
            default:  newVal = String(value); break;
          }
        }

        if (oldVal === String(newVal)) continue;

        const newParams = paramsArr.map((p, i) => {
          if (i === idx) return { ...p, value: String(newVal) };
          return { ...p };
        });

        const charRef = sdk.doc(charsCol, charId);
        await sdk.setDoc(charRef, { params: newParams, updatedAt: Date.now() }, { merge: true });
        affected++;
        changes.push({ name: char.name, oldVal, newVal });
      }

      if (affected > 0) {
        _dbg(`%c[CE]%c ✅ 전체 ${paramLabel} ${operation}${value}: ${affected}명`,
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
        if (!silent) {
          const changeStr = changes.map(c => `${c.name}: ${c.oldVal}→${c.newVal}`).join(', ');
          sendDirectMessage(
            `[ 전체 ] ${paramLabel} ${operation}${value} → ${affected}명 적용 (${changeStr})`,
            { name: 'system', type: 'system', color: '#888888', iconUrl: null }
          ).catch(() => {});
        }
      }

      respond({ success: true, affected, label: paramLabel, changes });

    } catch (err) {
      console.error('[CE] 전체 파라미터 변경 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  트리거: 범용 캐릭터 필드 변경
  //  field: 'active' | 'face' | 'move' | 'initiative' | 'memo'
  //  Content Script에서 bwbr-trigger-char-field 이벤트로 요청
  // ================================================================
  window.addEventListener('bwbr-trigger-char-field', async (e) => {
    // DOM 속성 브릿지 (크로스-월드 안정성)
    const _raw = document.documentElement.getAttribute('data-bwbr-trigger-char-field');
    document.documentElement.removeAttribute('data-bwbr-trigger-char-field');
    const detail = _raw ? JSON.parse(_raw) : (e.detail || {});
    const { targetName, field } = detail;
    const respond = (d) => window.dispatchEvent(
      new CustomEvent('bwbr-trigger-char-field-result', { detail: d })
    );

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const char = getCharacterByName(targetName);
      if (!char) throw new Error(`캐릭터 "${targetName}" 없음`);

      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      const charRef = sdk.doc(charsCol, char.__id);
      let update = { updatedAt: Date.now() };

      switch (field) {
        case 'active':
          update.active = !!detail.value;
          break;

        case 'face': {
          const faces = char.faces || [];
          const fIdx = parseInt(detail.value, 10) || 0;
          if (faces[fIdx]) {
            // faces는 {label, iconUrl} 객체 배열 또는 URL 문자열 배열 (하위 호환)
            update.iconUrl = typeof faces[fIdx] === 'object' ? faces[fIdx].iconUrl : faces[fIdx];
          } else {
            throw new Error(`표정 인덱스 ${fIdx} 없음 (faces 길이: ${faces.length})`);
          }
          break;
        }

        case 'move': {
          if (detail.relative) {
            update.x = (char.x || 0) + (detail.x || 0);
            update.y = (char.y || 0) + (detail.y || 0);
          } else {
            update.x = detail.x || 0;
            update.y = detail.y || 0;
          }
          break;
        }

        case 'initiative':
          update.initiative = parseInt(detail.value, 10) || 0;
          break;

        case 'memo':
          update.memo = String(detail.value || '');
          break;

        default:
          throw new Error(`알 수 없는 필드: ${field}`);
      }

      await sdk.setDoc(charRef, update, { merge: true });
      _dbg(`%c[CE]%c ✅ ${targetName} ${field} 변경 완료`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
      respond({ success: true, target: targetName, field });

    } catch (err) {
      console.error(`[CE] 캐릭터 필드(${field}) 변경 실패:`, err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  표정 일괄 추가 (bwbr-add-faces-bulk)
  //  ISOLATED world에서 다중 선택된 이미지를 Firestore에 일괄 추가
  //  → 편집 다이얼로그 닫기/재열기로 갱신
  // ================================================================
  window.addEventListener('bwbr-add-faces-bulk', async () => {
    const _raw = document.documentElement.getAttribute('data-bwbr-add-faces-bulk');
    document.documentElement.removeAttribute('data-bwbr-add-faces-bulk');
    const { faces } = _raw ? JSON.parse(_raw) : {};

    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-add-faces-bulk-result', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-add-faces-bulk-result'));
    };

    try {
      if (!faces || !faces.length) throw new Error('추가할 표정 데이터 없음');

      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      // 현재 편집 중인 캐릭터 ID
      const charId = state.app?.state?.openRoomCharacterId;
      if (!charId) throw new Error('편집 중인 캐릭터 없음 (openRoomCharacterId 없음)');

      const rc = state.entities?.roomCharacters;
      const char = rc?.entities?.[charId];
      if (!char) throw new Error(`캐릭터 ID "${charId}" 데이터 없음`);

      // 기존 faces + 새 faces 합산
      const currentFaces = Array.isArray(char.faces) ? [...char.faces] : [];
      const newFaces = faces.map(f => ({
        label: String(f.label || ''),
        iconUrl: String(f.iconUrl || '')
      }));
      const mergedFaces = [...currentFaces, ...newFaces];

      // Firestore 업데이트 — Redux에만 반영된 미저장 편집도 함께 보존
      // (프로필 이미지 변경 등이 편집 다이얼로그에서 아직 미커밋 상태일 수 있음)
      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      const charRef = sdk.doc(charsCol, charId);
      const saveData = {};
      for (const k of Object.keys(char)) {
        if (k === '_id') continue;
        saveData[k] = char[k];
      }
      saveData.faces = mergedFaces;
      saveData.updatedAt = Date.now();
      await sdk.setDoc(charRef, saveData, { merge: true });

      console.log(`%c[CE]%c ✅ ${char.name || charId} 표정 ${newFaces.length}장 추가 (총 ${mergedFaces.length}장)`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      // 이미지 피커 닫기 + 편집 다이얼로그 닫기 → 재열기
      const creator = findSetedActionCreator();
      if (creator) {
        // 1) 피커 + 편집 다이얼로그 닫기
        const s1 = reduxStore.getState().app?.state;
        reduxStore.dispatch({
          type: creator.type,
          payload: { ...s1, openRoomImageSelect: false, openRoomCharacter: false }
        });

        // 2) 300ms 후 편집 다이얼로그 재열기
        setTimeout(() => {
          const s2 = reduxStore.getState().app?.state;
          reduxStore.dispatch({
            type: creator.type,
            payload: { ...s2, openRoomCharacter: true, openRoomCharacterId: charId }
          });
        }, 350);
      }

      respond({ success: true, count: newFaces.length, total: mergedFaces.length });

    } catch (err) {
      console.error('[CE] 표정 일괄 추가 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  진단용: roomMessages 구조 덤프
  //  콘솔에서 실행: window.dispatchEvent(new CustomEvent('bwbr-dump-messages'))
  // ================================================================
  window.addEventListener('bwbr-dump-messages', () => {
    if (!reduxStore) {
      console.log('%c[CE 진단]%c ❌ Redux Store 없음', 'color: #f44336; font-weight: bold;', 'color: inherit;');
      return;
    }
    try {
      const rm = reduxStore.getState().entities?.roomMessages;
      if (!rm || !rm.ids || rm.ids.length === 0) {
        console.log('%c[CE 진단]%c ⚠️ roomMessages가 비어있음. 채팅 메시지를 보낸 뒤 다시 시도하세요.',
          'color: #ff9800; font-weight: bold;', 'color: inherit;');
        return;
      }
      const lastId = rm.ids[rm.ids.length - 1];
      const lastEntity = rm.entities[lastId];
      console.log('%c[CE 진단]%c ===== roomMessages 구조 =====',
        'color: #2196f3; font-weight: bold;', 'color: inherit;');
      console.log('총 메시지 수:', rm.ids.length);
      console.log('마지막 메시지 ID:', lastId);
      console.log('마지막 메시지 키:', Object.keys(lastEntity));
      console.log('마지막 메시지 전체:', JSON.parse(JSON.stringify(lastEntity)));
      const recentIds = rm.ids.slice(-3);
      for (const id of recentIds) {
        const e = rm.entities[id];
        console.log(`\n--- ${id} ---`);
        console.log(JSON.parse(JSON.stringify(e)));
      }
      console.log('%c[CE 진단]%c ===========================',
        'color: #2196f3; font-weight: bold;', 'color: inherit;');
    } catch (e) {
      console.error('[CE 진단] 오류:', e);
    }
  });

  // ================================================================
  //  진단용: 현재 채널 탐지 테스트
  //  콘솔에서 실행: window.dispatchEvent(new CustomEvent('bwbr-detect-channel'))
  // ================================================================
  window.addEventListener('bwbr-detect-channel', () => {
    console.log('%c[CE 진단]%c ===== 채널 탐지 테스트 =====',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
    // Redux app state 덤프
    if (reduxStore) {
      const fullState = reduxStore.getState();
      const app = fullState.app;
      console.log('app.chat:', JSON.parse(JSON.stringify(app?.chat || {})));
      console.log('app.state:', JSON.parse(JSON.stringify(app?.state || {})));

      // ★ Redux entities 전체 키 + 방 설정에서 채널 정보 탐색
      const entities = fullState.entities;
      console.log('entities 키:', Object.keys(entities || {}));
      // room 관련 entities 내용 덤프
      for (const key of Object.keys(entities || {})) {
        if (key === 'roomMessages') continue; // 메시지는 별도 분석
        const ent = entities[key];
        if (ent?.ids?.length > 0) {
          console.log(`entities.${key} (${ent.ids.length}개):`);
          // 처음 3개만 출력
          for (let i = 0; i < Math.min(3, ent.ids.length); i++) {
            console.log(`  [${i}]`, JSON.parse(JSON.stringify(ent.entities[ent.ids[i]])));
          }
        }
      }
      // app 전체 키 중 channel 관련 탐색
      for (const key of Object.keys(app || {})) {
        if (key === 'chat' || key === 'state') continue;
        const val = app[key];
        if (val && typeof val === 'object') {
          const str = JSON.stringify(val);
          if (str.includes('channel') || str.includes('Channel') || str.includes('tab') || str.includes('Tab')) {
            console.log(`app.${key} (채널 관련?):`, JSON.parse(str));
          }
        }
      }

      // 메시지에서 모든 고유 channel/channelName 쌍 수집
      const rm = reduxStore.getState().entities?.roomMessages;
      if (rm?.ids) {
        const channelMap = new Map();
        for (const id of rm.ids) {
          const e = rm.entities?.[id];
          if (!e) continue;
          const key = (e.channel || '(empty)') + ' | ' + (e.channelName || '(empty)');
          if (!channelMap.has(key)) channelMap.set(key, 0);
          channelMap.set(key, channelMap.get(key) + 1);
        }
        console.log('메시지 채널 분포:');
        channelMap.forEach((count, key) => console.log(`  ${key}  (${count}건)`));
      }
    }
    // DOM 탭 탐색
    const allTabs = document.querySelectorAll('[role="tab"]');
    console.log('전체 [role="tab"] 수:', allTabs.length);
    allTabs.forEach((t, i) => {
      console.log(`  탭[${i}]: text="${t.textContent?.trim()}" selected=${t.getAttribute('aria-selected')} class="${t.className?.substring(0, 80)}"`);
    });
    // 함수 결과
    const result = _detectCurrentChannel();
    console.log('_detectCurrentChannel() 결과:', result);
    console.log('%c[CE 진단]%c ===========================',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  진단용: Firestore SDK 탐색
  //  콘솔에서 실행: window.dispatchEvent(new CustomEvent('bwbr-discover-firestore'))
  // ================================================================
  window.addEventListener('bwbr-discover-firestore', () => {
    console.log('%c[CE 진단]%c ===== Firestore SDK 탐색 =====',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');

    const req = acquireWebpackRequire();
    if (!req) {
      console.error('[CE 진단] webpack require 획득 실패');
      return;
    }

    // 1. Firestore 함수 포함 모듈 후보 찾기
    console.log('[CE 진단] 모듈 스캔 중...');
    const candidates = [];
    for (const id of Object.keys(req.m)) {
      try {
        const mod = req(id);
        if (!mod || typeof mod !== 'object') continue;
        let fsCount = 0;
        const funcKeys = [];
        for (const [k, v] of Object.entries(mod)) {
          if (typeof v !== 'function') continue;
          const s = v.toString().substring(0, 1000);
          if (s.includes('merge') || s.includes('firestore') ||
              s.includes('collection') || s.includes('document')) {
            fsCount++;
            funcKeys.push(k);
          }
        }
        if (fsCount >= 3) candidates.push({ id, fsCount, totalKeys: Object.keys(mod).length, funcKeys });
      } catch (e) {}
    }
    console.log('[CE 진단] Firestore 모듈 후보:');
    console.table(candidates);

    // 2. DB 인스턴스 찾기
    console.log('[CE 진단] DB 인스턴스 탐색 중...');
    let dbInfo = null;
    for (const id of Object.keys(req.m)) {
      try {
        const mod = req(id);
        if (!mod || typeof mod !== 'object') continue;
        for (const [k, v] of Object.entries(mod)) {
          if (v && typeof v === 'object' && v.type === 'firestore' && typeof v.toJSON === 'function') {
            dbInfo = { moduleId: id, key: k };
            break;
          }
        }
        if (dbInfo) break;
      } catch (e) {}
    }
    if (dbInfo) {
      console.log(`[CE 진단] ✅ DB 인스턴스: 모듈=${dbInfo.moduleId}, 키=${dbInfo.key}`);
    } else {
      console.error('[CE 진단] ❌ DB 인스턴스를 찾을 수 없음');
    }

    // 3. 최고 후보로 함수 자동 매칭
    if (candidates.length > 0 && dbInfo) {
      const best = candidates.sort((a, b) => b.fsCount - a.fsCount)[0];
      console.log(`[CE 진단] 최고 후보 모듈: ${best.id} (Firestore 함수 ${best.fsCount}개)`);

      try {
        const fsMod = req(best.id);
        const db = req(dbInfo.moduleId)[dbInfo.key];
        const result = autoDiscoverFirestoreFunctions(fsMod, db);
        if (result) {
          console.log('%c[CE 진단]%c ✅ 자동 매칭 성공!', 'color: #4caf50; font-weight: bold;', 'color: inherit;');
          console.log('[CE 진단] _FS_CONFIG 업데이트 값:');
          console.log(JSON.stringify({
            firestoreModId: Number(best.id),
            dbModId: Number(dbInfo.moduleId),
            dbKey: dbInfo.key
          }, null, 2));
        } else {
          console.warn('[CE 진단] ⚠️ 자동 매칭 실패 — 수동 확인 필요');
          console.log('[CE 진단] 후보 모듈 ' + best.id + '의 함수 키:', best.funcKeys);
        }
      } catch (e) {
        console.error('[CE 진단] 오류:', e);
      }
    }

    console.log('%c[CE 진단]%c ===============================',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  채팅 로그 전체 추출 (Firestore 직접 쿼리)
  //  ISOLATED world에서 bwbr-export-log 이벤트로 요청
  // ================================================================
  // ================================================================
  //  [CORE] 로그 내보내기 (bwbr-export-log)
  // ================================================================
  window.addEventListener('bwbr-export-log', async () => {
    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('bwbr-export-log-result', { detail: data }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) {
        respond({ success: false, error: 'Firestore SDK 획득 실패' });
        return;
      }
      if (!sdk.getDocs) {
        respond({ success: false, error: 'getDocs 함수를 찾을 수 없음 (fsKeys.getDocs 확인 필요)' });
        return;
      }
      if (!reduxStore) {
        respond({ success: false, error: 'Redux Store 없음' });
        return;
      }

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) {
        respond({ success: false, error: 'roomId를 찾을 수 없음' });
        return;
      }

      // 방 이름 가져오기
      const roomName = state.room?.data?.name
        || state.entities?.room?.name
        || document.title?.replace(' - ココフォリア', '') || '';

      console.log('%c[CE]%c 📜 로그 추출 시작... (roomId: ' + roomId + ')',
        'color: #2196f3; font-weight: bold;', 'color: inherit;');

      // Firestore에서 전체 메시지 컬렉션 조회
      const messagesCol = sdk.collection(sdk.db, 'rooms', roomId, 'messages');
      const snapshot = await sdk.getDocs(messagesCol);

      const messages = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();

        // Firestore Timestamp → epoch ms 변환
        let createdAt = 0;
        const ca = data.createdAt;
        if (ca) {
          if (typeof ca.toMillis === 'function') createdAt = ca.toMillis();
          else if (typeof ca.seconds === 'number') createdAt = ca.seconds * 1000;
          else if (ca instanceof Date) createdAt = ca.getTime();
          else if (typeof ca === 'number') createdAt = ca;
        }

        // 주사위 결과 추출
        let diceResult = '';
        if (data.extend?.roll?.result) {
          diceResult = data.extend.roll.result;
        }

        messages.push({
          id: docSnap.id,
          text: data.text || '',
          name: data.name || '',
          type: data.type || 'text',
          color: data.color || '#e0e0e0',
          iconUrl: data.iconUrl || '',
          channel: data.channel || '',
          channelName: data.channelName || '',
          diceResult: diceResult,
          createdAt: createdAt,
          to: data.to || null,
          toName: data.toName || '',
          imageUrl: data.imageUrl || null
        });
      });

      // 시간순 정렬
      messages.sort((a, b) => a.createdAt - b.createdAt);

      console.log(`%c[CE]%c 📜 로그 추출 완료: ${messages.length}건`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      respond({ success: true, messages, roomId, roomName });

    } catch (e) {
      console.error('[CE] 로그 추출 실패:', e);
      respond({ success: false, error: e.message });
    }
  });

  // ================================================================
  //  캐릭터 단축키: 캐릭터 조작 (편집 / 집어넣기 / 복사 / 삭제)
  // ================================================================

  const respondAction = (msg) => {
    window.dispatchEvent(new CustomEvent('bwbr-char-action-result', {
      detail: { message: msg }
    }));
  };

  /** Redux 상태에서 이름으로 캐릭터 조회 */
  function getCharacterByName(name) {
    if (!reduxStore) return null;
    const rc = reduxStore.getState().entities?.roomCharacters;
    if (!rc) return null;
    for (const id of (rc.ids || [])) {
      const c = rc.entities?.[id];
      if (c && c.name === name) return { ...c, __id: id };
    }
    return null;
  }

  /** 캐릭터 목록을 ISOLATED world로 재전송 (캐시 갱신) */
  function broadcastCharacterList() {
    if (!reduxStore) return;
    const rc = reduxStore.getState().entities?.roomCharacters;
    if (!rc) return;
    const characters = [];
    for (const id of (rc.ids || [])) {
      const c = rc.entities?.[id];
      if (c) characters.push({ id, name: c.name || '', iconUrl: c.iconUrl || '', active: c.active, speaking: !!c.speaking, color: c.color || '' });
    }
    window.dispatchEvent(new CustomEvent('bwbr-all-characters-data', { detail: { characters } }));
  }

  /** roomId 획득 */
  function getRoomId() {
    if (!reduxStore) return null;
    return reduxStore.getState().app?.state?.roomId
      || window.location.pathname.match(/rooms\/([^/]+)/)?.[1] || null;
  }

  // ================================================================
  //  [CORE] 캐릭터 편집/저장/복사/삭제 (char-shortcut)
  // ================================================================
  // ── 편집: Redux state에서 openRoomCharacterId 설정 → 네이티브 편집 다이얼로그 ──
  window.addEventListener('bwbr-character-edit', (e) => {
    const name = e.detail?.name;
    if (!name) return respondAction('캐릭터를 특정할 수 없습니다');

    const char = getCharacterByName(name);
    if (!char) {
      respondAction(name + ': 캐릭터를 찾을 수 없습니다');
      return;
    }

    try {
      const creator = findSetedActionCreator();
      if (!creator) {
        respondAction(name + ': Redux action type 미발견 — 잠시 후 다시 시도해주세요');
        return;
      }

      const appState = reduxStore.getState().app?.state;
      const newState = { ...appState, openRoomCharacter: true, openRoomCharacterId: char.__id };
      reduxStore.dispatch({ type: creator.type, payload: newState });

      const check = reduxStore.getState().app?.state;
      if (check?.openRoomCharacter === true && check?.openRoomCharacterId === char.__id) {
        console.log(`%c[CE]%c ✅ ${name} 편집 다이얼로그 열림 (ID: ${char.__id})`,
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
      } else {
        respondAction(name + ': 편집 다이얼로그 열기 실패');
      }
    } catch (err) {
      console.error('[CE] 편집 실패:', err);
      respondAction('편집 실패: ' + err.message);
    }
  });

  // ── 네이티브 캐릭터 메뉴 공통 헬퍼 ──
  // openRoomCharacterMenu + openRoomCharacterMenuId로 네이티브 컨텍스트 메뉴를 열고
  // 지정된 menuitem을 찾아 클릭한다. 메뉴는 화면에 보이지 않게 처리.
  function triggerNativeCharMenu(name, menuKeywords, actionLabel) {
    const char = getCharacterByName(name);
    if (!char) {
      respondAction(name + ': 캐릭터를 찾을 수 없습니다');
      return;
    }

    try {
      const creator = findSetedActionCreator();
      if (!creator) {
        respondAction(name + ': Redux action type 미발견 — 잠시 후 다시 시도해주세요');
        return;
      }

      // 메뉴가 열릴 때 화면에 보이지 않도록 임시 CSS 삽입
      const hideStyle = document.createElement('style');
      hideStyle.id = 'bwbr-hide-native-menu';
      hideStyle.textContent = '.MuiPopover-root:not(.bwbr-ctx-menu) { opacity:0 !important; pointer-events:auto !important; }';
      document.head.appendChild(hideStyle);

      // 네이티브 캐릭터 컨텍스트 메뉴 열기
      const appState = reduxStore.getState().app?.state;
      const newState = { ...appState, openRoomCharacterMenu: true, openRoomCharacterMenuId: char.__id };
      reduxStore.dispatch({ type: creator.type, payload: newState });

      // MUI Popover가 렌더링될 때까지 대기 → menuitem 클릭
      let attempts = 0;
      const tryClick = () => {
        const pops = document.querySelectorAll('.MuiPopover-root');
        for (let i = pops.length - 1; i >= 0; i--) {
          const pop = pops[i];
          const items = pop.querySelectorAll('li[role="menuitem"]');
          for (const item of items) {
            const t = (item.textContent || '').trim();
            for (const kw of menuKeywords) {
              if (t.includes(kw)) {
                item.click();
                hideStyle.remove();
                respondAction(name + ' → ' + actionLabel);
                console.log(`%c[CE]%c ✅ ${name} 네이티브 ${actionLabel} (메뉴: "${t}")`,
                  'color: #4caf50; font-weight: bold;', 'color: inherit;');
                setTimeout(broadcastCharacterList, 500);
                return;
              }
            }
          }
        }
        if (++attempts < 20) {
          setTimeout(tryClick, 50);
        } else {
          hideStyle.remove();
          // 메뉴가 안 열리거나 항목 못 찾음 → 메뉴 닫기
          // 디버깅: 발견된 모든 메뉴 항목 출력
          const lastPop = document.querySelector('.MuiPopover-root');
          if (lastPop) {
            const foundItems = lastPop.querySelectorAll('li[role="menuitem"]');
            const labels = [...foundItems].map(el => `"${(el.textContent||'').trim()}"`);
            console.warn(`[CE] ${actionLabel} 실패: 메뉴 항목 미발견\n  찾은 항목: [${labels.join(', ')}]\n  검색 키워드: [${menuKeywords.join(', ')}]`);
            const bd = lastPop.querySelector('.MuiBackdrop-root');
            if (bd) bd.click(); else document.body.click();
          } else {
            console.warn(`[CE] ${actionLabel} 실패: MuiPopover-root 자체가 없음`);
          }
          respondAction(name + ': ' + actionLabel + ' 실패 — 메뉴 항목을 찾을 수 없습니다');
        }
      };
      setTimeout(tryClick, 60);
    } catch (err) {
      const hs = document.getElementById('bwbr-hide-native-menu');
      if (hs) hs.remove();
      console.error(`[CE] ${actionLabel} 실패:`, err);
      respondAction(actionLabel + ' 실패: ' + err.message);
    }
  }

  // ── 집어넣기/꺼내기: active 상태에 따라 분기 ──
  // 집어넣기(active→stored): 네이티브 메뉴 사용
  // 꺼내기(stored→active): Firestore 직접 쓰기 (네이티브 메뉴에 항목이 다르게 표시될 수 있음)
  window.addEventListener('bwbr-character-store', async (e) => {
    const name = e.detail?.name;
    if (!name) return respondAction('캐릭터를 특정할 수 없습니다');

    const char = getCharacterByName(name);
    if (!char) return respondAction(name + ': 캐릭터를 찾을 수 없습니다');

    if (char.active !== false) {
      // 보드 위에 있음 → 집어넣기 (네이티브 메뉴)
      triggerNativeCharMenu(name, ['집어넣기', '仕舞う'], '집어넣기');
    } else {
      // 집어넣어진 상태 → 꺼내기 (Firestore 직접 쓰기)
      try {
        const sdk = acquireFirestoreSDK();
        if (!sdk) throw new Error('Firestore SDK 없음');
        const roomId = getRoomId();
        if (!roomId) throw new Error('방 ID를 찾을 수 없음');

        const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
        const charRef = sdk.doc(charsCol, char.__id);
        await sdk.setDoc(charRef, { active: true, updatedAt: Date.now() }, { merge: true });

        respondAction(name + ' → 꺼내기');
        console.log(`%c[CE]%c ✅ ${name} 꺼내기 (Firestore direct)`,
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
        setTimeout(broadcastCharacterList, 500);
      } catch (err) {
        console.error('[CE] 꺼내기 실패:', err);
        respondAction('꺼내기 실패: ' + err.message);
      }
    }
  });

  // ── 복제: 네이티브 캐릭터 메뉴 ──
  window.addEventListener('bwbr-character-copy', (e) => {
    const name = e.detail?.name;
    if (!name) return respondAction('캐릭터를 특정할 수 없습니다');
    triggerNativeCharMenu(name, ['복제', '複製', '복사', 'コピー'], '복제');
  });

  // ── 삭제: 네이티브 캐릭터 메뉴 ──
  window.addEventListener('bwbr-character-delete', (e) => {
    const name = e.detail?.name;
    if (!name) return respondAction('캐릭터를 특정할 수 없습니다');
    triggerNativeCharMenu(name, ['삭제', '削除'], '삭제');
  });

  // ================================================================
  //  토큰 바인딩: ISOLATED → MAIN 바인딩 맵 동기화
  //  DOM attr data-bwbr-token-bindings 는 영구 유지 (삭제 안 함)
  //  push event + 온디맨드 DOM 읽기 이중 보장
  // ================================================================
  function _readBindingsFromDOM() {
    try {
      const raw = document.documentElement.getAttribute('data-bwbr-token-bindings');
      if (!raw) return;
      const { roomId, bindings } = JSON.parse(raw);
      _tokenBindingsRoomId = roomId;
      _tokenBindings = bindings || {};
    } catch (e) { /* ignore */ }
  }

  // push 이벤트 수신 (즉시 캐시 갱신)
  // ================================================================
  //  [COMBAT] 토큰 바인딩 + 패널 식별
  //  bwbr-sync-token-bindings, bwbr-identify-panel
  // ================================================================
  document.addEventListener('bwbr-sync-token-bindings', () => {
    _readBindingsFromDOM();
    console.log(`%c[CE]%c 토큰 바인딩 동기화: ${Object.keys(_tokenBindings).length}개`,
      'color: #ab47bc; font-weight: bold;', 'color: inherit;');
  });
  // window 이벤트로도 수신 (크로스-월드 호환성)
  window.addEventListener('bwbr-sync-token-bindings', () => {
    _readBindingsFromDOM();
  });

  // ================================================================
  //  토큰 바인딩: 패널 속성으로 roomItem 식별
  //  bwbr-identify-panel (DOM attr: data-bwbr-panel-props)
  //  → bwbr-panel-identified (DOM attr: data-bwbr-panel-result)
  // ================================================================
  document.addEventListener('bwbr-identify-panel', () => {
    const el = document.documentElement;
    const raw = el.getAttribute('data-bwbr-panel-props');
    el.removeAttribute('data-bwbr-panel-props');

    const respond = (data) => {
      el.setAttribute('data-bwbr-panel-result', JSON.stringify(data));
      document.dispatchEvent(new CustomEvent('bwbr-panel-identified'));
    };

    try {
      const props = JSON.parse(raw);
      if (!reduxStore) return respond({ success: false });

      const state = reduxStore.getState();
      const ri = state.entities?.roomItems;
      if (!ri?.ids) return respond({ success: false });

      // ── 방법 1: imageUrl 정확 매칭 ──
      const trackedUrl = props._trackedImageUrl || '';
      const trackedPos = props._trackedPosition || null;
      if (trackedUrl) {
        function extractPath(url) {
          try { return new URL(url).pathname; } catch (e) { return url; }
        }
        const trackedPath = extractPath(trackedUrl);

        // 같은 이미지의 패널이 여러 개일 수 있으므로 모두 수집
        const imageMatches = [];
        for (const id of ri.ids) {
          const item = ri.entities?.[id];
          if (!item || !item.imageUrl) continue;
          if (item.imageUrl === trackedUrl || extractPath(item.imageUrl) === trackedPath) {
            imageMatches.push(item);
          }
        }

        if (imageMatches.length === 1) {
          // 유일 매칭
          const item = imageMatches[0];
          console.log(`%c[CE]%c 패널 식별 (imageUrl 유일): "${item._id}"`,
            'color: #ab47bc; font-weight: bold;', 'color: inherit;');
          return respond({ success: true, panelId: item._id, imageUrl: item.imageUrl });
        } else if (imageMatches.length > 1 && trackedPos) {
          // 같은 이미지 여러 개 → 위치로 구분
          // DOM translate()는 픽셀, Redux x/y는 네이티브 셀 단위 (1셀 = 24px)
          const NATIVE_CELL = 24;
          const trkX = trackedPos.x / NATIVE_CELL;
          const trkY = trackedPos.y / NATIVE_CELL;
          console.log(`%c[CE]%c 패널 위치 변환: DOM(${trackedPos.x}, ${trackedPos.y})px → native(${trkX.toFixed(1)}, ${trkY.toFixed(1)}) (24px/cell)`,
            'color: #ab47bc; font-weight: bold;', 'color: inherit;');

          let closest = null;
          let closestDist = Infinity;
          for (const item of imageMatches) {
            const ix = item.x ?? 0;
            const iy = item.y ?? 0;
            const dx = ix - trkX;
            const dy = iy - trkY;
            const dist = dx * dx + dy * dy;
            console.log(`%c[CE]%c   후보: "${item._id}" pos=(${ix}, ${iy}) dist=${Math.sqrt(dist).toFixed(1)}`,
              'color: #ab47bc; font-weight: bold;', 'color: inherit;');
            if (dist < closestDist) {
              closestDist = dist;
              closest = item;
            }
          }
          if (closest) {
            console.log(`%c[CE]%c 패널 식별 (imageUrl+위치): "${closest._id}" (${imageMatches.length}개 중, dist=${Math.sqrt(closestDist).toFixed(1)})`,
              'color: #ab47bc; font-weight: bold;', 'color: inherit;');
            return respond({ success: true, panelId: closest._id, imageUrl: closest.imageUrl });
          }
        } else if (imageMatches.length > 1) {
          console.log(`%c[CE]%c 같은 imageUrl ${imageMatches.length}개, 위치 정보 없음 → 스코어링 폴백`,
            'color: #ab47bc; font-weight: bold;', 'color: inherit;');
        }

        if (imageMatches.length === 0) {
          console.log(`%c[CE]%c imageUrl 매칭 실패, 스코어링 폴백`,
            'color: #ab47bc; font-weight: bold;', 'color: inherit;');
        }
      }

      // ── 방법 2: 속성 스코어링 (폴백) ──
      let bestMatch = null;
      let bestScore = 0;

      for (const id of ri.ids) {
        const item = ri.entities?.[id];
        if (!item) continue;

        let score = 0;
        if (String(item.width ?? '') === String(props.width ?? '')) score += 2;
        if (String(item.height ?? '') === String(props.height ?? '')) score += 2;
        if (String(item.z ?? 0) === String(props.z ?? 0)) score += 1;
        if ((item.memo || '') === (props.memo || '')) score += 3;
        if ((item.clickAction || 'none') === (props.clickAction || 'none')) score += 1;
        const pLocked = props.locked === true || props.locked === 'on';
        const pFreezed = props.freezed === true || props.freezed === 'on';
        const pPlane = props.plane === true || props.plane === 'on';
        if (Boolean(item.locked) === pLocked) score += 1;
        if (Boolean(item.freezed) === pFreezed) score += 1;
        if ((item.type === 'plane') === pPlane) score += 1;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = item;
        }
      }

      if (bestMatch && bestScore >= 8) {
        console.log(`%c[CE]%c 패널 식별 (스코어링): "${bestMatch._id}" (점수 ${bestScore}/12)`,
          'color: #ab47bc; font-weight: bold;', 'color: inherit;');
        respond({ success: true, panelId: bestMatch._id, imageUrl: bestMatch.imageUrl || '' });
      } else {
        console.log(`%c[CE]%c 패널 식별 실패 (최고 점수 ${bestScore}/12)`,
          'color: #ab47bc; font-weight: bold;', 'color: inherit;');
        respond({ success: false });
      }
    } catch (e) {
      respond({ success: false });
    }
  });

  // ================================================================
  //  전투 이동: 토큰 imageUrl로 roomItem → 캐릭터 데이터 조회
  //  bwbr-request-char-for-move (DOM attr: data-bwbr-move-imageurl)
  //  → bwbr-char-move-data { success, item, char }
  //  ★ 바인딩 맵을 우선 확인, 없으면 memo 〔이름〕 폴백
  // ================================================================
  // ================================================================
  //  [COMBAT] 전투 이동 (bwbr-request-char-for-move, bwbr-move-item)
  // ================================================================
  window.addEventListener('bwbr-request-char-for-move', () => {
    const el = document.documentElement;
    // 새 형식: JSON { imageUrl, position } / 구 형식: 문자열 imageUrl
    const rawPayload = el.getAttribute('data-bwbr-move-payload') || el.getAttribute('data-bwbr-move-imageurl') || '';
    el.removeAttribute('data-bwbr-move-payload');
    el.removeAttribute('data-bwbr-move-imageurl');

    let imageUrl = '';
    let clickPos = null;
    try {
      const parsed = JSON.parse(rawPayload);
      imageUrl = parsed.imageUrl || '';
      clickPos = parsed.position || null;
    } catch {
      imageUrl = rawPayload;
    }

    console.log(`[Branch Move MAIN] 요청 수신: imageUrl=${imageUrl ? imageUrl.substring(0, 60) + '...' : 'EMPTY'}, clickPos=${clickPos ? `(${clickPos.x}, ${clickPos.y})` : 'NULL'}, rawLen=${rawPayload.length}`);

    const fail = () => {
      document.documentElement.setAttribute('data-bwbr-char-move-result', JSON.stringify({ success: false }));
      window.dispatchEvent(new CustomEvent('bwbr-char-move-data'));
    };

    if (!imageUrl || !reduxStore) return fail();

    const state = reduxStore.getState();
    const ri = state.entities?.roomItems;
    if (!ri?.ids) return fail();

    // URL 경로 추출 (쿼리 파라미터 제거)
    function extractPath(url) {
      try { return new URL(url).pathname; } catch (e) { return url; }
    }
    const clickedPath = extractPath(imageUrl);

    // 1) roomItems에서 imageUrl 매칭 — 같은 이미지가 여러 개일 수 있으므로 모두 수집
    const imageMatches = [];
    for (const id of ri.ids) {
      const it = ri.entities?.[id];
      if (!it || !it.active) continue;
      if (!it.imageUrl) continue;
      if (it.imageUrl === imageUrl || extractPath(it.imageUrl) === clickedPath) {
        imageMatches.push(it);
      }
    }

    let item = null;
    if (imageMatches.length === 1) {
      item = imageMatches[0];
    } else if (imageMatches.length > 1 && clickPos) {
      // 같은 이미지 여러 개 → DOM 위치(픽셀)을 네이티브 셀 단위로 변환하여 가장 가까운 것 선택
      const NATIVE_CELL = 24;
      const trkX = clickPos.x / NATIVE_CELL;
      const trkY = clickPos.y / NATIVE_CELL;
      console.log(`[Branch Move] 위치 변환: DOM(${clickPos.x}, ${clickPos.y})px → native(${trkX.toFixed(1)}, ${trkY.toFixed(1)})`);
      let closestDist = Infinity;
      for (const it of imageMatches) {
        const ix = it.x ?? 0, iy = it.y ?? 0;
        const dx = ix - trkX, dy = iy - trkY;
        const dist = dx * dx + dy * dy;
        console.log(`[Branch Move]   후보: "${it._id}" pos=(${ix}, ${iy}) dist=${Math.sqrt(dist).toFixed(1)}`);
        if (dist < closestDist) {
          closestDist = dist;
          item = it;
        }
      }
      console.log(`[Branch Move] 선택: "${item?._id}" (${imageMatches.length}개 중, dist=${Math.sqrt(closestDist).toFixed(1)})`);
    } else if (imageMatches.length > 1) {
      // 위치 정보 없으면 첫 번째 (레거시 폴백)
      item = imageMatches[0];
      console.log(`[Branch Move] 같은 imageUrl ${imageMatches.length}개, 위치 정보 없음 → 첫 번째 선택`);
    }

    if (!item) {
      console.log(`[Branch Move] roomItem imageUrl 매칭 실패: "${imageUrl.substring(0, 80)}..."`);
      return fail();
    }

    // ── 성공 응답 헬퍼 (DOM 속성 브릿지 — MAIN→ISOLATED 크로스-월드 안정성) ──
    const succeed = (charObj) => {
      console.log(`[Branch Move] 매칭: item "${item._id}" → 캐릭터 "${charObj.name}"`);
      const result = {
        success: true,
        item: {
          _id: item._id,
          x: item.x ?? 0,
          y: item.y ?? 0,
          width: item.width ?? 4,
          height: item.height ?? 4
        },
        char: {
          _id: charObj._id,
          name: charObj.name || '',
          iconUrl: charObj.iconUrl || '',
          color: charObj.color || '#e0e0e0',
          params: charObj.params || [],
          commands: charObj.commands || ''
        }
      };
      document.documentElement.setAttribute('data-bwbr-char-move-result', JSON.stringify(result));
      window.dispatchEvent(new CustomEvent('bwbr-char-move-data'));
    };

    const rc = state.entities?.roomCharacters;

    // 2) ★ 바인딩 맵 우선 확인 (매번 DOM에서 fresh read)
    _readBindingsFromDOM();
    const boundCharId = _tokenBindings[item._id];
    if (boundCharId) {
      console.log(`[Branch Move] 바인딩 확인: item "${item._id}" → charId "${boundCharId}"`);
    } else {
      console.log(`[Branch Move] 바인딩 없음 (item "${item._id}"), 토큰 수: ${Object.keys(_tokenBindings).length}`);
    }
    if (boundCharId && rc?.ids) {
      for (const id of rc.ids) {
        const ch = rc.entities?.[id];
        if (ch && (ch._id === boundCharId || id === boundCharId)) {
          console.log(`[Branch Move] 바인딩으로 매칭: "${item._id}" → "${ch.name}"`);
          return succeed(ch);
        }
      }
      console.log(`[Branch Move] 바인딩 캐릭터 "${boundCharId}" 미발견 — memo 폴백`);
    }

    // 3) memo에서 〔캐릭터이름〕 파싱 (폴백)
    const memo = item.memo || '';
    const nameMatch = memo.match(/〔(.+?)〕/);
    if (!nameMatch) {
      console.log(`[Branch Move] memo에 〔이름〕 없음: "${memo}"`);
      return fail();
    }
    const charName = nameMatch[1].trim();

    // 4) roomCharacters에서 이름 매칭
    let found = null;
    if (rc?.ids) {
      for (const id of rc.ids) {
        const ch = rc.entities?.[id];
        if (ch?.name === charName || ch?.name?.includes(charName)) {
          found = ch; break;
        }
      }
    }
    if (!found) {
      console.log(`[Branch Move] 캐릭터 "${charName}" 미발견`);
      return fail();
    }

    succeed(found);
  });

  // ================================================================
  //  전투 이동: 아이템(스크린 패널) 위치 이동 (Firestore 쓰기)
  //  bwbr-move-item { itemId, x, y }
  //  → bwbr-move-item-result { success }
  // ================================================================
  window.addEventListener('bwbr-move-item', async () => {
    const el = document.documentElement;
    const raw = el.getAttribute('data-bwbr-move-item');
    el.removeAttribute('data-bwbr-move-item');
    const { itemId, x, y } = raw ? JSON.parse(raw) : {};
    const respond = (detail) => {
      el.setAttribute('data-bwbr-move-item-result', JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent('bwbr-move-item-result'));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const itemsCol = sdk.collection(sdk.db, 'rooms', roomId, 'items');
      const itemRef = sdk.doc(itemsCol, itemId);
      await sdk.setDoc(itemRef, { x, y, updatedAt: Date.now() }, { merge: true });

      console.log(`%c[CE]%c ✅ 아이템 이동: ${itemId} → (${x}, ${y})`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
      respond({ success: true, itemId, x, y });
    } catch (err) {
      console.error('[CE] 아이템 이동 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  트리거: 패널(아이템) 조작 — 이동/회전/복사/삭제/생성
  //  bwbr-trigger-panel-op  { op, target, panelType, ... }
  //  → bwbr-trigger-panel-op-result { success }
  //
  //  target: 〔태그〕 형식의 메모 태그로 패널 식별 (예: target="문A" → memo에 〔문A〕포함)
  //  panelType: 'object'(스크린) | 'plane'(마커) — create 시 필수, 기존 조작 시 검색 필터
  //  op: 'move' | 'rotate' | 'copy' | 'delete' | 'create'
  // ================================================================
  // ================================================================
  //  [TRIGGER] 패널 조작 (bwbr-trigger-panel-op, bwbr-request-panel-tags)
  // ================================================================
  window.addEventListener('bwbr-trigger-panel-op', async (e) => {
    const _raw = document.documentElement.getAttribute('data-bwbr-trigger-panel-op');
    document.documentElement.removeAttribute('data-bwbr-trigger-panel-op');
    const detail = _raw ? JSON.parse(_raw) : (e.detail || {});
    const { op, target, panelType } = detail;

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-trigger-panel-op-result', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-trigger-panel-op-result', { detail: d }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const itemsCol = sdk.collection(sdk.db, 'rooms', roomId, 'items');

      // ── create는 기존 패널 검색 불필요 ──
      if (op === 'create') {
        const tgt = (target || '').trim();
        const pt = panelType === 'plane' ? 'plane' : 'object';
        let memo = tgt ? '〔' + tgt + '〕' : '';
        if (detail.description) memo += (memo ? '\n' : '') + detail.description;
        const newItem = {
          type: pt,
          active: true,
          visible: true,
          closed: false,
          locked: false,
          freezed: false,
          withoutOwner: false,
          memo: memo,
          imageUrl: detail.imageUrl || '',
          coverImageUrl: '',
          x: detail.x != null ? detail.x : 0,
          y: detail.y != null ? detail.y : 0,
          z: 0,
          width: detail.width != null ? detail.width : (pt === 'object' ? 4 : 2),
          height: detail.height != null ? detail.height : (pt === 'object' ? 4 : 2),
          angle: detail.angle != null ? detail.angle : 0,
          owner: '',
          ownerName: '',
          ownerColor: '',
          clickAction: null,
          deckId: null,
          order: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        await sdk.addDoc(itemsCol, newItem);
        _dbg(`%c[CE]%c ✅ 패널 생성: 〔${tgt}〕 (${pt})`,
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
        respond({ success: true, op, target: tgt, panelType: pt });
        return;
      }

      // --- 기존 패널 검색: 〔tag〕 형식 매칭 ---
      const items = state.entities?.roomItems;
      if (!items || !items.ids || items.ids.length === 0) throw new Error('패널 없음');

      let found = null;
      const tgt = (target || '').trim();
      if (!tgt) throw new Error('패널 식별자(target)가 비어있음');

      const tagStr = '〔' + tgt + '〕';

      // 1) 〔tag〕 형식으로 memo 검색 (panelType 필터 적용)
      for (const id of items.ids) {
        const it = items.entities[id];
        if (!it) continue;
        if (panelType && it.type !== panelType) continue;
        if ((it.memo || '').includes(tagStr)) {
          found = { ...it, __id: id };
          break;
        }
      }

      // 2) 폴백: memo 부분 일치 (하위 호환)
      if (!found) {
        for (const id of items.ids) {
          const it = items.entities[id];
          if (!it) continue;
          if (panelType && it.type !== panelType) continue;
          if ((it.memo || '').includes(tgt)) {
            found = { ...it, __id: id };
            break;
          }
        }
      }

      // 3) _id 직접 매칭 (마지막 폴백)
      if (!found && items.entities[tgt]) {
        found = { ...items.entities[tgt], __id: tgt };
      }

      if (!found) throw new Error(`패널 "${tgt}" 을(를) 찾을 수 없음`);

      const itemRef = sdk.doc(itemsCol, found.__id);

      switch (op) {
        // ── 이동 ──
        case 'move': {
          let nx, ny;
          if (detail.relative) {
            nx = (found.x || 0) + (detail.x || 0);
            ny = (found.y || 0) + (detail.y || 0);
          } else {
            nx = detail.x != null ? detail.x : (found.x || 0);
            ny = detail.y != null ? detail.y : (found.y || 0);
          }
          await sdk.setDoc(itemRef, { x: nx, y: ny, updatedAt: Date.now() }, { merge: true });
          _dbg(`%c[CE]%c ✅ 패널 이동: 〔${tgt}〕 → (${nx}, ${ny})`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, op, target: tgt, x: nx, y: ny });
          break;
        }

        // ── 회전 ──
        case 'rotate': {
          let angle;
          if (detail.relative) {
            angle = (found.angle || 0) + (detail.angle || 0);
          } else {
            angle = detail.angle != null ? detail.angle : 0;
          }
          await sdk.setDoc(itemRef, { angle, updatedAt: Date.now() }, { merge: true });
          _dbg(`%c[CE]%c ✅ 패널 회전: 〔${tgt}〕 → ${angle}°`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, op, target: tgt, angle });
          break;
        }

        // ── 복사 ──
        case 'copy': {
          const clone = { ...found };
          delete clone.__id;
          delete clone._id;
          clone.x = (clone.x || 0) + (detail.offsetX != null ? detail.offsetX : 50);
          clone.y = (clone.y || 0) + (detail.offsetY != null ? detail.offsetY : 50);
          clone.createdAt = Date.now();
          clone.updatedAt = Date.now();
          await sdk.addDoc(itemsCol, clone);
          _dbg(`%c[CE]%c ✅ 패널 복사: 〔${tgt}〕 (오프셋 ${clone.x - (found.x||0)}, ${clone.y - (found.y||0)})`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, op, target: tgt });
          break;
        }

        // ── 삭제 ──
        case 'delete': {
          await sdk.deleteDoc(itemRef);
          _dbg(`%c[CE]%c ✅ 패널 삭제: 〔${tgt}〕`,
            'color: #f44336; font-weight: bold;', 'color: inherit;');
          respond({ success: true, op, target: tgt });
          break;
        }

        // ── 메모 변경 ──
        case 'memo': {
          // 기존 태그는 유지하고 메모 내용만 변경
          const oldMemo = found.memo || '';
          const tagMatch = oldMemo.match(/〔[^〕]+〕/);
          const tagPart = tagMatch ? tagMatch[0] : '';
          const newMemo = tagPart ? tagPart + '\n' + (detail.memo || '') : (detail.memo || '');
          await sdk.setDoc(itemRef, { memo: newMemo, updatedAt: Date.now() }, { merge: true });
          _dbg(`%c[CE]%c ✅ 패널 메모 변경: 〔${tgt}〕`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, op, target: tgt });
          break;
        }

        default:
          throw new Error(`알 수 없는 패널 연산: ${op}`);
      }

    } catch (err) {
      console.error(`[CE] 패널 조작(${op}) 실패:`, err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  트리거 UI: 패널 태그 목록 요청
  //  bwbr-request-panel-tags → bwbr-panel-tags-data
  //  memo에 〔태그〕형식이 있는 패널 목록 반환
  // ================================================================
  window.addEventListener('bwbr-request-panel-tags', () => {
    const panels = [];
    if (reduxStore) {
      const state = reduxStore.getState();
      const ri = state.entities?.roomItems;
      if (ri?.ids) {
        const tagRe = /〔([^〕]+)〕/;
        for (const id of ri.ids) {
          const it = ri.entities?.[id];
          if (!it) continue;
          const m = (it.memo || '').match(tagRe);
          const tag = m ? m[1] : '';
          panels.push({
            _id: it._id || id,
            tag: tag,
            type: it.type || 'object',  // 'object'=스크린, 'plane'=마커
            memo: it.memo || '',
            imageUrl: it.imageUrl || ''
          });
        }
      }
    }
    document.documentElement.setAttribute('data-bwbr-panel-tags-data', JSON.stringify({ panels }));
    window.dispatchEvent(new CustomEvent('bwbr-panel-tags-data', { detail: { panels } }));
  });

  // ================================================================
  //  패널 관리: 패널 목록 요청
  //  bwbr-request-panel-list → bwbr-panel-list-data
  //  전체 아이템 목록 반환 (type 필터 없음 — 패널 목록은 모든 type 표시)
  // ================================================================
  window.addEventListener('bwbr-request-panel-list', () => {
    const raw = document.documentElement.getAttribute('data-bwbr-request-panel-list');
    document.documentElement.removeAttribute('data-bwbr-request-panel-list');

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-panel-list-data', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-panel-list-data'));
    };

    if (!reduxStore) return respond({ items: [] });
    const state = reduxStore.getState();
    const ri = state.entities?.roomItems;
    if (!ri?.ids) return respond({ items: [] });

    const items = ri.ids
      .map(id => ri.entities[id])
      .filter(it => !!it)
      .sort((a, b) => {
        // ccfolia 패널 목록과 동일한 정렬: order ASC → createdAt ASC → _id ASC
        const oa = a.order ?? 0, ob = b.order ?? 0;
        if (oa !== ob) return oa - ob;
        const ca = a.createdAt || 0, cb = b.createdAt || 0;
        if (ca !== cb) return ca - cb;
        return (a._id || '').localeCompare(b._id || '');
      })
      .map(it => ({
        _id:       it._id,
        type:      it.type,
        imageUrl:  it.imageUrl || '',
        memo:      it.memo || '',
        visible:   !!it.visible,
        active:    !!it.active,
        locked:    !!it.locked,
        closed:    !!it.closed,
        withoutOwner: !!it.withoutOwner,
        order:     it.order ?? 0,
        x:         it.x ?? 0,
        y:         it.y ?? 0,
        z:         it.z ?? 0,
        width:     it.width ?? 0,
        height:    it.height ?? 0,
        angle:     it.angle ?? 0,
        owner:     it.owner || '',
        createdAt: it.createdAt || 0
      }));

    respond({ items });
  });

  // ================================================================
  //  패널 관리: 일괄 조작
  //  bwbr-panel-batch-op → bwbr-panel-batch-op-result
  //  op: 'toggleVisible' | 'delete' | 'toggleActive' | 'reorder'
  // ================================================================
  function _panelBatchHandler() {
    const raw = document.documentElement.getAttribute('data-bwbr-panel-batch-op');
    if (!raw) return;  // 이미 소비됨 (중복 호출 방지)
    document.documentElement.removeAttribute('data-bwbr-panel-batch-op');
    const { op, ids, updates } = JSON.parse(raw);
    _panelBatchHandlerAsync(op, ids, updates);
  }
  window.addEventListener('bwbr-panel-batch-op', _panelBatchHandler);
  document.addEventListener('bwbr-panel-batch-op', _panelBatchHandler);
  async function _panelBatchHandlerAsync(op, ids, updates) {

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-panel-batch-op-result', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-panel-batch-op-result'));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const itemsCol = sdk.collection(sdk.db, 'rooms', roomId, 'items');
      let count = 0;

      switch (op) {
        case 'toggleVisible': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const ops = [];
          for (const id of ids) {
            const item = state.entities?.roomItems?.entities?.[id];
            if (!item) continue;
            const ref = sdk.doc(itemsCol, id);
            ops.push({ type: 'set', ref, data: { visible: item.visible === false, updatedAt: Date.now() }, options: { merge: true } });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 표시 전환`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'delete': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          if (!sdk.deleteDoc) throw new Error('deleteDoc 함수 없음 — _FS_CONFIG.fsKeys.deleteDoc 키 확인 필요');
          const ops = [];
          for (const id of ids) {
            ops.push({ type: 'delete', ref: sdk.doc(itemsCol, id) });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 삭제`,
            'color: #f44336; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'toggleActive': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const ops = [];
          for (const id of ids) {
            const item = state.entities?.roomItems?.entities?.[id];
            if (!item) continue;
            const ref = sdk.doc(itemsCol, id);
            ops.push({ type: 'set', ref, data: { active: !item.active, updatedAt: Date.now() }, options: { merge: true } });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 활성 전환`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'reorder': {
          if (!updates?.length) throw new Error('순서 데이터 없음');
          const ops = [];
          for (const { id, order } of updates) {
            ops.push({ type: 'set', ref: sdk.doc(itemsCol, id), data: { order, updatedAt: Date.now() }, options: { merge: true } });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 순서 변경`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'duplicate': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const ops = [];
          for (const id of ids) {
            const item = state.entities?.roomItems?.entities?.[id];
            if (!item) continue;
            const newRef = sdk.doc(itemsCol);
            const copy = {};
            for (const k of Object.keys(item)) {
              if (k === '_id') continue;
              copy[k] = item[k];
            }
            copy.createdAt = Date.now();
            copy.updatedAt = Date.now();
            ops.push({ type: 'set', ref: newRef, data: copy });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 복제`,
            'color: #2196f3; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        // ── 다중 선택: 일괄 이동 (상대 좌표) ──
        case 'move': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const dx = updates?.dx || 0;
          const dy = updates?.dy || 0;
          const moveOps = [];
          for (const id of ids) {
            const item = state.entities?.roomItems?.entities?.[id];
            if (!item) continue;
            moveOps.push({
              type: 'set',
              ref: sdk.doc(itemsCol, id),
              data: { x: (item.x || 0) + dx, y: (item.y || 0) + dy, updatedAt: Date.now() },
              options: { merge: true }
            });
          }
          count = await _batchCommit(sdk, moveOps);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 이동 (dx:${dx}, dy:${dy})`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        // ── 다중 선택: 위치 고정 토글 ──
        case 'lock': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const lockOps = [];
          for (const id of ids) {
            const item = state.entities?.roomItems?.entities?.[id];
            if (!item) continue;
            lockOps.push({
              type: 'set',
              ref: sdk.doc(itemsCol, id),
              data: { locked: !item.locked, updatedAt: Date.now() },
              options: { merge: true }
            });
          }
          count = await _batchCommit(sdk, lockOps);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 위치 고정 전환`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        // ── 다중 선택: 공개 상태 설정 ──
        // updates.mode: 'public' | 'private' | 'self' | 'except-self'
        // ★ 네이티브 ccfolia 진단 결과 (2025-06 확인):
        //   전체 공개:   closed=false, withoutOwner=false, owner=null, ownerName=null
        //   비공개:      closed=true (+ withoutOwner=false)
        //   자신만 보기: closed=true, owner=uid, ownerName=charName
        //   자신 외 공개: closed=true, withoutOwner=true, owner=uid, ownerName=charName
        case 'setVisibility': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const mode = updates?.mode;
          const visOps = [];
          const currentUid = state.app?.state?.uid || state.app?.user?.uid || '';

          // ownerName 취득: speaking 캐릭터 → room member → 폴백
          let ownerName = '';
          const rc = state.entities?.roomCharacters;
          if (rc?.ids) {
            for (const cid of rc.ids) {
              const ch = rc.entities?.[cid];
              if (ch?.speaking) { ownerName = ch.name || ''; break; }
            }
          }
          if (!ownerName) {
            // room member 이름 폴백
            const members = state.app?.room?.members;
            if (members?.entities?.[currentUid]) {
              ownerName = members.entities[currentUid].name || '';
            }
          }
          if (!ownerName) {
            // roomMembers entity 폴백
            const rm = state.entities?.roomMembers;
            if (rm?.entities?.[currentUid]) {
              ownerName = rm.entities[currentUid].name || rm.entities[currentUid].displayName || '';
            }
          }

          _dbg(`[CE VIS] mode=${mode} uid=${currentUid} ownerName="${ownerName}"`);

          for (const id of ids) {
            let fields = { updatedAt: Date.now() };
            switch (mode) {
              case 'public':
                fields.closed = false;
                fields.withoutOwner = false;
                fields.owner = null;
                fields.ownerName = null;
                break;
              case 'private':
                fields.closed = true;
                fields.withoutOwner = false;
                break;
              case 'self':
                fields.closed = true;
                fields.owner = currentUid;
                fields.ownerName = ownerName;
                break;
              case 'except-self':
                // ★ 네이티브: closed=true, withoutOwner=true, owner=uid, ownerName=charName
                fields.closed = true;
                fields.withoutOwner = true;
                fields.owner = currentUid;
                fields.ownerName = ownerName;
                break;
              default: continue;
            }
            visOps.push({
              type: 'update',
              ref: sdk.doc(itemsCol, id),
              data: fields
            });
          }
          _dbg(`[CE VIS] 쓰기 데이터:`, visOps[0]?.data);
          count = await _batchCommit(sdk, visOps);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 공개 상태 → ${mode} (uid=${currentUid}, ownerName=${ownerName})`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        // ── 다중 선택: 일괄 회전 (상대 각도) ──
        case 'rotate': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const angleDelta = updates?.angle || 90;
          const rotOps = [];
          for (const id of ids) {
            const item = state.entities?.roomItems?.entities?.[id];
            if (!item) continue;
            rotOps.push({
              type: 'set',
              ref: sdk.doc(itemsCol, id),
              data: { angle: ((item.angle || 0) + angleDelta) % 360, updatedAt: Date.now() },
              options: { merge: true }
            });
          }
          count = await _batchCommit(sdk, rotOps);
          _dbg(`%c[CE]%c ✅ 패널 ${count}개 회전 (${angleDelta}°)`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        default:
          throw new Error(`알 수 없는 배치 작업: ${op}`);
      }

    } catch (err) {
      console.error(`[CE] 패널 배치 작업(${op}) 실패:`, err.message);
      respond({ success: false, error: err.message });
    }
  }

  // ================================================================
  //  다중 선택: 아이템 공개 필드 진단
  //  bwbr-ms-inspect-item → bwbr-ms-inspect-item-result
  //  { itemId } → { visible, closed, withoutOwner, owner, active, locked, ... }
  // ================================================================
  window.addEventListener('bwbr-ms-inspect-item', () => {
    const el = document.documentElement;
    const raw = el.getAttribute('data-bwbr-ms-inspect-item');
    el.removeAttribute('data-bwbr-ms-inspect-item');
    const { itemId } = raw ? JSON.parse(raw) : {};
    const respond = (d) => {
      el.setAttribute('data-bwbr-ms-inspect-item-result', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-ms-inspect-item-result'));
    };
    if (!reduxStore || !itemId) return respond({ error: 'no store or id' });
    const state = reduxStore.getState();
    const it = state.entities?.roomItems?.entities?.[itemId];
    if (!it) return respond({ error: 'item not found: ' + itemId });
    const uid = state.app?.state?.uid || state.app?.user?.uid || '';
    respond({
      _id: it._id, type: it.type,
      visible: it.visible, closed: it.closed,
      withoutOwner: it.withoutOwner, owner: it.owner,
      active: it.active, locked: it.locked,
      currentUid: uid
    });
  });

  // ================================================================
  //  가시성 필드 변경 모니터링 (진단용)
  //  bwbr-vis-monitor-start → 감시 시작 (Redux subscribe)
  //  bwbr-vis-monitor-stop  → 감시 중지
  //  변경 감지 시 → bwbr-vis-change (data-bwbr-vis-change)
  // ================================================================
  let _visMonitorUnsub = null;
  window.addEventListener('bwbr-vis-monitor-start', () => {
    if (_visMonitorUnsub) { _visMonitorUnsub(); _visMonitorUnsub = null; }
    if (!reduxStore) { console.error('[CE VIS-MON] Redux store 없음'); return; }
    const FIELDS = ['visible','closed','withoutOwner','owner','active','locked','freezed','ownerName'];
    let prev = {};
    function snap() {
      const ri = reduxStore.getState().entities?.roomItems;
      if (!ri?.ids) return {};
      const s = {};
      for (const id of ri.ids) {
        const it = ri.entities[id];
        if (!it) continue;
        const f = {};
        for (const k of FIELDS) f[k] = it[k];
        s[id] = f;
      }
      return s;
    }
    prev = snap();
    const uid = reduxStore.getState().app?.state?.uid || reduxStore.getState().app?.user?.uid || '';
    console.log('%c[CE VIS-MON]%c ✅ 감시 시작 — roomItems ' + Object.keys(prev).length + '개, uid=' + uid,
      'color:#ff9800;font-weight:bold', 'color:inherit');
    _visMonitorUnsub = reduxStore.subscribe(() => {
      const cur = snap();
      for (const id in cur) {
        if (!prev[id]) continue;
        const changes = {};
        for (const k of FIELDS) {
          if (prev[id][k] !== cur[id][k]) changes[k] = { from: prev[id][k], to: cur[id][k] };
        }
        if (Object.keys(changes).length > 0) {
          console.log('%c═══ 필드 변경 감지 ═══', 'color:#ff9800;font-weight:bold;font-size:14px');
          console.log('아이템 ID:', id);
          for (const [k, v] of Object.entries(changes)) {
            console.log('  %c' + k + '%c: %c' + JSON.stringify(v.from) + '%c → %c' + JSON.stringify(v.to),
              'color:#2196f3;font-weight:bold', 'color:inherit',
              'color:#f44336', 'color:inherit', 'color:#4caf50');
          }
          // bridge로도 전달
          const el = document.documentElement;
          el.setAttribute('data-bwbr-vis-change', JSON.stringify({ id, changes }));
          window.dispatchEvent(new CustomEvent('bwbr-vis-change'));
        }
      }
      prev = cur;
    });
  });
  window.addEventListener('bwbr-vis-monitor-stop', () => {
    if (_visMonitorUnsub) { _visMonitorUnsub(); _visMonitorUnsub = null; }
    console.log('[CE VIS-MON] 감시 종료');
  });

  // ================================================================
  //  Firestore 쓰기 인터셉터 (네이티브 ccfolia 동작 진단)
  //  콘솔에서: window.dispatchEvent(new CustomEvent('bwbr-fs-intercept-start'))
  //  종료:    window.dispatchEvent(new CustomEvent('bwbr-fs-intercept-stop'))
  //
  //  활성화 후 ccfolia 네이티브 UI로 아이템 공개 상태 변경하면
  //  실제 Firestore 쓰기 호출(WriteBatch.set/update, setDoc 등)이 로깅됨
  // ================================================================
  let _fsIntActive = false;
  let _fsIntCleanup = null;

  window.addEventListener('bwbr-fs-intercept-start', () => {
    if (_fsIntActive) { console.log('[CE FS-INT] 이미 활성화됨'); return; }
    const sdk = acquireFirestoreSDK();
    if (!sdk || !reduxStore) { console.error('[CE FS-INT] SDK 또는 Redux 없음'); return; }

    const cleanups = [];

    // ── 1. WriteBatch 프로토타입 패치 ──
    if (sdk.writeBatch) {
      try {
        const testBatch = sdk.writeBatch(sdk.db);
        const proto = Object.getPrototypeOf(testBatch);
        const origSet = proto.set, origUpdate = proto.update;

        proto.set = function(ref, data, options) {
          if (ref?.path?.includes('/items/')) {
            console.log('%c══ [FS-INT] WriteBatch.set ══', 'color:#e91e63;font-weight:bold;font-size:14px');
            console.log('  path:', ref.path);
            try { console.log('  data:', JSON.parse(JSON.stringify(data))); } catch(e) { console.log('  data (raw):', data); }
            console.log('  options:', options);
            console.trace('  콜스택');
          }
          return origSet.call(this, ref, data, options);
        };
        proto.update = function(ref, ...args) {
          if (ref?.path?.includes('/items/')) {
            console.log('%c══ [FS-INT] WriteBatch.update ══', 'color:#e91e63;font-weight:bold;font-size:14px');
            console.log('  path:', ref.path);
            try { console.log('  data:', JSON.parse(JSON.stringify(args))); } catch(e) { console.log('  data (raw):', args); }
            console.trace('  콜스택');
          }
          return origUpdate.call(this, ref, ...args);
        };
        cleanups.push(() => { proto.set = origSet; proto.update = origUpdate; });
        console.log('[CE FS-INT] WriteBatch 프로토타입 패치 ✅');
      } catch (e) { console.warn('[CE FS-INT] WriteBatch 패치 실패:', e.message); }
    }

    // ── 2. fsMod 내 setDoc 래핑 시도 ──
    try {
      const req = acquireWebpackRequire();
      if (req) {
        const fsMod = req(_FS_CONFIG.firestoreModId);
        if (fsMod) {
          const sdKey = _FS_CONFIG.fsKeys.setDoc;
          const origFn = fsMod[sdKey];
          if (typeof origFn === 'function') {
            const wrapper = function(...args) {
              if (args[0]?.path?.includes('/items/')) {
                console.log('%c══ [FS-INT] setDoc (모듈) ══', 'color:#9c27b0;font-weight:bold;font-size:14px');
                console.log('  path:', args[0].path);
                try { console.log('  data:', JSON.parse(JSON.stringify(args[1]))); } catch(e) { console.log('  data (raw):', args[1]); }
                console.log('  options:', args[2]);
                console.trace('  콜스택');
              }
              return origFn.apply(this, args);
            };
            try {
              Object.defineProperty(fsMod, sdKey, { get() { return wrapper; }, configurable: true });
              cleanups.push(() => { try { Object.defineProperty(fsMod, sdKey, { get() { return origFn; }, configurable: true }); } catch(e){} });
              console.log('[CE FS-INT] setDoc 래핑 ✅ (defineProperty)');
            } catch (e1) {
              try { fsMod[sdKey] = wrapper; cleanups.push(() => { fsMod[sdKey] = origFn; }); console.log('[CE FS-INT] setDoc 래핑 ✅ (직접 할당)'); }
              catch (e2) { console.log('[CE FS-INT] setDoc 래핑 실패 — webpack getter 보호:', e1.message); }
            }
          }
          // updateDoc도 탐색
          for (const [key, fn] of Object.entries(fsMod)) {
            if (typeof fn !== 'function' || key === sdKey) continue;
            const str = fn.toString();
            if (str.length < 500 && (str.includes('update') || str.includes('merge'))) {
              // updateDoc 후보 — 너무 많을 수 있으니 이름 힌트로 필터링
            }
          }
        }
      }
    } catch (e) { console.warn('[CE FS-INT] fsMod 패치 오류:', e.message); }

    // ── 3. Redux dispatch 래핑 (액션 추적) ──
    const origDispatch = reduxStore.dispatch;
    const wrappedDispatch = function(action) {
      if (action?.type) {
        const t = action.type.toLowerCase();
        if (t.includes('room') || t.includes('item') || t.includes('entity') || t.includes('visibility')) {
          console.log('%c[FS-INT] Redux dispatch%c', 'color:#2196f3;font-weight:bold', 'color:inherit',
            action.type, action.payload != null ? action.payload : '');
        }
      }
      return origDispatch.call(this, action);
    };
    reduxStore.dispatch = wrappedDispatch;
    cleanups.push(() => { reduxStore.dispatch = origDispatch; });

    // ── 4. vis-monitor도 자동 시작 ──
    window.dispatchEvent(new CustomEvent('bwbr-vis-monitor-start'));

    _fsIntActive = true;
    _fsIntCleanup = () => {
      for (const fn of cleanups) { try { fn(); } catch(e) {} }
      window.dispatchEvent(new CustomEvent('bwbr-vis-monitor-stop'));
      _fsIntActive = false;
      _fsIntCleanup = null;
    };

    console.log('%c═══════════════════════════════════════════════', 'color:#e91e63;font-size:14px');
    console.log('%c[CE FS-INT] ✅ Firestore 인터셉터 활성화', 'color:#e91e63;font-weight:bold;font-size:16px');
    console.log('%c═══════════════════════════════════════════════', 'color:#e91e63;font-size:14px');
    console.log('▶ 이제 아이템 하나를 우클릭 → 공개 상태 변경:');
    console.log('  1) 전체 공개 → 비공개');
    console.log('  2) 비공개 → 자신만 보기');
    console.log('  3) 자신만 보기 → 자신 외 공개');
    console.log('  4) 자신 외 공개 → 전체 공개');
    console.log('각 변경 사이 2초 기다린 후 전체 콘솔 로그를 복사해 공유해 주세요');
  });

  window.addEventListener('bwbr-fs-intercept-stop', () => {
    if (_fsIntCleanup) _fsIntCleanup();
    console.log('[CE FS-INT] 인터셉터 비활성화');
  });

  // ================================================================
  //  시나리오 텍스트(노트) 목록 조회
  //  bwbr-request-note-list → bwbr-note-list-data
  // ================================================================
  window.addEventListener('bwbr-request-note-list', () => {
    document.documentElement.removeAttribute('data-bwbr-request-note-list');

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-note-list-data', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-note-list-data'));
    };

    if (!reduxStore) return respond({ items: [] });
    const state = reduxStore.getState();
    const rn = state.entities?.roomNotes;
    if (!rn?.ids) return respond({ items: [] });

    const items = rn.ids
      .map(id => rn.entities[id])
      .filter(it => !!it)
      .map(it => ({
        _id:       it._id,
        name:      it.name || '',
        iconUrl:   it.iconUrl || '',
        order:     it.order ?? 0,
        createdAt: it.createdAt || 0
      }));

    respond({ items });
  });

  // ================================================================
  //  시나리오 텍스트(노트) 일괄 조작
  //  bwbr-note-batch-op → bwbr-note-batch-op-result
  //  op: 'delete'
  // ================================================================
  function _noteBatchHandler() {
    const raw = document.documentElement.getAttribute('data-bwbr-note-batch-op');
    if (!raw) return;
    document.documentElement.removeAttribute('data-bwbr-note-batch-op');
    const { op, ids } = JSON.parse(raw);
    _noteBatchHandlerAsync(op, ids);
  }
  window.addEventListener('bwbr-note-batch-op', _noteBatchHandler);
  document.addEventListener('bwbr-note-batch-op', _noteBatchHandler);
  async function _noteBatchHandlerAsync(op, ids) {

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-note-batch-op-result', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-note-batch-op-result'));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!sdk.deleteDoc) throw new Error('deleteDoc 함수 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const notesCol = sdk.collection(sdk.db, 'rooms', roomId, 'notes');
      let count = 0;

      switch (op) {
        case 'delete': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const ops = [];
          for (const id of ids) {
            ops.push({ type: 'delete', ref: sdk.doc(notesCol, id) });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 노트 ${count}개 삭제`,
            'color: #f44336; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }
        case 'duplicate': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const ops = [];
          for (const id of ids) {
            const note = state.entities?.roomNotes?.entities?.[id];
            if (!note) continue;
            const newRef = sdk.doc(notesCol);
            const copy = {};
            for (const k of Object.keys(note)) {
              if (k === '_id') continue;
              copy[k] = note[k];
            }
            copy.createdAt = Date.now();
            copy.updatedAt = Date.now();
            ops.push({ type: 'set', ref: newRef, data: copy });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 노트 ${count}개 복제`,
            'color: #2196f3; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }
        default:
          throw new Error(`알 수 없는 노트 배치 작업: ${op}`);
      }
    } catch (err) {
      console.error(`[CE] 노트 배치 작업(${op}) 실패:`, err.message);
      respond({ success: false, error: err.message });
    }
  }

  // ================================================================
  //  컷인(이펙트) 목록 조회 (ID 포함)
  //  bwbr-request-cutin-list → bwbr-cutin-list-data
  // ================================================================
  window.addEventListener('bwbr-request-cutin-list', () => {
    document.documentElement.removeAttribute('data-bwbr-request-cutin-list');

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-cutin-list-data', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-cutin-list-data'));
    };

    if (!reduxStore) return respond({ items: [] });
    const state = reduxStore.getState();
    const re = state.entities?.roomEffects;
    if (!re?.ids) return respond({ items: [] });

    const items = re.ids
      .map(id => re.entities[id])
      .filter(it => !!it)
      .map(it => ({
        _id:       it._id,
        name:      it.name || '',
        order:     it.order ?? 0,
        createdAt: it.createdAt || 0
      }));

    respond({ items });
  });

  // ================================================================
  //  컷인(이펙트) 일괄 조작
  //  bwbr-cutin-batch-op → bwbr-cutin-batch-op-result
  //  op: 'delete' | 'duplicate'
  // ================================================================
  function _cutinBatchHandler() {
    const raw = document.documentElement.getAttribute('data-bwbr-cutin-batch-op');
    if (!raw) return;
    document.documentElement.removeAttribute('data-bwbr-cutin-batch-op');
    const { op, ids } = JSON.parse(raw);
    console.log('[CE] [CutinBatch] op:', op, 'ids:', ids?.length);
    _cutinBatchHandlerAsync(op, ids);
  }
  window.addEventListener('bwbr-cutin-batch-op', _cutinBatchHandler);
  document.addEventListener('bwbr-cutin-batch-op', _cutinBatchHandler);
  async function _cutinBatchHandlerAsync(op, ids) {

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-cutin-batch-op-result', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-cutin-batch-op-result'));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const effectsCol = sdk.collection(sdk.db, 'rooms', roomId, 'effects');
      let count = 0;

      switch (op) {
        case 'delete': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          if (!sdk.deleteDoc) throw new Error('deleteDoc 함수 없음');
          const ops = [];
          for (const id of ids) {
            ops.push({ type: 'delete', ref: sdk.doc(effectsCol, id) });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 컷인 ${count}개 삭제`,
            'color: #f44336; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }
        case 'duplicate': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const ops = [];
          for (const id of ids) {
            const effect = state.entities?.roomEffects?.entities?.[id];
            if (!effect) continue;
            const newRef = sdk.doc(effectsCol);
            const copy = {};
            for (const k of Object.keys(effect)) {
              if (k === '_id') continue;
              copy[k] = effect[k];
            }
            copy.createdAt = Date.now();
            copy.updatedAt = Date.now();
            ops.push({ type: 'set', ref: newRef, data: copy });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 컷인 ${count}개 복제`,
            'color: #2196f3; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }
        default:
          throw new Error(`알 수 없는 컷인 배치 작업: ${op}`);
      }
    } catch (err) {
      console.error(`[CE] 컷인 배치 작업(${op}) 실패:`, err.message);
      respond({ success: false, error: err.message });
    }
  }

  // ================================================================
  //  캐릭터 목록 조회 (ID + 주요 속성 포함)
  //  bwbr-request-char-list → bwbr-char-list-data
  // ================================================================
  window.addEventListener('bwbr-request-char-list', () => {
    document.documentElement.removeAttribute('data-bwbr-request-char-list');

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-char-list-data', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-char-list-data'));
    };

    if (!reduxStore) return respond({ items: [] });
    const state = reduxStore.getState();
    const rc = state.entities?.roomCharacters;
    if (!rc?.ids) return respond({ items: [] });

    const items = rc.ids
      .map(id => rc.entities[id])
      .filter(it => !!it)
      .map(it => ({
        _id:        it._id,
        name:       it.name || '',
        iconUrl:    it.iconUrl || '',
        active:     !!it.active,
        invisible:  !!it.invisible,
        hideStatus: !!it.hideStatus,
        secret:     !!it.secret,
        initiative: it.initiative ?? 0,
        createdAt:  it.createdAt || 0
      }));

    respond({ items });
  });

  // ================================================================
  //  캐릭터 일괄 조작
  //  bwbr-char-batch-op → bwbr-char-batch-op-result
  //  op: 'toggleHideStatus' | 'toggleSecret' | 'toggleActive' | 'duplicate' | 'delete'
  // ================================================================
  function _charBatchHandler() {
    const raw = document.documentElement.getAttribute('data-bwbr-char-batch-op');
    if (!raw) return;
    document.documentElement.removeAttribute('data-bwbr-char-batch-op');
    const { op, ids } = JSON.parse(raw);
    console.log('[CE] [CharBatch] op:', op, 'ids:', ids?.length);
    _charBatchHandlerAsync(op, ids);
  }
  window.addEventListener('bwbr-char-batch-op', _charBatchHandler);
  document.addEventListener('bwbr-char-batch-op', _charBatchHandler);
  async function _charBatchHandlerAsync(op, ids) {

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-char-batch-op-result', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-char-batch-op-result'));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      let count = 0;

      switch (op) {
        case 'toggleHideStatus': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          for (const id of ids) {
            const ch = state.entities?.roomCharacters?.entities?.[id];
            if (!ch) continue;
            const ref = sdk.doc(charsCol, id);
            const fullDoc = {};
            for (const k of Object.keys(ch)) { if (k === '_id') continue; fullDoc[k] = ch[k]; }
            fullDoc.hideStatus = !ch.hideStatus;
            fullDoc.updatedAt = Date.now();
            try { await sdk.setDoc(ref, fullDoc); count++; } catch (e) { console.error(`[CE] toggleHideStatus 실패: ${ch.name}`, e); }
          }
          _dbg(`%c[CE]%c ✅ 캐릭터 ${count}개 목록 표시/숨김 전환`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'toggleSecret': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          for (const id of ids) {
            const ch = state.entities?.roomCharacters?.entities?.[id];
            if (!ch) continue;
            const ref = sdk.doc(charsCol, id);
            const fullDoc = {};
            for (const k of Object.keys(ch)) { if (k === '_id') continue; fullDoc[k] = ch[k]; }
            fullDoc.secret = !ch.secret;
            fullDoc.updatedAt = Date.now();
            try { await sdk.setDoc(ref, fullDoc); count++; } catch (e) { console.error(`[CE] toggleSecret 실패: ${ch.name}`, e); }
          }
          _dbg(`%c[CE]%c ✅ 캐릭터 ${count}개 스테이터스 공개/비공개 전환`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'toggleActive': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          for (const id of ids) {
            const ch = state.entities?.roomCharacters?.entities?.[id];
            if (!ch) continue;
            const ref = sdk.doc(charsCol, id);
            const fullDoc = {};
            for (const k of Object.keys(ch)) { if (k === '_id') continue; fullDoc[k] = ch[k]; }
            fullDoc.active = !ch.active;
            fullDoc.updatedAt = Date.now();
            try { await sdk.setDoc(ref, fullDoc); count++; } catch (e) { console.error(`[CE] toggleActive 실패: ${ch.name}`, e); }
          }
          _dbg(`%c[CE]%c ✅ 캐릭터 ${count}개 꺼내기/집어넣기 전환`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'duplicate': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          const ops = [];
          for (const id of ids) {
            const ch = state.entities?.roomCharacters?.entities?.[id];
            if (!ch) continue;
            const newRef = sdk.doc(charsCol);
            const copy = {};
            for (const k of Object.keys(ch)) {
              if (k === '_id') continue;
              copy[k] = ch[k];
            }
            copy.speaking = false;
            copy.createdAt = Date.now();
            copy.updatedAt = Date.now();
            ops.push({ type: 'set', ref: newRef, data: copy });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 캐릭터 ${count}개 복제`,
            'color: #2196f3; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        case 'delete': {
          if (!ids?.length) throw new Error('대상 ID 없음');
          if (!sdk.deleteDoc) throw new Error('deleteDoc 함수 없음');
          const ops = [];
          for (const id of ids) {
            ops.push({ type: 'delete', ref: sdk.doc(charsCol, id) });
          }
          count = await _batchCommit(sdk, ops);
          _dbg(`%c[CE]%c ✅ 캐릭터 ${count}개 삭제`,
            'color: #f44336; font-weight: bold;', 'color: inherit;');
          respond({ success: true, count });
          break;
        }

        default:
          throw new Error(`알 수 없는 캐릭터 배치 작업: ${op}`);
      }
    } catch (err) {
      console.error(`[CE] 캐릭터 배치 작업(${op}) 실패:`, err.message);
      respond({ success: false, error: err.message });
    }
  }

  // ================================================================
  //  현재 활성 씬 ID 탐색 헬퍼 (여러 경로 시도)
  // ================================================================
  function _findCurrentSceneId() {
    if (!reduxStore) return { sceneId: null, roomId: null };
    const state = reduxStore.getState();

    const roomId = state.app?.state?.roomId
      || window.location.pathname.match(/\/rooms\/([^/]+)/)?.[1];
    const room = roomId ? state.entities?.rooms?.entities?.[roomId] : null;

    // 1) 직접 참조
    let sceneId = room?.sceneId
      || state.app?.state?.sceneId
      || state.app?.state?.currentSceneId;

    // 2) rooms 엔티티 전체 키에서 scene 관련 필드
    if (!sceneId && room) {
      for (const k of Object.keys(room)) {
        if (/scene/i.test(k) && typeof room[k] === 'string' && room[k].length > 5) {
          sceneId = room[k];
          _dbg(`%c[CE]%c 마커: room.${k} 에서 sceneId 발견: ${sceneId}`,
            'color: #ff9800; font-weight: bold;', 'color: inherit;');
          break;
        }
      }
    }

    // 3) app.state 전체에서 scene 관련 필드
    if (!sceneId && state.app?.state) {
      for (const k of Object.keys(state.app.state)) {
        if (/scene/i.test(k) && typeof state.app.state[k] === 'string' && state.app.state[k].length > 5) {
          sceneId = state.app.state[k];
          _dbg(`%c[CE]%c 마커: app.state.${k} 에서 sceneId 발견: ${sceneId}`,
            'color: #ff9800; font-weight: bold;', 'color: inherit;');
          break;
        }
      }
    }

    // 4) backgroundUrl 매칭
    if (!sceneId && room?.backgroundUrl) {
      const rs = state.entities?.roomScenes;
      if (rs?.ids) {
        for (const sid of rs.ids) {
          const sc = rs.entities[sid];
          if (sc?.backgroundUrl === room.backgroundUrl) {
            sceneId = sid;
            _dbg(`%c[CE]%c 마커: backgroundUrl 매칭으로 sceneId 발견: ${sceneId}`,
              'color: #ff9800; font-weight: bold;', 'color: inherit;');
            break;
          }
        }
      }
    }

    if (!sceneId) {
      console.warn('[CE] 마커: sceneId 찾기 실패!',
        'roomId:', roomId,
        'room 키:', room ? Object.keys(room) : 'room 없음',
        'app.state scene 키:', state.app?.state ? Object.keys(state.app.state).filter(k => /scene/i.test(k)) : '없음',
        'app.state 전체 키:', state.app?.state ? Object.keys(state.app.state) : '없음');
    }

    return { sceneId, roomId };
  }

  // ================================================================
  //  마커 목록 조회 (room 문서의 markers — 라이브 마커)
  //  bwbr-request-marker-list → bwbr-marker-list-data
  // ================================================================
  window.addEventListener('bwbr-request-marker-list', () => {
    document.documentElement.removeAttribute('data-bwbr-request-marker-list');

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-marker-list-data', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-marker-list-data'));
    };

    if (!reduxStore) return respond({ items: [], roomId: null });
    const state = reduxStore.getState();
    const roomId = state.app?.state?.roomId || location.pathname.match(/rooms\/([^/]+)/)?.[1];
    if (!roomId) return respond({ items: [], roomId: null });

    const room = state.entities?.rooms?.entities?.[roomId];
    if (!room?.markers) return respond({ items: [], roomId });

    const markers = room.markers;
    const items = Object.keys(markers).map(key => ({
      ...markers[key],
      _id: key
    }));

    respond({ items, roomId });
  });

  // ================================================================
  //  마커 일괄 조작 (room 문서의 markers 필드 업데이트)
  //  bwbr-marker-batch-op → bwbr-marker-batch-op-result
  //  op: 'delete' | 'duplicate' | 'move' | 'lock'
  // ================================================================
  function _markerBatchHandler() {
    const raw = document.documentElement.getAttribute('data-bwbr-marker-batch-op');
    if (!raw) return;
    document.documentElement.removeAttribute('data-bwbr-marker-batch-op');
    const { op, ids, extra } = JSON.parse(raw);
    console.log('[CE] [MarkerBatch] op:', op, 'ids:', ids?.length, 'extra:', extra);
    _markerBatchHandlerAsync(op, ids, extra);
  }
  window.addEventListener('bwbr-marker-batch-op', _markerBatchHandler);
  document.addEventListener('bwbr-marker-batch-op', _markerBatchHandler);
  async function _markerBatchHandlerAsync(op, ids, extra) {

    const respond = (d) => {
      document.documentElement.setAttribute('data-bwbr-marker-batch-op-result', JSON.stringify(d));
      window.dispatchEvent(new CustomEvent('bwbr-marker-batch-op-result'));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId || location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const room = state.entities?.rooms?.entities?.[roomId];
      if (!room?.markers) throw new Error('room에 markers 없음');

      // room 문서 참조 (rooms/{roomId})
      const roomsCol = sdk.collection(sdk.db, 'rooms');
      const roomRef = sdk.doc(roomsCol, roomId);
      let count = 0;

      // ───── writeBatch.update 로 개별 필드만 조작 (문서 덮어쓰기 X) ─────
      if (sdk.writeBatch) {
        const batch = sdk.writeBatch(sdk.db);
        const updateData = { updatedAt: Date.now() };

        switch (op) {
          case 'delete': {
            if (!ids?.length) throw new Error('대상 ID 없음');
            const delField = _getDeleteField();
            if (!delField) throw new Error('deleteField 함수 없음 — 마커 삭제 불가');
            for (const id of ids) {
              if (id in room.markers) {
                updateData[`markers.${id}`] = delField();
                count++;
              }
            }
            break;
          }
          case 'duplicate': {
            if (!ids?.length) throw new Error('대상 ID 없음');
            for (const id of ids) {
              if (!(id in room.markers)) continue;
              const newKey = Date.now().toString(16) + Math.random().toString(16).slice(2, 5);
              const copy = JSON.parse(JSON.stringify(room.markers[id]));
              delete copy._id;
              copy.x = (copy.x || 0) + 2;
              copy.y = (copy.y || 0) + 2;
              updateData[`markers.${newKey}`] = copy;
              count++;
            }
            break;
          }
          case 'move': {
            if (!ids?.length) throw new Error('대상 ID 없음');
            const dx = extra?.dx || 0, dy = extra?.dy || 0;
            for (const id of ids) {
              if (!(id in room.markers)) continue;
              const m = room.markers[id];
              updateData[`markers.${id}.x`] = (m.x || 0) + dx;
              updateData[`markers.${id}.y`] = (m.y || 0) + dy;
              count++;
            }
            break;
          }
          case 'lock': {
            if (!ids?.length) throw new Error('대상 ID 없음');
            for (const id of ids) {
              if (!(id in room.markers)) continue;
              updateData[`markers.${id}.locked`] = !room.markers[id].locked;
              count++;
            }
            break;
          }
          case 'freeze': {
            if (!ids?.length) throw new Error('대상 ID 없음');
            for (const id of ids) {
              if (!(id in room.markers)) continue;
              updateData[`markers.${id}.freezed`] = !room.markers[id].freezed;
              count++;
            }
            break;
          }
          default:
            throw new Error(`알 수 없는 마커 배치 작업: ${op}`);
        }

        batch.update(roomRef, updateData);
        await batch.commit();

      } else {
        throw new Error('writeBatch 미지원 — 마커 조작 불가');
      }

      const opNames = { delete: '삭제', duplicate: '복제', move: '이동', lock: '고정전환', freeze: '크기고정전환' };
      _dbg(`%c[CE]%c ✅ 마커 ${count}개 ${opNames[op] || op}`,
        'color: #2196f3; font-weight: bold;', 'color: inherit;');
      respond({ success: true, count });

    } catch (err) {
      console.error(`[CE] 마커 배치 작업(${op}) 실패:`, err.message);
      respond({ success: false, error: err.message });
    }
  }

  // ================================================================
  //  트리거 UI: 네이티브 이미지 선택창 열기
  //  bwbr-open-native-image-picker → 네이티브 피커 열림 → 선택 결과 반환
  //  bwbr-native-picker-result (data-bwbr-native-picker-result)
  // ================================================================
  let _bwbrPickerActive = false;

  // ================================================================
  //  [CORE] 네이티브 이미지 피커 (bwbr-open-native-image-picker)
  // ================================================================
  document.addEventListener('bwbr-open-native-image-picker', () => {
    if (!reduxStore || _bwbrPickerActive) return;
    _bwbrPickerActive = true;
    let _pickerGotResult = false;

    // 1) 네이티브 이미지 피커를 bogus target으로 열기 (side-effect 방지)
    const appState = reduxStore.getState().app.state;
    reduxStore.dispatch({
      type: 'app/state/seted',
      payload: Object.assign({}, appState, {
        openRoomImageSelect: true,
        openRoomImageSelectDir: 'item',
        openRoomImageSelectTarget: 'bwbr/ext'
      })
    });

    // 2) DOM 클릭 캡처로 선택된 이미지 URL 획득
    function onDocClick(e) {
      // MuiDialog-paperWidthMd = 네이티브 이미지 피커 dialog
      const pickerDialog = document.querySelector('.MuiDialog-paperWidthMd[role="dialog"]');
      if (!pickerDialog || !pickerDialog.contains(e.target)) return;

      // 이미지 요소 찾기
      let imgEl = null;
      if (e.target.tagName === 'IMG') {
        imgEl = e.target;
      } else {
        // 래퍼 div 클릭 시 — 직계 자식 img 찾기
        imgEl = e.target.querySelector(':scope > img');
      }
      if (!imgEl || !imgEl.src) return;

      // UI 아이콘이 아닌 ccfolia 파일 이미지인지 확인
      if (imgEl.closest('button') || imgEl.closest('header') || imgEl.closest('[role="tab"]')) return;
      if (!imgEl.src.startsWith('https://')) return;

      // URL 캡처
      _pickerGotResult = true;
      _sendResult(imgEl.src);
    }
    document.addEventListener('click', onDocClick, true); // capture phase

    // 3) store 감시: 피커가 닫히면 정리
    const unsub = reduxStore.subscribe(() => {
      const s = reduxStore.getState().app.state;
      if (!s.openRoomImageSelect && _bwbrPickerActive) {
        _bwbrPickerActive = false;
        unsub();
        document.removeEventListener('click', onDocClick, true);
        // 이미지 선택 없이 닫힘 = 취소
        if (!_pickerGotResult) {
          _sendResult(null);
        }
      }
    });

    // 60초 안전 타임아웃
    setTimeout(() => {
      if (_bwbrPickerActive) {
        _bwbrPickerActive = false;
        try { unsub(); } catch(e) {}
        document.removeEventListener('click', onDocClick, true);
        if (!_pickerGotResult) _sendResult(null);
      }
    }, 60000);

    function _sendResult(url) {
      document.documentElement.setAttribute(
        'data-bwbr-native-picker-result',
        JSON.stringify({ url: url })
      );
      document.dispatchEvent(new CustomEvent('bwbr-native-picker-result'));
    }
  });

  // ================================================================
  //  [DEBUG] 진단/덤프 핸들러
  //  bwbr-dump-redux-keys, bwbr-dump-room, bwbr-dump-items,
  //  bwbr-log-actions, bwbr-snapshot-*, bwbr-deep-snapshot-*
  // ================================================================
  // ── 진단: Redux 상태 구조 덤프 ──
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-redux-keys'))
  window.addEventListener('bwbr-dump-redux-keys', () => {
    if (!reduxStore) {
      console.error('[CE 진단] Redux Store 없음');
      return;
    }
    const state = reduxStore.getState();
    console.log('%c[CE 진단]%c ===== Redux 상태 구조 =====',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
    console.log('Top-level keys:', Object.keys(state));
    console.log('app keys:', Object.keys(state.app || {}));
    console.log('entities keys:', Object.keys(state.entities || {}));

    // entities 하위 구조
    for (const key of Object.keys(state.entities || {})) {
      const ent = state.entities[key];
      if (ent?.ids) {
        console.log(`  entities.${key}: ${ent.ids.length}건`);
        if (ent.ids.length > 0) {
          const sample = ent.entities[ent.ids[0]];
          console.log(`    샘플 키:`, Object.keys(sample || {}));
          console.log(`    샘플 데이터:`, JSON.parse(JSON.stringify(sample)));
        }
      }
    }

    // app 하위 구조
    for (const key of Object.keys(state.app || {})) {
      const val = state.app[key];
      if (val && typeof val === 'object') {
        console.log(`  app.${key}:`, Object.keys(val));
      } else {
        console.log(`  app.${key}:`, val);
      }
    }
    console.log('%c[CE 진단]%c ===========================',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  진단: rooms 엔티티 (방 설정) 상세 덤프 — BGM/장면 필드 확인용
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-room'))
  // ================================================================
  window.addEventListener('bwbr-dump-room', () => {
    if (!reduxStore) return console.error('[CE 진단] Redux Store 없음');
    const state = reduxStore.getState();
    const roomId = state.app?.state?.roomId
      || window.location.pathname.match(/\/rooms\/([^/]+)/)?.[1];
    if (!roomId) return console.error('[CE 진단] roomId 없음');
    const room = state.entities?.rooms?.entities?.[roomId];
    if (!room) return console.error('[CE 진단] room 엔티티 없음');

    console.log('%c[CE 진단]%c ===== 방 설정 (rooms entity) =====',
      'color: #ff9800; font-weight: bold;', 'color: inherit;');
    console.log('모든 키:', Object.keys(room).sort());

    // URL/이미지/사운드 관련 필드 하이라이트
    const interesting = {};
    for (const [k, v] of Object.entries(room)) {
      const lk = k.toLowerCase();
      if (lk.includes('image') || lk.includes('url') || lk.includes('sound') ||
          lk.includes('bgm') || lk.includes('music') || lk.includes('audio') ||
          lk.includes('scene') || lk.includes('background') || lk.includes('foreground') ||
          lk.includes('volume') || lk.includes('screen')) {
        interesting[k] = v;
      }
    }
    console.log('🎵 미디어/장면 관련 필드:', interesting);
    console.log('전체 데이터:', JSON.parse(JSON.stringify(room)));
    console.log('%c[CE 진단]%c ================================',
      'color: #ff9800; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  [TRIGGER] 방 설정 변경 + 장면 로드
  //  bwbr-trigger-room-field, bwbr-dump-scenes, bwbr-load-native-scene
  // ================================================================
  window.addEventListener('bwbr-trigger-room-field', async (e) => {
    const detail = e.detail || {};
    const respond = (d) => window.dispatchEvent(
      new CustomEvent('bwbr-trigger-room-field-result', { detail: d })
    );

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const update = { updatedAt: Date.now() };

      // 전달받은 fields 객체의 모든 키-값 쌍을 방 문서에 쓴다
      const fields = detail.fields || {};
      for (const [key, val] of Object.entries(fields)) {
        update[key] = val;
      }

      const roomCol = sdk.collection(sdk.db, 'rooms');
      const roomRef = sdk.doc(roomCol, roomId);
      await sdk.setDoc(roomRef, update, { merge: true });

      console.log(`%c[CE]%c ✅ 방 설정 변경:`, 'color: #4caf50; font-weight: bold;', 'color: inherit;',
        Object.keys(fields));
      respond({ success: true, fields: Object.keys(fields) });
    } catch (err) {
      console.error('[CE] 방 설정 변경 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  진단: 네이티브 장면 목록 덤프
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-scenes'))
  // ================================================================
  window.addEventListener('bwbr-dump-scenes', () => {
    if (!reduxStore) return console.error('[CE 진단] Redux Store 없음');
    const state = reduxStore.getState();

    // scenes는 entities 아래에 있을 수 있음
    console.log('%c[CE 진단]%c ===== 장면(scene) 탐색 =====',
      'color: #e91e63; font-weight: bold;', 'color: inherit;');

    // entities 내 모든 키 나열
    const entityKeys = Object.keys(state.entities || {});
    console.log('entities 내 모든 키:', entityKeys);

    // roomScenes 엔티티 출력
    const scenesEnt = state.entities?.roomScenes;
    if (scenesEnt?.ids?.length) {
      console.log('roomScenes ids:', scenesEnt.ids);
      for (const sid of scenesEnt.ids) {
        const sc = scenesEnt.entities[sid];
        console.log('  장면:', sc?.name || '(이름 없음)', '| 키:', Object.keys(sc || {}), '| 데이터:', JSON.parse(JSON.stringify(sc)));
      }
    } else {
      console.log('roomScenes: 비어 있음');
    }

    // app.state도 확인
    if (state.app?.state) {
      const appKeys = Object.keys(state.app.state);
      const sceneKeys = appKeys.filter(k => k.toLowerCase().includes('scene'));
      if (sceneKeys.length) {
        console.log('app.state 내 scene 키:', sceneKeys.map(k => ({ [k]: state.app.state[k] })));
      }
    }

    // 현재 방의 sceneId
    const roomId = state.app?.state?.roomId
      || window.location.pathname.match(/\/rooms\/([^/]+)/)?.[1];
    if (roomId) {
      const room = state.entities?.rooms?.entities?.[roomId];
      if (room?.sceneId) console.log('현재 sceneId:', room.sceneId);
    }

    console.log('%c[CE 진단]%c ==============================',
      'color: #e91e63; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  트리거: 네이티브 장면 불러오기
  //  장면 이름으로 검색 → 방 문서에 장면 필드 복사
  //  applyOption: 'all' | 'noBgm' | 'noText'
  // ================================================================
  window.addEventListener('bwbr-load-native-scene', async (e) => {
    // DOM 속성 브릿지 (크로스-월드 안정성)
    const _raw = document.documentElement.getAttribute('data-bwbr-load-native-scene');
    document.documentElement.removeAttribute('data-bwbr-load-native-scene');
    const detail = _raw ? JSON.parse(_raw) : (e.detail || {});
    const respond = (d) => window.dispatchEvent(
      new CustomEvent('bwbr-load-native-scene-result', { detail: d })
    );

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const state = reduxStore.getState();
      const sceneName = (detail.sceneName || '').trim();
      const applyOption = detail.applyOption || 'all';

      if (!sceneName) throw new Error('장면 이름이 비어 있음');

      // roomScenes 엔티티에서 이름으로 검색
      const scenesEnt = state.entities?.roomScenes;
      let targetScene = null;

      if (scenesEnt?.ids?.length) {
        for (const sid of scenesEnt.ids) {
          const sc = scenesEnt.entities[sid];
          if (sc && sc.name === sceneName) {
            targetScene = sc;
            break;
          }
        }
      }

      if (!targetScene) throw new Error('장면을 찾을 수 없음: ' + sceneName);

      // 장면 데이터에서 방 문서에 쓸 필드 추출
      const update = { updatedAt: Date.now() };

      // 장면의 모든 필드를 복사하되, 시스템 필드와 옵션에 따라 제외
      const blacklist = new Set([
        '_id', 'name', 'locked', 'order', 'createdAt', 'updatedAt'
      ]);

      // BGM 관련 필드 (noBgm 옵션용)
      const bgmFields = new Set([
        'soundUrl', 'soundVolume', 'soundName', 'soundRef', 'soundRepeat',
        'mediaUrl', 'mediaVolume', 'mediaName', 'mediaRef', 'mediaRepeat', 'mediaType'
      ]);

      // 텍스트 관련 필드 (noText 옵션용) — 장면 전환 시 표시되는 텍스트
      const textFields = new Set([
        'text'
      ]);

      for (const [key, val] of Object.entries(targetScene)) {
        if (blacklist.has(key)) continue;
        if (applyOption === 'noBgm' && bgmFields.has(key)) continue;
        if (applyOption === 'noText' && textFields.has(key)) continue;
        update[key] = val;
      }

      const roomCol = sdk.collection(sdk.db, 'rooms');
      const roomRef = sdk.doc(roomCol, roomId);
      await sdk.setDoc(roomRef, update, { merge: true });

      console.log(`%c[CE]%c ✅ 장면 적용:`, 'color: #4caf50; font-weight: bold;', 'color: inherit;',
        sceneName, '(' + applyOption + ')', '필드:', Object.keys(update).length);
      respond({ success: true, sceneName: sceneName });
    } catch (err) {
      console.error('[CE] 장면 적용 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  진단: Redux entities 전체 키 + 크기 덤프
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-entities'))
  // ================================================================
  window.addEventListener('bwbr-dump-entities', () => {
    if (!reduxStore) { console.error('[CE 진단] Redux Store 없음'); return; }
    const state = reduxStore.getState();
    const ent = state.entities || {};
    console.log('%c[CE 진단]%c ===== Redux entities 키 목록 =====',
      'color: #ff9800; font-weight: bold;', 'color: inherit;');
    for (const k of Object.keys(ent)) {
      const e = ent[k];
      const count = e?.ids?.length || 0;
      let extra = '';
      if (count > 0 && count <= 10) {
        const first = e.entities[e.ids[0]];
        extra = ' | keys: ' + Object.keys(first || {}).slice(0, 10).join(', ');
        if (first?.type) extra += ' | type: ' + first.type;
      }
      console.log(`  ${k}: ${count}개${extra}`);
    }
  });

  // ================================================================
  //  진단: roomScenes markers 구조 덤프
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-scenes'))
  // ================================================================
  window.addEventListener('bwbr-dump-scenes', () => {
    if (!reduxStore) { console.error('[CE 진단] Redux Store 없음'); return; }
    const state = reduxStore.getState();
    const rs = state.entities?.roomScenes;
    if (!rs?.ids?.length) { console.log('[CE 진단] roomScenes: 0건'); return; }
    console.log('%c[CE 진단]%c ===== roomScenes + markers =====',
      'color: #ff9800; font-weight: bold;', 'color: inherit;');
    for (const id of rs.ids) {
      const sc = rs.entities[id];
      const m = sc.markers;
      const isArr = Array.isArray(m);
      const cnt = isArr ? m.length : (m ? Object.keys(m).length : 0);
      console.log(`  씬 "${sc.name}" [${id}] | markers: ${cnt}개 (${isArr ? 'array' : typeof m})`);
      if (cnt > 0) {
        const sample = isArr ? m[0] : Object.values(m)[0];
        console.log('    샘플 marker:', JSON.parse(JSON.stringify(sample)));
      }
      // 다른 scene 필드 중 마커 관련 확인
      const allKeys = Object.keys(sc);
      const markerKeys = allKeys.filter(k => /marker|plane/i.test(k));
      if (markerKeys.length > 1) console.log('    마커 관련 키:', markerKeys);
    }
  });

  // ================================================================
  //  진단: roomItems(스크린 패널) 상세 덤프
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-items'))
  // ================================================================
  window.addEventListener('bwbr-dump-items', () => {
    if (!reduxStore) {
      console.error('[CE 진단] Redux Store 없음');
      return;
    }
    const state = reduxStore.getState();
    const ri = state.entities.roomItems;
    if (!ri?.ids?.length) {
      console.log('[CE 진단] roomItems: 0건');
      return;
    }
    console.log('%c[CE 진단]%c ===== roomItems 상세 =====',
      'color: #ff9800; font-weight: bold;', 'color: inherit;');
    console.log('총 아이템 수:', ri.ids.length);

    // type별 그룹핑
    const byType = {};
    for (const id of ri.ids) {
      const item = ri.entities[id];
      const t = item.type || '(없음)';
      if (!byType[t]) byType[t] = [];
      byType[t].push(item);
    }
    console.log('type별 분류:', Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, v.length])
    ));

    // 각 type별 샘플 1개씩
    for (const [type, items] of Object.entries(byType)) {
      console.log(`\n--- type: "${type}" (${items.length}건) ---`);
      const sample = items[0];
      console.log('  샘플:', JSON.parse(JSON.stringify(sample)));
      // active인 것만 요약
      const activeItems = items.filter(i => i.active);
      console.log(`  active: ${activeItems.length}건`);
      if (activeItems.length > 0) {
        for (const ai of activeItems.slice(0, 5)) {
          console.log(`    [${ai._id}] pos=(${ai.x},${ai.y}) size=${ai.width}x${ai.height} memo="${ai.memo || ''}" img=${ai.imageUrl ? '있음' : '없음'}`);
        }
        if (activeItems.length > 5) console.log(`    ... 외 ${activeItems.length - 5}건`);
      }
    }
    console.log('%c[CE 진단]%c ============================',
      'color: #ff9800; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  진단: Redux Action 로깅 시작/중지
  //  시작: window.dispatchEvent(new CustomEvent('bwbr-log-actions'))
  //  중지: window.dispatchEvent(new CustomEvent('bwbr-stop-log-actions'))
  // ================================================================
  let _origDispatch = null;

  window.addEventListener('bwbr-log-actions', () => {
    if (!reduxStore) {
      console.error('[CE] Redux Store 없음');
      return;
    }
    if (_origDispatch) {
      console.log('[CE] 이미 Action 로깅 중');
      return;
    }
    _origDispatch = reduxStore.dispatch;
    reduxStore.dispatch = function (action) {
      if (typeof action === 'function') {
        // thunk — inner dispatch도 인터셉트
        return action(function innerDispatch(innerAction) {
          if (typeof innerAction === 'function') {
            return innerAction(innerDispatch, reduxStore.getState);
          }
          console.log('%c[ACTION inner]%c', 'color:#ff9800;font-weight:bold', 'color:inherit',
            innerAction?.type || '(no type)', innerAction);
          return _origDispatch.call(reduxStore, innerAction);
        }, reduxStore.getState);
      }
      console.log('%c[ACTION]%c', 'color:#ff9800;font-weight:bold', 'color:inherit',
        action?.type || '(no type)', action);
      return _origDispatch.call(this, action);
    };
    console.log('%c[CE]%c ✅ Action 로깅 시작 (thunk 내부 포함) — 조작 후 콘솔을 확인하세요',
      'color: #4caf50; font-weight: bold;', 'color: inherit;');
  });

  window.addEventListener('bwbr-stop-log-actions', () => {
    if (_origDispatch) {
      reduxStore.dispatch = _origDispatch;
      _origDispatch = null;
      console.log('%c[CE]%c Action 로깅 해제',
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
    } else {
      console.log('[CE] 로깅 중이 아닙니다');
    }
  });

  // ================================================================
  //  진단: app.state 변화 스냅샷 (before/after diff)
  //  1) bwbr-snapshot-before → 스냅샷 저장
  //  2) 코코포리아에서 확대 보기 등 조작
  //  3) bwbr-snapshot-after → diff 출력
  // ================================================================
  let _stateSnapshot = null;

  window.addEventListener('bwbr-snapshot-before', () => {
    if (!reduxStore) return console.error('[CE] Redux Store 없음');
    _stateSnapshot = JSON.parse(JSON.stringify(reduxStore.getState().app?.state || {}));
    console.log('%c[CE]%c 📸 app.state 스냅샷 저장 완료 — 이제 조작하세요',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  window.addEventListener('bwbr-snapshot-after', () => {
    if (!reduxStore) return console.error('[CE] Redux Store 없음');
    if (!_stateSnapshot) return console.error('[CE] 먼저 bwbr-snapshot-before 실행하세요');

    const after = JSON.parse(JSON.stringify(reduxStore.getState().app?.state || {}));
    const allKeys = new Set([...Object.keys(_stateSnapshot), ...Object.keys(after)]);
    const changes = {};
    for (const key of allKeys) {
      const b = JSON.stringify(_stateSnapshot[key]);
      const a = JSON.stringify(after[key]);
      if (b !== a) changes[key] = { before: _stateSnapshot[key], after: after[key] };
    }

    console.log('%c[CE]%c 📸 app.state 변화:', 'color: #2196f3; font-weight: bold;', 'color: inherit;');
    if (Object.keys(changes).length === 0) {
      console.log('  (변화 없음)');
    } else {
      for (const [k, v] of Object.entries(changes)) {
        console.log(`  ${k}:`, v.before, '→', v.after);
      }
    }
    _stateSnapshot = null;
  });

  // ================================================================
  //  전체 Redux state 깊은 비교 (grid 키 탐색용)
  //  bwbr-deep-snapshot-before → 전체 state 스냅샷
  //  bwbr-deep-snapshot-after  → 전체 state diff
  //  사용법: before → 코코포리아에서 그리드 토글 → after
  // ================================================================

  let _deepSnapshot = null;

  function deepDiff(before, after, path, result, depth) {
    if (depth > 6) return; // 깊이 제한
    if (before === after) return;
    if (typeof before !== typeof after
      || before === null || after === null
      || typeof before !== 'object') {
      result.push({ path, before, after });
      return;
    }
    // 배열
    if (Array.isArray(before) || Array.isArray(after)) {
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        result.push({ path, before: `Array(${(before||[]).length})`, after: `Array(${(after||[]).length})` });
      }
      return;
    }
    // 객체
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
      deepDiff(before[key], after[key], path + '.' + key, result, depth + 1);
    }
  }

  window.addEventListener('bwbr-deep-snapshot-before', () => {
    if (!reduxStore) return console.error('[CE] Redux Store 없음');
    try {
      _deepSnapshot = JSON.parse(JSON.stringify(reduxStore.getState()));
      console.log('%c[CE]%c 🔬 전체 Redux state 스냅샷 저장됨 (키: %d)',
        'color: #e91e63; font-weight: bold;', 'color: inherit;',
        Object.keys(_deepSnapshot).length);
    } catch (e) {
      console.error('[CE] 스냅샷 실패 (순환 참조?):', e.message);
    }
  });

  window.addEventListener('bwbr-deep-snapshot-after', () => {
    if (!reduxStore) return console.error('[CE] Redux Store 없음');
    if (!_deepSnapshot) return console.error('[CE] 먼저 bwbr-deep-snapshot-before 실행하세요');

    let current;
    try {
      current = JSON.parse(JSON.stringify(reduxStore.getState()));
    } catch (e) {
      return console.error('[CE] 현재 상태 직렬화 실패:', e.message);
    }

    const diffs = [];
    deepDiff(_deepSnapshot, current, 'state', diffs, 0);

    console.log('%c[CE]%c 🔬 전체 Redux state 변화 (%d건):',
      'color: #e91e63; font-weight: bold;', 'color: inherit;', diffs.length);
    if (diffs.length === 0) {
      console.log('  (변화 없음 — Firestore 직접 쓰기일 수 있음)');
    } else {
      for (const d of diffs) {
        console.log(`  ${d.path}:`, d.before, '→', d.after);
      }
    }
    _deepSnapshot = null;
  });

  // ================================================================
  //  app.state 수정용 action creator 자동 탐색
  // ================================================================

  /** 캐시된 seted action creator (한 번 발견하면 재사용) */
  let _setedActionCreator = null;

  /**
   * app.state 수정용 action creator를 자동 탐색.
   * 방법 1: webpack 모듈에서 .seted action creator 검색 (RTK 패턴)
   * 방법 2: type 문자열 브루트포스
   * 방법 3: dispatch 인터셉터로 자연 상호작용에서 캡처 (아래 installPassiveInterceptor)
   */
  function findSetedActionCreator() {
    if (_setedActionCreator) return _setedActionCreator;

    // 안전한 테스트: roomPointerX를 -99999로 바꿔 보고, 성공 여부와 무관하게 반드시 복원
    function safeProbeType(typeStr, appState, origX) {
      try {
        reduxStore.dispatch({ type: typeStr, payload: { ...appState, roomPointerX: -99999 } });
        return reduxStore.getState().app?.state?.roomPointerX === -99999;
      } catch { return false; }
      finally {
        // 테스트 후 반드시 원래 값으로 복원
        try {
          if (reduxStore.getState().app?.state?.roomPointerX === -99999) {
            reduxStore.dispatch({ type: typeStr, payload: { ...reduxStore.getState().app.state, roomPointerX: origX } });
          }
        } catch { /* 최선 노력 복원 */ }
      }
    }

    // ── 방법 1: webpack 모듈에서 RTK action creator 검색 ──
    const req = acquireWebpackRequire();
    if (req) {
      const ids = Object.keys(req.m);
      for (let mi = 0; mi < ids.length; mi++) {
        try {
          const mod = req(ids[mi]);
          if (!mod || typeof mod !== 'object') continue;
          for (const key of Object.keys(mod)) {
            const val = mod[key];
            if (!val || typeof val !== 'object') continue;
            if (typeof val.seted === 'function' && typeof val.seted.type === 'string') {
              const testType = val.seted.type;
              const appState = reduxStore.getState().app?.state;
              if (appState) {
                const origX = appState.roomPointerX;
                if (safeProbeType(testType, appState, origX)) {
                    _setedActionCreator = val.seted;
                    console.log(`%c[CE]%c ✅ seted action creator 발견: type="${testType}" (module ${ids[mi]}, key "${key}")`,
                      'color: #4caf50; font-weight: bold;', 'color: inherit;');
                    return _setedActionCreator;
                }
              }
            }
          }
        } catch { /* skip module */ }
      }
      console.log('[CE] webpack 모듈 검색 완료, seted 미발견 → 인터셉터 대기');
    }

    // ── 방법 2: 확장된 type 문자열 브루트포스 ──
    const state = reduxStore.getState();
    const appState = state.app?.state;
    if (appState && typeof appState === 'object') {
      const origX = appState.roomPointerX;
      const sliceNames = [
        'state', 'appState', 'app', 'ui', 'page', 'view', 'layout',
        'global', 'root', 'main', 'setting', 'settings', 'config',
        'store', 'reducer', 'slice', 'room', 'workspace', 'session'
      ];
      const actionNames = ['seted', 'set', 'setState', 'update', 'replace', 'patch', 'merge', 'assign', 'reset'];

      for (const sn of sliceNames) {
        for (const an of actionNames) {
          const type = `${sn}/${an}`;
          if (safeProbeType(type, appState, origX)) {
              _setedActionCreator = { type, __synthetic: true };
              console.log(`%c[CE]%c ✅ app.state type 발견 (브루트포스): "${type}"`,
                'color: #4caf50; font-weight: bold;', 'color: inherit;');
              return _setedActionCreator;
          }
        }
      }
    }

    console.warn('[CE] app.state action type 탐색 실패 — 인터셉터로 캡처 대기 중');
    return null;
  }

  // ── 방법 3: 패시브 인터셉터 — 코코포리아 일반 상호작용에서 type 캡처 ──
  (function installPassiveInterceptor() {
    if (!reduxStore) return;
    const orig = reduxStore.dispatch;
    reduxStore.dispatch = function (action) {
      if (typeof action === 'function') {
        return action(function innerDispatch(innerAction) {
          if (typeof innerAction !== 'function' && innerAction?.type && innerAction?.payload) {
            const p = innerAction.payload;
            if (!_setedActionCreator && p && typeof p === 'object'
              && 'openInspector' in p && 'roomPointerX' in p) {
              _setedActionCreator = { type: innerAction.type, __intercepted: true };
              console.log(`%c[CE]%c ✅ seted action type 캡처됨: "${innerAction.type}"`,
                'color: #4caf50; font-weight: bold;', 'color: inherit;');
              reduxStore.dispatch = orig;
            }
          }
          return orig.call(reduxStore, innerAction);
        }, reduxStore.getState);
      }
      return orig.call(this, action);
    };
  })();

  // ================================================================
  //  [COMBAT] 네이티브 그리드 상태 감시 (displayGrid)
  //  Firestore: rooms/{roomId}.displayGrid (boolean)
  //  Redux:    entities.rooms.entities.{roomId}.displayGrid
  //
  //  cocofolia 필드 설정에서 "전경에 그리드 표시"를 켜면
  //  ISOLATED world의 grid-overlay.js에 이벤트를 발행하여
  //  네이티브 그리드 대신 커스텀 디자인으로 교체합니다.
  //
  //  ISOLATED → bwbr-query-native-grid  → bwbr-query-native-grid-result
  //  MAIN    → bwbr-display-grid-changed { value }  (store.subscribe)
  // ================================================================

  /** 현재 방의 displayGrid 값을 Redux에서 읽기 */
  function readDisplayGrid() {
    if (!reduxStore) return null;
    const state = reduxStore.getState();
    const roomId = state.app?.state?.roomId
      || window.location.pathname.match(/\/rooms\/([^/]+)/)?.[1];
    if (!roomId) return null;
    const room = state.entities?.rooms?.entities?.[roomId];
    if (!room || typeof room.displayGrid !== 'boolean') return null;
    return { roomId, value: room.displayGrid };
  }

  // 그리드 상태 조회 (ISOLATED → MAIN)
  window.addEventListener('bwbr-query-native-grid', () => {
    const grid = readDisplayGrid();
    window.dispatchEvent(new CustomEvent('bwbr-query-native-grid-result', {
      detail: grid
        ? { success: true, roomId: grid.roomId, value: grid.value }
        : { success: false, reason: 'room_not_found' }
    }));
  });

  // 그리드 토글 (Firestore 직접 쓰기) — SpeedDial 버튼에서 호출
  window.addEventListener('bwbr-toggle-native-grid', async (e) => {
    const forceValue = e.detail?.value; // true/false 또는 undefined(토글)
    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) {
        window.dispatchEvent(new CustomEvent('bwbr-toggle-native-grid-result', {
          detail: { success: false, reason: 'firestore_sdk_not_found' }
        }));
        return;
      }

      const grid = readDisplayGrid();
      if (!grid) {
        window.dispatchEvent(new CustomEvent('bwbr-toggle-native-grid-result', {
          detail: { success: false, reason: 'room_not_found' }
        }));
        return;
      }

      const next = forceValue !== undefined ? !!forceValue : !grid.value;

      // Firestore 쓰기: rooms/{roomId}.displayGrid
      const roomCol = sdk.collection(sdk.db, 'rooms');
      const roomRef = sdk.doc(roomCol, grid.roomId);
      await sdk.setDoc(roomRef, { displayGrid: next }, { merge: true });

      console.log(`%c[CE]%c 그리드 토글: displayGrid = ${grid.value} → ${next}`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      window.dispatchEvent(new CustomEvent('bwbr-toggle-native-grid-result', {
        detail: { success: true, roomId: grid.roomId, value: next }
      }));
    } catch (err) {
      console.error('[CE] 네이티브 그리드 토글 실패:', err);
      window.dispatchEvent(new CustomEvent('bwbr-toggle-native-grid-result', {
        detail: { success: false, reason: 'error', error: err.message }
      }));
    }
  });

  // ── displayGrid 변경 감시 (store.subscribe) ──
  {
    let _prevDisplayGrid = undefined;

    function watchDisplayGrid() {
      if (!reduxStore) return;
      reduxStore.subscribe(() => {
        const grid = readDisplayGrid();
        const curVal = grid ? grid.value : false;
        if (curVal !== _prevDisplayGrid) {
          _prevDisplayGrid = curVal;
          _dbg(`%c[CE]%c displayGrid 변경 감지: ${curVal}`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          window.dispatchEvent(new CustomEvent('bwbr-display-grid-changed', {
            detail: { value: curVal }
          }));
        }
      });
      // 초기값 설정 (이벤트 발행 없이)
      const grid = readDisplayGrid();
      _prevDisplayGrid = grid ? grid.value : false;
    }

    // reduxStore가 확보된 직후 실행되도록 약간 지연
    const _watchInterval = setInterval(() => {
      if (reduxStore) {
        clearInterval(_watchInterval);
        watchDisplayGrid();
        _dbg('%c[CE]%c displayGrid 감시 시작',
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
      }
    }, 500);
  }

  // ================================================================
  //  [COMBAT] 그리드 사이즈 감시 (gridSize)
  //  Firestore: rooms/{roomId}.gridSize (number)
  //  Redux:    entities.rooms.entities.{roomId}.gridSize
  //
  //  코코포리아 필드 설정의 "그리드 사이즈" 값을 읽어
  //  커스텀 그리드 오버레이 및 전투 이동 셀 크기에 반영합니다.
  //  1 grid cell = gridSize * 24px
  //
  //  ISOLATED → bwbr-query-grid-size  → bwbr-grid-size-result
  //  MAIN    → bwbr-grid-size-changed { value }  (store.subscribe)
  // ================================================================

  /** 현재 방의 gridSize 값을 Redux에서 읽기 (기본값 4) */
  function readGridSize() {
    if (!reduxStore) return null;
    const state = reduxStore.getState();
    const roomId = state.app?.state?.roomId
      || window.location.pathname.match(/\/rooms\/([^/]+)/)?.[1];
    if (!roomId) return null;
    const room = state.entities?.rooms?.entities?.[roomId];
    if (!room) return null;
    // gridSize가 없거나 0이면 기본값 1 (코코포리아 기본)
    const gs = typeof room.gridSize === 'number' && room.gridSize > 0 ? room.gridSize : 1;
    return { roomId, value: gs };
  }

  // 그리드 사이즈 조회 (ISOLATED → MAIN)
  window.addEventListener('bwbr-query-grid-size', () => {
    const gs = readGridSize();
    window.dispatchEvent(new CustomEvent('bwbr-grid-size-result', {
      detail: gs
        ? { success: true, roomId: gs.roomId, value: gs.value }
        : { success: false, reason: 'room_not_found' }
    }));
  });

  // ── gridSize 변경 감시 (store.subscribe) ──
  {
    let _prevGridSize = undefined;

    function watchGridSize() {
      if (!reduxStore) return;
      reduxStore.subscribe(() => {
        const gs = readGridSize();
        const curVal = gs ? gs.value : 1;
        if (curVal !== _prevGridSize) {
          _prevGridSize = curVal;
          _dbg(`%c[CE]%c gridSize 변경 감지: ${curVal}`,
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          window.dispatchEvent(new CustomEvent('bwbr-grid-size-changed', {
            detail: { value: curVal }
          }));
        }
      });
      // 초기값 설정 (이벤트 발행 없이)
      const gs = readGridSize();
      _prevGridSize = gs ? gs.value : 1;
    }

    // reduxStore가 확보된 직후 실행
    const _watchGSInterval = setInterval(() => {
      if (reduxStore) {
        clearInterval(_watchGSInterval);
        watchGridSize();
        _dbg('%c[CE]%c gridSize 감시 시작',
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
      }
    }, 500);
  }

  // ── 네이티브 그리드 DOM 진단 ──
  // displayGrid=true 상태에서 zoom container의 전체 자식을 덤프
  window.addEventListener('bwbr-inspect-native-grid', () => {
    const movable = document.querySelector('.movable');
    if (!movable) {
      console.error('[CE] .movable 없음 — 방에 입장하세요');
      return;
    }
    const zoom = movable.parentElement;
    console.group('%c[CE]%c zoom container 자식 목록 (displayGrid 활성 상태에서 실행)',
      'color:#4caf50;font-weight:bold', 'color:inherit');
    for (let i = 0; i < zoom.children.length; i++) {
      const ch = zoom.children[i];
      const tag = ch.tagName.toLowerCase();
      const cls = ch.className ? `.${[...ch.classList].join('.')}` : '';
      const id  = ch.id ? `#${ch.id}` : '';
      const size = `${ch.offsetWidth}×${ch.offsetHeight}`;
      const style = ch.style.cssText.slice(0, 120);
      const isMovable = ch.classList.contains('movable');
      const hasImg = ch.querySelector('img') ? ' [has <img>]' : '';
      const hasCanvas = ch.querySelector('canvas') || tag === 'canvas'
        ? ' [★ CANVAS]' : '';
      const hasSVG = ch.querySelector('svg') || tag === 'svg'
        ? ' [★ SVG]' : '';
      const bgImg = getComputedStyle(ch).backgroundImage;
      const hasBg = bgImg && bgImg !== 'none' ? ` [bg: ${bgImg.slice(0, 60)}]` : '';
      console.log(
        `  [${i}] <${tag}${id}${cls}> ${size} ${isMovable ? '[movable]' : ''}` +
        `${hasImg}${hasCanvas}${hasSVG}${hasBg}\n    style: ${style}`
      );
      // canvas의 경우 추가 정보
      if (tag === 'canvas' || ch.querySelector('canvas')) {
        const cvs = tag === 'canvas' ? ch : ch.querySelector('canvas');
        console.log(`    canvas 크기: ${cvs.width}×${cvs.height}, ` +
          `display: ${getComputedStyle(cvs).display}, ` +
          `position: ${getComputedStyle(cvs).position}`);
      }
    }
    console.groupEnd();
  });

  // ================================================================
  //  네이티브 확대 보기 (inspectImageUrl 방식)
  //  ISOLATED → bwbr-native-zoom { imageUrl }
  // ================================================================

  // ── Inspector 이미지 오버플로 수정 ──
  // 구조: MuiModal-root > sc-*(뷰포트 ~960×960) > MuiPaper(드래그, transform) > div > figure > img
  // 전략: img에 명시적 px 크기를 계산해서 직접 세팅 + Paper transform 리셋
  // 다른 요소는 일절 건드리지 않음 → img가 줄어들면 부모들이 자연히 줄어듦
  (function setupInspectorConstraint() {
    function constrainImg(modal) {
      const img = modal.querySelector('figure > img');
      if (!img) return false;

      // 뷰포트 컨테이너: MuiModal 직계 자식 중 백드롭이 아니고 크기가 있는 것
      let viewport = null;
      for (const child of modal.children) {
        if (child.classList.contains('MuiBackdrop-root')) continue;
        const r = child.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) { viewport = child; break; }
      }
      if (!viewport) return false;

      const vw = viewport.getBoundingClientRect().width;
      const vh = viewport.getBoundingClientRect().height;
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (!nw || !nh) return false;

      // 뷰포트에 맞는 크기 계산 (패딩 8px씩)
      const pad = 16;
      const maxW = vw - pad;
      const maxH = vh - pad;
      const scale = Math.min(maxW / nw, maxH / nh, 1); // 1 이상은 확대 안 함
      const fitW = Math.round(nw * scale);
      const fitH = Math.round(nh * scale);

      // img에 직접 크기 속성 + 인라인 스타일 둘 다 세팅
      img.setAttribute('width', fitW);
      img.setAttribute('height', fitH);
      img.style.setProperty('width', fitW + 'px', 'important');
      img.style.setProperty('height', fitH + 'px', 'important');
      img.style.setProperty('max-width', fitW + 'px', 'important');
      img.style.setProperty('max-height', fitH + 'px', 'important');
      img.style.setProperty('object-fit', 'contain', 'important');

      // Paper transform 리셋 → 이미지가 뷰포트 안에 바로 보이도록
      const paper = viewport.querySelector('.MuiPaper-root');
      if (paper) {
        paper.style.transform = 'translate3d(0, 0, 0)';
      }

      console.log(`%c[CE]%c Inspector 이미지 제한: ${nw}×${nh} → ${fitW}×${fitH} (viewport ${vw}×${vh})`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
      return true;
    }

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (!node.classList?.contains('MuiModal-root')) continue;
          // 여러 타이밍에 시도 (React 렌더링 + 이미지 로드 대기)
          const tryApply = () => {
            const img = node.querySelector('figure > img');
            if (!img) return;
            if (img.naturalWidth > 0) {
              constrainImg(node);
            } else {
              img.addEventListener('load', () => constrainImg(node), { once: true });
            }
          };
          setTimeout(tryApply, 50);
          setTimeout(tryApply, 150);
          setTimeout(tryApply, 400);
          setTimeout(tryApply, 800);
        }
      }
    });
    obs.observe(document.body, { childList: true });
  })();

  window.addEventListener('bwbr-native-zoom', (e) => {
    const imageUrl = e.detail?.imageUrl;
    if (!imageUrl || !reduxStore) {
      window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: false } }));
      return;
    }

    try {
      const creator = findSetedActionCreator();
      if (!creator) {
        window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: false } }));
        return;
      }

      const appState = reduxStore.getState().app?.state;
      const newState = { ...appState, openInspector: true, inspectImageUrl: imageUrl, inspectText: '' };
      const actionType = typeof creator === 'function' ? creator.type : creator.type;
      reduxStore.dispatch({ type: actionType, payload: newState });

      const check = reduxStore.getState().app?.state;
      if (check?.openInspector === true && check?.inspectImageUrl === imageUrl) {
        console.log('%c[CE]%c ✅ 네이티브 확대 보기 열림',
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
        window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: true } }));
      } else {
        window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: false } }));
      }
    } catch (err) {
      console.error('[CE] 네이티브 확대 보기 실패:', err);
      window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: false } }));
    }
  });

  // ================================================================
  //  [CORE] 룸 복사: 내보내기/가져오기
  //  bwbr-room-export, bwbr-room-import
  // ================================================================

  window.addEventListener('bwbr-room-export', () => {
    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('bwbr-room-export-result', { detail: data }));
    };

    try {
      if (!reduxStore) {
        respond({ success: false, error: 'Redux Store 없음' });
        return;
      }

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/\/rooms\/([^/]+)/)?.[1];
      if (!roomId) {
        respond({ success: false, error: 'roomId를 찾을 수 없음' });
        return;
      }

      // 방 이름
      const roomEntity = state.entities?.rooms?.entities?.[roomId];
      const roomName = roomEntity?.name
        || document.title?.replace(/ - ココフォリア$/, '').replace(/ - 코코포리아$/, '')
        || 'room';

      // 방 설정 (entities.rooms.entities[roomId])
      const roomSettings = roomEntity ? { ...roomEntity } : {};

      // 캐릭터 (entities.roomCharacters)
      const rc = state.entities?.roomCharacters;
      const characters = [];
      if (rc?.ids?.length) {
        for (const id of rc.ids) {
          const c = rc.entities[id];
          if (c) characters.push({ ...c });
        }
      }

      // 아이템/스크린패널 (entities.roomItems)
      const ri = state.entities?.roomItems;
      const items = [];
      if (ri?.ids?.length) {
        for (const id of ri.ids) {
          const item = ri.entities[id];
          if (item) items.push({ ...item });
        }
      }

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        sourceRoomId: roomId,
        roomName: roomName,
        roomSettings: roomSettings,
        characters: characters,
        items: items
      };

      console.log(`%c[CE]%c 📦 룸 데이터 내보내기: 방 설정 + 캐릭터 ${characters.length}개 + 아이템 ${items.length}개`,
        'color: #ce93d8; font-weight: bold;', 'color: inherit;');

      respond({ success: true, data: exportData, roomName: roomName });

    } catch (err) {
      console.error('[CE] 룸 데이터 내보내기 오류:', err);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  룸 복사: 가져오기 (bwbr-room-import)
  //  ISOLATED → DOM attr 'data-bwbr-room-import' 에 JSON 저장 → 이벤트 발행
  //  MAIN world에서 Firestore에 직접 쓰기
  // ================================================================

  /** Firestore 호환 문서 ID 생성 (20자 영숫자) */
  function _generateFirestoreId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 20; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  window.addEventListener('bwbr-room-import', async () => {
    const respond = (data) => {
      window.dispatchEvent(new CustomEvent('bwbr-room-import-result', { detail: data }));
    };

    try {
      // DOM 속성에서 JSON 데이터 읽기
      const raw = document.documentElement.getAttribute('data-bwbr-room-import');
      document.documentElement.removeAttribute('data-bwbr-room-import');
      if (!raw) {
        respond({ success: false, error: 'data-bwbr-room-import 속성에 데이터 없음' });
        return;
      }

      const importData = JSON.parse(raw);
      if (!importData.version) {
        respond({ success: false, error: '유효하지 않은 데이터 형식' });
        return;
      }

      const sdk = acquireFirestoreSDK();
      if (!sdk) {
        respond({ success: false, error: 'Firestore SDK 획득 실패' });
        return;
      }
      if (!reduxStore) {
        respond({ success: false, error: 'Redux Store 없음' });
        return;
      }

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/\/rooms\/([^/]+)/)?.[1];
      if (!roomId) {
        respond({ success: false, error: 'roomId를 찾을 수 없음' });
        return;
      }
      const uid = state.app?.state?.uid || '';

      console.log(`%c[CE]%c 📥 룸 데이터 가져오기 시작 (roomId: ${roomId})`,
        'color: #90caf9; font-weight: bold;', 'color: inherit;');

      // ── 1. 방 설정 덮어쓰기 (merge) ── (roomSettings가 null이면 건너뜀)
      let settingsUpdated = false;
      if (importData.roomSettings) {
        const roomSettingsBlacklist = new Set([
          // 방 정체성 & 소유 관련은 복사하지 않음
          '_id', 'id', 'owner', 'createdBy', 'uid',
          'members', 'memberCount', 'password',
          'createdAt', 'plan', 'planExpiredAt',
          'premium', 'pro', 'proExpiredAt'
        ]);
        const cleanSettings = {};
        for (const [key, value] of Object.entries(importData.roomSettings)) {
          if (!roomSettingsBlacklist.has(key)) {
            cleanSettings[key] = value;
          }
        }
        cleanSettings.updatedAt = Date.now();

        const roomCol = sdk.collection(sdk.db, 'rooms');
        const roomRef = sdk.doc(roomCol, roomId);
        await sdk.setDoc(roomRef, cleanSettings, { merge: true });
        settingsUpdated = true;
        console.log('%c[CE]%c   방 설정 업데이트 완료', 'color: #90caf9; font-weight: bold;', 'color: inherit;');
      } else {
        console.log('%c[CE]%c   방 설정 건너뜀 (선택 안 됨)', 'color: #90caf9; font-weight: bold;', 'color: #888;');
      }

      // ── 2. 캐릭터 복사 ──
      let charCount = 0;
      if (importData.characters?.length) {
        const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
        const ops = [];
        for (const char of importData.characters) {
          const newId = _generateFirestoreId();
          const charData = { ...char };
          // 원본 ID 제거, 새 소유자 설정
          delete charData._id;
          delete charData.id;
          charData.owner = uid;
          charData.roomId = roomId;
          charData.createdAt = Date.now();
          charData.updatedAt = Date.now();

          ops.push({ type: 'set', ref: sdk.doc(charsCol, newId), data: charData });
        }
        charCount = await _batchCommit(sdk, ops);
        console.log(`%c[CE]%c   캐릭터 ${charCount}개 생성 완료`, 'color: #90caf9; font-weight: bold;', 'color: inherit;');
      }

      // ── 3. 아이템/스크린패널 복사 ──
      let itemCount = 0;
      if (importData.items?.length) {
        const itemsCol = sdk.collection(sdk.db, 'rooms', roomId, 'items');
        const ops = [];
        for (const item of importData.items) {
          const newId = _generateFirestoreId();
          const itemData = { ...item };
          delete itemData._id;
          delete itemData.id;
          itemData.owner = uid;
          itemData.createdAt = Date.now();
          itemData.updatedAt = Date.now();

          ops.push({ type: 'set', ref: sdk.doc(itemsCol, newId), data: itemData });
        }
        itemCount = await _batchCommit(sdk, ops);
        console.log(`%c[CE]%c   아이템 ${itemCount}개 생성 완료`, 'color: #90caf9; font-weight: bold;', 'color: inherit;');
      }

      console.log(`%c[CE]%c ✅ 룸 데이터 가져오기 완료!`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      respond({ success: true, settingsUpdated, charCount, itemCount });

    } catch (err) {
      console.error('[CE] 룸 데이터 가져오기 오류:', err);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  이미지 업로드 유틸리티 (Firebase Storage via Cloud Function)
  //  data URL → uploadFileV2 → CDN URL 변환
  // ================================================================
  const _UPLOAD_ENDPOINT = 'https://asia-northeast1-ccfolia-160aa.cloudfunctions.net/uploadFileV2';
  const _CDN_BASE = 'https://storage.ccfolia-cdn.net/';
  const _FB_API_KEY = 'AIzaSyAMlcPs4ekVSBdzpRdEloqQ8lIgP9lEnRI';

  async function _getFirebaseAuthToken() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onerror = () => reject(new Error('IndexedDB 열기 실패'));
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
          return reject(new Error('firebaseLocalStorage store 없음'));
        }
        const tx = db.transaction('firebaseLocalStorage', 'readonly');
        const store = tx.objectStore('firebaseLocalStorage');
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const items = getAll.result;
          if (!items || items.length === 0) return reject(new Error('Auth 항목 없음'));
          const authItem = items[0].value;
          if (!authItem || !authItem.stsTokenManager) return reject(new Error('stsTokenManager 없음'));
          const stm = authItem.stsTokenManager;
          const uid = authItem.uid;
          // 토큰 만료 5분 전이면 갱신
          if (stm.expirationTime && Date.now() > stm.expirationTime - 300000) {
            _refreshFirebaseToken(stm.refreshToken).then(newToken => {
              resolve({ token: newToken, uid });
            }).catch(reject);
          } else {
            resolve({ token: stm.accessToken, uid });
          }
        };
        getAll.onerror = () => reject(new Error('Auth 읽기 실패'));
      };
    });
  }

  async function _refreshFirebaseToken(refreshToken) {
    const resp = await fetch(`https://securetoken.googleapis.com/v1/token?key=${_FB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    });
    if (!resp.ok) throw new Error('토큰 갱신 실패: ' + resp.status);
    const data = await resp.json();
    return data.access_token || data.id_token;
  }

  function _dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const b64 = atob(parts[1]);
    const arr = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) arr[i] = b64.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function _computeSha256(blob) {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * data URL을 Firebase Storage에 업로드하고 CDN URL을 반환
   * @param {string} dataUrl - data:image/webp;base64,... 형식
   * @returns {Promise<string>} CDN URL (https://storage.ccfolia-cdn.net/users/...)
   */
  async function _uploadImageToStorage(dataUrl) {
    const { token, uid } = await _getFirebaseAuthToken();
    const blob = _dataUrlToBlob(dataUrl);
    const sha256 = await _computeSha256(blob);
    const filePath = `users/${uid}/files/${sha256}`;

    const formData = new FormData();
    formData.append('file', blob, 'image.webp');
    formData.append('filePath', filePath);

    const resp = await fetch(_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`업로드 실패 (${resp.status}): ${text.slice(0, 200)}`);
    }

    const result = await resp.json();
    const cdnUrl = _CDN_BASE + result.name;
    _dbg(`%c[CE]%c ☁️ 이미지 업로드 완료: ${Math.round(blob.size / 1024)}KB → ${cdnUrl.slice(0, 80)}...`,
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
    return cdnUrl;
  }

  // ================================================================
  //  배치 모드: 패널(아이템) 생성
  //  Content Script에서 bwbr-create-panel 이벤트로 요청
  // ================================================================
  document.addEventListener('bwbr-create-panel', async () => {
    const _raw = document.documentElement.getAttribute('data-bwbr-create-panel');
    document.documentElement.removeAttribute('data-bwbr-create-panel');
    const panelData = _raw ? JSON.parse(_raw) : {};
    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-create-panel-result', JSON.stringify(detail));
      document.dispatchEvent(new CustomEvent('bwbr-create-panel-result', { detail }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const state = reduxStore.getState();
      const uid = state.app?.state?.uid || '';

      // data URL → Firebase Storage 업로드 → CDN URL
      let imageUrl = panelData.imageUrl || '';
      if (imageUrl.startsWith('data:')) {
        try {
          imageUrl = await _uploadImageToStorage(imageUrl);
        } catch (uploadErr) {
          _dbg('[CE] 이미지 업로드 실패, data URL 그대로 사용:', uploadErr.message);
        }
      }

      const itemsCol = sdk.collection(sdk.db, 'rooms', roomId, 'items');
      const newId = _generateFirestoreId();
      const newRef = sdk.doc(itemsCol, newId);

      const now = Date.now();
      const itemData = {
        type: panelData.type || 'plane',
        x: panelData.x ?? 0,
        y: panelData.y ?? 0,
        z: panelData.z ?? 150,
        width: panelData.width ?? 4,
        height: panelData.height ?? 4,
        angle: panelData.angle ?? 0,
        locked: panelData.locked ?? false,
        freezed: panelData.freezed ?? false,
        visible: true,
        closed: false,
        withoutOwner: false,
        active: true,
        owner: uid,
        ownerName: '',
        ownerColor: '',
        memo: panelData.memo || '',
        imageUrl: imageUrl,
        coverImageUrl: '',
        clickAction: '',
        deckId: null,
        order: -1,
        createdAt: now,
        updatedAt: now
      };

      await sdk.setDoc(newRef, itemData);

      _dbg(`%c[CE]%c ✅ 패널 생성: ${newId} (${itemData.type}, ${itemData.width}×${itemData.height})`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      respond({ success: true, id: newId });

    } catch (err) {
      console.error('[CE] 패널 생성 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  배치 모드: 마커 생성 (room.markers 필드에 추가)
  //  Content Script에서 bwbr-create-marker 이벤트로 요청
  // ================================================================
  document.addEventListener('bwbr-create-marker', async () => {
    const _raw = document.documentElement.getAttribute('data-bwbr-create-marker');
    document.documentElement.removeAttribute('data-bwbr-create-marker');
    const d = _raw ? JSON.parse(_raw) : {};
    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-create-marker-result', JSON.stringify(detail));
      document.dispatchEvent(new CustomEvent('bwbr-create-marker-result', { detail }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const markerKey = Date.now().toString(16);
      let imageUrl = d.imageUrl || '';

      // data URL → Firebase Storage 업로드 → CDN URL
      if (imageUrl.startsWith('data:')) {
        try {
          imageUrl = await _uploadImageToStorage(imageUrl);
        } catch (uploadErr) {
          _dbg('[CE] 마커 이미지 업로드 실패:', uploadErr.message);
          // 업로드 실패 시 이미지 없이 생성
          imageUrl = '';
        }
      }

      const markerData = {
        x: d.x ?? 0,
        y: d.y ?? 0,
        z: d.z ?? 50,
        width: d.width ?? 4,
        height: d.height ?? 4,
        locked: d.locked ?? false,
        freezed: d.freezed ?? false,
        text: d.memo || '',
        imageUrl: imageUrl,
        clickAction: null
      };

      const roomRef = sdk.doc(sdk.collection(sdk.db, 'rooms'), roomId);
      const now = Date.now();

      if (sdk.writeBatch) {
        const batch = sdk.writeBatch(sdk.db);
        batch.update(roomRef, {
          [`markers.${markerKey}`]: markerData,
          updatedAt: now
        });
        await batch.commit();
      } else {
        await sdk.setDoc(roomRef, {
          markers: { [markerKey]: markerData },
          updatedAt: now
        }, { merge: true });
      }

      _dbg(`%c[CE]%c ✅ 마커 생성: ${markerKey} (${markerData.width}×${markerData.height})`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      respond({ success: true, id: markerKey });

    } catch (err) {
      console.error('[CE] 마커 생성 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  배치 모드: 패널 일괄 생성 (스테이징 → 확정)
  //  Content Script에서 bwbr-create-panels-batch 이벤트로 요청
  // ================================================================
  document.addEventListener('bwbr-create-panels-batch', async () => {
    const _raw = document.documentElement.getAttribute('data-bwbr-create-panels-batch');
    document.documentElement.removeAttribute('data-bwbr-create-panels-batch');
    const panels = _raw ? JSON.parse(_raw) : [];
    const respond = (detail) => {
      document.documentElement.setAttribute('data-bwbr-create-panels-batch-result', JSON.stringify(detail));
      document.dispatchEvent(new CustomEvent('bwbr-create-panels-batch-result', { detail }));
    };

    try {
      const sdk = acquireFirestoreSDK();
      if (!sdk) throw new Error('Firestore SDK 없음');
      if (!reduxStore) throw new Error('Redux Store 없음');

      const roomId = getRoomId();
      if (!roomId) throw new Error('방 ID를 찾을 수 없음');

      const state = reduxStore.getState();
      const uid = state.app?.state?.uid || '';
      const itemsCol = sdk.collection(sdk.db, 'rooms', roomId, 'items');
      const now = Date.now();
      const ids = [];

      for (const p of panels) {
        const newId = _generateFirestoreId();
        const newRef = sdk.doc(itemsCol, newId);
        const itemData = {
          type: p.type || 'plane',
          x: p.x ?? 0,
          y: p.y ?? 0,
          z: p.z ?? 150,
          width: p.width ?? 4,
          height: p.height ?? 4,
          angle: p.angle ?? 0,
          locked: p.locked ?? false,
          freezed: p.freezed ?? false,
          visible: true,
          closed: false,
          withoutOwner: false,
          active: true,
          owner: uid,
          ownerName: '',
          ownerColor: '',
          memo: p.memo || '',
          imageUrl: p.imageUrl || '',
          coverImageUrl: '',
          clickAction: '',
          deckId: null,
          order: -1,
          createdAt: now,
          updatedAt: now
        };
        await sdk.setDoc(newRef, itemData);
        ids.push(newId);
      }

      _dbg(`%c[CE]%c ✅ 패널 일괄 생성: ${ids.length}개`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      respond({ success: true, ids });

    } catch (err) {
      console.error('[CE] 패널 일괄 생성 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  /* ══════════════════════════════════════════════════════════
   *  이미지 매니저 — 파일 카테고리 이동 / 파일 목록 조회
   * ══════════════════════════════════════════════════════════ */

  /**
   * bwbr-move-files-dir — 파일들의 카테고리(dir) 일괄 변경
   * payload: { fileIds: string[], targetDir: string }
   * response: bwbr-move-files-dir-result  { success, movedCount }
   */
  document.addEventListener('bwbr-move-files-dir', async () => {
    const el = document.documentElement;
    const raw = el.getAttribute('data-bwbr-move-files-dir');
    el.removeAttribute('data-bwbr-move-files-dir');

    function respond(data) {
      el.setAttribute('data-bwbr-move-files-dir-result', JSON.stringify(data));
      document.dispatchEvent(new CustomEvent('bwbr-move-files-dir-result'));
    }

    try {
      const { fileIds, targetDir } = JSON.parse(raw);
      if (!fileIds?.length || !targetDir) {
        return respond({ success: false, error: '잘못된 페이로드' });
      }

      const sdk = acquireFirestoreSDK();
      if (!sdk) return respond({ success: false, error: 'Firestore SDK 없음' });

      const state = reduxStore.getState();
      const uid = state.app?.state?.uid || state.app?.user?.uid || '';
      if (!uid) return respond({ success: false, error: 'UID 획득 실패' });

      const uf = state.entities?.userFiles;
      const filesCol = sdk.collection(sdk.db, 'users', uid, 'files');
      const now = Date.now();

      // ── Firestore 쓰기 ──
      let movedCount = 0;
      for (const fid of fileIds) {
        let docId = fid;
        if (!uf?.entities?.[fid] && uf?.ids) {
          for (const key of uf.ids) {
            if (uf.entities[key]?._id === fid) { docId = key; break; }
          }
        }
        const ref = sdk.doc(filesCol, docId);
        await sdk.setDoc(ref, { dir: targetDir, updatedAt: now }, { merge: true });
        movedCount++;
      }

      console.log(`[CE 이미지] ✅ ${movedCount}개 → ${targetDir} 이동`);
      respond({ success: true, movedCount });
    } catch (err) {
      console.error('[CE 이미지] 파일 이동 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  /**
   * bwbr-get-user-files — Redux에서 userFiles 목록 조회
   * payload: { dir?: string, roomId?: string }
   * response: bwbr-user-files-data  { files: [{_id, name, url, dir, createdAt, roomId}] }
   */
  document.addEventListener('bwbr-get-user-files', () => {
    const el = document.documentElement;
    const raw = el.getAttribute('data-bwbr-get-user-files');
    el.removeAttribute('data-bwbr-get-user-files');

    function respond(data) {
      el.setAttribute('data-bwbr-user-files-data', JSON.stringify(data));
      document.dispatchEvent(new CustomEvent('bwbr-user-files-data'));
    }

    try {
      const opts = raw ? JSON.parse(raw) : {};
      const state = reduxStore.getState();
      const uf = state.entities?.userFiles;
      if (!uf) return respond({ files: [] });

      // Redux 데이터에서 파일 목록 추출
      let files = uf.ids.map(id => {
        return uf.entities[id] || null;
      }).filter(Boolean);

      // archived(삭제된) 파일 제외
      files = files.filter(f => !f.archived);

      if (opts.dir) files = files.filter(f => f.dir === opts.dir);
      if (opts.roomId) files = files.filter(f => f.roomId === opts.roomId);

      const result = files.map(f => ({
        _id: f._id, name: f.name, url: f.url,
        dir: f.dir, createdAt: f.createdAt, roomId: f.roomId
      }));

      respond({ files: result });
    } catch (err) {
      console.error('[CE 이미지] 파일 목록 조회 실패:', err);
      respond({ files: [] });
    }
  });

  // ================================================================
  //  [CORE] 메시지 수정/삭제 + DOM 태깅
  // ================================================================

  /**
   * bwbr-edit-message — 메시지 텍스트 수정 (Firestore setDoc merge)
   * payload: { msgId: string, newText: string }
   * response: bwbr-edit-message-result { success, msgId, error? }
   */
  document.addEventListener('bwbr-edit-message', async () => {
    const el = document.documentElement;
    const raw = el.getAttribute('data-bwbr-edit-message');
    el.removeAttribute('data-bwbr-edit-message');

    function respond(data) {
      el.setAttribute('data-bwbr-edit-message-result', JSON.stringify(data));
      document.dispatchEvent(new CustomEvent('bwbr-edit-message-result'));
    }

    try {
      const payload = JSON.parse(raw);
      const { msgId, newText } = payload;
      if (!msgId || typeof newText !== 'string') {
        return respond({ success: false, msgId, error: 'invalid params' });
      }

      const sdk = acquireFirestoreSDK();
      if (!sdk) return respond({ success: false, msgId, error: 'no SDK' });

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) return respond({ success: false, msgId, error: 'no roomId' });

      const msgCol = sdk.collection(sdk.db, 'rooms', roomId, 'messages');
      const msgRef = sdk.doc(msgCol, msgId);

      const updateData = {
        text: newText,
        updatedAt: new Date()
      };
      // 시스템 메시지는 edited 플래그 설정하지 않음 (편집됨 표시 방지)
      if (payload.msgType !== 'system') {
        updateData.edited = true;
      }
      await sdk.setDoc(msgRef, updateData, { merge: true });

      respond({ success: true, msgId });
    } catch (err) {
      console.error('[CE] 메시지 수정 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  // ── MAIN world 삭제 추적 (onSnapshot 재삽입 방어) ──
  const _mainDeletedMsgIds = new Set();

  // Redux에서 삭제된 메시지 제거 (반복 호출 안전)
  function _purgeDeletedFromRedux() {
    if (_mainDeletedMsgIds.size === 0 || !reduxStore) return;
    try {
      const rm = reduxStore.getState().entities?.roomMessages;
      if (!rm || !rm.ids) return;
      for (const delId of _mainDeletedMsgIds) {
        const idx = rm.ids.indexOf(delId);
        if (idx !== -1) rm.ids.splice(idx, 1);
        if (rm.entities?.[delId]) delete rm.entities[delId];
      }
    } catch(e) { /* ignore */ }
  }

  /**
   * bwbr-delete-message — 메시지 삭제 (Firestore deleteDoc)
   * payload: { msgId: string }
   * response: bwbr-delete-message-result { success, msgId, error? }
   */
  document.addEventListener('bwbr-delete-message', async () => {
    const el = document.documentElement;
    const raw = el.getAttribute('data-bwbr-delete-message');
    el.removeAttribute('data-bwbr-delete-message');

    function respond(data) {
      el.setAttribute('data-bwbr-delete-message-result', JSON.stringify(data));
      document.dispatchEvent(new CustomEvent('bwbr-delete-message-result'));
    }

    try {
      const { msgId } = JSON.parse(raw);
      if (!msgId) return respond({ success: false, error: 'no msgId' });

      const sdk = acquireFirestoreSDK();
      if (!sdk) return respond({ success: false, msgId, error: 'no SDK' });

      const state = reduxStore.getState();
      const roomId = state.app?.state?.roomId
        || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
      if (!roomId) return respond({ success: false, msgId, error: 'no roomId' });

      const msgCol = sdk.collection(sdk.db, 'rooms', roomId, 'messages');
      const msgRef = sdk.doc(msgCol, msgId);

      await sdk.deleteDoc(msgRef);

      // MAIN world 삭제 추적 Set에 등록 (onSnapshot 재삽입 방어)
      _mainDeletedMsgIds.add(msgId);

      // Redux에서 즉시 제거
      _purgeDeletedFromRedux();

      respond({ success: true, msgId });
    } catch (err) {
      console.error('[CE] 메시지 삭제 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  /**
   * 메시지 DOM 태깅 — MuiListItem에 data-msg-id, data-msg-from, data-msg-type 주입
   * Redux roomMessages 순서와 DOM 순서를 매칭
   */
  function _tagMessageItems() {
    if (!reduxStore) return;

    const msgList = document.querySelector('ul.MuiList-root');
    if (!msgList) return;

    const allItems = msgList.querySelectorAll('.MuiListItem-root');
    if (allItems.length === 0) return;

    // display:none (삭제됨)인 아이템 제외 — 인덱스 어긋남 방지
    const items = [];
    for (let j = 0; j < allItems.length; j++) {
      if (allItems[j].style.display !== 'none') items.push(allItems[j]);
    }
    if (items.length === 0) return;

    const state = reduxStore.getState();
    const rm = state.entities?.roomMessages;
    if (!rm || !rm.ids || rm.ids.length === 0) return;

    // 현재 채널 감지
    const chInfo = _detectCurrentChannel();
    const currentChannel = chInfo?.channel || '';

    // onSnapshot이 다시 넣은 삭제 메시지를 Redux에서 재제거
    if (_mainDeletedMsgIds.size > 0) _purgeDeletedFromRedux();

    // 현재 채널에 해당하는 메시지만 필터 (채널이 비어있으면 전부, 삭제된 건 제외)
    const channelMsgs = [];
    for (let i = 0; i < rm.ids.length; i++) {
      const id = rm.ids[i];
      if (_mainDeletedMsgIds.has(id)) continue;  // 삭제된 메시지 스킵
      const ent = rm.entities?.[id];
      if (!ent) continue;
      if (currentChannel && ent.channel && ent.channel !== currentChannel) continue;
      channelMsgs.push(ent);
    }

    // DOM 순서와 Redux 순서 1:1 매칭 — 항상 전체 재태깅 (인덱스 어긋남 방지)
    const len = Math.min(items.length, channelMsgs.length);
    for (let i = 0; i < len; i++) {
      const item = items[i];
      const msg = channelMsgs[i];
      item.setAttribute('data-msg-id', msg._id);
      item.setAttribute('data-msg-from', msg.from || '');
      item.setAttribute('data-msg-type', msg.type || 'text');
    }
    // 초과 DOM 아이템 숨김 (삭제로 Redux < DOM인 경우)
    for (let i = len; i < items.length; i++) {
      items[i].style.display = 'none';
    }

    // 내 UID도 documentElement에 설정 (ISOLATED world에서 접근용)
    const myUid = state.app?.state?.uid || state.app?.user?.uid || '';
    if (myUid && document.documentElement.getAttribute('data-bwbr-my-uid') !== myUid) {
      document.documentElement.setAttribute('data-bwbr-my-uid', myUid);
    }

    // ISOLATED world에 태깅 완료 알림 → 삭제된 메시지 재숨김 등
    document.dispatchEvent(new CustomEvent('bwbr-tags-applied'));
  }

  // 메시지 태깅 MutationObserver 설정
  let _msgTagObserver = null;
  let _msgTagTimer = null;
  let _watchedMsgList = null;  // 현재 감시 중인 UL 참조

  function _startMessageTagging() {
    // 즉시 한 번 태깅
    _tagMessageItems();

    // MutationObserver로 메시지 리스트 변경 감시
    const msgList = document.querySelector('ul.MuiList-root');
    if (!msgList) {
      // 아직 DOM 준비 안 됨 — 재시도
      setTimeout(_startMessageTagging, 2000);
      return;
    }

    _watchedMsgList = msgList;

    if (_msgTagObserver) _msgTagObserver.disconnect();

    _msgTagObserver = new MutationObserver(() => {
      // 디바운스: 짧은 시간 내 여러 변경을 한 번에 처리
      if (_msgTagTimer) clearTimeout(_msgTagTimer);
      _msgTagTimer = setTimeout(_tagMessageItems, 150);
    });

    _msgTagObserver.observe(msgList, { childList: true, subtree: true });

    // Redux store 변경 감지 — 새 메시지 추가 시 재태깅
    if (reduxStore) {
      let _prevMsgCount = 0;
      reduxStore.subscribe(() => {
        const rm = reduxStore.getState().entities?.roomMessages;
        const count = rm?.ids?.length || 0;
        if (count !== _prevMsgCount) {
          _prevMsgCount = count;
          if (_msgTagTimer) clearTimeout(_msgTagTimer);
          _msgTagTimer = setTimeout(_tagMessageItems, 100);
        }
      });
    }

    // 탭 전환 감지: tablist의 aria-selected 변경 시 재태깅
    const tablist = document.querySelector('[role="tablist"]');
    if (tablist) {
      new MutationObserver(() => {
        if (_msgTagTimer) clearTimeout(_msgTagTimer);
        _msgTagTimer = setTimeout(_tagMessageItems, 200);
      }).observe(tablist, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
    }

    // UL 교체 감지 — React 리렌더로 UL이 바뀌면 observer 재연결
    setInterval(() => {
      const currentList = document.querySelector('ul.MuiList-root');
      if (currentList && currentList !== _watchedMsgList) {
        _watchedMsgList = currentList;
        if (_msgTagObserver) _msgTagObserver.disconnect();
        _msgTagObserver.observe(currentList, { childList: true, subtree: true });
        _tagMessageItems();
      }
    }, 2000);

    console.log('[CE] 메시지 DOM 태깅 시작');
  }

  // ISOLATED world에서 재태깅 요청 시 즉시 실행
  document.addEventListener('bwbr-retag-messages', () => {
    _tagMessageItems();
  });

  // 페이지 로드 후 태깅 시작
  if (document.readyState === 'complete') {
    setTimeout(_startMessageTagging, 1500);
  } else {
    window.addEventListener('load', () => setTimeout(_startMessageTagging, 1500));
  }

})();
