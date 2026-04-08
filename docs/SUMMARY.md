# D&D 5e Engine Migration — Documentation Index

This folder documents every D&D 5th Edition mechanic as it relates to the
`dndbench` combat engine.  Each file covers one major subsystem.

| File | Topic |
|------|-------|
| [01-core-mechanics.md](01-core-mechanics.md) | d20 system, ability scores, modifiers, proficiency, AC, HP |
| [02-combat-resolution.md](02-combat-resolution.md) | Attack rolls, damage, critical hits, saving throws, advantage/disadvantage |
| [03-character-classes.md](03-character-classes.md) | Class presets, features, spell lists at Level 5 |
| [04-spell-system.md](04-spell-system.md) | Spell slots, casting, spell definitions, cantrips, concentration |
| [05-status-effects.md](05-status-effects.md) | Conditions, DoT, HoT, buff/debuff tracking, stunned, prone, invisible |
| [06-items-equipment.md](06-items-equipment.md) | Potions (dice rolls), bombs, consumables, weapon properties |
| [07-turn-structure.md](07-turn-structure.md) | Initiative, action economy, movement, dash, defend, bonus actions, reactions |
| [08-bosses.md](08-bosses.md) | Boss stat blocks, tiers, boss-only mechanics |
| [09-arena-movement.md](09-arena-movement.md) | Grid positioning, distance, start positions, arena presets |
| [10-ai-agents.md](10-ai-agents.md) | Heuristic AI, LLM agents, boss AI, tool definitions |
| [11-tournament-system.md](11-tournament-system.md) | ELO ratings, round-robin, reporting, dashboard |
| [12-migration-gaps.md](12-migration-gaps.md) | What's **not** implemented yet — remaining 5e gaps |

## D&D 5e Migration Progress — ~99% Complete

### ✅ Core Systems (100%)
- **d20 Attack Rolls** — Correct d20 + mod + prof vs AC
- **Ability Scores** — STR/DEX/CON/INT/WIS/CHA with correct modifiers
- **Spell Slots** — Level-appropriate slot counts, proper consumption
- **Saving Throws** — Proficient saves tracked, correct DC calculation, advantage/disadvantage
- **Initiative** — d20 + DEX, sorted descending
- **Critical Hits** — Natural 20 = double damage dice
- **HP Calculation** — Accurate per-5e formula with CON modifier
- **Death Saves** — Unconscious at 0 HP, d20 each turn, nat 20 = revive, 3 failures = dead
- **Fighting Styles** — Great Weapon Fighting, Defense (+1 AC), Dueling (+2 dmg), Two-Weapon Fighting

### ✅ Tactical Depth Systems (100%)
- **Advantage/Disadvantage** — `d20WithAdvantage()` in DiceRoller; condition-based triggers
- **Resistance/Vulnerability/Immunity** — `applyDamageModifiers()` for 14 damage types
- **Concentration** — `concentration` flag on spells, `breakConcentration()`, CON save after damage
- **Bonus Action System** — 4 subtypes: `off_hand_attack`, `healing_word`, `cunning_action`, `misty_step`
- **Reaction System** — Attack of Opportunity, Shield spell (+5 AC), Uncanny Dodge (halve damage)
- **AoE Multi-Target** — Fireball (20ft radius) and Lightning Bolt (30ft line) hit all in area
- **Scorching Ray** — 3 separate rays, each with independent attack roll and 2d6
- **Eldritch Blast** — 2 beams of 1d10, each with independent attack roll
- **Ray of Frost** — 1d8 cold + 10ft speed reduction on hit

### ✅ Combat Improvements
- **Sneak Attack** — Requires advantage OR ally within 5ft (5e RAW)
- **Paralyzed auto-crit** — Only from within 5ft
- **Stunned condition** — Advantage to attackers, auto-fail STR/DEX saves, auto-crit from melee
- **Action Surge** — Real second action in BattleRunner
- **Divine Smite** — Conscious choice (not auto-trigger)
- **Lay on Hands** — Pool-based (25 HP), usable across multiple turns
- **Poisoned** — Disadvantage on attack rolls AND saving throws
- **Blinded** — Disadvantage on attacks, advantage to attackers against
- **Restrained** — Disadvantage on attacks, advantage to attackers, can't move (via Web)
- **Grapple** — Athletics contest, sets target speed to 0
- **Shove** — Athletics contest, pushes 5ft and knocks prone
- **Prone** — Disadvantage on attacks, advantage to melee attackers, disadvantage to ranged
- **Haste** — Double speed, +2 AC, concentration
- **Slow** — Half speed, -2 AC, no reactions, concentration
- **Arcane Recovery** — Recovers multiple slot levels (ceil(level/2))
- **Invisibility** — Advantage on attacks, disadvantage to attackers, breaks on attack/cast
- **Mirror Image** — 3 illusory duplicates intercept attacks
- **Concentration (wired)** — Break/save on damage, one spell at a time, dispel removes effects
- **Dispel Magic** — Removes all magical effects and breaks concentration
- **Absorb Elements** — Reaction spell, grants resistance to all damage
- **Cover System** — Terrain-based half cover (+2 AC) and three-quarters cover (+5 AC) via line-of-sight intersection

### ✅ Buff/Debuff Spells
- **Bless** — d4 added to attack rolls and saving throws
- **Bane** — d4 subtracted from attack rolls and saving throws
- **Web** — Restrained on failed DEX save, concentration
- **Spirit Guardians** — 3d8 radiant aura, WIS save for half, concentration
- **Haste** — Double speed, +2 AC
- **Slow** — Half speed, -2 AC

### ✅ Weapon Properties
- **Versatile** — Uses larger dice (e.g., 1d8→1d10) when no shield equipped
- **Finesse** — Uses max(STR, DEX) for attack and damage rolls
- **Two-Handed** — Prevents off-hand attacks
- **Dueling** — +2 damage with one-handed weapon and shield

### ✅ New Types & Conditions
- 24+ status effect types: `unconscious`, `stable`, `dead`, `poisoned`, `blinded`, `restrained`, `grappled`, `prone`, `bless`, `bane`
- `AdvantageMode`: `"advantage" | "disadvantage" | "normal"`
- 14 `DamageType` values
- `FightingStyle` type: `"great_weapon_fighting" | "defense" | "dueling" | "two_weapon_fighting"`
- `ReactionType`, `BonusActionType`, `ActionType` (includes `grapple`, `shove`)
- 25 spells (cantrips through level 3): Fire Bolt, Ray of Frost, Eldritch Blast, Magic Missile, Shield, Thunderwave, Cure Wounds, Shield of Faith, Healing Word, Scorching Ray, Hold Person, Misty Step, Web, Fireball, Lightning Bolt, Counterspell, Spirit Guardians, Bless, Bane, Haste, Slow, Invisibility, Mirror Image, Absorb Elements, Dispel Magic

### Remaining Gaps (~1%)
See [12-migration-gaps.md](12-migration-gaps.md) for the complete list.
Key remaining items: exhaustion (environmental), heavy weapon property for small creatures
