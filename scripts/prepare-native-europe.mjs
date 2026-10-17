// Build a numeric SQL import from the checked, image-free structured JSON.
import fs from "node:fs";
const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const base = read("supabase/migrations/005_europe_preparation.sql")
  .replace(/^BEGIN;\s*$/m, "")
  .replace(/^COMMIT;\s*$/m, "");
const schema = read("supabase/migrations/007_native_match_statistics.sql");
const publicationFix = read(
  "supabase/migrations/008_safe_match_publication.sql",
);
const payload = JSON.parse(
  read("data/imports/europe-2026-match-statistics.json"),
);
if (
  payload.format !== "calcito-match-statistics-v1" ||
  payload.matches.length !== 72
)
  throw new Error("Expected the reviewed 72-match numeric import.");
for (const r of payload.matches) {
  if (
    JSON.stringify(r).includes("image_data") ||
    JSON.stringify(r).includes("data:image/")
  )
    throw new Error("No images permitted.");
}
const bootstrap = `DO $bootstrap$ BEGIN IF to_regclass('public.europe_preparation_runs') IS NULL THEN EXECUTE $previous$${base}$previous$; END IF; END $bootstrap$;\n`;
const sql = `-- CALCITO : relevés numériques, brouillons uniquement. Aucune image stockée.\n-- À exécuter depuis le SQL Editor du projet propriétaire.\n${bootstrap}\n${schema}\n${publicationFix}\nBEGIN;\nDO $owner$ DECLARE uid uuid; n integer; BEGIN\n SELECT count(*),min(user_id::text)::uuid INTO n,uid FROM public.admin_users;\n IF n<>1 THEN RAISE EXCEPTION 'Un seul propriétaire doit être identifié pour ce script. Aucune donnée de match enregistrée.'; END IF;\n PERFORM set_config('request.jwt.claim.sub',uid::text,true);\n PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid::text,'role','authenticated')::text,true);\nEND $owner$;\nSELECT public.import_match_statistics($records$${JSON.stringify(payload)}$records$::jsonb,'europe-2026-captures-72-v1') AS bilan_importation;\nCOMMIT;\n`;
fs.writeFileSync(
  new URL("public/downloads/calcito-statistiques-europe-brouillons.sql", root),
  sql,
);
console.log("Prepared numeric SQL: 72 fixtures; no images, no publication.");
