// ─────────────────────────────────────────────────────────
//  Combat Engine — D&D 5e Mechanics
//  - d20 attack roll vs AC
//  - Saving throws (STR/DEX/CON/INT/WIS/CHA)
//  - Spell slots (no MP)
//  - Weapon damage dice + ability modifier
//  - Critical hits (natural 20 = double dice)
//  - Sneak Attack, Extra Attack, Divine Smite
//  - All dice via seeded DiceRoller
// ─────────────────────────────────────────────────────────
import {
  Character, CombatAction, CombatResult, DamageResult, SpellResult,
  ItemResult, AbilityResult, MoveResult, StatusEffect, StatusEffectType,
  Position, MoveVector, ArenaConfig, distance, maxMovePerTurn,
  abilityModifier, AbilityName,
  hasSpellSlot, consumeSpellSlot, remainingSlots, totalRemainingSlots,
  Spell, WeaponDef,
} from "./types.js";
import type { DiceRoller } from "./dice.js";

export const MELEE_RANGE = 5; // 5 feet

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Ability Modifier Shortcut ──

function getMod(char: Character, ability: AbilityName): number {
  return abilityModifier(char.stats[ability]);
}

/** Effective AC including shield status effects */
function getEffectiveAc(char: Character): number {
  let ac = char.stats.ac;
  if (char.isDefending) ac += 2; // Dodge = +2 AC (simplified)
  for (const eff of char.statusEffects) {
    if (eff.type === "shield") ac += eff.potency;
  }
  return ac;
}

// ═══════════════════════════════════════════════════════
//  Attack Resolution — d20 vs AC
// ═══════════════════════════════════════════════════════

interface AttackRollResult {
  roll: number;        // natural d20
  total: number;       // d20 + ability mod + proficiency
  targetAc: number;
  hit: boolean;
  critical: boolean;
  damage: number;
  damageRolls: number[];
}

function rollWeaponDamage(
  weapon: WeaponDef,
  char: Character,
  dice: DiceRoller,
  critical: boolean,
  context: string,
): { total: number; rolls: number[] } {
  const abilityMod = getMod(char, weapon.abilityMod);
  const profBonus = char.stats.proficiencyBonus;

  // Parse damage dice: e.g. "2d6", "1d8", "3d6"
  const match = weapon.damageDice.match(/^(\d+)d(\d+)$/);
  if (!match) return { total: abilityMod, rolls: [] };

  const numDice = parseInt(match[1]);
  const dieSize = parseInt(match[2]);
  const effectiveNumDice = critical ? numDice * 2 : numDice;

  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < effectiveNumDice; i++) {
    const r = dice.d(dieSize, context);
    rolls.push(r);
    total += r;
  }
  total += abilityMod;

  return { total, rolls };
}

function resolveSingleAttack(
  attacker: Character,
  defender: Character,
  weapon: WeaponDef,
  dice: DiceRoller,
  contextPrefix: string,
): AttackRollResult {
  const abilityMod = getMod(attacker, weapon.abilityMod);
  const profBonus = attacker.stats.proficiencyBonus;
  const targetAc = getEffectiveAc(defender);

  const roll = dice.d20(contextPrefix + " attack roll");
  const total = roll + abilityMod + profBonus;

  const isCrit = roll === 20;
  const isHit = isCrit || (roll !== 1 && total >= targetAc);

  let damage = 0;
  let damageRolls: number[] = [];

  if (isHit) {
    const dmgResult = rollWeaponDamage(weapon, attacker, dice, isCrit, contextPrefix + " damage");
    damage = dmgResult.total;
    damageRolls = dmgResult.rolls;
  }

  return { roll, total, targetAc, hit: isHit, critical: isCrit, damage, damageRolls };
}

function resolveAttack(
  attacker: Character,
  defender: Character,
  action: CombatAction,
  dice: DiceRoller,
): CombatResult {
  // Range check
  const dist = distance(attacker.position, defender.position);
  if (dist > attacker.weapon.range) {
    return {
      action, actorId: attacker.id, targetId: defender.id,
      narrative: `${attacker.name} is too far away to attack! (${dist.toFixed(0)}ft vs ${attacker.weapon.range}ft range)`,
    };
  }

  const weapon = attacker.weapon;
  const mainAttack = resolveSingleAttack(attacker, defender, weapon, dice, `${attacker.name} → ${defender.name}`);

  // Attacks against paralyzed targets auto-crit and auto-hit
  const isParalyzed = defender.statusEffects.some(e => e.type === "paralyzed");
  if (isParalyzed) {
    mainAttack.hit = true;
    if (!mainAttack.critical) {
      mainAttack.critical = true;
      // Re-roll damage with double dice
      const dmgResult = rollWeaponDamage(weapon, attacker, dice, true, `${attacker.name} → ${defender.name} (paralyzed crit)`);
      mainAttack.damage = dmgResult.total;
      mainAttack.damageRolls = dmgResult.rolls;
    }
  }

  let totalDamage = mainAttack.damage;
  const allDamageRolls = [...mainAttack.damageRolls];

  // Sneak Attack: +3d6 on first hit if rogue
  const isRogue = attacker.features.some(f => f.id === "sneak_attack");
  if (isRogue && mainAttack.hit) {
    for (let i = 0; i < 3; i++) {
      const sneakD = dice.d(6, "Sneak Attack damage");
      allDamageRolls.push(sneakD);
      totalDamage += sneakD;
    }
  }

  // Apply damage
  if (mainAttack.hit && totalDamage > 0) {
    defender.stats.hp = Math.max(0, defender.stats.hp - totalDamage);
  }

  // Extra Attack
  const extraAttacks: DamageResult[] = [];
  const hasExtraAttack = attacker.features.some(f => f.id === "extra_attack");
  if (hasExtraAttack && mainAttack.hit) {
    const extra = resolveSingleAttack(attacker, defender, weapon, dice, `${attacker.name} (extra) → ${defender.name}`);
    const extraDamageResult: DamageResult = {
      damage: extra.damage,
      wasCrit: extra.critical,
      wasMiss: !extra.hit,
      effective: "normal",
      targetHp: defender.stats.hp,
      targetMaxHp: defender.stats.maxHp,
      attackRoll: extra.roll,
      attackTotal: extra.total,
      targetAc: extra.targetAc,
      damageRolls: extra.damageRolls,
    };
    extraAttacks.push(extraDamageResult);

    if (extra.hit && extra.damage > 0) {
      defender.stats.hp = Math.max(0, defender.stats.hp - extra.damage);
      totalDamage += extra.damage;
    }
  }

  // Divine Smite (paladin: +2d8 radiant on hit, uses spell slot)
  const canSmite = attacker.features.some(f => f.id === "divine_smite");
  if (canSmite && mainAttack.hit && totalRemainingSlots(attacker.spellSlots) > 0) {
    // Auto-smite on hit — consume lowest available slot
    let smiteSlot = 0;
    for (let lv = 1; lv <= 9; lv++) {
      if (hasSpellSlot(attacker.spellSlots, lv)) {
        smiteSlot = lv;
        break;
      }
    }
    if (smiteSlot > 0) {
      consumeSpellSlot(attacker.spellSlots, smiteSlot);
      const smiteDice = 2 + (smiteSlot > 1 ? (smiteSlot - 1) : 0); // 2d8 base + 1d8 per slot level above 1
      let smiteDmg = 0;
      const smiteRolls: number[] = [];
      for (let i = 0; i < smiteDice; i++) {
        const r = dice.d(8, "Divine Smite radiant");
        smiteRolls.push(r);
        smiteDmg += r;
      }
      totalDamage += smiteDmg;
      defender.stats.hp = Math.max(0, defender.stats.hp - smiteDmg);
      allDamageRolls.push(...smiteRolls);
    }
  }

  // Build narrative
  let narrative: string;
  if (!mainAttack.hit) {
    narrative = mainAttack.roll === 1
      ? `${attacker.name} swings at ${defender.name} — critical miss! (nat 1)`
      : `${attacker.name} attacks ${defender.name} — misses! (${mainAttack.total} vs AC ${mainAttack.targetAc})`;
  } else if (mainAttack.critical) {
    narrative = `${attacker.name} CRITICAL HIT on ${defender.name}! ${totalDamage} damage (${mainAttack.total} vs AC ${mainAttack.targetAc})`;
  } else {
    narrative = `${attacker.name} hits ${defender.name} for ${totalDamage} damage (${mainAttack.total} vs AC ${mainAttack.targetAc})`;
  }

  if (defender.stats.hp <= 0) {
    narrative += ` — ${defender.name} falls!`;
  }

  const damageResult: DamageResult = {
    damage: totalDamage,
    wasCrit: mainAttack.critical,
    wasMiss: !mainAttack.hit,
    effective: "normal",
    targetHp: defender.stats.hp,
    targetMaxHp: defender.stats.maxHp,
    attackRoll: mainAttack.roll,
    attackTotal: mainAttack.total,
    targetAc: mainAttack.targetAc,
    damageRolls: allDamageRolls,
  };

  return {
    action, actorId: attacker.id, targetId: defender.id,
    narrative, damage: damageResult, extraAttacks: extraAttacks.length > 0 ? extraAttacks : undefined,
  };
}

// ═══════════════════════════════════════════════════════
//  Spell Resolution
// ═══════════════════════════════════════════════════════

function resolveSpell(
  caster: Character,
  target: Character,
  action: CombatAction,
  dice: DiceRoller,
): CombatResult {
  const spell = caster.spells.find(s => s.id === action.spellId);
  if (!spell) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} tries to cast an unknown spell!`,
    };
  }

  // Cooldown check
  if (spell.currentCooldown > 0) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${spell.name} is on cooldown (${spell.currentCooldown} turns remaining).`,
    };
  }

  // Spell slot check
  if (!hasSpellSlot(caster.spellSlots, spell.level)) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} has no spell slots left for ${spell.name}!`,
    };
  }

  // Range check
  const dist = distance(caster.position, target.position);
  if (spell.range > 0 && dist > spell.range) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} is too far away for ${spell.name}! (${dist.toFixed(0)}ft vs ${spell.range}ft range)`,
    };
  }

  // Consume slot and set cooldown
  consumeSpellSlot(caster.spellSlots, spell.level);
  spell.currentCooldown = spell.cooldown;

  const castingMod = getMod(caster, spell.castingAbility);
  const spellSaveDc = 8 + castingMod + caster.stats.proficiencyBonus;

  // Buff spells (self)
  if (spell.type === "buff" && spell.target === "self") {
    if (spell.statusEffect) {
      caster.statusEffects.push({
        type: spell.statusEffect.type,
        turnsRemaining: spell.statusEffect.duration,
        potency: spell.statusEffect.potency,
        sourceId: caster.id,
      });
    }
    return {
      action, actorId: caster.id,
      narrative: `${caster.name} casts ${spell.name}!`,
      spell: {
        spellName: spell.name,
        slotUsed: spell.level,
        slotsRemaining: buildSlotsMap(caster),
        cooldownRemaining: spell.currentCooldown,
        statusApplied: spell.statusEffect?.type,
      },
    };
  }

  // Heal spells
  if (spell.type === "heal") {
    let healAmount = 0;
    if (spell.healDice) {
      // Parse dice: "1d8"
      const match = spell.healDice.match(/^(\d+)d(\d+)$/);
      if (match) {
        const numDice = parseInt(match[1]);
        const dieSize = parseInt(match[2]);
        for (let i = 0; i < numDice; i++) {
          healAmount += dice.d(dieSize, `${spell.name} heal`);
        }
      }
    }
    if (spell.healAbilityMod) {
      healAmount += getMod(caster, spell.healAbilityMod);
    }
    healAmount = Math.max(1, healAmount);

    target.stats.hp = Math.min(target.stats.maxHp, target.stats.hp + healAmount);

    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} casts ${spell.name} on ${target.name}! Heals ${healAmount} HP.`,
      heal: { amount: healAmount, targetHp: target.stats.hp, targetMaxHp: target.stats.maxHp },
      spell: {
        spellName: spell.name,
        slotUsed: spell.level,
        slotsRemaining: buildSlotsMap(caster),
        cooldownRemaining: spell.currentCooldown,
      },
    };
  }

  // Damage spells
  if (spell.type === "damage") {
    let totalDamage = 0;
    let damageRolls: number[] = [];
    let wasCrit = false;
    let hit = true;
    let attackRoll: number | undefined;
    let attackTotal: number | undefined;
    let targetAc: number | undefined;
    let saveRoll: number | undefined;
    let saveSuccess: boolean | undefined;

    // Attack roll spell (e.g. Fire Bolt, Scorching Ray)
    if (spell.attackRoll) {
      const spellAttackMod = castingMod + caster.stats.proficiencyBonus;
      const ac = getEffectiveAc(target);
      const naturalRoll = dice.d20(`${caster.name} spell attack (${spell.name})`);
      const total = naturalRoll + spellAttackMod;
      attackRoll = naturalRoll;
      attackTotal = total;
      targetAc = ac;

      hit = naturalRoll !== 1 && (naturalRoll === 20 || total >= ac);
      wasCrit = naturalRoll === 20;

      if (hit && spell.damageDice) {
        const dmg = rollDamageDice(spell.damageDice, dice, `${spell.name} damage`, wasCrit);
        totalDamage = dmg.total + castingMod;
        damageRolls = dmg.rolls;
      }
    }
    // Saving throw spell (e.g. Fireball)
    else if (spell.saveAbility) {
      const saveAbility = spell.saveAbility;
      const saveMod = getMod(target, saveAbility)
        + (target.savingThrowProfs.includes(saveAbility) ? target.stats.proficiencyBonus : 0);
      const naturalSave = dice.d20(`${target.name} ${saveAbility.toUpperCase()} save vs ${spell.name}`);
      const saveTotal = naturalSave + saveMod;
      saveRoll = naturalSave;
      saveSuccess = saveTotal >= spellSaveDc;

      if (spell.damageDice && spell.damageDice !== "0") {
        const dmg = rollDamageDice(spell.damageDice, dice, `${spell.name} damage`, false);
        totalDamage = dmg.total;
        damageRolls = dmg.rolls;

        if (saveSuccess && spell.halfDamageOnSave) {
          totalDamage = Math.floor(totalDamage / 2);

          // Evasion: rogue takes no damage on successful save
          const hasEvasion = target.features.some(f => f.id === "evasion");
          if (hasEvasion) {
            totalDamage = 0;
          }
        }
      }
    }
    // Auto-hit (e.g. Magic Missile)
    else {
      if (spell.damageDice) {
        const dmg = rollDamageDice(spell.damageDice, dice, `${spell.name} damage`, false);
        totalDamage = dmg.total;
        damageRolls = dmg.rolls;
      }
    }

    // Apply status effect
    let statusApplied: StatusEffectType | undefined;
    if (spell.statusEffect && hit) {
      // For save spells, only apply on failed save
      if (spell.saveAbility) {
        if (!saveSuccess) {
          target.statusEffects.push({
            type: spell.statusEffect.type,
            turnsRemaining: spell.statusEffect.duration,
            potency: spell.statusEffect.potency,
            sourceId: caster.id,
          });
          statusApplied = spell.statusEffect.type;
        }
      } else {
        target.statusEffects.push({
          type: spell.statusEffect.type,
          turnsRemaining: spell.statusEffect.duration,
          potency: spell.statusEffect.potency,
          sourceId: caster.id,
        });
        statusApplied = spell.statusEffect.type;
      }
    }

    // Apply damage
    if (hit && totalDamage > 0) {
      target.stats.hp = Math.max(0, target.stats.hp - totalDamage);
    }

    // Build narrative
    let narrative: string;
    if (!hit) {
      narrative = attackRoll !== undefined
        ? `${caster.name} casts ${spell.name} at ${target.name} — misses! (${attackTotal} vs AC ${targetAc})`
        : `${caster.name} casts ${spell.name} — but it fails!`;
    } else if (spell.saveAbility) {
      narrative = saveSuccess
        ? `${caster.name} casts ${spell.name}! ${target.name} saves (DC ${spellSaveDc}) — ${totalDamage} damage.`
        : `${caster.name} casts ${spell.name}! ${target.name} fails save — ${totalDamage} damage!`;
    } else {
      narrative = `${caster.name} casts ${spell.name} on ${target.name} for ${totalDamage} ${spell.damageType || ""} damage!`;
    }

    if (statusApplied) {
      narrative += ` ${target.name} is ${statusApplied}!`;
    }
    if (target.stats.hp <= 0) {
      narrative += ` — ${target.name} falls!`;
    }

    return {
      action, actorId: caster.id, targetId: target.id,
      narrative,
      damage: {
        damage: totalDamage,
        wasCrit,
        wasMiss: !hit,
        effective: "normal",
        targetHp: target.stats.hp,
        targetMaxHp: target.stats.maxHp,
        attackRoll, attackTotal, targetAc,
        damageRolls,
        saveRoll, saveDc: spellSaveDc, saveSuccess,
      },
      spell: {
        spellName: spell.name,
        slotUsed: spell.level,
        slotsRemaining: buildSlotsMap(caster),
        cooldownRemaining: spell.currentCooldown,
        statusApplied,
      },
    };
  }

  // Fallback
  return {
    action, actorId: caster.id, targetId: target.id,
    narrative: `${caster.name} casts ${spell.name}!`,
    spell: {
      spellName: spell.name,
      slotUsed: spell.level,
      slotsRemaining: buildSlotsMap(caster),
      cooldownRemaining: spell.currentCooldown,
    },
  };
}

/** Roll NdS damage dice, optionally doubling for crits */
function rollDamageDice(
  notation: string,
  dice: DiceRoller,
  context: string,
  critical: boolean,
): { total: number; rolls: number[] } {
  // Parse "3d6", "2d10", "8d6", "3d4+3"
  const match = notation.match(/^(\d+)d(\d+)(\+(\d+))?$/);
  if (!match) return { total: 0, rolls: [] };

  const numDice = critical ? parseInt(match[1]) * 2 : parseInt(match[1]);
  const dieSize = parseInt(match[2]);
  const bonus = match[4] ? parseInt(match[4]) : 0;

  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < numDice; i++) {
    const r = dice.d(dieSize, context);
    rolls.push(r);
    total += r;
  }
  total += bonus;

  return { total, rolls };
}

function buildSlotsMap(char: Character): Record<number, number> {
  const map: Record<number, number> = {};
  for (const k of Object.keys(char.spellSlots)) {
    map[Number(k)] = remainingSlots(char.spellSlots, Number(k));
  }
  return map;
}

// ═══════════════════════════════════════════════════════
//  Item Resolution
// ═══════════════════════════════════════════════════════

function resolveItem(
  user: Character,
  target: Character,
  action: CombatAction,
  dice: DiceRoller,
): CombatResult {
  const itemIdx = user.inventory.findIndex(i => i.id === action.itemId && i.quantity > 0);
  if (itemIdx === -1) {
    return {
      action, actorId: user.id, targetId: target.id,
      narrative: `${user.name} doesn't have that item!`,
    };
  }

  const item = user.inventory[itemIdx];
  item.quantity--;

  if (item.type === "heal_hp") {
    // Potions heal a fixed amount based on potency (simplified from dice)
    const healAmount = item.potency;
    target.stats.hp = Math.min(target.stats.maxHp, target.stats.hp + healAmount);

    return {
      action, actorId: user.id, targetId: target.id,
      narrative: `${user.name} uses ${item.name}! Heals ${target.name} for ${healAmount} HP.`,
      heal: { amount: healAmount, targetHp: target.stats.hp, targetMaxHp: target.stats.maxHp },
      item: { itemName: item.name, effect: "heal", value: healAmount, remaining: item.quantity },
    };
  }

  if (item.type === "damage" && item.id === "bomb") {
    // Alchemist Fire: 3d6 fire damage
    let dmg = 0;
    const rolls: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = dice.d(6, "Alchemist Fire damage");
      rolls.push(r);
      dmg += r;
    }
    target.stats.hp = Math.max(0, target.stats.hp - dmg);
    return {
      action, actorId: user.id, targetId: target.id,
      narrative: `${user.name} throws ${item.name} at ${target.name} for ${dmg} fire damage!`,
      damage: {
        damage: dmg, wasCrit: false, wasMiss: false, effective: "normal",
        targetHp: target.stats.hp, targetMaxHp: target.stats.maxHp,
        damageRolls: rolls,
      },
      item: { itemName: item.name, effect: "damage", value: dmg, remaining: item.quantity },
    };
  }

  if (item.type === "cure") {
    target.statusEffects = [];
    return {
      action, actorId: user.id, targetId: target.id,
      narrative: `${user.name} uses ${item.name}! All status effects cured on ${target.name}.`,
      item: { itemName: item.name, effect: "cure", value: 0, remaining: item.quantity },
    };
  }

  if (item.type === "full_restore") {
    const healed = target.stats.maxHp - target.stats.hp;
    target.stats.hp = target.stats.maxHp;
    for (const k of Object.keys(target.spellSlots)) {
      target.spellSlots[Number(k)].used = 0;
    }
    target.statusEffects = [];
    return {
      action, actorId: user.id, targetId: target.id,
      narrative: `${user.name} uses ${item.name}! Fully restored!`,
      heal: { amount: healed, targetHp: target.stats.hp, targetMaxHp: target.stats.maxHp },
      item: { itemName: item.name, effect: "full_restore", value: healed, remaining: item.quantity },
    };
  }

  return {
    action, actorId: user.id, targetId: target.id,
    narrative: `${user.name} uses ${item.name}.`,
    item: { itemName: item.name, effect: "unknown", value: 0, remaining: item.quantity },
  };
}

// ═══════════════════════════════════════════════════════
//  Class Abilities
// ═══════════════════════════════════════════════════════

function resolveClassAbility(
  actor: Character,
  target: Character,
  action: CombatAction,
  dice: DiceRoller,
): CombatResult {
  const abilityId = action.abilityId;
  const feature = actor.features.find(f => f.id === abilityId);

  if (!feature) {
    return {
      action, actorId: actor.id, targetId: target.id,
      narrative: `${actor.name} doesn't have ability: ${abilityId}`,
    };
  }

  // Check uses
  if (feature.usesPerBattle > 0 && feature.usesRemaining <= 0) {
    return {
      action, actorId: actor.id, targetId: target.id,
      narrative: `${feature.name} has no uses remaining!`,
    };
  }

  // Consume use
  if (feature.usesPerBattle > 0) {
    feature.usesRemaining--;
  }

  // Second Wind: heal 1d10+5
  if (abilityId === "second_wind") {
    const d10 = dice.d(10, "Second Wind heal");
    const healAmount = d10 + 5;
    actor.stats.hp = Math.min(actor.stats.maxHp, actor.stats.hp + healAmount);
    return {
      action, actorId: actor.id,
      narrative: `${actor.name} uses Second Wind! Heals ${healAmount} HP.`,
      heal: { amount: healAmount, targetHp: actor.stats.hp, targetMaxHp: actor.stats.maxHp },
      abilityResult: { name: "Second Wind", description: "Heal 1d10+5", value: healAmount },
    };
  }

  // Lay on Hands: heal up to 25 HP
  if (abilityId === "lay_on_hands") {
    const missing = actor.stats.maxHp - actor.stats.hp;
    const healAmount = Math.min(25, missing);
    actor.stats.hp = Math.min(actor.stats.maxHp, actor.stats.hp + healAmount);
    return {
      action, actorId: actor.id,
      narrative: `${actor.name} uses Lay on Hands! Heals ${healAmount} HP.`,
      heal: { amount: healAmount, targetHp: actor.stats.hp, targetMaxHp: actor.stats.maxHp },
      abilityResult: { name: "Lay on Hands", description: "Heal up to 25 HP", value: healAmount },
    };
  }

  // Arcane Recovery: recover spell slots (recover up to half caster level in slot levels)
  if (abilityId === "arcane_recovery") {
    // Simplified: recover one highest available slot
    for (let lv = 9; lv >= 1; lv--) {
      const slot = actor.spellSlots[lv];
      if (slot && slot.used > 0) {
        slot.used--;
        return {
          action, actorId: actor.id,
          narrative: `${actor.name} uses Arcane Recovery! Recovered a ${lv}${ordinalSuffix(lv)} level slot.`,
          abilityResult: { name: "Arcane Recovery", description: "Recover spell slots", value: lv },
        };
      }
    }
    return {
      action, actorId: actor.id,
      narrative: `${actor.name} uses Arcane Recovery but has no slots to recover.`,
      abilityResult: { name: "Arcane Recovery", description: "No slots to recover", value: 0 },
    };
  }

  // Action Surge: already handled by the battle runner (grants extra action)
  if (abilityId === "action_surge") {
    return {
      action, actorId: actor.id,
      narrative: `${actor.name} uses Action Surge! Extra action this turn!`,
      abilityResult: { name: "Action Surge", description: "Extra action", value: 1 },
    };
  }

  return {
    action, actorId: actor.id,
    narrative: `${actor.name} uses ${feature.name}.`,
    abilityResult: { name: feature.name, description: feature.description, value: 0 },
  };
}

function ordinalSuffix(n: number): string {
  if (n === 1) return "st";
  if (n === 2) return "nd";
  if (n === 3) return "rd";
  return "th";
}

// ═══════════════════════════════════════════════════════
//  Defend / Wait / Flee
// ═══════════════════════════════════════════════════════

function resolveDefend(actor: Character): CombatResult {
  actor.isDefending = true;
  return {
    action: { type: "defend", actorId: actor.id },
    actorId: actor.id,
    narrative: `${actor.name} takes a defensive stance! (+2 AC until next turn)`,
  };
}

function resolveWait(actor: Character): CombatResult {
  return {
    action: { type: "wait", actorId: actor.id },
    actorId: actor.id,
    narrative: `${actor.name} waits...`,
  };
}

function resolveFlee(actor: Character, arena: ArenaConfig): CombatResult {
  // Move toward the nearest edge
  const distToLeft = actor.position.x;
  const distToRight = arena.width - actor.position.x;
  const escaped = distToLeft < distToRight
    ? actor.position.x <= 0
    : actor.position.x >= arena.width;

  return {
    action: { type: "flee", actorId: actor.id },
    actorId: actor.id,
    narrative: escaped
      ? `${actor.name} escapes the arena!`
      : `${actor.name} tries to flee but can't reach the edge!`,
    fled: true,
    fledSuccessfully: escaped,
  };
}

// ═══════════════════════════════════════════════════════
//  Movement Resolution
// ═══════════════════════════════════════════════════════

export function resolveMove(
  character: Character,
  move: MoveVector,
  arena: ArenaConfig,
): MoveResult {
  const maxDist = maxMovePerTurn(character.stats.speed);

  // Cunning Action: rogues get +15ft movement
  const hasCunningAction = character.features.some(f => f.id === "cunning_action");
  const effectiveMax = maxDist + (hasCunningAction ? 15 : 0);

  const magnitude = Math.sqrt(move.dx * move.dx + move.dy * move.dy);
  let dx = move.dx;
  let dy = move.dy;

  if (magnitude > effectiveMax) {
    const scale = effectiveMax / magnitude;
    dx = Math.round(dx * scale);
    dy = Math.round(dy * scale);
  }

  const from = { ...character.position };
  const newX = clamp(character.position.x + dx, 0, arena.width);
  const newY = clamp(character.position.y + dy, 0, arena.height);

  character.position = { x: newX, y: newY };

  const distanceMoved = Math.sqrt(
    (newX - from.x) ** 2 + (newY - from.y) ** 2,
  );

  return {
    from,
    to: { x: newX, y: newY },
    distanceMoved: Math.round(distanceMoved * 10) / 10,
  };
}

// ═══════════════════════════════════════════════════════
//  Range Check
// ═══════════════════════════════════════════════════════

export function inRange(actor: Character, target: Character, range: number): boolean {
  return distance(actor.position, target.position) <= range;
}

// ═══════════════════════════════════════════════════════
//  Status Effect Processing
// ═══════════════════════════════════════════════════════

export function processStatusEffects(character: Character): string[] {
  const narratives: string[] = [];

  character.statusEffects = character.statusEffects.filter((effect) => {
    if (effect.type === "burn") {
      character.stats.hp = Math.max(0, character.stats.hp - effect.potency);
      narratives.push(`${character.name} takes ${effect.potency} burn damage!`);
    }

    if (effect.type === "poison") {
      character.stats.hp = Math.max(0, character.stats.hp - effect.potency);
      narratives.push(`${character.name} takes ${effect.potency} poison damage!`);
    }

    if (effect.type === "regen") {
      const healed = Math.min(effect.potency, character.stats.maxHp - character.stats.hp);
      character.stats.hp += healed;
      if (healed > 0) narratives.push(`${character.name} regenerates ${healed} HP!`);
    }

    effect.turnsRemaining--;
    if (effect.turnsRemaining <= 0) {
      narratives.push(`${character.name}'s ${effect.type} effect fades.`);
      return false;
    }
    return true;
  });

  return narratives;
}

// ═══════════════════════════════════════════════════════
//  Cooldown Tick
// ═══════════════════════════════════════════════════════

export function tickCooldowns(character: Character): void {
  for (const spell of character.spells) {
    if (spell.currentCooldown > 0) {
      spell.currentCooldown--;
    }
  }
}

// ═══════════════════════════════════════════════════════
//  Main Action Resolver
// ═══════════════════════════════════════════════════════

export function resolveAction(
  actor: Character,
  target: Character | undefined,
  action: CombatAction,
  dice: DiceRoller,
  arena?: ArenaConfig,
): CombatResult {
  // Resolve move first (if any)
  let moveResult: MoveResult | undefined;
  if (action.move && arena) {
    moveResult = resolveMove(actor, action.move, arena);
  }

  let result: CombatResult;

  switch (action.type) {
    case "attack":
      if (!target) return { action, actorId: actor.id, narrative: "No target!" };
      result = resolveAttack(actor, target, action, dice);
      break;

    case "cast_spell":
      if (!target) return { action, actorId: actor.id, narrative: "No target!" };
      result = resolveSpell(actor, target, action, dice);
      break;

    case "use_item":
      result = resolveItem(actor, target || actor, action, dice);
      break;

    case "class_ability":
      result = resolveClassAbility(actor, target || actor, action, dice);
      break;

    case "defend":
      result = resolveDefend(actor);
      break;

    case "wait":
      result = resolveWait(actor);
      break;

    case "flee":
      result = resolveFlee(actor, arena || { width: 100, height: 60, label: "Arena" });
      break;

    default:
      result = {
        action, actorId: actor.id,
        narrative: `${actor.name} does something unknown.`,
      };
  }

  // Attach move result
  if (moveResult) {
    result.move = moveResult;
  }

  // Record action
  actor.actionHistory.push(action.type);

  // Clear defending flag on any non-defend action
  if (action.type !== "defend") {
    actor.isDefending = false;
  }

  return result;
}

// ═══════════════════════════════════════════════════════
//  Turn Order — DEX initiative
// ═══════════════════════════════════════════════════════

export function determineTurnOrder(characters: Character[], dice: DiceRoller): Character[] {
  // Roll initiative: d20 + DEX mod for each character
  const withInit = characters
    .filter(c => c.stats.hp > 0)
    .map(c => ({ char: c, init: dice.d20(`${c.name} initiative`) + abilityModifier(c.stats.dex) }));
  withInit.sort((a, b) => b.init - a.init); // highest initiative first
  return withInit.map(x => x.char);
}

// ═══════════════════════════════════════════════════════
//  Battle State Snapshot
// ═══════════════════════════════════════════════════════

export function createSnapshot(
  characters: Character[],
  turnNumber: number,
  phase: "ongoing" | "finished",
  arena: ArenaConfig,
) {
  return {
    characters: characters.map(c => ({
      id: c.id,
      name: c.name,
      team: c.team,
      class: c.class,
      level: c.level,
      hp: c.stats.hp,
      maxHp: c.stats.maxHp,
      ac: c.stats.ac,
      speed: c.stats.speed,
      str: c.stats.str,
      dex: c.stats.dex,
      con: c.stats.con,
      int: c.stats.int,
      wis: c.stats.wis,
      cha: c.stats.cha,
      proficiencyBonus: c.stats.proficiencyBonus,
      spellSlots: Object.fromEntries(
        Object.entries(c.spellSlots).map(([k, v]) => [Number(k), { ...v }])
      ),
      statusEffects: c.statusEffects.map(e => ({
        type: e.type,
        turnsRemaining: e.turnsRemaining,
      })),
      isDefending: c.isDefending,
      position: { ...c.position },
      spells: c.spells.map(s => ({
        id: s.id, name: s.name, type: s.type, description: s.description,
        target: s.target, level: s.level, range: s.range,
        cooldown: s.cooldown, currentCooldown: s.currentCooldown,
        castingAbility: s.castingAbility,
        damageDice: s.damageDice, healDice: s.healDice,
        attackRoll: s.attackRoll, saveAbility: s.saveAbility,
        statusEffect: s.statusEffect,
      })),
      inventory: c.inventory.map(i => ({
        id: i.id, name: i.name, description: i.description,
        quantity: i.quantity, type: i.type, potency: i.potency, range: i.range,
      })),
      features: c.features.map(f => ({
        id: f.id, name: f.name, description: f.description,
        usesPerBattle: f.usesPerBattle, usesRemaining: f.usesRemaining,
      })),
      weapon: {
        name: c.weapon.name, damageDice: c.weapon.damageDice,
        abilityMod: c.weapon.abilityMod, range: c.weapon.range,
      },
      savingThrowProfs: [...c.savingThrowProfs],
    })),
    turnNumber,
    phase,
    arena: { ...arena },
  };
}
