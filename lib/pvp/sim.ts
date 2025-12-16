import crypto from "crypto";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export type Card = {
  id: string;
  rarity: Rarity;
  base_power: number;

  // optional meta (если ты подашь эти поля из DB — battle сможет рисовать красиво)
  name?: string;
  image_url?: string | null;
};

export type RoundSideLog = {
  cards: string[]; // backward-compatible for current battle UI
  cards_full?: Array<{
    id: string;
    rarity: Rarity;
    base_power: number;
    name?: string;
    image_url?: string | null;
  }>;
  baseSum: number;
  luckMul: number; // 0.97..1.03
  crits: Array<{ cardId: string; rarity: Rarity; mul: number }>;
  total: number;
};

export type TimelineEvent =
  | { t: number; type: "round_start"; round: number }
  | {
      t: number;
      type: "reveal";
      round: number;
      p1_cards: string[];
      p2_cards: string[];
      // future: для красивого UI (не ломает текущий)
      p1_cards_full?: RoundSideLog["cards_full"];
      p2_cards_full?: RoundSideLog["cards_full"];
    }
  | { t: number; type: "score"; round: number; p1: number; p2: number }
  | { t: number; type: "round_end"; round: number; winner: "p1" | "p2" | "draw" }
  | { t: number; type: "match_end"; winner: "p1" | "p2" | "draw" };

export type MatchLog = {
  duration_sec: number; // 60..90..120 (battle page уже читает duration_sec)
  timeline: TimelineEvent[];

  rounds: Array<{
    p1: RoundSideLog;
    p2: RoundSideLog;
    winner: "p1" | "p2" | "draw";
  }>;

  winner: "p1" | "p2" | "draw";
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToInt(seed: string) {
  const h = crypto.createHash("sha256").update(seed).digest();
  return h.readUInt32LE(0);
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function pickN<T>(rng: () => number, arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function critConfig(r: Rarity) {
  if (r === "legendary") return { chance: 0.16, mul: 1.6 };
  if (r === "epic") return { chance: 0.12, mul: 1.45 };
  if (r === "rare") return { chance: 0.08, mul: 1.35 };
  return { chance: 0.0, mul: 1.0 };
}

function scoreSide(rng: () => number, hand: Card[]): RoundSideLog {
  const crits: RoundSideLog["crits"] = [];
  let sum = 0;

  for (const c of hand) {
    let p = c.base_power;
    const cfg = critConfig(c.rarity);
    if (cfg.chance > 0 && rng() < cfg.chance) {
      p = Math.round(p * cfg.mul);
      crits.push({ cardId: c.id, rarity: c.rarity, mul: cfg.mul });
    }
    sum += p;
  }

  const luckMul = clamp(0.97 + rng() * 0.06, 0.97, 1.03);
  const total = Math.round(sum * luckMul);

  return {
    cards: hand.map((x) => x.id),
    cards_full: hand.map((x) => ({
      id: x.id,
      rarity: x.rarity,
      base_power: x.base_power,
      name: x.name,
      image_url: x.image_url ?? null,
    })),
    baseSum: sum,
    luckMul,
    crits,
    total,
  };
}

/**
 * simulateMatch now builds a timeline for the battle screen.
 * - duration_sec: default 90 (45..120 allowed on UI)
 * - timeline: round_start -> reveal -> score -> round_end -> ... -> match_end
 */
export function simulateMatch(seed: string, p1Deck: Card[], p2Deck: Card[]): MatchLog {
  const rng = mulberry32(seedToInt(seed));

  // 60..90..120, но по умолчанию 90 (как ты хочешь 1:00–1:30)
  const duration_sec = 90;

  const rounds: MatchLog["rounds"] = [];
  const timeline: TimelineEvent[] = [];

  let p1Won = 0;
  let p2Won = 0;

  // Тайминги (секунды). Сделано так, чтобы "что-то происходило" регулярно.
  // Round 1: 0..22, Round 2: 22..44, Round 3: 44..66, затем финал до 90
  const roundStarts = [0, 22, 44];
  const revealDelay = 4; // через 4с показываем карты
  const scoreDelay = 10; // через 10с показываем счет
  const endDelay = 14; // через 14с фиксируем победителя раунда

  for (let r = 0; r < 3; r++) {
    const round = r + 1;

    // safeguards: если колод нет — рулим нулями
    const p1Hand = pickN(rng, p1Deck, Math.min(5, p1Deck.length || 0));
    const p2Hand = pickN(rng, p2Deck, Math.min(5, p2Deck.length || 0));

    const p1 = scoreSide(rng, p1Hand);
    const p2 = scoreSide(rng, p2Hand);

    let winner: "p1" | "p2" | "draw" = "draw";
    if (p1.total > p2.total) winner = "p1";
    else if (p2.total > p1.total) winner = "p2";

    if (winner === "p1") p1Won++;
    if (winner === "p2") p2Won++;

    rounds.push({ p1, p2, winner });

    const baseT = roundStarts[r] ?? (r * 22);

    timeline.push({ t: baseT + 0, type: "round_start", round });

    timeline.push({
      t: baseT + revealDelay,
      type: "reveal",
      round,
      p1_cards: p1.cards,
      p2_cards: p2.cards,
      // future UI
      p1_cards_full: p1.cards_full,
      p2_cards_full: p2.cards_full,
    });

    timeline.push({
      t: baseT + scoreDelay,
      type: "score",
      round,
      p1: p1.total,
      p2: p2.total,
    });

    timeline.push({
      t: baseT + endDelay,
      type: "round_end",
      round,
      winner,
    });

    // best-of-3 early stop
    if (p1Won === 2 || p2Won === 2) break;
  }

  let winner: "p1" | "p2" | "draw" = "draw";
  if (p1Won > p2Won) winner = "p1";
  else if (p2Won > p1Won) winner = "p2";

  // финал в конце, чтобы матч “доживал” до duration_sec
  timeline.push({ t: duration_sec, type: "match_end", winner });

  // нормализуем timeline на всякий случай
  const normalized = timeline
    .map((e) => ({ ...e, t: Number((e as any).t ?? 0) }))
    .filter((e) => Number.isFinite((e as any).t))
    .sort((a, b) => (a.t as number) - (b.t as number));

  return { duration_sec, timeline: normalized, rounds, winner };
}
