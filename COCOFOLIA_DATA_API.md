# 코코포리아 내부 데이터 접근 가이드

> 코코포리아(ccfolia.com)의 내부 구조를 리버스 엔지니어링하여 정리한 비공식 문서입니다.
> Chrome 확장 프로그램(Content Script)에서 코코포리아 데이터를 읽고 쓰는 방법을 다룹니다.
>
> **주의**: 코코포리아는 React + Redux + Firebase(Firestore) + webpack으로 구성되어 있으며,
> 업데이트 시 webpack 모듈 ID 및 minified 프로퍼티명이 변경될 수 있습니다.
>
> 아래 모듈 ID·프로퍼티명은 **2026-02-16 기준**이며, 변경 시 재탐색이 필요합니다.
> DOM 구조 레퍼런스는 **2026-02-24 ~ 2026-03-07 기준** (섹션 11 참조).
> rooms/roomScenes 엔티티 구조는 **2026-02-27 기준** (섹션 9.1, 9.2, 13 참조).
> UI 디자인 시스템(테마 규칙)은 **2026-03-02 기준** (섹션 14 참조).
> 토큰 바인딩 시스템은 **2026-03-02 기준** (섹션 15 참조).

---

## 목차

1. [Redux Store 획득](#1-기본-접근-redux-store)
2. [채팅 메시지 데이터 구조](#2-채팅-메시지-데이터-구조-roommessages)
3. [캐릭터 데이터 구조](#3-캐릭터-데이터-구조-roomcharacters)
    - [3.1 스크린 패널 / 아이템 데이터 구조](#31-스크린-패널--아이템-데이터-구조-roomitems)
4. [Firestore 직접 접근 (읽기 + 쓰기)](#4-firestore-직접-접근-읽기--쓰기)
5. [webpack require 획득 방법](#5-webpack-require-획득-방법)
6. [Redux Store 획득 코드](#6-redux-store-획득-방법)
7. [캐릭터 셀렉터 함수](#7-캐릭터-셀렉터-함수-모듈-88464)
8. [업데이트 대응 가이드](#8-업데이트-대응-가이드)
9. [app.state 상세 구조 및 UI 제어](#9-appstate-상세-구조-및-ui-제어)
10. [Redux Action Type 탐색 기법](#10-redux-action-type-탐색-기법)
11. [DOM 구조 레퍼런스 (MUI 컴포넌트 매핑)](#11-dom-구조-레퍼런스-mui-컴포넌트-매핑)
    - [11.7 배틀맵 / 씬 계층 구조](#117-배틀맵--씬-계층-구조-foreground--background--zoom--pan)
    - [11.8 상단 툴바 (MuiAppBar / MuiToolbar)](#118-상단-툴바-muiappbar--muitoolbar)
    - [11.10 이미지 선택 다이얼로그](#1110-이미지-선택-다이얼로그-image-picker)
    - [11.11 캐릭터 편집 — 스테이터스/매개변수 행](#1111-캐릭터-편집-다이얼로그--스테이터스매개변수-행-구조)
    - [11.12 색상 선택 다이얼로그 (TwitterPicker)](#1112-색상-선택-다이얼로그-twitterpicker)
    - [11.13 네이티브 이미지 선택 스타일](#1113-네이티브-이미지-선택-스타일-선택-삭제-모드)
    - [11.14 스크린/마커 패널 목록](#1114-스크린마커-패널-목록-gm-패널-드로어)
12. [특성 시스템 (Traits)](#12-특성-시스템-traits)
13. [엔티티 전체 목록](#13-엔티티-전체-목록)
14. [UI 디자인 시스템 (테마 규칙)](#14-ui-디자인-시스템-테마-규칙)
15. [토큰 바인딩 시스템 (스크린 패널 ↔ 캐릭터)](#15-토큰-바인딩-시스템-스크린-패널--캐릭터)

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
  entities: { ... }  // 섹션 2-3, 9.1-9.2, 13 참조
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
  faces: [...],                       // 얼굴 표정 배열 [{label, iconUrl}]
  x: 0, y: 0, z: 0,                  // 맵 좌표
  angle: 0,                           // 회전 각도
  width: 4, height: 4,                // 토큰 크기
  active: true,                       // 맵에 활성화 여부 (꺼내기/집어넣기)
  secret: false,                      // ⚠️ "스테이터스를 비공개로 하기" (ccfolia UI label)
  invisible: false,                   // ⚠️ 용도 불명 — setDoc으로 변경해도 UI에 반영 안 됨 (사용 금지)
  hideStatus: false,                  // ⚠️ "화면 캐릭터 목록에 표시하지 않기" (이름과 실제 기능 불일치!)
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
  // ... 방마다 항목이 다름
]
```

**주의**: value는 항상 **문자열(string)**입니다! 숫자로 쓰려면 `parseInt()` 또는 `Number()` 변환 필요.

### faces[] — 얼굴 표정 배열

**확인일: 2026-02-28** — 객체 배열 형태 `{label, iconUrl}`.

```js
// 구조: { label: string, iconUrl: string }
faces: [
  { label: "@보통",     iconUrl: "https://storage.ccfolia-cdn.net/..." },
  { label: "@각성",     iconUrl: "https://storage.ccfolia-cdn.net/..." },
  { label: "@기본후드", iconUrl: "https://storage.ccfolia-cdn.net/..." },
  { label: "",          iconUrl: "https://storage.ccfolia-cdn.net/..." },  // 빈 라벨도 있음
]
```

- `label`은 `@` 접두사가 붙는 경우가 많음 (예: `@보통`, `@각성`, `@스탠딩`)
- `label`이 번호인 경우도 있음 (예: `@0`, `@1`)
- `label`이 빈 문자열인 경우도 있음
- `iconUrl`은 CDN URL
- face 인덱스 0은 `iconUrl` (기본 아이콘)을 의미, faces[0]부터가 표정 1번

---

### 3.1 스크린 패널 / 아이템 데이터 구조 (roomItems)

> 코코포리아의 스크린 패널(맵 위의 이미지 오브젝트)은 `entities.roomItems`에 저장됩니다.
> 캐릭터 토큰(`roomCharacters`)과는 별개의 엔티티이며, 맵에 배치되는 이미지/오브젝트입니다.
>
> **기준**: 2026-02-25 (콘솔 진단으로 확인)

#### 접근 방법

```js
const state = store.getState();
const ri = state.entities.roomItems;

// 모든 아이템 ID
ri.ids  // ['QT20cxKSUJgS6v68721M', 'DrWMO4FkQ4otdjGJ4G7Y', ...]

// 특정 아이템
ri.entities['아이템ID']

// 활성 아이템만
ri.ids.map(id => ri.entities[id]).filter(i => i.active)

// type별 필터
ri.ids.map(id => ri.entities[id]).filter(i => i.type === 'object')  // 오브젝트
ri.ids.map(id => ri.entities[id]).filter(i => i.type === 'plane')   // 배경 패널
```

#### 아이템 객체 키 (25개)

```js
{
  _id: "DrWMO4FkQ4otdjGJ4G7Y",     // Firestore 문서 ID
  x: -40, y: -33, z: 150,           // 맵 좌표 (z = 레이어 순서)
  angle: 0,                          // 회전 각도
  width: 6, height: 6,               // 크기 (칸 단위)
  deckId: null,                      // 카드 덱 ID (카드 아이템 시)
  locked: false,                     // 위치 잠금
  visible: true,                     // 표시 여부
  closed: false,                     // 카드 뒤집기 상태
  withoutOwner: false,               // 소유자 없음
  freezed: false,                    // 고정 (이동 불가)
  type: "object",                    // ★ 타입: "object" | "plane"
  active: true,                      // 맵에 활성화 여부
  owner: "Az1rUAx4...",             // 소유자 UID
  ownerName: "",                     // 소유자 이름
  ownerColor: "",                    // 소유자 색상
  memo: "이동거리: 4\n사거리: 0 | 1", // ★ 메모 (전투 데이터 등)
  imageUrl: "https://storage...",    // ★ 이미지 URL
  coverImageUrl: "",                 // 카드 뒷면 이미지
  clickAction: "",                   // 클릭 액션
  order: -1,                         // 정렬 순서
  createdAt: 1234567890,             // 생성 시각
  updatedAt: 1234567890              // 수정 시각
}
```

#### type별 분류

| type | 설명 | 특징 |
|------|------|------|
| `"object"` | 오브젝트 패널 | 캐릭터 토큰 이미지, 소형 (4×4 ~ 6×6), `memo`에 전투 데이터 |
| `"plane"` | 배경/대형 패널 | 대형 이미지 (19×14 ~ 223×129), 배경 장식용 |

#### memo 필드 활용 (전투 시스템)

스크린 패널의 `memo` 필드를 전투 데이터 저장에 활용합니다.
확인된 memo 형식:

```
이동거리: 4
사거리: 0 | 1
```

```
이동거리｜5
```

```
[대상 지정]
```

**이동거리 파싱**: `memo`에서 "이동거리" 뒤의 숫자를 추출
```js
function parseMoveDistance(memo) {
  if (!memo) return 0;
  const m = memo.match(/이동거리[:\s｜|]+(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}
```

**사거리 파싱**: "사거리" 뒤의 숫자 (복수 값 가능: `0 | 1`)
```js
function parseAttackRange(memo) {
  if (!memo) return [];
  const m = memo.match(/사거리[:\s｜|]+([\d\s|]+)/i);
  if (!m) return [];
  return m[1].split(/\s*\|\s*/).map(Number).filter(n => !isNaN(n));
}
```

#### Firestore 문서 경로

```
rooms/{roomId}/items/{itemId}
```

#### 아이템 이동 (Firestore 직접 쓰기)

```js
const itemsCol = sdk.collection(sdk.db, 'rooms', roomId, 'items');
const itemRef = sdk.doc(itemsCol, item._id);
await sdk.setDoc(itemRef, { x: newX, y: newY, updatedAt: Date.now() }, { merge: true });
```

#### 진단 명령어

```js
// 콘솔에서 실행 (확장 프로그램 로드 상태)
window.dispatchEvent(new CustomEvent('bwbr-dump-items'));
// → type별 분류, 샘플 데이터, active 아이템 목록 출력
```

---

### 3.2 시나리오 텍스트 / 노트 데이터 구조 (roomNotes)

> 코코포리아의 "시나리오 텍스트"는 `entities.roomNotes`에 저장됩니다.
> UI에서는 **시나리오 텍스트 목록** 패널로 표시됩니다.
>
> **기준**: 2026-03-03 (콘솔 진단으로 확인)

#### 접근 방법

```js
const state = store.getState();
const rn = state.entities.roomNotes;
rn.ids    // ['G28mq5M5br6gTOwKcNd8', 'WJV3AgXjKOAh2wsUedwm', ...]
rn.entities['노트ID']
```

#### 노트 객체 키

```js
{
  _id: "G28mq5M5br6gTOwKcNd8",    // Firestore 문서 ID
  name: "서사 장면",                // ★ 텍스트 제목
  iconUrl: "",                      // 아이콘 이미지 URL (빈 문자열이면 기본 아이콘)
  order: -2,                        // 정렬 순서
  createdAt: 1771982971259          // 생성 시각
  // + 기타 본문 필드 (text/html 등)
}
```

#### Firestore 문서 경로

```
rooms/{roomId}/notes/{noteId}
```

#### 특이사항

- 시나리오 텍스트에는 `visible`/`active` 필드가 **없음** → 표시 전환 기능 불가
- 삭제만 가능 (`deleteDoc`)
- DOM 목록에서 굵은 제목(span) 텍스트로 Redux 노트의 `name`과 매칭

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

// writeBatch: 자동 탐색으로 발견 (minified 키 미확정)
// writeBatch(db) → { commit(), set(ref, data, opts), delete(ref), update(ref, data) }
// 최대 500개 작업을 하나의 원자적 트랜잭션으로 커밋

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

### 네이티브 이미지 선택 다이얼로그

> 코코포리아의 이미지 선택창(ROOM/ALL/Unsplash 탭, 7개 카테고리 탭)은 아래 `app.state` 키들로 제어됩니다.
>
> **기준**: 2026-03-02

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `openRoomImageSelect` | boolean | `false` | 이미지 선택 다이얼로그 열림 여부 |
| `openRoomImageSelectGroup` | string | `"room"` | 이미지 그룹 (ROOM/ALL/Unsplash) |
| `openRoomImageSelectDir` | string | `"item"` | 카테고리 디렉토리 (`"item"` = 스크린, `"marker"`, `"character"`, `"foreground"`, `"background"`, 등) |
| `openRoomImageSelectTarget` | string | `""` | 선택 결과 라우팅 대상 (예: `"item/update"`, `"marker/update"`, `"character/update"`) |
| `selectingFiles` | boolean | `false` | 다중 선택 모드 (삭제용) |
| `selectedFileIds` | array | `[]` | 다중 선택된 파일 ID 목록 |

```js
// 네이티브 이미지 피커 열기 (bogus target으로 side-effect 방지)
const appState = store.getState().app.state;
store.dispatch({
  type: 'app/state/seted',
  payload: Object.assign({}, appState, {
    openRoomImageSelect: true,
    openRoomImageSelectDir: 'item',
    openRoomImageSelectTarget: 'bwbr/ext'  // 존재하지 않는 target → selectUserFile이 아무것도 안 함
  })
});
```

**이미지 선택 흐름**:
1. `openRoomImageSelect: true` → MUI Dialog (`MuiDialog-paperWidthMd`) 마운트
2. 사용자가 이미지 클릭 → `onSelect(url)` → `selectUserFile(url)` thunk 실행
3. `selectUserFile`은 `openRoomImageSelectTarget`을 읽어 `ge[target]`으로 라우팅
4. 존재하지 않는 target 사용 시 `ge[target]`이 `undefined` → thunk가 아무것도 안 함 (안전)
5. 이후 `appStateMutate`로 `openRoomImageSelect: false` 설정 → 피커 닫힘

**확장 프로그램의 활용 방법** (bwbr-open-native-image-picker):
- bogus target으로 피커를 열고, DOM capture-phase click 이벤트에서 `<img src>`를 읽어 URL 획득
- `store.subscribe()`로 `openRoomImageSelect: false` 전환 감지하여 취소 처리

**React 컴포넌트 체인**: `k7 → A7 → dce → vce → bce`
**Dialog 선택자**: `.MuiDialog-paperWidthMd[role="dialog"]`
**이미지 아이템 구조**: `DIV.sc-*(onClick) → IMG(src=파일URL)`

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

### 9.1 rooms 엔티티 (방 설정 전체)

> 방 설정은 `entities.rooms.entities.{roomId}` 에 Firestore 문서로 저장됩니다.
> `app.state`가 아닌 `entities.rooms`에 있으므로 변경 시 Firestore 직접 쓰기가 필요합니다.
>
> **기준**: 2026-02-27 (진단 bwbr-dump-room 결과)

#### 전체 필드 목록 (52개)

| 필드 | 타입 | 설명 |
|-------|------|------|
| `_id` | string | 방 ID |
| `name` | string | 방 이름 |
| `owner` | string | 방 주인 UID |
| **필드/배경** | | |
| `backgroundUrl` | string\|null | 배경 이미지 URL |
| `foregroundUrl` | string\|null | 전경 이미지 URL |
| `fieldObjectFit` | string | 이미지 맞춤 (`cover` 등) |
| `fieldWidth` | number | 필드 너비 |
| `fieldHeight` | number | 필드 높이 |
| `backgroundColor` | string | 배경색 |
| `mapType` | string | 맵 타입 |
| **그리드** | | |
| `displayGrid` | boolean | 그리드 표시 여부 |
| `gridSize` | number | 그리드 한 칸 크기 |
| `alignWithGrid` | boolean | 그리드 정렬 |
| `markers` | Object\<string, MarkerData\> | 라이브 마커 (key=마커ID, value=마커데이터). 장면 적용 시 장면의 markers가 여기에 복사됨 |
| **BGM / 사운드** | | |
| `soundUrl` | string\|null | BGM URL |
| `soundVolume` | number | BGM 볼륨 |
| `soundName` | string\|null | BGM 이름 |
| `soundRef` | string\|null | BGM 업로드 참조 |
| `soundRepeat` | boolean | BGM 반복 |
| `soundMasterToken` | string\|null | 사운드 마스터 토큰 |
| **미디어 (YouTube 등)** | | |
| `mediaUrl` | string\|null | 미디어 URL |
| `mediaVolume` | number | 미디어 볼륨 |
| `mediaName` | string\|null | 미디어 이름 |
| `mediaRef` | string\|null | 미디어 업로드 참조 |
| `mediaRepeat` | boolean | 미디어 반복 |
| `mediaType` | string\|null | 미디어 타입 |
| **장면** | | |
| `sceneId` | string\|null | 현재 적용된 장면 ID |
| `enableCrossfade` | boolean | 크로스페이드 사용 여부 |
| `crossfadeDuration` | number | 크로스페이드 지속시간 |
| **주사위** | | |
| `diceBotName` | string | 다이스봇 표시명 |
| `diceBotSystem` | string | 다이스봇 시스템 |
| `hidden3dDice` | boolean | 3D 주사위 숨김 |
| **기타** | | |
| `embedUrl` | string\|null | 임베드 URL |
| `thumbnailUrl` | string\|null | 썸네일 |
| `video` | any | 비디오 설정 |
| `timer` | any | 타이머 (개인 대기실 등) |
| `variables` | object | 방 변수 |
| `features` | object | 기능 플래그 |
| `messageChannels` | array | 메시지 채널 |
| `messageGroups` | array | 메시지 그룹 |
| **권한/멤버** | | |
| `defaultRole` | string | 기본 역할 (`player` 등) |
| `defaultAnonymousRole` | string\|null | 익명 기본 역할 |
| `monitored` | boolean | 모니터링 모드 |
| `underConstruction` | boolean | 공사 중 |
| `archived` | boolean | 아카이브됨 |
| **프리미엄/패키지** | | |
| `appliedExtentionProductIds` | array | 적용된 확장 제품 ID |
| `parentProductId` | string\|null | 부모 제품 ID |
| `parentRoomPackageId` | string\|null | 부모 방 패키지 ID |
| `publishedRoomPackageId` | string\|null | 공개된 방 패키지 ID |
| `initialSavedata` | any | 초기 세이브데이터 |
| **타임스탬프** | | |
| `createdAt` | timestamp | 생성일 |
| `updatedAt` | number | 마지막 수정 (Date.now()) |

#### 필드 그룹별 Firestore 쓰기 예시

```js
// BGM 변경
const roomRef = sdk.doc(sdk.collection(sdk.db, 'rooms'), roomId);
await sdk.setDoc(roomRef, {
  soundUrl: 'https://example.com/bgm.mp3',
  soundVolume: 0.5,
  soundName: 'My BGM',
  updatedAt: Date.now()
}, { merge: true });

// 배경 이미지 변경
await sdk.setDoc(roomRef, {
  backgroundUrl: 'https://example.com/bg.jpg',
  foregroundUrl: null,
  updatedAt: Date.now()
}, { merge: true });
```

> **주의**: `app.state`에는 `displayGrid` 키가 존재하지 않습니다 (174개 키 중 grid 관련 없음).
> Redux 상태는 Firestore 실시간 리스너를 통해 자동 동기화됩니다.

#### MarkerData 구조

> 마커 키는 16진수 타임스탬프 기반 문자열 (예: `19c61886089`).
> **기준**: 2026-03-03 진단 결과

| 필드 | 타입 | 설명 |
|-------|------|------|
| `x` | number | X 좌표 (그리드 단위) |
| `y` | number | Y 좌표 (그리드 단위) |
| `z` | number | Z-order (높을수록 앞) |
| `width` | number | 너비 (그리드 단위) |
| `height` | number | 높이 (그리드 단위) |
| `locked` | boolean | 잠김 여부 |
| `freezed` | boolean | 고정 여부 |
| `text` | string | 마커 텍스트 |
| `imageUrl` | string\|null | 마커 이미지 URL |
| `clickAction` | any\|null | 클릭 액션 |

```js
// 마커 복제 (room 문서에 직접 쓰기 — writeBatch.update 권장)
const roomRef = sdk.doc(sdk.collection(sdk.db, 'rooms'), roomId);
const batch = sdk.writeBatch(sdk.db);
batch.update(roomRef, {
  [`markers.${newKey}`]: { x: 5, y: 5, z: 50, width: 4, height: 4, locked: false, freezed: false, text: '', imageUrl: '', clickAction: null },
  updatedAt: Date.now()
});
await batch.commit();

// 마커 삭제 (deleteField 센티넬 사용)
batch.update(roomRef, {
  [`markers.${targetKey}`]: deleteField(),
  updatedAt: Date.now()
});
```

> **중요**: 라이브 마커는 **room 문서** (`rooms/{roomId}`)의 `markers` 필드입니다.
> 씬의 `markers`는 장면 스냅샷일 뿐이며, 씬에 쓰면 지도에 반영되지 않습니다.

### 9.2 roomScenes 엔티티 (장면 목록)

> 장면은 `entities.roomScenes` 에 저장됩니다 (normalized: `{ ids: [...], entities: {...} }`).
> Firestore 경로: `rooms/{roomId}/scenes/{sceneId}`
>
> **기준**: 2026-02-27 (진단 bwbr-dump-scenes 결과)

#### 접근 방법

```js
const state = store.getState();
const scenes = state.entities.roomScenes;
// scenes.ids: ['ErC4TGtUdqhCtNk36nZf', 'BG1jMXevRsJtC489BMat', ...]
// scenes.entities[id]: { _id, name, backgroundUrl, ... }
```

#### 장면 필드 (26개)

| 필드 | 타입 | 설명 |
|-------|------|------|
| `_id` | string | 장면 ID |
| `name` | string | 장면 이름 (표시용) |
| **배경/전경** | | |
| `backgroundUrl` | string\|null | 배경 이미지 URL |
| `foregroundUrl` | string\|null | 전경 이미지 URL |
| `fieldObjectFit` | string | 이미지 맞춤 (`cover` 등) |
| `fieldWidth` | number | 필드 너비 |
| `fieldHeight` | number | 필드 높이 |
| **그리드** | | |
| `displayGrid` | boolean | 그리드 표시 |
| `gridSize` | number | 그리드 크기 |
| `markers` | Object\<string, MarkerData\> | 마커 스냅샷 (장면 불러오기 시 room.markers에 복사됨) |
| **텍스트** | | |
| `text` | string\|null | 장면 전환 시 표시되는 텍스트 |
| **BGM** | | |
| `soundUrl` | string\|null | BGM URL |
| `soundVolume` | number | BGM 볼륨 |
| `soundName` | string\|null | BGM 이름 |
| `soundRef` | string\|null | BGM 업로드 참조 |
| `soundRepeat` | boolean | BGM 반복 |
| **미디어** | | |
| `mediaUrl` | string\|null | 미디어 URL |
| `mediaVolume` | number | 미디어 볼륨 |
| `mediaName` | string\|null | 미디어 이름 |
| `mediaRef` | string\|null | 미디어 업로드 참조 |
| `mediaRepeat` | boolean | 미디어 반복 |
| `mediaType` | string\|null | 미디어 타입 |
| **메타** | | |
| `locked` | boolean | 잠김 여부 |
| `order` | number | 정렬 순서 |
| `createdAt` | timestamp | 생성일 |
| `updatedAt` | timestamp | 수정일 |

#### 장면 적용 방법

장면의 필드를 방 문서에 복사하는 방식으로 작동합니다:

```js
// 장면 이름으로 검색
const scene = Object.values(scenes.entities)
  .find(s => s.name === '논밭');

// 방 문서에 장면 필드 복사 (blacklist 제외)
const blacklist = ['_id', 'name', 'locked', 'order', 'createdAt', 'updatedAt'];
const update = { updatedAt: Date.now() };
for (const [key, val] of Object.entries(scene)) {
  if (!blacklist.includes(key)) update[key] = val;
}
await sdk.setDoc(roomRef, update, { merge: true });
```

> **장면 필드와 방 필드는 동일한 이름을 공유**합니다 (`backgroundUrl`, `soundUrl` 등).
> 장면 적용 = 장면 필드를 방 문서에 덮어쓰기.

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

#### ⚠️ ClickAwayListener 동작 (중요)

> **기준**: 2026-03-07 (콘솔 진단으로 확인)

MUI Popover 내부의 `ClickAwayListener`는 **`mousedown`** 이벤트에서 팝오버를 닫는다.
`contextmenu` 이벤트는 `mouseup` 이후에 발생하므로, **우클릭 시 contextmenu 핸들러가 실행될 시점에는 팝오버가 이미 DOM에서 제거된 상태**이다.

이벤트 순서: `mousedown` → (MUI가 팝오버 닫음) → `mouseup` → `contextmenu` (팝오버 없음)

**대응 패턴**: capture-phase `mousedown` (button===2) 리스너에서 캐릭터 정보를 **선점 캐시**하고, `contextmenu` 핸들러에서 직접 감지 실패 시 캐시를 폴백으로 사용한다.

```js
// mousedown capture에서 선점 캐시
document.addEventListener('mousedown', function(e) {
  cache = null;
  if (e.button !== 2) return;
  var info = findCharacterItemFromTarget(e.target); // 팝오버가 아직 DOM에 있음
  if (info) cache = info;
}, true); // capture!

// contextmenu에서 폴백
document.addEventListener('contextmenu', function(e) {
  var info = findCharacterItemFromTarget(e.target); // 대부분 null (팝오버 이미 닫힘)
  if (!info && cache) info = cache;               // 캐시 폴백
}, false);
```

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

### 11.1b 룸 변수 편집 다이얼로그

> 메뉴 → 룸 변수 편집으로 열리는 MuiDialog.
> 확장 프로그램의 트리거 관리 UI가 이 구조를 그대로 복제합니다.
>
> **기준**: 2026-03-02 (콘솔 진단)

#### 컨테이너 구조

```
DIV.MuiDialog-root.MuiModal-root[role="presentation"]
├─ DIV.MuiBackdrop-root.MuiModal-backdrop
│    bg: rgba(0,0,0,0.5)
│    transition: opacity 0.225s cubic-bezier(0.4,0,0.2,1)
├─ DIV (빈 요소)
├─ DIV.MuiDialog-container.MuiDialog-scrollPaper[role="presentation"]
│  └─ DIV.MuiPaper-root.MuiPaper-elevation24.MuiDialog-paper[role="dialog"]
│     ├─ HEADER.MuiAppBar-root.MuiAppBar-colorDefault (sticky, top:0)
│     │    bg: rgb(33,33,33), height: 64px
│     │    boxShadow: elevation-4
│     │    └─ DIV.MuiToolbar-root (padding: 0 24px, height: 64px, minHeight: 64px)
│     │       ├─ P.MuiTypography-body1 (flex:1)
│     │       │    fontSize: 20px, fontWeight: 700, Roboto, letterSpacing: 0.19px
│     │       └─ BUTTON.MuiIconButton-edgeEnd.MuiIconButton-sizeLarge (닫기)
│     │            48×48px, padding: 12px, margin: 0 -12px 0 0, color: #fff
│     ├─ DIV.MuiDialogContent-root
│     │    padding: 20px 24px, overflow: auto
│     │    ├─ DIV.MuiToolbar-dense (height: 48px)
│     │    │   ├─ H6.MuiTypography-subtitle2
│     │    │   │    fontSize: 14px, fontWeight: 700, Roboto, letterSpacing: 0.1px
│     │    │   └─ BUTTON.MuiIconButton-sizeSmall (−/+)
│     │    ├─ SPAN.MuiTypography-caption
│     │    │    fontSize: 12px, fontWeight: 400, Roboto, letterSpacing: 0.4px
│     │    └─ UL.MuiList-root
│     │       └─ LI.MuiListItem-root
│     │            padding: 8px 16px, alignItems: flex-start
│     │            ├─ .MuiListItemText-primary
│     │            │    fontSize: 14px, fontWeight: 700, color: rgb(224,224,224), Roboto
│     │            │    letterSpacing: 0.1px, lineHeight: 22px
│     │            └─ .MuiListItemText-secondary
│     │                 fontSize: 14px, fontWeight: 400, color: rgb(255,255,255), Roboto
│     │                 letterSpacing: 0.15px, lineHeight: 20px
│     └─ DIV.MuiDialogActions-root
│          padding: 8px, justifyContent: flex-end
│          └─ BUTTON.MuiButton-textPrimary.MuiButton-fullWidth
│               color: rgb(33,150,243), fontSize: 14px, fontWeight: 700, Roboto
│               letterSpacing: 0.4px, textTransform: uppercase, lineHeight: 24.5px
│               transition: background-color/box-shadow/border-color/color 0.25s
└─ DIV (빈 요소)
```

#### Paper 스타일

| 속성 | 값 |
|------|-----|
| background | `rgba(44, 44, 44, 0.87)` — **반투명** |
| color | `rgb(255, 255, 255)` |
| fontFamily | `"Noto Sans KR"` |
| fontSize | `16px` (base) |
| border-radius | `4px` |
| width / maxWidth | `600px` |
| maxHeight | `calc(100% - 64px)` |
| margin | `32px` |
| overflow | `auto` |
| boxShadow | elevation-24 (0 11px 15px -7px ...) |
| transition | `box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1)` |

#### 아이콘 버튼 스타일

| 대상 | 크기 | padding | 비고 |
|------|------|---------|------|
| MuiIconButton-root (기본) | 40×40px | 8px | transition: bg 0.15s |
| MuiIconButton-sizeLarge (닫기×) | 48×48px | 12px | margin: 0 -12px 0 0 (edgeEnd) |
| MuiIconButton-sizeSmall | 28×28px | 5px | content 내부에서 사용 |

#### 디바이더 스타일

| 속성 | 값 |
|------|-----|
| borderColor | `rgba(255, 255, 255, 0.08)` |
| margin | `0px 16px` |

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

#### 네이티브 MUI MenuItem 정확한 CSS 값

> **기준**: 2026-03-07 (콘솔 진단 — `getComputedStyle()`로 측정)

**MuiPaper-root.MuiMenu-paper:**

| 속성 | 값 |
|------|----|
| `background-color` | `rgba(44, 44, 44, 0.87)` |
| `border-radius` | `4px` |
| `padding` | `0px` (UL에 패딩 위임) |
| `box-shadow` | elevation-8 (섹션 14 참조) |

**ul.MuiList-root:**

| 속성 | 값 |
|------|----|
| `padding` | `8px 0px` |

**li.MuiMenuItem-root:**

| 속성 | 값 |
|------|----|
| `font-family` | `Roboto, Helvetica, Arial, sans-serif` |
| `font-size` | `14px` |
| `font-weight` | `400` |
| `line-height` | `20.02px` |
| `letter-spacing` | `0.14994px` |
| `padding` | `4px 16px` |
| `min-height` | `32px` |
| `color` | `rgb(255, 255, 255)` |
| hover `background-color` | `rgba(255, 255, 255, 0.08)` |

**MuiPopover-root:**

| 속성 | 값 |
|------|----|
| `position` | `fixed` |
| `z-index` | `1300` |

**MuiBackdrop-root:**

| 속성 | 값 |
|------|----|
| `background-color` | `rgba(0, 0, 0, 0)` (투명) |
| `opacity` | `1` |

**className 구성**: `MuiButtonBase-root MuiMenuItem-root MuiMenuItem-gutters css-rml83f`

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
> **기준**: 2026-02-25 (콘솔 진단으로 확인, 2026-02-25 재검증)

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
└─ div.MuiPopover-root                           ← Portal (body 직속)
   ├─ div.MuiBackdrop-root                      ← 투명 백드롭
   └─ div.MuiPaper-root.MuiMenu-paper           ← 실제 메뉴 패널
      └─ ul.MuiList-root [role="menu"]           ← role="menu" 있음!
         ├─ div.MuiListItemButton-root           ← 메뉴 아이템 1
         │  ├─ div.MuiListItemAvatar-root → 아바타 이미지 (아이콘 아님!)
         │  └─ div.MuiListItemText-root
         │     ├─ span.MuiTypography-root → "전경, 배경을 변경" (primary)
         │     └─ p.MuiTypography-root    → "메인 필드의 이미지를 설정합니다" (secondary)
         ├─ div.MuiListItemButton-root           ← 메뉴 아이템 2
         └─ ... (총 6개: 전경/배경, 스크린패널, 마커패널, 다이스심볼, 카드덱, 타이머)
```

> **중요 (2026-02-25 확인)**:
> - `MuiListItemIcon-root` 가 아닌 `MuiListItemAvatar-root` 사용
> - `role="menu"` 가 list에 설정되어 있음 → role로 제외하면 안 됨!
> - 캐릭터 선택 메뉴도 `MuiListItemAvatar-root` 사용 → 아바타로 구분 불가
> - 캐릭터 선택 메뉴도 `MuiTypography-root` 2개 ("[ 이름 ] | 활성화 상태") → typography 개수로 구분 불가!
> - **식별 기준 (최종)**: list의 `textContent`에 **"스크린 패널"** (KR) 또는 **"スクリーンパネル"** (JP) 키워드 포함 여부. FAB 메뉴에만 존재하는 고유 텍스트.

#### 주입 전략 (수정됨 2026-02-25 v2)

1. `MutationObserver`로 body 감시 (메뉴 열릴 때 Popover DOM 생성됨)
2. `.MuiPopover-root` 안의 `.MuiPaper-root > .MuiList-root` 찾기
3. 아이템 4개 이상 + list textContent에 "스크린 패널" 또는 "スクリーンパネル" 포함 → FAB 메뉴
4. `.MuiListItemButton-root` 복제 → PRO 뱃지 제거, 아이콘/라벨 교체
5. `list.insertBefore(clone, list.firstChild)` 로 맨 위에 삽입

#### 주의사항

- 메뉴 닫으면 MuiPopover DOM 전체 제거됨 → 열 때마다 재주입 필요
- PRO 기능 아이템은 Chip/Badge + secondary text 포함 → 복제 시 반드시 제거
- Popover backdrop이 클릭을 가로챌 수 있으므로 capture phase로 핸들러 등록
- FAB 조부모(sc-geBDJh) 안의 MuiIconButton들은 **툴바 버튼**이며 메뉴 아이템이 아님

### 11.9 네이티브 그리드 (displayGrid) DOM

> **기준**: 2026-02-26 (콘솔 진단으로 확인)
>
> `displayGrid = true` 상태에서 zoom container 내부에 별도의 그리드 DOM 요소(canvas, SVG 등)가
> **생성되지 않습니다.** (2026-02-24 실측: zoom container 자식 = 전경 + .movable들 + 커스텀 오버레이뿐)
>
> 네이티브 그리드는 **전경 div의 자식 div** (`fg.children[1]`)에 `linear-gradient` CSS background로 렌더링됩니다.
>
> ```
> zoom container
> └─ [0] 전경 div (position:absolute)
>      ├─ [0] <IMG>    전경 이미지
>      └─ [1] <DIV>    ★ 네이티브 그리드 (linear-gradient background)
>                       background: linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px),
>                                   linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)
>                       background-size: 24px 24px
> ```
>
> 커스텀 그리드 활성 시 `fg`에 `data-bwbr-no-grid` 속성을 부여하고,
> CSS 규칙 `[data-bwbr-no-grid], [data-bwbr-no-grid] > * { background: transparent !important }` 로
> 전경 본체와 그리드 자식 div 모두의 배경을 투명화하여 네이티브 그리드를 숨깁니다.

---

### 11.8 상단 툴바 (MuiAppBar / MuiToolbar)

> 방 이름, GM 패널 아이콘, 메뉴 버튼 등이 배치된 최상단 바입니다.
> 확장 프로그램의 트리거 관리 버튼이 여기에 삽입됩니다.
>
> **기준**: 2026-02-27 (콘솔 진단)

#### 컨테이너 구조

```
body
└─ div.MuiAppBar-root (rect: 0,0,1972,64)  ← 메인 상단 앱바
   └─ div.MuiToolbar-root.css-i6s8oy       ← 툴바 컨테이너 (12개 자식)
      ├─ [0] button     → 방 이름 ("가지세계: ...")
      ├─ [1] div.sc-ezjsFQ.jjnrsH          → 스페이서 (flex-grow:1)
      ├─ [2] button (aria-label="내 캐릭터 목록")
      ├─ [3] button (aria-label="[GM] 스크린 패널 목록")
      ├─ [4] button (aria-label="[GM] 마커 패널 목록")
      ├─ [5] button (aria-label="[GM] 시나리오 텍스트 목록")
      ├─ [6] button (aria-label="[GM] 장면 목록")
      ├─ [7] button (aria-label="[GM] 컷인 목록")
      ├─ [★] button#bwbr-toolbar-trigger-btn  ← 확장 프로그램 삽입 (트리거 관리)
      ├─ [8] button (aria-label="메뉴")     → 3점 메뉴 (다른 sc-* 클래스)
      ├─ [9] button.MuiIconButton-edgeEnd   → 작은 버튼
      ├─ [10] div (스페이서)
      └─ [11] button (사용자 아바타)
```

#### 아이콘 버튼 스타일 클래스

| 대상 | 클래스 |
|------|--------|
| 일반 아이콘 버튼 ([2]~[7]) | `MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeMedium sc-hmvjWG eIQXVN` |
| 메뉴 버튼 ([8]) | `sc-iiBnab hyDHhC` (별도 styled-components 클래스) |

**핵심 포인트**:
- 확장 프로그램 버튼은 **일반 아이콘 버튼**의 `className`을 복제하여 네이티브 외관 상속
- 삽입 위치: `[aria-label="메뉴"]` 버튼 앞 (`insertBefore`)
- MuiAppBar[0] = 메인 상단 바 (y≈0, width > 500), MuiAppBar[1] = 채팅 드로어 헤더 (y≈1372)
- SVG 아이콘: viewBox 0 0 24, `MuiSvgIcon-root` 클래스 + `fill:currentColor`

#### 셀렉터 가이드

| 대상 | 셀렉터 |
|------|--------|
| 메인 앱바 | `.MuiAppBar-root` (rect.top < 10 && width > 500) |
| 메뉴 버튼 | `[aria-label="메뉴"]` |
| 일반 아이콘 버튼 | `button.MuiIconButton-root.MuiIconButton-sizeMedium` |
| 툴바 컨테이너 | `.MuiToolbar-root` (MuiAppBar 내부) |

---

### 11.10 이미지 선택 다이얼로그 (Image Picker)

> 캐릭터 이미지·컷인·배경 등을 선택하는 공용 이미지 피커입니다.
> 확장 프로그램의 표정 일괄 추가(face-bulk-add.js)가 이 구조를 이용합니다.
>
> **기준**: 2026-03-03 (콘솔 진단)

#### 컨테이너 구조

```
body
└─ DIV.MuiDialog-root.MuiModal-root[role="presentation"]
   └─ DIV.MuiDialog-container.MuiDialog-scrollPaper
      └─ DIV.MuiPaper-root.MuiDialog-paper.MuiDialog-paperWidthMd[role="dialog"]
         │                               ↑ 핵심: paperWidthMd 로 다른 다이얼로그와 구분
         ├─ HEADER.MuiAppBar-root.MuiAppBar-colorDefault (sticky)
         │    └─ DIV.MuiToolbar-root.css-i6s8oy
         │       ├─ DIV.MuiButtonGroup-root  →  ROOM / ALL / Unsplash 탭 전환
         │       └─ BUTTON "선택 삭제" (MuiToolbar 내부)
         │
         ├─ DIV.MuiTabs-root (탭 헤더 — ROOM 모드일 때)
         │    └─ BUTTON × N [role="tab"]  →  전경 / 배경 / 캐릭터 / 스크린 /
         │                                    스크린 뒷면 / 마커 / 컷인
         │
         ├─ (이미지 그리드 영역)
         │    └─ IMG × N  (https:// 로 시작, naturalWidth > 40)
         │       - 각 img.alt = 파일명 (확장자 포함)
         │       - 컨테이너 button/header/tab 내부 img 제외 필요
         │
         └─ DIV.MuiDialogActions-root
              └─ BUTTON.MuiButton-textPrimary  →  "닫기"
```

#### 셀렉터 가이드

| 대상 | 셀렉터 |
|------|--------|
| 피커 다이얼로그 | `.MuiDialog-paperWidthMd[role="dialog"]` |
| 그리드 이미지 | `picker.querySelectorAll('img')` + `src.startsWith('https://')` + `naturalWidth > 40` |
| 닫기 버튼 | `.MuiDialogActions-root .MuiButton-textPrimary` |
| "선택 삭제" 버튼 | `.MuiToolbar-root` 내부 버튼 텍스트 매칭 |

#### 확장 프로그램 활용

- **face-bulk-add.js**: 캐릭터 편집 중 피커가 열리면 자동으로 다중 선택 모드 활성화
  - 이미지 클릭 → 체크 오버레이 토글 (네이티브 단일 선택 차단: `stopPropagation()`)
  - "추가 (N)" 버튼을 닫기 버튼 옆에 `cloneNode(false)` + `insertBefore`로 삽입
  - 선택된 이미지의 `img.alt`에서 확장자 제거 → `@파일명` 형태로 표정 이름 자동 생성

---

### 11.11 캐릭터 편집 다이얼로그 — 스테이터스/매개변수 행 구조

> 캐릭터 편집 다이얼로그 내 "스테이터스"·"매개변수" 섹션의 입력 행입니다.
> 확장 프로그램의 드래그 순서 변경(drag-reorder.js)이 이 구조를 이용합니다.
>
> **기준**: 2026-03-03 (콘솔 진단)

#### 섹션 탐색 방법

```
[role="dialog"]:not(.MuiDialog-paperWidthMd)   ← 캐릭터 편집 다이얼로그
  └─ MuiDialogContent-root
      ├─ DIV.MuiToolbar-root.MuiToolbar-dense
      │   ├─ H6.MuiTypography-subtitle2  →  "스테이터스"
      │   └─ BUTTON (+/−)
      ├─ SPAN.MuiTypography-caption  →  설명 텍스트 (height ~40px)
      ├─ DIV (행 — 스타일드 컴포넌트)  ← 스테이터스 행 × N
      │   ├─ input[name="status.0.label"]  (text)
      │   ├─ input[name="status.0.value"]  (number)
      │   └─ input[name="status.0.max"]    (number)
      ├─ DIV (행) ...
      │
      ├─ DIV.MuiToolbar-root.MuiToolbar-dense
      │   ├─ H6.MuiTypography-subtitle2  →  "매개변수"
      │   └─ BUTTON (+/−)
      ├─ SPAN.MuiTypography-caption
      ├─ DIV (행)  ← 매개변수 행 × N
      │   ├─ input[name="params.0.label"]  (text)
      │   └─ input[name="params.0.value"]  (text)
      └─ ...
```

#### 행 구조 상세

```
DIV (스타일드 컴포넌트: sc-* 클래스, 빌드마다 변경됨)
├─ MuiFormControl-root.MuiTextField-root  ← "라벨" 필드
│   └─ DIV.MuiInputBase-root
│       └─ INPUT[name="status.N.label"][type="text"]
├─ MuiFormControl-root.MuiTextField-root  ← "값" 필드
│   └─ DIV.MuiInputBase-root
│       └─ INPUT[name="status.N.value"][type="number"]
└─ MuiFormControl-root.MuiTextField-root  ← "최대값" 필드 (스테이터스만)
    └─ DIV.MuiInputBase-root
        └─ INPUT[name="status.N.max"][type="number"]
```

- 스테이터스 행: input 3개 (`label/value/max`)
- 매개변수 행: input 2개 (`label/value`)

#### input name 패턴

| 필드 | name 형식 | type |
|------|-----------|------|
| 스테이터스 라벨 | `status.N.label` | text |
| 스테이터스 값 | `status.N.value` | number |
| 스테이터스 최댓값 | `status.N.max` | number |
| 매개변수 라벨 | `params.N.label` | text |
| 매개변수 값 | `params.N.value` | text |

(`N` = 0부터 시작하는 인덱스)

#### React controlled input 갱신 방법

ccfolia는 React controlled input을 사용하므로, DOM에서 값을 변경할 때
반드시 **native setter + 이벤트 디스패치** 패턴을 사용해야 합니다:

```js
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(input, newValue);
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

이 패턴 없이 `input.value = x` 로 설정하면 React가 변경을 감지하지 못합니다.

#### 셀렉터 가이드

| 대상 | 셀렉터 / 방법 |
|------|---------------|
| 캐릭터 편집 다이얼로그 | `[role="dialog"]:not(.MuiDialog-paperWidthMd)` + h6에 "스테이터스"/"매개변수" 포함 여부 확인 |
| 섹션 헤더 | `h6` (텍스트: "스테이터스", "매개변수", "ステータス", "パラメータ") |
| 행 수집 | 헤더 부모(MuiToolbar-root)의 `nextElementSibling`을 순회, `DIV` + `input ≥ 2` 조건 |
| 다음 섹션 경계 | `sib.classList.contains('MuiToolbar-root')` |

⚠️ 행의 styled-components 클래스(`sc-*`)는 빌드마다 변경되므로 **절대 의존하지 말 것**.
`input` 개수(≥2)와 `tagName === 'DIV'` 조건으로 식별합니다.

---

### 11.12 색상 선택 다이얼로그 (TwitterPicker)

> 캐릭터 이름 색상 등을 선택할 때 열리는 색상 다이얼로그입니다.
> 확장 프로그램의 HSV 컬러피커(color-picker.js)가 이 구조를 이용합니다.
>
> **기준**: 2026-03-03 (콘솔 진단)

#### 컨테이너 구조

```
DIV.MuiDialog-root.MuiModal-root
  └─ DIV.MuiDialog-container
     └─ DIV.MuiDialog-paper.MuiDialog-paperWidthSm[role="dialog"]
        └─ MuiDialogContent-root
           └─ DIV.twitter-picker     ← react-color의 TwitterPicker 컴포넌트
              ├─ (확장 프로그램 주입) DIV#ce-color-picker
              │   ├─ CANVAS (SV 영역: 246×130px)
              │   ├─ CANVAS (Hue 바: 246×12px)
              │   └─ DIV (선택 미리보기 원: 18×18px)
              ├─ DIV (프리셋 색상 스와치 그리드)
              │   └─ SPAN × N (각 색상 칩)
              └─ DIV (hex 입력 필드)
                 └─ INPUT[id^="rc-editable-input-"]
                    type: text, spellcheck: false
```

#### 확장 프로그램 연동 포인트

- **TwitterPicker 감지**: `MutationObserver` → `.MuiDialog-paper .twitter-picker` 셀렉터 매칭
- **hex 입력 필드**: `input[id^="rc-editable-input-"]` → React controlled
  - 값 설정: native setter + `input` + `change` 이벤트 (React bridge 패턴)
- **HSV 피커 주입 위치**: `.twitter-picker`의 `firstChild` 앞에 `insertBefore`
- **색상 동기화**: hex input 값 ↔ HSV 캔버스 양방향 동기화 (MutationObserver로 input 변경 감지)

---

### 11.13 네이티브 이미지 선택 스타일 ("선택 삭제" 모드)

> 이미지 피커에서 "선택 삭제" 버튼 클릭 시 활성화되는 다중 선택 모드의 시각 스타일입니다.
> 확장 프로그램의 표정 일괄 추가(face-bulk-add.js) 및 패널 관리(panel-manager.js)가
> 이 스타일을 재사용합니다.
>
> **기준**: 2026-03-03 (콘솔 진단)

#### 선택 삭제 모드 진입 감지

```
툴바(.MuiToolbar-root) 내 버튼 텍스트:
  - 일반 모드: "선택 삭제" 버튼 존재
  - 삭제 모드: "취소" (한) / "キャンセル" (일) / "Cancel" (영) 버튼 존재
  + 선택 개수 표시 버튼 (숫자만)
```

#### SVG 체크 서클 (16×16)

모든 이미지에 SVG 원형 체크가 오버레이됩니다. 위치: `position: absolute; top: 4px; left: 4px`.

**미선택 상태** (빈 원):
```html
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="sc-cOoixM hoOXjR">
  <circle cx="8" cy="8" r="7.5" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.8)"/>
</svg>
```

**선택 상태** (파란 원 + 체크마크):
```html
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="sc-gwWxZU iHRxJu">
  <circle cx="8" cy="8" r="7.5" fill="#2196F3" stroke="white"/>
  <path d="M6.57109 11.5L3.24609 8.175L4.07734 7.34375L6.57109 9.8375L11.9232 4.48541L12.7544 5.31666L6.57109 11.5Z" fill="white"/>
</svg>
```

#### 이미지 컨테이너 구조 (삭제 모드)

```
DIV.sc-eEnVzt (position: relative, border: 1px solid rgba(0,0,0,0.2))
├─ IMG (이미지)
├─ (선택 시) SPAN.MuiTypography-caption → 파일명 라벨
└─ SVG (체크 서클, position: absolute, top: 4px, left: 4px)
```

- 선택된 이미지: children 3개 (img + label + SVG checked)
- 미선택 이미지: children 2개 (img + SVG unchecked)
- 컨테이너 스타일은 선택 여부에 무관하게 동일 (border, opacity 변화 없음)

#### 확장 프로그램 재사용 가이드

체크 SVG를 프로그래밍적으로 생성:
```js
const SVGNS = 'http://www.w3.org/2000/svg';
const CHECK_D = 'M6.57109 11.5L3.24609 8.175L4.07734 7.34375L6.57109 9.8375L11.9232 4.48541L12.7544 5.31666L6.57109 11.5Z';

function createCheckSVG() { /* circle + optional path */ }
function paintCheck(svg, selected) {
  // selected: fill=#2196F3, stroke=white, + path
  // unselected: fill=rgba(0,0,0,0.3), stroke=rgba(255,255,255,0.8), path 제거
}
```

---

### 11.14 스크린/마커 패널 목록 (GM 패널 드로어)

> 상단 툴바의 "[GM] 스크린 패널 목록" / "[GM] 마커 패널 목록" 버튼으로 열리는 패널 리스트입니다.
> 확장 프로그램의 패널 관리(panel-manager.js)가 이 구조를 이용합니다.
>
> **기준**: 2026-03-03 (콘솔 진단)

#### 컨테이너 구조 (react-rnd 3단계)

> **기준**: 2026-03-04 (콘솔 진단 — 조상 체인 분석)
>
> react-rnd가 **3단계 DOM**을 생성합니다. 크기 변경 시 innerResize만 수정해야 합니다.
> outerDrag의 width/height나 transform을 직접 수정하면 react-rnd 내부 상태와
> 불일치하여 **첫 드래그 시 위치가 튀는 현상**이 발생합니다.

```
body
└─ DIV [outerDrag] (position: absolute, transform: translate3d(Xpx, Ypx, 0px))
   │   → react-rnd 드래그/위치 관리. 내부 상태로 위치 추적.
   │   → ⚠ style.width/height/transform을 외부에서 직접 수정하면 안 됨
   │
   └─ DIV [innerResize] (position: absolute, style.width/height = 실제 패널 크기)
      │   → react-rnd 리사이즈 핸들 + 실제 보이는 크기를 결정
      │   → ✅ style.width/height만 수정하면 안전하게 크기 변경 가능
      │   → 기본값 예시: 320×280 (네이티브)
      │
      └─ DIV.MuiPaper-root.MuiPaper-elevation6.sc-btlehR (position: static, flex)
         ├─ DIV[role="button"] (헤더 래퍼, 48px — 드래그 핸들)
         │   └─ HEADER.MuiAppBar-root.MuiAppBar-colorTransparent (elevation0, sticky)
         │       └─ DIV.MuiToolbar-root.MuiToolbar-dense.css-6tsndk
         │           ├─ H6.MuiTypography-subtitle2 → "스크린 패널 목록" / "마커 패널 목록"
         │           └─ DIV.sc-kOojCW → 버튼 컨테이너 (+ 추가, × 닫기)
         │
         └─ DIV.MuiDialogContent-root.scrollable-list (overflow: auto, 스크롤 영역)
             └─ (리스트 컨테이너)
                └─ DIV.MuiListItem-root × N
```

#### react-rnd 크기 변경 가이드

```js
// ✅ 올바른 방법: innerResize만 수정
const innerResize = paper.parentElement; // position:absolute인 중간 div
while (innerResize !== outerDrag && getComputedStyle(innerResize).position !== 'absolute')
  innerResize = innerResize.parentElement;
innerResize.style.width = '700px';
innerResize.style.height = '900px';

// ❌ 잘못된 방법: outerDrag 수정 → 드래그 시 위치 튐
outerDrag.style.width = '700px';  // react-rnd 내부 상태와 불일치
outerDrag.style.transform = '...'; // 첫 드래그 시 원래 위치로 점프
```

#### 리스트 아이템 구조

```
DIV.MuiButtonBase-root.MuiListItem-root.MuiListItem-dense
    (display: flex, height: ~60px, padding: 4px 48px 4px 16px, cursor: pointer)
├─ DIV.MuiListItemAvatar-root (56×40px)
│   └─ DIV.MuiAvatar-root.MuiAvatar-circular
│       └─ IMG [src=아이템 imageUrl]
├─ DIV.MuiListItemText-root.MuiListItemText-dense
│   ├─ SPAN.MuiTypography-body2 → primary: 아이템 이름 (memo 첫줄)
│   └─ P.MuiTypography-body2 → secondary: "[z] w × h"
├─ (눈 아이콘 — absolute position, right: 0, padding-right 48px 영역)
└─ SPAN.MuiTouchRipple-root (전체 영역 리플 효과)
```

#### 패널 타입

| 패널 목록 | H6 텍스트 | `type` 필드 |
|-----------|-----------|-------------|
| 스크린 패널 목록 | `스크린 패널 목록` / `スクリーンパネル一覧` | `"object"` |
| 마커 패널 목록 | `마커 패널 목록` / `マーカーパネル一覧` | `"plane"` |

#### 셀렉터 가이드

| 대상 | 셀렉터 |
|------|--------|
| 패널 목록 루트 | `.MuiPaper-root.MuiPaper-elevation6` + H6 텍스트 매칭 |
| 리스트 아이템 | `.MuiListItem-root` (paper 내부) |
| 스크롤 영역 | `.MuiDialogContent-root.scrollable-list` |
| 아바타 이미지 | `.MuiAvatar-root img` (아이템 내부) |
| 헤더 한글 제목 | `h6.MuiTypography-subtitle2` |

#### DOM ↔ Redux 매핑

패널 목록의 DOM 아이템을 Redux `entities.roomItems`와 매핑하는 방법:

1. **이미지 URL 매칭** (우선): `MuiAvatar-root img.src`의 경로를 Redux `imageUrl`와 비교
2. **속성 폴백**: secondary text `[z] w × h` 파싱 → Redux `z/width/height`와 비교

```js
function extractImagePath(el) {
  const img = el.querySelector('.MuiAvatar-root img');
  try { return new URL(img.src).pathname; } catch { return ''; }
}
```

### 11.15 시나리오 텍스트 패널 목록

> 상단 툴바의 "시나리오 텍스트 목록" 버튼으로 열리는 텍스트 목록입니다.
> panel-manager.js가 이 패널도 관리하며, **스크린/마커 패널과 DOM 구조가 다릅니다**.
>
> **기준**: 2026-03-03 (콘솔 진단)

#### 컨테이너 구조

```
DIV.MuiPaper-root.MuiPaper-elevation6.sc-btlehR
├─ DIV[role="button"] (드래그 핸들 — 패널 이동용)
│   └─ HEADER.MuiAppBar-root.MuiAppBar-colorTransparent
│       └─ DIV.MuiToolbar-root.MuiToolbar-dense
│           ├─ H6.MuiTypography-subtitle2 → "시나리오 텍스트 목록"
│           └─ DIV.sc-kOojCW → 버튼 컨테이너 (선택, +추가, ×닫기)
│
└─ DIV.MuiDialogContent-root.scrollable-list (padding: 0, overflow: auto)
    └─ DIV
        └─ DIV.sc-hWZjGb (styled-component, 아이템 컨테이너)
            ├─ DIV
            │   └─ DIV[role="button"][aria-roledescription="sortable"] (dnd-kit)
            │       └─ DIV.MuiListItemButton-root.MuiListItemButton-dense ← 클릭 아이템
            ├─ DIV
            │   └─ DIV[role="button"][aria-roledescription="sortable"]
            │       └─ DIV.MuiListItemButton-root.MuiListItemButton-dense
            └─ ...
```

#### ⚠ 스크린/마커 패널과의 차이점

| 항목 | 스크린/마커 (11.14) | 시나리오 텍스트 |
|------|---------------------|-----------------|
| 아이템 클래스 | `.MuiListItem-root` | `.MuiListItemButton-root` |
| dnd-kit 래퍼 | 없음 | `[aria-roledescription="sortable"]` |
| 아바타 | `.MuiAvatar-root img` | 없음 |
| MuiList-root | 없음 | 없음 |
| 아이템 태그 | `<div>` | `<div>` |

#### 리스트 아이템 구조

```
DIV.MuiButtonBase-root.MuiListItemButton-root.MuiListItemButton-dense
    .MuiListItemButton-gutters.css-vcgx1b
    [tabindex="0", role="button"]
├─ DIV.MuiListItemText-root.MuiListItemText-dense.MuiListItemText-multiline
│   ├─ SPAN.MuiTypography-body2.MuiListItemText-primary → 텍스트 이름
│   └─ P.MuiTypography-body2.MuiListItemText-secondary → 텍스트 내용 (잘림)
└─ SPAN.MuiTouchRipple-root
```

#### 셀렉터 가이드 (통합)

panel-manager.js에서 두 종류 패널을 모두 지원하려면:

| 대상 | 셀렉터 |
|------|--------|
| 아이템 (우선) | `.MuiListItemButton-root` → fallback `.MuiListItem-root` |
| 스크롤 컨테이너 | `.MuiList-root` → fallback `.MuiDialogContent-root` |
| 캡처 차단 | `e.target.closest('.MuiListItemButton-root') \|\| e.target.closest('.MuiListItem-root')` |

---

## 12. 특성 시스템 (Traits)

> 가지세계 TRPG 합 전투에서 캐릭터에 부여되는 특수 능력/효과입니다.
> 합 개시 트리거의 마지막 캡처그룹으로 파싱되며, `melee-engine.js`에서 처리됩니다.
>
> **기준**: 2026-02-28 (`melee-engine.js`, `content.js`, `overlay.js` 코드 분석)

### 12.1 특성 코드 목록

| 코드 | 한글 명칭 | 카테고리 | 설명 |
|------|----------|---------|------|
| `H0` | 인간 특성 | 인간 | 주사위 0 시 1개 부활 (1회). 크리티컬로 초기화 가능 |
| `H00` | 인간 특성 (잠재) | 인간 | 기본 비활성. 크리티컬 시 초기화되어 H0과 동일하게 작동 |
| `H4` | 피로 새겨진 역사 | 역사 | 크리티컬 시 대성공 범위 누적 확대. 비크리 시 초기화 |
| `H40` | 역사+인간 | 복합 | H4 + H0 상호작용. H4 초기화 시 인간 특성으로 스택 유지 |
| `H400` | 역사+인간 (잠재) | 복합 | H4 + H00 상호작용. H00처럼 처음엔 비활성 |
| `N0` | 연격 | 연격 | 상대 주사위 -2, 승리 시 +1 누적 보너스, 패배 시 초기화 |
| `H1`~`H3` | (공석) | — | 예약됨. 현재 미구현 |

### 12.2 트리거 파싱

합 개시 메시지에서 특성 태그는 주사위/대성공/대실패 뒤의 선택적 캡처그룹으로 전달됩니다.

```
《합 개시》| ⚔️ 캐릭터A - 5/20/1/H0H4 | 🛡️ 캐릭터B - 4/20/1/N0
                                ^^^^                    ^^
                              특성 태그             특성 태그
```

#### 파싱 로직 (`melee-engine.js: _parseTraits`)

```js
// 태그 문자열 → 특성 배열
_parseTraits(tagStr) {
  if (!tagStr) return [];
  const matches = tagStr.toUpperCase().match(/[A-Z]\d+/g);
  return matches || [];
}

// 예시:
// "H0H4"   → ['H0', 'H4']
// "H00H4"  → ['H00', 'H4']    ← 00은 하나의 토큰
// "N0"     → ['N0']
// "H40"    → ['H40']          ← H4 + H0 복합
// "H400"   → ['H400']         ← H4 + H00 복합
// ""       → []
```

### 12.3 특성별 상세 메커니즘

#### H0 / H00 — 인간 특성

| 구분 | H0 | H00 (잠재) |
|------|----|-----------|
| 초기 상태 | h0Used = **false** (발동 가능) | h0Used = **true** (발동 불가) |
| 발동 조건 | 주사위 0개 & h0Used == false | 동일 |
| 효과 | 주사위 0 → 1 부활, h0Used = true | 동일 |
| 초기화 | 크리티컬 달성 시 h0Used → false | 동일 (크리 시 활성화) |
| 수동 모드 | 발동 전 사용자 확인 프롬프트 | 동일 |

```
전투 상태:
  fighter.h0Used: boolean     // true = 이미 사용함 (재발동 불가)

자동 모드 흐름:
  주사위 0 & !h0Used → dice=1, h0Used=true → traitEvent('resurrect')
  크리티컬 & h0Used  → h0Used=false        → traitEvent('reset')

수동 모드 흐름:
  주사위 0 & !h0Used → traitEvent('h0_available') → 사용자 확인 → applyManualH0()
```

#### H4 — 피로 새겨진 역사

| 항목 | 값 |
|------|----|
| 크리티컬 시 | 대성공 범위 +2 누적 (critThreshold -= 2) |
| 최대 누적 | +5 (임계값 최대 -5) |
| 비크리티컬 시 | 보너스 전부 초기화 (h4Bonus → 0) |

```
전투 상태:
  fighter.h4Bonus: number          // 현재 누적 보너스 (0~5)
  fighter.baseCritThreshold: number // 기본 대성공 임계값 (보통 20)
  fighter.critThreshold: number    // 실효 임계값 = base - h4Bonus

흐름:
  크리티컬 → h4Bonus = min(h4Bonus + 2, 5)
           → critThreshold = baseCritThreshold - h4Bonus
           → traitEvent('stack', { bonus, threshold })

  비크리   → h4Bonus = 0, critThreshold = baseCrit
           → traitEvent('reset')
```

예시 (baseCritThreshold = 20):
| 합 | 결과 | h4Bonus | critThreshold | 비고 |
|----|------|---------|---------------|------|
| 1합 | 크리 | 2 | 18 | 18+ 대성공 |
| 2합 | 크리 | 4 | 16 | 16+ 대성공 |
| 3합 | 크리 | 5 | 15 | 최대치 도달 |
| 4합 | 일반 | 0 | 20 | 초기화 |

#### H40 / H400 — 역사 + 인간 복합

H4와 H0 (또는 H00)의 상호작용 특성입니다.

**핵심 메커니즘**: H4 스택이 비크리로 초기화될 때, 인간 특성(H0)이 남아있으면 발동하여 **H4 스택을 유지**한 채 추가 합 1회를 진행합니다.

```
비크리 & h4Bonus > 0 & !h0Used
  → H0 발동 (h0Used = true)
  → H4 스택 유지 (초기화하지 않음!)
  → traitEvent('h0_extra_round', { bonus, threshold })
  → 추가 합 진행
    → 추가 합에서 크리 → H4 계속 누적
    → 추가 합에서 비크리 → H4 최종 초기화

수동 모드:
  → traitEvent('h40_h0_available') → 사용자 확인
  → 확인: applyManualH40H0() → 위와 동일
  → 거부: declineH40H0() → H4 스택 즉시 초기화
```

#### N0 — 연격

| 항목 | 값 |
|------|----|
| 전투 개시 시 | 상대(응수/방어자) 주사위 **-2** (하한 3) |
| 승리 시 | 다음 합 판정 보너스 **+1** 누적 |
| 패배 시 | 누적 보너스 **0**으로 초기화 |
| 보너스 적용 | 자동: 코코포리아 `1D20+N`으로 전달 / 수동: 엔진에서 합산 |
| 크리/펌블 판정 | 원본 주사위 값(보너스 차감)으로 판정 |

```
전투 상태:
  fighter.n0Bonus: number    // 현재 연격 누적 보너스 (0+)

전투 개시:
  defender.traits.includes('N0') → defender.dice = max(3, dice - 2)

합 종료:
  winner === who → n0Bonus += 1 → traitEvent('stack', { bonus })
  winner !== who → n0Bonus = 0   → traitEvent('reset')

판정값 처리:
  자동 모드: 결과에 보너스 포함됨 → 원본 = result - n0Bonus (크리/펌블용)
  수동 모드: 입력값 = 원본 → 판정값 = input + n0Bonus
```

### 12.4 특성 이벤트 (traitEvents)

`processRoundResult()` 반환값의 `traitEvents` 배열에 특성 관련 이벤트가 기록됩니다.
`content.js`에서 이를 순회하며 오버레이 로그와 채팅 메시지를 생성합니다.

| trait | event | 의미 | 추가 데이터 |
|-------|-------|------|------------|
| H0/H00/H40/H400 | `resurrect` | 인간 특성 발동 (부활) | — |
| H0/H00/H40/H400 | `reset` | 크리티컬로 인간 특성 초기화 | — |
| H0/H00/H40/H400 | `h0_available` | 수동 모드: 발동 가능 (확인 대기) | — |
| H40/H400 | `h0_extra_round` | H0+H4 연계: 스택 유지 추가 합 | bonus, threshold |
| H40/H400 | `h40_h0_available` | 수동 모드: H0+H4 연계 발동 가능 | bonus, threshold |
| H4 | `stack` | H4 보너스 누적 | bonus, threshold |
| H4 | `reset` | H4 보너스 초기화 | oldBonus |
| N0 | `stack` | 연격 보너스 누적 | bonus |
| N0 | `reset` | 연격 보너스 초기화 | oldBonus |

### 12.5 UI 표시 (overlay.css)

특성 배지는 합 전투 패널의 전투원 이름 아래에 표시됩니다.

| CSS 클래스 | 배경 | 텍스트 | 테두리 | 대상 |
|-----------|------|--------|--------|------|
| `.bwbr-trait-badge` (기본) | `#2a2a2a` | `#aaa` | `1px solid #444` | 폴백 |
| `.bwbr-trait-n0` | `#1a2a1a` | `#81c784` | `1px solid #2e5c2e` | 연격 |
| `.bwbr-trait-h0` | `#4a2020` | `#ff8a80` | `1px solid #6a3030` | 인간 특성 |
| `.bwbr-trait-h00` | `#3a2020` | `#ff8a80` | `1px dashed #6a3030` | 인간 특성 (잠재) |
| `.bwbr-trait-h4` | `#2a2a40` | `#82b1ff` | `1px solid #3a3a5a` | 피로 새겨진 역사 |
| `.bwbr-trait-h40` | `#3a2040` | `#cc88ff` | `1px solid #5a3060` | 역사+인간 |
| `.bwbr-trait-h400` | `#3a2040` | `#cc88ff` | `1px dashed #5a3060` | 역사+인간 (잠재) |

> 잠재(`H00`, `H400`)는 **dashed** 테두리 + **opacity: 0.75**로 시각 구분됩니다.

### 12.6 채팅 메시지 포맷

특성 발동 시 채팅에 전송되는 메시지 형식:

```
🔥 인간 특성 발동! | ⚔️ 캐릭터명 부활! 주사위 +1 @발도1
✨ 인간 특성 초기화 | 🛡️ 캐릭터명 재사용 가능 @발도2
📜 피로 새겨진 역사 | ⚔️ 캐릭터명 대성공 범위 +2 (18+) @위험1
📜 피로 새겨진 역사 초기화 | 🛡️ 캐릭터명
🔥📜 인간 특성 발동! | ⚔️ 캐릭터명 역사(+4) 유지 → 추가 합! @발도3
⚡ 연격 | 🛡️ 캐릭터명 다음 판정 +2
⚡ 연격 초기화 | ⚔️ 캐릭터명
```

> 사운드(`@발도1` 등)는 `발도1`~`발도3`, `위험1`~`위험3` 중 무작위 선택됩니다.

---

## 13. 엔티티 전체 목록

> `store.getState().entities` 아래의 모든 키 목록입니다.
>
> **기준**: 2026-02-27

| 엔티티 키 | 설명 | Firestore 경로 |
|-----------|------|---------------|
| `rooms` | 방 설정 (9.1 참조) | `rooms/{roomId}` |
| `roomCharacters` | 캐릭터 (섹션 3 참조) | `rooms/{roomId}/characters/{charId}` |
| `roomEffects` | 이펙트 | `rooms/{roomId}/effects/{id}` |
| `roomDices` | 다이스 프리셋 | `rooms/{roomId}/dices/{id}` |
| `roomDecks` | 덱 | `rooms/{roomId}/decks/{id}` |
| `roomItems` | 스크린 패널/아이템 (3.1 참조) | `rooms/{roomId}/items/{id}` |
| `roomMembers` | 방 멤버 | `rooms/{roomId}/members/{uid}` |
| `roomMessages` | 채팅 메시지 (섹션 2 참조) | `rooms/{roomId}/messages/{msgId}` |
| `roomNotes` | 시나리오 텍스트 (3.2 참조) | `rooms/{roomId}/notes/{id}` |
| `roomSavedatas` | 세이브 데이터 | `rooms/{roomId}/savedatas/{id}` |
| `roomScenes` | 장면 (9.2 참조) | `rooms/{roomId}/scenes/{sceneId}` |
| `roomHistories` | 방 히스토리 | — |
| `userFiles` | 유저 파일 | `users/{uid}/files/{id}` |
| `userMedia` | 유저 미디어 | `users/{uid}/media/{id}` |
| `userMediumDirectories` | 미디어 폴더 | `users/{uid}/mediumDirectories/{id}` |
| `userHistories` | 유저 히스토리 | — |
| `userSetting` | 유저 설정 | `users/{uid}/setting` |
| `turboRooms` | Turbo 방 | — |

> 모든 엔티티는 normalized 형태: `{ ids: string[], entities: { [id]: object } }`

---

## 14. UI 디자인 시스템 (테마 규칙)

> 코코포리아의 MUI v5 다크 테마 디자인 토큰을 실측 수집하여 정리한 문서입니다.
> 확장 프로그램이 커스텀 UI를 만들 때 네이티브와 동일한 룩을 적용하기 위한 참조입니다.
>
> **기준**: 2026-03-02 (콘솔 진단)

### 14.1 색상 팔레트

| 역할 | 값 | 용도 |
|------|-----|------|
| **body background** | `rgb(32, 32, 32)` | 페이지 배경 |
| **paper / drawer** | `rgba(44, 44, 44, 0.87)` | Dialog, Drawer 반투명 배경 |
| **appBar (dialog)** | `rgb(33, 33, 33)` | Dialog 내부 AppBar 불투명 배경 |
| **text primary** | `rgb(255, 255, 255)` | 기본 텍스트 |
| **text heading** | `rgb(224, 224, 224)` | ListItemText-primary, 굵은 제목 |
| **text secondary** | `rgba(255, 255, 255, 0.7)` | InputLabel, 보조 텍스트 |
| **text disabled** | `rgba(255, 255, 255, 0.5)` | 비활성화 텍스트 |
| **primary** | `rgb(33, 150, 243)` | 버튼, 슬라이더, 링크, 토글 ON |
| **primary light** | `rgb(144, 202, 249)` | 호버 강조 |
| **secondary / indicator** | `rgb(245, 0, 87)` | 탭 인디케이터 |
| **error** | `rgb(220, 0, 78)` | 삭제 버튼 (dialogActionBtn1) |
| **divider** | `rgba(255, 255, 255, 0.08)` | Divider, 구분선 |
| **border (input)** | `rgba(255, 255, 255, 0.23)` | OutlinedInput 테두리 |
| **backdrop** | `rgba(0, 0, 0, 0.5)` | Dialog / Drawer 백드롭 |
| **switch unchecked track** | `rgb(255, 255, 255)` | opacity로 조절 |
| **switch unchecked thumb** | `rgb(224, 224, 224)` | 회색 냉 |
| **tooltip bg** | `rgb(22, 22, 22)` | MUI Tooltip |

### 14.2 타이포그래피

| 요소 | font-family | font-size | font-weight | letter-spacing | line-height |
|------|------------|-----------|------------|---------------|------------|
| **body / base** | `"Noto Sans KR"` | 16px | 400 | normal | normal |
| **dialog title (룸변수)** | Roboto, Helvetica, Arial, sans-serif | 20px | 700 | 0.19px | 30px |
| **dialog title (캠릭터편집)** | Roboto, Helvetica, Arial, sans-serif | 16px | 400 | 0.15px | 24px |
| **subtitle2** | Roboto, Helvetica, Arial, sans-serif | 14px | 700 | 0.1px | 22px |
| **button / tab** | Roboto, Helvetica, Arial, sans-serif | 14px | 700 | 0.4px | 24.5px |
| **caption** | Roboto, Helvetica, Arial, sans-serif | 12px | 400 | 0.4px | 20px |
| **ListItemText-primary** | Roboto, Helvetica, Arial, sans-serif | 14px | 700 | 0.1px | 22px |
| **ListItemText-secondary** | Roboto, Helvetica, Arial, sans-serif | 14px | 400 | 0.15px | 20px |
| **input label** | Roboto, Helvetica, Arial, sans-serif | 16px | 400 | 0.15px | 23px |
| **chat textarea** | Roboto, Helvetica, Arial, sans-serif | 16px | 400 | 0.15px | 23px |
| **tooltip** | Roboto, Helvetica, Arial, sans-serif | 12px | 500 | — | — |

> **규칙**: 본문/컨테이너 기본 폰트는 `"Noto Sans KR"`, 보조 UI 요소(버튼/탭/레이블/리스트/인풋/툴팁)는 `Roboto, Helvetica, Arial, sans-serif`.

### 14.3 컴포넌트 스타일 토큰

#### Dialog / Paper

| 속성 | 값 |
|------|-----|
| background | `rgba(44, 44, 44, 0.87)` |
| color | `rgb(255, 255, 255)` |
| border-radius | `4px` |
| width / maxWidth | `600px` |
| maxHeight | `calc(100% - 64px)` |
| margin | `32px` |
| overflow | `auto` |
| box-shadow | `0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12)` (elevation-24) |
| transition | `box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1)` |

#### Dialog AppBar (타이틀 바)

| 속성 | 값 |
|------|-----|
| background | `rgb(33, 33, 33)` |
| height / minHeight | `64px` |
| box-shadow | `0 2px 4px -1px rgba(0,0,0,.2), 0 4px 5px rgba(0,0,0,.14), 0 1px 10px rgba(0,0,0,.12)` (elevation-4) |
| position | `sticky`, top: `0` |
| toolbar padding | `0 24px` |

#### Backdrop

| 속성 | 값 |
|------|-----|
| background | `rgba(0, 0, 0, 0.5)` |
| transition | `opacity 0.225s cubic-bezier(0.4, 0, 0.2, 1)` |

#### Button (Text 스타일 — MuiButton-text)

| 속성 | 값 |
|------|-----|
| font | 14px / 700 / Roboto |
| letter-spacing | `0.4px` |
| line-height | `24.5px` |
| padding | `6px 8px` |
| border-radius | `4px` |
| text-transform | `uppercase` |
| color (primary) | `rgb(33, 150, 243)` |
| color (error) | `rgb(220, 0, 78)` |
| background | `transparent` |
| transition | `background-color 0.25s, box-shadow 0.25s, border-color 0.25s, color 0.25s` (all `cubic-bezier(0.4, 0, 0.2, 1)`) |
| min-width | `64px` |

#### IconButton

| 변형 | 크기 | padding | 기타 |
|------|------|---------|------|
| **sizeMedium** (기본) | 40×40px | 8px | 툴바 아이콘 버튼 |
| **sizeLarge** (edgeEnd) | 48×48px | 12px | 닫기(×) 버튼, margin: `0 -12px 0 0` |
| **sizeSmall** | 28×28px | 5px | content 내부 미니 버튼 |
| border-radius | `50%` | — | 원형 |
| color | `rgb(255, 255, 255)` | — | — |
| transition | `background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1)` | — | — |

#### Tab

| 속성 | 값 |
|------|-----|
| font | 14px / 700 / Roboto |
| letter-spacing | `0.4px` |
| text-transform | `uppercase` |
| height / minHeight | `48px` |
| padding | `12px 16px` |
| maxWidth | `360px` |
| color | `rgb(255, 255, 255)` |
| indicator bg | `rgb(245, 0, 87)` (secondary) |
| indicator height | `2px` |
| indicator transition | `0.3s cubic-bezier(0.4, 0, 0.2, 1)` |

#### Switch

| 속성 | Unchecked | Checked |
|------|-----------|----------|
| root size | 58×38px | 동일 |
| root padding | 12px | 동일 |
| track size | 34×14px | 동일 |
| track radius | 7px | 동일 |
| track bg | `rgb(255,255,255)` (opacity로 조절) | primary |
| track transition | `opacity/bg 0.15s cubic-bezier(0.4,0,0.2,1)` | 동일 |
| thumb size | 20×20px | 동일 |
| thumb bg | `rgb(224, 224, 224)` | `rgb(33, 150, 243)` |
| thumb shadow | `0 2px 1px -1px rgba(0,0,0,.2), 0 1px 1px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.12)` | 동일 |

#### MuiOutlinedInput / TextField

| 속성 | 값 |
|------|-----|
| border | `1px solid rgba(255,255,255,0.23)` |
| border-radius | `4px` |
| border :hover | `rgba(255,255,255,0.87)` |
| border :focus | `2px solid rgb(33,150,243)` (padding 보정 필요) |
| padding | `8.5px 14px` (→ focus 시 `7.5px 13px`) |
| font | inherit (14px 권장) |
| placeholder | `rgba(255,255,255,0.5)` |
| disabled border | divider 색상 |
| label color | `rgba(255,255,255,0.7)` |
| label :focused | primary |
| label transition | `color/transform/max-width 0.2s cubic-bezier(0,0,0.2,1)` |

#### ListItem / Drawer Item

| 속성 | 값 |
|------|-----|
| padding | `8px 16px` |
| align-items | `flex-start` |
| primary text | 14px / 700 / `rgb(224,224,224)` / Roboto |
| secondary text | 14px / 400 / `rgb(255,255,255)` / Roboto |
| divider color | `rgba(255,255,255,0.08)` |
| divider margin | `0 16px` |

#### Tooltip

| 속성 | 값 |
|------|-----|
| background | `rgb(22, 22, 22)` |
| color | `#fff` |
| font | 12px / 500 / Roboto |
| padding | `4px 8px` |
| border-radius | `4px` |
| max-width | `300px` |
| box-shadow | `0 1px 3px rgba(0,0,0,.2), 0 1px 1px rgba(0,0,0,.14), 0 2px 1px -1px rgba(0,0,0,.12)` |
| transition | `opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)` |
| enterDelay | ~100ms |
| margin (below) | `14px 2px 2px` |
| z-index | `1500` |

#### Slider

| 속성 | 값 |
|------|-----|
| color | primary `rgb(33,150,243)` |
| track height | `2px` |
| track radius | `12px` |
| thumb size | 12×12px |
| thumb radius | `50%` |
| thumb bg | primary |
| thumb transition | `box-shadow/left/bottom 0.15s cubic-bezier(0.4,0,0.2,1)` |

#### Snackbar / Toast

| 속성 | 값 |
|------|-----|
| background | `#323232` |
| color | `#fff` |
| padding | `6px 16px` |
| border-radius | `4px` |
| min-width | `288px` |
| box-shadow | `0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px rgba(0,0,0,.14), 0 1px 18px rgba(0,0,0,.12)` |
| z-index | `1400` |

### 14.4 공통 트랜지션 규칙

| 용도 | 타이밍 | easing |
|------|--------|-------|
| **fade (backdrop/dialog)** | `0.225s` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **button hover** | `0.25s` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **icon button hover** | `0.15s` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **switch track/thumb** | `0.15s` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **tooltip fade** | `0.2s` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **tab indicator** | `0.3s` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **input label** | `0.2s` | `cubic-bezier(0, 0, 0.2, 1)` |
| **box-shadow (paper)** | `0.3s` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| **appBar bg** | `0.2s` | `ease-out` |

> **공통 easing**: MUI 기본은 `cubic-bezier(0.4, 0, 0.2, 1)` (standard). Input label만 `cubic-bezier(0, 0, 0.2, 1)` (deceleration).

### 14.5 Elevation (그림자)

| 레벨 | box-shadow | 용도 |
|------|-----------|------|
| **elevation-1** | `0 1px 3px rgba(0,0,0,.2), 0 1px 1px rgba(0,0,0,.14), 0 2px 1px -1px rgba(0,0,0,.12)` | Tooltip, Switch thumb |
| **elevation-4** | `0 2px 4px -1px rgba(0,0,0,.2), 0 4px 5px rgba(0,0,0,.14), 0 1px 10px rgba(0,0,0,.12)` | Dialog AppBar |
| **elevation-8** | `0 5px 5px -3px rgba(0,0,0,.2), 0 8px 10px 1px rgba(0,0,0,.14), 0 3px 14px 2px rgba(0,0,0,.12)` | 드롭다운 메뉴 |
| **elevation-24** | `0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12)` | Dialog Paper |

### 14.6 z-index 스타킹

| 레벨 | 용도 |
|------|------|
| `1300` | MuiDialog / MuiModal (Dialog container) |
| `1400` | Snackbar / Toast |
| `1500` | Tooltip |
| `9999` | 커스텀 드롭다운 (trigger-ui 등) |

### 14.7 확장 UI 적용 규칙 요약

확장 프로그램에서 커스텀 UI를 만들 때 네이티브와 일치시키기 위한 체크리스트:

1. **폰트**: 컨테이너/본문은 `"Noto Sans KR"`, 버튼/레이블/리스트/인풋/툴팁은 `Roboto, Helvetica, Arial, sans-serif`
2. **버튼 텍스트**: `text-transform: uppercase`, `font-weight: 700`, `letter-spacing: 0.4px`
3. **닫기(×) 버튼**: 48×48px, padding 12px, 오른쪽 배치 시 `margin: 0 -12px 0 0`
4. **Paper 배경**: 반투명 `rgba(44,44,44,0.87)`, 600px 폭, elevation-24
5. **타이틀바**: AppBar로 구현, `rgb(33,33,33)` 불투명, 64px 높이, elevation-4
6. **디바이더**: `rgba(255,255,255,0.08)`, margin `0 16px`
7. **인풋 테두리**: `rgba(255,255,255,0.23)` → hover `rgba(255,255,255,0.87)` → focus `2px solid primary`
8. **트랜지션**: 모든 fade/hover는 `cubic-bezier(0.4, 0, 0.2, 1)`, 0.15~0.25s
9. **리스트 아이템**: padding `8px 16px`, align `flex-start`, primary text `rgb(224,224,224)` bold
10. **툴팁**: enterDelay ~100ms, `rgb(22,22,22)` 배경, fade `0.2s`

---

## 15. 토큰 바인딩 시스템 (스크린 패널 ↔ 캐릭터)

> **기준**: 2026-03-02

### 15.1 개요

스크린 패널(roomItems)과 캐릭터(roomCharacters)를 1:1 바인딩하여,
전투 이동 시 memo의 `〔이름〕` 파싱 없이도 캐릭터를 식별합니다.

- **저장소**: `chrome.storage.local` (ISOLATED world에서만 직접 접근)
- **MAIN world 동기화**: 인메모리 캐시 (`_tokenBindings`) + `bwbr-sync-token-bindings` 이벤트
- **데이터 모델**: `tokenBindings_{roomId}: { panelId: charId, ... }`
- **UI 진입점**: 스크린 패널 설정 다이얼로그 → 고급 설정 아코디언 → 캐릭터 바인딩 드롭다운

### 15.2 스크린 패널 설정 다이얼로그 구조 (2026-03-02 확인)

```
MuiDialog-root
└─ MuiDialog-paper
   └─ form (action="/rooms/{roomId}")
      ├─ MuiDialogTitle → "스크린 패널 설정"
      ├─ MuiDialogContent
      │  ├─ input[name="width"]    (text, 칸 단위)
      │  ├─ input[name="height"]   (text, 칸 단위)
      │  ├─ input[name="z"]        (text, z-index)
      │  ├─ input[name="memo"]     (text, 메모)
      │  ├─ input[name="locked"]   (checkbox, 잠금)
      │  ├─ input[name="freezed"]  (checkbox, 고정)
      │  ├─ input[name="plane"]    (checkbox, 배경)
      │  └─ MuiAccordion "고급 설정"
      │     ├─ MuiAccordionSummary → "클릭 액션을 설정할 수 있습니다."
      │     └─ MuiAccordionDetails
      │        ├─ [INJECTED] bwbr-binding-field (캐릭터 바인딩 드롭다운)
      │        └─ MuiFormControl → MuiSelect[name="clickAction"]
      └─ MuiDialogActions
         ├─ Button(color=error) → "삭제"
         └─ Button(color=primary) → "저장"
```

> **패널 _id 획득**: 다이얼로그에서 item._id가 직접 노출되지 않음.
> 폼 속성(width, height, z, memo, clickAction, locked, freezed, plane)을
> roomItems와 스코어링 매칭하여 식별 (12점 만점, 8점 이상 확정).

### 15.3 이벤트 페어

| 이벤트 | 방향 | DOM attr | 목적 |
|--------|------|----------|------|
| `bwbr-identify-panel` | ISOLATED→MAIN | `data-bwbr-panel-props` / `data-bwbr-panel-result` | 패널 속성으로 roomItem _id 식별 |
| `bwbr-panel-identified` | MAIN→ISOLATED | `data-bwbr-panel-result` | 식별 결과 { success, panelId, imageUrl } |
| `bwbr-sync-token-bindings` | ISOLATED→MAIN | `data-bwbr-token-bindings` | 바인딩 맵 전체 동기화 { roomId, bindings } |

### 15.4 캐릭터 조회 우선순위 (전투 이동)

`bwbr-request-char-for-move` 처리 순서:
1. imageUrl로 roomItem 찾기
2. **★ 바인딩 맵** 확인 (`_tokenBindings[item._id]` → charId → roomCharacters에서 조회)
3. memo `〔이름〕` 파싱 (폴백)
4. roomCharacters 이름 매칭

### 15.5 관련 파일

| 파일 | 역할 |
|------|------|
| `content/token-binding.js` | 다이얼로그 감지, 바인딩 UI 주입, chrome.storage.local 관리 |
| `content/redux-injector.js` | 패널 식별, 바인딩 캐시, 전투 이동 바인딩 조회 |
| `content/combat-move.js` | 토큰 클릭 → requestCharForMove (기존 코드, 변경 없음) |
