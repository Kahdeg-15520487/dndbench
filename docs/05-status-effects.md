# 05 — Status Effects (Conditions)

D&D 5e defines 14 conditions.  The engine implements a subset as status effects
with timed durations.

---

## Implemented Status Effects

### burn
- **Effect:** Deals `potency` fire damage per turn
- **Duration:** `turnsRemaining` turns
- **Source:** Currently no spell or item applies burn (defined but unused)
- **5e Analog:** Not a standard 5e condition.  Closest is the "Alchemist's Fire" item igniting a creature.

### freeze
- **Effect:** Character **cannot act** — turn is skipped entirely
- **Duration:** `turnsRemaining` turns
- **Source:** Currently no spell applies freeze (defined but unused)
- **5e Analog:** Closest is the *Frozen* condition from environmental effects, or *Incapacitated* from certain spells.

### poison
- **Effect:** Deals `potency` poison damage per turn
- **Duration:** `turnsRemaining` turns
- **Source:** Currently no spell or item applies poison (defined but unused)
- **5e Analog:** *Poisoned* condition in 5e gives disadvantage on attack rolls and ability checks — NOT damage over time.  The DoT version is a homebrew mechanic.

### shield
- **Effect:** Adds `potency` to effective AC
- **Duration:** `turnsRemaining` turns
- **Source:** Shield spell (+5, 2 turns), Shield of Faith (+2, 3 turns)
- **5e Accuracy:** ⚠️ Shield should last 1 round (until start of next turn), not 2 turns. Shield of Faith should require concentration.

### defending
- **Effect:** +2 AC (set by `isDefending` flag)
- **Duration:** Until the character takes a non-defend action
- **Source:** Defend action
- **5e Analog:** The Dodge action in 5e.  Dodge gives: attackers have disadvantage, advantage on DEX saves.  This implementation only gives +2 AC.

### paralyzed
- **Effect:** Character cannot act (turn skipped).  Attacks against the target auto-hit and auto-crit.
- **Duration:** `turnsRemaining` turns (Hold Person = 1 turn)
- **Source:** Hold Person spell (WIS save negates)
- **5e Accuracy:** ⚠️ Mostly correct.  In 5e, auto-crit only applies from within 5ft.  Paralyzed targets also automatically fail STR and DEX saves, and attack rolls against them have advantage.  None of these are tracked.

### haste
- **Effect:** Defined in `StatusEffectType` but **no mechanic processes it**
- **Source:** No spell or item applies haste
- **5e Analog:** *Haste* spell — doubles speed, gives +2 AC, one extra action (limited).

### slow
- **Effect:** Defined in `StatusEffectType` but **no mechanic processes it**
- **Source:** No spell or item applies slow
- **5e Analog:** *Slow* spell — halves speed, can't use reactions, AC −2, no multiattack.

### regen
- **Effect:** Heals `potency` HP per turn
- **Duration:** `turnsRemaining` turns
- **Source:** Currently no spell or item applies regen (defined but unused)
- **5e Analog:** No standard 5e condition.  Closest is *Regenerate* spell or troll racial trait.

### blind
- **Effect:** Defined in `StatusEffectType` but **no mechanic processes it**
- **Source:** No spell or item applies blind
- **5e Analog:** *Blinded* condition — automatically fail sight-based checks, disadvantage on attacks, attackers have advantage.

---

## Status Effect Processing

Status effects are processed **once per round** after all characters have acted.

```
For each living character:
  For each status effect:
    Apply tick effect (damage/heal)
    Decrement turnsRemaining
    Remove if turnsRemaining <= 0
```

### Implementation

- **Function:** `processStatusEffects(character)` in `combat.ts`
- **Called from:** `BattleRunner.processRoundEndStatusEffects()` after all turns

---

## How Conditions are Applied

| Mechanism     | Example                                    |
|---------------|--------------------------------------------|
| Spell hit     | Hold Person pushes `{ type: "paralyzed" }` |
| Buff spell    | Shield pushes `{ type: "shield", potency: 5 }` |
| Item use      | Antidote removes all status effects        |

### What Removes Status Effects

| Method        | Effects Removed |
|---------------|-----------------|
| Duration expiry | All (natural removal) |
| Antidote item  | All             |
| Elixir item    | All             |

---

## 5e Conditions NOT Implemented

| Condition      | Effect in 5e                                          | Priority |
|----------------|-------------------------------------------------------|----------|
| Blinded        | Disadvantage on attacks, auto-fail sight checks       | Medium   |
| Charmed        | Can't attack charmer, advantage on CHA checks         | Low      |
| Deafened       | Can't hear, auto-fail hearing checks                  | Low      |
| Exhaustion     | Cumulative penalties (disadvantage, half speed, etc.) | Low      |
| Frightened     | Can't move toward source, disadvantage on checks      | Medium   |
| Grappled       | Speed becomes 0                                       | Medium   |
| Incapacitated  | Can't take actions or reactions                       | Medium   |
| Invisible      | Can't be targeted directly, advantage on attacks      | Medium   |
| Prone          | Disadvantage on attacks, melee advantage against      | Medium   |
| Restrained     | Speed 0, disadvantage on attacks and DEX saves        | Low      |
| Stunned        | Incapacitated, can't move, auto-fail STR/DEX saves    | High     |
| Unconscious    | Incapacitated, drop prone, auto-fail STR/DEX saves    | High     |

---

## Missing Status Effect Mechanics

### Advantage / Disadvantage

5e's core d20 mechanic: roll 2d20 and take the better (advantage) or worse
(disadvantage) result.  No status effect currently grants or imposes advantage
on attack rolls or saving throws.

This is a **foundational missing system** — many 5e features depend on it:
- Paralyzed should give advantage on attacks against
- Blinded should give disadvantage on attacks
- Dodging should impose disadvantage on attackers
- Flanking should give advantage

### Resistance / Vulnerability / Immunity

No damage type interactions exist.  All damage is applied at face value:
- No resistance (half damage from a type)
- No vulnerability (double damage from a type)
- No immunity (zero damage from a type)
