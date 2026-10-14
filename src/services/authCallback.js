import { supabase } from "./supabaseClient";

// HashRouter must never see an email-confirmation token as a route.
export async function consumeAuthCallback() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const access = hash.get("access_token"),
    refresh = hash.get("refresh_token");
  const code = query.get("code");
  if (!access && !code && !hash.has("error") && !query.has("error")) return "";
  window.history.replaceState(null, "", `${window.location.pathname}#/arene`);
  if (!supabase)
    return "La connexion au service de comptes n’est pas configurée.";
  try {
    const response =
      access && refresh
        ? await supabase.auth.setSession({
            access_token: access,
            refresh_token: refresh,
          })
        : code
          ? await supabase.auth.exchangeCodeForSession(code)
          : { error: true };
    if (response.error) throw new Error();
    return "";
  } catch {
    return "Le lien de confirmation a expiré ou est invalide. Demande un nouveau lien, ou connecte-toi avec ton mot de passe si ton e-mail est déjà confirmé.";
  }
}
