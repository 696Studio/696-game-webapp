// app/api/pvp/match/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MatchRow = {
  id: string;
  mode: string | null;
  p1_user_id: string;
  p2_user_id: string;
  winner_user_id: string | null;
  created_at: string;
  status: string;
  log: any;
  rewards_applied: boolean;
};

type CardMeta = {
  id: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number;

  // optional extras (may exist later in DB)
  hp?: number;
  initiative?: number;
  ability_id?: string | null;
  ability_params?: any;
  tags?: string[];

  name?: string;
  image_url?: string | null;
};

function parseMaybeJson(v: any) {
  if (v == null) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return v;
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {
        return v;
      }
    }
  }
  return v;
}

function toStringArray(v: any): string[] {
  const raw = parseMaybeJson(v);
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (raw && typeof raw === "object") return Object.values(raw).map((x) => String(x));
  return [];
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/** deterministic hash -> uint32 */
function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 rng */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (a >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickNDeterministic(ids: string[], n: number, rand: () => number): string[] {
  const pool = ids.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.max(0, Math.min(n, pool.length)));
}

function sumPower(cards: CardMeta[]): number {
  let s = 0;
  for (const c of cards) s += Number(c?.base_power ?? 0);
  return Math.max(0, Math.round(s));
}

/**
 * Base meta loader (safe columns)
 */
async function loadCardsMetaBase(cardIds: string[]): Promise<Map<string, CardMeta>> {
  const uniq = Array.from(new Set(cardIds.filter(Boolean).map(String)));
  const map = new Map<string, CardMeta>();
  if (uniq.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("cards")
    .select("id, rarity, base_power, name_ru, name_en, image_url")
    .in("id", uniq);

  if (error) throw new Error(error.message);

  for (const c of data ?? []) {
    const id = String((c as any).id);
    map.set(id, {
      id,
      rarity: (String((c as any).rarity || "common").toLowerCase() as any) ?? "common",
      base_power: Number((c as any).base_power || 0),
      name:
        ((c as any).name_ru && String((c as any).name_ru).trim()) ||
        ((c as any).name_en && String((c as any).name_en).trim()) ||
        undefined,
      image_url: (c as any).image_url ?? null,
    });
  }

  return map;
}

/**
 * Extended meta loader (tries extra columns; falls back if DB doesn't have them yet)
 * NOTE: If your columns are named differently later (init vs initiative, ability_key vs ability_id),
 * we will adjust here.
 */
async function loadCardsMeta(cardIds: string[]): Promise<{ meta: Map<string, CardMeta>; extended: boolean }> {
  const uniq = Array.from(new Set(cardIds.filter(Boolean).map(String)));
  const map = new Map<string, CardMeta>();
  if (uniq.length === 0) return { meta: map, extended: false };

  // Try extended columns first.
  // If any column doesn't exist in DB, PostgREST will throw an error -> we fallback to base.
  const tryExtended = async () => {
    const { data, error } = await supabaseAdmin
      .from("cards")
      // if your schema uses different names later, change here
      .select("id, rarity, base_power, name_ru, name_en, image_url, hp, initiative, ability_id, ability_params, tags")
      .in("id", uniq);

    if (error) throw new Error(error.message);

    for (const c of data ?? []) {
      const id = String((c as any).id);
      const tagsRaw = (c as any).tags;
      const tagsArr = Array.isArray(tagsRaw) ? tagsRaw.map((x: any) => String(x)) : undefined;

      map.set(id, {
        id,
        rarity: (String((c as any).rarity || "common").toLowerCase() as any) ?? "common",
        base_power: Number((c as any).base_power || 0),
        hp: (c as any).hp != null ? Number((c as any).hp) : undefined,
        initiative: (c as any).initiative != null ? Number((c as any).initiative) : undefined,
        ability_id: (c as any).ability_id != null ? String((c as any).ability_id) : null,
        ability_params: (c as any).ability_params ?? undefined,
        tags: tagsArr,
        name:
          ((c as any).name_ru && String((c as any).name_ru).trim()) ||
          ((c as any).name_en && String((c as any).name_en).trim()) ||
          undefined,
        image_url: (c as any).image_url ?? null,
      });
    }

    return true;
  };

  try {
    const ok = await tryExtended();
    return { meta: map, extended: ok };
  } catch {
    const base = await loadCardsMetaBase(uniq);
    return { meta: base, extended: false };
  }
}

function buildCardsFull(idsAny: any, meta: Map<string, CardMeta>): CardMeta[] {
  const ids = toStringArray(idsAny);
  return ids.map((id) => {
    const m = meta.get(id);
    return (
      m ?? {
        id,
        rarity: "common",
        base_power: 0,
        name: id ? id : "Card",
        image_url: null,
      }
    );
  });
}

/**
 * -----------------------------
 * SIMULATION V0 (existing)
 * -----------------------------
 * round_start -> reveal -> score -> round_end (x3)
 */
async function simulateTimelineV0(params: { matchId: string; logObj: any }) {
  const { matchId, logObj } = params;

  const p1All = toStringArray(logObj?.p1_cards ?? logObj?.p1_deck ?? logObj?.p1 ?? []);
  const p2All = toStringArray(logObj?.p2_cards ?? logObj?.p2_deck ?? logObj?.p2 ?? []);

  if (!p1All.length || !p2All.length) {
    return {
      timeline: null as any,
      rounds: null as any,
      duration_sec: 30,
      warning:
        "simulate=1 requested, but log.p1_cards/log.p2_cards not found. Ensure /api/pvp/enqueue writes p1_cards/p2_cards (expanded 20 ids).",
    };
  }

  const seed = hash32(String(matchId));
  const rand = mulberry32(seed);

  const needIds = [...p1All, ...p2All];
  const { meta } = await loadCardsMeta(needIds);

  const timeline: any[] = [];
  const rounds: any[] = [];

  const roundCount = 3;
  const secPerRound = 10;

  let p1Wins = 0;
  let p2Wins = 0;

  for (let r = 1; r <= roundCount; r++) {
    const t0 = (r - 1) * secPerRound;

    timeline.push({ t: t0 + 0.0, type: "round_start", round: r });

    const p1Pick = pickNDeterministic(p1All, 5, rand);
    const p2Pick = pickNDeterministic(p2All, 5, rand);

    const p1Full = buildCardsFull(p1Pick, meta);
    const p2Full = buildCardsFull(p2Pick, meta);

    timeline.push({
      t: t0 + 2.0,
      type: "reveal",
      round: r,
      p1_cards: p1Pick,
      p2_cards: p2Pick,
      p1_cards_full: p1Full,
      p2_cards_full: p2Full,
    });

    const p1Score = sumPower(p1Full);
    const p2Score = sumPower(p2Full);

    timeline.push({ t: t0 + 5.5, type: "score", round: r, p1: p1Score, p2: p2Score });

    let winner: "p1" | "p2" | "draw" = "draw";
    if (p1Score > p2Score) {
      winner = "p1";
      p1Wins++;
    } else if (p2Score > p1Score) {
      winner = "p2";
      p2Wins++;
    }

    timeline.push({ t: t0 + 8.5, type: "round_end", round: r, winner });

    rounds.push({
      p1: { total: p1Score },
      p2: { total: p2Score },
      winner,
    });
  }

  let matchWinner: "p1" | "p2" | "draw" = "draw";
  if (p1Wins > p2Wins) matchWinner = "p1";
  else if (p2Wins > p1Wins) matchWinner = "p2";

  return {
    timeline,
    rounds,
    duration_sec: roundCount * secPerRound,
    match_winner: matchWinner,
    warning: null as any,
  };
}

/**
 * -----------------------------
 * SIMULATION V1 (NEW)
 * -----------------------------
 * Adds: spawn/turn_start/attack/damage/heal/shield/debuff_tick/death
 * Uses hp/init/ability_id if available; otherwise falls back to V0.
 *
 * Abilities implemented (v1 starter pack):
 * - strike (default)
 * - double_strike
 * - shield_self
 * - shield_ally
 * - heal_ally
 * - poison (DoT)
 * - buff_attack (simple +% for 1 round)
 *
 * Notes:
 * - Deterministic: seeded by matchId + round
 * - "score" = sum(remaining_hp + shield) at end of round
 */
async function simulateTimelineV1(params: { matchId: string; logObj: any }) {
  const { matchId, logObj } = params;

  const p1All = toStringArray(logObj?.p1_cards ?? logObj?.p1_deck ?? logObj?.p1 ?? []);
  const p2All = toStringArray(logObj?.p2_cards ?? logObj?.p2_deck ?? logObj?.p2 ?? logObj?.p2 ?? []);

  if (!p1All.length || !p2All.length) {
    return {
      timeline: null as any,
      rounds: null as any,
      duration_sec: 30,
      warning:
        "simulate=2 requested, but log.p1_cards/log.p2_cards not found. Ensure /api/pvp/enqueue writes p1_cards/p2_cards (expanded 20 ids).",
    };
  }

  const needIds = [...p1All, ...p2All];
  const { meta, extended } = await loadCardsMeta(needIds);

  // If DB doesn't have hp/init/ability yet, we still can run V1 with defaults,
  // but better to warn.
  const timeline: any[] = [];
  const rounds: any[] = [];

  const roundCount = 3;
  const secPerRound = 12;
  const duration_sec = roundCount * secPerRound;

  let p1Wins = 0;
  let p2Wins = 0;

  type UnitState = {
    side: "p1" | "p2";
    slot: number;
    instanceId: string;
    card: CardMeta;
    hp: number;
    maxHp: number;
    shield: number;
    alive: boolean;

    // statuses
    poisonTicks: number; // ticks remaining
    poisonDmg: number; // per tick
    atkMul: number; // attack multiplier (buff_attack)
  };

  function unitRef(u: UnitState) {
    return { side: u.side, slot: u.slot, instanceId: u.instanceId };
  }

  function rollChoice<T>(arr: T[], rand: () => number): T | null {
    if (!arr.length) return null;
    const i = Math.floor(rand() * arr.length);
    return arr[i] ?? null;
  }

  function getAlive(units: UnitState[], side: "p1" | "p2") {
    return units.filter((u) => u.side === side && u.alive);
  }

  function defaultHpByRarity(r: string) {
    const rr = String(r || "common").toLowerCase();
    if (rr === "legendary") return 175;
    if (rr === "epic") return 150;
    if (rr === "rare") return 125;
    return 100;
  }

  function defaultInitByRarity(r: string) {
    const rr = String(r || "common").toLowerCase();
    if (rr === "legendary") return 16;
    if (rr === "epic") return 14;
    if (rr === "rare") return 12;
    return 10;
  }

  function getAbilityKey(c: CardMeta): string {
    const a = (c.ability_id ?? "").toString().trim();
    // if empty -> strike
    return a ? a : "strike";
  }

  function abilityParams(c: CardMeta): any {
    return parseMaybeJson(c.ability_params ?? {}) ?? {};
  }

  function emit(t: number, e: any) {
    timeline.push({ ...e, t: Number(t.toFixed(3)) });
  }

  for (let r = 1; r <= roundCount; r++) {
    const t0 = (r - 1) * secPerRound;
    emit(t0 + 0.0, { type: "round_start", round: r });

    const seed = hash32(`${matchId}::round::${r}`);
    const rand = mulberry32(seed);

    const p1Pick = pickNDeterministic(p1All, 5, rand);
    const p2Pick = pickNDeterministic(p2All, 5, rand);

    const p1Full = buildCardsFull(p1Pick, meta);
    const p2Full = buildCardsFull(p2Pick, meta);

    emit(t0 + 1.6, {
      type: "reveal",
      round: r,
      p1_cards: p1Pick,
      p2_cards: p2Pick,
      p1_cards_full: p1Full,
      p2_cards_full: p2Full,
    });

    // Build units
    const units: UnitState[] = [];
    const mkInstance = (side: "p1" | "p2", slot: number, cardId: string) => `${side}-${r}-${slot}-${hash32(cardId)}`;

    for (let i = 0; i < 5; i++) {
      const c1 = meta.get(p1Pick[i]) ?? p1Full[i];
      const c2 = meta.get(p2Pick[i]) ?? p2Full[i];

      const hp1 = Number.isFinite(c1?.hp as any) ? Number(c1!.hp) : defaultHpByRarity(c1?.rarity || "common");
      const hp2 = Number.isFinite(c2?.hp as any) ? Number(c2!.hp) : defaultHpByRarity(c2?.rarity || "common");

      const u1: UnitState = {
        side: "p1",
        slot: i,
        instanceId: mkInstance("p1", i, c1?.id || String(i)),
        card: c1,
        hp: Math.max(1, Math.floor(hp1)),
        maxHp: Math.max(1, Math.floor(hp1)),
        shield: 0,
        alive: true,
        poisonTicks: 0,
        poisonDmg: 0,
        atkMul: 1,
      };
      const u2: UnitState = {
        side: "p2",
        slot: i,
        instanceId: mkInstance("p2", i, c2?.id || String(i)),
        card: c2,
        hp: Math.max(1, Math.floor(hp2)),
        maxHp: Math.max(1, Math.floor(hp2)),
        shield: 0,
        alive: true,
        poisonTicks: 0,
        poisonDmg: 0,
        atkMul: 1,
      };

      units.push(u1, u2);

      emit(t0 + 2.2, {
        type: "spawn",
        round: r,
        unit: unitRef(u1),
        card_id: String(c1?.id ?? ""),
        hp: u1.hp,
        maxHp: u1.maxHp,
        shield: u1.shield,
      });
      emit(t0 + 2.25, {
        type: "spawn",
        round: r,
        unit: unitRef(u2),
        card_id: String(c2?.id ?? ""),
        hp: u2.hp,
        maxHp: u2.maxHp,
        shield: u2.shield,
      });
    }

    // turn order by initiative (desc), deterministic tie-break by slot
    const initVal = (c: CardMeta) =>
      Number.isFinite(c?.initiative as any) ? Number(c!.initiative) : defaultInitByRarity(c?.rarity || "common");

    const order = units
      .slice()
      .sort((a, b) => initVal(b.card) - initVal(a.card) || a.side.localeCompare(b.side) || a.slot - b.slot);

    // A short "micro battle" inside the round:
    // ~10 turns max (or until one side wiped)
    let turnT = t0 + 2.8;
    const turnStep = 0.55;
    const maxTurns = 10;

    function applyDamage(target: UnitState, dmg: number) {
      const amount = Math.max(0, Math.floor(dmg));
      if (!amount || !target.alive) return;

      let remaining = amount;
      let blocked = false;

      if (target.shield > 0) {
        const hitShield = Math.min(target.shield, remaining);
        target.shield -= hitShield;
        remaining -= hitShield;
        blocked = hitShield > 0;

        emit(turnT + 0.04, {
          type: "shield_hit",
          round: r,
          target: unitRef(target),
          amount: hitShield,
          shield: target.shield,
        });
      }

      if (remaining > 0) {
        target.hp = Math.max(0, target.hp - remaining);
        emit(turnT + 0.08, {
          type: "damage",
          round: r,
          target: unitRef(target),
          amount: remaining,
          blocked,
          hp: target.hp,
          shield: target.shield,
        });
      } else if (blocked) {
        // show a "damage" that was fully blocked? optional
        emit(turnT + 0.08, {
          type: "damage",
          round: r,
          target: unitRef(target),
          amount: 0,
          blocked: true,
          hp: target.hp,
          shield: target.shield,
        });
      }

      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        emit(turnT + 0.12, {
          type: "death",
          round: r,
          unit: unitRef(target),
          card_id: String(target.card?.id ?? ""),
        });
      }
    }

    function applyHeal(target: UnitState, amount: number) {
      const a = Math.max(0, Math.floor(amount));
      if (!a || !target.alive) return;
      target.hp = clamp(target.hp + a, 0, target.maxHp);
      emit(turnT + 0.06, { type: "heal", round: r, target: unitRef(target), amount: a, hp: target.hp });
    }

    function addShield(target: UnitState, amount: number) {
      const a = Math.max(0, Math.floor(amount));
      if (!a || !target.alive) return;
      target.shield = Math.max(0, target.shield + a);
      emit(turnT + 0.06, { type: "shield", round: r, target: unitRef(target), amount: a, shield: target.shield });
    }

    function setPoison(target: UnitState, ticks: number, dmg: number) {
      if (!target.alive) return;
      target.poisonTicks = Math.max(target.poisonTicks, Math.max(0, Math.floor(ticks)));
      target.poisonDmg = Math.max(target.poisonDmg, Math.max(0, Math.floor(dmg)));
      emit(turnT + 0.02, {
        type: "debuff_applied",
        round: r,
        debuff: "poison",
        target: unitRef(target),
        ticks: target.poisonTicks,
        tick_damage: target.poisonDmg,
      });
    }

    function tickDebuffs(target: UnitState) {
      if (!target.alive) return;
      if (target.poisonTicks > 0 && target.poisonDmg > 0) {
        target.poisonTicks -= 1;
        emit(turnT + 0.01, {
          type: "debuff_tick",
          round: r,
          debuff: "poison",
          target: unitRef(target),
          amount: target.poisonDmg,
        });
        applyDamage(target, target.poisonDmg);
      }
    }

    function pickEnemyTarget(attacker: UnitState): UnitState | null {
      const enemySide = attacker.side === "p1" ? "p2" : "p1";
      const alive = getAlive(units, enemySide);
      if (!alive.length) return null;

      // Simple target rule: prefer same slot if alive, else random alive
      const same = alive.find((u) => u.slot === attacker.slot);
      if (same) return same;
      return rollChoice(alive, rand);
    }

    function pickAllyTarget(attacker: UnitState): UnitState | null {
      const allies = getAlive(units, attacker.side);
      if (!allies.length) return null;

      // heal/shield priority: lowest hp%
      let best: UnitState | null = null;
      let bestPct = 999;
      for (const u of allies) {
        const pct = u.maxHp > 0 ? u.hp / u.maxHp : 1;
        if (pct < bestPct) {
          bestPct = pct;
          best = u;
        }
      }
      return best ?? allies[0] ?? null;
    }

    function doAbility(attacker: UnitState) {
      if (!attacker.alive) return;

      // Before acting: debuff tick on self (poison)
      tickDebuffs(attacker);
      if (!attacker.alive) return;

      const ability = getAbilityKey(attacker.card);
      const p = abilityParams(attacker.card);

      emit(turnT + 0.0, { type: "turn_start", round: r, unit: unitRef(attacker) });

      // Base damage with small variance (deterministic rand)
      const baseAtk = Math.max(0, Math.floor(Number(attacker.card?.base_power ?? 0)));
      const variance = 0.9 + rand() * 0.2; // 0.9..1.1
      const atk = Math.max(0, Math.floor(baseAtk * attacker.atkMul * variance));

      if (ability === "double_strike") {
        const target = pickEnemyTarget(attacker);
        if (!target) return;
        emit(turnT + 0.05, { type: "attack", round: r, from: unitRef(attacker), to: unitRef(target), hits: 2 });
        applyDamage(target, Math.floor(atk * 0.65));
        if (target.alive) applyDamage(target, Math.floor(atk * 0.65));
        return;
      }

      if (ability === "shield_self") {
        const amount = Number.isFinite(p?.amount) ? Number(p.amount) : Math.max(8, Math.floor(attacker.maxHp * 0.18));
        addShield(attacker, amount);
        return;
      }

      if (ability === "shield_ally") {
        const ally = pickAllyTarget(attacker);
        if (!ally) return;
        const amount = Number.isFinite(p?.amount) ? Number(p.amount) : Math.max(8, Math.floor(ally.maxHp * 0.16));
        addShield(ally, amount);
        return;
      }

      if (ability === "heal_ally") {
        const ally = pickAllyTarget(attacker);
        if (!ally) return;
        const amount = Number.isFinite(p?.amount) ? Number(p.amount) : Math.max(10, Math.floor(ally.maxHp * 0.18));
        applyHeal(ally, amount);
        return;
      }

      if (ability === "poison") {
        const target = pickEnemyTarget(attacker);
        if (!target) return;
        emit(turnT + 0.05, { type: "attack", round: r, from: unitRef(attacker), to: unitRef(target), hits: 1 });
        // small upfront damage + poison ticks
        applyDamage(target, Math.floor(atk * 0.55));
        const ticks = Number.isFinite(p?.ticks) ? Number(p.ticks) : 2;
        const tickDmg = Number.isFinite(p?.tick_damage) ? Number(p.tick_damage) : Math.max(6, Math.floor(atk * 0.25));
        setPoison(target, ticks, tickDmg);
        return;
      }

      if (ability === "buff_attack") {
        const ally = pickAllyTarget(attacker);
        if (!ally) return;
        const pct = Number.isFinite(p?.pct) ? Number(p.pct) : 0.25; // +25%
        ally.atkMul = Math.max(1, ally.atkMul * (1 + clamp(pct, 0.05, 1.0)));
        emit(turnT + 0.04, { type: "buff_applied", round: r, buff: "buff_attack", target: unitRef(ally), pct });
        return;
      }

      // default strike
      {
        const target = pickEnemyTarget(attacker);
        if (!target) return;
        emit(turnT + 0.05, { type: "attack", round: r, from: unitRef(attacker), to: unitRef(target), hits: 1 });
        applyDamage(target, atk);
      }
    }

    for (let turn = 0; turn < maxTurns; turn++) {
      const aliveP1 = getAlive(units, "p1");
      const aliveP2 = getAlive(units, "p2");
      if (!aliveP1.length || !aliveP2.length) break;

      const attacker = order[turn % order.length];
      if (attacker && attacker.alive) doAbility(attacker);

      turnT += turnStep;
      if (turnT > t0 + secPerRound - 1.8) break;
    }

    // End round: compute score as remaining hp + shield
    const p1Units = units.filter((u) => u.side === "p1");
    const p2Units = units.filter((u) => u.side === "p2");
    const p1Score = Math.max(
      0,
      Math.round(p1Units.reduce((s, u) => s + (u.alive ? u.hp + u.shield : 0), 0))
    );
    const p2Score = Math.max(
      0,
      Math.round(p2Units.reduce((s, u) => s + (u.alive ? u.hp + u.shield : 0), 0))
    );

    emit(t0 + secPerRound - 1.2, { type: "score", round: r, p1: p1Score, p2: p2Score });

    let winner: "p1" | "p2" | "draw" = "draw";
    if (p1Score > p2Score) {
      winner = "p1";
      p1Wins++;
    } else if (p2Score > p1Score) {
      winner = "p2";
      p2Wins++;
    }

    emit(t0 + secPerRound - 0.4, { type: "round_end", round: r, winner });

    rounds.push({
      p1: { total: p1Score },
      p2: { total: p2Score },
      winner,
    });
  }

  let matchWinner: "p1" | "p2" | "draw" = "draw";
  if (p1Wins > p2Wins) matchWinner = "p1";
  else if (p2Wins > p1Wins) matchWinner = "p2";

  return {
    timeline,
    rounds,
    duration_sec,
    match_winner: matchWinner,
    warning: extended
      ? null
      : "simulate=2: DB cards table has no hp/initiative/ability_id columns (or select failed). Using defaults. Add columns later for real balance.",
  };
}

/**
 * Ensure match.log has a version marker (contract hardening).
 * - Do NOT mutate DB here. Only shape the response log object.
 */
function ensureLogV1(logObj: any) {
  const obj = logObj && typeof logObj === "object" ? logObj : {};
  const v = obj.version;
  if (v === 1) return obj;
  // Only set if missing/invalid. Keep everything else intact.
  return { ...obj, version: 1 };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const simulateFlag = url.searchParams.get("simulate");
    const simulate = simulateFlag === "1" || simulateFlag === "true";
    const simulate2 = simulateFlag === "2" || simulateFlag === "v1" || simulateFlag === "V1";

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { data: match, error } = await supabaseAdmin
      .from("pvp_matches")
      .select("id,mode,p1_user_id,p2_user_id,winner_user_id,log,status,created_at,rewards_applied")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!match) return NextResponse.json({ match: null });

    const logRaw = parseMaybeJson((match as any).log);
    const logObj = ensureLogV1((logRaw ?? {}) as any);

    // timeline may be jsonb array OR stringified json
    const timelineParsed = parseMaybeJson(logObj?.timeline);
    const timelineExisting = Array.isArray(timelineParsed) ? timelineParsed : null;

    // If no timeline — keep read-only by default, BUT allow debug simulation.
    if (!timelineExisting) {
      if (!simulate && !simulate2) {
        return NextResponse.json({
          match: { ...(match as any), log: logObj },
          warning:
            "match.log.timeline is missing. Add ?simulate=1 (V0) or ?simulate=2 (V1 with attacks) for debug timeline OR ensure enqueue persists real timeline.",
        });
      }

      if (simulate2) {
        const sim = await simulateTimelineV1({
          matchId: String((match as any).id),
          logObj,
        });

        if (!sim.timeline) {
          return NextResponse.json({
            match: { ...(match as any), log: logObj },
            warning: sim.warning || "simulate=2 failed",
          });
        }

        const newLog = ensureLogV1({
          ...logObj,
          duration_sec: sim.duration_sec,
          timeline: sim.timeline,
          rounds: sim.rounds,
          match_winner: sim.match_winner,
          simulated: true,
          simulated_v: 1,
        });

        return NextResponse.json({
          match: { ...(match as any), log: newLog },
          warning: sim.warning || "DEBUG: simulated timeline V1 (not persisted).",
        });
      }

      // default simulate=1 (V0)
      const sim = await simulateTimelineV0({
        matchId: String((match as any).id),
        logObj,
      });

      if (!sim.timeline) {
        return NextResponse.json({
          match: { ...(match as any), log: logObj },
          warning: sim.warning || "simulate=1 failed",
        });
      }

      const newLog = ensureLogV1({
        ...logObj,
        duration_sec: sim.duration_sec,
        timeline: sim.timeline,
        rounds: sim.rounds,
        match_winner: sim.match_winner,
        simulated: true,
        simulated_v: 0,
      });

      return NextResponse.json({
        match: { ...(match as any), log: newLog },
        warning: "DEBUG: simulated timeline V0 (not persisted). Your enqueue should persist real timeline.",
      });
    }

    // Ensure reveal contains cards_full for UI
    const timeline = timelineExisting as any[];

    const needMetaIds: string[] = [];
    for (const e of timeline) {
      if (!e || e.type !== "reveal") continue;

      const hasP1Full = Array.isArray(e.p1_cards_full) && e.p1_cards_full.length > 0;
      const hasP2Full = Array.isArray(e.p2_cards_full) && e.p2_cards_full.length > 0;

      if (!hasP1Full) for (const cid of toStringArray(e.p1_cards)) needMetaIds.push(cid);
      if (!hasP2Full) for (const cid of toStringArray(e.p2_cards)) needMetaIds.push(cid);
    }

    if (needMetaIds.length) {
      const { meta } = await loadCardsMeta(needMetaIds);
      for (const e of timeline) {
        if (!e || e.type !== "reveal") continue;

        const hasP1Full = Array.isArray(e.p1_cards_full) && e.p1_cards_full.length > 0;
        const hasP2Full = Array.isArray(e.p2_cards_full) && e.p2_cards_full.length > 0;

        if (!hasP1Full) e.p1_cards_full = buildCardsFull(e.p1_cards, meta);
        if (!hasP2Full) e.p2_cards_full = buildCardsFull(e.p2_cards, meta);
      }
    }

    // Return normalized log (v1 marker) + timeline possibly enriched with *_cards_full
    const outLog = ensureLogV1({ ...logObj, timeline });

    return NextResponse.json({
      match: { ...(match as any), log: outLog },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
