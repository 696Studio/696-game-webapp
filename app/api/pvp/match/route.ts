import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("pvp_matches")
    .select(
      "id,mode,p1_user_id,p2_user_id,winner_user_id,log,status,created_at,rewards_applied"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ match: data ?? null });
}
