const DEFAULT_SUPABASE_URL = "https://whairnylpdvxxgbygbzu.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_t5VATQUjIOtHrtK3wFi5Cw_Q088yz0Z";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export function getSupabaseUrl(): string {
  return supabaseUrl;
}

export function getSupabasePublishableKey(): string {
  return supabasePublishableKey;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabasePublishableKey);
}
