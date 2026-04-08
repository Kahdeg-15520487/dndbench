# 12 — Migration Gaps

Everything from D&D 5e that is **not yet implemented** in the engine,
organized by impact level.

---

## 🟢 Minor Gaps (Low Impact)

### 1. No Weapon Property Enforcement (Partial)

Most weapon properties now have mechanical effects:
- ✅ `versatile` — Uses larger dice when no shield equipped
- ✅ `finesse` — Uses max(STR, DEX) for attack and damage rolls
- ✅ `two-handed` — Prevents off-hand attacks when equipped
- ❌ `heavy` — Should give small creatures disadvantage (no small creatures)
- ✅ `reach` — Implicitly handled by `weapon.range` (10ft melee)

---

### 2. No Exhaustion Mechanic

Exhaustion is a cumulative penalty in 5e (up to 6 levels, death at 6th).
Not implemented. No environmental or narrative effects cause exhaustion.

---

### 3. No Rest System (Short/Long Rest)

Battles are one-shot encounters. No:
- Short rest (recover hit dice + certain abilities)
- Long rest (full heal, recover all slots + abilities)

This is appropriate for arena combat but limits campaign/series play.

---

### 4. Cover System (Implemented)

Cover is now terrain-based:
- ✅ `CoverObject` type with `half` (+2 AC) and `three_quarters` (+5 AC) cover levels
- ✅ Line-of-sight intersection check between attacker and defender
- ✅ All arena presets have cover objects
- ✅ `getCoverBonus()` wired into `getEffectiveAc()` for both weapon and spell attacks
All combat happens in open ground.

---

### 5. No remaining spell gaps
All planned spells through level 3 are implemented.

---

## Summary: Migration Completion by Category

| Category                   | Completion | Notes                                |
|---------------------------|------------|--------------------------------------|
| Core d20 system           | ✅ 100%   | Attack rolls, crits, saves           |
| Ability scores/modifiers  | ✅ 100%   | Correct formula                      |
| Spell slot system         | ✅ 100%   | Correct counts for level 5           |
| HP calculation            | ✅ 100%   | Accurate per-5e formula              |
| Saving throws             | ✅ 100%   | With proficiency, advantage/disadvantage |
| Initiative                | ✅ 100%   | d20 + DEX                            |
| Advantage/Disadvantage    | ✅ 100%   | Condition-based, flanking, prone     |
| Concentration             | ✅ 100%   | Break/save on damage, one at a time  |
| Reactions                 | ✅ 100%   | Opportunity attack, Shield, Uncanny Dodge |
| Bonus Actions             | ✅ 100%   | Off-hand, Healing Word, Cunning Action, Misty Step |
| Resistance/Vulnerability  | ✅ 100%   | 14 damage types, applyDamageModifiers |
| AoE Multi-Target          | ✅ 100%   | Fireball/Lightning Bolt hit area     |
| Scorching Ray Multi-Hit   | ✅ 100%   | 3 separate rays with individual rolls|
| Divine Smite              | ✅ 100%   | Conscious choice, not auto-trigger   |
| Death Saves               | ✅ 100%   | Unconscious at 0 HP, nat 20 revive   |
| Fighting Styles           | ✅ 100%   | GWF, Defense, Dueling, Two-Weapon    |
| Lay on Hands              | ✅ 100%   | Pool-based (25 HP), multi-use        |
| Conditions (full set)     | ✅ 100%   | 24 types incl. poisoned, blinded, restrained, grappled, prone |
| Weapon Properties         | ✅ 95%   | Versatile + Finesse + Two-Handed + Reach (via range) |
| Spell list (25 spells)    | ✅ 100%   | Cantrips through level 3             |
| Concentration (wired)     | ✅ 100%   | Break/save on damage, one at a time  |
| Dispel Magic              | ✅ 100%   | Remove magical effects, break conc   |
| Absorb Elements           | ✅ 100%   | Reaction, resistance to all damage   |
| Invisibility              | ✅ 100%   | Advantage on attacks, breaks on attack/cast |
| Mirror Image              | ✅ 100%   | Duplicate intercepts attacks, 3 images |
| Cover                     | ✅ 100%   | Half (+2 AC) and three-quarters (+5 AC) |
| **Overall estimate**      | **~99%**  | Comprehensive tactical combat engine  |
