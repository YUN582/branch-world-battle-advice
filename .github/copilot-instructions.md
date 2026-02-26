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

## Git Convention

- **커밋 메시지는 반드시 한국어로 작성**: 버전 태그 + 한국어 설명 형식. 예: `v1.2.3: 그리드 오버레이 개선, 전투 HP 복원 수정`
- 사소한 변경은 하나의 커밋으로 합치고, 불필요한 커밋 분리 금지
