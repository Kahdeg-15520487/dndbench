# 11 — Tournament System

The arena layer for running model-vs-model battles at scale.

---

## Overview

The tournament system:
- Runs round-robin matchups between AI models
- Tracks ELO ratings across sessions
- Generates markdown and HTML reports
- Provides a web dashboard for live monitoring

---

## Tournament Runner

### File: `src/arena/tournament.ts`

### Configuration

```typescript
interface TournamentConfig {
  models: string[];           // Model names to compete
  bestOf: number;             // Games per matchup (default: 5)
  kFactor: number;            // ELO K-factor (default: 32)
  maxTurns: number;           // Max turns per game (default: 30)
  outputDir: string;          // Where to save reports
  classRotation?: string[];   // Classes to rotate through
  agentFactory?: Function;    // Agent creation hook
}
```

### Round-Robin Format

Every model plays every other model in a best-of-N series:

```
Models: A, B, C
Matchups: A vs B, A vs C, B vs C
Each matchup: best-of-N games
```

### Class Rotation

Each game in a matchup uses a different class pair:

```
Game 1: warrior vs mage
Game 2: mage vs warrior  (swapped)
Game 3: rogue vs paladin
Game 4: paladin vs rogue
Game 5: warrior vs mage  (cycle repeats)
```

### Heuristic Baseline

A sentinel `heuristic-baseline` agent is included in tournaments as a skill
floor.  All models should beat it — if they don't, the model is performing
worse than simple rules.

---

## ELO Rating System

### File: `src/arena/elo.ts`

```
Expected = 1 / (1 + 10^((RatingB − RatingA) / 400))
NewRating = Rating + K × (Score − Expected)
```

- Win = 1.0, Loss = 0.0, Draw = 0.5
- Default K-factor: 32
- Starting ELO: 1000

### Persistence

ELO ratings are saved to `<outputDir>/ratings.json` and loaded at startup:

```json
{
  "Gemma-4-26B": { "elo": 919, "wins": 5, "losses": 3, "draws": 2, "matches": 10 },
  "Qwen3.5-2B": { "elo": 964, "wins": 6, "losses": 2, "draws": 2, "matches": 10 }
}
```

### Bad Action Detection

The system tracks "bad actions" — moves that failed due to:
- Target out of range
- Unknown spell
- No target available
- No item available

High bad action rates indicate poor model performance.

---

## Tournament Reports

### File: `src/arena/tournament-report.ts`

### Per-Run Directories

Reports are saved in `<outputDir>/run-<timestamp>/`:

```
tournament/
  run-2026-04-08T12-00-00/
    matchup_001.md       (Model A vs Model B)
    matchup_002.md       (Model A vs Model C)
    matchup_003.md       (Model B vs Model C)
    tournament_summary.md
```

### Report Content

Each matchup report includes:
- Matchup header with models and class rotation
- Game-by-game results with turn counts and winners
- Win/loss/draw tally

The tournament summary includes:
- Final rankings table with ELO changes
- Head-to-head matrix
- Total games played

---

## Tournament Server (Web Dashboard)

### File: `src/arena/tournament-server.ts`

### Endpoints

| Method | Path                               | Description                        |
|--------|------------------------------------|------------------------------------|
| GET    | `/`                                | Dashboard HTML                     |
| GET    | `/api/models`                      | Available LLM models               |
| POST   | `/api/tournament/start`            | Start tournament                   |
| POST   | `/api/tournament/abort`            | Abort running tournament           |
| POST   | `/api/tournament/reset`            | Reset state                        |
| GET    | `/api/tournament/events`           | SSE live event stream              |
| GET    | `/api/tournament/events/replay`    | Replay past SSE events             |
| GET    | `/api/tournament/status`           | Current tournament state           |
| GET    | `/api/reports`                     | List available report files        |
| GET    | `/api/history`                     | Tournament history                 |
| GET    | `/api/history/:id`                 | Specific history entry             |
| GET    | `/api/game/:mi/:gi`               | Individual game turn log           |
| GET    | `/api/game/:mi/:gi/export`        | Game CSV export                    |
| GET    | `/api/ratings`                     | Persisted ELO ratings              |
| GET    | `/api/export/json`                 | Full results as JSON               |
| GET    | `/api/export/csv`                  | Full results as CSV                |
| GET    | `/api/health`                      | Server + LLM endpoint health      |
| GET    | `/report/{*path}`                  | Serve report files                 |

### Dashboard Features

- **Setup tab:** Model selection, preset buttons, configuration
- **Live tab:** Real-time battle narrative via SSE, ELO chart, matchup bracket
- **Reports tab:** Rankings table, H2H matrix, class performance, game viewer
- **Theme toggle:** Light/dark mode
- **Keyboard shortcuts:** 1/2/3 for tabs, Escape to close modals
- **Sound notification:** Beep on tournament completion
- **Confetti:** Celebration animation on tournament end
- **Battle replay:** Play/pause/step/speed controls for game replays

### Dashboard Port

Default: **8050** (configurable via `--serve-reports-port`)

---

## Tournament Events (SSE)

The `TournamentRunner` emits events that are streamed to the dashboard:

| Event                | Data                              |
|----------------------|-----------------------------------|
| `tournament_start`   | Model list, config                |
| `matchup_start`      | Two models, matchup index         |
| `game_start`         | Game number, classes              |
| `turn`               | Narrative, turn number, HP bars   |
| `game_end`           | Winner, turns, duration           |
| `matchup_end`        | Matchup result, ELO change        |
| `tournament_end`     | Final rankings                    |
| `tournament_aborted` | Abort reason                      |
