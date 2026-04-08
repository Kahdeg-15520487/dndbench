// ─────────────────────────────────────────────────────────
//  Battle Runner — generic multi-unit battle engine
// ─────────────────────────────────────────────────────────
//
//  Supports any scenario: 1v1, 2v2, raid boss, FFA.
//  Teams are determined by the `team` field on Character.
//  Battle ends when:
//    - last_team_standing: only one team has living members
//    - last_unit_standing: only one unit alive (FFA)
//    - turn limit reached: draw
//
//  The runner only knows about IAgent. It calls getAction()
//  and awaits — whether it resolves in 1ms (heuristic),
//  2s (LLM agentic loop), or 30s (human thinking) doesn't matter.
//
//  Frontends (CLI, WebSocket) subscribe to BattleEvents and
//  render however they like. Replay is always generated from
//  the BattleLog after run() completes.
// ─────────────────────────────────────────────────────────

import {
  Character,
  CombatAction,
  BattleLog,
  CombatResult,
  ThinkingStep,
  ArenaConfig,
  WinCondition,
  Position,
} from "../engine/types.js";
import {
  resolveAction,
  resolveMove,
  processStatusEffects,
  tickCooldowns,
  createSnapshot,
  determineTurnOrder,
  checkOpportunityAttack,
  resetReaction,
  isDying,
  isDead,
  isStable,
  rollDeathSave,
  markUnconscious,
  concentrationSaveFromDamage,
  ARENA_DEFAULT,
  defaultStartPositions,
  generateStartPositions,
  DiceRoller,
} from "../engine/index.js";
import { IAgent } from "../agent/interface.js";
import { LLMAgent } from "../agent/llm-agent.js";

// ── Battle Events (for frontend rendering) ──────────────

export type BattleEvent =
  | { type: "battle_start"; characters: Character[]; arena: ArenaConfig }
  | { type: "turn_start"; turnNumber: number; actorId: string }
  | { type: "move"; actorId: string; from: Position; to: Position; distance: number }
  | { type: "action_chosen"; actorId: string; action: CombatAction }
  | { type: "action_result"; actorId: string; targetId: string; result: CombatResult }
  | { type: "status_tick"; characterId: string; narratives: string[] }
  | { type: "death_save"; characterId: string; narrative: string }
  | { type: "health_bars"; characters: Character[] }
  | { type: "character_defeated"; characterId: string }
  | { type: "battle_end"; winner?: string; winningTeam?: string; reason: string };

export type BattleEventHandler = (event: BattleEvent) => void;

export interface BattleConfig {
  maxTurns: number;
  /** ms between turns — 0 for no delay (used when human is playing) */
  turnDelayMs: number;
  eventHandler?: BattleEventHandler;
  /** Arena configuration — auto-picked by participant count if not provided */
  arena?: ArenaConfig;
  /** When does the battle end? Default: "last_team_standing" */
  winCondition?: WinCondition;
}

const DEFAULT_CONFIG: BattleConfig = {
  maxTurns: 50,
  turnDelayMs: 1500,
};

// ── Runner ──────────────────────────────────────────────

export class BattleRunner {
  private characters: Character[];
  private agents: IAgent[];
  private agentMap: Map<string, IAgent>;
  private config: BattleConfig;
  private arena: ArenaConfig;
  private winCondition: WinCondition;
  private log: BattleLog;
  private dice: DiceRoller;
  private turnNumber = 0;
  private finished = false;
  private winner?: string;         // winning character id
  private winningTeam?: string;    // winning team tag
  private defeatedIds = new Set<string>(); // track which characters have had defeat emitted
  private _hasRun = false;

  constructor(
    characters: Character[],
    agents: IAgent[],
    config?: Partial<BattleConfig>
  ) {
    this.characters = characters;
    this.agents = agents;
    this.agentMap = new Map(agents.map((a) => [a.id, a]));
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.arena = this.config.arena ?? ARENA_DEFAULT;
    this.winCondition = this.config.winCondition ?? "last_team_standing";
    const diceSeed = Math.floor(Math.random() * 2147483647);
    this.dice = new DiceRoller(diceSeed);
    this.log = {
      turns: [],
      totalTurns: 0,
      startTime: new Date().toISOString(),
      arena: this.arena,
      diceSeed,
    };

    // Set starting positions for any character that hasn't been placed
    this.initializePositions();
  }

  /** Characters (mutable — runner mutates hp/mp/status during battle) */
  getCharacters(): Character[] { return this.characters; }

  /** Living characters only */
  /** Get living characters (HP > 0, not defeated) */
  getLiving(): Character[] { return this.characters.filter(c => c.stats.hp > 0 && !this.defeatedIds.has(c.id)); }

  /** Agents */
  getAgents(): IAgent[] { return this.agents; }

  /** Run the full battle to completion */
  async run(): Promise<BattleLog> {
    if (this._hasRun) throw new Error("BattleRunner.run() can only be called once per instance");
    this._hasRun = true;
    const snapshot = createSnapshot(this.characters, 0, "ongoing", this.arena);

    // Notify all agents
    for (const agent of this.agents) {
      await agent.onBattleStart?.(snapshot);
    }

    this.emit({ type: "battle_start", characters: this.characters, arena: this.arena });

    while (!this.finished && this.turnNumber < this.config.maxTurns) {
      await this.executeTurn();
      if (this.config.turnDelayMs > 0 && !this.finished) {
        await this.delay(this.config.turnDelayMs);
      }
    }

    if (!this.finished) {
      this.winner = undefined;
      this.emit({
        type: "battle_end",
        winner: undefined,
        reason: "Turn limit reached — draw!",
      });
    }

    // Notify all agents
    for (const agent of this.agents) {
      agent.onBattleEnd?.(this.winner, this.log.turns.at(-1)?.results?.[0]?.narrative || "Battle over");
    }

    this.log.endTime = new Date().toISOString();
    this.log.winner = this.winningTeam ?? this.winner;
    this.log.totalTurns = this.turnNumber;
    return this.log;
  }

  // ── Position Initialization ─────────────────────────

  private initializePositions() {
    const unplaced = this.characters.filter(c => c.position.x === 0 && c.position.y === 0);

    if (unplaced.length === 0) return; // all manually placed

    // For 2-character 1v1, use classic left/right
    if (this.characters.length === 2) {
      const [a, b] = defaultStartPositions(this.arena);
      if (this.characters[0].position.x === 0) this.characters[0].position = { ...a };
      if (this.characters[1].position.x === 0) this.characters[1].position = { ...b };
      return;
    }

    // For N characters, use team-aware formation
    const positions = generateStartPositions(
      this.characters.map(c => ({ team: c.team })),
      this.arena,
    );
    for (let i = 0; i < this.characters.length; i++) {
      if (this.characters[i].position.x === 0 && this.characters[i].position.y === 0) {
        this.characters[i].position = { ...positions[i] };
      }
    }
  }

  // ── Turn Execution ──────────────────────────────────

  /**
   * Execute one full turn (all living agents act, ordered by speed).
   */
  private async executeTurn(): Promise<void> {
    this.turnNumber++;

    // ── Roll death saves for dying characters ──
    const dying = this.characters.filter(c => isDying(c) && !this.defeatedIds.has(c.id));
    for (const character of dying) {
      const saveResult = rollDeathSave(character, this.dice);
      const narrative = saveResult.regainedHp
        ? `🎲 ${character.name} rolls nat 20 on death save — springs back to 1 HP!`
        : saveResult.successes > 0
          ? `🎲 ${character.name} death save: ${saveResult.roll} → success (${character.deathSaveSuccesses}/3)`
          : saveResult.failures > 0
            ? `🎲 ${character.name} death save: ${saveResult.roll} → failure (${character.deathSaveFailures}/3)`
            : `🎲 ${character.name} death save: ${saveResult.roll}`;
      this.emit({ type: "death_save", characterId: character.id, narrative });

      // Check if actually dead now
      if (isDead(character)) {
        this.defeatedIds.add(character.id);
        this.emit({ type: "character_defeated", characterId: character.id });
        character.statusEffects = character.statusEffects.filter(e => e.type !== "unconscious");
        character.statusEffects.push({ type: "dead", turnsRemaining: 99, potency: 0, sourceId: "death" });
        if (this.checkBattleEnd()) break;
      }
    }
    if (this.finished) return;

    const living = this.getLiving();
    const order = determineTurnOrder(living, this.dice);

    for (const character of order) {
      if (this.finished) break;
      // Re-check — someone may have died earlier this turn
      if (character.stats.hp <= 0) continue;

      const agent = this.agentMap.get(character.id);
      if (!agent) continue;

      this.emit({ type: "turn_start", turnNumber: this.turnNumber, actorId: character.id });

      // Reset reaction at start of turn
      resetReaction(character);

      const snapshot = createSnapshot(
        this.getLiving(),
        this.turnNumber,
        "ongoing",
        this.arena,
      );

      // Check if frozen, paralyzed, or stunned
      if (character.statusEffects.some((e) => e.type === "freeze" || e.type === "paralyzed" || e.type === "stunned")) {
        const frozenResult: CombatResult = {
          action: { type: "wait", actorId: character.id },
          actorId: character.id,
          narrative: `❄️ ${character.name} is frozen/paralyzed and cannot act!`,
        };
        // Pick any living non-ally for event targetId
        const anyEnemy = this.findEnemy(character);
        this.emit({ type: "action_result", actorId: character.id, targetId: anyEnemy?.id ?? character.id, result: frozenResult });
        agent.onActionResult?.(frozenResult);
        tickCooldowns(character);
        continue;
      }

      // ── Spirit Guardians aura: 3d8 damage to enemies within 10ft ──
      const sgEffect = character.statusEffects.find(e => e.type === "spirit_guardians");
      if (sgEffect) {
        const sgDamage = this.dice.rollDiceDetailed("3d8", `${character.name} Spirit Guardians`);
        const sgRadius = 10;
        for (const enemy of this.getLiving()) {
          if (enemy.team === character.team) continue;
          const dist = Math.sqrt(
            (character.position.x - enemy.position.x) ** 2 +
            (character.position.y - enemy.position.y) ** 2,
          );
          if (dist <= sgRadius) {
            // WIS save for half damage
            const saveMod = Math.floor((character.stats.wis - 10) / 2) + character.stats.proficiencyBonus;
            const saveRoll = this.dice.d20(`${enemy.name} WIS save vs Spirit Guardians`);
            const wisMod = Math.floor((enemy.stats.wis - 10) / 2) +
              (enemy.savingThrowProfs.includes("wis") ? enemy.stats.proficiencyBonus : 0);
            const succeeded = saveRoll + wisMod >= 8 + saveMod;
            const dmg = succeeded ? Math.floor(sgDamage.total / 2) : sgDamage.total;
            enemy.stats.hp = Math.max(0, enemy.stats.hp - dmg);
            this.emit({
              type: "action_result", actorId: character.id, targetId: enemy.id,
              result: {
                action: { type: "cast_spell", actorId: character.id, targetId: enemy.id, spellId: "spirit_guardians" },
                actorId: character.id,
                targetId: enemy.id,
                damage: { damage: dmg, damageRolls: sgDamage.rolls, wasCrit: false, wasMiss: false, attackRoll: 0, attackTotal: 0, targetAc: 0, effective: "normal" as const, targetHp: enemy.stats.hp, targetMaxHp: enemy.stats.maxHp },
                narrative: `${character.name}'s Spirit Guardians strike ${enemy.name} for ${dmg} radiant damage!${succeeded ? " (save for half)" : ""}`,
              },
            });
            // Concentration check on enemy hit by Spirit Guardians
            if (enemy.concentrationSpellId) {
              concentrationSaveFromDamage(enemy, dmg, this.dice, this.characters);
            }
          }
        }
      }

      // ── Ask the agent for its action (the core abstraction) ──
      const action = await agent.getAction(snapshot);

      // Collect thinking steps from LLM agents
      let thinkingSteps: ThinkingStep[] | undefined;
      if (agent instanceof LLMAgent) {
        thinkingSteps = agent.consumeThinkingSteps();
      }

      this.emit({ type: "action_chosen", actorId: character.id, action });

      // ── Resolve movement ──
      let moveResult: CombatResult["move"];
      let oldPosition: Position | undefined;
      if (action.move) {
        oldPosition = { ...character.position };
        const mv = resolveMove(character, action.move, this.arena);
        moveResult = mv;
        this.emit({
          type: "move",
          actorId: character.id,
          from: mv.from,
          to: mv.to,
          distance: mv.distanceMoved,
        });

        // ── Check for Attacks of Opportunity ──
        if (oldPosition) {
          const enemies = this.getLiving().filter(c => c.team !== character.team);
          const oppResult = checkOpportunityAttack(character, oldPosition, character.position, enemies, this.dice);
          if (oppResult) {
            this.emit({
              type: "action_result",
              actorId: oppResult.actorId,
              targetId: character.id,
              result: { action: { type: "wait", actorId: oppResult.actorId }, actorId: oppResult.actorId, targetId: character.id, narrative: oppResult.narrative, damage: oppResult.damage, reaction: oppResult },
            });
          }
        }
      }

      // ── Resolve target ──
      const target = this.resolveTarget(character, action);

      // For self-targeting actions, the target IS the actor
      const spell = action.type === "cast_spell"
        ? character.spells.find(s => s.id === action.spellId)
        : null;
      const isSelfItem = action.type === "use_item" && (() => {
        const item = character.inventory.find(i => i.id === action.itemId);
        return item && (item.type === "heal_hp" || item.type === "cure" || item.type === "full_restore");
      })();
      const actionTarget = (spell?.target === "self" || action.type === "defend" || action.type === "wait" || isSelfItem)
        ? character
        : target;

      const result = resolveAction(character, actionTarget, action, this.dice, this.arena, this.characters);

      // Attach move result
      if (moveResult) result.move = moveResult;

      this.emit({ type: "action_result", actorId: character.id, targetId: target.id, result });

      // ── Concentration check: if target took damage, check concentration ──
      if (result.damage && result.damage.damage > 0 && target.concentrationSpellId) {
        const concResult = concentrationSaveFromDamage(target, result.damage.damage, this.dice, this.characters);
        if (!concResult.success) {
          this.emit({
            type: "action_result", actorId: target.id, targetId: target.id,
            result: {
              action: { type: "wait", actorId: target.id }, actorId: target.id,
              narrative: `${target.name}'s concentration on ${target.concentrationSpellId ?? "spell"} is broken! (DC ${concResult.dc}, rolled ${concResult.roll})`,
            },
          });
        }
      }

      // Notify actor and target agents
      agent.onActionResult?.(result);
      if (target.id !== character.id) {
        this.agentMap.get(target.id)?.onActionResult?.(result);
      }

      // Tick cooldowns for this character
      tickCooldowns(character);

      // Log the turn
      this.log.turns.push({
        turnNumber: this.turnNumber,
        actorId: character.id,
        results: [result],
        stateSnapshot: createSnapshot(this.characters, this.turnNumber, this.finished ? "finished" : "ongoing", this.arena),
        thinkingSteps,
      });

      // Check for flee
      if (result.fledSuccessfully) {
        this.finished = true;
        this.winner = target.id;
        this.winningTeam = target.team;
        this.defeatedIds.add(character.id);
        this.emit({ type: "character_defeated", characterId: character.id });
        this.emit({ type: "battle_end", winner: this.winner, winningTeam: this.winningTeam, reason: `${character.name} fled!` });
        break;
      }

      // Check for defeat
      if (this.checkDefeat(character, target)) break;

      // ── Action Surge: grant an extra action ──
      const usedActionSurge = action.type === "class_ability" && action.abilityId === "action_surge";
      if (usedActionSurge && character.stats.hp > 0) {
        // Get a second action from the agent
        const surgeSnapshot = createSnapshot(
          this.getLiving(),
          this.turnNumber,
          "ongoing",
          this.arena,
        );
        const surgeAction = await agent.getAction(surgeSnapshot);
        this.emit({ type: "action_chosen", actorId: character.id, action: surgeAction });

        // Resolve movement for surge action
        let surgeMoveResult: CombatResult["move"];
        if (surgeAction.move) {
          const mv = resolveMove(character, surgeAction.move, this.arena);
          surgeMoveResult = mv;
          this.emit({ type: "move", actorId: character.id, from: mv.from, to: mv.to, distance: mv.distanceMoved });
        }

        const surgeTarget = this.resolveTarget(character, surgeAction);
        const surgeSpell = surgeAction.type === "cast_spell"
          ? character.spells.find(s => s.id === surgeAction.spellId)
          : null;
        const surgeIsSelfItem = surgeAction.type === "use_item" && (() => {
          const item = character.inventory.find(i => i.id === surgeAction.itemId);
          return item && (item.type === "heal_hp" || item.type === "cure" || item.type === "full_restore");
        })();
        const surgeActionTarget = (surgeSpell?.target === "self" || surgeAction.type === "defend" || surgeAction.type === "wait" || surgeIsSelfItem)
          ? character
          : surgeTarget;

        const surgeResult = resolveAction(character, surgeActionTarget, surgeAction, this.dice, this.arena, this.characters);
        if (surgeMoveResult) surgeResult.move = surgeMoveResult;

        this.emit({ type: "action_result", actorId: character.id, targetId: surgeTarget.id, result: surgeResult });
        agent.onActionResult?.(surgeResult);
        if (surgeTarget.id !== character.id) {
          this.agentMap.get(surgeTarget.id)?.onActionResult?.(surgeResult);
        }
        tickCooldowns(character);

        this.log.turns.push({
          turnNumber: this.turnNumber,
          actorId: character.id,
          results: [surgeResult],
          stateSnapshot: createSnapshot(this.characters, this.turnNumber, this.finished ? "finished" : "ongoing", this.arena),
        });

        if (surgeResult.fledSuccessfully) {
          this.finished = true;
          this.winner = surgeTarget.id;
          this.winningTeam = surgeTarget.team;
          this.defeatedIds.add(character.id);
          this.emit({ type: "character_defeated", characterId: character.id });
          this.emit({ type: "battle_end", winner: this.winner, winningTeam: this.winningTeam, reason: `${character.name} fled!` });
          break;
        }
        if (this.checkDefeat(character, surgeTarget)) break;
      }
    }

    // Process status effects once per round (after all characters have acted)
    if (!this.finished) {
      this.processRoundEndStatusEffects();

      // Status effects may have killed someone — check defeat
      this.checkDefeatAfterStatusTick();
    }

    // Emit health bars at end of turn
    if (!this.finished) {
      this.emit({ type: "health_bars", characters: this.characters });
    }
  }

  // ── Target Resolution ───────────────────────────────

  /** Resolve the target of an action, respecting explicit targetId or defaulting */
  private resolveTarget(actor: Character, action: CombatAction): Character {
    // If action specifies a target, look it up
    if (action.targetId) {
      const target = this.characters.find(c => c.id === action.targetId);
      if (target && target.stats.hp > 0) return target;
    }

    // Fallback: pick first living non-ally (enemy)
    const enemy = this.findEnemy(actor);
    if (enemy) return enemy;

    // No enemies left — self-target (shouldn't happen in normal flow)
    return actor;
  }

  /** Find the nearest living enemy (different team) */
  private findEnemy(character: Character): Character | undefined {
    const enemies = this.getLiving().filter(c => c.team !== character.team);
    if (enemies.length === 0) return undefined;

    // Pick nearest enemy
    let nearest = enemies[0];
    let nearestDist = Infinity;
    for (const e of enemies) {
      const dx = e.position.x - character.position.x;
      const dy = e.position.y - character.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = e;
      }
    }
    return nearest;
  }

  // ── Defeat Checks ───────────────────────────────────

  private checkDefeat(actor: Character, target: Character): boolean {
    // Check if target dropped to 0 HP
    if (target.stats.hp <= 0 && target.id !== actor.id && !this.defeatedIds.has(target.id)) {
      // Mark as unconscious instead of immediately dead
      markUnconscious(target);
      this.emit({ type: "character_defeated", characterId: target.id });
      this.defeatedIds.add(target.id);
    }

    return this.checkBattleEnd();
  }

  // ── Helpers ─────────────────────────────────────────

  /** Process status effects on ALL living characters once per round */
  private processRoundEndStatusEffects() {
    for (const c of this.getLiving()) {
      const narratives = processStatusEffects(c);
      if (narratives.length > 0) {
        this.emit({ type: "status_tick", characterId: c.id, narratives });
      }
    }
  }

  /** Check if battle should end based on conscious characters */
  private checkBattleEnd(): boolean {
    // In D&D, a battle ends when all enemies are downed (0 HP) or dead
    // Count only conscious (HP > 0) as truly standing
    const conscious = this.characters.filter(c => c.stats.hp > 0 && !this.defeatedIds.has(c.id));

    if (this.winCondition === "last_unit_standing") {
      if (conscious.length <= 1) {
        this.finished = true;
        this.winner = conscious[0]?.id;
        this.winningTeam = conscious[0]?.team;
        this.emit({
          type: "battle_end",
          winner: this.winner,
          winningTeam: this.winningTeam,
          reason: conscious.length === 1
            ? `${conscious[0].name} is the last one standing!`
            : "Everyone is downed — draw!",
        });
        return true;
      }
    } else {
      // Team-based: check if only one team has conscious members
      const consciousTeams = new Set(conscious.map(c => c.team));
      if (consciousTeams.size <= 1) {
        this.finished = true;
        const survivingTeam = [...consciousTeams][0];
        this.winningTeam = survivingTeam;
        this.winner = conscious[0]?.id;
        this.emit({
          type: "battle_end",
          winner: this.winner,
          winningTeam: this.winningTeam,
          reason: survivingTeam
            ? `Team ${survivingTeam} wins! All enemies downed!`
            : "Everyone is downed — draw!",
        });
        return true;
      }
    }
    return false;
  }

  /** Check if anyone died from status effects after round-end tick */
  private checkDefeatAfterStatusTick() {
    for (const c of this.characters) {
      if (c.stats.hp <= 0 && !this.defeatedIds.has(c.id) && !isDying(c) && !isStable(c) && !c.statusEffects.some(e => e.type === "unconscious")) {
        markUnconscious(c);
      }
    }

    // Check if battle ends from death during status tick
    this.checkBattleEnd();
  }

  private emit(event: BattleEvent): void {
    this.config.eventHandler?.(event);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
