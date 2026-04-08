# 02 — Combat Resolution

How attacks, spells, and damage are resolved using D&D 5e rules.

---

## Attack Roll (d20 vs AC)

```
Attack Roll = d20 + Ability Modifier + Proficiency Bonus
```

| d20 Result | Outcome                                    |
|------------|--------------------------------------------|
| Natural 1  | Automatic miss (critical fumble)           |
| Natural 20 | Automatic hit + critical hit               |
| Other      | Hit if total ≥ target's effective AC       |

### Implementation

- **Function:** `resolveSingleAttack()` in `combat.ts`
- **Status:** ✅ Accurate to 5e PHB

---

## Weapon Damage

On a hit:

```
Damage = Weapon Damage Dice + Ability Modifier
```

### Critical Hits

On a natural 20, damage dice are **doubled** (modifiers are NOT doubled).

| Weapon        | Normal     | Crit          |
|---------------|------------|---------------|
| Greatsword    | 2d6 + STR  | **4d6** + STR |
| Rapier        | 1d8 + DEX  | **2d8** + DEX |
| Longsword     | 1d8 + STR  | **2d8** + STR |
| Quarterstaff  | 1d6 + STR  | **2d6** + STR |
| Scimitar      | 1d6 + STR  | **2d6** + STR |
| Bite (dragon) | 2d10 + STR | **4d10** + STR |
| Flaming GS    | 3d6 + STR  | **6d6** + STR |

### Paralyzed Target

When the defender has the `paralyzed` status effect:
- Attacks **auto-hit** regardless of roll
- Attacks **auto-crit** (double damage dice)
- This applies from **any range** (not just within 5ft as per 5e RAW)

### Implementation

- **Function:** `rollWeaponDamage()` in `combat.ts`
- **Status:** ⚠️ Mostly accurate. Paralyzed auto-crit should only apply within 5ft (5e RAW: "any attack that hits the creature is a critical hit if the attacker is within 5 feet of the creature").

---

## Saving Throws

When a spell requires a saving throw:

```
Save DC = 8 + Casting Ability Modifier + Proficiency Bonus

Save Roll = d20 + Ability Modifier + (Proficiency Bonus if proficient)
```

| Condition              | Outcome                              |
|------------------------|--------------------------------------|
| Save ≥ DC              | Success (effect reduced or negated)  |
| Save < DC              | Failure (full effect)                |

### Class Saving Throw Proficiencies

| Class   | Proficient Saves |
|---------|------------------|
| Warrior | STR, CON         |
| Mage    | INT, WIS         |
| Rogue   | DEX, INT         |
| Paladin | WIS, CHA         |
| Bosses  | CON, WIS         |

### Half Damage on Save

Some spells deal half damage on a successful save:

| Spell            | Save | Half on Success? |
|------------------|------|------------------|
| Thunderwave      | CON  | Yes              |
| Fireball         | DEX  | Yes              |
| Lightning Bolt   | DEX  | Yes              |
| Hold Person      | WIS  | No (status only) |

### Evasion (Rogue Feature)

Rogues with the `evasion` feature take **no damage** instead of half damage
on a successful DEX save.  This is called out in the spell damage path.

### Implementation

- **Function:** Inside `resolveSpell()` in `combat.ts`
- **Status:** ✅ Accurate to 5e PHB

---

## Sneak Attack

Rogues deal extra damage on the first hit each turn:

```
Sneak Attack Damage = +3d6 (once per turn)
```

### Activation Requirements (5e RAW)

Per 5e PHB, Sneak Attack requires **one** of:
1. Advantage on the attack roll, OR
2. Another enemy of the target within 5ft of the target

### Current Implementation

⚠️ Sneak Attack fires on **every first hit** with no condition check — no
advantage or ally requirement.  Always active.

### Implementation

- **Location:** `resolveAttack()` in `combat.ts`
- **Status:** ⚠️ Damage amount is correct (3d6), activation conditions are NOT checked

---

## Extra Attack (Fighter / Paladin)

Characters with the `extra_attack` feature make a second attack after hitting
with their first attack.  Both attacks use the same weapon.

- Second attack gets its own d20 roll
- Second attack can independently crit or miss
- Both attacks target the same enemy

### Implementation

- **Location:** `resolveAttack()` in `combat.ts`
- **Status:** ✅ Accurate.  Both attacks roll independently.

---

## Divine Smite (Paladin)

On a weapon hit, paladins burn a spell slot for extra radiant damage:

```
Smite Damage = 2d8 + 1d8 per spell slot level above 1st
```

| Slot Level | Smite Dice |
|------------|------------|
| 1st        | 2d8        |
| 2nd        | 3d8        |

### Current Behavior

⚠️ Smite **auto-fires** on every hit, consuming the lowest available slot.
The paladin cannot choose when to smite.

Per 5e RAW, the paladin decides to smite **after** seeing the attack hit.

### Implementation

- **Location:** `resolveAttack()` in `combat.ts`
- **Status:** ⚠️ Mechanically correct (dice and slot consumption), but no player agency

---

## Spell Attack Rolls

Some spells use a spell attack roll instead of a saving throw:

```
Spell Attack = d20 + Casting Ability Modifier + Proficiency Bonus
```

Spells that use attack rolls: **Fire Bolt**, **Scorching Ray**

- Natural 20 = critical hit (damage dice doubled)
- Natural 1 = automatic miss

### Implementation

- **Location:** Inside `resolveSpell()` in `combat.ts`
- **Status:** ✅ Accurate to 5e PHB

---

## Damage Application

```
Target HP = max(0, Target HP − Total Damage)
```

Damage is applied sequentially within a single action:
1. Main attack damage → applied to HP
2. Sneak attack damage → added and applied
3. Extra attack damage → applied separately
4. Divine Smite damage → applied separately

All damage is subtractive — there is no damage resistance, vulnerability, or
immunity system.

### Implementation

- **Status:** ✅ Accurate for basic damage.  No resistance/vulnerability/immunity.
