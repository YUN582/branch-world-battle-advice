# 가지세계 도우미 (Branch World Battle Roll) - 프로젝트 컨텍스트

> 이 파일은 폴더 이름 변경 후 새 Copilot Chat 세션에서 이전 작업 맥락을 복원하기 위해 생성되었습니다.
> 새 세션에서 이 파일을 열고 "이 파일을 읽고 프로젝트 컨텍스트를 파악해줘"라고 말하면 됩니다.

---

## 프로젝트 개요

- **이름**: 가지세계 도우미 (Branch World Battle Roll, BWBR)
- **버전**: 0.6 (manifest.json 기준)
- **유형**: Chrome Extension (Manifest V3)
- **목적**: 코코포리아(ccfolia.com) GM 보조 확장 프로그램 — 근접전 합 처리 자동화
- **대상 사이트**: `https://ccfolia.com/*`

---

## 핵심 기능

1. **합 개시 트리거 감지**: 채팅에서 `《합 개시》| ⚔️ 공격자 - 주사위/대성공/대실패 | 🛡️ 방어자 - 주사위/대성공/대실패` 패턴 감지
2. **자동 주사위 굴림**: 공격자/방어자의 1D20 주사위를 자동 전송
3. **결과 판정**: 주사위 결과 비교, 대성공/대실패/무승부/승리 자동 판정
4. **특성 시스템**: H0(인간 특성 - 주사위 0시 +1 부활), H4(피로 새겨진 역사 - 대성공 시 +2 누적), H40/H400(역사+인간 - H4 초기화 시 인간 특성 발동으로 추가 합)
5. **임베디드 UI**: 코코포리아 채팅 패널 헤더 아래에 전투 패널 삽입
6. **팝업 설정**: 메시지 템플릿, 타이밍, 규칙, 효과음, DOM 선택자 등 설정 가능

---

## 파일 구조 및 역할

```
manifest.json          — Chrome Extension 매니페스트 (v3)
background.js          — Service Worker: 설치/업데이트, popup↔content 메시지 라우팅

content/
  config-defaults.js   — window.BWBR_DEFAULTS 기본 설정값 (155줄)
  melee-engine.js      — BattleRollEngine 클래스: 트리거 파싱, 전투 상태 관리, 승패 판정 (569줄)
  chat-interface.js    — CocoforiaChatInterface 클래스: 코코포리아 DOM 탐색, 채팅 관찰, 메시지 전송 (626줄)
  overlay.js           — BattleRollOverlay 클래스: 임베디드 전투 패널 UI (607줄)
  content.js           — 메인 컨트롤러: 전투 상태 머신, 채팅 감시, 오케스트레이션 (790줄)
  overlay.css          — 전투 패널 스타일

popup/
  popup.html           — 설정 팝업 UI (403줄)
  popup.js             — 팝업 로직: 설정 로드/저장/내보내기/가져오기 (483줄)
  popup.css            — 팝업 스타일
```

---

## 전투 흐름 (상태 머신)

```
IDLE → COMBAT_STARTED → ROUND_HEADER_SENT → WAITING_ATTACKER_RESULT → WAITING_DEFENDER_RESULT → PROCESSING_RESULT → (다음 합 반복 또는 COMBAT_END)
```

- **PAUSED** 상태로 일시정지 가능
- 결과 태임아웃 시 수동 입력 UI 표시

---

## 주요 기술 사항

- **메시지 감지**: MutationObserver + 폴링 하이브리드
- **Set 기반 메시지 추적**: 이미 본 텍스트를 Set에 저장하여 중복 방지
- **React 통합**: 코코포리아의 React state를 `__reactProps$` 프로퍼티를 통해 갱신
- **chrome.storage.sync**: 설정 저장 (popup ↔ content 공유)
- **메시지 라우팅**: background.js가 popup ↔ content 간 메시지 중계

---

## 설정 구조 (BWBR_DEFAULTS)

- `templates`: 메시지 템플릿 (합 헤더, 굴림 명령, 결과 메시지 등)
- `timing`: 각 단계별 대기 시간 (ms)
- `sounds`: 효과음 이름 (@효과음명 형태)
- `rules`: 주사위 면 수, 대성공/대실패 값, 동점 처리
- `patterns`: 정규식 (트리거, 주사위 결과, 중지)
- `selectors`: 코코포리아 DOM 선택자
- `general`: 활성화, 자동스크롤, 오버레이, 디버그

---

## 이전 대화에서의 주요 작업 내역

이 프로젝트는 Copilot Chat과의 대화를 통해 진행되었으며, 주요 작업은 다음과 같습니다:

1. Chrome Extension 기본 구조 수립 (Manifest V3)
2. 코코포리아 채팅 DOM 탐색 및 인터페이스 구현
3. 근접전 합 처리 엔진 구현 (주사위 비교, 크리티컬/대실패 처리)
4. 임베디드 전투 패널 UI 구현
5. 팝업 설정 UI 구현 (탭 기반: 메시지/타이밍/규칙/효과음/고급)
6. 특성 시스템 구현 (H0, H4)
7. Set 기반 메시지 추적 시스템 (v6 chat-interface)
8. 메시지 전송 후 중복 감지 방지 로직
9. 일시정지/재개 기능
10. 설정 내보내기/가져오기 기능

---

## 참고사항

- 현재 버전은 `0.6` (manifest.json, popup.html 모두 동일)
- content script 로드 순서: config-defaults → melee-engine → chat-interface → overlay → content
- popup.js에 DEFAULTS가 별도로 정의되어 있음 (content script 접근 불가하므로)
