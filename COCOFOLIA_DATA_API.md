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
8. [업데이트 대응 가이드](#8-업데이트-대응-가이드)

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
    roomMessages:     { ids: [...], entities: {...} },  // ★ 채팅 메시지
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

## 2. 채팅 메시지 데이터 구조 (roomMessages)

### 접근 방법

```js
const state = store.getState();
const rm = state.entities.roomMessages;

// 모든 메시지 ID
rm.ids  // ['wS3hS6uX8p8sDKmHNzw9', '2Ms7YLSavtjcuSR9Q0M2', ...]

// 특정 메시지
rm.entities['메시지ID']

// 새 메시지 감지 (store.subscribe)
let prevIds = new Set(rm.ids);
store.subscribe(() => {
  const currentIds = store.getState().entities.roomMessages.ids;
  for (const id of currentIds) {
    if (!prevIds.has(id)) { /* 새 메시지 */ }
  }
});
```

### 메시지 엔티티 객체 키 (16개)

```js
{
  _id: "wuBPrG6K9cb6xXux0Z3j",      // Firestore 문서 ID
  type: "text",                       // 메시지 타입 ("text" 등)
  text: "《🔺주 행동 소비》| ...",    // ★ 메시지 본문 텍스트
  name: "아델하이트 엘 레온하츠",       // 발신 캐릭터 이름
  channel: "RleEHkuPK",               // ★ 채널 ID (탭 구분용)
  channelName: "주사위 굴림 연습",      // 채널 표시 이름
  from: "Az1rUAx4twV0X4HydDH...",     // 발신 사용자 UID
  to: null,                            // 수신자 (null = 전체, 귓속말 시 UID)
  toName: "",                          // 수신자 이름
  color: "#e0e0e0",                    // 메시지 색상
  iconUrl: "https://storage...",       // 캐릭터 아이콘 URL
  imageUrl: null,                      // 첨부 이미지 URL (없으면 null)
  extend: { roll: { ... } },            // ★ 확장 데이터 (주사위 결과 — 아래 참조)
  createdAt: { seconds: ..., ... },    // 생성 시각 (Firestore Timestamp)
  updatedAt: { seconds: ..., ... },    // 수정 시각
  edited: false                        // 편집 여부
}
```

### extend 필드 (주사위 결과)

주사위 명령(`1D20`, `2D6` 등)의 결과는 `text`가 아닌 `extend` 객체에 저장됩니다.
DOM에서는 text + extend가 함께 렌더링되지만, Redux에서는 별도 추출이 필요합니다.

```js
// 주사위 메시지 예시
{
  text: "1D20 ⚔️ 스칼라",     // 명령어만 (결과 없음)
  extend: {
    roll: {
      critical: false,         // 대성공 여부
      dices: [{...}],           // 개별 주사위 결과 배열
      failure: false,           // 실패 여부
      fumble: false,            // 대실패 여부
      result: "(1D20) > 15",   // ★ 결과 문자열 (이것을 추출)
      secret: false,            // 비밀 굴림 여부
      skin: {d4: 'basic', d6: 'basic', d8: 'basic', d10: 'basic', d12: 'basic', ...},
      success: false            // 성공 여부
    }
  }
}

// 일반 텍스트 메시지
{
  text: "《 전투개시 》",
  extend: {}                   // 비어있음
}
```

**추출 방법**: `extend.roll.result` 문자열을 직접 읽어 `text + "\n" + result` 형태로 합쳐서 content.js에 전달합니다.

```js
// redux-injector.js의 extractDiceFromExtend()
if (entity.extend?.roll?.result) {
  text = text + '\n' + entity.extend.roll.result;  // "1D20 ⚔️ 스칼라\n(1D20) > 15"
}
// content.js의 parseDiceResult()가 "→|＞|>=|>" + 숫자 패턴으로 결과값을 추출
```
```

### 핵심 필드 용도

| 필드 | 용도 | 비고 |
|------|------|------|
| `text` | 메시지 본문 파싱 | 전투 트리거, 턴 추적, 주사위 결과 등 |
| `type` | 메시지 종류 | `"text"` = 일반, `"system"` = 시스템 메시지 |
| `name` | 캐릭터 식별 | `"system"` 시 아이콘/역할명 없이 표시 |
| `channel` | 채널 필터링 | 같은 채널의 메시지만 처리할 때 사용 |
| `from` | 사용자 식별 | 자신이 보낸 메시지 판별 |
| `to` | 귓속말 판별 | null이면 전체 메시지 |
| `extend` | 주사위 데이터 | `extend.roll` 안에 `→ 숫자` 패턴으로 결과 저장 |

### 채널(탭) 시스템

코코포리아의 채팅은 **채널(탭)**으로 구분됩니다.
채널 정보는 Redux state에 별도로 저장되지 않으며, 메시지의 `channel`/`channelName` 필드로만 구분됩니다.

#### 기본 탭 (고정 순서)

코코포리아 방에는 3개의 기본 탭이 항상 존재하며, **DOM 탭 인덱스와 채널 ID가 고정**되어 있습니다:

| 탭 인덱스 | 기본 이름 | `channel` 값 | `channelName` 값 | 비고 |
|----------|----------|-------------|-----------------|------|
| 0 | メイン (메인) | `"main"` | `"main"` | 방 이름으로 변경 가능 (예: "메인0") |
| 1 | 情報 (정보) | `"info"` | `"info"` | 탭 이름 변경 가능 |
| 2 | 雑談 (잡담) | `"other"` | `"other"` | 탭 이름 변경 가능 |

#### 커스텀 탭 (인덱스 3+)

GM이 추가한 탭은 인덱스 3부터 시작하며, **고유 랜덤 ID**를 가집니다:

| 탭 인덱스 | 예시 이름 | `channel` 값 | `channelName` 값 |
|----------|----------|-------------|-----------------|
| 3 | 주사위 굴림 연습 | `"RleEHkuPK"` | `"주사위 굴림 연습"` |
| 4+ | (마지막은 빈 "+" 추가 탭) | — | — |

#### 중요 사항

- **기본 탭의 `channelName`은 탭 UI 이름과 다릅니다**: 탭 이름이 "정보"여도 `channelName`은 `"info"`
- **커스텀 탭의 `channelName`은 탭 UI 이름과 동일합니다**: `channelName: "주사위 굴림 연습"`
- **Redux state에는 현재 선택된 탭 정보가 없습니다**: `app.chat`에는 `{inputText:''}` 만 존재
- **탭 감지는 DOM에서 해야 합니다**: MUI Tab 컴포넌트의 `[role="tab"][aria-selected="true"]` 사용
- **채널 정보는 `entities.rooms` 등에도 저장되지 않습니다**: 메시지를 통해서만 확인 가능

#### DOM 탭 감지 방법

```js
// 채팅 패널의 탭리스트 찾기 (textarea 기준으로 올라가며 탐색)
const textarea = document.querySelector('textarea[name="text"]');
// textarea의 조상 중 [role="tablist"]를 찾아 그 안의 [role="tab"] 순회
// aria-selected="true" 또는 class="Mui-selected"인 탭의 인덱스로 채널 결정
```

### 시스템 메시지 (type: "system")

코코포리아는 `:HP-10` 같은 네이티브 명령어 실행 시 시스템 메시지를 생성합니다.
역할명/아이콘 없이 회색 텍스트로 표시되며, Firestore에 직접 쓸 수도 있습니다.

```js
// 시스템 메시지 예시 (네이티브 `:HP-10` 실행 시 생성되는 형식)
{
  _id: "FWTB86TC0q08DSJcPE1t",
  type: "system",             // ★ "text"가 아닌 "system"
  text: "[ 스칼라 ] 의지💚 : 7 → 6",  // 본문
  name: "system",             // ★ "system" → 역할명/아이콘 없이 표시
  color: "#888888",           // ★ 회색 텍스트
  iconUrl: null,              // 아이콘 없음
  from: "Az1rUAx4...",        // 보낸 유저 UID
  channel: "...",             // 채널 ID
  extend: {},                 // 비어있음
  // ... 나머지 필드는 일반 메시지와 동일
}
```

**시스템 메시지 전송 방법** (BWBR 확장 프로그램):
```js
// sendDirectMessage의 두 번째 인자로 overrides 전달
sendDirectMessage(
  '[ 캐릭이름 ] HP : 50 → 40',
  { name: 'system', type: 'system', color: '#888888', iconUrl: null }
);
```

**제약사항**:
- 텍스트는 plain text만 지원 (마크다운/HTML 불가)
- 색상(`color`)과 텍스트 내용은 자유롭게 변경 가능
- CSS/레이아웃(중앙정렬, 이탤릭 등)은 코코포리아 렌더링에 의존하므로 수정 불가

### Redux 기반 메시지 관찰 구현 (redux-injector.js)

확장 프로그램은 `store.subscribe()`를 사용하여 `roomMessages.ids` 배열의 변화를 감지합니다.
이 방식은 DOM 기반 관찰과 달리 **탭 전환, DOM 갱신에 영향을 받지 않아 100% 메시지 감지율**을 보장합니다.

```
Redux Store (roomMessages 변경)
  → store.subscribe()          [redux-injector.js, MAIN world]
  → CustomEvent 'bwbr-new-chat-message'
  → observeReduxMessages()     [chat-interface.js, isolated world]
  → _isOwnMessage() 에코 필터
  → onNewMessage(text, null)   [content.js]
```

---

## 3. 캐릭터 데이터 구조 (roomCharacters)

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

## 4. Firestore 직접 접근 (읽기 + 쓰기)

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

## 5. webpack require 획득 방법

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

## 6. Redux Store 획득 방법

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

## 7. 캐릭터 셀렉터 함수 (모듈 88464)

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

---

## 8. 업데이트 대응 가이드

코코포리아가 업데이트되면 webpack 모듈 ID, minified 프로퍼티명 등이 변경될 수 있습니다.
확장 프로그램이 작동하지 않을 때 아래 순서대로 진단하세요.

### 8.1 빠른 진단 명령어 (내장)

확장 프로그램에 내장된 진단 이벤트를 콘솔에서 실행하세요:

```js
// 1) Firestore SDK 자동 탐색 + 결과 출력
window.dispatchEvent(new CustomEvent('bwbr-discover-firestore'));

// 2) 최근 채팅 메시지 구조 덤프
window.dispatchEvent(new CustomEvent('bwbr-dump-messages'));
```

`bwbr-discover-firestore`는 현재 코코포리아의 webpack 모듈을 자동 스캔하여
Firestore SDK 함수(`collection`, `doc`, `setDoc`)와 DB 인스턴스의 위치를 출력합니다.

### 8.2 수집해야 할 데이터 목록

| # | 항목 | 현재 값 (2026-02-16) | 변경 위험도 | 영향 |
|---|------|---------------------|------------|------|
| 1 | Firestore SDK 모듈 ID | `49631` | ★★★ 높음 | 메시지 직접 전송, 캐릭터 수정 |
| 2 | DB 인스턴스 모듈 ID | `5156` | ★★★ 높음 | 모든 Firestore 접근 |
| 3 | `setDoc` 프로퍼티 키 | `pl` | ★★★ 높음 | 데이터 쓰기 |
| 4 | `doc` 프로퍼티 키 | `JU` | ★★★ 높음 | 문서 참조 생성 |
| 5 | `collection` 프로퍼티 키 | `hJ` | ★★★ 높음 | 컬렉션 참조 생성 |
| 6 | DB 인스턴스 프로퍼티 키 | `db` | ★★☆ 중간 | Firestore 인스턴스 |
| 7 | 셀렉터 모듈 ID | `88464` | ★☆☆ 낮음 | 캐릭터 셀렉터 (현재 미사용) |
| 8 | roomMessages 엔티티 키 | 16개 (섹션 2 참조) | ★☆☆ 낮음 | 메시지 파싱 |
| 9 | Redux Store 경로 | `entities.roomMessages` | ★☆☆ 낮음 | 메시지 관찰 |

### 8.3 수동 재수집 명령어

코코포리아 방에 접속한 상태에서 **브라우저 콘솔(F12)**에 다음을 입력하세요.

#### Step 1: webpack require 획득

```js
const chunks = window.webpackChunkccfolia;
let wpReq;
chunks.push([[Date.now()], {}, r => { wpReq = r; }]);
console.log('✅ webpack require 획득:', typeof wpReq);
```

#### Step 2: Firestore SDK 모듈 찾기

```js
// collection, doc, setDoc 등이 포함된 모듈 탐색
// 3개 이상의 Firestore 함수가 있는 모듈을 찾습니다.
const candidates = [];
for (const id of Object.keys(wpReq.m)) {
  try {
    const mod = wpReq(id);
    if (!mod || typeof mod !== 'object') continue;
    let fsCount = 0;
    for (const [k, v] of Object.entries(mod)) {
      if (typeof v !== 'function') continue;
      const s = v.toString().substring(0, 1000);
      if (s.includes('merge') || s.includes('DocumentReference') ||
          s.includes('CollectionReference') || s.includes('firestore')) {
        fsCount++;
      }
    }
    if (fsCount >= 3) candidates.push({ id, keys: Object.keys(mod).length, fsCount });
  } catch (e) {}
}
console.table(candidates);
// → 가장 fsCount가 높은 모듈 ID = Firestore SDK 모듈
```

#### Step 3: Firestore 함수 프로퍼티 키 확인

```js
// Step 2에서 찾은 모듈 ID를 입력 (예: 49631)
const FS_MOD_ID = 49631; // ← 여기에 Step 2 결과 입력
const fsMod = wpReq(FS_MOD_ID);

// db 인스턴스를 가진 모듈 찾기
let dbModId, dbKey;
for (const id of Object.keys(wpReq.m)) {
  try {
    const mod = wpReq(id);
    if (!mod || typeof mod !== 'object') continue;
    for (const [k, v] of Object.entries(mod)) {
      if (v && typeof v === 'object' && v.type === 'firestore' && typeof v.toJSON === 'function') {
        dbModId = id; dbKey = k;
        break;
      }
    }
    if (dbModId) break;
  } catch (e) {}
}
console.log('DB 모듈:', dbModId, '키:', dbKey);
const db = wpReq(dbModId)[dbKey];

// collection, doc, setDoc 키 찾기
for (const [key, fn] of Object.entries(fsMod)) {
  if (typeof fn !== 'function') continue;
  try {
    // collection 테스트 (안전: 네트워크 요청 없음)
    const ref = fn(db, '__test__');
    if (ref && ref.type === 'collection' && ref.path === '__test__') {
      console.log(`✅ collection = fsMod.${key}`);
      continue;
    }
  } catch (e) {}
  try {
    // doc 테스트 (안전: 네트워크 요청 없음)
    // collection을 먼저 찾아야 함
    const fn2 = fn;
    const s = fn2.toString().substring(0, 500);
    if (s.includes('merge')) {
      console.log(`✅ setDoc 후보 = fsMod.${key} (toString에 'merge' 포함)`);
    }
  } catch (e) {}
}

// 수동 확인: 각 함수를 직접 테스트
// collection 확인:
// fsMod.hJ(db, 'test') → { type: 'collection', path: 'test' } 이면 정답
// doc 확인:
// fsMod.JU(fsMod.hJ(db, 'test'), 'id') → { type: 'document', path: 'test/id' } 이면 정답
```

#### Step 4: roomMessages 구조 확인

```js
// Redux store에서 직접 확인 (redux-injector가 로드된 상태)
window.dispatchEvent(new CustomEvent('bwbr-dump-messages'));
// → 콘솔에서 메시지 엔티티 키 목록과 전체 구조 확인
```

### 8.4 값 업데이트 방법

발견한 새 값을 `redux-injector.js`의 `_FS_CONFIG` 상수에 반영하세요:

```js
// redux-injector.js 상단
const _FS_CONFIG = {
  firestoreModId: 49631,  // ← Step 2에서 찾은 모듈 ID
  dbModId: 5156,          // ← Step 3에서 찾은 DB 모듈 ID
  fsKeys: {               // ← Step 3에서 찾은 프로퍼티 키
    setDoc: 'pl',
    doc: 'JU',
    collection: 'hJ'
  },
  dbKey: 'db'             // ← Step 3에서 찾은 DB 프로퍼티 키
};
```

### 8.5 자동 탐색 (코드 내장)

`redux-injector.js`에는 자동 탐색 로직이 내장되어 있습니다:

1. **알려진 ID/키**로 먼저 시도 (빠름)
2. 실패 시 **collection/doc 자동 탐색** (안전한 테스트로 발견)
3. 실패 시 **setDoc 휴리스틱 탐색** (`toString()`에 'merge' 포함 검사)
4. 모두 실패 시 **에러 로그 + `bwbr-discover-firestore` 실행 안내**

자동 탐색은 확장 프로그램이 처음 메시지를 Firestore로 전송할 때 실행됩니다.
프로퍼티 키가 바뀌어도 대부분 자동으로 복구됩니다.
모듈 ID가 바뀐 경우에만 수동 개입이 필요합니다.
