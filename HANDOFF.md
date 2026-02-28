# 세션 핸드오프: 범용 트리거 시스템 구현 상태

> **목적**: "범용 트리거 명령어" 기능의 구현 상태와 아키텍처를 기록한 문서.

---

## 1. 구현 완료 (1차)

### trigger-engine.js (신규)
- **패턴 컴파일러**: `《이름》| {param1} | {param2}` → 정규식 자동 변환
- **매칭 엔진**: source(input/message/both) 필터, flowState 조건, priority+길이 기반 우선순위, 500ms 디바운스
- **동작 체인**: message / cutin / stat / dice 타입 순차 실행 (configurable delay)
- **스토리지**: chrome.storage.local `bwbr_triggers` 키, 기본 트리거 + 사용자 트리거 병합
- **내보내기/가져오기**: JSON import/export
- **기본 제공 트리거**: 회복, 피해, 스탯 설정, 공지 (4개, builtin 플래그)
- **stat 동작**: `bwbr-modify-status` CustomEvent 사용 (redux-injector.js L1196 기존 핸들러 활용)

### trigger-ui.js (신규)
- **패널 버튼**: `#bwbr-toggle-actions`에 ⚡ 버튼 삽입 (MutationObserver 대기)
- **모달 다이얼로그**: 오버레이 + 카드 리스트 뷰 + 편집 폼 전환
- **카드 리스트**: 토글(on/off), 편집, 삭제, source 뱃지 표시
- **편집 폼**: 이름, 패턴, 감지대상, 딜레이, 우선순위, 동작 체인 (타입별 동적 필드)
- **가져오기/내보내기**: JSON 파일 다운로드/업로드

### content.js 통합
- `triggerEngine` 변수 추가 (L48)
- `init()`: TriggerEngine 생성 → init(chat, getFlowState, awaitUserMessage) → load() → TriggerUI init (L126~)
- `onInputSubmit()`: triggerEngine.check(text, 'input') → 매칭 시 execute + return (기존 전투 트리거 건너뜀) (L266~)
- `onNewMessage()`: triggerEngine.check(text, 'message') → 매칭 시 execute (L302~)

### manifest.json
- `content/trigger-engine.js`, `content/trigger-ui.js` 추가 (content.js 앞에 로드)

---

## 2. 데이터 모델

```js
{
  id: 'usr_...' | '_builtin_...',
  name: '회복',
  builtin: true|false,
  enabled: true,
  pattern: '《회복》| {target} | {stat} | {amount}',
  source: 'input' | 'message' | 'both',
  conditions: { states: [] },  // 빈 배열 = 모든 상태
  actions: [
    { type: 'message', template: '...' },
    { type: 'cutin', tag: '...' },
    { type: 'stat', target: '...', stat: '...', op: '+|-|=', value: '...' },
    { type: 'dice', command: '...' }
  ],
  delay: 300,  // 동작 간 ms
  priority: 0  // 높을수록 우선
}
```

---

## 3. 향후 과제

- [ ] flowState 동작 타입 추가 (상태 머신 전환)
- [ ] 기존 전투/합 트리거 → 범용 트리거로 마이그레이션
- [ ] 코코포리아 상단 툴바에 직접 아이콘 삽입 (DOM 구조 확인 필요)
- [ ] 드래그 앤 드롭으로 동작 순서 변경
- [ ] 조건 편집 UI (flowState 선택)
- [ ] popup.html에 트리거 설정 섹션 추가
