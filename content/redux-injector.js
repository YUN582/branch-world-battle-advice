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
    fsKeys: { setDoc: 'pl', doc: 'JU', collection: 'hJ' },
    dbKey: 'db'
  };

  let _wpRequire = null;
  let _firestoreSDK = null;  // { db, setDoc, doc, collection }

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
    return { collection: collectionFn, doc: docFn, setDoc: setDocFn };
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

    // 검증
    if (typeof collectionFn === 'function' && typeof docFn === 'function' && typeof setDocFn === 'function') {
      try {
        const testRef = collectionFn(db, '__bwbr_validate__');
        if (testRef && testRef.type === 'collection') {
          _firestoreSDK = { db, setDoc: setDocFn, doc: docFn, collection: collectionFn };
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
      _firestoreSDK = { db, ...discovered };
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
      console.warn('[BWBR] 메시지 컨텍스트 없음 (아직 메시지를 보낸 적 없음?)');
      return false;
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
        name: ctx.name,
        channel: ctx.channel,
        channelName: ctx.channelName,
        color: ctx.color,
        iconUrl: ctx.iconUrl,
        imageUrl: null,
        from: ctx.from,
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

})();
