export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

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

type UnitRef = {
  side: "p1" | "p2";
  slot: number;
  instanceId: string;
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

function uref(u: Pick<Unit, "side" | "slot" | "instanceId">): UnitRef {
  return { side: u.side, slot: u.slot, instanceId: u.instanceId };
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

      const log = {
        combat_version: "combat-spec-v1",
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
        timeline: sim.timeline,

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
// NOTE: cards table currently гарантирует: id, rarity, base_power, name_ru/name_en, image_url
// We keep hp/initiative/ability/tags as defaults for now.
// ======================================================
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

  const { data: cards, error: cardsErr } = await supabaseAdmin
    .from("cards")
    .select("id, rarity, base_power, name_ru, name_en, image_url")
    .in("id", ids);

  if (cardsErr) throw new Error(cardsErr.message);

  const byId = new Map((cards ?? []).map((c: any) => [String(c.id), c]));

  const out: SimCard[] = [];
  for (const r of rows) {
    const c: any = byId.get(String(r.card_id));
    if (!c) continue;

    const copies = Math.max(1, Math.floor(Number(r.copies || 1)));

    const rarity = (String(c.rarity || "common").toLowerCase() as any) as SimCard["rarity"];
    const base_power = Number(c.base_power || 0);

    // Defaults until you define real combat stats for 100 cards
    const hp = 100;
    const initiative = 10;
    const ability_id = null;
    const ability_params = {};
    const tags: string[] = [];

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
        unit: uref(u),
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

  while (turns < maxTurns && aliveCount(state.units, "p1") > 0 && aliveCount(state.units, "p2") > 0) {
    for (const actor of order) {
      if (turns >= maxTurns) break;
      if (!actor.alive) continue;

      tickDots(ev, actor);

      if (actor.stunTurns > 0) {
        actor.stunTurns -= 1;
        ev.push({ type: "turn_start", unit: uref(actor) });
        ev.push({ type: "stunned", unit: uref(actor) });
        turns++;
        continue;
      }

      ev.push({ type: "turn_start", unit: uref(actor) });

      applyStartTurnAbilities(seed, round, ev, actor, state.units);

      const target = pickTarget(seed, round, actor, state.units);
      if (!target) {
        turns++;
        continue;
      }

      const hits = getHits(actor);
      ev.push({
        type: "attack",
        from: uref(actor),
        to: uref(target),
        hits,
      });

      for (let h = 0; h < hits; h++) {
        if (!actor.alive || !target.alive) break;
        const dmg = computeDamage(seed, round, actor, target, h);
        applyDamage(ev, target, dmg);

        applyOnHitDebuffs(seed, round, ev, actor, target);

        if (!target.alive) {
          ev.push({
            type: "death",
            unit: uref(target),
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

function getHits(actor: Unit): number {
  const ab = (actor.card.ability_id || "").toLowerCase();
  const params = actor.card.ability_params || {};
  if (ab === "double_strike") return Math.max(2, Number(params?.hits || 2));
  return 1;
}

function computeDamage(seed: string, round: number, actor: Unit, target: Unit, hitIndex: number): number {
  const atkBase = Math.max(0, Number(actor.card.base_power || 0));
  const ab = (actor.card.ability_id || "").toLowerCase();
  const params = actor.card.ability_params || {};

  let mult = 1.0;
  if (ab === "double_strike") mult = Number(params?.mult || 0.65);
  if (ab === "execute") {
    const thr = Number(params?.threshold_hp_pct ?? 0.3);
    const bonus = Number(params?.bonus_mult ?? 0.6);
    if (target.hp / Math.max(1, target.maxHp) <= thr) mult = 1.0 + bonus;
  }
  if (ab === "cleave") {
    mult = Number(params?.main_mult || 0.85);
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

function applyDamage(ev: any[], target: Unit, amount: number) {
  const raw = Math.max(0, Math.floor(amount));
  if (raw <= 0) {
    ev.push({
      type: "damage",
      target: uref(target),
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
        target: uref(target),
        amount: used,
        shield: target.shield,
      });
    }
  }

  if (left > 0) {
    target.hp -= left;
    ev.push({
      type: "damage",
      target: uref(target),
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
      target: uref(u),
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
      target: uref(u),
      amount: d,
    });
  }
}

function applyStartTurnAbilities(seed: string, round: number, ev: any[], actor: Unit, units: Unit[]) {
  const ab = (actor.card.ability_id || "").toLowerCase();
  const params = actor.card.ability_params || {};

  if (ab === "shield_self") {
    const amount = Math.max(1, Math.floor(Number(params?.amount ?? 35)));
    const dur = Math.max(1, Math.floor(Number(params?.duration_turns ?? 2)));
    actor.shield += amount;
    ev.push({
      type: "shield",
      target: uref(actor),
      amount,
      duration_turns: dur,
      shield: actor.shield,
    });
  }

  if (ab === "taunt") {
    const dur = Math.max(1, Math.floor(Number(params?.duration_turns ?? 2)));
    actor.tauntTurns = Math.max(actor.tauntTurns, dur);
    ev.push({
      type: "buff_applied",
      buff: "taunt",
      target: uref(actor),
      duration_turns: dur,
    });
  }

  if (ab === "heal_ally") {
    const amount = Math.max(1, Math.floor(Number(params?.amount ?? 28)));
    const ally = pickAllyLowestHp(seed, round, actor, units);
    if (ally) {
      const before = ally.hp;
      ally.hp = Math.min(ally.maxHp, ally.hp + amount);
      const healed = ally.hp - before;
      if (healed > 0) {
        ev.push({
          type: "heal",
          target: uref(ally),
          amount: healed,
          hp: ally.hp,
        });
      }
    }
  }

  if (ab === "buff_attack") {
    const pct = Number(params?.atk_up_pct ?? 0.18);
    const dur = Math.max(1, Math.floor(Number(params?.duration_turns ?? 2)));
    actor.weakenTurns = Math.max(actor.weakenTurns, dur);
    actor.weakenPct = -Math.max(0, pct);
    ev.push({
      type: "buff_applied",
      buff: "atk_up",
      target: uref(actor),
      duration_turns: dur,
      pct,
    });
  }
}

function applyOnHitDebuffs(seed: string, round: number, ev: any[], actor: Unit, target: Unit) {
  if (!actor.alive || !target.alive) return;

  const ab = (actor.card.ability_id || "").toLowerCase();
  const params = actor.card.ability_params || {};

  if (ab === "poison") {
    const tick_damage = Math.max(1, Math.floor(Number(params?.tick_damage ?? 10)));
    const ticks = Math.max(1, Math.floor(Number(params?.ticks ?? 3)));
    target.poisonDmg = Math.max(target.poisonDmg, tick_damage);
    target.poisonTicks = Math.max(target.poisonTicks, ticks);
    ev.push({
      type: "debuff_applied",
      debuff: "poison",
      target: uref(target),
      tick_damage,
      ticks,
    });
  }

  if (ab === "burn") {
    const tick_damage = Math.max(1, Math.floor(Number(params?.tick_damage ?? 9)));
    const ticks = Math.max(1, Math.floor(Number(params?.ticks ?? 3)));
    target.burnDmg = Math.max(target.burnDmg, tick_damage);
    target.burnTicks = Math.max(target.burnTicks, ticks);
    ev.push({
      type: "debuff_applied",
      debuff: "burn",
      target: uref(target),
      tick_damage,
      ticks,
    });
  }

  if (ab === "stun") {
    const dur = Math.max(1, Math.floor(Number(params?.duration_turns ?? 1)));
    const chance = Number(params?.chance ?? 0.25);
    const r = rand01(`${seed}:${round}:stun:${actor.instanceId}:${target.instanceId}`);
    if (r < chance) {
      target.stunTurns = Math.max(target.stunTurns, dur);
      ev.push({
        type: "debuff_applied",
        debuff: "stun",
        target: uref(target),
        duration_turns: dur,
      });
    }
  }

  if (ab === "vulnerable") {
    const pct = Number(params?.damage_taken_up_pct ?? 0.2);
    const dur = Math.max(1, Math.floor(Number(params?.duration_turns ?? 2)));
    target.vulnerableTurns = Math.max(target.vulnerableTurns, dur);
    target.vulnerablePct = Math.max(target.vulnerablePct, pct);
    ev.push({
      type: "debuff_applied",
      debuff: "vulnerable",
      target: uref(target),
      duration_turns: dur,
      pct,
    });
  }

  if (ab === "weaken") {
    const pct = Number(params?.atk_down_pct ?? 0.18);
    const dur = Math.max(1, Math.floor(Number(params?.duration_turns ?? 2)));
    target.weakenTurns = Math.max(target.weakenTurns, dur);
    target.weakenPct = Math.max(target.weakenPct, pct);
    ev.push({
      type: "debuff_applied",
      debuff: "weaken",
      target: uref(target),
      duration_turns: dur,
      pct,
    });
  }
}

function pickAllyLowestHp(seed: string, round: number, actor: Unit, units: Unit[]): Unit | null {
  const allies = units.filter((u) => u.side === actor.side && u.alive);
  if (!allies.length) return null;

  allies.sort((a, b) => {
    const ap = a.hp / Math.max(1, a.maxHp);
    const bp = b.hp / Math.max(1, b.maxHp);
    if (ap !== bp) return ap - bp;
    const ka = crypto.createHash("md5").update(`${seed}:${round}:ally:${actor.instanceId}:${a.instanceId}`).digest("hex");
    const kb = crypto.createHash("md5").update(`${seed}:${round}:ally:${actor.instanceId}:${b.instanceId}`).digest("hex");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return allies[0] || null;
}

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

  const winner: "p1" | "p2" | "draw" =
    p1Total > p2Total ? "p1" : p2Total > p1Total ? "p2" : "draw";
  return { p1Total, p2Total, winner };
}
