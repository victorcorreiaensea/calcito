import { requireOwner, invalidateManualData } from "./manualRepository";
export async function europePreparationStatus() {
  const client = await requireOwner();
  const { data, error } = await client.rpc("europe_preparation_status");
  if (error) throw error;
  return data;
}
export async function prepareEuropeanDrafts(payload, nonce) {
  const client = await requireOwner();
  const { data, error } = await client.rpc("europe_prepare_drafts", {
    payload,
    client_nonce: nonce,
  });
  if (error) {
    const e = new Error(error.message);
    e.code = error.code;
    throw e;
  }
  invalidateManualData();
  return data;
}
