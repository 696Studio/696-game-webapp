// lib/pvp/abilities.ts
import crypto from "crypto";

export type Side = "p1" | "p2";

export type UnitRef = { side: Side; slot: number; instanceId: string };

export type SimCardLike = {
  id: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number;
  ability_id: string | null;
  ability_params: any;
};

export type UnitLike = {
  instanceId: string;
  card: SimCardLike;
  side: Side;
  slot: number;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;

  // statuses used by abilities
  tauntTurns: number;
  stunTurns: number;
  poisonTicks: number;
  poisonDmg: number;
  burnTicks: number;
  burnDmg: number;
  vulnerableTurns: number;
  vulnerablePct: number;
  weakenTurns: number;
  weakenPct: number;
};

export type Rand01 = (seed: string) => number;

/**
 * ✅ FIX: make it generic so callers can pass their richer Unit type (extends UnitLike)
 * without TS complaining about parameter incompatibility.
 */
export type PickAllyLowestHp = <U extends UnitLike>(
  seed: string,
  round: number,
  actor: U,
  units: U[]
) => U | null;

export function ability_getHits(actor: UnitLike): number {
  const ab = (actor.card.ability_id || "").toLowerCase();
  const params = actor.card.ability_params || {};
  if (ab === "double_strike") return Math.max(2, Number(params?.hits || 2));
  return 1;
}

/**
 * Damage model stays exactly like your current enqueue/route.ts:
 * - dodge (by target rarity)
 * - crit (by actor rarity)
 * - ability multipliers for double_strike/execute/cleave
 * - weaken/vulnerable modifiers
 */
export function ability_computeDamage(params: {
  seed: string;
  round: number;
  actor: UnitLike;
  target: UnitLike;
  hitIndex: number;
  rand01: Rand01;
}): number {
  const { seed, round, actor, target, hitIndex, rand01 } = params;

  const atkBase = Math.max(0, Number(actor.card.base_power || 0));
  const ab = (actor.card.ability_id || "").toLowerCase();
  const p = actor.card.ability_params || {};

  let mult = 1.0;
  if (ab === "double_strike") mult = Number(p?.mult || 0.65);

  if (ab === "execute") {
    const thr = Number(p?.threshold_hp_pct ?? 0.3);
    const bonus = Number(p?.bonus_mult ?? 0.6);
    if (target.hp / Math.max(1, target.maxHp) <= thr) mult = 1.0 + bonus;
  }

  if (ab === "cleave") {
    // NOTE: cleave AOE isn't implemented in engine yet, so we keep your current "main_mult"
    mult = Number(p?.main_mult || 0.85);
  }

  const critChance =
    actor.card.rarity === "legendary"
      ? 0.12
      : actor.card.rarity === "epic"
      ? 0.09
      : actor.card.rarity === "rare"
      ? 0.06
      : 0.04;

  const dodgeChance =
    target.card.rarity === "legendary"
      ? 0.07
      : target.card.rarity === "epic"
      ? 0.05
      : target.card.rarity === "rare"
      ? 0.04
      : 0.03;

  const rCrit = rand01(`${seed}:${round}:crit:${actor.instanceId}:${target.instanceId}:${hitIndex}`);
  const rDodge = rand01(`${seed}:${round}:dodge:${actor.instanceId}:${target.instanceId}:${hitIndex}`);

  if (rDodge < dodgeChance) return 0;

  let dmg = Math.floor(atkBase * mult);

  if (rCrit < critChance) {
    dmg = Math.floor(dmg * 1.45);
  }

  if (actor.weakenTurns > 0) {
    dmg = Math.floor(dmg * (1 - Math.max(0, actor.weakenPct)));
  }
  if (target.vulnerableTurns > 0) {
    dmg = Math.floor(dmg * (1 + Math.max(0, target.vulnerablePct)));
  }

  return Math.max(0, dmg);
}

export function ability_onTurnStart<U extends UnitLike>(params: {
  seed: string;
  round: number;
  ev: any[];
  actor: U;
  units: U[];
  pickAllyLowestHp: PickAllyLowestHp;
}) {
  const { seed, round, ev, actor, units, pickAllyLowestHp } = params;

  const ab = (actor.card.ability_id || "").toLowerCase();
  const p = actor.card.ability_params || {};

  if (ab === "shield_self") {
    const amount = Math.max(1, Math.floor(Number(p?.amount ?? 35)));
    const dur = Math.max(1, Math.floor(Number(p?.duration_turns ?? 2)));
    actor.shield += amount;
    ev.push({
      type: "shield",
      target: { side: actor.side, slot: actor.slot, instanceId: actor.instanceId },
      amount,
      duration_turns: dur,
      shield: actor.shield,
    });
  }

  if (ab === "taunt") {
    const dur = Math.max(1, Math.floor(Number(p?.duration_turns ?? 2)));
    actor.tauntTurns = Math.max(actor.tauntTurns, dur);
    ev.push({
      type: "buff_applied",
      buff: "taunt",
      side: actor.side,
      slot: actor.slot,
      instanceId: actor.instanceId,
      duration_turns: dur,
    });
  }

  if (ab === "heal_ally") {
    const amount = Math.max(1, Math.floor(Number(p?.amount ?? 28)));
    const ally = pickAllyLowestHp(seed, round, actor, units);
    if (ally) {
      const before = ally.hp;
      ally.hp = Math.min(ally.maxHp, ally.hp + amount);
      const healed = ally.hp - before;
      if (healed > 0) {
        ev.push({
          type: "heal",
          target: { side: ally.side, slot: ally.slot, instanceId: ally.instanceId },
          amount: healed,
          hp: ally.hp,
        });
      }
    }
  }

  if (ab === "buff_attack") {
    // keep your existing behaviour (atk_up implemented as negative weakenPct on self)
    const pct = Number(p?.atk_up_pct ?? 0.18);
    const dur = Math.max(1, Math.floor(Number(p?.duration_turns ?? 2)));
    actor.weakenTurns = Math.max(actor.weakenTurns, dur);
    actor.weakenPct = -Math.max(0, pct);
    ev.push({
      type: "buff_applied",
      buff: "atk_up",
      side: actor.side,
      slot: actor.slot,
      instanceId: actor.instanceId,
      duration_turns: dur,
      pct,
    });
  }
}

export function ability_onHit(params: {
  seed: string;
  round: number;
  ev: any[];
  actor: UnitLike;
  target: UnitLike;
  rand01: Rand01;
}) {
  const { seed, round, ev, actor, target, rand01 } = params;
  if (!actor.alive || !target.alive) return;

  const ab = (actor.card.ability_id || "").toLowerCase();
  const p = actor.card.ability_params || {};

  if (ab === "poison") {
    const tick_damage = Math.max(1, Math.floor(Number(p?.tick_damage ?? 10)));
    const ticks = Math.max(1, Math.floor(Number(p?.ticks ?? 3)));
    target.poisonDmg = Math.max(target.poisonDmg, tick_damage);
    target.poisonTicks = Math.max(target.poisonTicks, ticks);
    ev.push({
      type: "debuff_applied",
      debuff: "poison",
      target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
      tick_damage,
      ticks,
    });
  }

  if (ab === "burn") {
    const tick_damage = Math.max(1, Math.floor(Number(p?.tick_damage ?? 9)));
    const ticks = Math.max(1, Math.floor(Number(p?.ticks ?? 3)));
    target.burnDmg = Math.max(target.burnDmg, tick_damage);
    target.burnTicks = Math.max(target.burnTicks, ticks);
    ev.push({
      type: "debuff_applied",
      debuff: "burn",
      target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
      tick_damage,
      ticks,
    });
  }

  if (ab === "stun") {
    const dur = Math.max(1, Math.floor(Number(p?.duration_turns ?? 1)));
    const chance = Number(p?.chance ?? 0.25);
    const r = rand01(`${seed}:${round}:stun:${actor.instanceId}:${target.instanceId}`);
    if (r < chance) {
      target.stunTurns = Math.max(target.stunTurns, dur);
      ev.push({
        type: "debuff_applied",
        debuff: "stun",
        target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
        duration_turns: dur,
      });
    }
  }

  if (ab === "vulnerable") {
    const pct = Number(p?.damage_taken_up_pct ?? 0.2);
    const dur = Math.max(1, Math.floor(Number(p?.duration_turns ?? 2)));
    target.vulnerableTurns = Math.max(target.vulnerableTurns, dur);
    target.vulnerablePct = Math.max(target.vulnerablePct, pct);
    ev.push({
      type: "debuff_applied",
      debuff: "vulnerable",
      target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
      duration_turns: dur,
      pct,
    });
  }

  if (ab === "weaken") {
    const pct = Number(p?.atk_down_pct ?? 0.18);
    const dur = Math.max(1, Math.floor(Number(p?.duration_turns ?? 2)));
    target.weakenTurns = Math.max(target.weakenTurns, dur);
    target.weakenPct = Math.max(target.weakenPct, pct);
    ev.push({
      type: "debuff_applied",
      debuff: "weaken",
      target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
      duration_turns: dur,
      pct,
    });
  }
}
