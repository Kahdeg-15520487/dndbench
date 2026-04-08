# 01 — Core Mechanics

The engine implements the foundational D&D 5e d20 system.  This page covers
ability scores, modifiers, proficiency bonus, armor class, and hit points.

---

## Ability Scores

| Score | Modifier |
|-------|----------|
| 1     | −5       |
| 8     | −1       |
| 10    | +0       |
| 12    | +1       |
| 14    | +2       |
| 16    | +3       |
| 17    | +3       |
| 18    | +4       |
| 22    | +6       |
| 26    | +8       |

**Formula:** `modifier = floor((score − 10) / 2)`

Six abilities: **STR, DEX, CON, INT, WIS, CHA**.

### Implementation

- **File:** `src/engine/types.ts` → `abilityModifier(score: number): number`
- **Status:** ✅ Fully implemented, accurate to 5e PHB

---

## Proficiency Bonus

All characters are **Level 5**.  Proficiency bonus at level 5 is **+3**.

| Level Range | Proficiency |
|-------------|-------------|
| 1–4         | +2          |
| 5–8         | +3          |
| 9–12        | +4          |
| 13–16       | +5          |
| 17–20       | +6          |

### Implementation

- **Constant:** `PROF_BONUS = 3` in `characters.ts` and `bosses.ts`
- **Applied to:** Attack rolls, spell save DCs, saving throws with proficiency
- **Status:** ✅ Accurate for level 5.  Not dynamically calculated from level (hardcoded).

---

## Armor Class (AC)

AC is a fixed value per character preset.  It does **not** use the 5e formula
`10 + DEX mod` (unarmored) or `12/13/14 + DEX mod` (light/medium armor).

### Effective AC

During combat, base AC is modified by:

| Source         | Bonus | Duration           |
|----------------|-------|--------------------|
| Defend action  | +2    | Until next turn    |
| Shield spell   | +5    | 2 turns            |
| Shield of Faith| +2    | 3 turns            |

**Function:** `getEffectiveAc(char)` in `combat.ts`

### Class AC Values

| Class   | AC  | 5e Source (reference)           |
|---------|-----|---------------------------------|
| Warrior | 16  | Chain mail (16)                 |
| Mage    | 12  | 10 + DEX mod (+2) = unarmored   |
| Rogue   | 15  | Studded leather (12) + DEX (+3) |
| Paladin | 18  | Plate mail (18)                 |

### Implementation

- **Status:** ✅ Pre-calculated in class presets (correct for the assumed equipment)
- **Limitation:** AC doesn't recalculate when DEX changes (no stat-draining effects exist)

---

## Hit Points

HP is calculated using the 5e formula:

```
HP = HitDie + CON_mod + (Level − 1) × (floor(HitDie/2) + 1 + CON_mod)
```

For Level 5:

```
HP = HitDie + CON_mod + 4 × (floor(HitDie/2) + 1 + CON_mod)
```

### Class HP at Level 5

| Class   | Hit Die | CON | CON mod | HP Calculation                        | Total |
|---------|---------|-----|---------|---------------------------------------|-------|
| Warrior | d10     | 16  | +3      | 10+3 + 4×(5+1+3) = 13 + 36          | **49** |
| Mage    | d6      | 13  | +1      | 6+1 + 4×(3+1+1) = 7 + 20            | **27** |
| Rogue   | d8      | 14  | +2      | 8+2 + 4×(4+1+2) = 10 + 28           | **38** |
| Paladin | d10     | 14  | +2      | 10+2 + 4×(5+1+2) = 12 + 32          | **44** |

### Implementation

- **Function:** `calcHp(hitDie, levels, conScore)` in `characters.ts`
- **Status:** ✅ Fully accurate to 5e HP progression

---

## Hit Dice (Long Rest Healing)

Not implemented.  Characters do not have expendable hit dice for healing.
Battles are one-shot arena encounters — no rest cycle.

---

## Death Saves

Not implemented.  At 0 HP a character is instantly defeated (removed from
combat).  There is no unconscious/dying state, no death saves, and no
stabilization mechanic.

See [12-migration-gaps.md](12-migration-gaps.md) for details.

---

## Dice Rolling

All randomness flows through a single seeded PRNG (`DiceRoller`).

- **Algorithm:** mulberry32 (fast, deterministic)
- **Seed:** Random per battle, stored in `BattleLog.diceSeed` for replay
- **All rolls logged** with sequential numbering and context strings
- **Dice notation:** `"2d6"`, `"3d8+3"`, `"8d6"` etc.

### Implementation

- **File:** `src/engine/dice.ts`
- **Status:** ✅ Complete — supports `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, and arbitrary `NdS+M` notation
