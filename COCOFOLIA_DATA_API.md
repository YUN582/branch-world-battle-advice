# 코코포리아 내부 데이터 접근 가이드

> 코코포리아(ccfolia.com)의 내부 구조를 리버스 엔지니어링하여 정리한 비공식 문서입니다.
> Chrome 확장 프로그램(Content Script)에서 코코포리아 데이터를 읽고 쓰는 방법을 다룹니다.
>
> **주의**: 코코포리아는 React + Redux + Firebase(Firestore) + webpack으로 구성되어 있으며,
> 업데이트 시 webpack 모듈 ID 및 minified 프로퍼티명이 변경될 수 있습니다.
>
> 아래 모듈 ID·프로퍼티명은 **2026-02-16 기준**이며, 변경 시 재탐색이 필요합니다.

---

## 목차

1. [Redux Store 획득](#1-기본-접근-redux-store)
2. [캐릭터 데이터 구조](#2-캐릭터-데이터-구조-roomcharacters)
3. [Firestore 직접 접근 (읽기 + 쓰기)](#3-firestore-직접-접근-읽기--쓰기)
4. [webpack require 획득 방법](#4-webpack-require-획득-방법)
5. [Redux Store 획득 코드](#5-redux-store-획득-방법)
6. [캐릭터 셀렉터 함수](#6-캐릭터-셀렉터-함수-모듈-88464)
7. [주의사항 & 트러블슈팅](#주의사항--트러블슈팅)

---

## 1. 기본 접근: Redux Store

### 획득 방법

> 아래 코드는 Content Script의 **MAIN world** 또는 페이지 컨텍스트에서 실행해야 합니다.
> Manifest V3에서는 `world: "MAIN"`으로 주입하거나, `<script>` 태그를 inject하여 실행합니다.

```js
// React Fiber에서 Redux store 추출
const root = document.getElementById('root');
const fk = Object.keys(root).find(k =>
  k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')
);
let fiber = root[fk];
// fiber 트리를 순회하며 Provider의 context value에서 store 발견
// store는 { dispatch, getState, subscribe } 메서드를 가진 Redux store

// 획득 후 전역에 저장해두면 편리 (변수명은 자유)
window.__MY_REDUX = store;
```

> 전체 획득 코드는 [섹션 5](#5-redux-store-획득-방법) 참조.

### Store 구조

```
store.getState() = {
  app: {
    state: {
      roomId: "UlLwzdRUU",   // 현재 방 ID (URL의 /rooms/{roomId})
      role: null,
      uid: "...",             // 현재 유저 UID
      loading: false,
      ...
    },
    chat: { inputText: "" },
    user: { ... },
    emotes: { ... },
    dicerolls: { ... },
    room: {
      members: { ids: [...], entities: {...} }
    }
  },
  entities: {
    rooms:            { ids: [], entities: {} },
    roomCharacters:   { ids: [...], entities: {...}, idsGroupBy: {...} },  // ★ 핵심
    roomEffects:      { ids: [], entities: {} },
    roomDices:        { ids: [], entities: {} },
    roomDecks:        { ids: [], entities: {} },
    roomItems:        { ids: [], entities: {} },
    roomMembers:      { ids: [], entities: {} },
    roomMessages:     { ids: [], entities: {} },
    roomNotes:        { ids: [], entities: {} },
    roomSavedatas:    { ids: [], entities: {} },
    roomScenes:       { ids: [], entities: {} },
    userFiles:        { ids: [], entities: {} },
    userMedia:        { ids: [], entities: {} },
    userMediumDirectories: { ids: [], entities: {} },
    userHistories:    { ids: [], entities: {} },
    userSetting:      { ... },
    roomHistories:    { ids: [], entities: {} },
    turboRooms:       {}
  }
}
```

---

## 2. 캐릭터 데이터 구조 (roomCharacters)

### 접근 방법

```js
const state = store.getState();
const rc = state.entities.roomCharacters;

// 모든 캐릭터 ID
rc.ids  // ['1tXe9vwTpztkz6ihA04v', '2hUcf57mPHJSz479Yl2t', ...]

// 특정 캐릭터
rc.entities['캐릭터ID']

// 활성(맵에 배치된) 캐릭터만
rc.ids.map(id => rc.entities[id]).filter(c => c.active)

// 이름으로 찾기
rc.ids.map(id => rc.entities[id]).find(c => c.name?.includes('캐릭터이름'))
```

### 캐릭터 객체 키 (28개)

```js
{
  _id: "5IBePSZkicqvVUp0ZVmk",     // Firestore 문서 ID
  name: "캐릭터이름",                   // 캐릭터 이름 (이모지 포함 가능)
  playerName: "",                     // 플레이어 이름
  memo: "",                           // 메모
  initiative: 0,                      // 이니셔티브 (행동순서)
  externalUrl: "",                    // 외부 URL
  status: [...],                      // ★ 상태바 배열 (아래 참조)
  params: [...],                      // ★ 파라미터 배열 (아래 참조)
  iconUrl: "...",                     // 아이콘 이미지 URL
  faces: [...],                       // 얼굴 표정 배열
  x: 0, y: 0, z: 0,                  // 맵 좌표
  angle: 0,                           // 회전 각도
  width: 4, height: 4,                // 토큰 크기
  active: true,                       // 맵에 활성화 여부
  secret: false,                      // 비밀 여부
  invisible: false,                   // 숨김 여부
  hideStatus: false,                  // 상태바 숨김
  color: "#...",                      // 캐릭터 색상
  roomId: null,                       // (null인 경우 있음, URL에서 획득)
  commands: "...",                    // 채팅 명령어 텍스트
  owner: "...",                       // 소유자 UID
  speaking: false,                    // 현재 발화 중
  diceSkin: "...",                    // 주사위 스킨
  createdAt: 1234567890,              // 생성 시각
  updatedAt: 1234567890               // 수정 시각
}
```

### status[] — 상태바 (토큰 위에 표시)

**가변적!** 캐릭터마다 항목 수와 label이 다를 수 있습니다.
방(Room)의 시스템 설정에 따라 자유롭게 정의됩니다.

```js
// 구조: { label: string, value: number, max: number }
status: [
  { label: "HP",     value: 50, max: 100 },  // 예: 체력
  { label: "MP",     value: 30, max: 50  },  // 예: 마나
  { label: "장갑",   value: 5,  max: 5   },  // 예: 방어력
  { label: "독",     value: 0,  max: 1   },  // 예: 상태이상 플래그
  // ... 방마다 항목이 다름
]
```

**주의**: 인덱스 번호가 아니라 **label로 검색**해야 안전합니다!
```js
// label로 안전하게 찾기
const hp = char.status.find(s => s.label.includes('HP'));
const mp = char.status.find(s => s.label.includes('MP'));
```

### params[] — 캐릭터 파라미터

status와 마찬가지로 방의 시스템 설정에 따라 자유롭게 정의됩니다.

```js
// 구조: { label: string, value: string }
params: [
  { label: "STR",    value: "14" },
  { label: "DEX",    value: "12" },
  { label: "CON",    value: "10" },
  { label: "INT",    value: "8"  },
  { label: "WIS",    value: "13" },
  { label: "CHA",    value: "16" },
  { label: "이름",   value: "캐릭터이름" },
  // ... 방마다 항목이 다름
]
```

**주의**: value는 항상 **문자열(string)**입니다! 숫자로 쓰려면 `parseInt()` 또는 `Number()` 변환 필요.

```js
const str = char.params.find(p => p.label === 'STR');
const strValue = parseInt(str.value, 10);  // 14 (number)
```

---

## 3. Firestore 직접 접근 (읽기 + 쓰기)

### webpack 모듈 ID (2026-02-16 기준, 변경될 수 있음!)

| 모듈 ID | 내용 |
|---------|------|
| `49631` | Firestore SDK 함수: setDoc, doc, collection, getFirestore 등 |
| `5156`  | Firestore DB 인스턴스 (`db` 키) |
| `88464` | 캐릭터 셀렉터: getCharacterById, getRoomActiveCharacterIds 등 |
| `21579` | CharacterRecord, CharacterRecord_V2 (데이터 정규화 함수) |
| `51784` | Room 관련 thunk (50개+ 함수) |
| `2260`  | 정렬/순서 관련 유틸 |

### Firestore 함수 매핑

```js
// webpackRequire는 섹션 4에서 획득한 webpack require 함수
const fsMod = webpackRequire(49631);
const setDoc    = fsMod.pl;    // setDoc(docRef, data, options)
const doc       = fsMod.JU;    // doc(collectionRef, docId)
const collection = fsMod.hJ;   // collection(db, ...pathSegments)
const getDoc    = fsMod.QT;    // getDoc(docRef)
const getDocs   = fsMod.PL;    // getDocs(queryRef)
const deleteDoc = fsMod.oe;    // deleteDoc(docRef)

const db = webpackRequire(5156).db;  // Firestore 인스턴스
```

### Firestore 문서 경로

```
rooms/{roomId}/characters/{characterId}
```

- `roomId`: `store.getState().app.state.roomId` 또는 URL에서 `/rooms/{roomId}` 추출
- `characterId`: `character._id`

### 캐릭터 status 수정 예시

```js
(async () => {
  // 사전 준비: 섹션 4, 5의 코드를 먼저 실행해두세요
  const fsMod      = webpackRequire(49631);
  const setDoc     = fsMod.pl;
  const docFn      = fsMod.JU;
  const collectionFn = fsMod.hJ;
  const db         = webpackRequire(5156).db;

  const state  = store.getState();  // 섹션 5에서 획득한 Redux store
  const roomId = state.app.state.roomId
    || window.location.pathname.match(/rooms\/([^/]+)/)?.[1];
  const rc = state.entities.roomCharacters;

  // 대상 캐릭터 찾기
  const target = rc.ids.map(id => rc.entities[id])
    .find(c => c.name?.includes('캐릭터이름'));
  if (!target) return console.log('캐릭터 못 찾음');

  // doc ref 생성
  const charsCol  = collectionFn(db, 'rooms', roomId, 'characters');
  const targetRef = docFn(charsCol, target._id);

  // status 수정 예시: HP를 10 감소
  const newStatus = target.status.map(s => {
    if (s.label.includes('HP')) {
      return { ...s, value: Math.max(0, s.value - 10) };
    }
    return { ...s };
  });

  // Firestore에 쓰기
  await setDoc(targetRef, { status: newStatus, updatedAt: Date.now() }, { merge: true });
  console.log('업데이트 완료');
})();
```

### 중요 사항

1. **setDoc은 merge:true로 사용** — 전체 문서를 덮어쓰지 않고 지정 필드만 업데이트
2. **status 변경 시 전체 배열을 보내야 함** — Firestore는 배열 부분 업데이트를 지원하지 않음
3. **updatedAt: Date.now()** 필수 — 코코포리아가 변경 감지에 사용
4. **수정 시 코코포리아 채팅에 자동 시스템 메시지 생성** — `[ 캐릭이름 ] HP : 50 → 40` 형태
5. **Redux store는 Firestore 리스너로 자동 동기화됨** — Firestore에 쓰면 store도 자동 업데이트

---

## 4. webpack require 획득 방법

cocofolio 내부의 webpack 모듈에 접근하려면, webpack의 chunk loading 메커니즘을 이용해
`require` 함수를 탈취합니다.

```js
// 최초 1회 실행 — 페이지 컨텍스트(MAIN world)에서 실행해야 함
const chunks = window.webpackChunkccfolia;  // 코코포리아의 webpack chunk 배열
chunks.push([[999999], {}, (require) => {
  // require = webpack 내부의 __webpack_require__ 함수
  // 전역에 저장해두면 이후 모듈 접근에 사용 가능 (변수명은 자유)
  window.webpackRequire = require;
}]);
```

> **원리**: webpack은 `webpackChunkccfolia.push()`를 오버라이드하여 chunk를 등록합니다.
> 가짜 chunk를 push하면 3번째 인자로 `__webpack_require__`를 받을 수 있습니다.
> 이후 `webpackRequire(모듈ID)`로 코코포리아 내부의 어떤 모듈이든 접근 가능합니다.

---

## 5. Redux Store 획득 방법

React Fiber 트리를 순회하여 Redux `<Provider>`의 context에서 store를 추출합니다.

```js
// 페이지 컨텍스트(MAIN world)에서 실행
function getReduxStore() {
  const root = document.getElementById('root');
  const fk = Object.keys(root).find(k =>
    k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')
  );
  let fiber = root[fk];
  let depth = 0;
  while (fiber && depth < 30) {
    const ctx = fiber.memoizedProps?.value?.store;
    if (ctx?.getState) return ctx; // Redux store 발견!
    fiber = fiber.child || fiber.sibling || fiber.return?.sibling;
    depth++;
  }
  return null;
}

// 사용
const store = getReduxStore();
if (store) {
  console.log('Redux store 획득 성공');
  console.log(store.getState());  // 전체 상태 확인
} else {
  console.log('store를 찾지 못했습니다 — 코코포리아 로드 완료 후 재시도');
}
```

> **팁**: 코코포리아 페이지가 완전히 로드된 후 실행해야 합니다.
> Content Script에서는 `document_idle` 또는 `setTimeout`으로 타이밍을 조절하세요.

---

## 6. 캐릭터 셀렉터 함수 (모듈 88464)

코코포리아가 내부적으로 사용하는 셀렉터 함수들입니다.
Redux store의 state를 인자로 전달하면 캐릭터 데이터를 편리하게 조회할 수 있습니다.

```js
const selectors = webpackRequire(88464);

selectors.getCharacterById(state, charId)           // 특정 캐릭터
selectors.getRoomCharacterIds(state)                  // 모든 캐릭터 ID
selectors.getRoomActiveCharacterIds(state)             // 활성 캐릭터 ID
selectors.getMyRoomCharacterIds(state)                 // 내 캐릭터 ID
selectors.getMyRoomActiveCharacterIds(state)            // 내 활성 캐릭터 ID
selectors.getRoomShowStatusCharacterIds(state)          // 상태바 표시 캐릭터 ID
selectors.getCharacterCountByName(state)               // 이름별 캐릭터 수
selectors.getUserCharacterByName(state)                // 유저별 캐릭터
selectors.getSortedMyRoomCharacterIds(state)            // 정렬된 내 캐릭터 ID
```

---

## 주의사항 & 트러블슈팅

### 모듈 ID가 바뀌었을 때

코코포리아 업데이트 시 webpack 모듈 ID(`49631`, `5156` 등)가 변경될 수 있습니다.
이 경우 함수 시그니처(`toString()`)로 재탐색해야 합니다.

```js
// 예: setDoc 함수 찾기 — 모든 모듈을 순회
for (const id of Object.keys(webpackRequire.m)) {
  try {
    const mod = webpackRequire(id);
    for (const key of Object.keys(mod || {})) {
      if (typeof mod[key] === 'function' && mod[key].toString().includes('setDoc')) {
        console.log(`모듈 ${id}, 키 ${key}:`, mod[key].toString().substring(0, 100));
      }
    }
  } catch (e) {}
}
```

### Minified 프로퍼티명이 바뀌었을 때

`fsMod.pl`, `fsMod.JU` 등의 프로퍼티명도 코드 minification으로 변경됩니다.
함수 내용으로 식별하세요:

| 원래 함수 | 식별 힌트 |
|-----------|----------|
| `setDoc`  | 인자 3개 `(e, t, n)`, 내부에 `merge` 관련 로직 |
| `doc`     | 인자 2개 `(e, t)`, DocumentReference 반환 |
| `collection` | 인자 가변, CollectionReference 반환 |

### Content Script 실행 컨텍스트

위 코드들은 **페이지의 JavaScript 컨텍스트**(MAIN world)에서 실행해야 합니다.
Chrome 확장의 content script는 기본적으로 격리된 환경(ISOLATED world)에서 실행되므로,
다음 중 하나의 방법을 사용하세요:

```json
// manifest.json — Manifest V3
"content_scripts": [{
  "matches": ["https://ccfolia.com/*"],
  "js": ["inject.js"],
  "world": "MAIN",
  "run_at": "document_idle"
}]
```

또는 ISOLATED world에서 `<script>` 태그를 주입:

```js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-script.js');
document.head.appendChild(script);
```

### 기타

- **Firebase 프로젝트**: `ccfolia-160aa` (Firestore URL에서 확인됨)
- `store.subscribe(callback)`으로 상태 변경을 실시간 감시 가능
- Firestore에 쓰면 Redux store는 **자동 동기화**됨 (코코포리아 내부 리스너)
