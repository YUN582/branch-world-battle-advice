# 배치 모드 — Phase 2 & 3 구현 계획

> Phase 1 (이미지 배치) 완료. 이 문서는 Phase 2 (텍스트)와 Phase 3 (그리기) 구현 계획.

---

## Phase 2: 텍스트 도구

### 핵심 흐름 (area-first)

```
1. T키 또는 텍스트 버튼으로 텍스트 도구 활성화
2. 오버레이에서 드래그 → 텍스트 영역 사각형 생성
3. 해당 위치에 contentEditable 박스 표시 → WYSIWYG 텍스트 편집
4. 플로팅 서식 바로 서식 적용 (볼드, 이탤릭 등)
5. 편집 완료 → Canvas 렌더 → WebP → stageObject() → 기존 커밋 파이프라인
```

### Step 2-1: 영역 지정

- 텍스트 도구 활성화 → 오버레이에서 드래그로 텍스트 박스 영역 생성
- 영역은 스테이징 영역(bwbr-staged-item)처럼 보이되, 편집 가능 상태 표시
- 스탬프 모드 불필요 (텍스트는 매번 새로 작성하므로)

### Step 2-2: contentEditable WYSIWYG 편집

- 드래그 완료 → 해당 위치에 `contentEditable` div 생성 (position: fixed)
- 자동 포커스, 즉시 타이핑 가능
- 텍스트 박스 크기에 맞춤 자동 줄바꿈 (CSS `word-break: break-all; overflow-wrap: break-word`)
- Enter → 줄바꿈

### Step 2-3: 플로팅 서식 바

텍스트 영역 상단 또는 하단에 서식 바 표시:

| 기능 | 구현 방식 |
|------|----------|
| **볼드** | `document.execCommand('bold')` → `<b>` 태그 |
| **이탤릭** | `document.execCommand('italic')` → `<i>` 태그 |
| **밑줄** | `document.execCommand('underline')` → `<u>` 태그 |
| **취소선** | `document.execCommand('strikethrough')` → `<s>` 태그 |
| **루비 문자** | 커스텀 처리: 선택 텍스트를 `<ruby>` 태그로 감쌈 + prompt로 루비 텍스트 입력 |
| **드롭캡** | 첫 글자에 커스텀 span 적용 (font-size 확대 + float left) |
| **폰트색** | `document.execCommand('foreColor', false, color)` |
| **배경색** | `document.execCommand('hiliteColor', false, color)` |
| **폰트 크기** | 커스텀: 선택 범위에 span + `font-size` 인라인 스타일 |
| **폰트 선택** | 커스텀: 선택 범위에 span + `font-family` 인라인 스타일 |

### Step 2-4: 폰트 지원

1. **Font Access API** (Chromium 103+):
   - `window.queryLocalFonts()` → 로컬 설치 폰트 목록
   - 사용자 권한 요청 필요 (한 번만)
   - ISOLATED world에서 사용 가능
2. **기본 폰트 Fallback**: 고딕/명조/고정폭/필기체 (CSS generic families)
3. **Google Fonts** (확장 가능): CDN `@import` 주입으로 웹폰트 로드

### Step 2-5: Canvas 직접 렌더

- contentEditable 편집 완료 (Esc 또는 영역 바깥 클릭)
- contentEditable DOM → 자체 파서로 분석 (execCommand HTML 의존 X)
- Canvas 2D API로 직접 렌더링:
  ```
  ctx.font = "bold 32px 'Noto Sans KR'"
  ctx.fillText(...)      // 일반 텍스트
  ctx.fillStyle = color  // 색상 변경
  // ... 서식별 처리
  ```
- 멀티라인: 줄바꿈 위치 계산 (텍스트 박스 너비 기준)
- 결과 → `canvas.toDataURL('image/webp', 0.85)` → `stageObject()` → 기존 파이프라인

### 파일 구조

```
modules/placement/
  placement.js         ← 기존 (Phase 1 이미지 + 공통 인프라)
  placement-text.js    ← NEW: 텍스트 도구 전체 로직
```

- `placement-text.js`를 `placement.js`에서 동적 import:
  ```javascript
  var textModule = null;
  function getTextModule() {
    if (!textModule) {
      textModule = import(chrome.runtime.getURL('modules/placement/placement-text.js'));
    }
    return textModule;
  }
  ```
- `setSubTool('text')` 시 텍스트 모듈 로드 → 텍스트 도구 UI 초기화

### 주요 고려사항

- **execCommand 브라우저 차이**: HTML 출력이 브라우저마다 다를 수 있음 → DOM 파싱 후 자체 렌더
- **Canvas 텍스트 측정**: `ctx.measureText()` 정확도 (font metrics)
- **IME 입력**: 한국어 조합 중 키 이벤트 처리 (`compositionstart`/`compositionend`)
- **포커스 관리**: 배치 모드 단축키 vs 텍스트 입력 → 텍스트 편집 중엔 키보드 이벤트 차단
- **리사이즈**: 텍스트 박스 모서리 드래그로 크기 조절 → 자동 줄바꿈 재계산

---

## Phase 3: 그리기 도구

### Step 3-1: 도형 서브메뉴

D키 또는 그리기 버튼 → 도형 선택 패널:

| 도형 | SVG 기반 | 매개변수 |
|------|----------|----------|
| 사각형 | `<rect>` | w, h, rx (둥근 모서리) |
| 삼각형 | `<polygon>` | 3점 |
| 원/타원 | `<ellipse>` | rx, ry |
| 다각형 | `<polygon>` | 꼭짓점 수 (3~12) |
| 별 | `<polygon>` | 꼭짓점 수, 내부 반지름 비율 |
| 도넛 | `<circle>` × 2 + clip | 외경, 내경 |

### Step 3-2: 도형 속성

**채우기 (Fill)**:
- 단색 (color picker)
- 그라데이션: 선형(Linear) / 방사형(Radial)
  - 2~3 컬러 스톱, 각도/중심점 설정
- 투명 (none)

**윤곽선 (Stroke)**:
- 색상: 단색 / 그라데이션
- 두께: 1~50px
- 스타일: 실선 / 점선 / 파선 / 쇄선
- 위치: 내부(inset) / 중앙(center) / 외부(outset)
  - Canvas: `ctx.lineWidth` 기본은 center → inset/outset은 clip으로 구현

**공통**: 투명도(opacity) 0~100%

### Step 3-3: 연필/펜 도구

- 프리핸드 드로잉: `mousedown` → 점 수집 → `mousemove` → 선 그리기
- SVG `<path>` 내부 관리
- 속성: 선 굵기, 색상, 투명도
- 스무딩: Catmull-Rom 또는 quadratic 보간

### Step 3-4: 아이콘 라이브러리

- **Material Icons** (Apache 2.0 라이선스):
  - 카테고리별 브라우징 + 검색
  - SVG 직접 삽입 → 색상/크기 변경 가능
- JSON 인덱스 파일로 아이콘 목록 관리 (lazy load)
- 선택 → 드래그 배치 → SVG → Canvas → WebP

### Step 3-5: 렌더링 파이프라인

```
도형/연필 → SVG 내부 관리 → Canvas 렌더 → WebP → compositeAndCommit()
```

- 모든 도형은 내부적으로 SVG로 관리 (편집 가능 상태 유지)
- 편집 완료 → SVG → Canvas (`drawImage()` with SVG Blob URL) → WebP

### 파일 구조

```
modules/placement/
  placement.js          ← 공통 인프라
  placement-text.js     ← Phase 2: 텍스트
  placement-draw.js     ← Phase 3: 그리기 전체
  icons/                ← Material Icons SVG (lazy load)
    index.json          ← 아이콘 메타데이터
    *.svg               ← 개별 아이콘
```

### 향후 고려 (Phase 3+)

- **패스파인더**: 도형 합집합/교집합/차집합 (복잡 — 별도 Phase)
- **레이어 관리**: 도형 간 z-order
- **그룹화**: 여러 도형을 하나의 오브젝트로

---

## 구현 순서

```
Phase 2-1  영역 지정 드래그 + contentEditable 박스 생성
Phase 2-2  기본 서식 바 (볼드/이탤릭/색상)
Phase 2-3  고급 서식 (루비/드롭캡/폰트 선택)
Phase 2-4  Canvas 직접 렌더 → WebP → 커밋
Phase 2-5  Font Access API + 폰트 목록
Phase 3-1  기본 도형 (사각형/원/삼각형)
Phase 3-2  도형 속성 (채우기/윤곽선)
Phase 3-3  연필 도구
Phase 3-4  고급 도형 (다각형/별/도넛/그라데이션)
Phase 3-5  Material Icons 통합
```

각 단계는 독립적으로 테스트 가능하며, 이전 단계 위에 증분 빌드.
