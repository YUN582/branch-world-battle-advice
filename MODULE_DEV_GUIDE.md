# Ccofolia Extension — 모듈 개발 가이드

> **대상 버전**: CE v1.2.55+  
> **최종 갱신**: 2026-03-04

---

## 1. 개요

Ccofolia Extension(CE)은 **모듈 시스템**을 통해 기능을 확장할 수 있습니다. 모듈은 JSON 파일 하나로 구성되며, 데이터 모듈(`type: "data"`)과 스크립트 모듈(`type: "script"`) 두 가지 타입을 지원합니다.

### 모듈이 할 수 있는 것

| 기능 | 설명 |
|------|------|
| **전투 설정 제공** | 주사위 규칙, 메시지 템플릿, 타이밍, 효과음, 종족 특성 등 |
| **트리거 프리셋 제공** | 패턴 매칭 → 액션 체인 (메시지, 스탯 변경, 컷인, 주사위 등) |
| **JavaScript 코드 실행** | MAIN/ISOLATED world에서 스크립트 실행 (⚡ script 모듈) |
| **모듈 의존성** | `dependencies` 필드로 다른 모듈에 대한 의존성 선언 및 로드 순서 보장 |
| **복합 모듈** | 전투 설정 + 트리거 + 스크립트를 하나의 모듈에 포함 가능 |

### 모듈이 할 수 없는 것

- 코어 UI 변경
- 다른 모듈의 설정 직접 수정

---

## 2. 모듈 매니페스트 구조

모듈은 단일 JSON 파일(매니페스트)입니다. 최소 구조:

```json
{
  "id": "my-module",
  "name": "내 모듈",
  "version": "1.0.0",
  "type": "data",
  "description": "모듈 설명",
  "author": "작성자",
  "tags": ["custom", "combat"],
  "minCoreVersion": "1.2.0"
}
```

### 필수 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `string` | 고유 식별자. 영문·숫자·하이픈·밑줄만 허용. 예: `my-combat-rules` |
| `name` | `string` | 표시 이름. 한글/영문 모두 가능 |
| `version` | `string` | SemVer 형식. 예: `1.0.0` |
| `type` | `string` | `"data"` 또는 `"script"` |

### 선택 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `description` | `string` | 모듈 설명 (팝업 UI에 표시) |
| `author` | `string` | 작성자 이름 |
| `tags` | `string[]` | 태그 배열 (UI 필터링용) |
| `minCoreVersion` | `string` | 최소 코어 버전 요구사항 |
| `config` | `object` | 설정 기본값 제공 (§3 참조) |
| `triggers` | `array` | 트리거 프리셋 제공 (§4 참조) |
| `dependencies` | `string[]` | 의존하는 모듈 ID 목록 (§5.1 참조) |
| `script` | `object` | 스크립트 모듈 설정 (§5.2 참조, `type: "script"` 전용) |

---

## 3. 전투 설정 모듈 (config)

전투 규칙, 메시지 템플릿, 효과음 등을 제공하는 모듈입니다.

### 3.1 config 객체 구조

```json
{
  "config": {
    "namespace": "combat",
    "storageKey": "bwbr_combat",
    "defaults": {
      "templates": { ... },
      "timing": { ... },
      "sounds": { ... },
      "rules": { ... },
      "patterns": { ... },
      "traits": { ... }
    }
  }
}
```

| 필드 | 설명 |
|------|------|
| `namespace` | 설정 네임스페이스. 현재 `"combat"`만 코어가 인식합니다 |
| `storageKey` | chrome.storage 키. `"bwbr_combat"` 고정 |
| `defaults` | 기본 설정값 객체 |

### 3.2 templates (메시지 템플릿)

전투 메시지에 사용되는 텍스트 템플릿입니다. `{변수명}` 형식의 플레이스홀더를 사용합니다.

```json
"templates": {
  "combatStart": "《합 개시》| ⚔️ {attacker} - {atkDice}/{atkCrit}/{atkFumble} | 🛡️ {defender} - {defDice}/{defCrit}/{defFumble}",
  "roundHeader": "《{round}합》| ⚔️ {attacker} {atkDice} : 🛡️ {defender} {defDice} @{sound}",
  "attackerRoll": "1D20 ⚔️ {attacker}",
  "defenderRoll": "1D20 🛡️ {defender}",
  "roundResultWin": "⚔️ {attacker}【{atkValue}】 vs 🛡️ {defender}【{defValue}】 → {winner} 승리!",
  "roundResultCrit": "💥 {name} 대성공! 【{value}】 → 상대 주사위 파괴 & 주사위 +1",
  "roundResultFumble": "💀 {name} 대실패! 【{value}】 → 자신 주사위 파괴 & 주사위 -1",
  "roundResultBothCrit": "⚡ 쌍방 대성공! ⚔️【{atkValue}】 🛡️【{defValue}】 → 각자 주사위 +1",
  "roundResultTie": "⚖️ 무승부! ⚔️【{atkValue}】 🛡️【{defValue}】 → 재굴림",
  "victory": "《합 승리》\n{winnerIcon} {winner} @{sound}",
  "combatCancel": "《합 중지》"
}
```

**사용 가능한 플레이스홀더:**

| 변수 | 사용 위치 | 설명 |
|------|----------|------|
| `{attacker}` | 대부분 | 공격자 이름 |
| `{defender}` | 대부분 | 방어자 이름 |
| `{atkDice}` / `{defDice}` | combatStart, roundHeader | 주사위 수 |
| `{atkCrit}` / `{defCrit}` | combatStart | 크리티컬 값 |
| `{atkFumble}` / `{defFumble}` | combatStart | 펌블 값 |
| `{atkValue}` / `{defValue}` | 결과 템플릿 | 주사위 결과값 |
| `{round}` | roundHeader | 라운드 번호 |
| `{winner}` / `{winnerIcon}` | victory | 승자 이름/아이콘 |
| `{name}` / `{value}` | crit/fumble | 해당 캐릭터 |
| `@{sound}` | roundHeader, victory | 효과음 트리거 |

### 3.3 timing (타이밍, ms)

```json
"timing": {
  "beforeFirstRoll": 700,
  "betweenRolls": 700,
  "beforeRoundResult": 700,
  "beforeNextRound": 700,
  "beforeVictory": 700,
  "resultTimeout": 3000
}
```

### 3.4 sounds (효과음 이름 배열)

```json
"sounds": {
  "combatStartSounds": ["합"],
  "roundHeaderSounds": ["챙1", "챙2", "챙3"],
  "resultNormalSounds": ["챙1", "챙2", "챙3"],
  "resultSpecialSounds": ["챙4"],
  "victorySounds": ["합"],
  "battleStartSounds": [],
  "turnStartSounds": [],
  "actionConsumeSounds": ["발도1"],
  "actionAddSounds": ["발도2"],
  "battleEndSounds": []
}
```

효과음은 코코포리아 방에 등록된 SE(사운드 이펙트) 이름입니다. `@이름` 형식으로 채팅에 입력하면 재생됩니다.

### 3.5 rules (전투 규칙)

```json
"rules": {
  "diceType": 20,
  "criticalValue": 20,
  "fumbleValue": 1,
  "criticalBonus": 1,
  "fumblePenalty": 1,
  "tieRule": "reroll"
}
```

| 필드 | 설명 |
|------|------|
| `diceType` | 주사위 면 수 (20 = D20) |
| `criticalValue` | 크리티컬 판정 값 |
| `fumbleValue` | 펌블 판정 값 |
| `criticalBonus` | 크리티컬 시 보너스 주사위 |
| `fumblePenalty` | 펌블 시 감소 주사위 |
| `tieRule` | 동점 처리: `"reroll"`, `"bothLose"`, `"nothing"`, `"attackerWins"`, `"defenderWins"` |

### 3.6 patterns (정규식 패턴)

```json
"patterns": {
  "triggerRegex": "정규식 문자열 (합 개시 패턴)",
  "diceResultRegex": "정규식 문자열 (주사위 결과 추출)",
  "cancelRegex": "정규식 문자열 (합 중지 패턴)"
}
```

### 3.7 traits (종족 특성)

```json
"traits": {
  "코드": { "name": "특성 이름", "desc": "설명" }
}
```

특성 코드는 전투 개시 시 캐릭터에 할당됩니다 (예: `H0`, `H4`).

---

## 4. 트리거 프리셋 모듈 (triggers)

패턴 매칭 → 액션 체인을 제공하는 모듈입니다.

### 4.1 triggers 배열 구조

```json
{
  "triggers": [
    {
      "id": "_builtin_damage",
      "name": "피해",
      "enabled": false,
      "pattern": "《피해》| {대상} | {스탯} | {수치}",
      "source": "input",
      "conditions": { "states": [] },
      "actions": [ ... ],
      "delay": 300,
      "priority": 0
    }
  ]
}
```

### 4.2 트리거 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `string` | 고유 ID. 내장: `_builtin_*`, 사용자: `usr_*` |
| `name` | `string` | 표시 이름 |
| `enabled` | `boolean` | 기본 활성 여부 (`false` 권장 — 사용자가 필요 시 켤 수 있도록) |
| `pattern` | `string` | 매칭 패턴. `《이름》| {파라미터}` 형식 |
| `source` | `string` | `"input"` (사용자 입력), `"message"` (채팅 메시지) |
| `conditions` | `object` | 실행 조건 (선택) |
| `actions` | `array` | 액션 체인 배열 |
| `delay` | `number` | 액션 간 딜레이 (ms) |
| `priority` | `number` | 우선순위 (높을수록 먼저 실행) |

### 4.3 패턴 문법

패턴은 한글 겹낫표(`《》`) 안에 트리거 이름을, 파이프(`|`) 뒤에 매개변수를 씁니다:

```
《트리거이름》| {파라미터1} | {파라미터2}
```

사용자가 채팅에 이 형식으로 입력하면, `{파라미터}`에 해당하는 값이 캡처됩니다.

**내장 매개변수 이름** (한글):

| 매개변수 | 용도 |
|----------|------|
| `{대상}` | 대상 캐릭터 이름 |
| `{스탯}` | 스탯 라벨 (HP, MP 등) |
| `{수치}` | 숫자 값 |
| `{내용}` | 자유 텍스트 |
| `{장면이름}` | 코코포리아 씬 이름 |
| `{캐릭터}` | 캐릭터 이름 |
| `{대사}` | 대사 텍스트 |
| `{주사위}` | 주사위 커맨드 |

### 4.4 액션 타입

| type | 설명 | 주요 필드 |
|------|------|----------|
| `message` | 시스템 메시지 전송 | `template` |
| `stat` | 캐릭터 스탯 변경 | `target`, `stat`, `op` (`+`, `-`, `=`), `value` |
| `dice` | 주사위 굴리기 | `command` (예: `1d20`) |
| `cutin` | 컷인 표시 | `cutinName` |
| `face` | 캐릭터 표정 변경 | `target`, `faceIndex` |
| `load_scene` | 씬 전환 | `sceneName`, `applyOption` |
| `bgm` | BGM 재생 | `bgmName` |
| `se` | SE 재생 | `seName` |
| `wait` | 대기 | `ms` |
| `log` | 콘솔 로그 | `text` |
| `condition_dice` | 주사위 조건 분기 | `op`, `value`, `inGroup` |

### 4.5 조건 분기 (`condition_dice`)

주사위 결과에 따라 후속 액션을 조건부 실행합니다:

```json
[
  { "type": "dice", "command": "1d20" },
  { "type": "condition_dice", "op": ">=", "value": "15", "inGroup": false },
  { "type": "message", "template": "✅ 성공!", "inGroup": true },
  { "type": "condition_dice", "op": "<", "value": "15", "inGroup": false },
  { "type": "message", "template": "❌ 실패...", "inGroup": true }
]
```

- `inGroup: false` → 조건 시작 (새 분기)
- `inGroup: true` → 바로 위 조건이 참일 때만 실행
- `op`: `==`, `!=`, `>`, `>=`, `<`, `<=`

---

## 5. 의존성 & 스크립트 모듈

### 5.1 모듈 의존성 (dependencies)

`dependencies` 필드를 사용하면 다른 모듈의 로드 순서를 보장할 수 있습니다.

```json
{
  "id": "my-addon",
  "name": "내 애드온",
  "version": "1.0.0",
  "type": "data",
  "dependencies": ["branch-world"]
}
```

**동작 방식:**

- 의존 모듈이 먼저 로드됩니다 (위상 정렬/Kahn's algorithm)
- 의존 모듈이 **설치되지 않거나 비활성화**되어 있으면 ⚠️ 경고가 팝업에 표시됩니다
- 의존성 미충족 시에도 모듈은 **로드됩니다** (경고만, 완전 차단 안 함)
- 순환 의존성은 자동 감지되며 순서 무시 후 로드됩니다

**제한사항:**

- `dependencies`는 문자열 배열이어야 합니다
- 각 요소는 다른 모듈의 `id` 값입니다

### 5.2 스크립트 모듈 (type: "script")

JavaScript 코드를 실행하는 모듈입니다. 데이터 모듈(`config`, `triggers`)의 기능도 함께 사용할 수 있습니다.

```json
{
  "id": "my-script-mod",
  "name": "내 스크립트 모듈",
  "version": "1.0.0",
  "type": "script",
  "script": {
    "code": "console.log('Hello from MAIN world!');",
    "world": "main"
  }
}
```

**script 필드 구조:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `code` | `string` | 실행할 JavaScript 코드 (사용자 모듈 필수) |
| `file` | `string` | 스크립트 파일 경로 (내장 모듈 전용, `web_accessible_resources` 필요) |
| `world` | `string` | 실행 컨텍스트: `"main"` (기본값) 또는 `"isolated"` |

**world 옵션:**

| World | 설명 | 접근 가능 |
|-------|------|-----------|
| `main` | 페이지 컨텍스트에서 실행 (`<script>` 태그 삽입) | Redux, Firestore, 페이지 `window` |
| `isolated` | 콘텐츠 스크립트 컨텍스트에서 실행 (blob URL + `import()`) | Chrome API, CE 전역 변수 (`BWBR_*`) |

**사용자 모듈 제한:**

- 사용자 스크립트 모듈은 `code` 필드만 사용 가능 (`file` 불가)
- MV3 보안 정책에 의해 `eval()`, `new Function()`은 사용할 수 없습니다
- MAIN world 코드는 IIFE로 자동 래핑되어 실행됩니다

**예시: ISOLATED world에서 CE API 확장**

```json
{
  "id": "custom-greeting",
  "name": "커스텀 인사",
  "version": "1.0.0",
  "type": "script",
  "dependencies": ["branch-world"],
  "script": {
    "code": "window.MY_CUSTOM_GREETING = function(name) { return '안녕하세요, ' + name + '!'; };",
    "world": "isolated"
  },
  "triggers": [
    {
      "id": "usr_greet",
      "name": "인사",
      "enabled": true,
      "pattern": "《인사》| {대상}",
      "source": "input",
      "actions": [
        { "type": "message", "template": "👋 {대상}님, 환영합니다!" }
      ]
    }
  ]
}
```

---

## 6. 완전한 모듈 예시

## 6.1 전투 규칙 모듈 (간단한 D6 시스템)

```json
{
  "id": "simple-d6-combat",
  "name": "간단한 D6 전투",
  "version": "1.0.0",
  "type": "data",
  "description": "D6 기반 간단한 전투 규칙",
  "author": "홍길동",
  "tags": ["combat", "d6"],
  "minCoreVersion": "1.2.0",
  "config": {
    "namespace": "combat",
    "storageKey": "bwbr_combat",
    "defaults": {
      "rules": {
        "diceType": 6,
        "criticalValue": 6,
        "fumbleValue": 1,
        "criticalBonus": 1,
        "fumblePenalty": 1,
        "tieRule": "reroll"
      },
      "templates": {
        "combatStart": "《합 개시》| ⚔️ {attacker} - {atkDice}/{atkCrit}/{atkFumble} | 🛡️ {defender} - {defDice}/{defCrit}/{defFumble}",
        "roundHeader": "《{round}합》| ⚔️ {attacker} {atkDice} : 🛡️ {defender} {defDice}",
        "attackerRoll": "1D6 ⚔️ {attacker}",
        "defenderRoll": "1D6 🛡️ {defender}",
        "roundResultWin": "⚔️ {attacker}【{atkValue}】 vs 🛡️ {defender}【{defValue}】 → {winner} 승리!",
        "roundResultCrit": "💥 {name} 대성공!",
        "roundResultFumble": "💀 {name} 대실패!",
        "roundResultBothCrit": "⚡ 쌍방 대성공!",
        "roundResultTie": "⚖️ 무승부! → 재굴림",
        "victory": "🏆 {winner} 최종 승리!",
        "combatCancel": "《합 중지》"
      },
      "timing": {
        "beforeFirstRoll": 500,
        "betweenRolls": 500,
        "beforeRoundResult": 500,
        "beforeNextRound": 500,
        "beforeVictory": 500,
        "resultTimeout": 3000
      },
      "sounds": {
        "combatStartSounds": [],
        "roundHeaderSounds": [],
        "resultNormalSounds": [],
        "resultSpecialSounds": [],
        "victorySounds": [],
        "battleStartSounds": [],
        "turnStartSounds": [],
        "actionConsumeSounds": [],
        "actionAddSounds": [],
        "battleEndSounds": []
      },
      "patterns": {
        "triggerRegex": "《합\\s*개시》\\s*\\|?\\s*⚔\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?\\s*\\|?\\s*🛡\\uFE0F?\\s*(.+?)\\s*-\\s*(\\d+)\\s*/\\s*(\\d+)\\s*/\\s*(\\d+)(?:\\s*/\\s*([A-Za-z0-9]+))?",
        "diceResultRegex": "1[Dd]6[^0-9]*?[→＞>]\\s*(\\d+)",
        "cancelRegex": "《합\\s*중지》"
      },
      "traits": {}
    }
  }
}
```

### 6.2 트리거 프리셋 모듈

```json
{
  "id": "gm-toolkit-triggers",
  "name": "GM 도구 트리거",
  "version": "1.0.0",
  "type": "data",
  "description": "GM이 자주 사용하는 트리거 모음 — 힐, 상태이상, 주사위 체크",
  "author": "GM킴",
  "tags": ["triggers", "gm-tools"],
  "minCoreVersion": "1.2.0",
  "triggers": [
    {
      "id": "usr_heal",
      "name": "회복",
      "enabled": false,
      "pattern": "《회복》| {대상} | {수치}",
      "source": "input",
      "conditions": { "states": [] },
      "actions": [
        { "type": "stat", "target": "{대상}", "stat": "HP", "op": "+", "value": "{수치}" },
        { "type": "message", "template": "💚 {대상}의 HP가 +{수치} 회복되었습니다!" }
      ],
      "delay": 300,
      "priority": 0
    },
    {
      "id": "usr_full_heal",
      "name": "전체 회복",
      "enabled": false,
      "pattern": "《전체회복》",
      "source": "input",
      "conditions": { "states": [] },
      "actions": [
        { "type": "stat_all", "stat": "HP", "op": "=max" },
        { "type": "message", "template": "💚 모든 캐릭터의 HP가 최대치로 회복됩니다!" }
      ],
      "delay": 300,
      "priority": 0
    }
  ]
}
```

---

## 7. 모듈 설치 / 관리

### 설치 방법

1. 모듈 JSON 파일을 준비합니다
2. 확장 프로그램 팝업 → **모듈** 탭
3. **📥 모듈 가져오기** 버튼 클릭
4. JSON 파일을 선택
5. 코코포리아 탭을 **새로고침**

### 내보내기

모듈 카드의 📤 버튼으로 JSON 파일로 내보낼 수 있습니다. 다른 사용자에게 공유할 때 유용합니다.

### 삭제

사용자 모듈은 모듈 카드의 🗑️ 버튼으로 삭제할 수 있습니다. 내장 모듈은 비활성화만 가능합니다.

### 활성/비활성

토글 스위치로 모듈을 켜고 끌 수 있습니다. 변경 후 코코포리아 탭을 새로고침해야 적용됩니다.

---

## 8. ID 규칙

| 구분 | 접두사 | 예시 |
|------|--------|------|
| 내장 모듈 | 없음 | `branch-world`, `triggers` |
| 사용자 모듈 | 자유 (내장과 충돌 불가) | `my-d6-combat`, `gm-toolkit` |
| 내장 트리거 | `_builtin_` | `_builtin_damage` |
| 사용자 트리거 | `usr_` | `usr_heal` |

모듈 ID는 **영문, 숫자, 하이픈(`-`), 밑줄(`_`)**만 사용할 수 있습니다.

---

## 9. 주의사항

1. **config.namespace가 `"combat"`인 모듈은 하나만 활성화**: 두 전투 모듈이 동시에 활성화되면 나중에 로드된 모듈이 이전 모듈의 설정을 덮어씁니다.

2. **트리거 ID 중복 주의**: 모듈 간 트리거 ID가 겹치면 예측 불가능한 동작이 발생할 수 있습니다. 고유한 접두사를 사용하세요.

3. **패턴 테스트**: 트리거 패턴은 코코포리아 채팅에서 실시간으로 매칭됩니다. 너무 넓은 패턴은 의도치 않은 트리거 발동을 유발할 수 있습니다.

4. **JSON 유효성**: 파일 가져오기 시 자동 검증됩니다. 필수 필드(`id`, `name`, `version`, `type`)가 누락되면 가져올 수 없습니다.

5. **저장소 제한**: 사용자 모듈은 `chrome.storage.local`에 저장되며 약 5MB까지 사용 가능합니다. 매우 큰 모듈은 여러 개로 분할하세요.

---

## 10. 향후 계획

- ~~`"type": "script"` 모듈 지원~~ → **v1.2.55에서 구현 완료**
- ~~모듈 의존성 (`dependencies`)~~ → **v1.2.55에서 구현 완료**
- **모듈 레지스트리**: 온라인 모듈 저장소에서 검색·설치

---

*이 가이드에 대한 질문이나 제안은 GitHub Issues에 남겨주세요.*
