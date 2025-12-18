export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

import {
  ability_getHits,
  ability_computeDamage,
  ability_onTurnStart,
  ability_onHit,
} from "@/lib/pvp/abilities";
import type { PickAllyLowestHp, UnitLike } from "@/lib/pvp/abilities";

type EnqueueBody = {
  telegramId?: string;
  mode?: string; // region bucket
};

type RpcPayload =
  | { status: "queued" }
  | {
      status: "matched";
      match_id: string;
      opponent_id?: string | null;
      seed?: string | null;
    };

// ===== Card model for sim =====
type SimCard = {
  id: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number; // ATK
  hp: number;
  initiative: number;
  ability_id: string | null;
  ability_params: any;
  tags: string[];
  name?: string;
  image_url?: string | null;
};

type Unit = {
  instanceId: string;
  card: SimCard;
  side: "p1" | "p2";
  slot: number;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;

  // simple statuses
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

type UnitRef = { side: "p1" | "p2"; slot: number; instanceId: string };

function toUnitRef(obj: any): UnitRef | null {
  const side = obj?.side;
  const slot = obj?.slot;
  const instanceId = obj?.instanceId;
  if ((side !== "p1" && side !== "p2") || slot == null || instanceId == null) return null;
  return { side, slot: Number(slot), instanceId: String(instanceId) };
}

/**
 * Normalize timeline events to LOG V1:
 * - ensure unit references are in {unit}/{target} where applicable
 * - keep old flat fields too (backward compatible)
 * - ensure spawn includes shield
 */
function normalizeTimelineV1(timeline: any[]): any[] {
  if (!Array.isArray(timeline)) return [];

  return timeline.map((e) => {
    if (!e || typeof e !== "object") return e;

    const type = String(e.type || "");
    const flatRef = toUnitRef(e);

    // Normalize spawn -> unit
    if (type === "spawn") {
      const unit = e.unit ?? flatRef;
      return {
        ...e,
        unit,
        // keep legacy flat fields if present
        side: e.side ?? unit?.side,
        slot: e.slot ?? unit?.slot,
        instanceId: e.instanceId ?? unit?.instanceId,
        shield: e.shield ?? 0,
      };
    }

    // turn_start -> unit
    if (type === "turn_start" || type === "stunned") {
      const unit = e.unit ?? flatRef;
      return {
        ...e,
        unit,
        side: e.side ?? unit?.side,
        slot: e.slot ?? unit?.slot,
        instanceId: e.instanceId ?? unit?.instanceId,
      };
    }

    // death -> unit
    if (type === "death") {
      const unit = e.unit ?? flatRef ?? e.target;
      return {
        ...e,
        unit: unit ?? e.unit,
        side: e.side ?? unit?.side,
        slot: e.slot ?? unit?.slot,
        instanceId: e.instanceId ?? unit?.instanceId,
      };
    }

    // debuff_tick / buff_applied -> target
    if (type === "debuff_tick" || type === "debuff_applied" || type === "buff_applied") {
      const target = e.target ?? flatRef ?? e.unit;
      return {
        ...e,
        target,
        side: e.side ?? target?.side,
        slot: e.slot ?? target?.slot,
        instanceId: e.instanceId ?? target?.instanceId,
      };
    }

    return e;
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as EnqueueBody;
    const telegramId = body?.telegramId;
    const mode = body?.mode || "unranked";

    if (!telegramId) {
      return NextResponse.json({ error: "telegramId required" }, { status: 400 });
    }

    // 1) Resolve user by telegramId
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
    if (!userRow) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // 2) Deck (server truth) + power
    const p1Deck = await loadDeckForSim(userRow.id);
    if (!p1Deck.length) {
      return NextResponse.json(
        { error: "Active deck is empty (no pvp_deck_cards). Create deck first." },
        { status: 400 }
      );
    }
    const p1Power = calcDeckPower(p1Deck);

    // 3) Atomic matchmaking via RPC (still SQL)
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("pvp_join_and_match", {
      p_user_id: userRow.id,
      p_deck_power: p1Power,
      p_region: mode,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: `pvp_join_and_match failed: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    const payload = (rpcData ?? {}) as RpcPayload;

    if ((payload as any).status !== "matched") {
      return NextResponse.json({ status: "queued", deckPower: p1Power });
    }

    const matchId = (payload as any).match_id as string;
    const opponentId = (payload as any).opponent_id || null;

    // Deterministic seed. If RPC doesn't return seed — we make stable one.
    const seed = (payload as any).seed || `${matchId}:${userRow.id}:${opponentId || "none"}`;

    // 4) Enrich match: full simulation + expanded timeline
    if (opponentId) {
      const p2Deck = await loadDeckForSim(opponentId);
      const p2Power = calcDeckPower(p2Deck);

      const sim = simulateBestOf3(seed, p1Deck, p2Deck);

      const winner_user_id =
        sim.winner === "draw" ? null : sim.winner === "p1" ? userRow.id : opponentId;

      // store full 20-copy decks (expanded ids)
      const p1DeckAllIds = p1Deck.map((c) => c.id);
      const p2DeckAllIds = p2Deck.map((c) => c.id);

      const timelineV1 = normalizeTimelineV1(sim.timeline);

      const log = {
        version: 1,
        combat_version: "combat-spec-v1-lite",
        seed,
        duration_sec: sim.duration_sec,

        p1: { deckPower: p1Power },
        p2: { deckPower: p2Power },

        // ✅ canonical keys for battle viewer
        p1_cards: p1DeckAllIds,
        p2_cards: p2DeckAllIds,

        // ✅ keep older keys too
        p1_deck_cards: p1DeckAllIds,
        p2_deck_cards: p2DeckAllIds,

        rounds: sim.rounds,
        timeline: timelineV1,

        winner: sim.winner,
      };

      const { error: upErr } = await supabaseAdmin
        .from("pvp_matches")
        .update({
          log,
          winner_user_id,
          status: "resolved",
        })
        .eq("id", matchId);

      if (upErr) {
        return NextResponse.json(
          { error: `Failed to persist match log: ${upErr.message}`, matchId },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      status: "matched",
      matchId,
      opponentId,
      seed,
      deckPower: p1Power,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}

// ======================================================
// Deck loader (PVP SCHEMA): pvp_decks / pvp_deck_cards / cards
// cards содержит: id(text), rarity, base_power, image_url, (optional) hp, initiative, ability_id, ability_params, tags
// ======================================================

function hashTo01(input: string): number {
  const h = crypto.createHash("md5").update(input).digest("hex").slice(0, 8);
  const n = parseInt(h, 16);
  return (n >>> 0) / 0xffffffff;
}

function rarityRanges(rarity: SimCard["rarity"]) {
  // ranges from your balance note
  if (rarity === "legendary") return { hp: [145, 210], init: [14, 20] };
  if (rarity === "epic") return { hp: [120, 175], init: [12, 18] };
  if (rarity === "rare") return { hp: [95, 140], init: [10, 16] };
  return { hp: [70, 110], init: [8, 14] };
}

function deriveHpInit(cardId: string, rarity: SimCard["rarity"]) {
  const r = hashTo01(`hpinit:${rarity}:${cardId}`);
  const rr = rarityRanges(rarity);
  const hp = Math.floor(rr.hp[0] + r * (rr.hp[1] - rr.hp[0]));
  const init = Math.floor(rr.init[0] + r * (rr.init[1] - rr.init[0]));
  return { hp: Math.max(1, hp), initiative: Math.max(0, init) };
}

async function loadDeckForSim(userId: string): Promise<SimCard[]> {
  const { data: deck, error: deckErr } = await supabaseAdmin
    .from("pvp_decks")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (deckErr) throw new Error(deckErr.message);
  if (!deck?.id) return [];

  const { data: deckCards, error: dcErr } = await supabaseAdmin
    .from("pvp_deck_cards")
    .select("card_id, copies")
    .eq("deck_id", deck.id);

  if (dcErr) throw new Error(dcErr.message);

  const rows: { card_id: string; copies: number }[] = (deckCards ?? []) as any;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.card_id));

  // --- Try EXTENDED cards select first. If columns don't exist -> fallback to BASE select.
  let cards: any[] = [];
  let extended = true;

  try {
    const { data, error } = await supabaseAdmin
      .from("cards")
      .select(
        "id, rarity, base_power, name_ru, name_en, image_url, hp, initiative, ability_id, ability_params, tags"
      )
      .in("id", ids);

    if (error) throw new Error(error.message);
    cards = data ?? [];
  } catch {
    extended = false;
    const { data, error } = await supabaseAdmin
      .from("cards")
      .select("id, rarity, base_power, name_ru, name_en, image_url")
      .in("id", ids);

    if (error) throw new Error(error.message);
    cards = data ?? [];
  }

  const byId = new Map(cards.map((c: any) => [String(c.id), c]));

  const out: SimCard[] = [];
  for (const r of rows) {
    const c: any = byId.get(String(r.card_id));
    if (!c) continue;

    const copies = Math.max(1, Math.floor(Number(r.copies || 1)));

    const rarity = (String(c.rarity || "common").toLowerCase() as any) as SimCard["rarity"];
    const base_power = Number(c.base_power || 0);

    // ✅ hp/init from DB if exists, else deterministic by rarity ranges
    let hp: number;
    let initiative: number;

    if (extended && c.hp != null && c.initiative != null) {
      hp = Math.max(1, Math.floor(Number(c.hp)));
      initiative = Math.max(0, Math.floor(Number(c.initiative)));
    } else {
      const d = deriveHpInit(String(c.id), rarity);
      hp = d.hp;
      initiative = d.initiative;
    }

    const ability_id_raw = extended && c.ability_id != null ? String(c.ability_id).trim() : "";
    const ability_id = ability_id_raw ? ability_id_raw : null;

    const ability_params = extended ? (c.ability_params ?? {}) : {};
    const tags: string[] = extended && Array.isArray(c.tags) ? c.tags.map((x: any) => String(x)) : [];

    const name =
      (c.name_ru && String(c.name_ru).trim()) ||
      (c.name_en && String(c.name_en).trim()) ||
      String(c.id);

    const image_url = c.image_url ?? null;

    for (let i = 0; i < copies; i++) {
      out.push({
        id: String(r.card_id),
        rarity,
        base_power,
        hp,
        initiative,
        ability_id,
        ability_params,
        tags,
        name,
        image_url,
      });
    }
  }

  return out;
}

function calcDeckPower(deck: SimCard[]) {
  let sum = 0;
  for (const c of deck) sum += Number(c.base_power || 0);
  return Math.max(0, Math.floor(sum));
}

// ======================================================
// Deterministic PRNG (no Math.random())
// ======================================================
function rand01(seed: string): number {
  const h = crypto.createHash("md5").update(seed).digest("hex").slice(0, 16);
  const x = BigInt("0x" + h) & BigInt("0x7fffffffffffffff");
  const denom = BigInt("0x8000000000000000");
  return Number(x) / Number(denom);
}

function pick5(seed: string, expandedDeck: SimCard[], side: "p1" | "p2", round: number): SimCard[] {
  const keyed = expandedDeck.map((c, idx) => ({
    c,
    k: crypto
      .createHash("md5")
      .update(`${seed}:r${round}:${side}:i${idx}:${c.id}`)
      .digest("hex"),
  }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return keyed.slice(0, 5).map((x) => x.c);
}

// ======================================================
// Simulation: Best-of-3, each round = 5v5 fight
// ======================================================
function simulateBestOf3(seed: string, p1Deck: SimCard[], p2Deck: SimCard[]) {
  const timeline: any[] = [];
  const rounds: any[] = [];

  let p1Wins = 0;
  let p2Wins = 0;

  const roundSpan = 30;
  const maxRounds = 3;

  for (let round = 1; round <= maxRounds; round++) {
    const baseT = (round - 1) * roundSpan;

    const p1Cards = pick5(seed, p1Deck, "p1", round);
    const p2Cards = pick5(seed, p2Deck, "p2", round);

    const p1CardsIds = p1Cards.map((c) => c.id);
    const p2CardsIds = p2Cards.map((c) => c.id);

    const p1CardsFull = p1Cards.map((c) => ({
      id: c.id,
      rarity: c.rarity,
      base_power: c.base_power,
      hp: c.hp,
      initiative: c.initiative,
      ability_id: c.ability_id,
      ability_params: c.ability_params,
      tags: c.tags,
      name: c.name,
      image_url: c.image_url,
    }));

    const p2CardsFull = p2Cards.map((c) => ({
      id: c.id,
      rarity: c.rarity,
      base_power: c.base_power,
      hp: c.hp,
      initiative: c.initiative,
      ability_id: c.ability_id,
      ability_params: c.ability_params,
      tags: c.tags,
      name: c.name,
      image_url: c.image_url,
    }));

    timeline.push({ t: baseT + 0, type: "round_start", round });

    timeline.push({
      t: baseT + 2,
      type: "reveal",
      round,
      p1_cards: p1CardsIds,
      p2_cards: p2CardsIds,
      p1_cards_full: p1CardsFull,
      p2_cards_full: p2CardsFull,
    });

    const state = initRoundState(seed, round, p1Cards, p2Cards);

    for (const u of state.units) {
      timeline.push({
        t: baseT + 3,
        type: "spawn",
        round,
        side: u.side,
        slot: u.slot,
        instanceId: u.instanceId,
        card_id: u.card.id,
        hp: u.hp,
        maxHp: u.maxHp,
        shield: u.shield,
      });
    }

    const simEvents = simulateRoundTurns(seed, round, state);
    const tStart = baseT + 4;
    const tEnd = baseT + 18;
    const steps = Math.max(1, simEvents.length);
    for (let i = 0; i < simEvents.length; i++) {
      const tt = Math.floor(tStart + ((tEnd - tStart) * i) / steps);
      timeline.push({ ...simEvents[i], t: tt, round });
    }

    const { p1Total, p2Total, winner } = computeRoundScore(seed, round, state);

    if (winner === "p1") p1Wins++;
    else if (winner === "p2") p2Wins++;

    rounds.push({
      p1: { cards: p1CardsIds, total: p1Total },
      p2: { cards: p2CardsIds, total: p2Total },
      winner,
    });

    timeline.push({ t: baseT + 18, type: "score", round, p1: p1Total, p2: p2Total });
    timeline.push({ t: baseT + 22, type: "round_end", round, winner });

    if (p1Wins === 2 || p2Wins === 2) break;
  }

  const finalWinner: "p1" | "p2" | "draw" =
    p1Wins > p2Wins ? "p1" : p2Wins > p1Wins ? "p2" : "draw";

  timeline.push({
    t: Math.max(0, Math.min(3, rounds.length) * roundSpan - 1),
    type: "match_end",
    winner: finalWinner,
  });

  const duration_sec = Math.max(30, rounds.length * roundSpan);

  return { winner: finalWinner, rounds, timeline: timeline.sort((a, b) => a.t - b.t), duration_sec };
}

function initRoundState(seed: string, round: number, p1Cards: SimCard[], p2Cards: SimCard[]) {
  const units: Unit[] = [];

  for (let i = 0; i < 5; i++) {
    const c1 = p1Cards[i];
    const c2 = p2Cards[i];

    if (c1) units.push(makeUnit(seed, round, "p1", i, c1));
    if (c2) units.push(makeUnit(seed, round, "p2", i, c2));
  }

  return { units };
}

function makeUnit(seed: string, round: number, side: "p1" | "p2", slot: number, card: SimCard): Unit {
  const instanceId = `${side}:r${round}:s${slot}:${card.id}:${crypto
    .createHash("md5")
    .update(`${seed}:${round}:${side}:${slot}:${card.id}`)
    .digest("hex")
    .slice(0, 6)}`;

  return {
    instanceId,
    card,
    side,
    slot,
    hp: Math.max(1, card.hp),
    maxHp: Math.max(1, card.hp),
    shield: 0,
    alive: true,

    tauntTurns: 0,
    stunTurns: 0,
    poisonTicks: 0,
    poisonDmg: 0,
    burnTicks: 0,
    burnDmg: 0,
    vulnerableTurns: 0,
    vulnerablePct: 0,
    weakenTurns: 0,
    weakenPct: 0,
  };
}

function simulateRoundTurns(seed: string, round: number, state: { units: Unit[] }) {
  const ev: any[] = [];

  const order = state.units.slice().sort((a, b) => {
    const di = (b.card.initiative || 0) - (a.card.initiative || 0);
    if (di !== 0) return di;
    const ka = crypto.createHash("md5").update(`${seed}:${round}:tie:${a.instanceId}`).digest("hex");
    const kb = crypto.createHash("md5").update(`${seed}:${round}:tie:${b.instanceId}`).digest("hex");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const maxTurns = 16;
  let turns = 0;

  while (
    turns < maxTurns &&
    aliveCount(state.units, "p1") > 0 &&
    aliveCount(state.units, "p2") > 0
  ) {
    for (const actor of order) {
      if (turns >= maxTurns) break;
      if (!actor.alive) continue;

      tickDots(ev, actor);

      if (actor.stunTurns > 0) {
        actor.stunTurns -= 1;
        ev.push({ type: "turn_start", side: actor.side, slot: actor.slot, instanceId: actor.instanceId });
        ev.push({ type: "stunned", side: actor.side, slot: actor.slot, instanceId: actor.instanceId });
        turns++;
        continue;
      }

      ev.push({ type: "turn_start", side: actor.side, slot: actor.slot, instanceId: actor.instanceId });

      // ✅ abilities registry (turn start)
      ability_onTurnStart({
        seed,
        round,
        ev,
        actor,
        units: state.units,
        pickAllyLowestHp,
      });

      const target = pickTarget(seed, round, actor, state.units);
      if (!target) {
        turns++;
        continue;
      }

      const hits = ability_getHits(actor);
      ev.push({
        type: "attack",
        from: { side: actor.side, slot: actor.slot, instanceId: actor.instanceId },
        to: { side: target.side, slot: target.slot, instanceId: target.instanceId },
        hits,
      });

      for (let h = 0; h < hits; h++) {
        if (!actor.alive || !target.alive) break;

        const dmg = ability_computeDamage({
          seed,
          round,
          actor,
          target,
          hitIndex: h,
          rand01,
        });

        applyDamage(ev, target, dmg);

        // ✅ abilities registry (on hit)
        ability_onHit({
          seed,
          round,
          ev,
          actor,
          target,
          rand01,
        });

        if (!target.alive) {
          ev.push({
            type: "death",
            side: target.side,
            slot: target.slot,
            instanceId: target.instanceId,
            card_id: target.card.id,
          });
          break;
        }
      }

      decayStatuses(actor);

      turns++;
      if (aliveCount(state.units, "p1") <= 0 || aliveCount(state.units, "p2") <= 0) break;
    }
  }

  return ev;
}

function aliveCount(units: Unit[], side: "p1" | "p2") {
  return units.filter((u) => u.side === side && u.alive).length;
}

function pickTarget(seed: string, round: number, actor: Unit, units: Unit[]): Unit | null {
  const enemySide = actor.side === "p1" ? "p2" : "p1";
  const enemies = units.filter((u) => u.side === enemySide && u.alive);
  if (enemies.length === 0) return null;

  const taunters = enemies.filter((u) => u.tauntTurns > 0);
  const pool = taunters.length ? taunters : enemies;

  const sameSlot = pool.find((u) => u.slot === actor.slot);
  if (sameSlot) return sameSlot;

  pool.sort((a, b) => {
    const ka = crypto
      .createHash("md5")
      .update(`${seed}:${round}:target:${actor.instanceId}:${a.instanceId}`)
      .digest("hex");
    const kb = crypto
      .createHash("md5")
      .update(`${seed}:${round}:target:${actor.instanceId}:${b.instanceId}`)
      .digest("hex");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return pool[0] || null;
}

function applyDamage(ev: any[], target: Unit, amount: number) {
  const raw = Math.max(0, Math.floor(amount));
  if (raw <= 0) {
    ev.push({
      type: "damage",
      target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
      amount: 0,
      blocked: true,
      hp: target.hp,
      shield: target.shield,
    });
    return;
  }

  let left = raw;

  if (target.shield > 0) {
    const used = Math.min(target.shield, left);
    target.shield -= used;
    left -= used;
    if (used > 0) {
      ev.push({
        type: "shield_hit",
        target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
        amount: used,
        shield: target.shield,
      });
    }
  }

  if (left > 0) {
    target.hp -= left;
    ev.push({
      type: "damage",
      target: { side: target.side, slot: target.slot, instanceId: target.instanceId },
      amount: left,
      hp: Math.max(0, target.hp),
      shield: target.shield,
    });
  }

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
  }
}

function tickDots(ev: any[], u: Unit) {
  if (!u.alive) return;

  if (u.poisonTicks > 0) {
    const d = Math.max(1, Math.floor(u.poisonDmg || 1));
    u.poisonTicks -= 1;
    applyDamage(ev, u, d);
    ev.push({
      type: "debuff_tick",
      debuff: "poison",
      side: u.side,
      slot: u.slot,
      instanceId: u.instanceId,
      amount: d,
    });
  }
  if (u.burnTicks > 0) {
    const d = Math.max(1, Math.floor(u.burnDmg || 1));
    u.burnTicks -= 1;
    applyDamage(ev, u, d);
    ev.push({
      type: "debuff_tick",
      debuff: "burn",
      side: u.side,
      slot: u.slot,
      instanceId: u.instanceId,
      amount: d,
    });
  }
}

/**
 * ✅ FIX (GENERIC, без any):
 * PickAllyLowestHp = <U extends UnitLike>(...) => U | null
 * Мы работаем напрямую по полям UnitLike, и возвращаем U (а не UnitLike).
 */
const pickAllyLowestHp: PickAllyLowestHp = <U extends UnitLike>(
  seed: string,
  round: number,
  actor: U,
  units: U[]
): U | null => {
  const allies = units.filter((u) => u.side === actor.side && u.alive);
  if (!allies.length) return null;

  allies.sort((a, b) => {
    const ap = a.hp / Math.max(1, a.maxHp);
    const bp = b.hp / Math.max(1, b.maxHp);
    if (ap !== bp) return ap - bp;

    const ka = crypto
      .createHash("md5")
      .update(`${seed}:${round}:ally:${actor.instanceId}:${a.instanceId}`)
      .digest("hex");
    const kb = crypto
      .createHash("md5")
      .update(`${seed}:${round}:ally:${actor.instanceId}:${b.instanceId}`)
      .digest("hex");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return allies[0] ?? null;
};

function decayStatuses(u: Unit) {
  if (u.tauntTurns > 0) u.tauntTurns -= 1;

  if (u.vulnerableTurns > 0) u.vulnerableTurns -= 1;
  if (u.vulnerableTurns <= 0) u.vulnerablePct = 0;

  if (u.weakenTurns > 0) u.weakenTurns -= 1;
  if (u.weakenTurns <= 0) u.weakenPct = 0;
}

function computeRoundScore(seed: string, round: number, state: { units: Unit[] }) {
  const p1Alive = state.units.filter((u) => u.side === "p1" && u.alive);
  const p2Alive = state.units.filter((u) => u.side === "p2" && u.alive);

  const p1Hp = p1Alive.reduce((s, u) => s + u.hp, 0);
  const p2Hp = p2Alive.reduce((s, u) => s + u.hp, 0);

  const p1Atk = p1Alive.reduce((s, u) => s + u.card.base_power, 0);
  const p2Atk = p2Alive.reduce((s, u) => s + u.card.base_power, 0);

  const luck1 = 0.985 + rand01(`${seed}:${round}:score:p1`) * 0.03;
  const luck2 = 0.985 + rand01(`${seed}:${round}:score:p2`) * 0.03;

  const p1Total = Math.floor((p1Hp + Math.floor(p1Atk * 0.4)) * luck1);
  const p2Total = Math.floor((p2Hp + Math.floor(p2Atk * 0.4)) * luck2);

  const winner: "p1" | "p2" | "draw" = p1Total > p2Total ? "p1" : p2Total > p1Total ? "p2" : "draw";
  return { p1Total, p2Total, winner };
}
