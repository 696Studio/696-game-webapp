export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type MatchRow = {
  id: string;
  mode: string | null;
  p1_user_id: string;
  p2_user_id: string;
  winner_user_id: string | null;
  created_at: string;
  status: string;
  log: any;
  rewards_applied: boolean;
};

type CardMeta = {
  id: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  base_power: number;
  hp?: number;
  initiative?: number;
  ability_id?: string | null;
  ability_params?: any;
  tags?: string[];
  name?: string;
  image_url?: string | null;
};

function parseMaybeJson(v: any) {
  if (v == null) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return v;
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return JSON.parse(s);
      } catch {
        return v;
      }
    }
  }
  return v;
}

function toStringArray(v: any): string[] {
  const raw = parseMaybeJson(v);
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (raw && typeof raw === "object") return Object.values(raw).map((x) => String(x));
  return [];
}

async function loadCardsMeta(cardIds: string[]): Promise<Map<string, CardMeta>> {
  const uniq = Array.from(new Set(cardIds.filter(Boolean).map(String)));
  const map = new Map<string, CardMeta>();
  if (uniq.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("cards")
    .select(
      "id, rarity, base_power, hp, initiative, ability_id, ability_params, tags, name_ru, name_en, image_url"
    )
    .in("id", uniq);

  if (error) throw new Error(error.message);

  for (const c of data ?? []) {
    const id = String((c as any).id);
    map.set(id, {
      id,
      rarity: (String((c as any).rarity || "common").toLowerCase() as any) ?? "common",
      base_power: Number((c as any).base_power || 0),
      hp: (c as any).hp != null ? Number((c as any).hp) : undefined,
      initiative: (c as any).initiative != null ? Number((c as any).initiative) : undefined,
      ability_id: (c as any).ability_id != null ? String((c as any).ability_id) : null,
      ability_params: (c as any).ability_params ?? {},
      tags: Array.isArray((c as any).tags) ? (c as any).tags.map((x: any) => String(x)) : [],
      name:
        ((c as any).name_ru && String((c as any).name_ru).trim()) ||
        ((c as any).name_en && String((c as any).name_en).trim()) ||
        undefined,
      image_url: (c as any).image_url ?? null,
    });
  }

  return map;
}

function buildCardsFull(idsAny: any, meta: Map<string, CardMeta>): CardMeta[] {
  const ids = toStringArray(idsAny);
  return ids.map((id) => {
    const m = meta.get(id);
    return (
      m ?? {
        id,
        rarity: "common",
        base_power: 0,
        name: id ? id : "Card",
        image_url: null,
      }
    );
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { data: match, error } = await supabaseAdmin
      .from("pvp_matches")
      .select("id,mode,p1_user_id,p2_user_id,winner_user_id,log,status,created_at,rewards_applied")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!match) return NextResponse.json({ match: null });

    const logObj = (parseMaybeJson((match as any).log) ?? {}) as any;
    const timeline = Array.isArray(logObj?.timeline) ? logObj.timeline : null;

    // If no timeline — don't simulate here (read-only). Return warning for debug.
    if (!timeline) {
      return NextResponse.json({
        match: { ...(match as any), log: logObj },
        warning: "match.log.timeline is missing. Ensure /api/pvp/enqueue writes expanded timeline.",
      });
    }

    // Ensure reveal contains cards_full for UI
    const needMetaIds: string[] = [];
    for (const e of timeline) {
      if (!e || e.type !== "reveal") continue;

      const hasP1Full = Array.isArray(e.p1_cards_full) && e.p1_cards_full.length > 0;
      const hasP2Full = Array.isArray(e.p2_cards_full) && e.p2_cards_full.length > 0;

      if (!hasP1Full) for (const cid of toStringArray(e.p1_cards)) needMetaIds.push(cid);
      if (!hasP2Full) for (const cid of toStringArray(e.p2_cards)) needMetaIds.push(cid);
    }

    let meta: Map<string, CardMeta> | null = null;
    if (needMetaIds.length) {
      meta = await loadCardsMeta(needMetaIds);
      for (const e of timeline) {
        if (!e || e.type !== "reveal") continue;

        const hasP1Full = Array.isArray(e.p1_cards_full) && e.p1_cards_full.length > 0;
        const hasP2Full = Array.isArray(e.p2_cards_full) && e.p2_cards_full.length > 0;

        if (!hasP1Full) e.p1_cards_full = buildCardsFull(e.p1_cards, meta);
        if (!hasP2Full) e.p2_cards_full = buildCardsFull(e.p2_cards, meta);
      }
    }

    return NextResponse.json({
      match: { ...(match as any), log: { ...logObj, timeline } },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
