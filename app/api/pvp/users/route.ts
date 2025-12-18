import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

function parseIds(param: string | null): string[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ids = parseIds(searchParams.get("ids"));

    if (!ids.length) {
      return NextResponse.json({ users: [] }, { status: 200 });
    }

    const { data, error } = await supabase
      .from("users")
      .select("id, username, first_name, avatar_url")
      .in("id", ids);

    if (error) {
      return NextResponse.json({ error: error.message, users: [] }, { status: 500 });
    }

    return NextResponse.json({ users: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error", users: [] }, { status: 500 });
  }
}
