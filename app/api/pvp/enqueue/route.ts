import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json();
  const telegramId = body?.telegramId;
  const mode = body?.mode || "unranked";
  if (!telegramId)
    return NextResponse.json({ error: "telegramId required" }, { status: 400 });

  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (!userRow)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  // try find opponent
  const { data: opp } = await supabaseAdmin
    .from("pvp_queue")
    .select("id,user_id")
    .eq("status", "queued")
    .eq("mode", mode)
    .neq("user_id", userRow.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!opp) {
    await supabaseAdmin
      .from("pvp_queue")
      .insert({ user_id: userRow.id, mode, status: "queued" });

    return NextResponse.json({ status: "queued" });
  }

  // create match (resolved v1)
  const match = await createResolvedMatch(userRow.id, opp.user_id, mode);

  // ✅ apply rewards ONCE (idempotent)
  await applyRewardsOnce(match.id, match.winner_user_id, match.p1_user_id, match.p2_user_id);

  // mark opponent queue matched
  await supabaseAdmin
    .from("pvp_queue")
    .update({
      status: "matched",
      matched_at: new Date().toISOString(),
      match_id: match.id,
    })
    .in("id", [opp.id]);

  // create current user queue row as matched (keep your behavior)
  await supabaseAdmin.from("pvp_queue").insert({
    user_id: userRow.id,
    mode,
    status: "matched",
    matched_at: new Date().toISOString(),
    match_id: match.id,
  });

  return NextResponse.json({ status: "matched", matchId: match.id });
}

async function createResolvedMatch(p1: string, p2: string, mode: string) {
  // load decks
  const [d1, d2] = await Promise.all([loadDeckPower(p1), loadDeckPower(p2)]);

  const rounds = simulateAutoFight(d1.cards, d2.cards, 3);
  const p1Wins = rounds.filter((r) => r.winner === "p1").length;
  const p2Wins = rounds.filter((r) => r.winner === "p2").length;

  const winner_user_id =
    p1Wins === p2Wins ? null : p1Wins > p2Wins ? p1 : p2;

  const log = { p1: { totalPower: d1.total }, p2: { totalPower: d2.total }, rounds };

  const { data, error } = await supabaseAdmin
    .from("pvp_matches")
    .insert({
      mode,
      p1_user_id: p1,
      p2_user_id: p2,
      winner_user_id,
      log,
      status: "resolved",
      // rewards_applied по умолчанию false в БД
    })
    .select("id, winner_user_id, p1_user_id, p2_user_id")
    .single();

  if (error || !data) throw new Error(error?.message || "Match create failed");
  return data as {
    id: string;
    winner_user_id: string | null;
    p1_user_id: string;
    p2_user_id: string;
  };
}

/**
 * ✅ Idempotent rewards:
 * - We "lock" by flipping rewards_applied=false -> true only once.
 * - If already applied, do nothing.
 */
async function applyRewardsOnce(
  matchId: string,
  winnerUserId: string | null,
  p1: string,
  p2: string
) {
  // 1) atomic-ish guard: update only if rewards_applied=false
  const { data: locked, error: lockErr } = await supabaseAdmin
    .from("pvp_matches")
    .update({ rewards_applied: true })
    .eq("id", matchId)
    .eq("rewards_applied", false)
    .select("id")
    .maybeSingle();

  if (lockErr) {
    // не валим матч из-за награды
    console.error("applyRewardsOnce lock error:", lockErr.message);
    return;
  }

  // if update didn't happen => already paid
  if (!locked) return;

  // 2) decide amounts (v1)
  const WIN = 5;
  const LOSE = 1;
  const DRAW = 2;

  try {
    if (!winnerUserId) {
      // draw
      await Promise.all([
        supabaseAdmin.rpc("inc_hard_balance", { p_user_id: p1, p_amount: DRAW }),
        supabaseAdmin.rpc("inc_hard_balance", { p_user_id: p2, p_amount: DRAW }),
      ]);
      return;
    }

    const loser = winnerUserId === p1 ? p2 : p1;

    await Promise.all([
      supabaseAdmin.rpc("inc_hard_balance", { p_user_id: winnerUserId, p_amount: WIN }),
      supabaseAdmin.rpc("inc_hard_balance", { p_user_id: loser, p_amount: LOSE }),
    ]);
  } catch (e: any) {
    // если rpc упал — логируем. rewards_applied уже true, чтобы не дюпать.
    console.error("applyRewardsOnce payout error:", e?.message || e);
  }
}

async function loadDeckPower(userId: string) {
  const { data: deck } = await supabaseAdmin
    .from("pvp_decks")
    .select("id, pvp_deck_cards(card_id,copies)")
    .eq("user_id", userId)
    .maybeSingle();

  const cardsRows: { card_id: string; copies: number }[] =
    (deck as any)?.pvp_deck_cards ?? [];
  if (!deck || cardsRows.length === 0) return { total: 0, cards: [] as number[] };

  const ids = cardsRows.map((r) => r.card_id);

  // ✅ ВОТ ТУТ ГЛАВНАЯ ПРАВКА: читаем из "cards", а не "pvp_cards"
  const { data: cards } = await supabaseAdmin
    .from("cards")
    .select("id,base_power,rarity")
    .in("id", ids);

  const byId = new Map((cards ?? []).map((c: any) => [c.id, c]));

  // expand to “power list” учитывая copies
  const powerList: number[] = [];
  let total = 0;
  for (const r of cardsRows) {
    const c: any = byId.get(r.card_id);
    const p = Number(c?.base_power || 0);
    const copies = Number(r.copies || 0);
    for (let i = 0; i < copies; i++) powerList.push(p);
    total += p * copies;
  }

  return { total, cards: powerList };
}

function simulateAutoFight(p1: number[], p2: number[], roundsCount: number) {
  const rounds: any[] = [];
  for (let i = 0; i < roundsCount; i++) {
    const a = rollRound(p1);
    const b = rollRound(p2);
    const winner = a === b ? "draw" : a > b ? "p1" : "p2";
    rounds.push({ p1: { total: a }, p2: { total: b }, winner });
  }
  return rounds;
}

function rollRound(list: number[]) {
  // v1: берём случайные 5 “карт” из powerList (без удаления), сумма + лёгкий рандом
  if (!list.length) return 0;
  let sum = 0;
  for (let i = 0; i < 5; i++) sum += list[Math.floor(Math.random() * list.length)] || 0;
  const variance = Math.round(sum * (Math.random() * 0.12 - 0.06)); // +/-6%
  return sum + variance;
}
