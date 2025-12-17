export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const telegramId = searchParams.get("telegramId");
    const mode = searchParams.get("mode") || "unranked";

    if (!telegramId) {
      return NextResponse.json({ error: "telegramId required" }, { status: 400 });
    }

    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });
    if (!userRow?.id) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const userId = userRow.id as string;

    // Read latest queue row for this user+mode bucket
    const { data: row, error: qErr } = await supabaseAdmin
      .from("pvp_queue")
      .select("status, match_id, updated_at, joined_at, region")
      .eq("user_id", userId)
      .eq("region", mode)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

    // If queue row says matched — return immediately
    if (row?.status === "matched" && row.match_id) {
      return NextResponse.json({ status: "matched", matchId: row.match_id });
    }

    // Heartbeat while queued (keeps user "alive" in queue)
    if (row?.status === "queued") {
      // NOTE: if your RPC expects region/mode param — add it there.
      await supabaseAdmin.rpc("pvp_queue_heartbeat", { p_user_id: userId });
      return NextResponse.json({ status: "queued" });
    }

    if (row?.status === "cancelled") {
      return NextResponse.json({ status: "cancelled" });
    }

    // ✅ Fallback: sometimes queue row can lag/clear, but match already exists
    // Find latest match involving this user in this mode.
    const { data: matchRow, error: mErr } = await supabaseAdmin
      .from("pvp_matches")
      .select("id, status, mode, created_at, p1_user_id, p2_user_id")
      .or(`p1_user_id.eq.${userId},p2_user_id.eq.${userId}`)
      .eq("mode", mode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!mErr && matchRow?.id) {
      // If match exists, treat as matched (battle page will GET /api/pvp/match?id=...)
      return NextResponse.json({ status: "matched", matchId: matchRow.id });
    }

    // No queue row + no match => idle
    if (!row) return NextResponse.json({ status: "idle" });

    return NextResponse.json({ status: row.status || "idle" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
