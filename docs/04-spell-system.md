# 04 — Spell System

How spells, spell slots, and casting work.

---

## Spell Slots

Characters have a fixed number of spell slots per level.  Casting a spell of
level 1+ consumes one slot of that level.  Cantrips (level 0) are free.

### Slot Grids at Level 5

| Class   | 1st | 2nd | 3rd |
|---------|-----|-----|-----|
| Warrior | —   | —   | —   |
| Mage    | 4   | 3   | 2   |
| Rogue   | —   | —   | —   |
| Paladin | 4   | 2   | —   |

**5e Accuracy:** ✅ Correct slot counts for full-caster (wizard 5) and half-caster (paladin 5).

### Slot Tracking

Each slot level tracks `{ total, used }`.  When `used >= total`, no more
spells of that level can be cast.

- `hasSpellSlot(slots, level)` — check availability
- `consumeSpellSlot(slots, level)` — mark one as used
- `remainingSlots(slots, level)` — count remaining
- `totalRemainingSlots(slots)` — sum across all levels

---

## Spell Definitions

10 spells are implemented:

### Cantrips (Level 0 — No Slot Required)

| Spell     | Type   | Mechanic                              | 5e RAW Damage |
|-----------|--------|---------------------------------------|---------------|
| Fire Bolt | Damage | 2d10 fire, ranged spell attack        | ✅ 2d10       |

> **5e Note:** Fire Bolt should scale with character level (2d10 at 1-4, **3d10** at 5-10, 4d10 at 11-16, 5d10 at 17-20).  Currently fixed at 2d10 — **missing the level 5 upgrade to 3d10**.

### Level 1 Spells

| Spell           | Type   | Mechanic                                    | 5e RAW      |
|-----------------|--------|---------------------------------------------|-------------|
| Magic Missile   | Damage | 3d4+3 force, auto-hit                       | ✅ Correct  |
| Shield          | Buff   | +5 AC for 2 turns                           | ⚠️ 5e: +5 AC until start of next turn (1 round), not 2 turns |
| Thunderwave     | Damage | 2d8 thunder, CON save half                  | ✅ Correct  |
| Cure Wounds     | Heal   | 1d8 + WIS mod                               | ✅ Correct  |
| Shield of Faith | Buff   | +2 AC for 3 turns                           | ⚠️ 5e: Concentration, up to 10 minutes. No concentration tracking here. |

### Level 2 Spells

| Spell          | Type   | Mechanic                                      | 5e RAW      |
|----------------|--------|-----------------------------------------------|-------------|
| Scorching Ray  | Damage | 6d6 fire, ranged spell attack                 | ⚠️ 5e: 3 rays of 2d6 each, each with separate attack roll. Currently one 6d6 roll |
| Hold Person    | Status | Paralyzed 1 turn, WIS save negates            | ⚠️ 5e: Concentration, can upcast for more targets. Duration here is 1 turn (5e: 1 minute) |
|                |        |                                               | ⚠️ Coded as type "damage" with 0 damage dice — should be type "status" or "control" |

### Level 3 Spells

| Spell           | Type   | Mechanic                              | 5e RAW      |
|-----------------|--------|---------------------------------------|-------------|
| Fireball        | Damage | 8d6 fire, DEX save half               | ✅ Correct damage dice |
| Lightning Bolt  | Damage | 8d6 lightning, DEX save half          | ✅ Correct damage dice |

> **5e Note:** Both Fireball and Lightning Bolt are AoE spells.  They currently hit only one target.  In multi-unit battles (2v2, FFA), they should hit all enemies in the area.

---

## Spell Cooldowns

Each spell has a `cooldown` value.  After casting, `currentCooldown` is set to
the spell's cooldown value.  It decrements by 1 each turn.

| Spell           | Cooldown (turns) |
|-----------------|------------------|
| Fire Bolt       | 0 (cantrip)      |
| Magic Missile   | 0                |
| Shield          | 2                |
| Thunderwave     | 1                |
| Cure Wounds     | 1                |
| Shield of Faith | 3                |
| Scorching Ray   | 2                |
| Hold Person     | 3                |
| Fireball        | 4                |
| Lightning Bolt  | 4                |

> **5e Note:** D&D 5e does NOT use spell cooldowns.  Spells can be cast every turn as long as you have slots.  The cooldown system is a **homebrew mechanic** for game balance, preventing spell spam.

---

## Concentration

Not implemented.  In 5e, many spells require **concentration** — you can only
maintain one concentration spell at a time.  Currently, buffs stack freely:
a mage can have Shield (+5 AC) and Shield of Faith is defined but only the
mage's own Shield can be active (since `shield_of_faith` is only on the
paladin spell list).  The paladin could in theory have Shield of Faith + be
target of another buff.

### What's Missing

- Concentration flag on spells
- Concentration tracking (max 1 at a time)
- Constitution save to maintain concentration on damage
- Losing concentration when casting a new concentration spell

---

## Spell Save DC

```
Save DC = 8 + Casting Ability Modifier + Proficiency Bonus
```

| Class   | Casting Ability | Mod | DC  |
|---------|-----------------|-----|-----|
| Mage    | INT             | +3  | 14  |
| Paladin | WIS (Cure Wounds), CHA (Shield of Faith) | +1/+2 | 12/13 |

> **5e Note:** Paladin spells should all use CHA as the casting ability.
> Cure Wounds uses `healAbilityMod: "wis"` for the healing amount, but
> `castingAbility: "wis"` for the DC — in 5e, paladin DC is CHA-based.

---

## Arcane Recovery

Once per battle, the mage can recover one expended spell slot (highest level
available).  In 5e RAW, Arcane Recovery recovers spell slot levels equal to
half the wizard level (rounded up) = **3 levels** at level 5.  For example,
recover one 3rd-level slot, or one 2nd + one 1st.

### Current Implementation

Recovers exactly **one** highest-level expended slot.  This is weaker than
5e RAW (should recover up to 3 levels worth of slots).
