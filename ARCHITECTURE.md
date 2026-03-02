# BWAD 모듈화 아키텍처 설계서

> **버전**: Draft v0.1  
> **대상 버전**: v2.0 (현재 v1.2.6)  
> **설계 방식**: B — 코어 확장 + JSON 모듈 파일  
> **작성일**: 2025-01

---

## 목차

1. [개요](#1-개요)
2. [현재 구조 분석](#2-현재-구조-분석)
3. [모듈 시스템 설계](#3-모듈-시스템-설계)
4. [코어 API 표면](#4-코어-api-표면)
5. [모듈 파일 포맷](#5-모듈-파일-포맷)
6. [모듈 분류 계획](#6-모듈-분류-계획)
7. [설정(Config) 시스템 재설계](#7-설정config-시스템-재설계)
8. [content.js 분해 계획](#8-contentjs-분해-계획)
9. [크로스월드 브릿지 통합](#9-크로스월드-브릿지-통합)
10. [마이그레이션 로드맵](#10-마이그레이션-로드맵)
11. [제약사항 및 미해결 이슈](#11-제약사항-및-미해결-이슈)

---

## 1. 개요

### 목표

현재 BWAD(가지세계 도우미)는 **가지세계 TRPG** 전용 코코포리아 확장 프로그램이다. 이를 **범용 코코포리아 확장 코어** + **교체 가능한 모듈 파일**로 분리하여:

- 가지세계 외 다른 TRPG 시스템에서도 사용 가능하게 한다
- 사용자가 필요한 모듈만 선택적으로 설치할 수 있게 한다
- 모듈 개발자가 코어를 건드리지 않고 기능을 추가할 수 있게 한다

### 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **코어는 TRPG 시스템에 무관** | 코코포리아 사이트 향상 기능만 포함. 주사위 규칙, 전투 공식 등 제외 |
| **모듈은 자체 완결** | 하나의 JSON/JS 파일이 하나의 기능 단위. 코어 API만 사용 |
| **점진적 마이그레이션** | 한 번에 리팩토링하지 않고, 단계별로 분리 |
| **하위 호환** | v1.x 사용자가 v2.0 업데이트 시 기존 설정/트리거 유지 |

---

## 2. 현재 구조 분석

### 2.1 파일 규모

| 파일 | 라인 수 | 역할 | 문제점 |
|------|---------|------|--------|
| `content.js` | 3,629 | 오케스트레이터 | **갓 오브젝트** — 전투 SM, 턴제, 관전, 볼륨, 로그 등 모든 것 |
| `redux-injector.js` | 3,970 | MAIN 월드 브릿지 | 범용 인프라 + 패널 조작 + 전투용 핸들러 혼재 |
| `trigger-ui.js` | 1,662 | 트리거 UI | 독립적이나 코어 API 의존 |
| `trigger-engine.js` | 1,383 | 트리거 엔진 | 독립적이나 cross-world 패턴 자체 구현 |
| `config-defaults.js` | 171 | 설정 기본값 | **범용/가지세계 설정 혼합** |
| 기타 12개 파일 | ~2,000 | 각종 기능 | 자체 초기화 IIFE 6개, 라이프사이클 제어 없음 |
| **총계** | **~12,800** | | |

### 2.2 의존성 그래프

```
content.js (orchestrator)
 ├── config-defaults.js        ← BWBR_DEFAULTS
 ├── melee-engine.js           ← BattleRollEngine (가지세계 전용)
 ├── combat-engine.js          ← CombatEngine (가지세계 전용)
 ├── chat-interface.js         ← CocoforiaChatInterface (범용)
 ├── overlay.js                ← BattleRollOverlay (가지세계 전용)
 ├── auto-complete.js          ← BWBR_AutoComplete (범용, 자체 초기화)
 ├── char-shortcut.js          ← (범용, 자체 초기화)
 ├── log-export-dialog.js      ← LogExportDialog (범용)
 ├── grid-overlay.js           ← __bwbrGridOverlay (가지세계 전용, 자체 초기화)
 ├── combat-move.js            ← __bwbrCombatMove (가지세계 전용, 자체 초기화)
 ├── token-binding.js          ← (가지세계 전용, 자체 초기화)
 ├── room-copy.js              ← (범용, 자체 초기화)
 ├── trigger-engine.js         ← TriggerEngine (범용 자동화)
 └── trigger-ui.js             ← BWBR_TriggerUI (범용 자동화)

redux-injector.js (MAIN world, content.js가 <script>로 주입)
 └── 모든 ISOLATED world 파일이 bwbr-* 이벤트로 통신
```

### 2.3 핵심 문제점

1. **content.js 갓 오브젝트**: ~2,000줄의 전투 로직 + ~500줄의 턴제 + ~400줄의 관전 로직이 하나의 파일에 혼재
2. **설정 혼합**: `BWBR_DEFAULTS`에 범용 설정(autoComplete, siteVolume)과 가지세계 전용(templates, traits, rules)이 공존
3. **라이프사이클 없음**: 6개 모듈이 자체 IIFE로 초기화 → 중앙 제어 불가, 동적 로드/언로드 불가
4. **크로스월드 패턴 중복**: 각 모듈이 setAttribute → dispatch → addEventListener → parse 패턴을 독자 구현
5. **캐릭터 데이터 중복 요청**: auto-complete, char-shortcut, trigger-ui가 각각 `bwbr-request-all-characters` 호출

---

## 3. 모듈 시스템 설계

### 3.1 아키텍처 개요

```
┌─────────────────────────────────────────────────┐
│                Chrome Extension                  │
│  ┌───────────────────────────────────────────┐  │
│  │           CORE (코어 확장)                 │  │
│  │  config │ bridge │ chat │ characters │ UI  │  │
│  │  ─────────────────────────────────────────│  │
│  │           Module Loader (모듈 로더)        │  │
│  └────────┬──────────┬──────────┬────────────┘  │
│           │          │          │                │
│  ┌────────▼──┐ ┌─────▼────┐ ┌──▼───────────┐   │
│  │ 가지세계  │ │ 트리거   │ │ 사용자 모듈  │   │
│  │ 전투 모듈 │ │ 자동화   │ │ (커스텀)     │   │
│  └───────────┘ └──────────┘ └──────────────┘   │
└─────────────────────────────────────────────────┘
```

### 3.2 모듈 타입

| 타입 | 파일 형식 | 실행 환경 | 용도 |
|------|-----------|-----------|------|
| **data** | `.json` | 없음 (코어가 해석) | 설정, 트리거 프리셋, 템플릿 번들 |
| **script** | `.js` | ISOLATED world | 새 기능, UI 패널, 커스텀 로직 |
| **hybrid** | `.js` + `.json` | ISOLATED + MAIN | MAIN 월드 핸들러가 필요한 기능 |

> **v2.0 초기에는 `data` 타입만 지원**하고, `script` / `hybrid`는 v2.1 이후 지원.
> data 모듈만으로도 전투 규칙, 트리거 프리셋, 메시지 템플릿 교체가 가능하다.

### 3.3 모듈 저장 위치

```
modules/                          ← 확장 프로그램 내 기본 모듈
  branch-world-combat.json        ← 가지세계 합 전투 규칙
  branch-world-triggers.json      ← 가지세계 기본 트리거
  
user-modules/                     ← 사용자 설치 모듈 (chrome.storage에 저장)
  my-custom-triggers.json
  another-trpg-combat.json
```

Chrome Extension은 런타임에 파일시스템 접근이 제한적이므로, 사용자 모듈은 **chrome.storage.local**에 JSON 직렬화하여 저장한다. 기본 모듈은 `chrome.runtime.getURL()`로 접근.

### 3.4 모듈 라이프사이클

```
[등록] → [로드] → [활성화] → [비활성화] → [제거]
         ↑                      │
         └──────────────────────┘  (토글 가능)
```

| 단계 | 동작 |
|------|------|
| **등록** | 모듈 JSON/JS를 `chrome.storage.local`에 저장. 메타데이터 기록 |
| **로드** | JSON 파싱, 의존성 확인, 설정 병합 |
| **활성화** | 코어에 기능 등록 (트리거, 설정, 핸들러 등). UI 반영 |
| **비활성화** | 기능 해제. 설정은 유지하되 동작하지 않음 |
| **제거** | `chrome.storage`에서 삭제 |

---

## 4. 코어 API 표면

모듈이 사용할 수 있는 코어 API. 모든 API는 `window.BWBR_Core` 네임스페이스에 노출.

### 4.1 크로스월드 브릿지 (Tier 1)

```js
BWBR_Core.bridge.request(eventName, payload) → Promise<response>
BWBR_Core.bridge.send(eventName, payload) → void
BWBR_Core.bridge.on(eventName, handler) → unsubscribe()
```

현재 각 모듈이 자체 구현하는 `setAttribute → dispatch → addEventListener → parse` 패턴을 **단일 유틸리티로 통합**한다.

- `request()`: 요청 → 응답 패턴 (Promise 기반, 타임아웃 내장)
- `send()`: 단방향 전송 (결과 불필요)
- `on()`: 이벤트 구독 (구독 해제 함수 반환)

### 4.2 캐릭터 데이터 (Tier 2)

```js
BWBR_Core.characters.getActive() → Promise<Character[]>
BWBR_Core.characters.getAll() → Promise<Character[]>    // 숨김 포함
BWBR_Core.characters.getSpeaking() → Promise<Character>
BWBR_Core.characters.getStats(charId) → Promise<Status[]>
BWBR_Core.characters.modifyStat(charId, label, value, opts) → Promise
BWBR_Core.characters.switchSpeaker(charId) → void
```

캐시 레이어 포함: 동일 프레임 내 중복 요청 방지 (auto-complete, char-shortcut, trigger-ui 중복 호출 해결).

### 4.3 채팅 인터페이스 (Tier 2)

```js
BWBR_Core.chat.send(text) → Promise<{ok, msgId?}>
BWBR_Core.chat.sendSystem(text) → Promise        // Firestore 직접 시스템 메시지
BWBR_Core.chat.onMessage(handler) → unsubscribe() // Redux 기반 메시지 감지
BWBR_Core.chat.getTextarea() → HTMLTextAreaElement | null
```

### 4.4 패널/맵 조작 (Tier 2)

```js
BWBR_Core.panels.getAll() → Promise<Panel[]>
BWBR_Core.panels.getTagged(tag?) → Promise<Panel[]>
BWBR_Core.panels.create(opts) → Promise
BWBR_Core.panels.modify(panelId, changes) → Promise
BWBR_Core.panels.delete(panelId) → Promise
```

### 4.5 이펙트/컷인 (Tier 3)

```js
BWBR_Core.cutins.getAll() → Promise<Cutin[]>
BWBR_Core.cutins.play(cutinName) → Promise
```

### 4.6 설정 (Tier 1)

```js
BWBR_Core.config.get(namespace?) → object
BWBR_Core.config.set(namespace, values) → Promise
BWBR_Core.config.onChanged(namespace, handler) → unsubscribe()
BWBR_Core.config.registerDefaults(namespace, defaults) → void
```

모듈은 자신의 네임스페이스에만 읽기/쓰기 가능. 코어 설정은 읽기 전용.

### 4.7 모듈 매니저 (Tier 1)

```js
BWBR_Core.modules.register(moduleManifest) → void
BWBR_Core.modules.get(moduleId) → ModuleInfo
BWBR_Core.modules.list() → ModuleInfo[]
BWBR_Core.modules.enable(moduleId) → void
BWBR_Core.modules.disable(moduleId) → void
```

### 4.8 UI 확장 포인트

```js
// 팝업 설정 패널에 모듈별 섹션 추가
BWBR_Core.ui.registerSettingsSection(moduleId, renderFn) → void

// SpeedDial(빠른 메뉴)에 버튼 추가
BWBR_Core.ui.addSpeedDialAction(moduleId, {icon, label, onClick}) → void

// 채팅 컨텍스트 메뉴에 항목 추가
BWBR_Core.ui.addChatContextMenu(moduleId, {label, handler}) → void
```

---

## 5. 모듈 파일 포맷

### 5.1 Module Manifest (JSON)

모든 모듈은 아래 형식의 manifest를 포함한다.

```jsonc
{
  // ── 필수 메타데이터 ──
  "id": "branch-world-combat",          // 고유 ID (영문, 하이픈)
  "name": "가지세계 합 전투",             // 표시명
  "version": "1.0.0",                   // 시맨틱 버전
  "type": "data",                       // "data" | "script" | "hybrid"
  "description": "가지세계 TRPG용 합 전투 규칙 및 템플릿",
  
  // ── 선택 메타데이터 ──
  "author": "BWAD",
  "minCoreVersion": "2.0.0",            // 최소 코어 버전
  "tags": ["combat", "branch-world"],   // 검색/분류용
  "dependencies": [],                   // 의존하는 다른 모듈 ID
  
  // ── 기능 정의 (type에 따라 다름) ──

  // [data 타입] 설정 오버라이드
  "config": {
    "namespace": "combat",              // 설정 네임스페이스
    "defaults": {                       // BWBR_DEFAULTS에 병합될 기본값
      "templates": { /* ... */ },
      "rules": { /* ... */ },
      "timing": { /* ... */ },
      "sounds": { /* ... */ },
      "traits": { /* ... */ }
    }
  },

  // [data 타입] 트리거 프리셋
  "triggers": [
    {
      "id": "_builtin_combat_start",
      "name": "합 개시",
      "pattern": "《합 개시》| ...",
      "actions": [ /* action chain */ ]
    }
  ],

  // [script 타입] 스크립트 진입점 (v2.1+)
  "entryPoint": "branch-world-combat.js",
  "permissions": ["chat.send", "characters.modifyStat", "panels.create"]
}
```

### 5.2 Data 모듈 예시 — 가지세계 전투

```jsonc
{
  "id": "branch-world-combat",
  "name": "가지세계 합 전투",
  "version": "1.0.0",
  "type": "data",
  "description": "가지세계 TRPG의 합(合) 전투 규칙, 메시지 템플릿, 종족 특성, 효과음 설정",
  "author": "BWAD",
  "minCoreVersion": "2.0.0",
  "tags": ["combat", "branch-world", "melee"],

  "config": {
    "namespace": "combat",
    "defaults": {
      "templates": {
        "combatStart": "《합 개시》| ⚔️ {attacker} - {atkDice}/{atkCrit}/{atkFumble} | 🛡️ {defender} - {defDice}/{defCrit}/{defFumble}",
        "roundHeader": "《{round}합》| ⚔️ {attacker} {atkDice} : 🛡️ {defender} {defDice} @{sound}",
        "attackerRoll": "1D20 ⚔️ {attacker}",
        "defenderRoll": "1D20 🛡️ {defender}",
        "roundResultWin": "⚔️ {attacker}【{atkValue}】 vs 🛡️ {defender}【{defValue}】 → {winner} 승리!",
        "victory": "《합 승리》\n{winnerIcon} {winner} @{sound}",
        "combatCancel": "《합 중지》"
      },
      "rules": {
        "diceType": 20,
        "criticalValue": 20,
        "fumbleValue": 1,
        "criticalBonus": 1,
        "fumblePenalty": 1,
        "tieRule": "reroll"
      },
      "timing": {
        "beforeFirstRoll": 700,
        "betweenRolls": 700,
        "beforeRoundResult": 700,
        "beforeNextRound": 700,
        "beforeVictory": 700,
        "resultTimeout": 3000
      },
      "traits": {
        "H0": { "name": "인간 특성", "desc": "주사위 0 시 +1 부활, 크리 시 초기화" },
        "H4": { "name": "피로 새겨진 역사", "desc": "크리 시 다음 판정 대성공+2, 최대+5 누적" }
      }
    }
  },

  "patterns": {
    "triggerRegex": "《합\\s*개시》\\s*...",
    "cancelRegex": "《합\\s*중지》"
  }
}
```

### 5.3 Data 모듈 예시 — 커스텀 TRPG

다른 TRPG 시스템 사용자가 만들 수 있는 모듈:

```jsonc
{
  "id": "custom-dnd5e-combat",
  "name": "D&D 5e 전투 보조",
  "version": "0.1.0",
  "type": "data",
  "description": "D&D 5e 이니셔티브 & 턴 추적",
  "tags": ["combat", "dnd"],

  "config": {
    "namespace": "combat",
    "defaults": {
      "templates": {
        "combatStart": "《전투 시작》| ...",
        "roundHeader": "《라운드 {round}》| ..."
      },
      "rules": {
        "diceType": 20,
        "criticalValue": 20,
        "fumbleValue": 1,
        "tieRule": "nothing"
      }
    }
  },

  "triggers": [
    {
      "id": "_builtin_initiative",
      "name": "이니셔티브 굴림",
      "pattern": "《이니셔티브》",
      "actions": [
        { "type": "dice", "value": "1D20+{DEX}" }
      ]
    }
  ]
}
```

---

## 6. 모듈 분류 계획

현재 코드를 다음 3개 모듈 + 코어로 분리한다.

### 6.1 CORE (범용 코코포리아 확장)

**항상 활성 — 모듈이 아닌 확장 프로그램 본체**

| 현재 파일 | 코어 내 위치 | 변경 사항 |
|-----------|-------------|-----------|
| `config-defaults.js` | `core/config.js` | 범용 설정만 유지 (general, selectors). 가지세계 설정 제거 |
| `chat-interface.js` | `core/chat.js` | 변경 없음 |
| `redux-injector.js` | `core/redux-bridge.js` | 범용 핸들러만 유지. 전투용 핸들러는 모듈로 이동 |
| `auto-complete.js` | `core/auto-complete.js` | 변경 없음 |
| `char-shortcut.js` | `core/char-shortcut.js` | 변경 없음 |
| `log-export-dialog.js` | `core/log-export.js` | 변경 없음 |
| `room-copy.js` | `core/room-copy.js` | 변경 없음 |
| `room-save.js` | `core/room-save.js` | 변경 없음 |
| `home-display.js` | `core/home-display.js` | 변경 없음 |
| `site-volume.js` | `core/site-volume.js` | 변경 없음 |
| `content.js` | `core/main.js` | **대규모 분해** (§8 참조) |

핵심 추가 파일:
- `core/bridge-util.js` — 크로스월드 통신 유틸리티 (§9 참조)
- `core/module-loader.js` — 모듈 로더 / 라이프사이클 매니저
- `core/api.js` — `window.BWBR_Core` 네임스페이스 구성

### 6.2 MODULE: 가지세계 전투 (`branch-world-combat`)

**type: hybrid (data + script)**

| 현재 소스 | 모듈 내 위치 | 내용 |
|-----------|-------------|------|
| `melee-engine.js` | `modules/bw-combat/melee-engine.js` | 합 전투 주사위 엔진 |
| `combat-engine.js` | `modules/bw-combat/combat-engine.js` | 턴제 전투 엔진 |
| `overlay.js` + `overlay.css` | `modules/bw-combat/overlay.js` | 전투 UI 오버레이 |
| `combat-move.js` | `modules/bw-combat/combat-move.js` | 이동 시각화 |
| `grid-overlay.js` | `modules/bw-combat/grid-overlay.js` | 그리드 오버레이 |
| `token-binding.js` | `modules/bw-combat/token-binding.js` | 패널↔캐릭터 바인딩 |
| `content.js` 中 전투 로직 | `modules/bw-combat/controller.js` | 전투 상태 머신, 관전 로직 |
| `config-defaults.js` 中 전투 설정 | `modules/bw-combat/manifest.json` | templates, rules, timing, sounds, traits, patterns |

### 6.3 MODULE: 트리거 자동화 (`trigger-automation`)

**type: hybrid (data + script)**

| 현재 소스 | 모듈 내 위치 | 내용 |
|-----------|-------------|------|
| `trigger-engine.js` | `modules/triggers/engine.js` | 패턴 매칭 + 액션 체인 |
| `trigger-ui.js` | `modules/triggers/ui.js` | 트리거 관리 모달 |
| `triggers/defaults.json` | `modules/triggers/defaults.json` | 내장 트리거 프리셋 |

### 6.4 분리 다이어그램

```
현재 (v1.2.6)                        목표 (v2.0)
─────────────────                    ─────────────────────────────
content.js (3629줄) ──분해──►        core/main.js (~800줄)
                                     + modules/bw-combat/controller.js (~2000줄)
                                     + core/bridge-util.js (~200줄)

config-defaults.js ──분리──►         core/config.js (general + selectors만)
                                     + modules/bw-combat/manifest.json (전투 설정)

redux-injector.js ──분리──►          core/redux-bridge.js (범용)
                                     + modules/bw-combat/main-world.js (전투 핸들러)
```

---

## 7. 설정(Config) 시스템 재설계

### 7.1 현재 문제

`BWBR_DEFAULTS`가 단일 객체에 모든 설정을 담고 있다:

```
BWBR_DEFAULTS
├── templates    ← 가지세계 전투 전용
├── timing       ← 가지세계 전투 전용
├── sounds       ← 가지세계 전투 전용
├── rules        ← 가지세계 전투 전용
├── patterns     ← 가지세계 전투 전용
├── traits       ← 가지세계 전투 전용
├── selectors    ← 범용 (DOM 선택자)
└── general      ← 범용 (autoComplete, siteVolume 등)
```

`popup.js`도 이 구조를 복제하고 있어 이중 관리가 필요하다.

### 7.2 새 설계: 네임스페이스 분리

```
chrome.storage.sync
├── core.general       ← { enabled, autoComplete, siteVolume, ... }
├── core.selectors     ← { chatContainer, chatInput, ... }
├── combat.templates   ← 모듈이 등록한 전투 템플릿
├── combat.rules       ← 모듈이 등록한 전투 규칙
├── combat.timing      ← 모듈이 등록한 타이밍
├── combat.sounds      ← 모듈이 등록한 효과음
├── combat.traits      ← 모듈이 등록한 종족 특성
├── triggers.enabled   ← 트리거 모듈 활성/비활성
└── [moduleId].*       ← 각 모듈의 자체 설정
```

### 7.3 마이그레이션 전략

```js
// v2.0 첫 실행 시 자동 변환
async function migrateConfig_v1_to_v2(oldConfig) {
  return {
    'core.general': oldConfig.general,
    'core.selectors': oldConfig.selectors,
    'combat.templates': oldConfig.templates,
    'combat.rules': oldConfig.rules,
    'combat.timing': oldConfig.timing,
    'combat.sounds': oldConfig.sounds,
    'combat.traits': oldConfig.traits
  };
}
```

### 7.4 popup.js 통합

현재: `popup.js`가 `BWBR_DEFAULTS`를 자체 복제 → 동기화 문제.

개선: 모듈 매니저가 각 모듈의 설정 스키마를 `chrome.storage`에 저장. popup.js는 스키마를 읽어 동적으로 설정 UI를 생성한다.

```js
// 모듈이 등록하는 설정 스키마
{
  "namespace": "combat",
  "sections": [
    {
      "title": "전투 규칙",
      "fields": [
        { "key": "rules.diceType", "type": "number", "label": "주사위 면 수", "default": 20 },
        { "key": "rules.criticalValue", "type": "number", "label": "대성공 값", "default": 20 },
        { "key": "rules.tieRule", "type": "select", "label": "동점 처리",
          "options": ["reroll", "bothLose", "nothing", "attackerWins", "defenderWins"] }
      ]
    }
  ]
}
```

---

## 8. content.js 분해 계획

### 8.1 현재 content.js의 구성 요소 (추정)

| 구성 요소 | 추정 라인 수 | 분류 |
|-----------|-------------|------|
| 초기화, Redux 주입, 설정 로드 | ~300 | **코어** |
| 메시지 감지 / 분배 (`onNewMessage`) | ~200 | **코어** |
| 전투 상태 머신 (합 매칭, 라운드 진행) | ~1,500 | **전투 모듈** |
| 턴제 전투 (`advanceTurn`, 행동 소모) | ~500 | **전투 모듈** |
| 관전 로직 (spectator) | ~400 | **전투 모듈** |
| 볼륨 슬라이더 주입 | ~200 | **코어** |
| 로그 내보내기 메뉴 | ~100 | **코어** |
| 트리거 초기화/연결 | ~100 | **코어** (트리거 모듈 연결) |
| 유틸리티 함수 | ~200 | **코어** |
| chrome.runtime 메시지 핸들러 | ~130 | **코어** |

### 8.2 분해 전략

#### Phase 1: 추출 없이 구역 표시

```js
// content.js에 주석 마커 삽입
// ===== [CORE] 초기화 =====
// ===== [COMBAT] 상태 머신 =====
// ===== [COMBAT] 턴제 =====
// ===== [COMBAT] 관전 =====
// ===== [CORE] 볼륨/UI =====
```

#### Phase 2: 전투 로직을 별도 파일로 추출

```js
// modules/bw-combat/controller.js
class BranchWorldCombatController {
  constructor(coreApi) {
    this.core = coreApi;
    this.meleeEngine = new BattleRollEngine(/*...*/);
    this.combatEngine = new CombatEngine(/*...*/);
    this.overlay = new BattleRollOverlay(/*...*/);
    this.state = 'IDLE';
  }

  onMessage(msg) {
    // 전투 트리거 감지, 상태 머신 진행
  }

  // ... 모든 전투 관련 메서드
}
```

#### Phase 3: content.js를 가벼운 오케스트레이터로

```js
// core/main.js (~800줄)
(async function() {
  const config = await loadConfig();
  const bridge = new BridgeUtil();
  
  // 코어 API 구성
  window.BWBR_Core = buildCoreApi(config, bridge);
  
  // 모듈 로드
  const moduleLoader = new ModuleLoader();
  await moduleLoader.loadAll();
  
  // 메시지 감지 → 모듈에 분배
  BWBR_Core.chat.onMessage(msg => {
    moduleLoader.dispatch('onMessage', msg);
  });
  
  // UI 초기화
  initVolumeSlider();
  initLogExportMenu();
})();
```

---

## 9. 크로스월드 브릿지 통합

### 9.1 현재 문제

각 파일이 동일한 패턴을 반복:

```js
// 요청 보내기 (N개 파일에서 반복)
document.documentElement.setAttribute('data-bwbr-payload', JSON.stringify(data));
document.dispatchEvent(new CustomEvent('bwbr-some-event'));

// 응답 받기 (각자 타임아웃 로직 구현)
document.addEventListener('bwbr-some-response', () => {
  const result = JSON.parse(document.documentElement.getAttribute('data-bwbr-payload'));
  document.documentElement.removeAttribute('data-bwbr-payload');
  // ...
}, { once: true });
```

### 9.2 통합 유틸리티 설계

```js
// core/bridge-util.js
class BridgeUtil {
  /**
   * 요청-응답 패턴 (Promise 기반)
   * @param {string} requestEvent - 요청 이벤트명
   * @param {string} responseEvent - 응답 이벤트명
   * @param {object} payload - 전송 데이터
   * @param {number} timeout - 타임아웃 (ms, 기본 5000)
   * @returns {Promise<object>}
   */
  request(requestEvent, responseEvent, payload = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const handler = () => {
        clearTimeout(timer);
        const raw = document.documentElement.getAttribute('data-bwbr-payload');
        document.documentElement.removeAttribute('data-bwbr-payload');
        resolve(raw ? JSON.parse(raw) : {});
      };
      
      const timer = setTimeout(() => {
        document.removeEventListener(responseEvent, handler);
        reject(new Error(`Bridge timeout: ${responseEvent}`));
      }, timeout);
      
      document.addEventListener(responseEvent, handler, { once: true });
      
      document.documentElement.setAttribute('data-bwbr-payload', JSON.stringify(payload));
      document.dispatchEvent(new CustomEvent(requestEvent));
    });
  }

  /**
   * 단방향 전송
   */
  send(eventName, payload = {}) {
    document.documentElement.setAttribute('data-bwbr-payload', JSON.stringify(payload));
    document.dispatchEvent(new CustomEvent(eventName));
  }

  /**
   * 이벤트 구독
   * @returns {Function} unsubscribe
   */
  on(eventName, handler) {
    const wrapped = () => {
      const raw = document.documentElement.getAttribute('data-bwbr-payload');
      document.documentElement.removeAttribute('data-bwbr-payload');
      handler(raw ? JSON.parse(raw) : {});
    };
    document.addEventListener(eventName, wrapped);
    return () => document.removeEventListener(eventName, wrapped);
  }
}
```

### 9.3 캐릭터 데이터 캐시

```js
// core/character-cache.js
class CharacterCache {
  constructor(bridge) {
    this.bridge = bridge;
    this._cache = null;
    this._cacheTime = 0;
    this._TTL = 500; // 500ms 캐시
  }

  async getAll() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTime) < this._TTL) {
      return this._cache;
    }
    this._cache = await this.bridge.request(
      'bwbr-request-all-characters',
      'bwbr-all-characters-data'
    );
    this._cacheTime = now;
    return this._cache;
  }

  invalidate() {
    this._cache = null;
  }
}
```

---

## 10. 마이그레이션 로드맵

### Phase 0 — 준비 (v1.3.x)

코드 변경 없이 구조만 정리.

- [ ] content.js에 `[CORE]` / `[COMBAT]` / `[TRIGGER]` 구역 주석 추가
- [ ] 크로스월드 통신 패턴을 목록화 (이벤트명 ↔ 사용처)
- [ ] `BWBR_DEFAULTS`에서 범용 vs 가지세계 전용 키를 주석으로 분류
- [ ] `COCOFOLIA_DATA_API.md` 업데이트 (최신 구조 반영)

### Phase 1 — 브릿지 통합 (v1.4.x)

기능 변경 없이 내부 리팩토링.

- [ ] `core/bridge-util.js` 작성 및 테스트
- [ ] 각 모듈의 크로스월드 통신을 `BridgeUtil` 사용으로 전환
- [ ] `CharacterCache` 도입 → 중복 캐릭터 요청 제거
- [ ] 자체 초기화 IIFE → 명시적 `init()` 패턴으로 전환

### Phase 2 — 설정 분리 (v1.5.x)

- [ ] `BWBR_DEFAULTS`를 `core.general` + `core.selectors` + `combat.*`로 분리
- [ ] `chrome.storage` 키 네임스페이스 적용
- [ ] v1→v2 설정 마이그레이션 함수 작성
- [ ] popup.js를 네임스페이스 기반으로 리팩토링

### Phase 3 — content.js 분해 (v1.6.x~v1.8.x)

가장 큰 작업. 단계별로 진행.

- [ ] 전투 상태 머신 → `bw-combat/controller.js` 추출
- [ ] 턴제 로직 → CombatEngine과 함께 모듈화
- [ ] 관전 로직 → 전투 모듈 내 이동
- [ ] overlay + combat-move → 전투 모듈 내 이동
- [ ] content.js를 `core/main.js` (~800줄)로 축소

### Phase 4 — 모듈 로더 (v1.9.x)

- [ ] `core/module-loader.js` 구현
- [ ] data 모듈 포맷 확정 및 파서 구현
- [ ] 가지세계 전투 설정을 `branch-world-combat.json`으로 추출
- [ ] 기본 트리거를 `branch-world-triggers.json`으로 추출
- [ ] 모듈 활성/비활성 UI (popup)

### Phase 5 — v2.0 출시

- [ ] 모듈 관리 UI (설치/제거/토글)
- [ ] 하위 호환 테스트 (v1.x 설정 자동 마이그레이션)
- [ ] script 타입 모듈 지원 (v2.1)
- [ ] 문서화 (모듈 개발 가이드)

### 예상 일정

| Phase | 예상 작업량 | 위험도 |
|-------|-----------|--------|
| Phase 0 | 1~2일 | 낮음 (주석만) |
| Phase 1 | 3~5일 | 낮음 (유틸리티 교체) |
| Phase 2 | 3~5일 | 중간 (storage 마이그레이션) |
| Phase 3 | 7~14일 | **높음** (content.js 분해) |
| Phase 4 | 5~7일 | 중간 (새 시스템) |
| Phase 5 | 3~5일 | 낮음 (UI/문서) |

---

## 11. 제약사항 및 미해결 이슈

### 11.1 Chrome MV3 제약

| 제약 | 영향 | 대응 |
|------|------|------|
| `eval()` / `new Function()` 금지 | 모듈 JS 코드를 동적 실행 불가 | script 모듈은 manifest.json의 `content_scripts`에 정적 등록 필요, 또는 `chrome.scripting.executeScript()` 사용 |
| Content Script 동적 주입 제한 | 모듈 JS를 런타임에 `<script>`로 주입 불가 (CSP) | `chrome.scripting.executeScript()` (Manifest V3) 또는 `web_accessible_resources`로 우회 |
| 파일시스템 접근 불가 | 사용자가 `.json` 파일을 "설치"할 수 없음 | 모듈 데이터를 `chrome.storage.local`에 저장, UI에서 파일 업로드(FileReader API) |

### 11.2 미해결 설계 이슈

1. **script 모듈의 MAIN 월드 접근**: hybrid 모듈이 MAIN 월드 코드를 필요로 할 때, redux-injector.js에 핸들러를 동적으로 추가할 방법이 필요하다. → `web_accessible_resources`에 모듈 JS를 등록하고, `<script>` 태그로 주입하는 방식 검토 필요.

2. **모듈 간 충돌**: 두 전투 모듈이 동시에 활성화되면 메시지 패턴이 충돌할 수 있다. → 모듈 카테고리별 배타적 활성화 (combat 카테고리는 하나만 활성) 검토 필요.

3. **popup.js 설정 동기화**: 현재 popup.js가 `BWBR_DEFAULTS`를 자체 복제하는 구조를 어떻게 전환할지. → 모듈이 등록하는 JSON 스키마 기반 동적 UI 생성이 가장 깔끔하나, 구현 복잡도가 높다.

4. **모듈 업데이트 메커니즘**: 사용자가 설치한 모듈의 버전 업데이트를 어떻게 알릴지. → GitHub release 기반 또는 모듈 레지스트리 서버 필요.

5. **트리거 모듈과 전투 모듈의 의존성**: 가지세계 기본 트리거 중 전투와 직접 연관된 것들(《합 개시》 등)은 전투 모듈이 비활성화되면 무의미하다. → `dependencies` 필드로 선언적 의존성 관리.

---

## 부록 A: 파일 매핑 요약

| 현재 파일 | v2.0 위치 | 분류 |
|-----------|-----------|------|
| `config-defaults.js` | `core/config.js` | 코어 |
| `chat-interface.js` | `core/chat.js` | 코어 |
| `auto-complete.js` | `core/auto-complete.js` | 코어 |
| `char-shortcut.js` | `core/char-shortcut.js` | 코어 |
| `log-export-dialog.js` | `core/log-export.js` | 코어 |
| `grid-overlay.js` | `modules/bw-combat/grid-overlay.js` | **전투 모듈** |
| `token-binding.js` | `modules/bw-combat/token-binding.js` | **전투 모듈** |
| `room-copy.js` | `core/room-copy.js` | 코어 |
| `room-save.js` | `core/room-save.js` | 코어 |
| `home-display.js` | `core/home-display.js` | 코어 |
| `site-volume.js` | `core/site-volume.js` | 코어 |
| `content.js` | `core/main.js` (분해) | 코어 + 전투모듈 |
| `redux-injector.js` | `core/redux-bridge.js` (분리) | 코어 + 전투모듈 |
| `melee-engine.js` | `modules/bw-combat/melee-engine.js` | 전투 모듈 |
| `combat-engine.js` | `modules/bw-combat/combat-engine.js` | 전투 모듈 |
| `overlay.js` + `.css` | `modules/bw-combat/overlay.js` | 전투 모듈 |
| `combat-move.js` | `modules/bw-combat/combat-move.js` | 전투 모듈 |
| `grid-overlay.js` | `modules/bw-combat/grid-overlay.js` | 전투 모듈 |
| `token-binding.js` | `modules/bw-combat/token-binding.js` | 전투 모듈 |
| `trigger-engine.js` | `modules/triggers/engine.js` | 트리거 모듈 |
| `trigger-ui.js` | `modules/triggers/ui.js` | 트리거 모듈 |
| `triggers/defaults.json` | `modules/triggers/defaults.json` | 트리거 모듈 |
| (신규) | `core/bridge-util.js` | 코어 |
| (신규) | `core/module-loader.js` | 코어 |
| (신규) | `core/api.js` | 코어 |
| (신규) | `core/character-cache.js` | 코어 |

## 부록 B: 이벤트 브릿지 매핑

모듈 분리 후, 어떤 이벤트가 코어에 남고 어떤 것이 모듈로 이동하는지:

### 코어 유지

| 이벤트 | 용도 |
|--------|------|
| `bwbr-request-characters` / `-data` | 캐릭터 목록 |
| `bwbr-request-all-characters` / `-data` | 전체 캐릭터 |
| `bwbr-request-speaking-character` / `-data` | 발화 캐릭터 |
| `bwbr-switch-character` | 캐릭터 전환 |
| `bwbr-send-message-direct` / `-result` | 메시지 전송 |
| `bwbr-request-cutins` / `-data` | 컷인 목록 |
| `bwbr-request-panel-tags` / `-data` | 패널 태그 |
| `bwbr-trigger-panel-op` / `-result` | 패널 조작 |
| `bwbr-room-export` / `-import` | 방 복사 |
| `bwbr-request-log-messages` | 로그 요청 |

### 전투 모듈로 이동

| 이벤트 | 용도 |
|--------|------|
| `bwbr-modify-status` / `-result` | 스탯 변경 (전투 중 HP/행동력 등) |
| `bwbr-modify-status-all` / `-result` | 전체 스탯 변경 |
| `bwbr-get-char-stats` / `-result` | 캐릭터 스탯 조회 |
| `bwbr-request-char-for-move` | 전투 이동용 캐릭터 |
| `bwbr-move-item` | 토큰 이동 |
| `bwbr-identify-character-by-image` / `-identified` | 이미지 기반 캐릭터 식별 |
| `bwbr-sync-token-bindings` | 토큰 바인딩 |
| `bwbr-identify-panel` | 패널 식별 |

> **참고**: `bwbr-modify-status`는 트리거 모듈에서도 사용하므로, 코어에 유지하되 전투 모듈이 주 소비자라는 점을 기록.

---

*이 문서는 설계 초안이며, 실제 구현 시 세부 사항이 변경될 수 있다.*
