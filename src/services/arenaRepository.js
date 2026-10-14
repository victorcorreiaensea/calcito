import { requireDatabase } from "./supabaseClient";
async function rpc(name, args = {}) {
  const result = await requireDatabase().rpc(name, args);
  if (result.error) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result.data;
}
export const arenaStatus = () => rpc("arena_status");
export const arenaAccount = () => rpc("arena_account");
export const arenaQuote = (id) => rpc("arena_quote", { mid: id });
export const arenaTicket = (selection, amount, mode, odds, nonce) =>
  rpc("arena_place_ticket", {
    selection,
    amount,
    mode,
    offered_odds: odds,
    client_nonce: nonce,
  });
export const arenaMission = (mission, answers) =>
  rpc("arena_claim_mission", { mission, answers });
export const arenaCalibrate = () => rpc("arena_calibrate");
export const arenaCorrectVoid = (id, reason) =>
  rpc("arena_correct_void", { mid: id, reason });
export const arenaAdminLog = () => rpc("arena_admin_log");
export const arenaExport = () => rpc("arena_export");
