import "server-only";
import { createClient } from "@supabase/supabase-js";

// ⚠️ ВАЖНО
// supabaseAdmin используется ТОЛЬКО в server code (API routes, server actions)
// НИКОГДА не импортируй его в client components

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, // можно так, это не секрет
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // секрет
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
