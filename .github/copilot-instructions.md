# Copilot Instructions

## Core Principles

1. **Never delete/modify working code without asking**: Before removing or significantly changing existing working code, you MUST explicitly ask the user for confirmation. Say "Can I delete this code?" and wait for approval.

2. **Ask the user for help when you lack information**: If you need runtime information you cannot access directly (e.g., DOM structure, runtime state, API responses), provide the user with a specific, copy-pasteable diagnostic script and ask them to run it and share the results.

3. **Diagnose before guessing — always gather real runtime data**: When a fix doesn't work or DOM/state assumptions turn out wrong, do NOT keep guessing alternative approaches. Instead:
   - Immediately write a lightweight diagnostic script for the user to run in the browser console (F12).
   - Base subsequent fixes on the actual diagnostic output, not on assumed DOM structures.
   - This avoids multiple broken iterations and produces stable, performance-friendly code from verified data.
   - Record confirmed DOM structures in `COCOFOLIA_DATA_API.md` so future sessions don't re-investigate.

4. **Clarify ambiguous instructions before acting**: If the user's instructions are unclear or open to multiple interpretations, ask questions to confirm intent first. Never guess and proceed.

5. **Make incremental changes**: Do not perform large-scale refactoring in one step. Make small, verifiable changes so each step can be tested independently.

6. **Read current file state before editing**: Always read the latest file contents before modifying any file to understand the actual current state.

7. **Document discovered API/data structures**: When you discover internal APIs, data structures, DOM hierarchies, Redux state paths, Firestore schemas, or any other architectural information through diagnostics or investigation, record the findings in `COCOFOLIA_DATA_API.md` so they are preserved for future reference.

8. **Always verify before coding — consult DATA API doc and run diagnostics**: Before implementing any feature or fix that touches ccfolia's DOM, Redux state, or internal structures:
   - **First** check `COCOFOLIA_DATA_API.md` for existing documented structures.
   - If the doc lacks the needed info, write a diagnostic script for the user to run in the browser console.
   - **Never assume** DOM class names, element hierarchies, CSS property sources, or state paths without verification.
   - After confirming the structure, update `COCOFOLIA_DATA_API.md` with any new findings.
   - This prevents wasted iterations from wrong assumptions (e.g., assuming grid is on parent when it's on a child div).

## Project Info

- Chrome Extension MV3 ("가지세계 도우미" / Branch World Advice, for ccfolia.com TRPG)
- Content Scripts run in ISOLATED world (content/*.js)
- MAIN world access: redux-injector.js (communicates via CustomEvent between MAIN ↔ ISOLATED)
- Target site UI framework: MUI v5 + styled-components + React + Redux + Firebase (Firestore)

## Architecture

### World Separation (CRITICAL)

Chrome MV3 enforces strict JS context separation:

- **ISOLATED world**: All `content/*.js` files except `redux-injector.js`. Cannot access page's `window`, Redux store, or Firestore.
- **MAIN world**: Only `redux-injector.js` — injected via `<script>` tag from `content.js`. Has full access to Redux, Firestore, and page globals.

### Cross-World Communication (DOM Attribute Bridge)

**⚠️ `CustomEvent.detail` is UNRELIABLE in BOTH directions between ISOLATED ↔ MAIN worlds.** All cross-world data transfer MUST use DOM attributes on `document.documentElement`:

```js
// Sender (either world):
document.documentElement.setAttribute('data-bwbr-payload', JSON.stringify(data));
document.dispatchEvent(new CustomEvent('bwbr-event-name'));

// Receiver (other world):
document.addEventListener('bwbr-event-name', () => {
  const data = JSON.parse(document.documentElement.getAttribute('data-bwbr-payload'));
  document.documentElement.removeAttribute('data-bwbr-payload');
});
```

All event names use `bwbr-` prefix. Payloads use `data-bwbr-*` DOM attributes. This is the ONLY reliable cross-world communication mechanism — never use `event.detail`.

### Key Event Pairs (ISOLATED ↔ MAIN)

| Request Event | Response Event | Purpose |
|---|---|---|
| `bwbr-send-message-direct` | `bwbr-send-message-result` | Send chat/system message |
| `bwbr-request-characters` | `bwbr-characters-data` | Active character list |
| `bwbr-request-all-characters` | `bwbr-all-characters-data` | All characters (incl. hidden) |
| `bwbr-request-speaking-character` | `bwbr-speaking-character-data` | Currently speaking character |
| `bwbr-modify-status` | `bwbr-modify-status-result` | Change one character's stat |
| `bwbr-modify-status-all` | `bwbr-modify-status-all-result` | Change all characters' stat |
| `bwbr-request-cutins` | `bwbr-cutins-data` | Effects/cutins list |
| `bwbr-identify-character-by-image` | `bwbr-character-identified` | Identify char by image URL |
| `bwbr-switch-character` | — | Switch speaking character |
| `bwbr-get-char-stats` | `bwbr-char-stats-result` | Query specific character's stats |

### Silent Flag Pattern

When performing batch operations (e.g., resetting all combat stats), pass `silent: true` in the payload to suppress individual system messages. The caller then sends a single grouped message with all changes. This prevents chat spam during combat start/end/turn transitions.

### System Message Format

System messages use `〔 headerText 〕` format (NOT `《 》` which is reserved for chat triggers/patterns). Example: `〔 ⚔️ 전투 개시 〕`.

### Combat State Machine

```
IDLE → COMBAT_STARTED → ROUND_HEADER_SENT → WAITING_ATTACKER_RESULT
     → WAITING_DEFENDER_RESULT → PROCESSING_RESULT → (next round or COMBAT_END)
```

Additional states: `PAUSED`, `TURN_COMBAT` (turn-based mode), `SPECTATING` (observing another user's combat).

Combat stat deduction (주 행동🔺, 보조 행동🔹, etc.) is implemented directly in `content.js` `checkForCombatAssistTrigger()` — NOT in the trigger engine. This ensures guaranteed execution during combat regardless of trigger enabled state.

### Trigger System

- **trigger-engine.js**: Pattern matching (`《name》| {param}` → regex), action chains (message/cutin/stat/dice/face/scene/bgm/se/wait/log)
- **trigger-ui.js**: Modal dialog for managing triggers
- Default trigger parameters use Korean names: `{대상}`, `{스탯}`, `{수치}`, `{내용}`, `{장면이름}`, `{캐릭터}`, `{대사}`, `{_주사위}`
- Builtin triggers: `_builtin_*` IDs, user triggers: `usr_*` IDs

### ccfolia Data Model (Key Points)

- **Character faces**: `faces` is a URL string array — no face names exist in ccfolia
- **Character status**: `status[]` with `{label, value, max}`
- **Message detection**: Redux `store.subscribe()` (not DOM-based) — 100% reliable
- **System messages**: Sent directly to Firestore with `type: 'system'` (color field ignored)
- **Firestore SDK**: Extracted from webpack modules (`_FS_CONFIG` with module IDs)
- Detailed structures in `COCOFOLIA_DATA_API.md`

## File Guide

### Content Scripts (ISOLATED world, load order)

| File | Role |
|---|---|
| `site-volume.js` | Site volume control (runs at `document_start`) |
| `config-defaults.js` | `BWBR_DEFAULTS` — all default settings |
| `melee-engine.js` | Melee round engine (dice comparison, trait processing) |
| `combat-engine.js` | Combat state machine, turn/action management, message parsers |
| `chat-interface.js` | Chat detection (Redux subscribe), message sending, textarea interaction |
| `overlay.js` / `overlay.css` | Combat panel UI |
| `auto-complete.js` | Chat autocomplete (#character, !status, @cutin, brackets, commands) |
| `char-shortcut.js` | Alt+number character switching, context menus |
| `log-export-dialog.js` | Chat log export |
| `grid-overlay.js` | Board grid overlay |
| `combat-move.js` | Combat movement helpers |
| `room-copy.js` | Room copy functionality |
| `trigger-engine.js` | Pattern matching + action chain execution |
| `trigger-ui.js` | Trigger management modal UI |
| `combat-controller.js` | **전투 모듈** — 합/턴제/관전 전체 전투 로직 (`BWBR_CombatController`) |
| `content.js` | **Main controller** — 설정 로드, 채팅 감시, 트리거 분배, 로그 추출 |

### MAIN World

| File | Role |
|---|---|
| `redux-injector.js` | Redux store access, Firestore SDK, all cross-world event handlers |

### Other

| File | Role |
|---|---|
| `background.js` | Service worker (install/update, message routing, GitHub update check) |
| `popup/popup.{html,js,css}` | Settings popup (has own copy of DEFAULTS, can't import content scripts) |
| `home-display.js` | ccfolia home page enhancements |
| `room-save.js` | Room save functionality |
| `site-volume-page.js` | Page-context volume script (web_accessible_resource) |

### Reference Documents

| File | Purpose |
|---|---|
| `COCOFOLIA_DATA_API.md` | Reverse-engineered ccfolia internals (Redux, Firestore, DOM, webpack modules) |
| `HANDOFF.md` | Trigger system implementation status and data model |
| `README.md` | User-facing documentation with architecture section |

## Post-Implementation Testing Guidance

After every feature implementation, bug fix, or significant code change, you MUST provide the user with a concrete, step-by-step testing checklist. This checklist should:

1. **Cover the happy path**: Test that the new/changed feature works as intended under normal conditions.
2. **Cover edge cases and regressions**: Think about what could break — related features, boundary values, empty states, rapid repeated actions, etc.
3. **Include interaction tests**: If the change touches UI, specify exactly which elements to click, what input to type, and what the expected visual result should be.
4. **Include negative tests**: What should NOT happen. E.g., "Clicking X should NOT cause Y to lose focus."
5. **Be specific, not vague**: Instead of "test the trigger system", say "Open the trigger dialog → create a new trigger with pattern `《테스트》| {name}` → type `《테스트》| 홍길동` in chat → verify the system message appears with '홍길동'."
6. **Call out reload requirements**: If the extension needs to be reloaded (chrome://extensions → refresh), say so explicitly at the top.
7. **Prioritize by risk**: List the most likely-to-break items first.
8. **Group by feature area**: Use clear headers so the user can test incrementally.

Format the checklist in Korean (matching the user's language) with checkboxes (- [ ]) so the user can track progress.

## Git Convention

- **Commit messages MUST be written in Korean**: Format: version tag + Korean description. Example: `v1.2.3: 그리드 오버레이 개선, 전투 HP 복원 수정`
- Squash trivial changes into a single commit. Do not split commits unnecessarily.
