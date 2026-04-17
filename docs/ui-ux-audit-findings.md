# UI/UX Audit Findings

> Generated: 2026-04-17
> Scope: Full UX audit — Vue 3 SPA, Tournament Dashboard, CLI Renderer

---

## 1. Vue 3 SPA (Web Game Server)

> Generated: 2026-04-17

### 1.1 Setup Screen

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| S-01 | **Critical** | Form Logic | `canStart` computed has a broken guard for LLM mode. The condition `!selectedLlmConfigId.value && llmConfigs.value.length === 0` means the button is only blocked when there are *no* configs **and** none is selected. If configs exist but the user deleted the selected one (selectedLlmConfigId is null while llmConfigs.length > 0), `canStart` returns `true` and the WS message is sent with `llmConfigId: undefined`, causing a silent server-side fallback. | Change to `!selectedLlmConfigId.value` (remove the `llmConfigs.length === 0` branch). |
| S-02 | **Major** | Feedback | `fetchLLMConfigs` is called on mount with no loading state. On first load the "LLM Configuration" section flashes "No LLM configs yet." even when configs exist on the server, because the fetch is async and the empty-state div renders before the response arrives. | Add a `loadingConfigs` ref; show a spinner or skeleton row while the fetch is in-flight; only show "No configs yet" after fetch completes. |
| S-03 | **Major** | Form UX | No LLM config **edit** capability. The server exposes `PATCH /api/llm-configs/:id` but the UI only supports Create and Delete. A user who mistyped the model name must delete the config and recreate it from scratch. | Add an inline "Edit" pencil button per config item that re-opens the form pre-populated, then submits a PATCH. |
| S-04 | **Major** | Feedback | `fetchLLMConfigs` silently swallows all errors (`catch { }`). If the server is unreachable, the user sees an empty config list with no explanation and no way to distinguish "no configs saved" from "server is down". | Surface a non-blocking error message (e.g., "Could not load LLM configs — is the server running?") when the fetch fails. |
| S-05 | **Major** | Scenario UX | `allRoles` mixes player class IDs (`warrior`, `mage`, `rogue`, `paladin`) with boss creature IDs (`goblin_king`, `dark_wizard`, `ancient_dragon`, `lich_lord`, `demon_lord`) in a flat `<select>` with no grouping or labels. Users have no indication which roles are "bosses" with special AI vs regular combatants. | Use `<optgroup>` to separate "Player Classes" and "Boss Creatures", or prefix labels (e.g. "👹 Goblin King (boss)"). |
| S-06 | **Major** | Scenario UX | Team assignment is a raw text input with no visual feedback. The user cannot see what color a team will be on the battlefield or whether two units share a team correctly. Typos ("Red" vs "red") silently create different teams. | Provide a color swatch next to each team input that previews the `teamColor()` mapping, and normalise team values to lowercase on input. |
| S-07 | **Minor** | Form UX | The "Remove participant" button is hidden (`v-if="scenarioParticipants.length > 2"`) rather than disabled when only 2 participants remain. The button disappears unexpectedly. | Show the button at all times; disable it (and add a tooltip "Minimum 2 participants") when length is exactly 2. |
| S-08 | **Minor** | Information Architecture | Arena selector's "Auto" option says only "Auto (based on count)" with no indication of what the user will get. | Append a live hint below the selector showing the computed arena size: e.g. "Auto → Medium (20×12) for 4 units". |
| S-09 | **Minor** | Validation | No validation prevents a scenario where all participants share the same team. This produces an immediate draw with no combat, with no warning. | When `gameCategory === 'scenario'`, check that at least two distinct `team` values exist; if not, show an inline warning and disable the start button. |
| S-10 | **Minor** | Typography | `class-desc` is `11px` and `class-stats` is `10px`. At 10px the stat string is almost unreadable on non-retina mobile displays. | Raise `class-desc` to ≥13px and `class-stats` to ≥12px; use `font-size: clamp(11px, 1.5vw, 13px)`. |
| S-11 | **Minor** | Feedback | Boss Exam mode silently omits the Enemy Mode selector. The server always uses `BossAgent` regardless of `enemyMode`, but there is no UI explanation. | Add a hint: "Bosses always use scripted AI — no LLM key required." |
| S-12 | **Info** | Security/UX | The server masks API keys as `"••••" + last4`, and the masked value is rendered in the config list row. Showing even masked key fragments alongside the base URL could help an attacker narrow down the provider. | Omit the masked key display from the list view; only show it in an edit form. |
| S-13 | **Info** | Form UX | `@keyup.enter` on the player Name input calls `onStart()` directly. If the user presses Enter while a config form is open, the main game start fires unexpectedly. | Guard the Enter handler: only call `onStart()` if `canStart.value` is true and no sub-forms are visible. |

### 1.2 Battle View

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| B-01 | **Critical** | Connectivity | `connected` is managed in App.vue but is **not passed** to BattleView as a prop. If the WebSocket drops mid-battle the user sees no indication — buttons remain enabled, actions submitted silently fail, and the turn never advances. | Pass `:connected="connected"` to BattleView; display a persistent banner ("⚠️ Disconnected") and disable action buttons when `!connected`. |
| B-02 | **Critical** | State Recovery | A page refresh mid-battle destroys all Vue state and WebSocket session. The user has no way to rejoin. | For the short term, detect session loss on `connect` and immediately call `resetGame()` with a "Session ended" message. |
| B-03 | **Major** | End State | Winner detection in the end panel hard-codes `winner === 'player'` / `winner === 'enemy'` / `winner === 'boss'`. In scenario mode the `battle_end.winner` field contains a team string (e.g., `"red"`, `"raid"`) or unit ID. All scenario wins fall through to "🤝 Draw!" | Derive a display-level result from `humanIds` and winner's team. Pass a `playerWon: boolean \| null` prop. |
| B-04 | **Major** | Action Panel | No target selection is exposed. `doAction` auto-targets self for three hardcoded spell IDs and the enemy for everything else. In multi-enemy fights there is no way to choose which enemy to hit. | Add a target picker that appears when an action requires a target. |
| B-05 | **Major** | Action Panel | **Dash**, **Grapple**, and **Shove** actions are supported by the engine but absent from the action panel. | Add "⚡ Dash" and a "💪 Special" flyout (Grapple / Shove) to the main action grid. |
| B-06 | **Major** | Action Panel | `actionMode` is not reset when `myTurn` becomes false. The sub-panel remains open through the enemy's turn. | Watch `myTurn` and reset `actionMode.value = 'main'` whenever it changes to false. |
| B-07 | **Major** | Narrative / UX | The enemy thinking panel displays raw technical tool names (e.g., `get_battle_state`, `calculate_damage`) verbatim. Non-technical players will not understand this. | Map tool names to friendly labels; hide the step type; show only human-readable text. |
| B-08 | **Minor** | Spell UX | Spell buttons show only the spell name with no slot cost, damage, or description. Users cannot make informed choices. | Show a tooltip or inline subtitle with the spell's level and a one-line effect. |
| B-09 | **Minor** | Chat | Auto-scroll fires unconditionally on every new message. If the user manually scrolled up, the next message forces them back to the bottom. | Track a `userScrolledUp` boolean; only auto-scroll when `!userScrolledUp`. |
| B-10 | **Minor** | Status Display | In N-unit mode, no card is highlighted when an AI ally is acting. Users cannot tell which unit is moving. | Apply a distinct "acting" highlight to the card where `c.id === actorId`. |
| B-11 | **Minor** | Status Display | Status effects in N-unit mini-cards show emoji only. In the 1v1 panel they show emoji + turn count. Players in N-unit mode cannot see how long a status lasts. | Add a small turn-count superscript on each status tag (e.g., "🔥²"). |
| B-12 | **Minor** | Boss Exam | Between boss fights the server waits 2000ms. During this gap the HP values shown are stale (near-zero). No UI indication that a new fight is loading. | On `boss_exam_fight_end`, show a "Preparing next fight…" overlay. |
| B-13 | **Info** | Action Panel | No "Flee" confirmation dialog. A mis-click immediately ends the battle with a loss. | Add a confirmation prompt. |
| B-14 | **Info** | Idle | No client-side turn timer. If the player walks away, the game hangs indefinitely server-side. | Display a passive timer badge; optionally auto-submit "wait" after a timeout. |

### 1.3 State Management & WebSocket

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| W-01 | **Critical** | Error Handling | `ws.onmessage` calls `JSON.parse(event.data)` without a try/catch. A malformed JSON frame will throw an uncaught exception inside the Vue reactive callback. | Wrap in try/catch; on error, addMessage("error", "Received invalid server message"). |
| W-02 | **Critical** | Connectivity | No WebSocket reconnection logic. When `ws.onclose` fires, `connected.value` goes false and the user is permanently stuck. | Implement exponential-backoff reconnect with a "Reconnecting…" badge. |
| W-03 | **Major** | Race Condition | `resetGame()` does not flush or cancel the active WebSocket message handler. A late `battle_start` message after reset yanks the user back into a dead battle UI. | Close and reopen the WebSocket on reset, or add a `sessionId` counter to discard stale messages. |
| W-04 | **Major** | Connectivity | No heartbeat / ping mechanism. Reverse proxies silently close idle WebSocket connections after 60–120s. | Send `{ type: "ping" }` every 30s; expect `{ type: "pong" }` within 5s. |
| W-05 | **Major** | State Reset | `resetGame()` does not reset `bossExamBosses`. Stale boss roster persists after "Play Again". | Add `bossExamBosses.value = []` to `resetGame()`. |
| W-06 | **Major** | State Reset | `resetGame()` does not reset `gameCategory`. After a boss exam, `gameCategory` remains `"boss_exam"`. | Reset `gameCategory.value = "1v1"` in `resetGame()`. |
| W-07 | **Minor** | Architecture | ~20 props are drilled from App.vue to BattleView. Adding a new state variable requires modifying both files. | Introduce a lightweight shared state (Vue `reactive` composable or Pinia). |
| W-08 | **Minor** | Architecture | `player` and `enemy` computed props in App.vue are labeled "Backward compat" but still passed alongside `characters` and `humanIds`. The duplication creates confusion about which source is authoritative. | Remove the legacy computed props; replace all BattleView usages with `characters` lookups. |
| W-09 | **Info** | Validation | `handleServerMessage` uses `msg: any` with no shape validation. | Define discriminated-union types for each server message type. |
| W-10 | **Info** | Connectivity | `connected` prop is never passed to BattleView. | Pass `:connected="connected"` and surface a dot indicator. |

### 1.4 Visual System & Accessibility

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| A-01 | **Critical** | Accessibility | `prefers-reduced-motion` is not respected. Three animations run unconditionally: `pulse-glow`, `dot-bounce`, `shake`. | Add `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }` to style.css. |
| A-02 | **Major** | Accessibility | No `:focus-visible` styles exist. Keyboard navigation is invisible. | Add `button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` |
| A-03 | **Major** | Accessibility | `.chat-section` has no `aria-live` attribute. Screen readers miss dynamic messages. | Add `aria-live="polite"` to `.chat-section`. |
| A-04 | **Major** | Accessibility | The battlefield `<canvas>` has no `role`, `aria-label`, or fallback content. | Add `role="img"` and `aria-label="Battlefield grid showing character positions"`. |
| A-05 | **Major** | Colour Contrast | `.btn-item` (background `#d97706`, white text): contrast ≈ **2.97:1** — fails AA. | Darken to `#b45309` (≈4.6:1 ✓). |
| A-06 | **Major** | Colour Contrast | `.btn-flee` (background `#78716c`, white text): contrast ≈ **4.22:1** — fails AA. | Darken to `#57534e` (≈5.8:1 ✓). |
| A-07 | **Minor** | Typography | `class-stats` rendered at `10px` — below legibility threshold on 1× displays. | Raise to `min(12px, 1.8vw)`. |
| A-08 | **Minor** | Typography | `bar-label` defined at 12px globally and 10px in BattleView scoped styles — conflicting. | Consolidate to a single 12px definition. |
| A-09 | **Minor** | Responsive | `body { overflow: hidden }` prevents scrolling. Mobile virtual keyboard clips content. | Remove from body; use `overflow-y: auto` on `.setup`. |
| A-10 | **Minor** | Responsive | Three-button category toggle wraps on 320px viewports. | Reduce padding or font for toggle on small screens. |
| A-11 | **Minor** | Colour Blindness | Action buttons differentiated primarily by colour. Emoji partially compensate. | Consider adding short text labels below emoji on larger screens. |
| A-12 | **Info** | Colour Contrast | `--text-dim: #7a7a9a` on `--bg: #0d0d1a` ≈ 4.6:1 — passes AA by a tiny margin. | Lighten to `#9090b0` (~6:1) for comfort. |
| A-13 | **Info** | CSS Duplication | `bar-container`, `bar-track`, `bar-fill`, `bar-value` defined in both global and scoped styles with different values. | Consolidate into style.css. |

### 1.5 Missing Features / Gaps

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| G-01 | **Critical** | Error State | Fatal server error during battle start leaves the user on BattleView with a blank battlefield and disabled buttons — no recovery path. | On `error` while `phase === 'battle'` and `characters.length === 0`, show error prominently with "Back to Setup" button. |
| G-02 | **Major** | Gameplay | **Move action not exposed in UI.** The engine supports `move` with `{ dx, dy }` but the human player cannot reposition. | Add a "🚶 Move" button with directional pad or click-on-canvas flow. |
| G-03 | **Major** | Session | No session persistence or reconnect flow. Network interruption during boss exam irreversibly loses progress. | Assign a session token; support `{ type: "rejoin", token }` on reconnect. |
| G-04 | **Major** | Form UX | LLM config **edit** is server-supported but not implemented in the UI. | Implement edit flow. |
| G-05 | **Minor** | UX | No confirmation on LLM config delete. | Add confirm step. |
| G-06 | **Minor** | Boss Exam UX | No visual progress indicator during 2000ms inter-fight delay. | Show a countdown or loading spinner. |
| G-07 | **Minor** | Information | `GET /api/battle-logs` is exposed but the SPA has no battle history viewer. | Add a "Recent Battles" section on setup screen. |
| G-08 | **Minor** | UX | No "Back to Setup" during an active battle. Only exit is Flee (loss) or closing tab. | Add a "✕ Quit" button in the header with confirmation. |
| G-09 | **Info** | Developer UX | `formatAction()` leaks internal action syntax into player-facing chat. | Remove `action_chosen` display or format as human-readable label. |
| G-10 | **Info** | Observability | `character_defeated` message shows internal ID (`"unit3"`) not display name. | Resolve ID to name before adding chat message. |

---

## 2. Tournament Dashboard (Self-Contained HTML SPA)

> Generated: 2026-04-17

### 2.1 Setup Tab

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| S-01 | **Major** | Discoverability | Health indicator is a small badge in the nav, rendered `display:none` until health check resolves, with no label a first-time user would understand. | Move below the model chip list, label it "LLM endpoint status", add a Refresh button. |
| S-02 | **Major** | UX Copy | No explanation of what **heuristic-baseline** is. It appears as a chip identical to LLM models with no tooltip. | Add a `title` tooltip: "Rule-based baseline agent (no LLM required)." |
| S-03 | **Major** | Validation | A single-model tournament creates 0 matchups and immediately broadcasts `tournament_end` with confetti and "Tournament complete!" | Enforce minimum 2 models client-side and server-side. |
| S-04 | **Minor** | UX Copy | Settings labels (ELO K-Factor, Best of, Max Turns) have no explanatory text. | Add `title` tooltips or `<small>` sub-labels. |
| S-05 | **Minor** | Discoverability | Preset buttons (Quick/Standard/Marathon) show no visual confirmation after clicking. | Highlight the last-clicked preset with an `active` CSS class. |
| S-06 | **Minor** | UX | Share URL button is in the nav bar, not near the configuration it shares. | Move or duplicate into the Run Configuration card. |
| S-07 | **Minor** | Feedback | Gap between clicking Start and the first SSE event — Live panel shows "No tournament running" with no indication a start is in progress. | Show "Starting…" in the Live panel status bar immediately after POST returns. |
| S-08 | **Minor** | UX | No confirmation before starting a Marathon tournament. | Add a warning when `bestOf × matchups > 50 games`. |
| S-09 | **Minor** | UX | Remove model button doesn't update the manual text input — model reappears. | Also strip the model from the comma-separated text field. |
| S-10 | **Info** | UX | Persisted ELO ratings shown as `(1234)` badges with no label or tooltip. | Add `title` attribute and a legend note below chips. |
| S-11 | **Info** | UX | No Select All / Deselect All buttons for model chips. | Add "Select All" and "Clear" links. |
| S-12 | **Info** | UX | `autoStart=true` URL param uses a 500ms timeout that can race with `loadModels()`. | Gate autoStart on the models fetch promise. |

### 2.2 Live Tab

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| L-01 | **Critical** | Bug | **ELO delta calculated as `s.elo - 1000` (hardcoded).** After the first tournament with persisted ELOs, deltas are meaningless. | Capture ELO at tournament start and use that as baseline. |
| L-02 | **Critical** | Performance | **`log.innerHTML +=`** on every SSE turn event — O(n²) DOM performance. Page lags mid-tournament. | Use `log.insertAdjacentHTML('beforeend', lineHtml)`. |
| L-03 | **Major** | Feedback | No visible SSE connection status. Silent reconnect with no user feedback. | Add "⚠️ Reconnecting…" label on error, cleared on reconnect. |
| L-04 | **Major** | Layout | `live-status` flex row contains 5 children in a single horizontal strip — overflows on narrow screens. | Move timer and bracket below the status row. |
| L-05 | **Major** | UX | ELO ranking table is not sortable. | Add clickable `<th>` headers for sort toggle. |
| L-06 | **Major** | UX | No persistent "current HP" display. HP only visible in the scrolling log. | Add a persistent HP banner beneath the status bar. |
| L-07 | **Minor** | UX | Retry button rendered during live runs — always 409s. | Only show when `isRunning === false`. |
| L-08 | **Minor** | UX | Final rankings appear at the bottom of the scroll area — easy to miss. | Display in a prominent card above the log. |
| L-09 | **Minor** | Accessibility | ELO history canvas has no `aria-label`. | Add `aria-label="ELO history chart"`. |
| L-10 | **Minor** | Theme | `drawEloChart` hardcodes `ctx.fillStyle = '#0d1117'` — invisible in light mode. | Read `--bg` CSS variable at draw time. |
| L-11 | **Minor** | UX | `loadReports()` called twice at tournament end (from `tournament_end` and `reports_saved`). | Deduplicate. |
| L-12 | **Info** | Missing State | No resume capability after server restart mid-tournament. | On SSE reconnect, fetch `/api/tournament/status` and reconcile. |
| L-13 | **Info** | Performance | `eventBuffer` never trimmed — megabytes of buffered data for long tournaments. | Cap at last 500 events or structural events only. |

### 2.3 Reports Tab

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| R-01 | **Critical** | Bug | `html =` (assignment, not `+=`) in the no-turn-log branch discards the winner banner. | Change to `html +=`. |
| R-02 | **Major** | UX | ELO delta absent from Final Rankings table. | Add a `±Δ` column from `initialElos`. |
| R-03 | **Major** | UX | "Bad Acts" column unexplained — users don't know what it means. | Add `title` attribute and a small legend. |
| R-04 | **Major** | UX | H2H matrix hard to read with >8 models (vertical headers, no totals, no hover detail). | Add `title` tooltips, row/column totals, heatmap scale. |
| R-05 | **Major** | UX | Replay player re-renders all turns from 1 to N on each step click. | Append incrementally or use virtual scroll. |
| R-06 | **Minor** | UX | Compare chart also hardcodes dark background. | Use `--bg` CSS variable. |
| R-07 | **Minor** | UX | Report Files list shows raw filenames, not human-friendly titles. | Display friendly titles with filename as metadata. |
| R-08 | **Minor** | UX | Tournament History rows are entirely clickable AND have a separate "View" button — duplicate affordance. | Remove one; keep row click or button, not both. |
| R-09 | **Minor** | UX | History Viewer has no export button. | Add Export JSON/CSV buttons per entry. |
| R-10 | **Minor** | UX | `showMatchupDetail` overwrites `container.innerHTML` — heavy `loadReports()` to go back. | Use show/hide visibility toggling. |
| R-11 | **Minor** | Missing Feature | No cross-tournament comparison view. | Add "Compare" multi-select on history table. |
| R-12 | **Info** | UX | Class performance table missing when no data — no indication it will appear later. | Always render section header with placeholder text. |

### 2.4 Visual Design & Accessibility

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| A-01 | **Major** | Accessibility | Nav tabs are `<div>` elements — not keyboard-accessible, no `role="tab"`. | Replace with `<button role="tab" aria-selected="true/false">`. |
| A-02 | **Major** | Accessibility | Color-only win/loss coding — fails for ~8% of color-blind users. | Add icons (✓/✗) and bold text for wins. |
| A-03 | **Major** | Accessibility | Both canvas elements have no `aria-label` or fallback. | Add `aria-label` and visually-hidden data tables. |
| A-04 | **Minor** | Theme | Both canvas charts hardcode dark background. | Read `--bg` CSS variable at draw time. |
| A-05 | **Minor** | Accessibility | Font sizes go as small as `10px`. | Raise minimum to 12px. |
| A-06 | **Minor** | Accessibility | Progress bar has no ARIA attributes. | Add `role="progressbar" aria-valuenow/aria-valuemin/aria-valuemax`. |
| A-07 | **Minor** | Responsive | Live tab layout breaks on screens < 900px. | Add responsive breakpoint for Live panel. |
| A-08 | **Minor** | UX | Theme toggle icon `🌓` doesn't intuitively mean "switch to dark". | Use `☀️` for light mode toggle. |
| A-09 | **Minor** | UX | Keyboard shortcuts (1–4, Escape) undocumented. | Add a `?` button showing shortcut legend. |
| A-10 | **Minor** | Responsive | H2H matrix has no scroll indicator on touch devices. | Add "← scroll →" hint on mobile. |
| A-11 | **Info** | Print | `@media print` doesn't handle canvas or scroll areas. | Add print-only text fallbacks inside canvas elements. |

### 2.5 Missing Features / Gaps

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| G-01 | **Critical** | Data Integrity | **XSS via `innerHTML +=`.** `event.narrative` inserted directly — LLM-generated HTML executes in browser. | Sanitize with DOMPurify or use `textContent` for plain fields. |
| G-02 | **Major** | State Management | `window._lastResult` global set only inside `loadReports()`. Features silently break if Reports tab hasn't been opened. | Use named module-level variable; eagerly populate from `/api/tournament/status`. |
| G-03 | **Major** | UX | No pause/resume — only hard abort. | Add `POST /api/tournament/pause` if feasible. |
| G-04 | **Major** | Missing Feature | No cross-tournament ELO leaderboard or trend chart. | Add "All-Time Rankings" panel in Reports tab. |
| G-05 | **Minor** | UX | Duel model preview always shows `🧠` even for heuristic. | Show `🤖` for heuristic. |
| G-06 | **Minor** | UX | Duel settings hardcoded and non-configurable. | Expose best-of and max turns as inputs. |
| G-07 | **Minor** | UX | Active preset button not highlighted after clicking. | Add `active` CSS class to matching preset. |
| G-08 | **Minor** | UX | Footer link points to generic `https://github.com`. | Point to real repo or remove. |
| G-09 | **Minor** | UX | `loadReports()` called twice at tournament end. | Remove from `tournament_end` handler. |
| G-10 | **Minor** | Developer Experience | 1694-line self-contained HTML with ~1000 lines inline JS — hard to maintain. | Extract JS and CSS to separate files. |
| G-11 | **Info** | UX | No desktop notification on tournament completion. | Add optional `Notification.requestPermission()`. |
| G-12 | **Info** | UX | "Uptime" footer counter has no user-facing purpose. | Remove or replace with server uptime. |

---

## 3. CLI Renderer (Terminal Output)

> Generated: 2026-04-17

### 3.1 Argument Parsing & Entry Flow

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| 3.1.1 | **Minor** | Argument Parsing | `parseArgs` uses `args[++i]` without bounds check. Missing value → `NaN` flows into BattleRunner. | Add bounds check before each `args[++i]`. |
| 3.1.2 | **Minor** | Argument Parsing | Unknown flags silently ignored. | Warn on unrecognised tokens after parse loop. |
| 3.1.3 | **Minor** | Argument Parsing | `--delay` and `--max-turns` accept negatives and NaN. | Validate as finite positive integers. |
| 3.1.4 | **Minor** | Argument Parsing | Model names starting with `-` (e.g. `-o3`) dropped from `--tournament-models`. | Accept comma-separated values in a single quoted string. |
| 3.1.5 | **Minor** | Argument Parsing | `--mode` accepts arbitrary strings; silently degrades. | Validate against `["mock", "llm", "mixed"]`. |
| 3.1.6 | **Minor** | Entry Flow | `human` agent type silently replaced by heuristic with no warning. | Print a chalk.yellow warning. |
| 3.1.7 | **Minor** | Entry Flow | Double banner in scenario mode — `runScenario` + `printBattleStart` both print headers. | Remove inline banner in `runScenario`. |
| 3.1.8 | **Minor** | Entry Flow | Auto-arena selection is silent — user doesn't know which arena was chosen. | Print arena label and dimensions before runner starts. |
| 3.1.9 | **Minor** | Entry Flow | `--output` JSON export path not announced. | Print the export path after write. |
| 3.1.10 | **Info** | Help | `--mode` scope limited to legacy 1v1 but not documented. | Add a note in help text. |
| 3.1.11 | **Info** | Startup | No feedback during LLM initialisation — looks like a hang. | Print "Connecting to LLM…" before `runner.run()`. |
| 3.1.12 | **Info** | Tournament | 1-model tournament produces zero matchups silently. | Require at least 2 models. |

### 3.2 Battle Output

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| 3.2.1 | **Critical** | Turn Narrative | `printActionResult` does not render `CombatResult.extraAttacks`. Extra attack damage is silently dropped. | Iterate over `result.extraAttacks` and print each. |
| 3.2.2 | **Critical** | Turn Narrative | `printActionResult` does not render `CombatResult.reaction`. Opportunity attacks, Shield, Uncanny Dodge are invisible. | Add `if (result.reaction?.triggered)` block. |
| 3.2.3 | **Major** | Battle Output | No battlefield / map display. Arena dimensions, cover objects, and positions are modelled but never rendered. | Implement a compact ASCII grid renderer. |
| 3.2.4 | **Major** | Status Display | Status effects string appended **after** the closing table border `│` — breaks alignment. | Add a fifth column for status inside the table borders. |
| 3.2.5 | **Major** | Status Display | Death saves not shown for downed characters. | Replace HP bar for 0-HP characters with death save counter. |
| 3.2.6 | **Major** | Turn Narrative | `badAction` field ignored — rejected actions look like successful ones. | Check `result.badAction` and print a warning. |
| 3.2.7 | **Major** | Turn Narrative | Timeout actions displayed as deliberate waits — indistinguishable. | Append `⏰ (timed out)` when `pendingAction?.timedOut`. |
| 3.2.8 | **Minor** | Turn Narrative | Dice roll values not displayed despite being available in `DamageResult`. | Add roll detail line (conditional on `--verbose`). |
| 3.2.9 | **Minor** | Turn Narrative | Crits/misses rendered in `chalk.gray` — low visual impact for high-drama moments. | Use `chalk.bold.yellow` for crits. |
| 3.2.10 | **Minor** | Turn Narrative | Bonus actions not mentioned in turn summary. | Print secondary line for `bonusAction`. |
| 3.2.11 | **Minor** | Status Display | Spell slots not displayed in health bar table. | Add Slots column or summary string. |
| 3.2.12 | **Minor** | Status Display | Concentration not shown. | Show `🎯 Conc: <spell>` tag. |
| 3.2.13 | **Minor** | Battle End | Winner announcement uses red skull even for victor. | Use green + trophy for winner; reserve red for draw/loss. |
| 3.2.14 | **Minor** | Battle End | `printBattleSummary` not called per boss fight. | Call after each boss fight iteration. |
| 3.2.15 | **Minor** | Display | Turn header has no fixed width — asymmetric for long names. | Pad to fixed width (e.g. 60 chars). |
| 3.2.16 | **Info** | Display | Position coordinates show trailing `.0` (e.g. `42.0, 20.0`). | Use `Math.round` before formatting. |
| 3.2.17 | **Info** | Display | Pre-battle roster omits spell slots, class features, and fighting style. | Add to `printBattleStart`. |

### 3.3 Edge Cases & Error Handling

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| 3.3.1 | **Major** | Error Handling | No SIGINT handler — Ctrl+C loses partial battle state. | Add `process.on('SIGINT', ...)` to save partial replay. |
| 3.3.2 | **Major** | Error Handling | Fatal error handler dumps raw stacks with no actionable guidance. | Distinguish known error classes and print targeted help. |
| 3.3.3 | **Minor** | Terminal Width | No check against `process.stdout.columns`. Table garbled on narrow terminals. | Clamp or truncate to terminal width. |
| 3.3.4 | **Minor** | Error Handling | `saveReplay` failure not caught in all call sites. | Wrap in try/catch everywhere. |
| 3.3.5 | **Minor** | Error Handling | Invalid `--arena` preset silently falls back. | Print error listing valid presets. |
| 3.3.6 | **Minor** | Error Handling | `--mode mixed` accepted for boss exam but not valid there. | Validate explicitly in `runBossExam`. |
| 3.3.7 | **Info** | Error Handling | No distinction between timeout, outage, and rate-limit errors. | Add `timeoutReason` field to `CombatAction`. |
| 3.3.8 | **Info** | Error Handling | No database in CLI — `saveReplay` writes plain JSON files. | Document in README. |

### 3.4 Missing Features / Gaps

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| 3.4.1 | **Major** | Feature Gap | **No battlefield visualisation.** Largest comprehension gap in CLI output. | Implement scaled ASCII grid. |
| 3.4.2 | **Major** | Feature Gap | No `--verbose` / `--quiet` output modes. | Add both flags. |
| 3.4.3 | **Minor** | Feature Gap | No `--replay` / `--watch` flag to play back saved replays. | Add replay mode. |
| 3.4.4 | **Minor** | Feature Gap | Cover objects invisible in output despite granting significant AC bonuses. | Append cover bonus to roll detail line. |
| 3.4.5 | **Minor** | Feature Gap | No per-character turn-history display. | Add `--history` flag. |
| 3.4.6 | **Minor** | Feature Gap | Tournament output minimal — no per-game HP summary. | Emit post-game winner HP percentage. |
| 3.4.7 | **Info** | Feature Gap | `human` agent type documented but not implemented. | Remove from help or stub a readline prompt. |
| 3.4.8 | **Info** | Feature Gap | `NO_COLOR` not documented. | Add to help text. |

---

## 4. Cross-Surface Consistency

### 4.1 Terminology Inconsistencies

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| X-01 | **Major** | Terminology | The non-LLM agent is called **"Mock AI"** in the Vue SPA (`enemyMode === 'mock'`, button label "🤖 Mock AI"), **"heuristic-baseline"** in the Tournament Dashboard (chip label), and **"heuristic"** in the CLI (`--mode mock` maps to HeuristicAgent). Three names for the same thing. | Standardise on one term. "Heuristic AI" is most descriptive. Update Vue SPA button to "🤖 Heuristic AI" and Tournament chip to "heuristic". |
| X-02 | **Major** | Terminology | The Vue SPA uses **"1v1 Arena"** for its main mode. The CLI uses **"battle"** and **"scenario"**. The Tournament Dashboard uses **"game"** and **"matchup"**. The same concept (one combat instance) has 4 different names. | Adopt "battle" as the canonical term (matches engine `BattleRunner`, `BattleLog`). Use "matchup" only for tournament pairings. |
| X-03 | **Minor** | Terminology | Dark backgrounds differ: Vue SPA uses `#0d0d1a`, Tournament uses `#0d1117`. Both are dark but not the same shade — if both are open in browser tabs, the shift is noticeable. | Align both to a single dark background. Pick one (`#0d1117` is closer to GitHub's palette and has wider tooling support). |
| X-04 | **Minor** | Terminology | The Tournament Dashboard exposes class performance breakdown (which classes each model played). The Vue SPA and CLI never mention which classes were used in the opponent selection — it's random and invisible. | In the Vue SPA, show the randomly selected enemy class before the battle starts. In the CLI, print the enemy class in `printBattleStart`. |
| X-05 | **Info** | Terminology | The Tournament Dashboard's "Bad Acts" metric has no equivalent concept in the Vue SPA or CLI. LLM bad actions (invalid moves) are tracked by the tournament but silently discarded in the game server and CLI. | Surface `badAction` count in the CLI (see 3.2.6) and optionally in the Vue SPA post-battle summary. |

### 4.2 Data Exposure Gaps

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| X-06 | **Major** | Data | The Tournament Dashboard shows **dice roll data** (attack rolls, damage rolls, saving throws) in game replays. The Vue SPA and CLI do **not** show dice rolls — the most fundamental D&D mechanic is invisible to the player. | Add dice roll display to the Vue SPA (in the chat narrative) and the CLI (see 3.2.8). |
| X-07 | **Major** | Data | The Tournament Dashboard shows **ELO ratings** and tracks them across sessions. The Vue SPA has no concept of player skill tracking — every battle is isolated. | Add a player stats section to the Vue SPA that fetches from a `/api/player-stats` endpoint (or tracks locally in localStorage). |
| X-08 | **Major** | Data | The **battlefield map** is rendered in the Vue SPA (canvas) but not in the CLI or Tournament Dashboard. Spatial awareness is the Tournament's biggest blind spot — it has no way to show character positions. | Add a mini-map to the Tournament Live tab (reuse the canvas renderer from the Vue SPA). |
| X-09 | **Minor** | Data | The CLI shows **spell lists** in the pre-battle roster but the Vue SPA's class selection cards only show a one-line description. Players choosing a class in the Vue don't see what spells they'll have. | Add a spell list tooltip or expandable section to the Vue class cards. |
| X-10 | **Info** | Data | The Tournament Dashboard persists **ELO history** across sessions (`ratings.json`). The CLI and Vue SPA have no persistent state at all. | Consider adding localStorage-based battle history to the Vue SPA. |

### 4.3 Visual Design Drift

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| X-11 | **Major** | Visual | **Different accent colours:** Vue SPA uses purple (`#6c63ff`), Tournament uses blue (`#58a6ff`). Both products belong to the same project but look visually unrelated. | Adopt a single accent colour. Blue (`#58a6ff`) is more standard for dashboards; purple for the game UI is more atmospheric. Keep both if the products are intentionally distinct, but document the rationale. |
| X-12 | **Major** | Visual | **Different font stacks:** Vue uses `"Segoe UI", system-ui, -apple-system`, Tournament uses `-apple-system, BlinkMacSystemFont, "Segoe UI"`. The order matters — on macOS the Vue SPA gets Segoe UI (Windows-first) while Tournament gets system-ui/SF Pro (Apple-first). | Standardise font stack. Recommended: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (system-native first). |
| X-13 | **Minor** | Visual | **HP bar colours differ:** Vue uses `--hp: #4ade80` (green) / `--hp-mid: #facc15` (yellow) / `--hp-low: #f87171` (red). Tournament uses `--green: #3fb950` / `--yellow: #d29922` / `--red: #f85149`. Different green/yellow/red shades. | Align HP colour variables across both surfaces. |
| X-14 | **Minor** | Visual | **Light theme:** Tournament supports light mode via `data-theme="light"`. Vue SPA has no light theme at all. | Add light theme support to Vue SPA (or remove from Tournament for consistency). |
| X-15 | **Info** | Visual | **Emoji usage is consistent** — both surfaces use emoji for class indicators (⚔️🔮🗡️🛡️) and boss indicators (👹). This is a positive consistency point. | No action needed — maintain this pattern. |

### 4.4 Interaction Pattern Inconsistencies

| # | Severity | Category | Finding | Recommendation |
|---|----------|----------|---------|----------------|
| X-16 | **Major** | Interaction | **Error handling differs dramatically:** Vue shows errors as chat messages (can scroll away), Tournament shows toast notifications (temporary), CLI prints to stderr (permanent). The same server error produces three different user experiences. | Standardise: errors should be persistent and dismissible across all surfaces. Vue should use a toast/banner that stays until dismissed, not a chat message. |
| X-17 | **Major** | Interaction | **Loading states are inconsistent:** Vue has no loading indicators at all (config fetch, battle start). Tournament shows SSE events as they arrive. CLI shows nothing during LLM init. | Add loading spinners/skeletons to Vue SPA. Add "Connecting to LLM…" to CLI. |
| X-18 | **Minor** | Interaction | **"Back to start" flow differs:** Vue has "Play Again" (returns to setup). Tournament has tab navigation (no explicit "new tournament" button — must go back to Setup tab). CLI exits the process. | Add a "New Tournament" button to the Tournament header that resets to Setup tab. |
| X-19 | **Minor** | Interaction | **Confirmation patterns differ:** Vue has no delete confirmation (LLM configs). Tournament has no abort confirmation. CLI has no confirmation for anything. | Add confirmation dialogs consistently across all destructive actions. |
| X-20 | **Info** | Interaction | **Keyboard shortcuts differ:** Tournament has 1–4 for tabs + Escape. Vue has no keyboard shortcuts. CLI is entirely keyboard-driven. | Add Escape to go back to setup in Vue SPA. Document Tournament shortcuts visibly. |

---

## 5. Summary

### By Surface

| Surface | Critical | Major | Minor | Info | Total |
|---------|----------|-------|-------|------|-------|
| Vue 3 SPA | 8 | 21 | 21 | 10 | 60 |
| Tournament Dashboard | 4 | 17 | 30 | 9 | 60 |
| CLI Renderer | 2 | 9 | 25 | 9 | 45 |
| Cross-Surface | 0 | 7 | 8 | 4 | 19 |
| **Total** | **14** | **54** | **84** | **32** | **184** |

### Top 10 Recommendations

1. **XSS in Tournament Dashboard (G-01)** — `innerHTML +=` with unsanitized LLM narrative is a security vulnerability. Sanitize with DOMPurify immediately.
2. **WebSocket reconnection in Vue SPA (W-02)** — Users are permanently stuck after any network blip. Implement exponential-backoff reconnect.
3. **`innerHTML +=` performance (L-02)** — O(n²) DOM updates will freeze the page mid-tournament. Switch to `insertAdjacentHTML`.
4. **ELO delta bug (L-01)** — Hardcoded `s.elo - 1000` produces wrong deltas after the first tournament. Fix baseline calculation.
5. **No `prefers-reduced-motion` (A-01)** — Three animations run unconditionally, causing potential vestibular harm. Add media query override.
6. **Winner detection broken for scenarios (B-03)** — All scenario-mode battles show "Draw" regardless of outcome. Derive result from `humanIds` and winner's team.
7. **Missing battle actions in Vue UI (B-05, G-02)** — Move, Dash, Grapple, and Shove are engine-supported but invisible to the player. Add to action panel.
8. **Extra attacks and reactions invisible in CLI (3.2.1, 3.2.2)** — Major combat mechanics produce no terminal output. Render both in `printActionResult`.
9. **No battlefield map in CLI (3.4.1, 3.2.3)** — The largest comprehension gap. Spatial decisions are invisible. Implement ASCII grid renderer.
10. **Standardise terminology (X-01, X-02)** — Three names for the non-LLM agent, four names for a combat instance. Adopt "Heuristic AI" and "battle" as canonical terms.
