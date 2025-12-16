import crypto from "crypto";

export type Rarity = "common" | "rare" | "epic" | "legendary";

export type Card = {
  id: string;
  rarity: Rarity;
  base_power: number;
};

export type RoundSideLog = {
  cards: string[];
  baseSum: number;
  luckMul: number; // 0.97..1.03
  crits: Array<{ cardId: string; rarity: Rarity; mul: number }>;
  total: number;
};

export type MatchLog = {
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
  // Fisher–Yates shuffle partial
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
    baseSum: sum,
    luckMul,
    crits,
    total,
  };
}

export function simulateMatch(seed: string, p1Deck: Card[], p2Deck: Card[]): MatchLog {
  const rng = mulberry32(seedToInt(seed));

  const rounds: MatchLog["rounds"] = [];
  let p1Won = 0;
  let p2Won = 0;

  for (let r = 0; r < 3; r++) {
    const p1Hand = pickN(rng, p1Deck, Math.min(5, p1Deck.length));
    const p2Hand = pickN(rng, p2Deck, Math.min(5, p2Deck.length));

    const p1 = scoreSide(rng, p1Hand);
    const p2 = scoreSide(rng, p2Hand);

    let winner: "p1" | "p2" | "draw" = "draw";
    if (p1.total > p2.total) winner = "p1";
    else if (p2.total > p1.total) winner = "p2";

    if (winner === "p1") p1Won++;
    if (winner === "p2") p2Won++;

    rounds.push({ p1, p2, winner });

    if (p1Won === 2 || p2Won === 2) break;
  }

  let winner: "p1" | "p2" | "draw" = "draw";
  if (p1Won > p2Won) winner = "p1";
  else if (p2Won > p1Won) winner = "p2";

  return { rounds, winner };
}
