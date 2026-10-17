import {
  requireOwner,
  readAll,
  invalidateManualData,
} from "./manualRepository.js";
async function rpc(name, args = {}) {
  const client = await requireOwner();
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (["PGRST202", "42883"].includes(error.code))
      throw new Error("Activez la mise à jour SQL 006 dans Supabase.");
    throw new Error(error.message || "Opération impossible.");
  }
  return data;
}
export const photoStatus = () => rpc("photo_import_status");
export const listPhotos = () =>
  readAll(
    "photo_import_captures",
    "sha256,filename,proposed,draft,status,revision,match_id,verified_at,updated_at",
    (q) => q.order("created_at"),
  );
export async function photoImage(hash) {
  const client = await requireOwner();
  const { data, error } = await client
    .from("photo_import_captures")
    .select("image_data")
    .eq("sha256", hash)
    .single();
  if (error) throw new Error("Lecture de la capture impossible.");
  return data.image_data;
}
export const stagePhoto = (payload) => rpc("photo_import_stage", { payload });
export const reviewPhoto = (row, draft, verify) =>
  rpc("photo_import_review", {
    image_hash: row.sha256,
    expected_revision: row.revision,
    draft_value: draft,
    mark_verified: verify,
  });
export async function publishPhotos(hashes) {
  const report = await rpc("photo_import_publish", { image_hashes: hashes });
  invalidateManualData();
  return report;
}

export const photoHistory = (hash) =>
  readAll("photo_import_audit", "id,at,before_value,after_value", (q) =>
    q.eq("sha256", hash).order("at", { ascending: false }),
  );
