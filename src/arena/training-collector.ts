// Collects training records from a BattleLog after battle completes.
// Called by the server after BattleRunner.run() finishes.

import type { BattleLog } from "../engine/types.js";
import * as db from "../db/index.js";

interface RawTrainingRecord {
  gameId: number;
  turnNumber: number;
  actorId: string;
  actorName: string;
  actorClass: string;
  actorTeam: string | null;
  actorType: 'llm' | 'heuristic' | 'human' | 'boss';
  stateSnapshot: object;
  thinkingSteps: object[] | null;
  action: object;
  actionResult: object;
  actionTimedOut: boolean;
  actionWasBad: boolean;
}

function getAgentType(actorId: string, agents: Array<{ id: string }>): RawTrainingRecord['actorType'] {
  // We pass actorType from the caller, so this is a fallback
  return 'heuristic';
}

export async function collectTrainingData(
  gameId: number,
  log: BattleLog,
  actorTypes: Record<string, string>
): Promise<number> {
  const records: RawTrainingRecord[] = [];

  for (const turn of log.turns) {
    const actorType = (actorTypes[turn.actorId] || 'heuristic') as RawTrainingRecord['actorType'];
    
    for (const result of turn.results) {
      const action = result.action || {};
      // CombatResult IS the result (no .result property on it)
      const actionResult = result;

      // Build state snapshot from the turn's state
      let stateSnapshot: object = {};
      if (turn.stateSnapshot) {
        const allChars = turn.stateSnapshot.characters || [];
        const actor = allChars.find((c: any) => c.id === turn.actorId);
        if (actor) {
          stateSnapshot = {
            actor: {
              id: actor.id,
              name: actor.name,
              class: actor.class,
              hp: actor.hp,
              maxHp: actor.maxHp,
              ac: actor.ac,
              position: actor.position,
              statusEffects: (actor.statusEffects || []).map((e: any) => ({
                type: e.type,
                turnsRemaining: e.turnsRemaining,
              })),
              spellSlots: actor.spellSlots,
              concentrationSpellId: actor.concentrationSpellId,
            },
            allies: allChars
              .filter((c: any) => c.team === actor.team && c.id !== actor.id && c.hp > 0)
              .map((c: any) => ({
                id: c.id, name: c.name, hp: c.hp,
                maxHp: c.maxHp,
                position: c.position,
              })),
            enemies: allChars
              .filter((c: any) => c.team !== actor.team && c.hp > 0)
              .map((c: any) => ({
                id: c.id, name: c.name, hp: c.hp,
                maxHp: c.maxHp,
                ac: c.ac,
                position: c.position,
              })),
            turnNumber: turn.turnNumber,
          };
        }
      }

      // Extract thinking steps if available
      const thinkingSteps = turn.thinkingSteps?.length
        ? turn.thinkingSteps.map((s: any) => ({
            type: s.type,
            toolName: s.toolName,
            text: s.text,
          }))
        : null;

      records.push({
        gameId,
        turnNumber: turn.turnNumber,
        actorId: turn.actorId,
        actorName: (stateSnapshot as any)?.actor?.name || turn.actorId,
        actorClass: (stateSnapshot as any)?.actor?.class || 'unknown',
        actorTeam: (stateSnapshot as any)?.actor?.team || null,
        actorType,
        stateSnapshot,
        thinkingSteps,
        action,
        actionResult,
        actionTimedOut: action.timedOut || false,
        actionWasBad: !!result.badAction,
      });
    }
  }

  if (records.length === 0) return 0;
  return db.saveTrainingRecords(records);
}
