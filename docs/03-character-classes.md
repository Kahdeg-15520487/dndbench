# 03 — Character Classes

All player characters are **Level 5**.  This page covers the four playable
classes, their features, and how each maps to D&D 5e.

---

## Class Presets

### Warrior (Fighter)

| Stat        | Value |
|-------------|-------|
| STR         | 17 (+3) |
| DEX         | 14 (+2) |
| CON         | 16 (+3) |
| INT         | 8 (−1)  |
| WIS         | 12 (+1) |
| CHA         | 10 (+0) |
| AC          | 16    |
| HP          | 49    |
| Speed       | 30ft  |
| Weapon      | Greatsword (2d6 + STR) |
| Save Profs  | STR, CON |

**Features:**

| Feature        | Uses | 5e Accuracy |
|----------------|------|-------------|
| Extra Attack   | ∞    | ✅ Correct — 2 attacks per Attack action at Fighter 5 |
| Second Wind    | 1    | ✅ Correct — heal 1d10+5, bonus action, 1/short rest |
| Action Surge   | 1    | ⚠️ Defined but **does not grant a second action** in the battle runner |

**Inventory:** 3× Health Potion, 1× Greater Health Potion, 2× Bomb

**5e Note:** Warrior is a simplified Fighter.  Missing: Fighting Style, Indomitable (con save reroll at level 9), Martial Archetype.

---

### Mage (Wizard)

| Stat        | Value |
|-------------|-------|
| STR         | 8 (−1)  |
| DEX         | 14 (+2) |
| CON         | 13 (+1) |
| INT         | 17 (+3) |
| WIS         | 12 (+1) |
| CHA         | 10 (+0) |
| AC          | 12    |
| HP          | 27    |
| Speed       | 30ft  |
| Weapon      | Quarterstaff (1d6 + STR) |
| Save Profs  | INT, WIS |

**Spell Slots:**

| Level | Total |
|-------|-------|
| 1st   | 4     |
| 2nd   | 3     |
| 3rd   | 2     |

**Spells:** Fire Bolt, Magic Missile, Shield, Thunderwave, Scorching Ray, Hold Person, Fireball, Lightning Bolt

**Features:**

| Feature          | Uses | 5e Accuracy |
|------------------|------|-------------|
| Arcane Recovery  | 1    | ✅ Recovers one highest-level expended slot |

**Inventory:** 2× Health Potion, 1× Greater Health Potion, 1× Bomb

**5e Note:** Correct spell slot count for a level 5 wizard.  Missing: Spellbook, ritual casting, Arcane Tradition (school specialization).

---

### Rogue

| Stat        | Value |
|-------------|-------|
| STR         | 10 (+0) |
| DEX         | 17 (+3) |
| CON         | 14 (+2) |
| INT         | 13 (+1) |
| WIS         | 12 (+1) |
| CHA         | 8 (−1)  |
| AC          | 15    |
| HP          | 38    |
| Speed       | 30ft  |
| Weapon      | Rapier (1d8 + DEX) — finesse weapon |
| Save Profs  | DEX, INT |

**Features:**

| Feature         | Uses | 5e Accuracy |
|-----------------|------|-------------|
| Sneak Attack    | ∞    | ⚠️ +3d6 once/turn, but no activation condition check |
| Evasion         | ∞    | ✅ No damage on successful DEX save |
| Cunning Action  | ∞    | ⚠️ Gives +15ft movement instead of bonus action Dash/Disengage/Hide |

**Inventory:** 2× Health Potion, 1× Greater Health Potion, 2× Bomb, 1× Antidote

**5e Note:** Sneak Attack damage is correct (3d6 = 1d6 per 2 rogue levels).  Cunning Action should be a bonus action, not a passive movement buff.  Missing: Uncanny Dodge (level 5 reaction), Thieves' Cant, Expertise.

---

### Paladin

| Stat        | Value |
|-------------|-------|
| STR         | 17 (+3) |
| DEX         | 8 (−1)  |
| CON         | 14 (+2) |
| INT         | 10 (+0) |
| WIS         | 13 (+1) |
| CHA         | 15 (+2) |
| AC          | 18    |
| HP          | 44    |
| Speed       | 30ft  |
| Weapon      | Longsword (1d8 + STR) — versatile |
| Save Profs  | WIS, CHA |

**Spell Slots:**

| Level | Total |
|-------|-------|
| 1st   | 4     |
| 2nd   | 2     |

**Spells:** Cure Wounds, Shield of Faith

**Features:**

| Feature       | Uses | 5e Accuracy |
|---------------|------|-------------|
| Extra Attack  | ∞    | ✅ Correct at Paladin 5 |
| Divine Smite  | ∞    | ⚠️ Auto-fires on every hit — player cannot choose when to smite |
| Lay on Hands  | 1    | ⚠️ Heals up to 25 HP once. 5e uses a 25 HP pool distributable across uses/turns |

**Inventory:** 3× Health Potion, 1× Greater Health Potion, 1× Elixir

**5e Note:** Correct slot count for Paladin 5 (4/2).  Missing: Divine Sense, Lay on Hands as a pool, Fighting Style, Aura of Courage (level 6), Divine Health, Sacred Oath.

---

## Feature Resolution

Features are resolved via `resolveClassAbility()` in `combat.ts`.

### Fully Working

| Ability          | Resolution |
|------------------|------------|
| Second Wind      | Rolls 1d10+5, heals caster |
| Lay on Hands     | Heals up to 25 HP |
| Arcane Recovery  | Recovers one highest-level expended slot |
| Extra Attack     | Automatic second attack on hit |
| Sneak Attack     | Automatic +3d6 on first hit |
| Divine Smite     | Automatic on hit with available slots |
| Evasion          | Reduces AoE damage to 0 on successful save |

### Partially Working

| Ability          | Issue |
|------------------|-------|
| Action Surge     | Defined but battle runner doesn't grant a second action |
| Cunning Action   | Gives passive +15ft movement instead of bonus action options |
