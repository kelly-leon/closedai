import { createClient } from "@supabase/supabase-js";

export const supabaseAuthEnabled = process.env.NEXT_PUBLIC_AUTH_MODE === "supabase";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase = supabaseAuthEnabled && url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
