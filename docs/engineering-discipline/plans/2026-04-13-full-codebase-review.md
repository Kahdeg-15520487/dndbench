# Full Codebase Deep Review

> **Worker note:** This is a review plan — tasks are structured as **inspect-and-report** units. Each task examines a specific area, documents findings, and proposes fixes. No code changes are made until the user approves the findings. Each task outputs a structured findings document.

**Goal:** Conduct a comprehensive code quality and architecture review of the entire arena01 codebase (~9,470 LOC, 26 source files, 571 tests) and produce a prioritized list of issues with fix recommendations.

**Architecture:** Layered architecture — `engine/` (pure game mechanics) → `agent/` (AI decision-making) → `arena/` (orchestration, tournament, server, UI) → entry points (`index.ts` CLI, `server.ts` HTTP). No circular dependencies. Monolithic dashboard UI in a single HTML file.

**Tech Stack:** TypeScript (ESM), Vitest, Express, WebSocket, Canvas (battlefield rendering), gif-encoder-2, PostgreSQL (pg), chalk (CLI), marked (markdown), pi SDK (LLM agent), typebox (tool schemas).

**Work Scope:**
- **In scope:** All source files under `src/`, the dashboard HTML, test coverage gaps, architecture issues, dead code, inconsistent patterns, missing error handling, type safety, module boundaries
- **Out of scope:** External dependencies (don't review node_modules), deployment/DevOps (Docker), game design balance (gameplay tuning), documentation quality, performance optimization (unless critical)

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npx vitest run`
- **What it validates:** No regressions — review does not change code, but any fixes proposed must pass the existing 571+ tests

---

## File Structure Reference

```
src/
├── engine/           # Pure game mechanics — no I/O, no side effects
│   ├── types.ts      # 569 lines — 65 exports, central type system
│   ├── combat.ts     # 2,330 lines — combat resolution engine (LARGEST FILE)
│   ├── characters.ts # 424 lines — character creation, class presets
│   ├── dice.ts       # 187 lines — DiceRoller class
│   ├── bosses.ts     # 212 lines — boss monster profiles
│   └── index.ts      # 110 lines — barrel re-export
├── agent/            # AI decision-making
│   ├── interface.ts  # 68 lines — IAgent contract
│   ├── llm-agent.ts  # 997 lines — LLM agent with tool validation (NO TESTS)
│   ├── heuristic-agent.ts # 260 lines — rule-based AI
│   ├── boss-agent.ts # 289 lines — boss AI
│   ├── human-agent.ts # 97 lines — human input
│   └── index.ts      # 5 lines — barrel
├── arena/            # Battle orchestration and presentation
│   ├── battle-runner.ts    # 650 lines — main battle loop, event system
│   ├── tournament.ts       # 499 lines — round-robin tournament runner
│   ├── tournament-server.ts # 695 lines — Express HTTP + SSE server
│   ├── tournament-report.ts # 327 lines — markdown report generation
│   ├── replay.ts           # 441 lines — replay persistence, GIF rendering
│   ├── battlefield-renderer.ts # 274 lines — canvas visualization
│   ├── cli-renderer.ts     # 270 lines — terminal rendering
│   ├── ws-renderer.ts      # 190 lines — WebSocket broadcaster
│   ├── elo.ts              # 144 lines — ELO rating system
│   ├── report-viewer.ts    # 107 lines — markdown to HTML
│   └── dashboard.html      # 1,694 lines — monolithic SPA (inline CSS+JS)
├── db/               # Persistence
│   └── index.ts      # 376 lines — PostgreSQL CRUD
├── tools/            # LLM tool definitions
│   └── definitions.ts # 245 lines — tool schemas
├── types/
│   └── gif-encoder-2.d.ts # 13 lines — ambient declaration
├── __tests__/        # 15 test files, 571 tests
├── server.ts         # 745 lines — production server entry
└── index.ts          # 629 lines — CLI entry point
```

---

## Task Decomposition

All tasks are **inspect-and-report** — read code, document findings, propose fixes. No modifications. Each task produces findings in a structured format:

```
### [SEVERITY] Issue Title
- **File:** path:line-range
- **Category:** bug | dead-code | inconsistency | architecture | type-safety | error-handling | missing-test
- **Description:** What's wrong
- **Impact:** Why it matters
- **Proposed fix:** Exact change needed
```

Severity: 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low | ⚪ Info

---

### Task 1: Engine Types Review

**Dependencies:** None (can run in parallel)
**Files to review:** `src/engine/types.ts` (569 lines)

- [ ] **Step 1: Review type completeness and consistency**
  - Check all exported types have JSDoc or are self-documenting
  - Verify no `any` types, no unnecessary type assertions
  - Check for duplicate or overlapping type definitions
  - Verify all enums are exhaustive where used

- [ ] **Step 2: Review utility functions**
  - Check `abilityModifier`, `hasSpellSlot`, `consumeSpellSlot`, `remainingSlots`, `totalRemainingSlots`, `formatSpellSlots`
  - Check `autoArenaPreset`, `defaultStartPositions`, `generateStartPositions`
  - Check `maxMovePerTurn`, `distance`, `moveToward`, `getCoverBonus`
  - Verify edge cases: negative modifiers, zero values, out-of-range inputs
  - Check for unused exports (functions/types never imported elsewhere)

- [ ] **Step 3: Review constants and presets**
  - Check `ARENA_PRESETS` completeness
  - Verify `ARENA_DEFAULT` values are sensible
  - Check for magic numbers that should be named constants

- [ ] **Step 4: Document findings**

Produce structured findings list with severity ratings.

---

### Task 2: Combat Engine Review

**Dependencies:** None (can run in parallel)
**Files to review:** `src/engine/combat.ts` (2,330 lines — the largest file)

- [ ] **Step 1: Map all exported functions and their call graph**
  - List all 29 exported functions
  - Map which functions call which other functions
  - Identify dead exports (functions never called outside tests)

- [ ] **Step 2: Review `resolveAction` — the main dispatch**
  - Check all action types are handled (attack, cast_spell, use_item, dash, defend, wait, grapple, shove, class_ability)
  - Verify each branch returns a `CombatResult` with consistent shape
  - Check that `badAction` is set in ALL error/failure paths (13 flagged locations)
  - Verify `timedOut` handling at top of function

- [ ] **Step 3: Review spell resolution**
  - Check all spell categories: attack-roll spells, save-based spells, control spells, healing, buffs
  - Verify saving throw logic (advantage/disadvantage, modifiers, DC calculation)
  - Check concentration mechanics
  - Verify spell slot consumption is consistent

- [ ] **Step 4: Review damage resolution**
  - Check `DamageResult` construction — all fields populated consistently?
  - Verify crit doubling logic
  - Check damage type resistance/vulnerability application
  - Verify temporary HP handling

- [ ] **Step 5: Review status effects system**
  - Check `processStatusEffects` for all status types
  - Verify duration tracking, stacking rules, removal conditions
  - Check interaction between status effects (e.g., paralyzed + poison)
  - Verify new `decay` status effect (sudden death)

- [ ] **Step 6: Review reaction system**
  - Check opportunity attack triggers and resolution
  - Verify shield reaction, uncanny dodge
  - Check reaction availability tracking (once per round)

- [ ] **Step 7: Check for code duplication**
  - The file is 2,330 lines — identify repeated patterns that should be extracted
  - Check for similar attack-roll/save-throw blocks that could share logic
  - Check for repeated narrative string construction

- [ ] **Step 8: Document findings**

Produce structured findings list with severity ratings.

---

### Task 3: Agent Layer Review

**Dependencies:** None (can run in parallel)
**Files to review:**
- `src/agent/interface.ts` (68 lines)
- `src/agent/llm-agent.ts` (997 lines — NO dedicated tests)
- `src/agent/heuristic-agent.ts` (260 lines)
- `src/agent/boss-agent.ts` (289 lines)
- `src/agent/human-agent.ts` (97 lines)

- [ ] **Step 1: Review IAgent interface contract**
  - Check method signatures match all implementations
  - Verify `chooseAction` return type covers all cases
  - Check for interface bloat or missing methods

- [ ] **Step 2: Review LLM agent tool validation**
  - Check all 16 tools have validation (per summary: cast_spell validates spell exists + cooldown; use_item validates item exists + quantity; etc.)
  - Verify `toolError()` helper returns consistent shape
  - Verify `resolveTargetOrError()` discriminated union typing
  - Check loop detection: 3 consecutive identical tool+params → abort
  - Verify `isError: true` on all error paths

- [ ] **Step 3: Review LLM agent session management**
  - Check `TURN_TIMEOUT_MS` handling and abort flow
  - Verify conversation history management (token limits, context window)
  - Check for resource leaks (unclosed sessions, dangling promises)
  - Verify error handling in LLM API calls

- [ ] **Step 4: Review heuristic agent**
  - Check priority stack logic (self-heal → potions → control → damage → cantrips → attack)
  - Verify target selection (70% lowest-HP, 30% random)
  - Check movement logic (auto-move toward target)
  - Verify spell slot management and potion usage

- [ ] **Step 5: Review boss agent**
  - Check boss-specific behavior patterns
  - Verify phase transitions (if any)
  - Check legendary action handling

- [ ] **Step 6: Identify test gaps**
  - `llm-agent.ts` has 997 lines and ZERO dedicated test files
  - Check what's tested indirectly via `tournament-server.test.ts` vs what's untested
  - List critical untested paths (tool validation, loop detection, timeout handling)

- [ ] **Step 7: Document findings**

Produce structured findings list with severity ratings.

---

### Task 4: Arena Orchestration Review

**Dependencies:** None (can run in parallel)
**Files to review:**
- `src/arena/battle-runner.ts` (650 lines)
- `src/arena/tournament.ts` (499 lines)
- `src/arena/tournament-server.ts` (695 lines)

- [ ] **Step 1: Review BattleRunner event system**
  - Check `BattleEvent` type union — are all event types documented and handled?
  - Verify `turn_start`, `action_chosen`, `action_result`, `death_save`, `battle_end` emission
  - Check the new `move` event emission
  - Verify event handler registration and cleanup (memory leak potential)

- [ ] **Step 2: Review BattleRunner turn lifecycle**
  - Check `executeTurn()` flow: death saves → turn order → each character acts
  - Verify sudden-death decay application (`turnNumber >= maxTurns`)
  - Check for edge cases: both characters die simultaneously, draw conditions
  - Verify `_decayApplied` flag prevents re-application

- [ ] **Step 3: Review TournamentRunner**
  - Check `runGame()` event handler — the new `emitTurn()` helper
  - Verify round-based turn numbering (from `turn_start` instead of incrementing counter)
  - Check action type classification logic (action, move, reaction, bonus_action, status, death_save)
  - Verify `turnLog` construction includes move entries and `actionType`

- [ ] **Step 4: Review tournament server**
  - Check all API endpoints (`/api/tournament/status`, `/api/game/:mi/:gi`, `/api/export/json`, `/api/export/csv`, `/api/reports/:runDir/game/:mi/:gi`)
  - Verify `loadResultFromDisk()` fallback when `currentResult` is null
  - Check `statsA`/`statsB` in status response (recent fix)
  - Verify SSE event forwarding includes `actionType` field
  - Check for unhandled promise rejections in async route handlers

- [ ] **Step 5: Check for race conditions**
  - Tournament state mutation during concurrent SSE connections
  - Server restart recovery (from disk)
  - Multiple tournament starts without stopping the previous one

- [ ] **Step 6: Document findings**

Produce structured findings list with severity ratings.

---

### Task 5: Arena Presentation Layer Review

**Dependencies:** None (can run in parallel)
**Files to review:**
- `src/arena/dashboard.html` (1,694 lines — monolithic SPA)
- `src/arena/elo.ts` (144 lines)
- `src/arena/tournament-report.ts` (327 lines)
- `src/arena/replay.ts` (441 lines)
- `src/arena/battlefield-renderer.ts` (274 lines)
- `src/arena/cli-renderer.ts` (270 lines)
- `src/arena/ws-renderer.ts` (190 lines)
- `src/arena/report-viewer.ts` (107 lines)

- [ ] **Step 1: Review dashboard.html — the monolith**
  - Map the inline JS: how many functions, global variables, event listeners
  - Check for XSS vectors (innerHTML with unescaped user data, narrative text from LLM output)
  - Check for memory leaks (SSE connection cleanup, event listener cleanup on tab switch)
  - Verify `gameBadActions()` null-safety (recent fix)
  - Check `actionTypeTag()` rendering
  - Identify candidates for extraction into separate JS modules

- [ ] **Step 2: Review ELO system**
  - Verify ELO calculation math (K-factor, expected score, new rating)
  - Check `isBadAction()` — marked as `@deprecated` but still exported
  - Verify rating persistence across restarts (`ratings.json`)
  - Check for rating manipulation edge cases (same model playing itself, 0 games)

- [ ] **Step 3: Review tournament report generation**
  - Check markdown generation completeness
  - Verify `saveTournamentReport()` writes both markdown and JSON
  - Check for file system error handling (permissions, disk full, concurrent writes)

- [ ] **Step 4: Review replay system**
  - Check replay serialization/deserialization
  - Verify GIF rendering (canvas + gif-encoder-2)
  - Check for large replay handling (memory limits)

- [ ] **Step 5: Review renderers**
  - Check CLI renderer output formatting
  - Verify WebSocket renderer event forwarding
  - Check battlefield renderer coordinate system

- [ ] **Step 6: Document findings**

Produce structured findings list with severity ratings.

---

### Task 6: Entry Points & Infrastructure Review

**Dependencies:** None (can run in parallel)
**Files to review:**
- `src/index.ts` (629 lines — CLI entry, NO tests)
- `src/server.ts` (745 lines — production server, tested indirectly)
- `src/db/index.ts` (376 lines — PostgreSQL CRUD)
- `src/tools/definitions.ts` (245 lines — LLM tool schemas)

- [ ] **Step 1: Review CLI entry point (`index.ts`)**
  - Check argument parsing completeness and error messages
  - Verify all CLI flags work (`--tournament-heuristic`, etc.)
  - Check for unhandled rejections in the main flow
  - Identify dead code paths (unreachable branches)

- [ ] **Step 2: Review production server (`server.ts`)**
  - Check Express middleware configuration (CORS, body parsing, error handling)
  - Verify WebSocket upgrade handling
  - Check for missing authentication/authorization (if needed)
  - Verify graceful shutdown

- [ ] **Step 3: Review database layer (`db/index.ts`)**
  - Check SQL injection prevention (parameterized queries?)
  - Verify connection pool management
  - Check error handling for connection failures
  - Verify schema migration strategy

- [ ] **Step 4: Review tool definitions (`tools/definitions.ts`)**
  - Check schema completeness (all 16 tools)
  - Verify typebox schemas match runtime validation in `llm-agent.ts`
  - Check for schema drift between definitions and validation

- [ ] **Step 5: Document findings**

Produce structured findings list with severity ratings.

---

### Task 7: Test Coverage & Quality Review

**Dependencies:** None (can run in parallel)
**Files to review:** All 15 files in `src/__tests__/`

- [ ] **Step 1: Map test coverage gaps**
  - Run `npx vitest run` and note the test count (currently 571+)
  - For each source file, identify what percentage of exports have test coverage
  - **Critical gaps to flag:**
    - `llm-agent.ts` (997 lines, 0 dedicated tests)
    - `index.ts` (629 lines, 0 tests)
    - `server.ts` (745 lines, only indirect tests)
    - `dashboard.html` (1,694 lines, 0 tests — manual testing only)

- [ ] **Step 2: Review test quality**
  - Check for flaky tests (random-dependent tests without seeded dice)
  - Check for tests that assert too little (only "no error thrown")
  - Check for tests with hardcoded values that should be computed
  - Verify mock/stub usage is appropriate

- [ ] **Step 3: Review test isolation**
  - Check for shared mutable state between tests
  - Verify `beforeEach`/`afterEach` cleanup
  - Check for test ordering dependencies (test B depends on test A's side effects)

- [ ] **Step 4: Review test naming and organization**
  - Check test descriptions are clear and follow consistent naming
  - Verify test file organization mirrors source structure

- [ ] **Step 5: Document findings**

Produce structured findings list with severity ratings.

---

### Task 8 (Final): Synthesis — Prioritized Issue List

**Dependencies:** All preceding tasks (Tasks 1–7)
**Files:** None (reads all finding documents produced by Tasks 1–7)

- [ ] **Step 1: Aggregate all findings**
  - Collect all findings from Tasks 1–7
  - Deduplicate overlapping issues found by multiple reviewers
  - Categorize by: bugs, dead code, architecture, type safety, error handling, test gaps, security

- [ ] **Step 2: Prioritize by severity and impact**
  - 🔴 Critical: Bugs that produce wrong results, security vulnerabilities, data loss
  - 🟠 High: Architecture issues that block future development, missing error handling
  - 🟡 Medium: Dead code, inconsistent patterns, test gaps
  - 🔵 Low: Style issues, minor refactoring opportunities
  - ⚪ Info: Observations worth noting but no action needed

- [ ] **Step 3: Propose fix batches**
  - Group related issues into fix batches that can be implemented together
  - Estimate effort per batch (small/medium/large)
  - Identify dependencies between batches

- [ ] **Step 4: Write final review document**

Save to: `docs/engineering-discipline/reviews/2026-04-13-full-codebase-review.md`

Format:
```markdown
# Arena01 Full Codebase Review — 2026-04-13

## Summary
[2-3 paragraph overview of codebase health]

## Critical Issues (🔴)
### C1. [Title]
- **Files:** ...
- **Description:** ...
- **Impact:** ...
- **Fix:** ...

## High Issues (🟠)
...

## Medium Issues (🟡)
...

## Low Issues (🔵)
...

## Info (⚪)
...

## Recommended Fix Batches
### Batch 1: [Name] (Small effort)
- Fix C1, H1, H2

### Batch 2: [Name] (Medium effort)
- Fix H3, M1, M2

## Test Coverage Gap Summary
| File | Lines | Tests | Coverage |
|------|-------|-------|----------|
| ... | ... | ... | ... |
```

---

## Self-Review

- [x] **Spec coverage:** Every source file and every layer is covered by a task
- [x] **No placeholders:** Every step has concrete instructions for what to examine
- [x] **No file conflicts:** All tasks are read-only (review only), no parallel conflicts possible
- [x] **Dependency chains:** Tasks 1–7 are independent, Task 8 depends on all of 1–7
- [x] **Verification strategy:** `npx vitest run` — review doesn't change code, but any fixes must pass
- [x] **Final verification task:** Task 8 synthesizes findings into a prioritized document
- [x] **File paths:** All file paths are exact and include line counts
- [x] **Worker-viable:** Each task can be executed by an independent worker with no additional context
