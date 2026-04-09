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
  Character, CombatAction, CombatResult, DamageResult,
  MoveResult, StatusEffect, StatusEffectType, Spell,
  MoveVector, ArenaConfig, Position, distance, maxMovePerTurn,
  abilityModifier, AbilityName, AdvantageMode, DamageType,
  hasSpellSlot, consumeSpellSlot, remainingSlots, totalRemainingSlots,
  WeaponDef, BonusAction, ReactionResult, getCoverBonus,
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
function getEffectiveAc(char: Character, attackerPos?: Position, arena?: ArenaConfig): number {
  let ac = char.stats.ac;
  if (char.isDefending) ac += 2; // Dodge = +2 AC (simplified)
  if (char.fightingStyle === "defense") ac += 1;
  for (const eff of char.statusEffects) {
    if (eff.type === "shield") ac += eff.potency;
    if (eff.type === "haste") ac += 2;
    if (eff.type === "slow") ac -= 2;
  }
  // Cover bonus from arena terrain
  if (attackerPos && arena) {
    ac += getCoverBonus(attackerPos, char.position, arena);
  }
  return ac;
}

// ── Advantage / Disadvantage Calculation ──

/** Get bless/bane modifier for attack rolls and saving throws */
function getBlessBaneMod(char: Character, dice: DiceRoller): { mod: number; rolls: number[] } {
  const rolls: number[] = [];
  let mod = 0;
  const bless = char.statusEffects.find(e => e.type === "bless");
  if (bless) {
    const d4 = dice.d(4, `${char.name} bless d4`);
    rolls.push(d4);
    mod += d4;
  }
  const bane = char.statusEffects.find(e => e.type === "bane");
  if (bane) {
    const d4 = dice.d(4, `${char.name} bane d4`);
    rolls.push(d4);
    mod -= d4;
  }
  return { mod, rolls };
}

/** Determine advantage mode for an attack roll */
export function getAttackAdvantage(
  attacker: Character,
  defender: Character,
  allCharacters: Character[],
): AdvantageMode {
  let hasAdvantage = false;
  let hasDisadvantage = false;

  // ── Conditions that grant advantage to the attacker ──
  // Paralyzed defender → advantage on attacks
  if (defender.statusEffects.some(e => e.type === "paralyzed")) hasAdvantage = true;
  // Prone defender → advantage on melee attacks (within 5ft)
  if (defender.statusEffects.some(e => e.type === "prone")) {
    if (distance(attacker.position, defender.position) <= MELEE_RANGE) {
      hasAdvantage = true;
    } else {
      hasDisadvantage = true;
    }
  }
  // Stunned defender → advantage on attacks
  if (defender.statusEffects.some(e => e.type === "stunned")) hasAdvantage = true;
  // Invisible attacker → advantage on attacks
  if (attacker.statusEffects.some(e => e.type === "invisible")) hasAdvantage = true;
  // Blind/blinded attacker → disadvantage on attacks
  if (attacker.statusEffects.some(e => e.type === "blind" || e.type === "blinded")) hasDisadvantage = true;
  // Blind/blinded defender → attacks against have advantage
  if (defender.statusEffects.some(e => e.type === "blind" || e.type === "blinded")) hasAdvantage = true;
  // Poisoned attacker → disadvantage on attacks
  if (attacker.statusEffects.some(e => e.type === "poisoned")) hasDisadvantage = true;
  // Prone attacker → disadvantage on attacks
  if (attacker.statusEffects.some(e => e.type === "prone")) hasDisadvantage = true;
  // Restrained attacker → disadvantage on attacks
  if (attacker.statusEffects.some(e => e.type === "restrained")) hasDisadvantage = true;
  // Restrained defender → advantage on attacks against
  if (defender.statusEffects.some(e => e.type === "restrained")) hasAdvantage = true;
  // Defender is defending (Dodge) → disadvantage on attacks against
  if (defender.isDefending) hasDisadvantage = true;

  // ── Flanking: ally within 5ft of target on opposite side → advantage ──
  if (allCharacters.length > 2) {
    const allies = allCharacters.filter(c =>
      c.id !== attacker.id && c.team === attacker.team && c.stats.hp > 0
    );
    for (const ally of allies) {
      if (distance(ally.position, defender.position) <= MELEE_RANGE) {
        hasAdvantage = true;
        break;
      }
    }
  }

  // 5e RAW: if you have both advantage and disadvantage, they cancel out
  if (hasAdvantage && hasDisadvantage) return "normal";
  if (hasAdvantage) return "advantage";
  if (hasDisadvantage) return "disadvantage";
  return "normal";
}

/** Determine advantage mode for a saving throw */
export function getSaveAdvantage(
  saver: Character,
  _saveAbility: AbilityName,
): AdvantageMode {
  // Paralyzed → auto-fail STR and DEX saves (no roll needed)
  // Stunned → auto-fail STR and DEX saves
  // These are handled separately in resolveSpell via autoFail
  // Poisoned → disadvantage on all saves
  if (saver.statusEffects.some(e => e.type === "poisoned")) {
    return "disadvantage";
  }
  return "normal";
}

/** Check if a saving throw automatically fails due to conditions */
export function autoFailSave(saver: Character, ability: AbilityName): boolean {
  if (saver.statusEffects.some(e => e.type === "paralyzed" || e.type === "stunned")) {
    return ability === "str" || ability === "dex";
  }
  return false;
}

/** Check if an attack auto-crits due to conditions (5e: only within 5ft) */
export function autoCritFromCondition(attacker: Character, defender: Character): boolean {
  if (!defender.statusEffects.some(e => e.type === "paralyzed" || e.type === "stunned")) {
    return false;
  }
  // 5e RAW: auto-crit only from within 5ft
  return distance(attacker.position, defender.position) <= MELEE_RANGE;
}

/** Check if sneak attack conditions are met */
export function sneakAttackConditions(
  attacker: Character,
  defender: Character,
  allCharacters: Character[],
  attackAdvantage: AdvantageMode,
): boolean {
  // 5e RAW: advantage on the attack roll OR an ally within 5ft of the target
  if (attackAdvantage === "advantage") return true;

  // Check for ally within 5ft of the target
  const allies = allCharacters.filter(c =>
    c.id !== attacker.id && c.team === attacker.team && c.stats.hp > 0
  );
  for (const ally of allies) {
    if (distance(ally.position, defender.position) <= MELEE_RANGE) {
      return true;
    }
  }

  return false;
}

// ── Damage Type Modifiers ──

/** Apply resistance/vulnerability/immunity to damage */
export function applyDamageModifiers(
  target: Character,
  damage: number,
  damageType: string | undefined,
): number {
  if (!damageType) return damage;
  const dt = damageType as DamageType;
  if (target.immunities.includes(dt)) return 0;
  // Absorb Elements: resistance to all damage types when active
  if (target.statusEffects.some(e => e.type === "absorb_elements")) return Math.floor(damage / 2);
  if (target.resistances.includes(dt)) return Math.floor(damage / 2);
  if (target.vulnerabilities.includes(dt)) return damage * 2;
  return damage;
}

// ── Concentration ──

/** Break concentration on a spell, removing its effect from caster and optionally all characters */
export function breakConcentration(char: Character, allCharacters: Character[] = []): void {
  if (!char.concentrationSpellId) return;
  const spellId = char.concentrationSpellId;
  const tag = `${char.id}_${spellId}`;
  char.concentrationSpellId = undefined;
  // Remove the status effect that this concentration spell created
  char.statusEffects = char.statusEffects.filter(e => e.sourceId !== tag);
  // Also remove from other characters (for control spells that target enemies)
  for (const other of allCharacters) {
    if (other.id !== char.id) {
      other.statusEffects = other.statusEffects.filter(e => e.sourceId !== tag);
    }
  }
}

/** Apply a concentration spell: break old one, track new one */
export function applyConcentration(
  char: Character,
  spellId: string,
  allCharacters: Character[] = [],
): void {
  // Break existing concentration (removes old spell's effect from self + others)
  breakConcentration(char, allCharacters);
  // Set new concentration
  char.concentrationSpellId = spellId;
}

/** Constitution save to maintain concentration after taking damage.
 *  DC = max(10, half the damage taken). Called after damage is applied. */
export function concentrationSaveFromDamage(
  char: Character,
  damageTaken: number,
  dice: DiceRoller,
  allCharacters: Character[] = [],
): { success: boolean; dc: number; roll: number } {
  if (!char.concentrationSpellId) return { success: true, dc: 0, roll: 0 };
  const dc = Math.max(10, Math.floor(damageTaken / 2));
  const conMod = abilityModifier(char.stats.con);
  const profBonus = char.savingThrowProfs.includes("con") ? char.stats.proficiencyBonus : 0;
  const roll = dice.d20("Concentration save");
  const total = roll + conMod + profBonus;
  const success = total >= dc;
  if (!success) breakConcentration(char, allCharacters);
  return { success, dc, roll };
}

// ═══════════════════════════════════════════════════════
//  Attack Resolution — d20 vs AC
// ═══════════════════════════════════════════════════════

interface AttackRollResult {
  roll: number;        // natural d20 (kept roll)
  total: number;       // d20 + ability mod + proficiency
  targetAc: number;
  hit: boolean;
  critical: boolean;
  damage: number;
  damageRolls: number[];
  discarded?: number;  // the discarded die from advantage/disadvantage
  mirrorImageMiss?: boolean; // attack absorbed by a duplicate
}

function rollWeaponDamage(
  weapon: WeaponDef,
  char: Character,
  dice: DiceRoller,
  critical: boolean,
  context: string,
  useVersatile: boolean = false,
): { total: number; rolls: number[] } {
  // Finesse: use max(STR, DEX) modifier
  let abilityMod: number;
  if (weapon.properties.includes("finesse")) {
    abilityMod = Math.max(abilityModifier(char.stats.str), abilityModifier(char.stats.dex));
  } else {
    abilityMod = getMod(char, weapon.abilityMod);
  }

  // Use versatile dice if applicable (two-handed grip, no off-hand)
  const diceSpec = (useVersatile && weapon.versatileDice) ? weapon.versatileDice : weapon.damageDice;

  // Parse damage dice: e.g. "2d6", "1d8", "3d6"
  const match = diceSpec.match(/^(\d+)d(\d+)$/);
  if (!match) return { total: abilityMod, rolls: [] };

  const numDice = parseInt(match[1]);
  const dieSize = parseInt(match[2]);
  const effectiveNumDice = critical ? numDice * 2 : numDice;

  const rolls: number[] = [];
  let total = 0;
  for (let i = 0; i < effectiveNumDice; i++) {
    let r = dice.d(dieSize, context);
    // Great Weapon Fighting: reroll 1s and 2s (take the reroll)
    if (char.fightingStyle === "great_weapon_fighting" && (r === 1 || r === 2)) {
      r = dice.d(dieSize, context + " GWF reroll");
    }
    rolls.push(r);
    total += r;
  }
  total += abilityMod;

  // Dueling: +2 damage with one-handed weapon (not two-handed)
  if (char.fightingStyle === "dueling" && !weapon.properties.includes("two-handed") && !useVersatile) {
    total += 2;
  }

  return { total, rolls };
}

function resolveSingleAttack(
  attacker: Character,
  defender: Character,
  weapon: WeaponDef,
  dice: DiceRoller,
  contextPrefix: string,
  advantageMode: AdvantageMode = "normal",
  arena?: ArenaConfig,
): AttackRollResult {
  // Finesse: use max(STR, DEX) modifier for attack roll
  let abilityMod: number;
  if (weapon.properties.includes("finesse")) {
    abilityMod = Math.max(abilityModifier(attacker.stats.str), abilityModifier(attacker.stats.dex));
  } else {
    abilityMod = getMod(attacker, weapon.abilityMod);
  }
  const profBonus = attacker.stats.proficiencyBonus;
  const targetAc = getEffectiveAc(defender, attacker.position, arena);

  const { result: roll, discarded } = dice.d20WithAdvantage(advantageMode, contextPrefix + " attack roll");
  const { mod: blessBaneMod } = getBlessBaneMod(attacker, dice);
  const total = roll + abilityMod + profBonus + blessBaneMod;

  const isCrit = roll === 20;
  let isHitFinal = isCrit || (roll !== 1 && total >= targetAc);

  // Mirror Image: if defender has duplicates, attack might hit a duplicate
  let mirrorImageMiss = false;
  const mirrorEffect = defender.statusEffects.find(e => e.type === "mirror_image");
  if (mirrorEffect && isHitFinal && !isCrit) {
    const images = mirrorEffect.potency; // 1-3 images
    const mirrorRoll = dice.d(20, "Mirror Image check");
    const missThreshold = 6 + images * 2; // 3→12, 2→10, 1→8
    if (mirrorRoll <= missThreshold) {
      mirrorImageMiss = true;
      isHitFinal = false;
      mirrorEffect.potency--;
      if (mirrorEffect.potency <= 0) {
        defender.statusEffects = defender.statusEffects.filter(e => e.type !== "mirror_image");
      }
    }
  }

  let damage = 0;
  let damageRolls: number[] = [];

  if (isHitFinal) {
    const useVersatile = weapon.properties.includes("versatile") && !attacker.equippedShield;
    const dmgResult = rollWeaponDamage(weapon, attacker, dice, isCrit, contextPrefix + " damage", useVersatile);
    damage = dmgResult.total;
    damageRolls = dmgResult.rolls;
  }

  return { roll, total, targetAc, hit: isHitFinal, critical: isCrit, damage, damageRolls, discarded, mirrorImageMiss };
}

function resolveAttack(
  attacker: Character,
  defender: Character,
  action: CombatAction,
  dice: DiceRoller,
  allCharacters: Character[] = [],
  arena?: ArenaConfig,
): CombatResult {
  // Range check
  const dist = distance(attacker.position, defender.position);
  if (dist > attacker.weapon.range) {
    return {
      action, actorId: attacker.id, targetId: defender.id,
      narrative: `${attacker.name} is too far away to attack! (${dist.toFixed(0)}ft vs ${attacker.weapon.range}ft range)`,
      badAction: "out_of_range",
    };
  }

  // Calculate advantage/disadvantage
  const advantageMode = getAttackAdvantage(attacker, defender, allCharacters);

  const weapon = attacker.weapon;
  const mainAttack = resolveSingleAttack(attacker, defender, weapon, dice, `${attacker.name} → ${defender.name}`, advantageMode, arena);

  // Attacks against paralyzed/stunned targets auto-crit if within 5ft (5e RAW)
  const shouldAutoCrit = autoCritFromCondition(attacker, defender);
  if (shouldAutoCrit) {
    mainAttack.hit = true;
    if (!mainAttack.critical) {
      mainAttack.critical = true;
      const useVersatile = weapon.properties.includes("versatile") && !attacker.equippedShield;
      const dmgResult = rollWeaponDamage(weapon, attacker, dice, true, `${attacker.name} → ${defender.name} (auto-crit)`, useVersatile);
      mainAttack.damage = dmgResult.total;
      mainAttack.damageRolls = dmgResult.rolls;
    }
  }

  // Paralyzed/stunned targets auto-fail STR/DEX saves
  const isParalyzedOrStunned = defender.statusEffects.some(e => e.type === "paralyzed" || e.type === "stunned");
  if (isParalyzedOrStunned && !shouldAutoCrit) {
    // Still auto-hit even from range (advantage → likely hit), but no auto-crit
    mainAttack.hit = true;
  }

  let totalDamage = mainAttack.damage;
  const allDamageRolls = [...mainAttack.damageRolls];

  // Sneak Attack: +3d6 on first hit if rogue AND conditions are met
  const isRogue = attacker.features.some(f => f.id === "sneak_attack");
  if (isRogue && mainAttack.hit && sneakAttackConditions(attacker, defender, allCharacters, advantageMode)) {
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
    const extra = resolveSingleAttack(attacker, defender, weapon, dice, `${attacker.name} (extra) → ${defender.name}`, advantageMode, arena);
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
  // Only triggers when explicitly chosen via action.abilityId === "divine_smite"
  const wantSmite = action.abilityId === "divine_smite";
  const canSmite = attacker.features.some(f => f.id === "divine_smite");
  if (wantSmite && canSmite && mainAttack.hit && totalRemainingSlots(attacker.spellSlots) > 0) {
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
  const advNote = advantageMode === "advantage" ? " (advantage)" : advantageMode === "disadvantage" ? " (disadvantage)" : "";
  const dmgBreakdown = allDamageRolls.length > 0 ? ` [${allDamageRolls.join('+')}]` : '';
  if (!mainAttack.hit) {
    if (mainAttack.mirrorImageMiss) {
      narrative = `${attacker.name} attacks ${defender.name} but hits a mirror image duplicate instead! (${mainAttack.total} vs AC ${mainAttack.targetAc})`;
    } else {
      narrative = mainAttack.roll === 1
        ? `${attacker.name} swings at ${defender.name}${advNote} — critical miss! (nat 1${mainAttack.discarded ? `, discarded ${mainAttack.discarded}` : ''})`
        : `${attacker.name} attacks ${defender.name}${advNote} — misses! (nat ${mainAttack.roll}+${mainAttack.total - mainAttack.roll}=${mainAttack.total} vs AC ${mainAttack.targetAc})`;
    }
  } else if (mainAttack.critical) {
    narrative = `${attacker.name} CRITICAL HIT on ${defender.name}${advNote}! ${totalDamage} damage (nat 20 vs AC ${mainAttack.targetAc})${dmgBreakdown}`;
  } else {
    narrative = `${attacker.name} hits ${defender.name}${advNote} for ${totalDamage} damage (nat ${mainAttack.roll}+${mainAttack.total - mainAttack.roll}=${mainAttack.total} vs AC ${mainAttack.targetAc})${dmgBreakdown}`;
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

/** Apply a spell's status effect with concentration tracking if needed */
function applySpellEffect(
  caster: Character,
  target: Character,
  spell: Spell,
  allCharacters: Character[] = [],
): void {
  if (!spell.statusEffect) return;
  const effect: StatusEffect = {
    type: spell.statusEffect.type,
    turnsRemaining: spell.statusEffect.duration,
    potency: spell.statusEffect.potency,
    sourceId: spell.concentration ? `${caster.id}_${spell.id}` : caster.id,
  };
  if (spell.concentration) {
    applyConcentration(caster, spell.id, allCharacters);
  }
  target.statusEffects.push(effect);
}

function resolveSpell(
  caster: Character,
  target: Character,
  action: CombatAction,
  dice: DiceRoller,
  arena?: ArenaConfig,
): CombatResult {
  const spell = caster.spells.find(s => s.id === action.spellId);
  if (!spell) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} tries to cast an unknown spell!`,
      badAction: "unknown_spell",
    };
  }

  // Cooldown check
  if (spell.currentCooldown > 0) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${spell.name} is on cooldown (${spell.currentCooldown} turns remaining).`,
      badAction: "on_cooldown",
    };
  }

  // Spell slot check
  if (!hasSpellSlot(caster.spellSlots, spell.level)) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} has no spell slots left for ${spell.name}!`,
      badAction: "no_spell_slots",
    };
  }

  // Range check
  const dist = distance(caster.position, target.position);
  if (spell.range > 0 && dist > spell.range) {
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} is too far away for ${spell.name}! (${dist.toFixed(0)}ft vs ${spell.range}ft range)`,
      badAction: "out_of_range",
    };
  }

  // Consume slot and set cooldown
  consumeSpellSlot(caster.spellSlots, spell.level);
  spell.currentCooldown = spell.cooldown;

  const castingMod = getMod(caster, spell.castingAbility);
  const spellSaveDc = 8 + castingMod + caster.stats.proficiencyBonus;

  // Shared save tracking (used by control and damage spell branches)
  let saveRoll: number | undefined;
  let saveSuccess: boolean | undefined;
  let saveAdvMode: "advantage" | "disadvantage" | "normal" | undefined;
  let saveTotalValue: number | undefined;
  let saveModValue: number | undefined;

  // Buff spells (self)
  if (spell.type === "buff" && spell.target === "self") {
    if (spell.statusEffect) {
      applySpellEffect(caster, caster, spell, [caster, target]);
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

  // Control/status spells (e.g. Hold Person)
  if (spell.type === "control") {
    let statusApplied: StatusEffectType | undefined;

    if (spell.saveAbility) {
      // Auto-fail from conditions that prevent saving
      if (autoFailSave(target, spell.saveAbility)) {
        if (spell.statusEffect) {
          applySpellEffect(caster, target, spell, [caster, target]);
          statusApplied = spell.statusEffect.type;
        }
        return {
          action, actorId: caster.id, targetId: target.id,
          narrative: `${caster.name} casts ${spell.name}! ${target.name} auto-fails ${spell.saveAbility.toUpperCase()} save (incapacitated) — ${statusApplied}!`,
          spell: {
            spellName: spell.name,
            slotUsed: spell.level,
            slotsRemaining: buildSlotsMap(caster),
            cooldownRemaining: spell.currentCooldown,
            statusApplied,
          },
        };
      }

      const saveMod = getMod(target, spell.saveAbility)
        + (target.savingThrowProfs.includes(spell.saveAbility) ? target.stats.proficiencyBonus : 0);
      saveAdvMode = getSaveAdvantage(target, spell.saveAbility);
      const { result: naturalSave } = dice.d20WithAdvantage(saveAdvMode, `${target.name} ${spell.saveAbility.toUpperCase()} save vs ${spell.name}`);
      const { mod: saveBlessBane } = getBlessBaneMod(target, dice);
      const st = naturalSave + saveMod + saveBlessBane;
      saveRoll = naturalSave;
      saveTotalValue = st;
      saveModValue = saveMod;
      const saveSuccess = st >= spellSaveDc;

      if (!saveSuccess && spell.statusEffect) {
        applySpellEffect(caster, target, spell, [caster, target]);
        statusApplied = spell.statusEffect.type;
      }

      const advNote = saveAdvMode === "advantage" ? " (advantage)" : saveAdvMode === "disadvantage" ? " (disadvantage)" : "";
      const narrative = saveSuccess
        ? `${caster.name} casts ${spell.name}! ${target.name} saves${advNote} — nat ${naturalSave}+${saveMod}=${st} vs DC ${spellSaveDc} — resisted!`
        : `${caster.name} casts ${spell.name}! ${target.name} fails save${advNote} — nat ${naturalSave}+${saveMod}=${st} vs DC ${spellSaveDc} — ${statusApplied}!`;

      return {
        action, actorId: caster.id, targetId: target.id,
        narrative,
        spell: {
          spellName: spell.name,
          slotUsed: spell.level,
          slotsRemaining: buildSlotsMap(caster),
          cooldownRemaining: spell.currentCooldown,
          statusApplied,
        },
      };
    }

    // ── Dispel Magic: remove all magical effects and break concentration ──
    if (spell.id === "dispel_magic") {
      const removedTypes: string[] = [];
      // Remove all status effects that came from a spell (have a sourceId pattern)
      target.statusEffects = target.statusEffects.filter(e => {
        // Keep non-magical effects (grappled, prone, etc.)
        const magicalTypes = ["paralyzed", "shield", "haste", "slow", "invisible", "mirror_image",
          "bless", "bane", "restrained", "spirit_guardians", "blinded", "poisoned",
          "burn", "freeze", "poison", "regen", "defending", "stunned", "frightened",
          "absorb_elements", "disengaging", "unconscious", "stable"];
        if (magicalTypes.includes(e.type)) {
          removedTypes.push(e.type);
          return false;
        }
        return true;
      });
      // Break target's concentration
      if (target.concentrationSpellId) {
        removedTypes.push(`concentration:${target.concentrationSpellId}`);
        breakConcentration(target, [caster, target]);
      }
      const narrative = removedTypes.length > 0
        ? `${caster.name} casts Dispel Magic on ${target.name}! Removed: ${removedTypes.join(", ")}`
        : `${caster.name} casts Dispel Magic on ${target.name} — no magical effects to remove.`;
      return {
        action, actorId: caster.id, targetId: target.id,
        narrative,
        spell: {
          spellName: spell.name,
          slotUsed: spell.level,
          slotsRemaining: buildSlotsMap(caster),
          cooldownRemaining: spell.currentCooldown,
        },
      };
    }

    // Non-save control spell (just apply effect)
    if (spell.statusEffect) {
      applySpellEffect(caster, target, spell, [caster, target]);
      statusApplied = spell.statusEffect.type;
    }
    return {
      action, actorId: caster.id, targetId: target.id,
      narrative: `${caster.name} casts ${spell.name} on ${target.name}!${statusApplied ? ` ${target.name} is ${statusApplied}!` : ""}`,
      spell: {
        spellName: spell.name,
        slotUsed: spell.level,
        slotsRemaining: buildSlotsMap(caster),
        cooldownRemaining: spell.currentCooldown,
        statusApplied,
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

    let narrativeOverride: string | undefined;

    // Attack roll spell (e.g. Fire Bolt, Scorching Ray)
    if (spell.attackRoll) {
      // ── Scorching Ray: 3 separate rays, each 2d6 fire ──
      if (spell.id === "scorching_ray") {
        const spellAttackMod = castingMod + caster.stats.proficiencyBonus;
        const ac = getEffectiveAc(target, caster.position, arena);
        const advMode = getAttackAdvantage(caster, target, [caster, target]);
        targetAc = ac;
        attackTotal = spellAttackMod;

        let rayHits = 0;
        let rayDamage = 0;
        const allRayRolls: number[] = [];

        for (let ray = 0; ray < 3; ray++) {
          const { result: naturalRoll } = dice.d20WithAdvantage(advMode, `${caster.name} Scorching Ray #${ray + 1}`);
          const rayTotal = naturalRoll + spellAttackMod;
          const rayCrit = naturalRoll === 20;
          const rayHit = naturalRoll !== 1 && (rayCrit || rayTotal >= ac);

          if (rayHit) {
            rayHits++;
            const dmg = rollDamageDice(spell.damageDice || "2d6", dice, `Scorching Ray #${ray + 1} damage`, rayCrit);
            rayDamage += dmg.total;
            allRayRolls.push(...dmg.rolls);
            if (rayCrit) wasCrit = true;
          }
          if (ray === 0) {
            attackRoll = naturalRoll;
            hit = rayHit;
          }
        }

        totalDamage = rayDamage;
        damageRolls = allRayRolls;
        narrativeOverride = `${caster.name} fires Scorching Ray at ${target.name}! ${rayHits}/3 rays hit for ${totalDamage} fire damage!`;
      }
      // ── Eldritch Blast: 2 beams at level 5, each 1d10 force ──
      else if (spell.id === "eldritch_blast") {
        const spellAttackMod = castingMod + caster.stats.proficiencyBonus;
        const ac = getEffectiveAc(target, caster.position, arena);
        const advMode = getAttackAdvantage(caster, target, [caster, target]);
        targetAc = ac;
        attackTotal = spellAttackMod;

        let beamHits = 0;
        let beamDamage = 0;
        const allBeamRolls: number[] = [];

        for (let beam = 0; beam < 2; beam++) {
          const { result: naturalRoll } = dice.d20WithAdvantage(advMode, `${caster.name} Eldritch Blast #${beam + 1}`);
          const beamTotal = naturalRoll + spellAttackMod;
          const beamCrit = naturalRoll === 20;
          const beamHit = naturalRoll !== 1 && (beamCrit || beamTotal >= ac);

          if (beamHit) {
            beamHits++;
            const dmg = rollDamageDice("1d10", dice, `Eldritch Blast #${beam + 1} damage`, beamCrit);
            beamDamage += dmg.total;
            allBeamRolls.push(...dmg.rolls);
            if (beamCrit) wasCrit = true;
          }
          if (beam === 0) {
            attackRoll = naturalRoll;
            hit = beamHit;
          }
        }

        totalDamage = beamDamage;
        damageRolls = allBeamRolls;
        narrativeOverride = `${caster.name} fires Eldritch Blast at ${target.name}! ${beamHits}/2 beams hit for ${totalDamage} force damage!`;
      }
      // ── Ray of Frost: 1d8 cold + speed reduction ──
      else if (spell.id === "ray_of_frost") {
        const spellAttackMod = castingMod + caster.stats.proficiencyBonus;
        const ac = getEffectiveAc(target, caster.position, arena);
        const advMode = getAttackAdvantage(caster, target, [caster, target]);
        const { result: naturalRoll } = dice.d20WithAdvantage(advMode, `${caster.name} Ray of Frost attack`);
        const total = naturalRoll + spellAttackMod;
        attackRoll = naturalRoll;
        attackTotal = total;
        targetAc = ac;

        hit = naturalRoll !== 1 && (naturalRoll === 20 || total >= ac);
        wasCrit = naturalRoll === 20;

        if (hit) {
          const dmg = rollDamageDice(spell.damageDice || "1d8", dice, `Ray of Frost damage`, wasCrit);
          totalDamage = dmg.total + castingMod;
          damageRolls = dmg.rolls;
          // Speed reduction: -10ft
          target.stats.speed = Math.max(0, target.stats.speed - 10);
        }
      }
      else {
        // ── Single attack roll spells (Fire Bolt, etc.) ──
        const spellAttackMod = castingMod + caster.stats.proficiencyBonus;
        const ac = getEffectiveAc(target, caster.position, arena);
        const advMode = getAttackAdvantage(caster, target, [caster, target]);
        const { result: naturalRoll } = dice.d20WithAdvantage(advMode, `${caster.name} spell attack (${spell.name})`);
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
    }
    // Saving throw spell (e.g. Fireball)
    else if (spell.saveAbility) {
      const saveAbility = spell.saveAbility;

      // Auto-fail from paralyzed/stunned
      if (autoFailSave(target, saveAbility)) {
        saveRoll = 0;
        saveSuccess = false;
        saveTotalValue = 0;
        saveModValue = 0;
        saveAdvMode = "normal";
        if (spell.damageDice && spell.damageDice !== "0") {
          const dmg = rollDamageDice(spell.damageDice, dice, `${spell.name} damage`, false);
          totalDamage = dmg.total;
          damageRolls = dmg.rolls;
        }
      } else {
        const saveMod = getMod(target, saveAbility)
          + (target.savingThrowProfs.includes(saveAbility) ? target.stats.proficiencyBonus : 0);
        saveAdvMode = getSaveAdvantage(target, saveAbility);
        const { result: naturalSave } = dice.d20WithAdvantage(saveAdvMode, `${target.name} ${saveAbility.toUpperCase()} save vs ${spell.name}`);
        const { mod: saveBlessBane } = getBlessBaneMod(target, dice);
        const st = naturalSave + saveMod + saveBlessBane;
        saveRoll = naturalSave;
        saveTotalValue = st;
        saveModValue = saveMod;
        saveSuccess = st >= spellSaveDc;

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
          applySpellEffect(caster, target, spell, [caster, target]);
          statusApplied = spell.statusEffect.type;
        }
      } else {
        // Non-save damage spell with status effect — apply unconditionally
        applySpellEffect(caster, target, spell, [caster, target]);
        statusApplied = spell.statusEffect.type;
      }
    }

    // Apply damage (with resistance/vulnerability/immunity)
    if (hit && totalDamage > 0) {
      totalDamage = applyDamageModifiers(target, totalDamage, spell.damageType);
      target.stats.hp = Math.max(0, target.stats.hp - totalDamage);
    }

    // Mirror Image: spell attacks can also hit duplicates
    let spellMirrorMiss = false;
    const mirrorEff = target.statusEffects.find(e => e.type === "mirror_image");
    if (mirrorEff && hit && !wasCrit) {
      const images = mirrorEff.potency;
      const mirrorRoll = dice.d(20, "Mirror Image check (spell)");
      const missThreshold = 6 + images * 2;
      if (mirrorRoll <= missThreshold) {
        spellMirrorMiss = true;
        hit = false;
        mirrorEff.potency--;
        if (mirrorEff.potency <= 0) {
          target.statusEffects = target.statusEffects.filter(e => e.type !== "mirror_image");
        }
      }
    }

    // Build narrative
    let narrative: string;
    if (narrativeOverride) {
      narrative = narrativeOverride;
    } else if (!hit) {
      if (spellMirrorMiss) {
        narrative = `${caster.name} casts ${spell.name} at ${target.name} but hits a mirror image duplicate instead!`;
      } else {
        narrative = attackRoll !== undefined
          ? `${caster.name} casts ${spell.name} at ${target.name} — misses! (nat ${attackRoll}+${(attackTotal ?? 0) - attackRoll}=${attackTotal} vs AC ${targetAc})`
          : `${caster.name} casts ${spell.name} — but it fails!`;
      }
    } else if (spell.saveAbility) {
      const advNote = saveAdvMode === "advantage" ? " (advantage)" : saveAdvMode === "disadvantage" ? " (disadvantage)" : "";
      const dmgBreakdown = damageRolls.length > 0 ? ` [${damageRolls.join('+')}]` : '';
      const halfNote = saveSuccess && spell.halfDamageOnSave ? " (half)" : "";
      narrative = saveSuccess
        ? `${caster.name} casts ${spell.name}! ${target.name} saves${advNote} — nat ${saveRoll}+${saveModValue}=${saveTotalValue} vs DC ${spellSaveDc}${halfNote} — ${totalDamage} damage${dmgBreakdown}.`
        : `${caster.name} casts ${spell.name}! ${target.name} fails save${advNote} — nat ${saveRoll}+${saveModValue}=${saveTotalValue} vs DC ${spellSaveDc} — ${totalDamage} damage${dmgBreakdown}!`;
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

  // Safety: all spell paths should return above
  throw new Error(`Unhandled spell type for ${spell.name}`);
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
      badAction: "no_item",
    };
  }

  const item = user.inventory[itemIdx];
  item.quantity--;

  if (item.type === "heal_hp") {
    // Potions heal using dice rolls (5e RAW)
    let healAmount = 0;
    if (item.id === "health_potion") {
      // Potion of Healing: 2d4+2
      for (let i = 0; i < 2; i++) healAmount += dice.d(4, "Potion of Healing");
      healAmount += 2;
    } else if (item.id === "greater_health_potion") {
      // Potion of Greater Healing: 4d4+4
      for (let i = 0; i < 4; i++) healAmount += dice.d(4, "Greater Healing");
      healAmount += 4;
    } else {
      healAmount = item.potency; // fallback for unknown potions
    }
    target.stats.hp = Math.min(target.stats.maxHp, target.stats.hp + healAmount);

    return {
      action, actorId: user.id, targetId: target.id,
      narrative: `${user.name} uses ${item.name}! Heals ${target.name} for ${healAmount} HP.`,
      heal: { amount: healAmount, targetHp: target.stats.hp, targetMaxHp: target.stats.maxHp },
      item: { itemName: item.name, effect: "heal", value: healAmount, remaining: item.quantity },
    };
  }

  if (item.type === "damage" && item.id === "bomb") {
    // Range check for thrown items
    const dist = distance(user.position, target.position);
    if (item.range > 0 && dist > item.range) {
      item.quantity++; // Refund the item since it wasn't thrown
      return {
        action, actorId: user.id, targetId: target.id,
        narrative: `${user.name} tries to throw ${item.name} at ${target.name} but they're too far away! (${dist.toFixed(0)}ft vs ${item.range}ft range)`,
        badAction: "out_of_range",
      };
    }
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
      badAction: "no_ability",
    };
  }

  // Check uses
  if (feature.usesPerBattle > 0 && feature.usesRemaining <= 0) {
    return {
      action, actorId: actor.id, targetId: target.id,
      narrative: `${feature.name} has no uses remaining!`,
      badAction: "no_uses",
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

  // Lay on Hands: heal from pool (paladin only)
  if (abilityId === "lay_on_hands") {
    if (actor.layOnHandsPool <= 0) {
      return { action, actorId: actor.id, narrative: `${actor.name} has no Lay on Hands pool remaining!` };
    }
    const missing = actor.stats.maxHp - actor.stats.hp;
    const healAmount = Math.min(actor.layOnHandsPool, missing);
    actor.stats.hp = Math.min(actor.stats.maxHp, actor.stats.hp + healAmount);
    actor.layOnHandsPool -= healAmount;
    return {
      action, actorId: actor.id,
      narrative: `${actor.name} uses Lay on Hands! Heals ${healAmount} HP. (${actor.layOnHandsPool} pool remaining)`,
      heal: { amount: healAmount, targetHp: actor.stats.hp, targetMaxHp: actor.stats.maxHp },
      abilityResult: { name: "Lay on Hands", description: `Heal ${healAmount} HP from pool`, value: healAmount },
    };
  }

  // Arcane Recovery: recover spell slots (recover up to half caster level in slot levels)
  if (abilityId === "arcane_recovery") {
    // 5e RAW: recover slot levels equal to half caster level (rounded up)
    // At level 5: ceil(5/2) = 3 slot levels
    const maxRecoverLevels = Math.ceil(actor.level / 2);
    let remaining = maxRecoverLevels;
    const recovered: string[] = [];

    // Recover from highest level down (greedy — best value)
    const maxSlotLevel = Math.max(...Object.keys(actor.spellSlots).map(Number).filter(n => !isNaN(n)));
    for (let lv = maxSlotLevel; lv >= 1 && remaining > 0; lv--) {
      const slot = actor.spellSlots[lv];
      if (slot && slot.used > 0 && lv <= remaining) {
        slot.used--;
        remaining -= lv;
        recovered.push(`${lv}${ordinalSuffix(lv)}`);
      }
    }

    if (recovered.length > 0) {
      const slotDesc = recovered.join(" + ");
      return {
        action, actorId: actor.id,
        narrative: `${actor.name} uses Arcane Recovery! Recovered ${slotDesc} level slot${recovered.length > 1 ? "s" : ""}.`,
        abilityResult: { name: "Arcane Recovery", description: `Recovered ${maxRecoverLevels} slot levels`, value: maxRecoverLevels - remaining },
      };
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

function resolveDash(actor: Character, target: Character | undefined, arena: ArenaConfig): CombatResult {
  // Move toward the target (or nearest enemy) at 2x speed
  let effectiveSpeed = actor.stats.speed;
  if (actor.statusEffects.some(e => e.type === "haste")) effectiveSpeed *= 2;
  if (actor.statusEffects.some(e => e.type === "slow")) effectiveSpeed = Math.floor(effectiveSpeed / 2);
  const dashSpeed = effectiveSpeed * 2;

  if (target) {
    const dx = target.position.x - actor.position.x;
    const dy = target.position.y - actor.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      const scale = Math.min(dashSpeed / dist, 1);
      const moveX = Math.round(dx * scale);
      const moveY = Math.round(dy * scale);
      const from = { ...actor.position };
      actor.position = {
        x: Math.max(0, Math.min(arena.width, actor.position.x + moveX)),
        y: Math.max(0, Math.min(arena.height, actor.position.y + moveY)),
      };
      const actualDist = Math.round(Math.sqrt(
        (actor.position.x - from.x) ** 2 + (actor.position.y - from.y) ** 2,
      ) * 10) / 10;
      return {
        action: { type: "dash", actorId: actor.id, targetId: target.id },
        actorId: actor.id,
        narrative: `${actor.name} dashes toward ${target.name}! (${actualDist}ft)`,
        move: { from, to: { ...actor.position }, distanceMoved: actualDist },
      };
    }
  }

  return {
    action: { type: "dash", actorId: actor.id },
    actorId: actor.id,
    narrative: `${actor.name} dashes but has nowhere to go!`,
  };
}

function getAbilityMod(character: Character, ability: "str" | "dex"): number {
  if (ability === "str") return Math.floor((character.stats.str - 10) / 2);
  return Math.floor((character.stats.dex - 10) / 2);
}

function resolveGrapple(
  actor: Character,
  target: Character | undefined,
  dice: DiceRoller,
  _allCharacters: Character[],
): CombatResult {
  if (!target) {
    return {
      action: { type: "grapple", actorId: actor.id },
      actorId: actor.id,
      narrative: `${actor.name} tries to grapple but has no target!`,
      badAction: "no_target",
    };
  }

  const dist = distance(actor.position, target.position);
  if (dist > 5) {
    return {
      action: { type: "grapple", actorId: actor.id, targetId: target.id },
      actorId: actor.id,
      narrative: `${actor.name} tries to grapple ${target.name} but they're too far away! (${dist.toFixed(0)}ft)`,
      badAction: "out_of_range",
    };
  }

  // Grapple: Athletics (STR) vs Athletics/Acrobatics (target chooses)
  // We simplify: attacker uses STR (Athletics), defender uses higher of STR or DEX
  const actorMod = getAbilityMod(actor, "str") + actor.stats.proficiencyBonus;
  const targetStrMod = getAbilityMod(target, "str") + target.stats.proficiencyBonus;
  const targetDexMod = getAbilityMod(target, "dex") + target.stats.proficiencyBonus;
  const targetMod = Math.max(targetStrMod, targetDexMod);

  const { result: actorRoll } = dice.d20WithAdvantage(
    "normal", `${actor.name} grapple attempt (Athletics)`
  );
  const { result: targetRoll } = dice.d20WithAdvantage(
    "normal", `${target.name} grapple resist (Athletics/Acrobatics)`
  );

  const actorTotal = actorRoll + actorMod;
  const targetTotal = targetRoll + targetMod;

  if (actorTotal >= targetTotal) {
    // Apply grappled condition to target
    target.statusEffects.push({
      type: "grappled",
      turnsRemaining: 10, // lasts until escap d or grapp ler drops
      potency: 0,
      sourceId: actor.id,
    });
    return {
      action: { type: "grapple", actorId: actor.id, targetId: target.id },
      actorId: actor.id,
      narrative: `${actor.name} grapples ${target.name}! (${actorTotal} vs ${targetTotal}) ${target.name}'s speed is now 0.`,
      spell: { slotUsed: 0, statusApplied: "grappled", spellName: "Grapple", cooldownRemaining: 0 },
    };
  }

  return {
    action: { type: "grapple", actorId: actor.id, targetId: target.id },
    actorId: actor.id,
    narrative: `${actor.name} tries to grapple ${target.name} but fails! (${actorTotal} vs ${targetTotal})`,
  };
}

function resolveShove(
  actor: Character,
  target: Character | undefined,
  dice: DiceRoller,
  _allCharacters: Character[],
): CombatResult {
  if (!target) {
    return {
      action: { type: "shove", actorId: actor.id },
      actorId: actor.id,
      narrative: `${actor.name} tries to shove but has no target!`,
      badAction: "no_target",
    };
  }

  const dist = distance(actor.position, target.position);
  if (dist > 5) {
    return {
      action: { type: "shove", actorId: actor.id, targetId: target.id },
      actorId: actor.id,
      narrative: `${actor.name} tries to shove ${target.name} but they're too far away! (${dist.toFixed(0)}ft)`,
      badAction: "out_of_range",
    };
  }

  // Shove: Athletics (STR) vs Athletics/Acrobatics (target chooses)
  const actorMod = getAbilityMod(actor, "str") + actor.stats.proficiencyBonus;
  const targetStrMod = getAbilityMod(target, "str") + target.stats.proficiencyBonus;
  const targetDexMod = getAbilityMod(target, "dex") + target.stats.proficiencyBonus;
  const targetMod = Math.max(targetStrMod, targetDexMod);

  const { result: actorRoll } = dice.d20WithAdvantage(
    "normal", `${actor.name} shove attempt (Athletics)`
  );
  const { result: targetRoll } = dice.d20WithAdvantage(
    "normal", `${target.name} shove resist (Athletics/Acrobatics)`
  );

  const actorTotal = actorRoll + actorMod;
  const targetTotal = targetRoll + targetMod;

  if (actorTotal >= targetTotal) {
    // Push target 5ft away and knock prone
    const dx = target.position.x - actor.position.x;
    const dy = target.position.y - actor.position.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const from = { ...target.position };
    target.position = {
      x: Math.max(0, Math.min(100, target.position.x + Math.round(dx / d * 5))),
      y: Math.max(0, Math.min(60, target.position.y + Math.round(dy / d * 5))),
    };

    // Remove any existing grapple on target from this actor (they're pushed away)
    target.statusEffects = target.statusEffects.filter(
      e => !(e.type === "grappled" && e.sourceId === actor.id)
    );

    // Apply prone
    target.statusEffects.push({
      type: "prone",
      turnsRemaining: 10, // lasts until target spends half move to stand
      potency: 0,
      sourceId: actor.id,
    });

    const pushedDist = Math.round(Math.sqrt(
      (target.position.x - from.x) ** 2 + (target.position.y - from.y) ** 2,
    ) * 10) / 10;

    return {
      action: { type: "shove", actorId: actor.id, targetId: target.id },
      actorId: actor.id,
      narrative: `${actor.name} shoves ${target.name} ${pushedDist}ft and knocks them prone! (${actorTotal} vs ${targetTotal})`,
      spell: { slotUsed: 0, statusApplied: "prone", spellName: "Shove", cooldownRemaining: 0 },
    };
  }

  return {
    action: { type: "shove", actorId: actor.id, targetId: target.id },
    actorId: actor.id,
    narrative: `${actor.name} tries to shove ${target.name} but fails! (${actorTotal} vs ${targetTotal})`,
  };
}

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
  // Move toward the nearest edge at full speed
  const distToLeft = actor.position.x;
  const distToRight = arena.width - actor.position.x;
  const speed = actor.stats.speed;

  // Dash toward nearest edge
  if (distToLeft < distToRight) {
    actor.position.x = Math.max(0, actor.position.x - speed);
  } else {
    actor.position.x = Math.min(arena.width, actor.position.x + speed);
  }

  const escaped = actor.position.x <= 0 || actor.position.x >= arena.width;

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
  // Grappled characters can't move
  if (character.statusEffects.some(e => e.type === "grappled")) {
    return {
      from: { ...character.position },
      to: { ...character.position },
      distanceMoved: 0,
    };
  }

  // Calculate effective speed with status modifiers
  let effectiveSpeed = character.stats.speed;
  if (character.statusEffects.some(e => e.type === "haste")) effectiveSpeed *= 2;
  if (character.statusEffects.some(e => e.type === "slow")) effectiveSpeed = Math.floor(effectiveSpeed / 2);

  const maxDist = maxMovePerTurn(effectiveSpeed);

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

  // Prone: auto-stand at cost of half movement (simplified 5e)
  const proneEffect = character.statusEffects.find(e => e.type === "prone");
  if (proneEffect) {
    character.stats.speed = Math.floor(character.stats.speed / 2);
    narratives.push(`${character.name} stands up from prone (costs half movement).`);
    // Remove prone after standing
    character.statusEffects = character.statusEffects.filter(e => e.type !== "prone");
  }

  character.statusEffects = character.statusEffects.filter((effect) => {
    // Grappled: remove if grappler is dead or no longer adjacent
    if (effect.type === "grappled") {
      // Keep grappled — it persists until escape or grappler is incapacitated
      // The grapple check happens elsewhere; just keep ticking
    }

    if (effect.type === "burn") {
      character.stats.hp = Math.max(0, character.stats.hp - effect.potency);
      narratives.push(`${character.name} takes ${effect.potency} burn damage!`);
    }

    if (effect.type === "poison") {
      character.stats.hp = Math.max(0, character.stats.hp - effect.potency);
      narratives.push(`${character.name} takes ${effect.potency} poison damage!`);
    }

    if (effect.type === "decay") {
      character.stats.hp = Math.max(0, character.stats.hp - effect.potency);
      narratives.push(`${character.name} takes ${effect.potency} decay damage!`);
      effect.potency += 2; // Escalate each turn
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
  allCharacters: Character[] = [],
): CombatResult {
  // Timeout: agent couldn't decide in time — wasted turn
  if (action.timedOut) {
    return {
      action,
      actorId: actor.id,
      narrative: `${actor.name} is dazed and loses focus, unable to act!`,
      badAction: "timeout",
    };
  }

  // Resolve move first (if any)
  let moveResult: MoveResult | undefined;
  if (action.move && arena) {
    moveResult = resolveMove(actor, action.move, arena);
  }

  // Track invisibility before main action
  const wasInvisibleBefore = actor.statusEffects.some(e => e.type === "invisible");

  let result: CombatResult;

  switch (action.type) {
    case "attack":
      if (!target) return { action, actorId: actor.id, narrative: "No target!" };
      result = resolveAttack(actor, target, action, dice, allCharacters, arena);
      break;

    case "cast_spell":
      if (!target) return { action, actorId: actor.id, narrative: "No target!" };
      result = resolveSpell(actor, target, action, dice, arena);
      // ── AoE: hit additional targets within radius ──
      if (action.spellId) {
        const spell = actor.spells.find(s => s.id === action.spellId);
        if (spell?.aoeRadius && spell.aoeRadius > 0 && allCharacters.length > 0) {
          const primaryPos = target.position;
          const aoeTargets = allCharacters.filter(c =>
            c.id !== actor.id && c.id !== target.id && c.stats.hp > 0 &&
            distance(c.position, primaryPos) <= (spell.aoeRadius || 0),
          );
          for (const aoeTarget of aoeTargets) {
            const aoeResult = resolveSpell(actor, aoeTarget, action, dice, arena);
            result.narrative += ` [AoE: ${aoeResult.narrative}]`;
          }
        }
      }
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

    case "dash":
      result = resolveDash(actor, target, arena || { width: 100, height: 60, label: "Arena" });
      break;

    case "grapple":
      result = resolveGrapple(actor, target, dice, allCharacters);
      break;

    case "shove":
      result = resolveShove(actor, target, dice, allCharacters);
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

  // Resolve bonus action if present
  if (action.bonusAction) {
    const bonusResult = resolveBonusAction(actor, target, action.bonusAction, dice, allCharacters);
    // Append bonus action narrative to the main result
    result.narrative += ` [BONUS: ${bonusResult.narrative}]`;
    // If bonus action dealt damage, update the main result's damage
    if (bonusResult.damage) {
      if (result.damage) {
        // Both dealt damage — combine
        result.damage.damage += bonusResult.damage.damage;
        result.damage.damageRolls = [...(result.damage.damageRolls || []), ...(bonusResult.damage.damageRolls || [])];
      } else {
        result.damage = bonusResult.damage;
      }
    }
    if (bonusResult.heal) {
      result.heal = bonusResult.heal;
    }
  }

  // ── Invisibility breaks on attack or spell cast ──
  // Only breaks if actor was invisible *before* the action started
  if (wasInvisibleBefore && (action.type === "attack" || action.type === "cast_spell")) {
    const invIdx = actor.statusEffects.findIndex(e => e.type === "invisible");
    if (invIdx >= 0) {
      actor.statusEffects.splice(invIdx, 1);
      result.narrative += ` ${actor.name}'s invisibility fades!`;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════
//  Bonus Action Resolution
// ═══════════════════════════════════════════════════════

export function resolveBonusAction(
  actor: Character,
  target: Character | undefined,
  bonusAction: BonusAction,
  dice: DiceRoller,
  allCharacters: Character[] = [],
): CombatResult {
  switch (bonusAction.type) {
    case "off_hand_attack": {
      // Can't use off-hand with two-handed weapons
      if (actor.weapon.properties.includes("two-handed")) {
        return { action: { type: "wait", actorId: actor.id }, actorId: actor.id, narrative: `${actor.name} can't make an off-hand attack with a two-handed weapon!` };
      }
      // Two-Weapon Fighting: off-hand light weapon attack (no ability mod to damage)
      const offTarget = bonusAction.targetId
        ? allCharacters.find(c => c.id === bonusAction.targetId) || target
        : target;
      if (!offTarget) return { action: { type: "wait", actorId: actor.id }, actorId: actor.id, narrative: "No off-hand target!" };
      const dist = distance(actor.position, offTarget.position);
      const weaponRange = actor.weapon.range;
      if (dist > weaponRange) {
        return { action: { type: "wait", actorId: actor.id }, actorId: actor.id, narrative: `Off-hand attack: ${offTarget.name} is too far away! (${dist.toFixed(0)}ft)`, badAction: "out_of_range" };
      }
      const roll = dice.d20(`${actor.name} off-hand attack`);
      const total = roll + actor.stats.proficiencyBonus + abilityModifier(actor.stats[actor.weapon.abilityMod as AbilityName]);
      const isCrit = roll === 20;
      const isMiss = roll === 1 || total < offTarget.stats.ac;
      let damageRolls: number[] = [];
      let damage = 0;
      if (!isMiss) {
        const dmgResult = dice.rollDiceDetailed(actor.weapon.damageDice, `off-hand ${isCrit ? "crit" : "damage"}`);
        damageRolls = isCrit ? [...dmgResult.rolls, ...dmgResult.rolls] : dmgResult.rolls;
        // No ability modifier on off-hand damage UNLESS Two-Weapon Fighting style
        damage = damageRolls.reduce((a, b) => a + b, 0);
        if (actor.fightingStyle === "two_weapon_fighting") {
          damage += abilityModifier(actor.stats[actor.weapon.abilityMod as AbilityName]);
        }
        offTarget.stats.hp = Math.max(0, offTarget.stats.hp - damage);
      }
      const narrative = isMiss
        ? `${actor.name}'s off-hand attack misses ${offTarget.name}! (${total} vs AC ${offTarget.stats.ac})`
        : `${actor.name}'s off-hand attack hits ${offTarget.name} for ${damage} damage!${isCrit ? " CRITICAL HIT!" : ""}`;
      return {
        action: { type: "attack", actorId: actor.id, targetId: offTarget.id },
        actorId: actor.id,
        targetId: offTarget?.id,
        narrative,
        damage: !isMiss ? { damage, wasCrit: !!isCrit, wasMiss: false, effective: "normal", targetHp: offTarget.stats.hp, targetMaxHp: offTarget.stats.maxHp, attackRoll: roll, attackTotal: total, targetAc: offTarget.stats.ac, damageRolls } : undefined,
      };
    }

    case "healing_word": {
      // Bonus action heal: 1d4 + WIS mod. Target specified by bonusAction.targetId or defaults to self
      const healTarget = bonusAction.targetId
        ? allCharacters.find(c => c.id === bonusAction.targetId) || actor
        : actor;
      const wisMod = abilityModifier(actor.stats.wis);
      const healRoll = dice.d4("healing_word");
      const amount = Math.max(1, healRoll + Math.max(0, wisMod));
      healTarget.stats.hp = Math.min(healTarget.stats.maxHp, healTarget.stats.hp + amount);
      return {
        action: { type: "cast_spell", actorId: actor.id, targetId: healTarget.id, spellId: "healing_word" },
        actorId: actor.id,
        targetId: healTarget.id,
        narrative: `${actor.name} casts Healing Word on ${healTarget.name}! Heals ${amount} HP. (${healRoll}+${Math.max(0, wisMod)})`,
        heal: { amount, targetHp: healTarget.stats.hp, targetMaxHp: healTarget.stats.maxHp },
      };
    }

    case "cunning_action": {
      // Rogue bonus action: dash, disengage, or hide
      const variant = bonusAction.variant || "dash";
      if (variant === "dash") {
        actor.stats.speed = actor.stats.speed * 2;
        return {
          action: { type: "class_ability", actorId: actor.id, abilityId: "cunning_action" },
          actorId: actor.id,
          narrative: `${actor.name} uses Cunning Action to Dash! Speed doubled to ${actor.stats.speed}ft.`,
        };
      } else if (variant === "disengage") {
        actor.statusEffects.push({ type: "disengaging", turnsRemaining: 1, potency: 0, sourceId: actor.id });
        return {
          action: { type: "class_ability", actorId: actor.id, abilityId: "cunning_action" },
          actorId: actor.id,
          narrative: `${actor.name} uses Cunning Action to Disengage! No attacks of opportunity.`,
        };
      } else {
        actor.statusEffects.push({ type: "invisible", turnsRemaining: 1, potency: 0, sourceId: actor.id });
        return {
          action: { type: "class_ability", actorId: actor.id, abilityId: "cunning_action" },
          actorId: actor.id,
          narrative: `${actor.name} uses Cunning Action to Hide! Becomes invisible.`,
        };
      }
    }

    case "misty_step": {
      const enemy = allCharacters.find(c => c.id !== actor.id && c.team !== actor.team && c.stats.hp > 0);
      if (enemy && actor.position) {
        const dx = enemy.position.x - actor.position.x;
        const dy = enemy.position.y - actor.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          const teleportDist = Math.min(30, dist);
          actor.position.x = Math.round(Math.min(100, Math.max(0, actor.position.x + (dx / dist) * teleportDist)));
          actor.position.y = Math.round(Math.min(60, Math.max(0, actor.position.y + (dy / dist) * teleportDist)));
        }
      }
      return {
        action: { type: "cast_spell", actorId: actor.id, spellId: "misty_step" },
        actorId: actor.id,
        narrative: `${actor.name} casts Misty Step and teleports up to 30ft!`,
      };
    }

    default:
      return {
        action: { type: "wait", actorId: actor.id },
        actorId: actor.id,
        narrative: `${actor.name} considers a bonus action but does nothing.`,
      };
  }

}

// ═══════════════════════════════════════════════════════
//  Reaction System — D&D 5e Reactions
// ═══════════════════════════════════════════════════════

/**
 * Check if a movement triggers an Attack of Opportunity.
 * In 5e, leaving an enemy's reach (moving from within to outside) provokes.
 * Disengaging prevents this.
 */
export function checkOpportunityAttack(
  mover: Character,
  fromPos: Position,
  toPos: Position,
  enemies: Character[],
  dice: DiceRoller,
): ReactionResult | null {
  // Disengaging prevents opportunity attacks
  if (mover.statusEffects.some(e => e.type === "disengaging")) return null;
  // Unconscious/dead characters don't get reactions
  for (const enemy of enemies) {
    if (enemy.stats.hp <= 0) continue;
    if (enemy.reactionUsed) continue;

    // Check if mover was within enemy's reach before moving
    const distBefore = distance(fromPos, enemy.position);
    const distAfter = distance(toPos, enemy.position);
    const reach = enemy.weapon.range; // Weapon reach (5ft for melee)

    // Moving FROM within reach TO outside reach = opportunity
    if (distBefore <= reach && distAfter > reach) {
      enemy.reactionUsed = true;

      // Resolve the opportunity attack
      const weapon = enemy.weapon;
      const advantageMode = getAttackAdvantage(enemy, mover, [enemy, mover]);
      const { result: roll } = dice.d20WithAdvantage(advantageMode, `${enemy.name} opportunity attack`);
      const total = roll + getMod(enemy, weapon.abilityMod) + enemy.stats.proficiencyBonus;
      const targetAc = getEffectiveAc(mover);
      const isCrit = roll === 20;
      const isHit = isCrit || (roll !== 1 && total >= targetAc);

      let damage = 0;
      let damageRolls: number[] = [];
      if (isHit) {
      const useVersatile = weapon.properties.includes("versatile") && !enemy.equippedShield;
      const dmgResult = rollWeaponDamage(weapon, enemy, dice, isCrit, `${enemy.name} opportunity damage`, useVersatile);
        damage = dmgResult.total;
        damageRolls = dmgResult.rolls;
        mover.stats.hp = Math.max(0, mover.stats.hp - damage);
      }

      const narrative = isHit
        ? `${enemy.name} gets an Attack of Opportunity against ${mover.name}! Hits for ${damage} damage!`
        : `${enemy.name} gets an Attack of Opportunity against ${mover.name} but misses! (${total} vs AC ${targetAc})`;

      return {
        triggered: true,
        actorId: enemy.id,
        type: "attack_of_opportunity",
        narrative,
        damage: !isHit ? undefined : {
          damage, wasCrit: !!isCrit, wasMiss: false, effective: "normal",
          targetHp: mover.stats.hp, targetMaxHp: mover.stats.maxHp,
          attackRoll: roll, attackTotal: total, targetAc, damageRolls,
        },
      };
    }
  }
  return null;
}

/**
 * Check if a character can use Shield as a reaction when hit by an attack.
 * Shield gives +5 AC until the start of the caster's next turn.
 * In 5e, this is cast as a reaction — NOT an action.
 */
export function checkShieldReaction(
  defender: Character,
  _attackRoll: number,
  attackTotal: number,
): ReactionResult | null {
  if (defender.reactionUsed) return null;
  if (defender.stats.hp <= 0) return null;

  const shieldSpell = defender.spells.find(s => s.id === "shield" && s.currentCooldown === 0);
  if (!shieldSpell) return null;
  if (!hasSpellSlot(defender.spellSlots, shieldSpell.level)) return null;

  // Shield adds +5 AC — would the attack still hit?
  const currentAc = getEffectiveAc(defender);
  const shieldedAc = currentAc + 5;

  if (attackTotal >= shieldedAc) {
    // Even with shield, attack still hits — no point using it
    return null;
  }

  // Shield would block this attack — use it!
  defender.reactionUsed = true;
  consumeSpellSlot(defender.spellSlots, shieldSpell.level);
  shieldSpell.currentCooldown = shieldSpell.cooldown;

  // Apply shield status effect (+5 AC for 1 round)
  defender.statusEffects.push({
    type: "shield",
    turnsRemaining: 1,
    potency: 5,
    sourceId: defender.id,
  });

  return {
    triggered: true,
    actorId: defender.id,
    type: "shield_spell",
    narrative: `${defender.name} casts Shield as a reaction! +5 AC (${currentAc} → ${shieldedAc}), blocking the attack!`,
    acBonus: 5,
  };
}

/**
 * Check if a rogue can use Uncanny Dodge as a reaction to halve damage.
 * Uncanny Dodge is a Rogue level 5 class feature.
 */
export function checkUncannyDodge(
  defender: Character,
): ReactionResult | null {
  if (defender.reactionUsed) return null;
  if (defender.stats.hp <= 0) return null;

  const hasUncannyDodge = defender.features.some(f => f.id === "uncanny_dodge" && f.usesRemaining > 0);
  if (!hasUncannyDodge) return null;

  defender.reactionUsed = true;
  const feature = defender.features.find(f => f.id === "uncanny_dodge")!;
  feature.usesRemaining--;

  return {
    triggered: true,
    actorId: defender.id,
    type: "uncanny_dodge",
    narrative: `${defender.name} uses Uncanny Dodge! Damage halved!`,
    damageHalved: true,
  };
}

/**
 * Apply reaction effects to damage — called after resolving an attack.
 * Checks Shield (may negate the hit) and Uncanny Dodge (halve damage).
 * Returns updated damage and any reaction narratives.
 */
export function applyDefensiveReactions(
  defender: Character,
  attackerTotal: number,
  damage: number,
): { damage: number; reactions: ReactionResult[]; hitBlocked: boolean } {
  const reactions: ReactionResult[] = [];
  let currentDamage = damage;
  let hitBlocked = false;

  // Check Shield reaction (may block the hit entirely)
  const shieldReaction = checkShieldReaction(defender, 0, attackerTotal);
  if (shieldReaction) {
    reactions.push(shieldReaction);
    hitBlocked = true;
    currentDamage = 0;
    return { damage: 0, reactions, hitBlocked: true };
  }

  // Check Uncanny Dodge (halve damage)
  const uncannyReaction = checkUncannyDodge(defender);
  if (uncannyReaction && currentDamage > 0) {
    reactions.push(uncannyReaction);
    currentDamage = Math.floor(currentDamage / 2);
    // Refund the halved damage to defender's HP
    defender.stats.hp = Math.min(defender.stats.maxHp, defender.stats.hp + Math.floor(damage / 2));
  }

  return { damage: currentDamage, reactions, hitBlocked };
}

/** Reset reaction flags at the start of a character's turn */
export function resetReaction(character: Character): void {
  character.reactionUsed = false;
}

// ═══════════════════════════════════════════════════════
//  Death Saves — D&D 5e dying mechanic
// ═══════════════════════════════════════════════════════

/** Check if a character is dying (unconscious but not dead) */
export function isDying(character: Character): boolean {
  return character.stats.hp <= 0
    && character.deathSaveFailures < 3
    && character.deathSaveSuccesses < 3;
}

/** Check if a character is truly dead (3 death save failures) */
export function isDead(character: Character): boolean {
  return character.deathSaveFailures >= 3;
}

/** Check if a character is stable (3 death save successes, still at 0 HP) */
export function isStable(character: Character): boolean {
  return character.stats.hp <= 0 && character.deathSaveSuccesses >= 3;
}

/**
 * Apply damage to a dying character — each hit = 1 failure, crit = 2 failures.
 * Returns death save failure count added.
 */
export function applyDamageToDying(character: Character, isCritical: boolean): number {
  const failures = isCritical ? 2 : 1;
  character.deathSaveFailures += failures;
  return failures;
}

/**
 * Roll a death save for an unconscious character.
 * d20: 10+ = success, 9- = failure.
 * Nat 20 = regain 1 HP (conscious!).
 * Nat 1 = 2 failures.
 * Returns the roll result and outcome.
 */
export function rollDeathSave(character: Character, dice: DiceRoller): {
  roll: number;
  successes: number;
  failures: number;
  regainedHp: boolean;
} {
  const roll = dice.d20(`${character.name} death save`);
  let successes = 0;
  let failures = 0;
  let regainedHp = false;

  if (roll === 20) {
    // Nat 20: regain 1 HP
    character.stats.hp = 1;
    character.deathSaveSuccesses = 0;
    character.deathSaveFailures = 0;
    regainedHp = true;
    // Remove unconscious effect if present
    character.statusEffects = character.statusEffects.filter(e => e.type !== "unconscious");
  } else if (roll === 1) {
    failures = 2;
    character.deathSaveFailures += 2;
  } else if (roll >= 10) {
    successes = 1;
    character.deathSaveSuccesses += 1;
  } else {
    failures = 1;
    character.deathSaveFailures += 1;
  }

  return { roll, successes, failures, regainedHp };
}

/**
 * Mark a character as unconscious (0 HP transition).
 * Resets death saves and adds unconscious status.
 */
export function markUnconscious(character: Character): void {
  character.stats.hp = 0;
  character.deathSaveSuccesses = 0;
  character.deathSaveFailures = 0;
  // Add unconscious status if not already present
  if (!character.statusEffects.some(e => e.type === "unconscious")) {
    character.statusEffects.push({
      type: "unconscious",
      turnsRemaining: 99, // indefinite
      potency: 0,
      sourceId: "death",
    });
  }
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
        bonusAction: s.bonusAction,
        aoeRadius: s.aoeRadius,
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
        versatileDice: c.weapon.versatileDice,
        abilityMod: c.weapon.abilityMod, range: c.weapon.range,
      },
      savingThrowProfs: [...c.savingThrowProfs],
      fightingStyle: c.fightingStyle,
      equippedShield: c.equippedShield,
      concentrationSpellId: c.concentrationSpellId,
      reactionUsed: c.reactionUsed,
      deathSaveSuccesses: c.deathSaveSuccesses,
      deathSaveFailures: c.deathSaveFailures,
      layOnHandsPool: c.layOnHandsPool,
      resistances: [...c.resistances],
      vulnerabilities: [...c.vulnerabilities],
      immunities: [...c.immunities],
    })),
    turnNumber,
    phase,
    arena: { ...arena },
  };
}
