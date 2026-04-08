# 08 — Bosses

Boss encounters use the same `Character` type as player characters, with
significantly boosted stats.  Bosses are tiered from 1 (easiest) to 5
(hardest).

---

## Boss Stat Blocks

### Tier 1 — Goblin King 👑

| Stat        | Value             |
|-------------|-------------------|
| STR/DEX/CON | 16 / 14 / 14     |
| INT/WIS/CHA | 10 / 10 / 12     |
| AC          | 15                |
| HP          | 65                |
| Speed       | 30ft              |
| Weapon      | Scimitar (1d6 + STR, finesse) |
| Features    | Extra Attack, Second Wind (1) |
| Items       | 2× Health Potion, 2× Bomb |
| Level       | 7 (5 + tier×2)   |

**Design:** A tough goblin with multiattack and explosives.  Entry-level boss
for a single level 5 character.

---

### Tier 2 — Dark Wizard 🧙

| Stat        | Value             |
|-------------|-------------------|
| STR/DEX/CON | 6 / 14 / 12      |
| INT/WIS/CHA | 18 / 14 / 12     |
| AC          | 13                |
| HP          | 60                |
| Speed       | 30ft              |
| Weapon      | Quarterstaff (1d6 + STR) |
| Spell Slots | 1st: 4, 2nd: 3, 3rd: 2 |
| Spells      | Fire Bolt, Magic Missile, Shield, Thunderwave, Scorching Ray, Hold Person, Fireball |
| Features    | Arcane Recovery (1) |
| Items       | 2× Health Potion, 1× Greater Health Potion |
| Level       | 9                 |

**Design:** Glass cannon mage.  Fireball deals 8d6 (avg 28) which can one-shot
a level 5 character.  Low AC and HP make it vulnerable to melee rush.

---

### Tier 3 — Ancient Dragon 🐉

| Stat        | Value             |
|-------------|-------------------|
| STR/DEX/CON | 24 / 10 / 22     |
| INT/WIS/CHA | 14 / 16 / 18     |
| AC          | 20                |
| HP          | 200               |
| Speed       | 40ft              |
| Weapon      | Bite (2d10 + STR, reach 10ft) |
| Features    | Extra Attack, Action Surge (1) |
| Level       | 11                |

**Design:** Pure physical powerhouse.  AC 20 makes it very hard to hit.  Bite
deals 2d10+7 (avg 18) and it attacks twice.  No spells, no items.

> **5e Note:** Ancient dragons in 5e have Legendary Actions (3/turn), Legendary
> Resistance (3/day — auto-succeed a save), Lair Actions, a breath weapon,
> Frightful Presence, and multiattack (Bite + Claw + Tail).  This boss has
> none of those — just Extra Attack and Action Surge.

---

### Tier 4 — Lich Lord 💀

| Stat        | Value             |
|-------------|-------------------|
| STR/DEX/CON | 8 / 14 / 16      |
| INT/WIS/CHA | 22 / 18 / 20     |
| AC          | 17                |
| HP          | 135               |
| Speed       | 30ft              |
| Weapon      | Necrotic Touch (1d8 + INT, magical) |
| Spell Slots | 1st: 4, 2nd: 3, 3rd: 3 |
| Spells      | Full mage spell list + Lightning Bolt |
| Features    | Arcane Recovery (1) |
| Level       | 13                |

**Design:** Undead archmage.  INT 22 gives spell save DC of 18 — very hard to
resist.  Higher spell slot count than the Dark Wizard.  Moderate HP and AC.

> **5e Note:** Liches in 5e have Legendary Resistance (3/day), Legendary Actions
> (Cantrip, Paralyzing Touch, Disrupt Life), Lair Actions, and Rejuvenation
> (respawns in 1d10 days if phylactery exists).  None implemented.

---

### Tier 5 — Demon Lord 👹

| Stat        | Value             |
|-------------|-------------------|
| STR/DEX/CON | 26 / 14 / 24     |
| INT/WIS/CHA | 16 / 18 / 22     |
| AC          | 22                |
| HP          | 300               |
| Speed       | 40ft              |
| Weapon      | Flaming Greatsword (3d6 + STR, reach 10ft, magical) |
| Spell Slots | 1st: 4, 2nd: 3, 3rd: 3 |
| Spells      | Fire Bolt, Fireball, Lightning Bolt, Shield |
| Features    | Extra Attack, Action Surge (2), Second Wind (2) |
| Level       | 15                |

**Design:** Apex predator.  +8 STR with 3d6 weapon = massive melee damage.
AC 22 and 300 HP make it nearly unkillable.  Has spells for ranged options
and double Action Surge for burst turns.

> **5e Note:** Demon Lords in 5e (Demogorgon, Orcus, etc.) have Legendary
> Resistance, Legendary Actions with multiple options, Lair Actions, Magic
> Resistance (advantage on saves vs spells), and unique signature abilities.
> None implemented.

---

## Missing Boss Mechanics

| Mechanic              | 5e Usage                              | Priority |
|-----------------------|---------------------------------------|----------|
| Legendary Actions     | Extra actions at end of other turns   | High     |
| Legendary Resistance  | Auto-succeed 3 saves per day          | High     |
| Lair Actions          | Environmental effects on initiative count 20 | Medium |
| Multiattack (mixed)   | Bite + Claw (different weapons)       | Medium   |
| Frightful Presence    | AoE fear effect                       | Low      |
| Breath Weapons        | AoE damage (cone/line)                | High     |
| Magic Resistance      | Advantage on saves vs spells          | Medium   |
| Damage Immunities     | e.g., fire immune dragon              | Medium   |
| Condition Immunities  | e.g., immune to charm, poison         | Low      |

---

## Boss Agent (AI)

Bosses use the same agent interface as other characters.  In tournaments,
bosses use `HeuristicAgent` or `LLMAgent` depending on configuration.

The `BossAgent` in `src/agent/boss-agent.ts` is a specialized heuristic agent
with boss-specific priorities:

- Prioritizes big spells when available
- Uses items when HP drops below thresholds
- Targets lowest-HP enemy
- Uses Action Surge at optimal moments

---

## Boss Creation

Bosses are created with `createBoss(id, position?, team?)`:

```typescript
const boss = createBoss("ancient_dragon", { x: 50, y: 40 }, "boss");
```

Boss characters use `class: "boss"` and their level is `5 + tier × 2`.

All bosses share the same saving throw proficiencies: **CON, WIS**.
