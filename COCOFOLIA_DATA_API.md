# 코코포리아 내부 데이터 접근 가이드

> 코코포리아(ccfolia.com)의 내부 구조를 리버스 엔지니어링하여 정리한 비공식 문서입니다.
> Chrome 확장 프로그램(Content Script)에서 코코포리아 데이터를 읽고 쓰는 방법을 다룹니다.
>
> **주의**: 코코포리아는 React + Redux + Firebase(Firestore) + webpack으로 구성되어 있으며,
> 업데이트 시 webpack 모듈 ID 및 minified 프로퍼티명이 변경될 수 있습니다.
>
> 아래 모듈 ID·프로퍼티명은 **2026-02-16 기준**이며, 변경 시 재탐색이 필요합니다.
> DOM 구조 레퍼런스는 **2026-02-24 기준** (섹션 11 참조).

---

## 목차

1. [Redux Store 획득](#1-기본-접근-redux-store)
2. [채팅 메시지 데이터 구조](#2-채팅-메시지-데이터-구조-roommessages)
3. [Firestore 직접 접근 (읽기 + 쓰기)](#3-firestore-직접-접근-읽기--쓰기)
4. [webpack require 획득 방법](#4-webpack-require-획득-방법)
5. [Redux Store 획득 코드](#5-redux-store-획득-방법)
6. [캐릭터 셀렉터 함수](#6-캐릭터-셀렉터-함수-모듈-88464)
7. [주의사항 & 트러블슈팅](#주의사항--트러블슈팅)
8. [업데이트 대응 가이드](#8-업데이트-대응-가이드)
9. [app.state 상세 구조 및 UI 제어](#9-appstate-상세-구조-및-ui-제어)
10. [Redux Action Type 탐색 기법](#10-redux-action-type-탐색-기법)
11. [DOM 구조 레퍼런스 (MUI 컴포넌트 매핑)](#11-dom-구조-레퍼런스-mui-컴포넌트-매핑)
    - [11.7 배틀맵 / 씬 계층 구조](#117-배틀맵--씬-계층-구조-foreground--background--zoom--pan)

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
      openInspector: false,        // ★ 확대 보기 다이얼로그 열림 여부
      inspectImageUrl: null,       // ★ 확대 보기 이미지 URL
      inspectText: "",             // ★ 확대 보기 텍스트
      openRoomCharacter: false,    // ★ 캐릭터 편집 다이얼로그 열림 여부
      openRoomCharacterId: null,   // ★ 편집 중인 캐릭터 ID
      openRoomCharacterMenu: false,
      openRoomCharacterMenuId: null,
      openRoomCharacterSelect: false,
      roomPointerX: 0,            // 마우스 포인터 위치 (state 변경 테스트용)
      roomPointerY: 0,
      ...  // 총 174개 이상의 키
    },
    chat: { inputText: "" },
    user: { ... },
    emotes: { ... },
    dicerolls: { ... },
    room: {
      members: { ids: [...], entities: {...} }
    }
  },
  entities: { ... }  // 섹션 2-3 참조
}
```

> **`app.state` 상세 키 목록**: [섹션 9](#9-appstate-상세-구조-및-ui-제어) 참조

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

---

## 9. app.state 상세 구조 및 UI 제어

> `store.getState().app.state` 는 코코포리아의 전역 UI 상태를 관리합니다.
> 174개 이상의 키가 있으며, 여기서는 확장 프로그램에서 활용 가능한 핵심 키만 정리합니다.
>
> **기준**: 2026-02-23

### 확대 보기 (Inspector)

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `openInspector` | boolean | `false` | 확대 보기 다이얼로그 열림 여부 |
| `inspectImageUrl` | string \| null | `null` | 확대 보기에 표시할 이미지 URL |
| `inspectText` | string | `""` | 확대 보기 텍스트 (메모 등) |

```js
// 네이티브 확대 보기 열기
const appState = store.getState().app.state;
store.dispatch({
  type: actionType,  // 섹션 10에서 발견한 action type
  payload: { ...appState, openInspector: true, inspectImageUrl: imageUrl, inspectText: '' }
});
```

### 캐릭터 편집 다이얼로그

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `openRoomCharacter` | boolean | `false` | 캐릭터 편집 다이얼로그 열림 여부 |
| `openRoomCharacterId` | string \| null | `null` | 편집 대상 캐릭터의 Firestore 문서 ID |
| `openRoomCharacterMenu` | boolean | `false` | 캐릭터 컨텍스트 메뉴 열림 |
| `openRoomCharacterMenuId` | string \| null | `null` | 메뉴 대상 캐릭터 ID |
| `openRoomCharacterSelect` | boolean | `false` | 캐릭터 선택 드롭다운 열림 |

```js
// 캐릭터 편집 다이얼로그 열기
const charId = '...';  // entities.roomCharacters.ids 에서 검색
store.dispatch({
  type: actionType,
  payload: { ...store.getState().app.state, openRoomCharacter: true, openRoomCharacterId: charId }
});
```

> **주의**: `openRoomCharacterId`에는 `entities.roomCharacters` 의 entity key (= Firestore 문서 ID)를 사용합니다.
> 캐릭터 객체 내부의 `_id` 필드와는 다를 수 있습니다.

### 기타 유용한 키

| 키 | 타입 | 설명 |
|----|------|------|
| `roomId` | string | 현재 방 ID |
| `uid` | string | 현재 사용자 UID |
| `roomPointerX` / `roomPointerY` | number | 마우스 포인터 좌표 (action type 검증 테스트용) |
| `loading` | boolean | 로딩 상태 |
| `openRoomSetting` | boolean | 방 설정 다이얼로그 |
| `openSavedata` | boolean | 세이브 다이얼로그 |

### app.state 전체 키 덤프

```js
// 콘솔에서 실행
window.dispatchEvent(new CustomEvent('bwbr-dump-redux-keys'));
// → app.state의 모든 키, entities 하위 키 목록 출력
```

### app.state 변경 추적 (스냅샷 diff)

```js
// 1단계: 스냅샷 저장
window.dispatchEvent(new CustomEvent('bwbr-snapshot-before'));

// 2단계: 코코포리아에서 UI 조작 (확대 보기, 편집 등)

// 3단계: 변화 확인
window.dispatchEvent(new CustomEvent('bwbr-snapshot-after'));
// → 변경된 키와 before/after 값 출력
```

### 전체 Redux state 깊은 비교 (deep snapshot diff)

> `app.state` 외에 `entities` 등 깊은 곳의 변화를 추적할 때 사용합니다.
> 깊이 6까지 재귀적으로 비교합니다.

```js
// 1단계: 전체 state 스냅샷
window.dispatchEvent(new CustomEvent('bwbr-deep-snapshot-before'));

// 2단계: 코코포리아에서 아무 조작

// 3단계: 전체 state diff 확인
window.dispatchEvent(new CustomEvent('bwbr-deep-snapshot-after'));
// → 변경된 필드의 전체 경로와 before/after 값 출력
// 예: state.entities.rooms.entities.{roomId}.displayGrid: false → true
```

### 9.1 rooms 엔티티 (필드 설정)

> 방 설정은 `entities.rooms.entities.{roomId}` 에 Firestore 문서로 저장됩니다.
> `app.state`가 아닌 `entities.rooms`에 있으므로 변경 시 Firestore 직접 쓰기가 필요합니다.
>
> **기준**: 2026-02-24

#### 그리드 표시

| 키 | 경로 | 타입 | 설명 |
|----|------|------|------|
| `displayGrid` | `entities.rooms.entities.{roomId}.displayGrid` | boolean | 전경에 그리드 표시 여부 |

```js
// 그리드 상태 읽기
const state = store.getState();
const roomId = state.app.state.roomId;
const displayGrid = state.entities.rooms.entities[roomId].displayGrid;

// 그리드 토글 (Firestore 직접 쓰기 — { merge: true } 필수)
const roomCol = sdk.collection(sdk.db, 'rooms');
const roomRef = sdk.doc(roomCol, roomId);
await sdk.setDoc(roomRef, { displayGrid: !displayGrid }, { merge: true });
```

> **주의**: `app.state`에는 `displayGrid` 키가 존재하지 않습니다 (174개 키 중 grid 관련 없음).
> Redux 상태는 Firestore 실시간 리스너를 통해 자동 동기화됩니다.

---

## 10. Redux Action Type 탐색 기법

> `app.state`를 수정하려면 올바른 Redux action type이 필요합니다.
> 코코포리아는 RTK (Redux Toolkit)의 `createSlice`를 사용하며,
> action type은 minified되어 있어 정적으로 알 수 없습니다.

### 탐색 전략 (3-tier)

#### Tier 1: webpack 모듈 검색

webpack 모듈에서 `.seted` action creator를 직접 검색합니다.

```js
// RTK createSlice 패턴: slice.actions.seted({ ...state })
const req = acquireWebpackRequire();
for (const id of Object.keys(req.m)) {
  const mod = req(id);
  for (const key of Object.keys(mod || {})) {
    const val = mod[key];
    if (val?.seted?.type) {
      // 검증: roomPointerX를 변경하여 실제로 app.state를 바꾸는지 확인
    }
  }
}
```

#### Tier 2: 문자열 브루트포스

가능한 slice/action name 조합을 시도합니다.

```js
// "sliceName/actionName" 형식
const sliceNames = ['state', 'appState', 'app', 'ui', 'page', 'view', ...];
const actionNames = ['seted', 'set', 'setState', 'update', ...];
for (const sn of sliceNames) {
  for (const an of actionNames) {
    store.dispatch({ type: `${sn}/${an}`, payload: testPayload });
    // roomPointerX 변경 여부로 검증
  }
}
```

#### Tier 3: 패시브 인터셉터 (가장 안정적)

사용자의 일반 상호작용에서 action type을 자동 캡처합니다.

```js
const origDispatch = store.dispatch;
store.dispatch = function (action) {
  if (typeof action === 'function') {
    // RTK thunk: inner dispatch를 인터셉트
    return action(function innerDispatch(innerAction) {
      if (innerAction?.payload?.openInspector !== undefined
          && innerAction?.payload?.roomPointerX !== undefined) {
        // ✅ 이것이 app.state 수정 action type
        capturedType = innerAction.type;
        store.dispatch = origDispatch; // 복원
      }
      return origDispatch.call(store, innerAction);
    }, store.getState);
  }
  return origDispatch.call(this, action);
};
```

> **RTK thunk 주의**: 코코포리아의 dispatch는 대부분 thunk (`typeof action === 'function'`)입니다.
> thunk 내부에서 실제 action이 dispatch되므로, 외부 dispatch만 감시하면
> type이 `undefined`로 나타납니다. 반드시 inner dispatch를 인터셉트해야 합니다.

### action type 검증 방법

```js
// roomPointerX를 임시값으로 변경 → 복원
const origX = store.getState().app.state.roomPointerX;
store.dispatch({ type: candidateType, payload: { ...appState, roomPointerX: -99999 } });
if (store.getState().app.state.roomPointerX === -99999) {
  // ✅ 유효한 action type
  store.dispatch({ type: candidateType, payload: { ...appState, roomPointerX: origX } });
}
```

---

## 11. DOM 구조 레퍼런스 (MUI 컴포넌트 매핑)

> 코코포리아는 **MUI (Material-UI v5)** + **styled-components** + **downshift**를 사용합니다.
> 아래는 확장 프로그램이 참조하는 주요 UI 요소의 실제 DOM 구조입니다.
>
> **기준**: 2026-02-24 (콘솔 진단으로 확인)

### 11.1 캐릭터 선택 드롭다운

채팅 패널 좌측의 캐릭터 아이콘을 클릭하면 나타나는 캐릭터 선택 목록입니다.

#### 컨테이너 구조

```
body
└─ div.MuiPopover-root          ← 팝업 루트 (포탈로 body 직속에 렌더링)
   ├─ div.MuiBackdrop-root      ← 투명 백드롭 (클릭 시 닫힘)
   └─ div.MuiPaper-root.MuiPaper-rounded  ← 실제 드롭다운 패널
      └─ ul.MuiList-root                   ← 리스트 컨테이너
         ├─ div.MuiButtonBase-root.MuiListItemButton-root [role="button"]
         ├─ div.MuiButtonBase-root.MuiListItemButton-root [role="button"]
         └─ ...  (캐릭터 아이템 반복)
```

**핵심 포인트**:
- 아이템은 `<div>` (NOT `<li>`)이며 클래스는 `MuiListItemButton-root`
- `role="option"`, `role="listbox"` 없음 → MUI Autocomplete가 아닌 **커스텀 Popover + List 조합**
- `MuiAutocomplete-popper` 클래스 없음

#### downshift 연동

```
입력 필드 → UL#downshift-:rm:-menu[role="listbox"]
            └─ children: 0 (비어 있음!)

아이템 → 별도의 MuiPopover-root 안에 렌더링 (downshift 리스트와 분리됨)
```

- downshift ID 형식: `downshift-:rm:-menu` (`:rm:` 는 React 18의 `useId()` 접두사)
- 이전 형식 `downshift-0-menu`, `downshift-1-menu`는 **더 이상 사용되지 않음**
- 정규식 매칭: `/^downshift-.+-menu/` (`.+` 사용, `\d+` 아님)

#### 캐릭터 아이템 내부 구조

```
div.MuiListItemButton-root [role="button"]
├─ div.MuiListItemAvatar-root
│  └─ div.MuiAvatar-root
│     └─ img [src="캐릭터 아이콘 URL"]
├─ div.MuiListItemText-root
│  ├─ span (또는 p)  →  "캐릭터이름"          (font-size: 14px)
│  └─ span (또는 p)  →  "활성화 상태"         (font-size: 14px)
│                        또는 "비활성화 상태"
└─ (확장 프로그램 주입) span.bwbr-key-badge  →  "Alt + 1"  (font-size: 11.2px)
```

**상태 텍스트 규칙**:
- `"활성화 상태"` = 캐릭터가 맵(보드) 위에 활성화되어 있음
- `"비활성화 상태"` = 캐릭터가 보드에서 제거(집어넣기)되어 있음
- 이 텍스트로 active/inactive 상태를 DOM에서 직접 판별 가능

#### 뱃지(키 라벨) 주입 위치

```
✅ 올바른 방법:  "활성화 상태" span 내부에 appendChild
   → span  →  "활성화 상태 Alt + 1"  (같은 baseline, 자연스러운 정렬)

❌ 잘못된 방법:  item에 flex + align-self:flex-end
   → 세로 위치 어긋남 (상태 텍스트 y:286-306 vs 뱃지 y:298-309 = 3px 차이)
```

#### 셀렉터 가이드

| 대상 | 올바른 셀렉터 | ❌ 잘못된 셀렉터 |
|------|--------------|------------------|
| 드롭다운 컨테이너 | `.MuiPopover-root` | `[role="listbox"]`, `.MuiAutocomplete-popper` |
| 캐릭터 아이템 | `.MuiListItemButton-root` 또는 `[role="button"]` | `li[role="option"]`, `[id^="downshift-"][id*="-item"]` |
| 아바타 이미지 | `.MuiListItemAvatar-root img` | — |
| 상태 텍스트 | `.MuiListItemText-root` 내 span/p 중 "활성화/비활성화" | — |

---

### 11.2 확대 보기 (Inspector)

토큰 우클릭 → "확대 보기" 또는 확장 프로그램의 커스텀 메뉴에서 열리는 이미지 뷰어입니다.

#### 컨테이너 구조

```
body
└─ div.MuiModal-root             ← 모달 루트 (포탈)
   ├─ div.MuiBackdrop-root       ← 반투명 백드롭
   └─ div (내용 컨테이너)
      └─ img [src="이미지URL"]    ← 실제 이미지
```

**핵심 포인트**:
- **`MuiModal-root`** 사용 (NOT `MuiDialog-root`)
- 이미지가 뷰포트보다 클 수 있음 (예: 944×1999px)
- CSS로 `max-height: 90vh; object-fit: contain` 등으로 제한 필요

#### ⚠️ CSS 셀렉터 주의

```css
/* ❌ 위험: 너무 광범위 — 캐릭터 목록의 아바타 이미지까지 영향 */
.MuiModal-root img { max-height: 90vh; }

/* ✅ 안전: JS에서 Inspector 열린 후 해당 img만 직접 스타일링 */
/* redux-injector.js의 constrainInspectorImage() 사용 */
```

`.MuiModal-root img`는 코코포리아 전체의 MuiModal(캐릭터 편집 등)에도 적용되므로
아바타/아이콘 이미지까지 잘못 제한할 수 있습니다. **JS 기반 제한을 권장**합니다.

---

### 11.3 채팅 영역 이미지 (우클릭 대상)

채팅 메시지에 포함된 이미지(주사위 결과 등)의 DOM 체인입니다.

```
IMG
└─ BUTTON.MuiButtonBase-root.sc-EhTgW    ← styled-component 래퍼
   └─ DIV.sc-iuImfv
      └─ DIV.sc-liAOXi
         └─ FORM
            └─ ... (채팅 패널 루트)
```

- 채팅 이미지는 `BUTTON > IMG` 구조 (MUI ButtonBase + styled-components)
- `sc-*` 클래스명은 빌드마다 변경될 수 있으므로 **의존하지 말 것**
- 우클릭 허용 판별: `tag === 'img' && target.closest('.MuiModal-root')` → Inspector 이미지만 허용

---

### 11.4 토큰 우클릭 컨텍스트 메뉴 (MUI)

보드 위 캐릭터 토큰을 우클릭하면 나타나는 네이티브 MUI 메뉴입니다.

```
body
└─ div.MuiPopover-root
   ├─ div.MuiBackdrop-root (invisible)
   └─ div.MuiPaper-root.MuiMenu-paper
      └─ ul.MuiList-root [role="menu"]
         ├─ li.MuiMenuItem-root  →  "확대 보기"
         ├─ li.MuiMenuItem-root  →  "집어넣기"  / "꺼내기"
         ├─ li.MuiMenuItem-root  →  "편집"
         ├─ li.MuiMenuItem-root  →  "복사"
         └─ li.MuiMenuItem-root  →  "삭제"
```

**패널 메뉴와의 구분**:
- 토큰 메뉴: `"집어넣기"`, `"확대 보기"` 포함
- 패널 메뉴: `"위치 고정"`, `"패널 숨기기"` 포함 → 확장 프로그램이 주입하지 않음

---

### 11.5 MUI 컴포넌트 ↔ DOM 매핑 요약

| UI 요소 | MUI 컴포넌트 | DOM 클래스 | 비고 |
|---------|-------------|-----------|------|
| 캐릭터 선택 드롭다운 | Popover + List | `.MuiPopover-root` | Autocomplete 아님 |
| 캐릭터 아이템 | ListItemButton | `.MuiListItemButton-root` | `<div>`, NOT `<li>` |
| 확대 보기 (Inspector) | Modal | `.MuiModal-root` | Dialog 아님 |
| 토큰 컨텍스트 메뉴 | Popover + Menu | `.MuiPopover-root > .MuiMenu-paper` | MenuItem은 `<li>` |
| 캐릭터 편집 | Dialog (Modal) | `.MuiDialog-root` (= `.MuiModal-root`) | 둘 다 가짐 |
| 채팅 입력 | TextField | `textarea[name="text"]` | — |
| 채팅 탭 | Tabs | `[role="tablist"] > [role="tab"]` | — |

---

### 11.6 진단 스크립트

DOM 구조가 변경되었는지 확인할 때 아래 스크립트를 브라우저 콘솔(F12)에서 실행하세요.

#### 캐릭터 드롭다운 구조 확인

```js
// 캐릭터 선택 드롭다운을 연 상태에서 실행
var pop = document.querySelector('.MuiPopover-root .MuiPaper-rounded');
if (!pop) { console.log('❌ 드롭다운이 열려있지 않습니다'); }
else {
  var items = pop.querySelectorAll('.MuiListItemButton-root');
  console.log('캐릭터 아이템 수:', items.length);
  items.forEach(function(item, i) {
    var texts = [];
    item.querySelectorAll('span, p').forEach(function(el) {
      if (el.textContent.trim()) texts.push(el.textContent.trim());
    });
    var img = item.querySelector('img');
    console.log(i + ':', texts.join(' | '), img ? '(아이콘 있음)' : '(아이콘 없음)');
  });
}
```

#### Inspector 구조 확인

```js
// 확대 보기를 연 상태에서 실행
var modal = document.querySelector('.MuiModal-root');
if (!modal) { console.log('❌ Inspector가 열려있지 않습니다'); }
else {
  var img = modal.querySelector('img');
  if (img) {
    console.log('이미지 크기:', img.naturalWidth + 'x' + img.naturalHeight);
    console.log('렌더 크기:', img.width + 'x' + img.height);
    console.log('뷰포트:', window.innerWidth + 'x' + window.innerHeight);
    console.log('overflow:', img.height > window.innerHeight ? '⚠️ 오버플로!' : '✅ 정상');
  }
  console.log('MuiDialog-root 존재:', !!modal.querySelector('.MuiDialog-root'));
}
```

#### downshift ID 형식 확인

```js
var dsMenu = document.querySelector('[id^="downshift-"][id$="-menu"]');
if (dsMenu) {
  console.log('downshift menu ID:', dsMenu.id);
  console.log('children:', dsMenu.children.length);
} else {
  console.log('❌ downshift 메뉴를 찾을 수 없습니다 (캐릭터 입력 필드를 클릭하세요)');
}
```

---

### 11.7 배틀맵 / 씬 계층 구조 (Foreground · Background · Zoom · Pan)

> 코코포리아 맵(씬)의 배경 이미지, 전경 이미지, 토큰이 배치되는 DOM 계층입니다.
> 줌(확대/축소)과 팬(드래그 이동)에 대한 동작이 계층별로 다르므로,
> 오버레이를 삽입할 때 정확한 위치 선정이 중요합니다.
>
> **기준**: 2026-02-28 (콘솔 진단으로 확인)

#### 전체 계층 구조

```
sc-LvPkz (overflow:hidden)                     ← 공통 조상 (최상위 씬 래퍼)
├─ [1] sc-dYYaKM (배경 레이어)                     position:absolute, overflow:hidden
│      → 줌과 무관: 항상 뷰포트 크기 (예: 1972×1318)
│      └─ sc-eVedOh (배경 이미지)                   position:absolute, left:-8px, top:-8px
│           → 뷰포트보다 약간 큰 이미지 (예: 1988×1334)
│
├─ [2] sc-geBDJh (토큰 뷰포트)                     position:absolute, overflow:hidden
│      └─ sc-bZetrt
│           └─ sc-iiKPbm                           overflow:hidden
│                └─ sc-fkmgoA                       overflow:hidden (다중 클리핑)
│                     └─ sc-jcsPWJ (pan 컨테이너)   transform: translate(X, Y)
│                          └─ div (zoom 컨테이너)   transform: scale(N), 0×0, static
│                               ├─ [0] div (전경)   position:absolute, <img> 포함
│                               │     └─ <img>     필드 크기 × 24px (예: 1920×1080)
│                               ├─ [1] .movable    토큰 #1
│                               ├─ [2] .movable    토큰 #2
│                               └─ ...
│
└─ [3] MuiDrawer                                   채팅 사이드바
```

#### 핵심 특성

| 요소 | 줌 영향 | 크기 결정 | 비고 |
|------|---------|----------|------|
| 배경 레이어 (sc-dYYaKM) | ❌ 무관 | 뷰포트 크기 | 줌 0.4~2.0 에서 불변 |
| 배경 이미지 (sc-eVedOh > img) | ❌ 무관 | 뷰포트 + 여유 (~8px) | 가장자리 안티앨리어싱용 |
| 전경 (zoom[0]) | ✅ scale(N) 적용 | 필드 설정 × 24px | `width × 24`, `height × 24` |
| 토큰 (.movable) | ✅ scale(N) 적용 | 개별 크기 | 전경과 동일 좌표계 |

#### 전경 이미지 크기 계산

코코포리아 필드 설정의 **1マス (1칸) = 24px** 입니다.

```
전경 이미지 너비 = 필드 가로칸 수 × 24
전경 이미지 높이 = 필드 세로칸 수 × 24
```

예시 (16:9 비율):
| 가로 칸 | 세로 칸 | 전경 크기 (px) |
|---------|---------|---------------|
| 80 | 45 | 1920 × 1080 |
| 60 | 34 | 1440 × 816 |
| 40 | 23 | 960 × 552 |

#### 전경 요소 프로그래밍적 탐지

```js
// 전경 = zoom 컨테이너의 첫 번째 자식 중 .movable이 아니고 큰 <img>를 포함하는 것
var movable = document.querySelector('.movable');
var zoomEl = movable.parentElement;
for (var i = 0; i < zoomEl.children.length; i++) {
  var ch = zoomEl.children[i];
  if (ch.classList.contains('movable')) continue;  // 토큰 스킵
  var img = ch.querySelector('img');
  if (img && img.offsetWidth >= 200) {
    // ch = 전경 요소, img = 전경 이미지
    console.log('전경:', img.offsetWidth + '×' + img.offsetHeight);
    break;
  }
}
```

#### 오버레이 삽입 전략

| 삽입 위치 | 결과 | 권장 |
|----------|------|------|
| 배경 레이어 (sc-dYYaKM) | ❌ 줌과 무관, 전경 크기와 불일치 | — |
| pan 컨테이너 형제 (sc-fkmgoA) | ❌ pan/zoom 밖, 전경과 연동 안 됨 | — |
| zoom 컨테이너 직접 | ⚠️ 전경 크기를 JS로 복사해야 함 | — |
| **전경 바로 뒤 형제 (afterend)** | ✅ 동일 좌표계, 크기 동기화 용이 | **권장** |

```js
// 전경과 동일한 position:absolute + computed style 복사
var overlay = document.createElement('div');
var cs = getComputedStyle(foregroundEl);
overlay.style.position = 'absolute';
overlay.style.left = cs.left;
overlay.style.top = cs.top;
overlay.style.width = cs.width;
overlay.style.height = cs.height;
foregroundEl.insertAdjacentElement('afterend', overlay);
```

#### ⚠️ 주의사항

- `sc-*` 클래스명은 styled-components 빌드마다 변경됨 → **클래스명에 의존하지 말 것**
- `.movable`은 안정적 클래스 (토큰 요소의 CSS 클래스)
- zoom 컨테이너는 `0×0` 크기이며 자식의 position:absolute로 콘텐츠 표시
- 다중 overflow:hidden 조상이 자동 클리핑을 제공 (전경 바깥 오버레이 영역은 자동으로 잘림)
- 전경 크기는 방 설정 변경 시 변할 수 있으므로 주기적 동기화 필요 (현재 2초 주기)

#### 진단 스크립트

```js
// 전경·줌·팬 컨테이너 확인 (F12에서 실행)
var m = document.querySelector('.movable');
if (!m) { console.log('❌ 토큰(.movable)이 없습니다'); }
else {
  var zoom = m.parentElement;
  var pan = zoom.parentElement;
  console.log('zoom transform:', zoom.style.transform || getComputedStyle(zoom).transform);
  console.log('pan transform:', pan.style.transform || getComputedStyle(pan).transform);
  console.log('zoom children:', zoom.children.length,
    '(전경 1 + 토큰', zoom.querySelectorAll('.movable').length + ')');
  for (var i = 0; i < zoom.children.length; i++) {
    var ch = zoom.children[i];
    if (ch.classList.contains('movable')) continue;
    var img = ch.querySelector('img');
    if (img) {
      console.log('전경 이미지:', img.offsetWidth + '×' + img.offsetHeight,
        '→', Math.round(img.offsetWidth/24) + '칸 ×', Math.round(img.offsetHeight/24) + '칸');
    }
  }
}
```

---

### 11.8 연필 메뉴 (FAB) DOM 구조

> 코코포리아 우하단의 연필 아이콘 버튼과 펼쳐지는 메뉴의 DOM 구조입니다.
> **MuiSpeedDial이 아닙니다.** MuiFab + MuiPopover 메뉴입니다.
>
> **기준**: 2026-02-24 (콘솔 진단으로 확인, 2026-02-24 재확인)

#### FAB 버튼

```
sc-geBDJh (조부모 컨테이너, 토큰 뷰포트 역할도 겸)
  └─ DIV (FAB wrapper, 클래스 없음)
       └─ BUTTON.MuiFab-root.MuiFab-circular.MuiFab-sizeLarge
            └─ (연필 아이콘 SVG)
```

#### 메뉴 팝업 (FAB 클릭 시 body 포탈로 렌더링)

```
body
└─ div.MuiPopover-root                    ← Portal (body 직속)
   ├─ div.MuiBackdrop-root               ← 투명 백드롭
   └─ div.MuiPaper-root                  ← 실제 메뉴 패널 (FAB 위에 위치)
      └─ ul.MuiList-root
         ├─ div.MuiListItemButton-root   ← 메뉴 아이템 1
         │  ├─ div.MuiListItemIcon-root  → <svg> 아이콘
         │  └─ div.MuiListItemText-root
         │     ├─ span.MuiTypography-root → "기능 이름" (primary)
         │     └─ span.MuiTypography-root → "설명 텍스트" (secondary)
         ├─ div.MuiListItemButton-root   ← 메뉴 아이템 2 (PRO 기능일 수 있음)
         └─ ...
```

#### 주입 전략 (수정됨)

1. `MutationObserver`로 body 감시 (메뉴 열릴 때 Popover DOM 생성됨)
2. `.MuiPopover-root` 안의 `.MuiPaper-root` 찾기
3. Paper 위치가 FAB 근처인지 확인 (`getBoundingClientRect()` 비교)
4. `.MuiList-root` 안의 `.MuiListItemButton-root` 복제
5. PRO 뱃지/보조 텍스트 제거, 아이콘/라벨 교체
6. `list.insertBefore(clone, list.firstChild)` 로 맨 위에 삽입

#### 주의사항

- 메뉴 닫으면 MuiPopover DOM 전체 제거됨 → 열 때마다 재주입 필요
- PRO 기능 아이템은 Chip/Badge + secondary text 포함 → 복제 시 반드시 제거
- Popover backdrop이 클릭을 가로챌 수 있으므로 capture phase로 핸들러 등록
- FAB 조부모(sc-geBDJh) 안의 MuiIconButton들은 **툴바 버튼**이며 메뉴 아이템이 아님

### 11.9 네이티브 그리드 (displayGrid) DOM

> `displayGrid = true` 상태에서 zoom container 내부에 별도의 그리드 DOM 요소(canvas, SVG 등)가
> **생성되지 않습니다.** (2026-02-24 실측: zoom container 자식 = 전경 + .movable들 + 커스텀 오버레이뿐)
>
> 네이티브 그리드는 **전경 div의 CSS background**로 렌더링되는 것으로 추정됩니다.
> 커스텀 그리드 활성 시 `fg.style.setProperty('background', 'transparent', 'important')` 로
> 네이티브 그리드를 숨기고, 오버레이로 대체합니다.
