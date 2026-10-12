export function validatePublicConfig(url, key) {
  if (!url && !key) return { configured: false, error: null };
  try {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw new Error();
    if (typeof key !== "string" || !key) throw new Error();
    if (key.startsWith("sb_secret_")) throw new Error();
    if (!key.startsWith("sb_publishable_")) {
      const payload = JSON.parse(
        atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
      );
      if (payload.role !== "anon") throw new Error();
    }
    return { configured: true, error: null };
  } catch {
    return {
      configured: false,
      error:
        "URL HTTPS et clé publique Supabase valides requises. Une clé service_role ou secrète est interdite dans le navigateur.",
    };
  }
}
