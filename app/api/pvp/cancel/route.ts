export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const telegramId = body?.telegramId;
    const mode = body?.mode || "unranked";

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

    // Prefer region-aware cancel if your RPC supports it.
    // If it doesn't, fallback to old signature.
    let rpcRes = await supabaseAdmin.rpc("pvp_cancel_queue", {
      p_user_id: userRow.id,
      p_region: mode,
    } as any);

    if (rpcRes.error) {
      rpcRes = await supabaseAdmin.rpc("pvp_cancel_queue", {
        p_user_id: userRow.id,
      } as any);
    }

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: rpcRes.data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
