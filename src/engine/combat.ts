// ─────────────────────────────────────────────────────────
//  Combat Engine — resolves all RPG actions
// ─────────────────────────────────────────────────────────

import {
  Character,
  CombatAction,
  CombatResult,
  DamageResult,
  SpellResult,
  ItemResult,
  BattleStateSnapshot,
  BattlePhase,
  BattleLog,
  TurnResult,
  StatusEffect,
  StatusEffectType,
} from "./types.js";
import { createCharacter } from "./characters.js";

// ── Helpers ─────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roll(chance: number): boolean {
  return Math.random() < chance;
}

function damageVariance(base: number): number {
  const factor = 0.9 + Math.random() * 0.2; // 90%–110%
  return Math.round(base * factor);
}

// ── Status Effect Processing ────────────────────────────

export function processStatusEffects(character: Character): string[] {
  const narratives: string[] = [];

  character.statusEffects = character.statusEffects.filter((effect) => {
    if (effect.type === "burn") {
      const dmg = effect.potency;
      character.stats.hp = Math.max(0, character.stats.hp - dmg);
      narratives.push(`🔥 ${character.name} takes ${dmg} burn damage!`);
    } else if (effect.type === "poison") {
      const dmg = effect.potency;
      character.stats.hp = Math.max(0, character.stats.hp - dmg);
      narratives.push(`☠️ ${character.name} takes ${dmg} poison damage!`);
    } else if (effect.type === "regen") {
      const heal = effect.potency;
      character.stats.hp = Math.min(character.stats.maxHp, character.stats.hp + heal);
      narratives.push(`💚 ${character.name} regenerates ${heal} HP!`);
    }

    effect.turnsRemaining--;
    return effect.turnsRemaining > 0;
  });

  // Remove shield if expired
  if (!character.statusEffects.some((e) => e.type === "shield")) {
    // shield bonus was already applied; we track it via the effect presence
  }

  return narratives;
}

function hasStatus(character: Character, type: StatusEffectType): boolean {
  return character.statusEffects.some((e) => e.type === type);
}

function getEffectiveDefense(character: Character): number {
  let def = character.stats.defense;
  if (character.isDefending) def += 10;
  if (hasStatus(character, "shield")) {
    const shieldEffect = character.statusEffects.find((e) => e.type === "shield")!;
    def += shieldEffect.potency;
  }
  return def;
}

function getEffectiveSpeed(character: Character): number {
  let spd = character.stats.speed;
  if (hasStatus(character, "haste")) spd = Math.round(spd * 1.3);
  if (hasStatus(character, "slow")) spd = Math.round(spd * 0.7);
  return spd;
}

// ── Action Resolvers ────────────────────────────────────

function resolveAttack(
  attacker: Character,
  defender: Character
): CombatResult {
  const narrative: string[] = [];

  // Freeze check — skip turn
  if (hasStatus(attacker, "freeze")) {
    narrative.push(`❄️ ${attacker.name} is frozen solid and can't move!`);
    return {
      action: { type: "attack", actorId: attacker.id, targetId: defender.id },
      actorId: attacker.id,
      targetId: defender.id,
      narrative: narrative.join(" "),
    };
  }

  // Blind check — miss chance
  const missChance = hasStatus(attacker, "blind") ? 0.4 : 0;
  if (roll(missChance)) {
    narrative.push(`${attacker.name} swings wildly but misses!`);
    return {
      action: { type: "attack", actorId: attacker.id, targetId: defender.id },
      actorId: attacker.id,
      targetId: defender.id,
      narrative: narrative.join(" "),
      damage: {
        damage: 0,
        wasCrit: false,
        wasMiss: true,
        effective: "normal",
        targetHp: defender.stats.hp,
        targetMaxHp: defender.stats.maxHp,
      },
    };
  }

  // Dodge check (based on speed)
  const dodgeChance = getEffectiveSpeed(defender) / 200;
  if (roll(dodgeChance)) {
    narrative.push(`${defender.name} dodges the attack!`);
    return {
      action: { type: "attack", actorId: attacker.id, targetId: defender.id },
      actorId: attacker.id,
      targetId: defender.id,
      narrative: narrative.join(" "),
      damage: {
        damage: 0,
        wasCrit: false,
        wasMiss: true,
        effective: "normal",
        targetHp: defender.stats.hp,
        targetMaxHp: defender.stats.maxHp,
      },
    };
  }

  // Damage calculation
  const baseDmg = attacker.stats.strength * 2 + 5;
  const effectiveDef = getEffectiveDefense(defender);
  let finalDmg = Math.max(1, baseDmg - effectiveDef / 2);
  finalDmg = damageVariance(finalDmg);

  // Crit check
  const critChance = attacker.stats.luck / 100;
  const wasCrit = roll(critChance);
  if (wasCrit) {
    finalDmg = Math.round(finalDmg * 1.8);
  }

  finalDmg = Math.max(1, Math.round(finalDmg));
  defender.stats.hp = clamp(defender.stats.hp - finalDmg, 0, defender.stats.maxHp);

  narrative.push(
    `⚔️ ${attacker.name} attacks ${defender.name} for ${finalDmg} damage!` +
      (wasCrit ? " 💥 CRITICAL HIT!" : "") +
      (defender.stats.hp <= 0 ? ` ${defender.name} has fallen!` : "")
  );

  return {
    action: { type: "attack", actorId: attacker.id, targetId: defender.id },
    actorId: attacker.id,
    targetId: defender.id,
    narrative: narrative.join(" "),
    damage: {
      damage: finalDmg,
      wasCrit,
      wasMiss: false,
      effective: "normal",
      targetHp: defender.stats.hp,
      targetMaxHp: defender.stats.maxHp,
    },
  };
}

function resolveSpell(
  caster: Character,
  target: Character,
  spellId: string
): CombatResult {
  const spell = caster.spells.find((s) => s.id === spellId);

  if (!spell) {
    return {
      action: { type: "cast_spell", actorId: caster.id, targetId: target.id, spellId: spellId as any },
      actorId: caster.id,
      targetId: target.id,
      narrative: `${caster.name} tries to cast an unknown spell and stumbles!`,
    };
  }

  if (spell.currentCooldown > 0) {
    return {
      action: { type: "cast_spell", actorId: caster.id, targetId: target.id, spellId },
      actorId: caster.id,
      targetId: target.id,
      narrative: `${caster.name} tries to cast ${spell.name} but it's on cooldown (${spell.currentCooldown} turns remaining)!`,
    };
  }

  if (caster.stats.mp < spell.mpCost) {
    return {
      action: { type: "cast_spell", actorId: caster.id, targetId: target.id, spellId },
      actorId: caster.id,
      targetId: target.id,
      narrative: `${caster.name} doesn't have enough MP to cast ${spell.name}! (${caster.stats.mp}/${spell.mpCost} MP)`,
    };
  }

  // Consume MP and set cooldown
  caster.stats.mp -= spell.mpCost;
  spell.currentCooldown = spell.cooldown;

  const narrative: string[] = [];
  let spellResult: SpellResult = {
    spellName: spell.name,
    mpRemaining: caster.stats.mp,
    cooldownRemaining: spell.currentCooldown,
  };

  if (spell.type === "damage" || spell.type === "drain") {
    // Spell damage
    const baseDmg = spell.basePower + caster.stats.magic * 1.5;
    let finalDmg = Math.max(1, baseDmg - getEffectiveDefense(target) * 0.3);
    finalDmg = damageVariance(finalDmg);

    const wasCrit = roll(caster.stats.luck / 120);
    if (wasCrit) finalDmg = Math.round(finalDmg * 1.6);

    finalDmg = Math.max(1, Math.round(finalDmg));
    target.stats.hp = clamp(target.stats.hp - finalDmg, 0, target.stats.maxHp);

    spellResult.damage = {
      damage: finalDmg,
      wasCrit,
      wasMiss: false,
      effective: "normal",
      targetHp: target.stats.hp,
      targetMaxHp: target.stats.maxHp,
    };

    narrative.push(
      `✨ ${caster.name} casts ${spell.name} on ${target.name} for ${finalDmg} damage!` +
        (wasCrit ? " 💥 CRITICAL!" : "")
    );

    // Drain: heal attacker for damage dealt
    if (spell.type === "drain") {
      const healAmt = Math.round(finalDmg * 0.5);
      caster.stats.hp = clamp(caster.stats.hp + healAmt, 0, caster.stats.maxHp);
      spellResult.heal = {
        amount: healAmt,
        targetHp: caster.stats.hp,
        targetMaxHp: caster.stats.maxHp,
      };
      narrative.push(` ${caster.name} drains ${healAmt} HP!`);
    }
  } else if (spell.type === "heal") {
    const healAmt = damageVariance(spell.basePower + caster.stats.magic);
    caster.stats.hp = clamp(caster.stats.hp + healAmt, 0, caster.stats.maxHp);
    spellResult.heal = {
      amount: healAmt,
      targetHp: caster.stats.hp,
      targetMaxHp: caster.stats.maxHp,
    };
    narrative.push(`💚 ${caster.name} casts ${spell.name} and restores ${healAmt} HP!`);
  } else if (spell.type === "buff") {
    // Buffs are handled via status effects below
    narrative.push(`🛡️ ${caster.name} casts ${spell.name}!`);
  } else if (spell.type === "debuff") {
    const baseDmg = spell.basePower + caster.stats.magic * 0.8;
    const finalDmg = Math.max(1, Math.round(damageVariance(baseDmg)));
    target.stats.hp = clamp(target.stats.hp - finalDmg, 0, target.stats.maxHp);
    spellResult.damage = {
      damage: finalDmg,
      wasCrit: false,
      wasMiss: false,
      effective: "normal",
      targetHp: target.stats.hp,
      targetMaxHp: target.stats.maxHp,
    };
    narrative.push(
      `☠️ ${caster.name} casts ${spell.name} on ${target.name} for ${finalDmg} damage!`
    );
  }

  // Apply status effect if spell has one
  if (spell.statusEffect && roll(spell.statusEffect.chance)) {
    const existing = target.statusEffects.findIndex(
      (e) => e.type === spell.statusEffect!.type
    );
    if (existing >= 0) {
      target.statusEffects[existing] = {
        ...spell.statusEffect,
        turnsRemaining: spell.statusEffect.duration,
        sourceId: caster.id,
      };
    } else {
      target.statusEffects.push({
        type: spell.statusEffect.type,
        turnsRemaining: spell.statusEffect.duration,
        potency: spell.statusEffect.potency,
        sourceId: caster.id,
      });
    }
    spellResult.statusApplied = spell.statusEffect.type;
    const emoji: Record<string, string> = {
      burn: "🔥",
      freeze: "❄️",
      poison: "☠️",
      shield: "🛡️",
      haste: "💨",
      slow: "🐌",
    };
    narrative.push(
      ` ${emoji[spell.statusEffect.type] || ""} ${target.name} is afflicted with ${spell.statusEffect.type}!`
    );
  }

  return {
    action: { type: "cast_spell", actorId: caster.id, targetId: target.id, spellId },
    actorId: caster.id,
    targetId: target.id,
    narrative: narrative.join(" "),
    spell: spellResult,
  };
}

function resolveItem(
  user: Character,
  _target: Character,
  itemId: string
): CombatResult {
  const item = user.inventory.find((i) => i.id === itemId);

  if (!item || item.quantity <= 0) {
    return {
      action: { type: "use_item", actorId: user.id, itemId: itemId as any },
      actorId: user.id,
      narrative: `${user.name} tries to use ${itemId} but doesn't have any!`,
    };
  }

  item.quantity--;
  const narrative: string[] = [];
  const itemResult: ItemResult = {
    itemName: item.name,
    effect: item.type,
    value: 0,
    remaining: item.quantity,
  };

  switch (item.type) {
    case "heal_hp": {
      const amt = item.potency;
      user.stats.hp = clamp(user.stats.hp + amt, 0, user.stats.maxHp);
      itemResult.value = amt;
      narrative.push(`🧪 ${user.name} uses ${item.name} and restores ${amt} HP!`);
      break;
    }
    case "heal_mp": {
      const amt = item.potency;
      user.stats.mp = clamp(user.stats.mp + amt, 0, user.stats.maxMp);
      itemResult.value = amt;
      narrative.push(`🧪 ${user.name} uses ${item.name} and restores ${amt} MP!`);
      break;
    }
    case "cure": {
      user.statusEffects = [];
      itemResult.value = user.statusEffects.length;
      narrative.push(`🧪 ${user.name} uses ${item.name} and is cured of all ailments!`);
      break;
    }
    case "damage": {
      const dmg = item.potency;
      _target.stats.hp = clamp(_target.stats.hp - dmg, 0, _target.stats.maxHp);
      itemResult.value = dmg;
      narrative.push(
        `💣 ${user.name} throws a ${item.name} at ${_target.name} for ${dmg} damage!`
      );
      break;
    }
    case "full_restore": {
      user.stats.hp = user.stats.maxHp;
      user.stats.mp = user.stats.maxMp;
      user.statusEffects = [];
      itemResult.value = user.stats.maxHp;
      narrative.push(`✨ ${user.name} uses ${item.name} — fully restored!`);
      break;
    }
  }

  return {
    action: { type: "use_item", actorId: user.id, targetId: _target.id, itemId: itemId as any },
    actorId: user.id,
    targetId: item.type === "damage" ? _target.id : undefined,
    narrative: narrative.join(" "),
    item: itemResult,
  };
}

function resolveDefend(actor: Character): CombatResult {
  actor.isDefending = true;
  return {
    action: { type: "defend", actorId: actor.id },
    actorId: actor.id,
    narrative: `🛡️ ${actor.name} takes a defensive stance! Defense is greatly increased this turn.`,
  };
}

function resolveWait(actor: Character): CombatResult {
  // Wait recovers a bit of MP
  const mpRecovery = 8;
  actor.stats.mp = clamp(actor.stats.mp + mpRecovery, 0, actor.stats.maxMp);
  return {
    action: { type: "wait", actorId: actor.id },
    actorId: actor.id,
    narrative: `${actor.name} waits and recovers ${mpRecovery} MP.`,
  };
}

function resolveFlee(actor: Character): CombatResult {
  // Flee chance based on speed
  const fleeChance = 0.3 + getEffectiveSpeed(actor) / 100;
  const success = roll(fleeChance);
  return {
    action: { type: "flee", actorId: actor.id },
    actorId: actor.id,
    narrative: success
      ? `🏃 ${actor.name} successfully flees from battle!`
      : `${actor.name} tries to flee but fails!`,
    fled: true,
    fledSuccessfully: success,
  };
}

// ── Main Resolve ────────────────────────────────────────

export function resolveAction(
  actor: Character,
  target: Character,
  action: CombatAction
): CombatResult {
  actor.isDefending = false; // reset defend from previous turn
  actor.actionHistory.push(action.type);
  if (actor.actionHistory.length > 10) actor.actionHistory.shift();

  switch (action.type) {
    case "attack":
      return resolveAttack(actor, target);
    case "defend":
      return resolveDefend(actor);
    case "cast_spell":
      return resolveSpell(actor, target, action.spellId!);
    case "use_item":
      return resolveItem(actor, target, action.itemId!);
    case "wait":
      return resolveWait(actor);
    case "flee":
      return resolveFlee(actor);
    default:
      return {
        action,
        actorId: actor.id,
        narrative: `${actor.name} does nothing...`,
      };
  }
}

// ── Cooldown Tick ───────────────────────────────────────

export function tickCooldowns(character: Character): void {
  for (const spell of character.spells) {
    if (spell.currentCooldown > 0) {
      spell.currentCooldown--;
    }
  }
}

// ── State Snapshot ──────────────────────────────────────

export function createSnapshot(
  characters: Character[],
  turnNumber: number,
  phase: BattlePhase
): BattleStateSnapshot {
  return {
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      hp: c.stats.hp,
      maxHp: c.stats.maxHp,
      mp: c.stats.mp,
      maxMp: c.stats.maxMp,
      statusEffects: c.statusEffects.map((e) => ({
        type: e.type,
        turnsRemaining: e.turnsRemaining,
      })),
      isDefending: c.isDefending,
      spells: c.spells.map((s) => ({
        id: s.id,
        name: s.name,
        currentCooldown: s.currentCooldown,
      })),
      inventory: c.inventory
        .filter((i) => i.quantity > 0)
        .map((i) => ({ id: i.id, name: i.name, quantity: i.quantity })),
    })),
    turnNumber,
    phase,
  };
}

// ── Turn Order ──────────────────────────────────────────

export function determineTurnOrder(characters: Character[]): Character[] {
  return [...characters].sort(
    (a, b) => getEffectiveSpeed(b) - getEffectiveSpeed(a)
  );
}
