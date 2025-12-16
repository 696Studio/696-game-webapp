import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function bad(msg: string, code = "BAD_REQUEST", status = 400) {
  return NextResponse.json({ error: msg, code }, { status });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return bad("id required");

  const { data, error } = await supabaseAdmin
    .from("matches")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return bad(error.message, "DB_ERROR", 500);
  return NextResponse.json({ ok: true, match: data });
}
