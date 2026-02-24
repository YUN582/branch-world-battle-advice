// ============================================================
// Redux Store Injector - 페이지 컨텍스트에서 Redux Store 획득
// MAIN world에서 실행되어 React internals에 접근
// Content Script와 CustomEvent로 통신
// ============================================================

(function() {
  'use strict';

  // 이미 로드되었으면 스킵
  if (window.__BWBR_REDUX_INJECTED) return;
  window.__BWBR_REDUX_INJECTED = true;

  let reduxStore = null;

  // ================================================================
  //  Firestore 직접 메시지 전송 설정
  //  코코포리아 업데이트 시 아래 값들을 COCOFOLIA_DATA_API.md 섹션 8 참조하여 갱신
  // ================================================================
  const _FS_CONFIG = {
    firestoreModId: 49631,   // Firestore SDK 함수 모듈
    dbModId: 5156,           // Firestore DB 인스턴스 모듈
    fsKeys: { setDoc: 'pl', doc: 'JU', collection: 'hJ', getDocs: 'PL' },
    dbKey: 'db'
  };

  let _wpRequire = null;
  let _firestoreSDK = null;  // { db, setDoc, doc, collection, getDocs }

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

      console.log(`%c[BWBR Redux]%c 사이드바 캐릭터 ${characters.length}명 선택됨`, 
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      return characters;
    } catch (e) {
      console.error('[BWBR Redux] 캐릭터 데이터 추출 실패:', e);
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
      
      console.log('%c[BWBR Redux]%c ✅ Store 획득 성공! 캐릭터 수: ' + charCount, 
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      // Content Script에 성공 알림
      window.dispatchEvent(new CustomEvent('bwbr-redux-ready', {
        detail: { success: true, characterCount: charCount }
      }));
      
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
          console.log('%c[BWBR Redux]%c ⚠️ Store를 찾을 수 없습니다.', 
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
      console.log('%c[BWBR Redux]%c ⚠️ roomMessages를 찾을 수 없습니다.',
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
              console.log('%c[BWBR Redux]%c 📋 메시지 엔티티 구조:',
                'color: #4caf50; font-weight: bold;', 'color: inherit;',
                '\n  키:', Object.keys(entity),
                '\n  전체:', JSON.parse(JSON.stringify(entity)));
            } catch (e) {}
          }

          let text = extractMessageText(entity);
          if (!text) {
            console.log('%c[BWBR Redux]%c ⚠️ 텍스트 필드 없음:',
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
        console.error('[BWBR Redux] 메시지 관찰 오류:', e);
      }
    });

    console.log('%c[BWBR Redux]%c ✅ 메시지 관찰 시작 (기존 %d개 등록)',
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
    console.log('%c[BWBR Redux]%c 메시지 관찰 중지',
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

    console.log(`%c[BWBR]%c ✅ Firestore 함수 자동 발견: collection=${collectionKey}, doc=${docKey}, setDoc=${setDocKey}`,
      'color: #4caf50; font-weight: bold;', 'color: inherit;');
    return { collection: collectionFn, doc: docFn, setDoc: setDocFn, getDocs: null };
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
      console.warn('[BWBR] webpack require 획득 실패');
      return null;
    }

    // Firestore 모듈 로드
    let fsMod = null;
    try { fsMod = req(_FS_CONFIG.firestoreModId); } catch (e) {}
    if (!fsMod || typeof fsMod !== 'object') {
      console.error('[BWBR] Firestore 모듈 로드 실패 (모듈 ID: ' + _FS_CONFIG.firestoreModId + ')');
      console.error('[BWBR] → 콘솔에서 실행: window.dispatchEvent(new CustomEvent("bwbr-discover-firestore"))');
      return null;
    }

    // DB 인스턴스 획득
    let db = null;
    try { db = req(_FS_CONFIG.dbModId)?.[_FS_CONFIG.dbKey]; } catch (e) {}
    if (!db) {
      console.error('[BWBR] Firestore DB 인스턴스 획득 실패 (모듈: ' + _FS_CONFIG.dbModId + ', 키: ' + _FS_CONFIG.dbKey + ')');
      return null;
    }

    // 1차: 알려진 키로 함수 찾기
    let setDocFn = fsMod[_FS_CONFIG.fsKeys.setDoc];
    let docFn = fsMod[_FS_CONFIG.fsKeys.doc];
    let collectionFn = fsMod[_FS_CONFIG.fsKeys.collection];
    let getDocsFn = fsMod[_FS_CONFIG.fsKeys.getDocs];

    // 검증
    if (typeof collectionFn === 'function' && typeof docFn === 'function' && typeof setDocFn === 'function') {
      try {
        const testRef = collectionFn(db, '__bwbr_validate__');
        if (testRef && testRef.type === 'collection') {
          _firestoreSDK = {
            db, setDoc: setDocFn, doc: docFn, collection: collectionFn,
            getDocs: typeof getDocsFn === 'function' ? getDocsFn : null
          };
          console.log('%c[BWBR]%c ✅ Firestore SDK 획득 성공 (알려진 키)',
            'color: #4caf50; font-weight: bold;', 'color: inherit;');
          return _firestoreSDK;
        }
      } catch (e) {}
    }

    // 2차: 자동 탐색
    console.log('%c[BWBR]%c 알려진 키 실패 → 자동 탐색 시작...',
      'color: #ff9800; font-weight: bold;', 'color: inherit;');
    const discovered = autoDiscoverFirestoreFunctions(fsMod, db);
    if (discovered) {
      // getDocs는 자동탐색으로 찾을 수 없으므로 알려진 키로 시도
      let fallbackGetDocs = fsMod[_FS_CONFIG.fsKeys.getDocs];
      _firestoreSDK = {
        db, ...discovered,
        getDocs: typeof fallbackGetDocs === 'function' ? fallbackGetDocs : null
      };
      return _firestoreSDK;
    }

    console.error('[BWBR] Firestore SDK 자동 탐색 실패!');
    console.error('[BWBR] → 콘솔에서 실행: window.dispatchEvent(new CustomEvent("bwbr-discover-firestore"))');
    return null;
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

    console.warn('[BWBR] getMessageContext: uid=' + uid +
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
      console.log(`%c[BWBR]%c ⚠️ 컷인 이펙트 없음: "${tag}"`,
        'color: #ff9800; font-weight: bold;', 'color: inherit;');
      return;
    }

    try {
      const effectsCol = sdk.collection(sdk.db, 'rooms', roomId, 'effects');
      const effectRef = sdk.doc(effectsCol, effectId);
      await sdk.setDoc(effectRef, { playTime: Date.now() }, { merge: true });
      console.log(`%c[BWBR]%c 🔊 컷인 재생: "${tag}" (${effectId})`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
    } catch (e) {
      console.error('[BWBR] 컷인 재생 실패:', e);
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
        console.warn('[BWBR] 메시지 컨텍스트 없음 (아직 메시지를 보낸 적 없음?)');
        return false;
      }
    }

    const state = reduxStore.getState();
    const roomId = state.app?.state?.roomId ||
      window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
    if (!roomId) {
      console.warn('[BWBR] roomId를 찾을 수 없음');
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
      console.error('[BWBR] Firestore 직접 전송 실패:', e);
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
      console.warn('[BWBR] _detectCurrentChannel error:', e);
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
      console.warn('[BWBR] bwbr-send-message-direct: 텍스트 없음 (data-bwbr-send-text 비어있음)');
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
      if (success && cutinTags.length > 0) {
        for (const tag of cutinTags) {
          triggerCutin(tag);
        }
      }
      // MAIN→ISOLATED: detail 전달 가능
      window.dispatchEvent(new CustomEvent('bwbr-send-message-result', {
        detail: { success, text }
      }));
    } catch (err) {
      console.error('[BWBR] Direct send error:', err);
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
      console.error('[BWBR] char-msg send error:', err);
      window.dispatchEvent(new CustomEvent('bwbr-char-msg-result', {
        detail: { success: false, text, error: err.message }
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

  // Content Script에서 캐릭터 데이터 요청 시 처리
  window.addEventListener('bwbr-request-characters', () => {
    if (!reduxStore) {
      // Store가 없으면 다시 시도
      if (setupStore()) {
        const chars = getCharacterData();
        window.dispatchEvent(new CustomEvent('bwbr-characters-data', {
          detail: { success: true, characters: chars }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('bwbr-characters-data', {
          detail: { success: false, characters: null }
        }));
      }
    } else {
      const chars = getCharacterData();
      window.dispatchEvent(new CustomEvent('bwbr-characters-data', {
        detail: { success: !!chars, characters: chars }
      }));
    }
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
            color: char.color || ''
          });
        }
      }
    }
    window.dispatchEvent(new CustomEvent('bwbr-all-characters-data', {
      detail: { characters }
    }));
  });

  // ================================================================
  //  캐릭터 단축키: 이미지 URL로 캐릭터 식별
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
      console.warn('[BWBR] 캐릭터 이름 입력 필드를 찾을 수 없습니다');
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

    console.log(`%c[BWBR]%c 🔄 발화 캐릭터 변경: ${name}`,
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
  //  :# 스테이터스 변경 명령 처리
  //  Content Script에서 bwbr-modify-status 이벤트로 요청
  // ================================================================
  window.addEventListener('bwbr-modify-status', async (e) => {
    const { targetName, statusLabel, operation, value } = e.detail || {};
    const respond = (detail) => window.dispatchEvent(
      new CustomEvent('bwbr-modify-status-result', { detail })
    );

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

      // 스테이터스 찾기
      const statusArr = target.status || [];
      const idx = statusArr.findIndex(s => s.label === statusLabel);
      if (idx < 0) throw new Error(`스테이터스 "${statusLabel}" 없음`);

      const oldVal = parseInt(statusArr[idx].value, 10) || 0;
      let newVal;
      switch (operation) {
        case '+': newVal = oldVal + value; break;
        case '-': newVal = oldVal - value; break;
        case '=': newVal = value; break;
        default: throw new Error(`잘못된 연산: ${operation}`);
      }

      // 새 status 배열 생성
      const newStatus = statusArr.map((s, i) => {
        if (i === idx) return { ...s, value: newVal };
        return { ...s };
      });

      // Firestore에 쓰기
      const charsCol = sdk.collection(sdk.db, 'rooms', roomId, 'characters');
      const targetRef = sdk.doc(charsCol, targetId);
      await sdk.setDoc(targetRef, { status: newStatus, updatedAt: Date.now() }, { merge: true });

      console.log(`%c[BWBR]%c ✅ ${targetName} ${statusLabel}: ${oldVal} → ${newVal}`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
      respond({ success: true, target: targetName, status: statusLabel, oldVal, newVal });

      // 코코포리아 시스템 메시지 형식으로 변경 내역 전송
      sendDirectMessage(
        `[ ${targetName} ] ${statusLabel} : ${oldVal} → ${newVal}`,
        { name: 'system', type: 'system', color: '#888888', iconUrl: null }
      ).catch(() => {});

    } catch (err) {
      console.error('[BWBR] 스테이터스 변경 실패:', err.message);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  진단용: roomMessages 구조 덤프
  //  콘솔에서 실행: window.dispatchEvent(new CustomEvent('bwbr-dump-messages'))
  // ================================================================
  window.addEventListener('bwbr-dump-messages', () => {
    if (!reduxStore) {
      console.log('%c[BWBR 진단]%c ❌ Redux Store 없음', 'color: #f44336; font-weight: bold;', 'color: inherit;');
      return;
    }
    try {
      const rm = reduxStore.getState().entities?.roomMessages;
      if (!rm || !rm.ids || rm.ids.length === 0) {
        console.log('%c[BWBR 진단]%c ⚠️ roomMessages가 비어있음. 채팅 메시지를 보낸 뒤 다시 시도하세요.',
          'color: #ff9800; font-weight: bold;', 'color: inherit;');
        return;
      }
      const lastId = rm.ids[rm.ids.length - 1];
      const lastEntity = rm.entities[lastId];
      console.log('%c[BWBR 진단]%c ===== roomMessages 구조 =====',
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
      console.log('%c[BWBR 진단]%c ===========================',
        'color: #2196f3; font-weight: bold;', 'color: inherit;');
    } catch (e) {
      console.error('[BWBR 진단] 오류:', e);
    }
  });

  // ================================================================
  //  진단용: 현재 채널 탐지 테스트
  //  콘솔에서 실행: window.dispatchEvent(new CustomEvent('bwbr-detect-channel'))
  // ================================================================
  window.addEventListener('bwbr-detect-channel', () => {
    console.log('%c[BWBR 진단]%c ===== 채널 탐지 테스트 =====',
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
    console.log('%c[BWBR 진단]%c ===========================',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  진단용: Firestore SDK 탐색
  //  콘솔에서 실행: window.dispatchEvent(new CustomEvent('bwbr-discover-firestore'))
  // ================================================================
  window.addEventListener('bwbr-discover-firestore', () => {
    console.log('%c[BWBR 진단]%c ===== Firestore SDK 탐색 =====',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');

    const req = acquireWebpackRequire();
    if (!req) {
      console.error('[BWBR 진단] webpack require 획득 실패');
      return;
    }

    // 1. Firestore 함수 포함 모듈 후보 찾기
    console.log('[BWBR 진단] 모듈 스캔 중...');
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
    console.log('[BWBR 진단] Firestore 모듈 후보:');
    console.table(candidates);

    // 2. DB 인스턴스 찾기
    console.log('[BWBR 진단] DB 인스턴스 탐색 중...');
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
      console.log(`[BWBR 진단] ✅ DB 인스턴스: 모듈=${dbInfo.moduleId}, 키=${dbInfo.key}`);
    } else {
      console.error('[BWBR 진단] ❌ DB 인스턴스를 찾을 수 없음');
    }

    // 3. 최고 후보로 함수 자동 매칭
    if (candidates.length > 0 && dbInfo) {
      const best = candidates.sort((a, b) => b.fsCount - a.fsCount)[0];
      console.log(`[BWBR 진단] 최고 후보 모듈: ${best.id} (Firestore 함수 ${best.fsCount}개)`);

      try {
        const fsMod = req(best.id);
        const db = req(dbInfo.moduleId)[dbInfo.key];
        const result = autoDiscoverFirestoreFunctions(fsMod, db);
        if (result) {
          console.log('%c[BWBR 진단]%c ✅ 자동 매칭 성공!', 'color: #4caf50; font-weight: bold;', 'color: inherit;');
          console.log('[BWBR 진단] _FS_CONFIG 업데이트 값:');
          console.log(JSON.stringify({
            firestoreModId: Number(best.id),
            dbModId: Number(dbInfo.moduleId),
            dbKey: dbInfo.key
          }, null, 2));
        } else {
          console.warn('[BWBR 진단] ⚠️ 자동 매칭 실패 — 수동 확인 필요');
          console.log('[BWBR 진단] 후보 모듈 ' + best.id + '의 함수 키:', best.funcKeys);
        }
      } catch (e) {
        console.error('[BWBR 진단] 오류:', e);
      }
    }

    console.log('%c[BWBR 진단]%c ===============================',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  채팅 로그 전체 추출 (Firestore 직접 쿼리)
  //  ISOLATED world에서 bwbr-export-log 이벤트로 요청
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

      console.log('%c[BWBR]%c 📜 로그 추출 시작... (roomId: ' + roomId + ')',
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

      console.log(`%c[BWBR]%c 📜 로그 추출 완료: ${messages.length}건`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      respond({ success: true, messages, roomId, roomName });

    } catch (e) {
      console.error('[BWBR] 로그 추출 실패:', e);
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
        console.log(`%c[BWBR]%c ✅ ${name} 편집 다이얼로그 열림 (ID: ${char.__id})`,
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
      } else {
        respondAction(name + ': 편집 다이얼로그 열기 실패');
      }
    } catch (err) {
      console.error('[BWBR] 편집 실패:', err);
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
                console.log(`%c[BWBR]%c ✅ ${name} 네이티브 ${actionLabel} (메뉴: "${t}")`,
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
            console.warn(`[BWBR] ${actionLabel} 실패: 메뉴 항목 미발견\n  찾은 항목: [${labels.join(', ')}]\n  검색 키워드: [${menuKeywords.join(', ')}]`);
            const bd = lastPop.querySelector('.MuiBackdrop-root');
            if (bd) bd.click(); else document.body.click();
          } else {
            console.warn(`[BWBR] ${actionLabel} 실패: MuiPopover-root 자체가 없음`);
          }
          respondAction(name + ': ' + actionLabel + ' 실패 — 메뉴 항목을 찾을 수 없습니다');
        }
      };
      setTimeout(tryClick, 60);
    } catch (err) {
      const hs = document.getElementById('bwbr-hide-native-menu');
      if (hs) hs.remove();
      console.error(`[BWBR] ${actionLabel} 실패:`, err);
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
        console.log(`%c[BWBR]%c ✅ ${name} 꺼내기 (Firestore direct)`,
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
        setTimeout(broadcastCharacterList, 500);
      } catch (err) {
        console.error('[BWBR] 꺼내기 실패:', err);
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
  //  전투 이동: 토큰 imageUrl로 roomItem → 캐릭터 데이터 조회
  //  bwbr-request-char-for-move (DOM attr: data-bwbr-move-imageurl)
  //  → bwbr-char-move-data { success, item, char }
  // ================================================================
  window.addEventListener('bwbr-request-char-for-move', () => {
    const el = document.documentElement;
    const imageUrl = el.getAttribute('data-bwbr-move-imageurl') || '';
    el.removeAttribute('data-bwbr-move-imageurl');

    const fail = () => window.dispatchEvent(
      new CustomEvent('bwbr-char-move-data', { detail: { success: false } })
    );

    if (!imageUrl || !reduxStore) return fail();

    const state = reduxStore.getState();
    const ri = state.entities?.roomItems;
    if (!ri?.ids) return fail();

    // URL 경로 추출 (쿼리 파라미터 제거)
    function extractPath(url) {
      try { return new URL(url).pathname; } catch (e) { return url; }
    }
    const clickedPath = extractPath(imageUrl);

    // 1) roomItems에서 imageUrl 매칭
    let item = null;
    for (const id of ri.ids) {
      const it = ri.entities?.[id];
      if (!it || !it.active) continue;
      if (!it.imageUrl) continue;
      // 정확히 일치 또는 경로 일치 (쿼리 파라미터 무시)
      if (it.imageUrl === imageUrl || extractPath(it.imageUrl) === clickedPath) {
        item = it;
        break;
      }
    }
    if (!item) {
      console.log(`[BWBR Move] roomItem imageUrl 매칭 실패: "${imageUrl.substring(0, 80)}..."`);
      return fail();
    }

    // 2) memo에서 〔캐릭터이름〕 파싱
    const memo = item.memo || '';
    const nameMatch = memo.match(/〔(.+?)〕/);
    if (!nameMatch) {
      console.log(`[BWBR Move] memo에 〔이름〕 없음: "${memo}"`);
      return fail();
    }
    const charName = nameMatch[1].trim();

    // 3) roomCharacters에서 이름 매칭
    const rc = state.entities?.roomCharacters;
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
      console.log(`[BWBR Move] 캐릭터 "${charName}" 미발견`);
      return fail();
    }

    console.log(`[BWBR Move] 매칭: item "${item._id}" → 캐릭터 "${found.name}"`);
    window.dispatchEvent(new CustomEvent('bwbr-char-move-data', {
      detail: {
        success: true,
        item: {
          _id: item._id,
          x: item.x ?? 0,
          y: item.y ?? 0,
          width: item.width ?? 4,
          height: item.height ?? 4
        },
        char: {
          _id: found._id,
          name: found.name || '',
          params: found.params || [],
          commands: found.commands || ''
        }
      }
    }));
  });

  // ================================================================
  //  전투 이동: 아이템(스크린 패널) 위치 이동 (Firestore 쓰기)
  //  bwbr-move-item { itemId, x, y }
  //  → bwbr-move-item-result { success }
  // ================================================================
  window.addEventListener('bwbr-move-item', async (e) => {
    const { itemId, x, y } = e.detail || {};
    const respond = (detail) => window.dispatchEvent(
      new CustomEvent('bwbr-move-item-result', { detail })
    );

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

      console.log(`%c[BWBR]%c ✅ 아이템 이동: ${itemId} → (${x}, ${y})`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
      respond({ success: true, itemId, x, y });
    } catch (err) {
      console.error('[BWBR] 아이템 이동 실패:', err);
      respond({ success: false, error: err.message });
    }
  });

  // ================================================================
  //  진단: Redux 상태 구조 덤프
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-redux-keys'))
  // ================================================================
  window.addEventListener('bwbr-dump-redux-keys', () => {
    if (!reduxStore) {
      console.error('[BWBR 진단] Redux Store 없음');
      return;
    }
    const state = reduxStore.getState();
    console.log('%c[BWBR 진단]%c ===== Redux 상태 구조 =====',
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
    console.log('%c[BWBR 진단]%c ===========================',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  // ================================================================
  //  진단: roomItems(스크린 패널) 상세 덤프
  //  콘솔: window.dispatchEvent(new CustomEvent('bwbr-dump-items'))
  // ================================================================
  window.addEventListener('bwbr-dump-items', () => {
    if (!reduxStore) {
      console.error('[BWBR 진단] Redux Store 없음');
      return;
    }
    const state = reduxStore.getState();
    const ri = state.entities.roomItems;
    if (!ri?.ids?.length) {
      console.log('[BWBR 진단] roomItems: 0건');
      return;
    }
    console.log('%c[BWBR 진단]%c ===== roomItems 상세 =====',
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
    console.log('%c[BWBR 진단]%c ============================',
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
      console.error('[BWBR] Redux Store 없음');
      return;
    }
    if (_origDispatch) {
      console.log('[BWBR] 이미 Action 로깅 중');
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
    console.log('%c[BWBR]%c ✅ Action 로깅 시작 (thunk 내부 포함) — 조작 후 콘솔을 확인하세요',
      'color: #4caf50; font-weight: bold;', 'color: inherit;');
  });

  window.addEventListener('bwbr-stop-log-actions', () => {
    if (_origDispatch) {
      reduxStore.dispatch = _origDispatch;
      _origDispatch = null;
      console.log('%c[BWBR]%c Action 로깅 해제',
        'color: #4caf50; font-weight: bold;', 'color: inherit;');
    } else {
      console.log('[BWBR] 로깅 중이 아닙니다');
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
    if (!reduxStore) return console.error('[BWBR] Redux Store 없음');
    _stateSnapshot = JSON.parse(JSON.stringify(reduxStore.getState().app?.state || {}));
    console.log('%c[BWBR]%c 📸 app.state 스냅샷 저장 완료 — 이제 조작하세요',
      'color: #2196f3; font-weight: bold;', 'color: inherit;');
  });

  window.addEventListener('bwbr-snapshot-after', () => {
    if (!reduxStore) return console.error('[BWBR] Redux Store 없음');
    if (!_stateSnapshot) return console.error('[BWBR] 먼저 bwbr-snapshot-before 실행하세요');

    const after = JSON.parse(JSON.stringify(reduxStore.getState().app?.state || {}));
    const allKeys = new Set([...Object.keys(_stateSnapshot), ...Object.keys(after)]);
    const changes = {};
    for (const key of allKeys) {
      const b = JSON.stringify(_stateSnapshot[key]);
      const a = JSON.stringify(after[key]);
      if (b !== a) changes[key] = { before: _stateSnapshot[key], after: after[key] };
    }

    console.log('%c[BWBR]%c 📸 app.state 변화:', 'color: #2196f3; font-weight: bold;', 'color: inherit;');
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
    if (!reduxStore) return console.error('[BWBR] Redux Store 없음');
    try {
      _deepSnapshot = JSON.parse(JSON.stringify(reduxStore.getState()));
      console.log('%c[BWBR]%c 🔬 전체 Redux state 스냅샷 저장됨 (키: %d)',
        'color: #e91e63; font-weight: bold;', 'color: inherit;',
        Object.keys(_deepSnapshot).length);
    } catch (e) {
      console.error('[BWBR] 스냅샷 실패 (순환 참조?):', e.message);
    }
  });

  window.addEventListener('bwbr-deep-snapshot-after', () => {
    if (!reduxStore) return console.error('[BWBR] Redux Store 없음');
    if (!_deepSnapshot) return console.error('[BWBR] 먼저 bwbr-deep-snapshot-before 실행하세요');

    let current;
    try {
      current = JSON.parse(JSON.stringify(reduxStore.getState()));
    } catch (e) {
      return console.error('[BWBR] 현재 상태 직렬화 실패:', e.message);
    }

    const diffs = [];
    deepDiff(_deepSnapshot, current, 'state', diffs, 0);

    console.log('%c[BWBR]%c 🔬 전체 Redux state 변화 (%d건):',
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
                    console.log(`%c[BWBR]%c ✅ seted action creator 발견: type="${testType}" (module ${ids[mi]}, key "${key}")`,
                      'color: #4caf50; font-weight: bold;', 'color: inherit;');
                    return _setedActionCreator;
                }
              }
            }
          }
        } catch { /* skip module */ }
      }
      console.log('[BWBR] webpack 모듈 검색 완료, seted 미발견 → 인터셉터 대기');
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
              console.log(`%c[BWBR]%c ✅ app.state type 발견 (브루트포스): "${type}"`,
                'color: #4caf50; font-weight: bold;', 'color: inherit;');
              return _setedActionCreator;
          }
        }
      }
    }

    console.warn('[BWBR] app.state action type 탐색 실패 — 인터셉터로 캡처 대기 중');
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
              console.log(`%c[BWBR]%c ✅ seted action type 캡처됨: "${innerAction.type}"`,
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
  //  네이티브 그리드 상태 감시 (displayGrid)
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

      console.log(`%c[BWBR]%c 그리드 토글: displayGrid = ${grid.value} → ${next}`,
        'color: #4caf50; font-weight: bold;', 'color: inherit;');

      window.dispatchEvent(new CustomEvent('bwbr-toggle-native-grid-result', {
        detail: { success: true, roomId: grid.roomId, value: next }
      }));
    } catch (err) {
      console.error('[BWBR] 네이티브 그리드 토글 실패:', err);
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
          console.log(`%c[BWBR]%c displayGrid 변경 감지: ${curVal}`,
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
        console.log('%c[BWBR]%c displayGrid 감시 시작',
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
      }
    }, 500);
  }

  // ── 네이티브 그리드 DOM 진단 ──
  // displayGrid=true 상태에서 zoom container의 전체 자식을 덤프
  window.addEventListener('bwbr-inspect-native-grid', () => {
    const movable = document.querySelector('.movable');
    if (!movable) {
      console.error('[BWBR] .movable 없음 — 방에 입장하세요');
      return;
    }
    const zoom = movable.parentElement;
    console.group('%c[BWBR]%c zoom container 자식 목록 (displayGrid 활성 상태에서 실행)',
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

      console.log(`%c[BWBR]%c Inspector 이미지 제한: ${nw}×${nh} → ${fitW}×${fitH} (viewport ${vw}×${vh})`,
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
        console.log('%c[BWBR]%c ✅ 네이티브 확대 보기 열림',
          'color: #4caf50; font-weight: bold;', 'color: inherit;');
        window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: true } }));
      } else {
        window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: false } }));
      }
    } catch (err) {
      console.error('[BWBR] 네이티브 확대 보기 실패:', err);
      window.dispatchEvent(new CustomEvent('bwbr-native-zoom-result', { detail: { success: false } }));
    }
  });

})();
