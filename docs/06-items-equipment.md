# 06 — Items & Equipment

Consumable items and weapon properties.

---

## Consumable Items

### Health Potion
- **ID:** `health_potion`
- **Effect:** Heals **7 HP** (flat value, not 2d4+2 dice roll)
- **Range:** Self (0ft)
- **5e RAW:** Potion of Healing heals 2d4+2 HP (avg 7).  The average is correct but
  the randomness is lost — should roll dice.

### Greater Health Potion
- **ID:** `greater_health_potion`
- **Effect:** Heals **14 HP** (flat value, not 4d4+4 dice roll)
- **Range:** Self (0ft)
- **5e RAW:** Potion of Greater Healing heals 4d4+4 HP (avg 14).  Same as above —
  average is correct but no dice variance.

### Antidote
- **ID:** `antidote`
- **Effect:** Removes ALL status effects from the user
- **Range:** Self (0ft)
- **5e Analog:** Not a standard 5e item.  Closest is *Lesser Restoration* (spell)
  which ends one disease or condition (blinded, deafened, paralyzed, or poisoned).

### Bomb (Alchemist's Fire)
- **ID:** `bomb`
- **Effect:** Deals **3d6 fire damage** (rolled with dice)
- **Range:** 20ft (target must be within range)
- **Behavior:** If target is out of range, the item is **refunded** (quantity restored)
- **5e RAW:** Alchemist's Fire deals 1d4 fire damage on hit and ignites the target
  (1d4 fire per round until extinguished with an action).  The engine's 3d6 burst
  is a **significant homebrew buff**.

### Elixir of Health
- **ID:** `elixir`
- **Effect:** Fully restores HP to max AND restores all spell slots AND removes all status effects
- **Range:** Self (0ft)
- **5e RAW:** *Elixir of Health* cures blinding, deafening, disease, and poisoning.
  It does NOT restore HP or spell slots.  This is a **significant homebrew buff**.

---

## Item Distribution by Class

| Item                    | Warrior | Mage | Rogue | Paladin |
|-------------------------|---------|------|-------|---------|
| Health Potion           | 3       | 2    | 2     | 3       |
| Greater Health Potion   | 1       | 1    | 1     | 1       |
| Bomb (Alchemist's Fire) | 2       | 1    | 2     | —       |
| Antidote                | —       | —    | 1     | —       |
| Elixir of Health        | —       | —    | —     | 1       |

---

## Item Resolution

Items are resolved in `resolveItem()` in `combat.ts`.

| Item Type       | Resolution |
|-----------------|------------|
| `heal_hp`       | Apply flat `potency` as healing |
| `damage` (bomb) | Range check → roll 3d6 → apply damage → refund if out of range |
| `cure`          | Clear all status effects |
| `full_restore`  | Set HP to max, reset all spell slots, clear status effects |

### Implementation Issues

1. **Potions use flat values** — should roll dice (2d4+2, 4d4+4)
2. **No "use an object" action cost** — in 5e, drinking a potion takes an action (correct here)
3. **No potion administration** — in 5e, you can feed a potion to an unconscious ally within reach
4. **Bombs don't apply burn DoT** — Alchemist's Fire should ignite the target

---

## Weapons

### Weapon Properties

The engine defines weapon properties but does **not mechanically enforce** any
of them.  Properties are descriptive tags only.

| Property    | 5e Effect                                      | Engine Effect |
|-------------|------------------------------------------------|---------------|
| `heavy`     | Small creatures have disadvantage              | None          |
| `two-handed`| Requires two hands                             | None          |
| `finesse`   | Use STR or DEX (chose higher) for attack/damage| None (uses defined `abilityMod`) |
| `versatile` | 1d10 damage when used two-handed               | None (always 1d8) |
| `reach`     | +5ft reach (10ft instead of 5ft)               | None (uses defined `range`) |
| `magical`   | Counts as magical for resistance/immunity      | None          |

> **Note:** While properties aren't enforced as rules, the `range` field IS
> checked for melee attacks.  The dragon's Bite has range 10 (reach), the
> demon's Flaming Greatsword has range 10 (reach).  This works correctly.

### Weapon Stats

| Weapon              | Damage  | Ability | Range | Properties            |
|---------------------|---------|---------|-------|-----------------------|
| Greatsword          | 2d6     | STR     | 5ft   | heavy, two-handed     |
| Quarterstaff        | 1d6     | STR     | 5ft   | versatile             |
| Rapier              | 1d8     | DEX     | 5ft   | finesse               |
| Longsword           | 1d8     | STR     | 5ft   | versatile             |
| Scimitar            | 1d6     | STR     | 5ft   | finesse               |
| Bite (dragon)       | 2d10    | STR     | 10ft  | reach                 |
| Necrotic Touch      | 1d8     | INT     | 5ft   | magical               |
| Flaming Greatsword  | 3d6     | STR     | 10ft  | heavy, reach, magical |

### Finesse Weapons

In 5e, finesse weapons let you use DEX instead of STR.  The engine handles
this correctly by setting `abilityMod: "dex"` on the Rapier.  The Rogue
attacks with DEX (+3) as intended.

### Versatile Weapons

In 5e, versatile weapons deal higher damage die when wielded two-handed
(e.g., longsword 1d8 → 1d10).  The engine does NOT implement this — the
longsword and quarterstaff always use their base damage die.

---

## Armor & Shields

Armor is baked into the AC stat.  No equipment system exists.

- No don/doff mechanics
- No shield as equipment (the Shield *spell* exists but the physical shield +2 AC item does not)
- No medium/heavy armor stealth disadvantage
- No armor weight or encumbrance
