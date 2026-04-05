# 도형 도구 (Shape Tool) 구현 계획

## 목표
배치 모드에 **도형 도구(S)**를 추가하여 드래그로 사각형/원/삼각형/다각형/별/도넛/화살표/말풍선을 배치한다. 
기존 그리기 도구처럼 떨림/투명도/굵기변화/윤곽선을 지원하고, 윤곽선은 겹친 도형끼리 **외곽선만** 보이는 합체(union) 방식으로 렌더링한다.

## 사전 진단 결과

### 관련 파일
- `modules/placement/placement.js` — 6853줄, 전체 배치 모드 (이미지/텍스트/그리기)
- `modules/placement/manifest.json` — 모듈 메타데이터

### 기존 구조
- **도구 목록**: `image`, `text`, `draw` (3개)
- **도구 버튼 순서** (column-reverse): 아래→위 = 선택(V), 구분선, 이미지(I), 텍스트(T), 그리기(D)
- **설정 패널**: `createSettingsPanel()`에서 도구별 메뉴 생성 — `_imageSourceMenu`, `_textSettingsMenu`, `_drawSettingsMenu`
- **setSubTool()**: 도구 전환, 설정 메뉴 표시/숨김
- **오버레이 이벤트**: `onOverlayMouseDown/Move/Up`에서 `_state.currentTool`로 분기
- **스테이징**: `stageObject()` → `_state.stagedObjects[]` → `compositeAndCommit()`
- **그리기 설정**: `_drawSettings` 객체 (penColor, penSize, penOpacity, brushShape, sketchJitter, widthVariation, outlineEnabled, outlineSize, outlineColor, outlineOpacity)
- **단축키**: V(선택), I(이미지), T(텍스트), D(그리기), R(회전), Del(삭제), Ctrl+Z/C/V

### 도형 도구 위치
- 툴바 순서: 선택(V) → 이미지(I) → 텍스트(T) → **도형(S)** → 그리기(D)
- 키보드: **S키** (Shape)

## 마일스톤

### M1: 도형 도구 인프라 + 기본 도형 (사각형/원/삼각형)
- [ ] `_shapeSettings` 상태 객체 추가 (shapeType, fillColor, fillOpacity, strokeColor, strokeSize, strokeOpacity, cornerRadius, sketchJitter, widthVariation)
- [ ] `TOOL_ICONS.shape` SVG 아이콘 추가
- [ ] `createToolbar()` tools 배열에 `{ id: 'shape', label: '도형 (S)', icon: ... }` 추가
- [ ] `createShapeSettingsMenu()` — 도형 선택 그리드 + 채우기/윤곽선 설정 패널
- [ ] `setSubTool('shape')` 분기 추가
- [ ] 오버레이 마우스 핸들러: shape 모드 → 드래그로 도형 프리뷰 (실시간 프리뷰 캔버스)
- [ ] 마우스업 → 도형을 Canvas에 렌더 → WebP dataUrl → `stageObject()`
- [ ] 기본 도형 렌더링: 사각형(둥근 모서리), 원/타원, 삼각형
- [ ] S키 단축키 매핑
- **테스트**: S키 → 사각형 선택 → 드래그 → 스테이징에 추가 → 확인(커밋)

### M2: 추가 도형 (다각형/별/도넛/화살표/말풍선)
- [ ] 다각형 렌더러 (3~12꼭짓점, 설정 슬라이더)
- [ ] 별 렌더러 (꼭짓점 수, 내부 반지름 비율 설정)
- [ ] 도넛 렌더러 (외경/내경 비율 설정)
- [ ] 화살표 렌더러 (방향 설정: ↑↓←→)
- [ ] 말풍선 렌더러 (꼬리 위치: 좌/우/상/하)
- **테스트**: 각 도형 타입 선택 → 드래그 → 올바른 형태로 렌더링 확인

### M3: 떨림/굵기변화 + 윤곽선 union 합체
- [ ] 도형 외곽선에 떨림(jitter) 효과 적용 — 경로 점에 노이즈 추가
- [ ] 굵기 변화(widthVariation) 적용 — 외곽선 두께 변조
- [ ] 윤곽선 union 렌더링: 여러 도형을 하나의 덩어리로 합쳐서 외곽선은 겹치지 않고 바깥만 표시
  - 방법: `compositeAndCommit` 시 도형끼리 fill을 먼저 합성 → globalCompositeOperation='destination-out'로 내부 겹침 제거 → 별도 캔버스에 stroke만 렌더
- [ ] Shift+드래그: 정비례(정사각형/정원) 강제
- **테스트**: 겹친 도형 2개 배치 → 확인 → 윤곽선이 외곽만 보이는지 확인

### M4: UX 개선
- [ ] 드래그 중 실시간 프리뷰 (반투명 도형 미리보기)
- [ ] 도형 설정 기억 (마지막 사용 도형/색상 유지)
- [ ] PLACEMENT_PLAN.md 업데이트 (Phase 1~3 완료 표시, Phase 4 도형 추가)
- **테스트**: 전체 플로우 테스트 — 도형 선택/배치/설정변경/언두/커밋

## 영향 범위
- `placement.js`: 도구 추가, 오버레이 이벤트 분기, 렌더링 파이프라인
- 기존 이미지/텍스트/그리기 도구에는 영향 없음 (독립 분기)
- 키보드 단축키 S 추가 (충돌 없음)

## 테스트 체크리스트
- [ ] S키로 도형 도구 활성화/비활성화
- [ ] 각 도형 타입(8종) 선택 후 드래그 배치
- [ ] 채우기 색상/투명도 변경
- [ ] 윤곽선 색상/두께/투명도 변경
- [ ] 둥근 모서리(사각형) 슬라이더
- [ ] 다각형 꼭짓점 수 조절
- [ ] 별 꼭짓점/내부 비율 조절
- [ ] 도넛 내경 비율 조절
- [ ] 화살표 방향 변경
- [ ] 말풍선 꼬리 위치 변경
- [ ] Shift+드래그로 정비례
- [ ] 떨림/굵기변화 효과
- [ ] 겹친 도형 윤곽선 union
- [ ] 언두(Ctrl+Z) 동작
- [ ] 커밋 후 스크린/마커 생성 확인
