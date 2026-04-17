# UI/UX Full Audit — Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Produce a structured findings document covering UX issues, inconsistencies, missing feedback, accessibility gaps, edge cases, error states, loading states, and mobile responsiveness across all 3 UI surfaces (Vue SPA, Tournament Dashboard, CLI Renderer).

**Architecture:** Read-only audit. Each task reads source files, exercises the UI mentally (or via browser if applicable), and writes findings into a single structured markdown document. Tasks are parallelized by UI surface.

**Tech Stack:** Vue 3 SPA (SetupScreen.vue, BattleView.vue, App.vue, style.css), Tournament Dashboard (dashboard.html — self-contained SPA, 1694 lines), CLI Renderer (cli-renderer.ts — chalk terminal output)

**Work Scope:**
- **In scope:** All 3 UI surfaces — information architecture, flow consistency, feedback loops, accessibility (a11y), edge cases, error states, loading states, mobile responsiveness, terminology consistency, visual design issues, interaction patterns
- **Out of scope:** Backend logic correctness, game balance, performance optimization, code quality (lint), test coverage. No code changes.

**Verification Strategy:**
- **Level:** build-only (no tests for an audit document)
- **Command:** `cat docs/ui-ux-audit-findings.md` — verify file exists and has all 3 sections
- **What it validates:** The findings document is complete and structured

---

## File Structure Mapping

| File | Action | Responsibility |
|------|--------|---------------|
| `docs/ui-ux-audit-findings.md` | Create | Single findings document — all audit output goes here |

---

## Task 1: Audit — Vue 3 SPA (Web Game Server)

**Dependencies:** None (can run in parallel)
**Files:**
- Read: `web/src/App.vue`, `web/src/components/SetupScreen.vue`, `web/src/components/BattleView.vue`, `web/src/style.css`, `web/index.html`, `web/vite.config.ts`, `src/server.ts` (WebSocket protocol)
- Create: `docs/ui-ux-audit-findings.md` (initialize with Vue SPA section)

- [ ] **Step 1: Read all Vue SPA source files**

Read these files in full:
- `web/src/App.vue` — root component, WebSocket management, state machine
- `web/src/components/SetupScreen.vue` — battle setup UI
- `web/src/components/BattleView.vue` — live battle UI
- `web/src/style.css` — global styles, CSS variables, animations
- `web/index.html` — HTML shell
- `src/server.ts` — understand what messages the server sends (the contract the UI must handle)

- [ ] **Step 2: Audit SetupScreen.vue — Setup Flow**

Evaluate each of these dimensions and write findings:

**Information Architecture:**
- Is the page purpose clear on load?
- Is the form flow logical? (name → class → mode → config → start)
- Are progressive disclosure patterns used well? (LLM config hidden until LLM mode selected)

**Form UX:**
- Is default state sensible? (name="Hero", class=warrior, mode=mock)
- Are validation errors clear and inline? (check `configFormError`)
- Is the "canStart" computed logic correct — does it prevent invalid starts?
- Is there feedback when LLM configs fail to load? (currently silently swallowed)
- Is the LLM config CRUD flow complete? (create, select, delete — no edit?)

**Scenario Builder:**
- Are presets intuitive? Can the user understand what each preset does before selecting?
- Is the participant list usable with >4 units? (max-height 200px with scroll)
- Is team assignment clear? (auto-assigns a/b/c/d — is this discoverable?)
- Can the user accidentally start with invalid config? (e.g., all same team)
- Is the arena selector's "Auto" behavior documented?

**Visual Design:**
- Is the class card grid readable on mobile? (2-column grid, min 520px card)
- Are the category/mode toggle buttons distinguishable? (rely on `.active` class only)
- Is the start button clearly the primary CTA?

**Missing States:**
- What happens if WebSocket disconnects during setup? (no reconnect logic, no error shown)
- What happens if server is down when user clicks Start? (message sent into void)
- Is there any loading state while LLM configs fetch?

- [ ] **Step 3: Audit BattleView.vue — Battle Flow**

**Information Architecture:**
- Is the layout hierarchy clear? (header → battlefield → status → chat → actions)
- Can the user quickly understand whose turn it is?
- Is the battlefield canvas useful or cluttered?

**Status Display:**
- Are HP bars accurate and readable? (check `hpPct`, color transitions)
- Are spell slots displayed clearly? (check `formatSlots` — "1st:4 2nd:3 3rd:2")
- Are status effects visible and understandable? (emoji-only in N-unit mode vs emoji+label in 1v1)
- Is there an inconsistency between N-unit status display (emoji only) and 1v1 display (emoji + turns remaining)?

**Action Panel:**
- Are disabled states clear when it's not the player's turn?
- Is the spell/item sub-panel navigation intuitive? (Back button → grid)
- Are spell names meaningful without descriptions? (just button text, no tooltip)
- Is there feedback when an action is invalid server-side? (no `badAction` handling visible)
- Is there a "Dash" action in the UI? (engine supports it, UI doesn't expose it)
- Is there a "Grapple" or "Shove" action? (engine supports both, UI doesn't expose them)
- Is target selection possible? (currently auto-targets "self" or "enemy" — no multi-target scenarios)

**Chat / Narrative:**
- Is the chat auto-scroll working? (check `watch` on `messages.length`)
- Are message types visually distinct? (check `.msg-player`, `.msg-enemy`, `.msg-status`, etc.)
- Is the enemy thinking panel useful? (shows tool calls — is this understandable to non-technical users?)
- Are long narratives readable? (no max-width on chat in N-unit mode potentially)

**Boss Exam Flow:**
- Is the transition between boss fights clear? (2-second delay, scorecard shown)
- Is the final scorecard readable? (grade display, per-boss results)
- Can the user see their character's HP reset between fights?

**End State:**
- Is the win/lose/draw display clear?
- Is "Play Again" the only option? (no replay review, no share)

**Missing States:**
- What happens on WebSocket disconnect mid-battle? (no reconnect, no error)
- What happens if server crashes mid-battle? (WebSocket closes, phase stays "battle")
- Is there a timeout if the player never acts? (no client-side turn timer)
- What happens if the player refreshes mid-battle? (state lost, returns to setup)

- [ ] **Step 4: Audit App.vue — State Management & WebSocket**

**State Machine:**
- Are all phase transitions handled? (`setup` → `battle` → `ended`, `setup` → `boss_exam` → `ended`)
- Is `resetGame()` thorough? Does it reset all refs?
- Is there a race condition if messages arrive after reset?
- Is the backward-compat code for `playerId`/`enemyId` still needed?

**WebSocket:**
- Is reconnection handled? (no — `onclose` just sets `connected.value = false`)
- Is there error handling for malformed server messages? (`JSON.parse` in `onmessage` is unwrapped)
- Are all server message types handled? (compare `handleServerMessage` switch cases against server.ts `send()` calls)
- Is there a heartbeat/ping mechanism?

**Props Drilling:**
- Count props passed to BattleView — is this manageable? (currently ~20 props)
- Would a provide/inject or pinia store be more appropriate?

- [ ] **Step 5: Audit style.css — Visual System & Accessibility**

**CSS Variables:**
- Are all colors meeting WCAG AA contrast ratios against `--bg: #0d0d1a`?
- Is `--text-dim: #7a7a9a` readable? (contrast against #0d0d1a is ~3.8:1 — fails AA for normal text)
- Are the action button colors distinguishable for color-blind users? (red attack, blue defend, purple spell, amber item — all different hues, OK)

**Typography:**
- Is minimum font size 12px? (class-desc is 11px, class-stats is 10px, bar-label in BattleView is 10px — may be too small)
- Is line-height sufficient? (1.5 on body, 1.4 on thinking steps)

**Responsive Design:**
- Is the layout usable on mobile (< 400px width)?
- SetupScreen: max-width 520px, padding 20px — does it fit on 320px screens?
- BattleView: max-width 600px — does the battlefield canvas scale?
- Are touch targets large enough? (action buttons have padding 10px 8px — ~44px height, OK)

**Animations:**
- Are animations respecting `prefers-reduced-motion`? (no `@media (prefers-reduced-motion: reduce)` found)
- Is the `pulse-glow` animation on `.your-turn-glow` distracting?

**Focus Management:**
- Is there visible focus indication? (no `:focus-visible` styles)
- Is keyboard navigation possible through the setup form? (default browser behavior only)
- Can the battle actions be activated via keyboard? (buttons are focusable, OK)

**ARIA:**
- Are there any ARIA labels? (none found)
- Are status changes announced to screen readers? (HP changes, turn changes, battle end)
- Is the battlefield canvas accessible? (no fallback text)

- [ ] **Step 6: Write Vue SPA findings to document**

Create `docs/ui-ux-audit-findings.md` with the following structure:

```markdown
# UI/UX Audit Findings

> Generated: [date]
> Scope: Full UX audit — Vue 3 SPA, Tournament Dashboard, CLI Renderer

---

## 1. Vue 3 SPA (Web Game Server)

### 1.1 Setup Screen
[Findings table with columns: # | Severity (Critical/Major/Minor/Info) | Category | Finding | Recommendation]

### 1.2 Battle View
[Findings table]

### 1.3 State Management & WebSocket
[Findings table]

### 1.4 Visual System & Accessibility
[Findings table]

### 1.5 Missing Features / Gaps
[Findings table]
```

Severity scale:
- **Critical** — Broken flow, data loss, user stuck
- **Major** — Significant confusion, missing feedback for important actions
- **Minor** — Cosmetic, slight confusion, could be improved
- **Info** — Observation, future consideration

---

## Task 2: Audit — Tournament Dashboard (Self-Contained HTML SPA)

**Dependencies:** None (can run in parallel with Task 1)
**Files:**
- Read: `src/arena/dashboard.html` (full 1694 lines)
- Read: `src/arena/tournament-server.ts` (REST API contract)
- Create: `docs/ui-ux-audit-findings-tournament.md` (standalone section — merged in Task 4)

- [ ] **Step 1: Read the tournament dashboard HTML**

Read `src/arena/dashboard.html` in full. This is a self-contained SPA with inline CSS and JS (~1694 lines). Pay attention to:
- The three-tab structure (Setup, Live, Reports)
- CSS custom properties (light/dark theme)
- All JavaScript functions and event handlers
- SSE event handling
- Chart rendering (canvas-based ELO sparkline)
- Export functionality (JSON/CSV)
- Comparison mode
- Tournament history

Also read `src/arena/tournament-server.ts` to understand the REST API contract and SSE event types.

- [ ] **Step 2: Audit Setup Tab**

**Model Discovery & Selection:**
- Is the LLM endpoint health check visible? (API call to `/api/health`)
- Is model auto-discovery clear? (API call to `/api/models`)
- Is the heuristic baseline inclusion clear? (checkbox or always included?)
- Can the user select/deselect models easily?
- Is there validation for minimum model count?

**Configuration:**
- Are best-of-N, max turns, K-factor explained to the user?
- Are config presets (Quick/Standard/Marathon) clear about what they change?
- Is the shareable URL feature discoverable?

**ELO Ratings Display:**
- Are persisted ratings from `ratings.json` shown?
- Is the ELO history meaningful to users unfamiliar with ELO?

**Start Flow:**
- Is the start button prominent?
- Is there a confirmation before starting a long tournament?
- Is there feedback while the tournament is initializing?

- [ ] **Step 3: Audit Live Tab**

**Real-time Updates:**
- Is the SSE connection status visible? (connected/disconnected/reconnecting)
- Are battle narratives readable as they stream in?
- Are HP bars updating in real-time?
- Is the current matchup clearly displayed?

**ELO Table:**
- Is the ranking table sortable?
- Are ELO changes (±) visible per game?
- Is the sparkline chart readable?

**Matchup Bracket:**
- Is progress through the round-robin clear?
- Can the user see which matchups are complete vs pending?
- Is there an ETA or progress percentage?

**Thinking Visualization:**
- Are LLM thinking steps shown? (tool calls, observations)
- Is this useful or cluttering?

**Abort/Control:**
- Is the abort button accessible?
- Is there confirmation before aborting?
- Can the user retry individual matchups?

**Missing States:**
- What happens on SSE disconnect? (auto-reconnect? error state?)
- What happens if the server crashes mid-tournament? (state lost?)
- Is there a way to resume a tournament?

- [ ] **Step 4: Audit Reports Tab**

**ELO Rankings:**
- Is the final ranking clear?
- Are ELO changes from the tournament shown?
- Is there context for what ELO means?

**Matchup Matrix:**
- Is the head-to-head matrix readable? (color-coded cells)
- Are win/loss counts clear per cell?
- Is it usable with many models (>8)?

**Class Breakdown:**
- Is per-class performance shown?
- Is this actionable for the user?

**Game Replays:**
- Can the user review individual games?
- Are HP bars shown per turn?
- Is dice roll data visible? (attack rolls, saves, crits)

**Export:**
- Is JSON export useful? (what's in it?)
- Is CSV export useful? (what columns?)
- Is there a way to share results?

**History:**
- Can the user compare across tournaments?
- Is the comparison mode clear?
- Is history persistence reliable? (file-based `history.json`)

- [ ] **Step 5: Audit Visual Design & Accessibility**

**Theme:**
- Does the light theme work? (CSS variables defined, `data-theme="light"` attribute)
- Is the theme toggle discoverable? (check for theme switcher button)
- Are all elements styled correctly in both themes?

**Responsive Design:**
- Does the setup grid (2-column) collapse on mobile?
- Does the matchup matrix scale?
- Is the live tab usable on narrow screens?
- Are touch targets adequate?

**Typography:**
- Is font size consistent? (body 14px baseline?)
- Are monospace elements readable?

**Accessibility:**
- Are there ARIA labels on interactive elements?
- Is keyboard navigation possible? (tabs, buttons, forms)
- Are color-blind users able to distinguish win/loss in the matrix?
- Is the canvas sparkline chart accessible?

**Performance:**
- Does the page lag with many SSE events? (DOM manipulation patterns)
- Is there virtual scrolling for long battle narratives?

- [ ] **Step 6: Write Tournament Dashboard findings**

Create `docs/ui-ux-audit-findings-tournament.md`:

```markdown
# Tournament Dashboard (Self-Contained HTML SPA) — Audit Findings

### 2.1 Setup Tab
[Findings table]

### 2.2 Live Tab
[Findings table]

### 2.3 Reports Tab
[Findings table]

### 2.4 Visual Design & Accessibility
[Findings table]

### 2.5 Missing Features / Gaps
[Findings table]
```

---

## Task 3: Audit — CLI Renderer (Terminal Output)

**Dependencies:** None (can run in parallel with Tasks 1 and 2)
**Files:**
- Read: `src/arena/cli-renderer.ts`
- Read: `src/index.ts` (CLI entry point, argument parsing)
- Read: `src/engine/types.ts` (arena presets, to understand battlefield display)
- Create: `docs/ui-ux-audit-findings-cli.md` (standalone section — merged in Task 4)

- [ ] **Step 1: Read CLI source files**

Read:
- `src/arena/cli-renderer.ts` — terminal rendering logic
- `src/index.ts` — CLI argument parsing and flow
- `src/engine/types.ts` — arena dimensions, character positions

- [ ] **Step 2: Audit CLI Argument Parsing & Entry Flow**

**Argument UX:**
- Are CLI arguments documented? (is there a `--help` flag?)
- Are defaults sensible?
- Is error messaging clear for invalid arguments?
- Is the participant spec format (`"Name,Role,Team,AgentType,Model"`) documented?
- Are there examples in help output?

**Startup Flow:**
- Is there feedback during initialization? (connecting to DB, loading models)
- Is there a clear "battle starting" message?
- Are the participating characters displayed before battle begins?

- [ ] **Step 3: Audit Battle Output**

**Turn-by-Turn Narrative:**
- Is each turn clearly delineated?
- Are character names and actions distinguishable?
- Is the output readable when many characters are in play? (scenario mode)
- Are dice rolls shown? (attack rolls, damage rolls, saving throws)
- Are critical hits/misses called out visually?

**Battlefield Display:**
- Is the ASCII/unicode battlefield readable?
- Does it scale for different arena sizes?
- Are character positions clear?
- Is it updated each turn or only on move?

**Status Information:**
- Are HP changes visible?
- Are status effects displayed?
- Are death saves shown?
- Is spell slot consumption visible?

**End State:**
- Is the winner clearly announced?
- Is a summary shown? (total turns, final HP, etc.)
- Is the replay save location mentioned?

**Color Usage (chalk):**
- Is color used consistently? (same color for same entity across turns)
- Is the output readable without color? (stripped ANSI codes)
- Are there too many colors? (readability on light/dark terminals)

- [ ] **Step 4: Audit Edge Cases & Error Handling**

- What happens if the terminal is very narrow? (< 80 columns)
- What happens if battle exceeds max turns?
- What happens if LLM API times out mid-battle?
- What happens if DB connection fails?
- Is there a graceful Ctrl+C handling?

- [ ] **Step 5: Write CLI findings**

Create `docs/ui-ux-audit-findings-cli.md`:

```markdown
# CLI Renderer (Terminal Output) — Audit Findings

### 3.1 Argument Parsing & Entry Flow
[Findings table]

### 3.2 Battle Output
[Findings table]

### 3.3 Edge Cases & Error Handling
[Findings table]

### 3.4 Missing Features / Gaps
[Findings table]
```

---

## Task 4: Cross-Surface Consistency Analysis

**Dependencies:** Tasks 1, 2, and 3 must all complete
**Files:**
- Read: `docs/ui-ux-audit-findings.md` (sections written by Tasks 1–3)
- Modify: `docs/ui-ux-audit-findings.md` (append cross-surface section)

- [ ] **Step 0: Merge findings from Tasks 1–3 into single document**

Read:
- `docs/ui-ux-audit-findings.md` (Vue SPA section from Task 1)
- `docs/ui-ux-audit-findings-tournament.md` (Tournament section from Task 2)
- `docs/ui-ux-audit-findings-cli.md` (CLI section from Task 3)

Create the final merged `docs/ui-ux-audit-findings.md` with all sections combined:

```markdown
# UI/UX Audit Findings

> Generated: [date]
> Scope: Full UX audit — Vue 3 SPA, Tournament Dashboard, CLI Renderer

---

## 1. Vue 3 SPA (Web Game Server)
[paste from Task 1 output]

---

## 2. Tournament Dashboard (Self-Contained HTML SPA)
[paste from Task 2 output]

---

## 3. CLI Renderer (Terminal Output)
[paste from Task 3 output]

---

## 4. Cross-Surface Consistency
[populated in steps below]

---

## 5. Summary
[populated after all analysis]
```

Delete the temporary files after merging.

- [ ] **Step 1: Compare terminology across surfaces**

Check these terms for consistency:
- "battle" vs "fight" vs "game" vs "matchup" — are they used consistently?
- "mock" vs "heuristic" vs "AI" — does each surface use the same term for the non-LLM agent?
- Class names — identical across all surfaces?
- Boss names — identical across all surfaces?
- Status effect names — identical across all surfaces?
- Spell names — identical across all surfaces?
- ELO terminology — "rating", "score", "rank" — consistent?

- [ ] **Step 2: Compare data exposed across surfaces**

What information does each surface show that the others don't?
- Vue SPA shows: character positions, battlefield canvas, real-time HP
- Tournament Dashboard shows: ELO rankings, matchup matrix, class breakdown, dice roll data
- CLI shows: dice rolls, ASCII battlefield, turn-by-turn narrative

Are there gaps where useful data is available but not shown?

- [ ] **Step 3: Compare visual design language**

- Color schemes: Vue SPA (purple accent #6c63ff) vs Tournament (blue accent #58a6ff) vs CLI (chalk defaults) — intentional or accidental?
- Dark theme: both use dark backgrounds but different palettes
- Typography: different font stacks
- Button/action styling: different patterns

- [ ] **Step 4: Compare interaction patterns**

- How does each surface handle "start"? (button click, Enter key, CLI argument)
- How does each surface handle "battle end"? (Play Again button, back to setup, exit)
- How does each surface handle errors? (inline, toast, stderr)
- How does each surface handle loading/waiting? (spinner, thinking panel, nothing)

- [ ] **Step 5: Write cross-surface findings**

Append to `docs/ui-ux-audit-findings.md`:

```markdown
---

## 4. Cross-Surface Consistency

### 4.1 Terminology Inconsistencies
[Findings table]

### 4.2 Data Exposure Gaps
[Findings table]

### 4.3 Visual Design Drift
[Findings table]

### 4.4 Interaction Pattern Inconsistencies
[Findings table]

---

## 5. Summary

### By Severity
| Severity | Count |
|----------|-------|
| Critical | N |
| Major | N |
| Minor | N |
| Info | N |

### Top 5 Recommendations
1. ...
2. ...
3. ...
4. ...
5. ...
```

---

## Task 5 (Final): Verification

**Dependencies:** Tasks 1, 2, 3, and 4
**Files:**
- Read: `docs/ui-ux-audit-findings.md` (read-only verification)

- [ ] **Step 1: Verify document completeness**

Run: `cat docs/ui-ux-audit-findings.md`
Expected: File exists, contains all 5 sections (Vue SPA, Tournament Dashboard, CLI, Cross-Surface, Summary). Temporary files `docs/ui-ux-audit-findings-tournament.md` and `docs/ui-ux-audit-findings-cli.md` should NOT exist (cleaned up in Task 4 Step 0).

- [ ] **Step 2: Verify all surfaces are covered**

Check:
- [ ] Vue SPA section has findings for SetupScreen, BattleView, state management, visual/accessibility
- [ ] Tournament Dashboard section has findings for Setup, Live, Reports, visual/accessibility
- [ ] CLI section has findings for argument parsing, battle output, edge cases
- [ ] Cross-surface section covers terminology, data, visual, interaction
- [ ] Summary has severity counts and top recommendations

- [ ] **Step 3: Verify finding quality**

Skim all findings and check:
- [ ] Every finding has a severity rating
- [ ] Every finding has a category
- [ ] Every finding has a recommendation
- [ ] No finding is vague ("make it better") — each specifies what and how
- [ ] At least 1 critical-severity finding exists (or explain why none found)

- [ ] **Step 4: Verify no code was modified**

Run: `git diff --stat`
Expected: Only `docs/ui-ux-audit-findings.md` appears (or no changes if file was created)
