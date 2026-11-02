import {createClient, type SupabaseClient} from "@supabase/supabase-js";

/** Service-role client. Server-only: bypasses RLS, so never import this from client components. */
export function supabaseService(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("supabaseService() must only run on the server");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment not configured");
  return createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
}
