# 07 — Turn Structure

How the round/turn cycle works, including initiative, action economy, and
movement.

---

## Round Structure

Each round consists of:

1. **Roll initiative** — d20 + DEX modifier, highest goes first
2. **Each character acts in initiative order:**
   a. Check for frozen/paralyzed (skip turn if affected)
   b. Agent chooses action (via `getAction()`)
   c. Resolve movement (if any)
   d. Resolve action (attack, spell, item, ability, defend, wait, flee, dash)
   e. Tick cooldowns for this character
3. **Process status effects** (once per round, after all characters act)
4. **Check for defeat** (from status effect damage)
5. **Emit health bars** update

### Implementation

- **File:** `src/arena/battle-runner.ts` → `executeTurn()`
- **Status:** ✅ Functional

---

## Initiative

```
Initiative = d20 + DEX Modifier
```

Characters act from **highest to lowest** initiative.  Ties are broken by
array order (no tiebreaker roll as in 5e).

### 5e Accuracy

✅ Correct formula.  In 5e, ties are resolved by: highest DEX goes first,
then roll again.  The engine doesn't handle ties specially.

---

## Action Economy

### 5e RAW Action Economy

| Action Type     | Count per Turn | Examples                      |
|-----------------|----------------|-------------------------------|
| Action          | 1              | Attack, Cast Spell, Dash, Use Item |
| Bonus Action    | 1              | Off-hand attack, Healing Word |
| Reaction        | 1 (resets on turn) | Attack of Opportunity, Shield spell |
| Movement        | 1 (up to speed)    | Walk, Dash doubles it         |
| Free Action     | Unlimited      | Talk, drop item               |

### Engine Action Economy

| Action Type     | Count per Turn | Status |
|-----------------|----------------|--------|
| Action          | 1              | ✅     |
| Bonus Action    | 0              | ❌ Not implemented |
| Reaction        | 0              | ❌ Not implemented |
| Movement        | 1 (before action) | ✅  |
| Free Action     | 0              | N/A    |

**Each turn the character can:** Move + take ONE action.  That's it.

---

## Available Actions

| Action        | What It Does                                    | 5e Accuracy |
|---------------|-------------------------------------------------|-------------|
| `attack`      | Weapon attack (d20 vs AC)                       | ✅          |
| `cast_spell`  | Cast a spell (uses slot or cantrip)             | ✅          |
| `use_item`    | Use a consumable item                           | ✅          |
| `class_ability`| Use a class feature (Second Wind, etc.)        | ✅          |
| `defend`      | +2 AC until next action (simplified Dodge)      | ⚠️ See below |
| `dash`        | Move 2× speed toward target (uses action)       | ✅          |
| `wait`        | Do nothing                                      | ✅          |
| `flee`        | Try to escape the arena                         | ⚠️ Homebrew  |

### Defend vs Dodge

|                  | Engine (Defend)     | 5e (Dodge)                          |
|------------------|---------------------|--------------------------------------|
| AC bonus         | +2                  | None directly                        |
| Attack effect    | None                | Attackers have **disadvantage**      |
| Save effect      | None                | Advantage on DEX saving throws       |
| Cost             | Action              | Action                               |

The engine's `defend` is a simplified version of 5e's `Dodge` action.

### Dash

```
Dash: Move up to 2× speed toward a target. Uses your action (no attack possible).
```

✅ Accurate to 5e RAW — Dash doubles your movement speed for the turn but
costs your action.

### Flee

Not a standard 5e action.  The character moves toward the nearest arena edge
at full speed.  If they reach the edge, they escape (and lose).

---

## Movement

### How Movement Works

1. The agent can attach a `move: { dx, dy }` to any action
2. Movement is resolved **before** the action
3. Distance is clamped by the character's speed stat
4. Position is clamped to arena bounds

### Movement Speed

| Class   | Speed | With Cunning Action | With Dash |
|---------|-------|--------------------|-----------|
| Warrior | 30ft  | 30ft               | 60ft      |
| Mage    | 30ft  | 30ft               | 60ft      |
| Rogue   | 30ft  | 45ft (+15 bonus)   | 60ft      |
| Paladin | 30ft  | 30ft               | 60ft      |

### Cunning Action

The rogue's Cunning Action feature gives **+15ft passive movement** per turn.
This is NOT how Cunning Action works in 5e:

| Engine          | 5e RAW                                      |
|-----------------|---------------------------------------------|
| +15ft passive movement | Bonus action: Dash, Disengage, or Hide |

The 5e version costs a **bonus action** (which doesn't exist in the engine)
and gives a choice of three options.  The engine simplifies this to a passive
speed buff.

### Movement Resolution

```typescript
// resolveMove() in combat.ts
maxDist = speed + (hasCunningAction ? 15 : 0)
if (moveVector.magnitude > maxDist) {
  scale = maxDist / magnitude  // truncate to max distance
}
newPosition = clamp(position + scaledMove, arenaBounds)
```

---

## Reactions (Not Implemented)

5e reactions are actions taken on another creature's turn, such as:

| Reaction           | Trigger                          | Effect                    |
|--------------------|----------------------------------|---------------------------|
| Attack of Opportunity | Enemy leaves your reach       | One melee attack          |
| Shield spell       | Hit by an attack                | +5 AC (cast as reaction)  |
| Counterspell       | Enemy casts a spell             | Cancel the spell          |
| Uncanny Dodge      | Hit by an attack (rogue level 5)| Half damage               |

### Current Impact

Without reactions:
- **No attacks of opportunity** — characters can freely retreat without penalty
- **Shield is an action** instead of a reaction — casting it costs your turn
- **No Uncanny Dodge** — rogue can't halve incoming damage
- **No Counterspell** — mages can't counter each other

This is a **significant tactical gap** in melee vs ranged balance.

---

## Bonus Actions (Not Implemented)

5e bonus actions are "smaller" actions that happen alongside your main action:

| Bonus Action     | Class    | Effect                           |
|------------------|----------|----------------------------------|
| Off-hand attack  | Any (TWF)| Second weapon attack with smaller die |
| Healing Word     | Cleric/Paladin | Heal 1d4 + WIS mod           |
| Misty Step       | Caster  | Teleport 30ft                    |
| Cunning Action   | Rogue    | Dash, Disengage, or Hide         |

### Current Impact

Without bonus actions:
- Characters get exactly one action per turn (plus movement)
- Healing Word and Misty Step can't be added (would need the system)
- Two-Weapon Fighting is impossible
- Rogues get a passive speed buff instead of tactical Cunning Action choices
