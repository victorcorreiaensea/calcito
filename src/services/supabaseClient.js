import { createClient } from "@supabase/supabase-js";

import { validatePublicConfig } from "../config/publicConfig.js";
export { validatePublicConfig } from "../config/publicConfig.js";
const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
export const databaseConfig = validatePublicConfig(url, key);
export const supabase = databaseConfig.configured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
export function requireDatabase() {
  if (!supabase)
    throw new Error(
      databaseConfig.error ||
        "La base de saisie manuelle n’est pas encore configurée.",
    );
  return supabase;
}
