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

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 500 });
    }
    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // mode stored as region bucket (see enqueue route / RPC)
    const { data: row, error: qErr } = await supabaseAdmin
      .from("pvp_queue")
      .select("status, match_id, updated_at, joined_at, region")
      .eq("user_id", userRow.id)
      .eq("region", mode)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (qErr) {
      return NextResponse.json({ error: qErr.message }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ status: "idle" });
    }

    if (row.status === "matched" && row.match_id) {
      return NextResponse.json({ status: "matched", matchId: row.match_id });
    }

    // ✅ our DB uses queued
    if (row.status === "queued") {
      return NextResponse.json({ status: "queued" });
    }

    if (row.status === "cancelled") {
      return NextResponse.json({ status: "cancelled" });
    }

    return NextResponse.json({ status: row.status || "idle" });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
