# 이미지 피커 드래그 탭 이동 + 정렬 구현 계획

> ccfolia 네이티브 이미지 선택 다이얼로그에 드래그 앤 드롭 기반 이미지 관리 기능을 추가한다.
> 이미지를 카테고리 탭으로 드래그하면 탭 이동, 같은 그리드 내 드래그하면 순서 변경.
> 복수 선택(Ctrl/Shift+클릭 → 네이티브 선택 모드 자동 진입) 후 드래그 시 일괄 이동/정렬.
>
> **작성일**: 2026-03-27

---

## Phase 0: 진단 (Discovery) — 블로커

**목적**: `userFiles` Firestore 스키마 확인 (dir 값 목록, order 필드 존재 여부)

### 확인 항목

1. `userFiles` 엔티티 전체 필드 목록
2. 각 카테고리 탭에 대응하는 `dir` 값 (특히 "스크린 뒷면"이 어떤 dir인지)
3. `order` 필드 존재 여부 → 정렬 전략 결정
4. 정렬 기준 추정 (createdAt? order? name?)

### 결과에 따른 분기

- `order` 필드 있음 → 직접 `order` 수정으로 정렬
- `order` 필드 없음 → `createdAt` 조작 또는 커스텀 `order` 필드 추가 후 DOM 재배치

### 상태: ⏳ 대기 (사용자 진단 실행 필요)

---

## Phase 1: Firestore 연산 (redux-injector.js 수정)

**의존**: Phase 0 완료

redux-injector.js (MAIN world)에 이벤트 핸들러 추가:

| 이벤트 | 페이로드 | 동작 |
|--------|---------|------|
| `bwbr-move-files-dir` | `{fileIds: string[], targetDir: string}` | writeBatch로 `dir` 일괄 변경 |
| `bwbr-reorder-files` | `{orderedIds: [{id, order}]}` | writeBatch로 순서 필드 일괄 변경 |
| `bwbr-get-user-files` | `{dir: string}` | 해당 dir의 파일 목록 반환 → `bwbr-user-files-data` |
| `bwbr-activate-select-mode` | `{active: boolean}` | Redux dispatch로 `selectingFiles` 토글 |

Firestore 경로: `users/{uid}/files/{fileId}`
쓰기: `setDoc(ref, {dir, updatedAt: Date.now()}, {merge: true})`

---

## Phase 2: 이미지 매니저 UI (image-manager.js 신규)

**의존**: Phase 1 완료

새 content script `content/image-manager.js` (ISOLATED world):

### 2-1. 피커 감지 & 초기화
- `MutationObserver`로 `.MuiDialog-paperWidthMd[role="dialog"]` 감지
- 피커 열릴 때 초기화, 닫힐 때 정리
- face-bulk-add.js 패턴 참고 (`getPickerDialog()`)

### 2-2. 이미지 드래그 가능 설정
- 피커 내 이미지 아이템에 `draggable="true"` 추가
- `dragstart`: 드래그 데이터에 fileId(들) 저장, 선택 모드면 선택된 전체 ID 저장
- `dragend`: 시각 효과 정리
- 드래그 고스트: 복수 선택 시 개수 배지 표시

### 2-3. 카테고리 탭 드롭 타겟
- `[role="tab"]` 탭에 `dragover`, `dragleave`, `drop` 이벤트 추가
- **dragover**: 탭 하이라이트 (`border-bottom: 2px solid #2196F3`)
- **drop**: `bwbr-move-files-dir` 이벤트로 파일 이동 → 이동 후 해당 탭 자동 클릭
- 현재 탭에 드롭 → 무시 (같은 카테고리)

### 2-4. 그리드 내 정렬 (동일 탭)
- 드래그 중 이미지 사이 드롭 위치 표시 (파란 세로선)
- **drop**: 새 순서 계산 → `bwbr-reorder-files` 이벤트로 업데이트
- 복수 선택 드래그 시 선택된 아이템 그룹 이동

### 2-5. Ctrl/Shift+클릭 복수 선택
- 이미지 클릭 시 `event.ctrlKey` 또는 `event.shiftKey` 감지
- **Ctrl+클릭**: 네이티브 선택 모드 자동 활성화 + 해당 이미지 선택 토글
- **Shift+클릭**: 선택 모드에서 범위 선택 (마지막 선택~현 위치)
- 네이티브 `selectingFiles`/`selectedFileIds` 상태 활용

### 2-6. 네이티브 삭제 모드 공존
- face-bulk-add.js의 `isNativeDeleteMode()` + `syncDeleteModeVisibility()` 패턴 참조
- 삭제 모드에서도 드래그 가능 유지
- 삭제 버튼 클릭은 네이티브 동작 유지

---

## Phase 3: 시각 피드백 & 로딩 상태

### 3-1. 드래그 시 시각 효과
- **드래그 중인 이미지**: opacity 0.5
- **탭 드롭 타겟**: `border-bottom: 2px solid #2196F3`
- **그리드 드롭 위치**: 이미지 사이에 파란 세로선 (`2px solid #2196F3`)
- **복수 드래그 고스트**: 선택 개수 배지 (작은 파란 원 + 숫자)

### 3-2. 작업 완료 피드백
- 탭 이동 완료 시: 대상 탭으로 자동 전환 (네이티브 탭 클릭)
- 순서 변경 시: DOM 즉시 재배치 (Firestore 동기화 대기 안 함)
- 에러 시: 콘솔 로그 + 원상복구

---

## Phase 4: manifest.json & 로딩 순서

- `content/image-manager.js`를 manifest.json의 content_scripts에 추가
- 로드 순서: face-bulk-add.js 뒤 (face-bulk-add와 UI가 공존해야 함)
- 충돌 방지: face-bulk-add.js의 오버레이와 겹치지 않도록 조건 분기

---

## 관련 파일

| 파일 | 변경 | 역할 |
|------|------|------|
| `content/image-manager.js` | **신규** | 드래그 앤 드롭 + 선택 로직 |
| `content/redux-injector.js` | **수정** | Firestore 이벤트 핸들러 4개 추가 |
| `manifest.json` | **수정** | content_scripts에 image-manager.js 추가 |
| `content/face-bulk-add.js` | **참조** | 피커 감지, 네이티브 모드 공존 패턴 |
| `content/drag-reorder.js` | **참조** | HTML5 D&D API 패턴, 시각 효과 |
| `COCOFOLIA_DATA_API.md` | **수정** | Phase 0 진단 결과 (userFiles 스키마) 기록 |

---

## 검증 체크리스트

1. **진단 스크립트 실행** → userFiles 키, dir 값, order 확인
2. **단일 이미지 탭 이동** — 스크린 탭의 이미지를 배경 탭으로 드래그 → 배경 탭에 나타나는지 확인
3. **복수 선택 탭 이동** — Ctrl+클릭 3개 선택 → 캐릭터 탭으로 드래그 → 3개 모두 이동 확인
4. **단일 순서 변경** — 이미지 A를 이미지 C 뒤로 드래그 → 순서 변경 확인 → 새로고침 후 유지
5. **복수 순서 변경** — 2개 선택 후 다른 위치로 드래그 → 그룹으로 이동 확인
6. **네이티브 삭제 기능** — 선택 삭제 버튼 → 체크 → 삭제 → 정상 작동 확인 (회귀)
7. **face-bulk-add 공존** — 캐릭터 편집 다이얼로그 열린 상태에서 피커 → "선택 추가" 정상 동작
8. **ROOM / ALL / Unsplash 탭** — 그룹 탭 전환 시 드래그 기능 유지

---

## 결정 사항

- **드래그 UX**: 버튼 없이 드래그 앤 드롭으로 탭 이동 + 순서 변경 통합
- **복수 선택**: Ctrl/Shift 클릭 시 네이티브 선택 삭제 모드 자동 진입
- **Phase 0 필수**: userFiles 스키마 미확인 → 진단 후 Phase 1-2 확정

## 추가 고려사항

1. **"스크린 뒷면" 탭의 dir 값** — Phase 0에서 확인 필요
2. **ALL 그룹 탭에서의 동작** — 기본: ROOM 탭에서만 동작, ALL/Unsplash에서는 비활성화
3. **정렬 필드 전략** — order가 없으면 createdAt 조작 vs 커스텀 order 필드 추가 → Phase 0 후 확정
