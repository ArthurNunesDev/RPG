import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

function isValidSupabaseUrl(value) {
  if (!value) return false;

  try {
    const url = new URL(value);
    const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);

    return (
      ["https:", "http:"].includes(url.protocol) &&
      (isLocalhost || url.hostname.endsWith(".supabase.co"))
    );
  } catch {
    return false;
  }
}

export const isSupabaseConfigured =
  isValidSupabaseUrl(supabaseUrl) &&
  Boolean(supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;
