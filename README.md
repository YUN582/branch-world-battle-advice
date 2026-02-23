# 가지세계 도우미 (Branch World Battle Roll)

코코포리아(ccfolia.com) GM 보조 Chrome 확장 프로그램.  
근접전 합(라운드) 처리를 자동화하고, 채팅 입력을 보조합니다.

---

## 설치

1. 이 폴더를 원하는 위치에 배치
2. Chrome → `chrome://extensions` → **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → 이 폴더 선택
4. 코코포리아 방에 접속하면 자동 활성화

---

## 채팅 자동완성

### 괄호 자동 닫기

열기 괄호를 입력하면 닫기 괄호가 자동 삽입됩니다.

| 입력 | 자동 완성 |
|------|----------|
| `"` | `""` |
| `"` | `""` |
| `'` | `''` |
| `(` | `()` |
| `「` | `「」` |
| `『` | `『』` |
| `【` | `【】` |
| `《` | `《》` |

- **Tab** / **Shift+Tab**: 괄호 종류 순환 전환  
  `""` → `''` → `()` → `「」` → `『』` → `【】` → `《》` → ...
- **Backspace**: 빈 괄호쌍 한 번에 삭제

### `#` — 캐릭터 자동완성

`#`을 입력하면 방에 있는 캐릭터 목록이 드롭다운으로 표시됩니다.

- 타이핑하면 실시간 필터링
- **↑↓** 로 선택, **Enter** 로 확정, **Esc** 로 취소
- 선택하면 `#`이 캐릭터 이름으로 대체됨

#### 합 개시 자동완성

`《합 개시》| ⚔️ ` 뒤에서 `#`으로 캐릭터를 선택하면 전투 스탯이 자동 채워집니다.

```
《합 개시》| ⚔️ #스칼라        ← # 입력 후 선택
《합 개시》| ⚔️ 스칼라 - 5/20/1 | 🛡️ #    ← 자동완성! 바로 방어자 입력
《합 개시》| ⚔️ 스칼라 - 5/20/1 | 🛡️ 아델하이트 - 4/19/2    ← 방어자도 자동완성
```

- 캐릭터의 파라미터에서 `기본 주사위`, `대성공 기준`, `대실패 기준` 값을 읽어옴
- 해당 파라미터가 없으면 `?`로 표시 → 수동 입력 가능
- 자동완성된 값은 전송 전에 자유롭게 수정 가능
- **테스트** 캐릭터가 항상 포함됨 (주사위 3, 대성공 20, 대실패 1)

### `!` — 스테이터스 자동완성

캐릭터 이름 뒤에 `!`를 입력하면 해당 캐릭터의 스테이터스 목록이 표시됩니다.

```
스칼라!       ← 스칼라의 스테이터스 드롭다운
스칼라 !      ← 공백 있어도 인식
!             ← 현재 발화 중인 토큰의 스테이터스
```

- 선택하면 스테이터스 이름이 삽입됨

### `@` — 컷인(이펙트) 자동완성

텍스트 입력 중에 `@`를 입력하면 방에 등록된 이펙트 목록이 드롭다운으로 표시됩니다.

```
메시지 내용 @발도      ← @ 입력 후 이펙트 선택
메시지 내용 @발도1     ← 선택 완료
```

- 맨 앞에서 `@`를 입력하면 작동하지 않음 (코코포리아 자체 자동완성과 충돌 방지)
- 이펙트 이름이 `@`로 시작하는 경우에도 `@@` 중복 없이 올바르게 삽입

---

## 채팅 명령어

### `/ㅇ` — 시스템 메시지

```
/ㅇ 메시지 내용
```

채팅에 시스템(system) 타입 메시지로 전송합니다. 캐릭터 아이콘 없이 `system` 이름으로 표시됩니다.

### `:` — 스테이터스 변경

```
:캐릭이름 스테이터스+값
:캐릭이름 스테이터스-값
:캐릭이름 스테이터스=값
```

예시:
```
:스칼라 HP-10      ← 스칼라의 HP를 10 감소
:스칼라 MP+5       ← 스칼라의 MP를 5 증가
:스칼라 장갑=0     ← 스칼라의 장갑을 0으로 설정
```

---

## 캐릭터 단축키

### Alt + 숫자 바인딩

`Alt + 0~9` 키로 발화 캐릭터를 빠르게 전환할 수 있습니다.

#### 바인딩 방법

1. **보드 토큰 우클릭** → 「단축키 지정」 클릭
2. **채팅 캐릭터 리스트 우클릭** → 「단축키 지정」 클릭
3. 바인딩 다이얼로그에서 `Alt + 숫자` 입력

#### 캐릭터 리스트 우클릭 메뉴

채팅 패널의 캐릭터 선택 드롭다운에서 캐릭터를 우클릭하면:

- **편집**: 캐릭터 편집 다이얼로그 열기
- **확대 보기**: 캐릭터 이미지 전체 화면 표시 (네이티브) — 이미지가 뷰포트에 맞게 자동 축소됨
- **단축키 지정**: Alt+숫자 바인딩 지정
- **단축키 해제**: 기존 바인딩 제거 (바인딩된 캐릭터만 표시)
- **집어넣기/꺼내기**: 캐릭터 활성 상태에 따라 자동 토글 (Firestore 직접 조작)
- **복사**: 캐릭터 복제
- **삭제**: 캐릭터 삭제

> ⚠️ 우클릭 메뉴는 캐릭터 선택 드롭다운(MuiPopover) 내부에서만 활성화됩니다. 채팅 영역에서는 표시되지 않습니다.

#### 바인딩 키 표시

캐릭터 선택 드롭다운에서 바인딩된 캐릭터의 "활성화 상태"/"비활성화 상태" 텍스트 옆에 `Alt + N` 뱃지가 인라인으로 표시됩니다.

#### 바인딩 다이얼로그

- `Alt + 숫자` 입력으로 바인딩
- **해제** 버튼: 현재 캐릭터의 바인딩만 해제
- **해제** 우클릭: 모든 바인딩 전체 해제
- 하단에 도움말 표시

---

## 근접전 합 시스템

### 합 개시

채팅에 아래 형식으로 입력하면 전투가 시작됩니다:

```
《합 개시》| ⚔️ 공격자이름 - 주사위/대성공/대실패 | 🛡️ 방어자이름 - 주사위/대성공/대실패
```

예시:
```
《합 개시》| ⚔️ 스칼라 - 5/20/1 | 🛡️ 아델하이트 - 4/19/2
```

- `주사위`: 보유 주사위 개수. 0이 되면 패배
- `대성공`: 이 값 이상이면 대성공 (상대 주사위 파괴 + 자신 주사위 +1)
- `대실패`: 이 값 이하이면 대실패 (자신 주사위 파괴 + 주사위 -1)

#### 특성 태그 (선택)

마지막 슬래시 뒤에 특성 태그를 추가할 수 있습니다:

```
《합 개시》| ⚔️ 스칼라 - 5/20/1/H0H4 | 🛡️ 아델하이트 - 4/19/2/N0
```

| 태그 | 이름 | 효과 |
|------|------|------|
| `H0` | 인간 특성 | 주사위 0개 → +1 부활, 대성공 시 초기화 |
| `H4` | 피로 새겨진 역사 | 대성공 시 다음 판정 대성공 기준 +2 (최대 +5 누적) |
| `H40` | 역사 + 인간 | H4 초기화 시 인간 특성 발동 → 추가 합 1회 |
| `H400` | 역사 + 인간 (대성공) | 대성공으로 인간 특성 획득 후 H4 초기화 시 발동 |
| `N0` | 연격 | 응수(방어자) 주사위 2개 감소 (하한 3), 주사위 판정에 +보너스 |

### 합 진행

전투가 시작되면 자동으로 진행됩니다:

1. **합 헤더** 출력 + 효과음
2. **공격자 주사위** 자동 굴림 (1D20)
3. **방어자 주사위** 자동 굴림 (1D20)
4. **결과 판정** — 승리/패배/대성공/대실패/무승부
5. 한쪽의 주사위가 0이 될 때까지 반복

### 합 중지

```
《합 중지》
```

진행 중인 전투를 즉시 중단합니다.

### 전투 패널 UI

코코포리아 채팅 패널 상단에 전투 상태 패널이 표시됩니다:

- 현재 합 번호, 공격자/방어자 주사위 상태
- 일시정지/재개 버튼
- 전투 로그 (설정에서 활성화 시)

---

## 팝업 설정

확장 프로그램 아이콘 클릭 → 팝업에서 설정 변경 가능:

- **메시지**: 합 개시/결과/승리 메시지 템플릿
- **타이밍**: 각 단계별 대기 시간 조절
- **규칙**: 주사위 면 수, 대성공/대실패 값, 동점 처리
- **효과음**: 합 시작/합 헤더/결과/승리 효과음 선택
- **고급**: 디버그 모드, DOM 선택자, 정규식 패턴, 사이트 음량

설정은 Chrome 동기화 스토리지에 저장되어 기기 간 공유됩니다.  
내보내기/가져오기 기능도 지원합니다.

---

## 파일 구조

```
manifest.json             Chrome Extension 매니페스트 (MV3)
background.js             Service Worker (설치/업데이트, 메시지 라우팅)
README.md                 이 파일
COCOFOLIA_DATA_API.md     코코포리아 내부 데이터 API 레퍼런스

content/
  config-defaults.js      기본 설정값
  melee-engine.js         합 처리 엔진 (주사위 비교, 특성 처리)
  combat-engine.js        전투 보조 엔진 (턴/행동 관리)
  chat-interface.js       코코포리아 채팅 인터페이스 (메시지 감지/전송)
  auto-complete.js        채팅 자동완성 (#캐릭터, !스테이터스, @컷인, 괄호, 명령어)
  char-shortcut.js        캐릭터 단축키 (Alt+숫자 바인딩, 토큰/리스트 메뉴)
  overlay.js              전투 패널 UI
  overlay.css             전투 패널 스타일
  content.js              메인 컨트롤러 (상태 머신, 오케스트레이션)
  redux-injector.js       코코포리아 Redux/Firestore 접근 (MAIN world)

popup/
  popup.html              설정 팝업 UI
  popup.js                팝업 로직
  popup.css               팝업 스타일

sounds/                   효과음 파일 (.wav, .mp3)
```

---

## 라이선스

비공개 프로젝트. 코코포리아의 비공식 서드파티 도구입니다.

---

## 아키텍처 (개발자 참고)

### 세계(world) 분리

Chrome Extension MV3에서는 content script의 JS 컨텍스트가 페이지와 분리됩니다:

- **ISOLATED world** (content scripts): `content.js`, `chat-interface.js`, `auto-complete.js`, `overlay.js`, `combat-engine.js`, `melee-engine.js`, `config-defaults.js`, `char-shortcut.js`
- **MAIN world** (페이지 컨텍스트): `redux-injector.js` — Redux store, Firestore SDK 접근

### ISOLATED ↔ MAIN 통신

CustomEvent + DOM attribute 방식:

| 이벤트 | 방향 | 용도 |
|--------|------|------|
| `bwbr-send-message-direct` | ISOLATED → MAIN | 메시지 전송 |
| `bwbr-send-message-result` | MAIN → ISOLATED | 전송 결과 |
| `bwbr-request-characters` / `bwbr-characters-data` | 양방향 | 캐릭터 목록 |
| `bwbr-request-speaking-character` / `bwbr-speaking-character-data` | 양방향 | 발화 캐릭터 |
| `bwbr-request-cutins` / `bwbr-cutins-data` | 양방향 | 컷인(이펙트) 목록 |
| `bwbr-modify-status` / `bwbr-modify-status-result` | 양방향 | 스테이터스 변경 |
| `bwbr-request-all-characters` / `bwbr-all-characters-data` | 양방향 | 전체 캐릭터 (숨김 포함) |
| `bwbr-identify-character-by-image` / `bwbr-character-identified` | 양방향 | 이미지 URL로 캐릭터 식별 |
| `bwbr-switch-character` | ISOLATED → MAIN | 발화 캐릭터 변경 |
| `bwbr-native-zoom` | ISOLATED → MAIN | 네이티브 확대 보기 |
| `bwbr-character-edit` / `bwbr-character-store` / `bwbr-character-copy` / `bwbr-character-delete` | ISOLATED → MAIN | 캐릭터 조작 |

### 코코포리아 내부 접근 (redux-injector.js)

- **Redux store**: `state.entities.roomCharacters` (캐릭터), `state.entities.roomMessages` (메시지), `state.entities.roomEffects` (이펙트)
- **app.state**: 174개 이상의 UI 상태 키 (`openInspector`, `openRoomCharacterId` 등 — 확대 보기, 캐릭터 편집에 활용)
- **Firestore SDK**: webpack 모듈에서 추출 (`setDoc`, `doc`, `collection`, `getDocs`)
- **RTK action type**: 패시브 인터셉터로 thunk inner dispatch에서 자동 캡처

> 상세 내부 API: [COCOFOLIA_DATA_API.md](COCOFOLIA_DATA_API.md) 참조

### 전투 흐름 (상태 머신)

```
IDLE → COMBAT_STARTED → ROUND_HEADER_SENT → WAITING_ATTACKER_RESULT
     → WAITING_DEFENDER_RESULT → PROCESSING_RESULT → (다음 합 반복 또는 COMBAT_END)
```

- **PAUSED** 상태로 일시정지 가능
- **TURN_COMBAT**: 전투 보조 모드 (턴 관리 + 합 진행 가능)
- **SPECTATING**: 다른 사용자의 합 관전 모드
- 결과 타임아웃 시 수동 입력 UI 표시

### 주요 기술 사항

- **메시지 감지**: Redux store.subscribe (DOM 대신 Redux 기반 — 100% 감지율)
- **Firestore 직접 전송**: 시스템 메시지는 textarea 경유 없이 Firestore에 기록 (type: 'system')
- **컷인 재생**: Firestore effects 컬렉션의 playTime 필드 갱신으로 트리거
- **자동완성 드롭다운 충돌 방지**: chat-interface의 Enter 감지에서 드롭다운 활성 상태 확인
- **합 개시 자동완성**: #선택 시 before 텍스트에서 `《합 개시》` 패턴 감지 → 캐릭터 params에서 전투 스탯 자동 채움
- **테스트 캐릭터**: # 자동완성에 항상 '테스트' 포함 (주사위 3, 대성공 20, 대실패 1)
- **chrome.storage.sync**: 설정 저장 (popup ↔ content 공유)
- **Script 로드 순서**: site-volume (document_start) → config-defaults → melee-engine → combat-engine → chat-interface → overlay → auto-complete → content (document_idle)
- **MAIN world 스크립트**: redux-injector.js는 web_accessible_resources로 등록, content.js에서 `<script>` 태그로 주입
- **네이티브 확대 보기**: Redux `app.state.openInspector` + `inspectImageUrl` 설정으로 코코포리아 내장 뷰어 활용
- **캐릭터 편집**: Redux `app.state.openRoomCharacter` + `openRoomCharacterId` 설정

### 설정 구조 (BWBR_DEFAULTS)

- `templates`: 메시지 템플릿 (합 헤더, 굴림 명령, 결과, 승리 등)
- `timing`: 각 단계별 대기 시간 (ms)
- `sounds`: 효과음 배열 (합 시작, 합 헤더, 결과, 승리 — 다중 사운드 무작위 선택)
- `rules`: D20, 대성공/대실패 값, 보너스/감소, 동점 처리
- `patterns`: 정규식 (트리거, 주사위 결과, 중지)
- `selectors`: 코코포리아 DOM 선택자
- `general`: 활성화, 수동 모드, 전투 로그, 자동완성, 자동스크롤, 오버레이, 행동 자동소모, 디버그, 효과음/사이트 음량
- `traits`: 종족 특성 정의 (H0, H00, H1~H3, H4, H40, H400)

### 참고사항

- 버전: manifest.json의 `version` 필드가 유일한 출처
- git commit: `bwad-X.Y.Z` → post-commit hook이 manifest.json 자동 갱신
- popup.js에 DEFAULTS가 별도 정의 (content script 접근 불가)
- 코코포리아 시스템 메시지: `type: 'system'`은 color 필드 무시됨

---

## 변경 이력

### v1.1.6 (2026-02-24)

- **캐릭터 드롭다운 우클릭**: 캐릭터 선택 드롭다운(MuiPopover) 내부에서만 활성화 (채팅 영역에서 더 이상 표시 안 됨)
- **단축키 뱃지 위치**: "활성화 상태"/"비활성화 상태" 텍스트 옆에 인라인 배치 (기존: flex-end 하단 정렬)
- **집어넣기/꺼내기 토글**: DOM 텍스트에서 활성화 상태 직접 판별, Firestore 직접 active 토글로 변경 (네이티브 메뉴 클릭 방식 제거)
- **확대 보기 이미지 크기 제한**: 뷰포트 컨테이너 크기에 맞게 명시적 px 계산 적용 (MutationObserver)
- **확대 보기 우클릭**: Inspector(MuiModal-root) 내 이미지에서 브라우저 우클릭 허용 (이미지 저장/복사)
- **바인딩 다이얼로그 개선**: 전체 해제 버튼 제거, 해제 우클릭 = 전체 해제, 하단 도움말 추가
- **downshift ID 호환성**: `:rm:` 형식 지원 (React 18 `useId()` 대응)
