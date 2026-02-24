# Copilot Instructions

## Core Principles

1. **Never delete/modify working code without asking**: Before removing or significantly changing existing working code, you MUST explicitly ask the user for confirmation. Say "Can I delete this code?" and wait for approval.

2. **Ask the user for help when you lack information**: If you need runtime information you cannot access directly (e.g., DOM structure, runtime state, API responses), provide the user with a specific, copy-pasteable diagnostic script and ask them to run it and share the results.

3. **Clarify ambiguous instructions before acting**: If the user's instructions are unclear or open to multiple interpretations, ask questions to confirm intent first. Never guess and proceed.

4. **Make incremental changes**: Do not perform large-scale refactoring in one step. Make small, verifiable changes so each step can be tested independently.

5. **Read current file state before editing**: Always read the latest file contents before modifying any file to understand the actual current state.

6. **Document discovered API/data structures**: When you discover internal APIs, data structures, DOM hierarchies, Redux state paths, Firestore schemas, or any other architectural information through diagnostics or investigation, record the findings in `COCOFOLIA_DATA_API.md` so they are preserved for future reference.

## Project Info

- Chrome Extension MV3 ("가지세계 도우미" / Branch World Advice, for ccfolia.com TRPG)
- Content Scripts run in ISOLATED world (content/*.js)
- MAIN world access: redux-injector.js (communicates via CustomEvent between MAIN ↔ ISOLATED)
- Target site UI framework: MUI v5 + styled-components + React + Redux + Firebase (Firestore)
