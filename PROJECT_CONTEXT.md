# 가지세계 도우미 (Branch World Battle Roll) - 프로젝트 컨텍스트

> AI 세션 복원용 내부 문서. 새 세션에서 이 파일을 열고 프로젝트 컨텍스트를 파악하세요.
> 사용자용 문서는 README.md를 참조하세요.
>
> **최종 갱신**: 2026-02-23 (v1.0.0)

---

## 프로젝트 개요

- **이름**: 가지세계 도우미 (Branch World Battle Roll, BWBR)
- **버전**: manifest.json 기준 (커밋 메시지 `bwad-X.Y.Z` 형식으로 자동 갱신)
- **유형**: Chrome Extension (Manifest V3)
- **목적**: 코코포리아(ccfolia.com) GM 보조 확장 프로그램 — 근접전 합 처리 자동화 + 채팅 보조
- **대상 사이트**: `https://ccfolia.com/*`

---

## 핵심 기능

### 근접전 합 시스템
1. **합 개시 트리거 감지**: `《합 개시》| ⚔️ 공격자 - 주사위/대성공/대실패 | 🛡️ 방어자 - 주사위/대성공/대실패` 패턴
2. **자동 주사위 굴림**: 공격자/방어자의 1D20 주사위 자동 전송
3. **결과 판정**: 대성공/대실패/무승부/승리 자동 판정, 주사위 파괴/복구
4. **특성 시스템**: H0(인간), H4(피로 새겨진 역사), H40/H400(복합), N0(연격 — 방어자 주사위 -2, 판정 보너스)
5. **전투 보조**: 턴 관리, 주/보조 행동 소모/추가, 이니셔티브 기반 자동 턴 진행
6. **임베디드 UI**: 코코포리아 채팅 패널 헤더 아래에 전투/턴 패널 삽입

### 채팅 자동완성 (auto-complete.js)
7. **괄호 자동 닫기**: `"` `"` `'` `(` `「` `『` `【` `《` — Tab/Shift+Tab으로 순환 전환
8. **`#` 캐릭터 자동완성**: 방의 캐릭터 목록 드롭다운, 합 개시 맥락에서 전투 스탯 자동 채움
9. **`!` 스테이터스 자동완성**: 캐릭터 이름 뒤 또는 단독으로 스테이터스 드롭다운
10. **`@` 컷인(이펙트) 자동완성**: 방의 이펙트 목록 드롭다운 (맨 앞 @ 제외 — 코코포리아 자체 자동완성 충돌 방지)
11. **`:캐릭이름 스테이터스+-=값`**: 스테이터스 직접 변경 명령어
12. **`/ㅇ 메시지`**: 시스템 메시지 전송

### 기타
13. **컷인 재생**: 메시지 내 `@태그`에 해당하는 이펙트 자동 재생 (Firestore playTime 갱신)
14. **Firestore 직접 전송**: 시스템 메시지는 textarea 경유 없이 Firestore에 직접 기록
15. **사이트 음량 제어**: 코코포리아 자체 재생 음량 독립 조절
16. **팝업 설정**: 메시지 템플릿, 타이밍, 규칙, 효과음, DOM 선택자 등

---

## 아키텍처

### 세계(world) 분리

Chrome Extension MV3에서는 content script의 JS 컨텍스트가 페이지와 분리됩니다:

- **ISOLATED world** (content scripts): `content.js`, `chat-interface.js`, `auto-complete.js`, `overlay.js`, `combat-engine.js`, `melee-engine.js`, `config-defaults.js`
- **MAIN world** (페이지 컨텍스트): `redux-injector.js` — Redux store, Firestore SDK 접근

### ISOLATED ↔ MAIN 통신

CustomEvent + DOM attribute 방식:
- `data-bwbr-send-text`, `data-bwbr-send-type` → DOM attribute에 값 설정
- `bwbr-send-message-direct` → Event dispatch
- `bwbr-send-message-result` → 결과 수신
- `bwbr-request-characters` / `bwbr-characters-data` — 캐릭터 데이터
- `bwbr-request-speaking-character` / `bwbr-speaking-character-data` — 발화 캐릭터
- `bwbr-request-cutins` / `bwbr-cutins-data` — 컷인(이펙트) 목록
- `bwbr-modify-status` / `bwbr-modify-status-result` — 스테이터스 변경

### 코코포리아 내부 접근 (redux-injector.js)

- Redux store: `state.entities.roomCharacters` (캐릭터), `state.entities.roomMessages` (메시지), `state.entities.roomEffects` (이펙트)
- Firestore SDK: webpack 모듈에서 추출 (`setDoc`, `doc`, `collection`, `getDoc`)
- 캐릭터 데이터: `{ name, params[], status[], iconUrl, speaking, ... }`
  - `params`: `[{ label: string, value: string }]` — 전투 스탯 (`기본 주사위`, `대성공 기준`, `대실패 기준`)
  - `status`: `[{ label: string, value: number, max: number }]` — HP, MP 등

---

## 파일 구조 및 역할

```
manifest.json              — Chrome Extension 매니페스트 v3 (56줄)
background.js              — Service Worker: 설치/업데이트, popup↔content 라우팅 (160줄)
README.md                  — 사용자용 문서 (223줄)
COCOFOLIA_DATA_API.md      — 코코포리아 내부 데이터 API 레퍼런스 (741줄)
PROJECT_CONTEXT.md         — AI 세션 복원용 (이 파일)

content/
  config-defaults.js       — window.BWBR_DEFAULTS 기본 설정값 (163줄)
  redux-injector.js        — MAIN world: Redux store, Firestore SDK, 메시지 전송, 컷인, 스테이터스 (1096줄)
  chat-interface.js        — 채팅 관찰 (Redux subscribe) + 메시지 전송 (Firestore 직접 + textarea 폴백) (813줄)
  auto-complete.js         — 채팅 자동완성: #캐릭터, !스테이터스, @컷인, 괄호, :명령어, /ㅇ (1064줄)
  melee-engine.js          — BattleRollEngine: 합 트리거 파싱, 전투 상태, 특성 처리 (771줄)
  combat-engine.js         — CombatEngine: 턴 관리, 행동 소모/추가, 이니셔티브 (528줄)
  overlay.js               — BattleRollOverlay: 임베디드 전투/턴 패널 UI (1425줄)
  overlay.css              — 전투 패널 스타일 + 애니메이션 (1474줄)
  content.js               — 메인 컨트롤러: 상태 머신, 오케스트레이션, 합 진행 (2112줄)
  site-volume.js           — 사이트 음량 제어 로더 (17줄)
  site-volume-page.js      — Web Audio API 패치 (MAIN world) (63줄)

popup/
  popup.html               — 설정 팝업 UI (353줄)
  popup.js                 — 설정 로드/저장/내보내기/가져오기 (657줄)
  popup.css                — 팝업 스타일 (734줄)

sounds/                    — 효과음 파일 (.wav, .mp3)
```

---

## 전투 흐름 (상태 머신)

```
IDLE → COMBAT_STARTED → ROUND_HEADER_SENT → WAITING_ATTACKER_RESULT
     → WAITING_DEFENDER_RESULT → PROCESSING_RESULT → (다음 합 반복 또는 COMBAT_END)
```

- **PAUSED** 상태로 일시정지 가능
- **TURN_COMBAT**: 전투 보조 모드 (턴 관리 + 합 진행 가능)
- **SPECTATING**: 다른 사용자의 합 관전 모드
- 결과 타임아웃 시 수동 입력 UI 표시

---

## 주요 기술 사항

- **메시지 감지**: Redux store.subscribe (DOM 대신 Redux 기반 — 100% 감지율)
- **Firestore 직접 전송**: 시스템 메시지는 textarea 경유 없이 Firestore에 기록 (type: 'system')
- **컷인 재생**: Firestore effects 컬렉션의 playTime 필드 갱신으로 트리거
- **자동완성 드롭다운 충돌 방지**: chat-interface의 Enter 감지에서 드롭다운 활성 상태 확인
- **합 개시 자동완성**: #선택 시 before 텍스트에서 `《합 개시》` 패턴 감지 → 캐릭터 params에서 전투 스탯 자동 채움
- **테스트 캐릭터**: # 자동완성에 항상 '테스트' 포함 (주사위 3, 대성공 20, 대실패 1)
- **chrome.storage.sync**: 설정 저장 (popup ↔ content 공유)
- **Script 로드 순서**: site-volume (document_start) → config-defaults → melee-engine → combat-engine → chat-interface → overlay → auto-complete → content (document_idle)
- **MAIN world 스크립트**: redux-injector.js는 web_accessible_resources로 등록, content.js에서 `<script>` 태그로 주입

---

## 설정 구조 (BWBR_DEFAULTS)

- `templates`: 메시지 템플릿 (합 헤더, 굴림 명령, 결과, 승리 등)
- `timing`: 각 단계별 대기 시간 (ms)
- `sounds`: 효과음 배열 (합 시작, 합 헤더, 결과, 승리 — 다중 사운드 무작위 선택)
- `rules`: D20, 대성공/대실패 값, 보너스/감소, 동점 처리
- `patterns`: 정규식 (트리거, 주사위 결과, 중지)
- `selectors`: 코코포리아 DOM 선택자
- `general`: 활성화, 수동 모드, 전투 로그, 자동완성, 자동스크롤, 오버레이, 행동 자동소모, 디버그, 효과음/사이트 음량
- `traits`: 종족 특성 정의 (H0, H00, H1~H3, H4, H40, H400)

---

## 참고사항

- 버전: manifest.json의 `version` 필드가 유일한 출처
- git commit: `bwad-X.Y.Z` → post-commit hook이 manifest.json 자동 갱신
- popup.js에 DEFAULTS가 별도 정의 (content script 접근 불가)
- 코코포리아 시스템 메시지: `type: 'system'`은 color 필드 무시됨 (색상 커스터마이징 불가 확인됨)
