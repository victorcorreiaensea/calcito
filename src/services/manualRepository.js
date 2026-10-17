import { databaseRequest } from "./databaseRequest.js";
import { supabase, requireDatabase } from "./supabaseClient.js";

export async function readAll(
  table,
  columns = "*",
  decorate = (query) => query,
) {
  const client = requireDatabase();
  const data = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const result = await databaseRequest(
      decorate(client.from(table).select(columns)).range(offset, offset + 999),
    );
    if (result.error) {
      const error = new Error(
        "Lecture des données impossible. Vérifiez la connexion et la configuration de la base.",
      );
      error.code = result.error.code;
      throw error;
    }
    data.push(...result.data);
    if (result.data.length < 1000) return data;
  }
  throw new Error(
    "Cette liste dépasse la limite de chargement. Réduisez la période avant de poursuivre.",
  );
}
let pending = null,
  cached = null,
  dataGeneration = 0;
export function invalidateManualData() {
  dataGeneration++;
  cached = null;
  pending = null;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("calcito:data-changed"));
}
export async function getDataset() {
  if (cached && Date.now() - cached.at < 30000) return cached.value;
  if (pending) return pending;
  const generation = dataGeneration;
  const task = (async () => {
    const [
      competitions,
      seasons,
      teams,
      members,
      matches,
      stats,
      forms,
      predictions,
      simplified,
    ] = await Promise.all([
      readAll("competitions", "*", (q) => q.order("name")),
      readAll("seasons", "*", (q) =>
        q.order("start_year", { ascending: false }),
      ),
      readAll("teams", "*", (q) => q.order("name")),
      readAll("season_teams"),
      readAll("matches", "*", (q) => q.order("kickoff", { ascending: false })),
      readAll("match_team_stats"),
      readAll("form_snapshots", "*", (q) =>
        q.order("calculated_at", { ascending: false }),
      ),
      readAll("prediction_history"),
      readAll("simplified_results", "*", (q) =>
        q.order("kickoff", { ascending: false }),
      )
        .then((rows) => ({ rows, ready: true }))
        .catch((error) => {
          if (["42P01", "PGRST205"].includes(error.code))
            return { rows: [], ready: false };
          throw error;
        }),
    ]);
    if (generation !== dataGeneration)
      throw new Error(
        "La session ou les données ont changé. Rechargez la page.",
      );
    const value = {
      competitions,
      seasons,
      teams,
      members,
      matches,
      stats,
      forms,
      predictions,
      simplified: simplified.rows,
      simplifiedReady: simplified.ready,
    };
    cached = { at: Date.now(), value };
    return value;
  })().finally(() => {
    if (pending === task) pending = null;
  });
  pending = task;
  return task;
}
export async function requireOwner() {
  const client = requireDatabase();
  const { data, error } = await databaseRequest(
    client.rpc("is_calcito_admin"),
    15000,
  );
  if (error) {
    const failure = translateError(error);
    failure.code = error.code;
    throw failure;
  }
  if (data !== true) {
    const denied = new Error("Accès réservé au compte administrateur.");
    denied.code = "42501";
    throw denied;
  }
  return client;
}
export async function saveMatch(payload, { timeoutMs } = {}) {
  const client = await requireOwner();
  if (
    ["home_stats", "away_stats"].some((side) =>
      [
        "corners",
        "passes_completed",
        "passes_attempted",
        "pass_accuracy",
        "yellow_cards",
        "red_cards",
      ].some((key) => payload[side]?.[key] != null),
    )
  ) {
    const readiness = await client.rpc("statistics_storage_status");
    if (readiness.error)
      throw new Error(
        "Installez la mise à jour SQL des statistiques pour conserver les nouvelles statistiques.",
      );
  }
  let request = client.rpc("save_match", { payload });
  if (timeoutMs) request = request.abortSignal(AbortSignal.timeout(timeoutMs));
  const { data, error } = await request;
  if (error) {
    const translated = translateError(error);
    translated.code = error.code;
    throw translated;
  }
  invalidateManualData();
  return data;
}

export async function publishDraft(item) {
  if (
    !["matches", "simplified_results"].includes(item.table) ||
    !item.expectedUpdatedAt
  )
    throw new Error("Prévisualisation invalide : rechargez les brouillons.");
  const client = await requireOwner();
  const patch =
    item.table === "matches"
      ? { is_published: true, verified_at: new Date().toISOString() }
      : { is_published: true };
  let query = client
    .from(item.table)
    .update(patch)
    .eq("id", item.id)
    .eq("is_published", false)
    .eq("updated_at", item.expectedUpdatedAt);
  if (item.table === "simplified_results")
    query = query.is("converted_at", null);
  const { data, error } = await databaseRequest(query.select("id"));
  if (error) {
    const translated = translateError(error);
    translated.code = error.code;
    throw translated;
  }
  invalidateManualData();
  return data.map((row) => row.id);
}
export function translateError(error) {
  if (
    error.code === "21000" &&
    /UPDATE requires a WHERE clause/i.test(error.message || "")
  )
    return new Error(
      "Correctif SQL de publication requis (21000). La protection de la base bloque une mise à jour interne sans filtre. Installez le correctif de publication, puis rechargez les statuts.",
    );
  if (
    error.code === "P0001" &&
    error.message === "La date ne correspond pas à la saison sélectionnée."
  )
    return new Error(error.message);
  if (
    error.code === "P0001" &&
    /conversion|converti|adversaire/i.test(error.message)
  )
    return new Error(error.message);
  if (error.code === "23505")
    return new Error(
      "Ce match ou cet identifiant existe déjà. Vérifiez la date et les équipes.",
    );
  if (error.code === "23503")
    return new Error(
      "Équipes participantes ou références incompatibles. Vérifiez la saison.",
    );
  if (error.code === "40001")
    return new Error(
      "Les données ont été modifiées ailleurs. Rechargez avant d’enregistrer.",
    );
  if (["42501", "PGRST301"].includes(error.code))
    return new Error(
      "Opération non autorisée. Reconnectez-vous avec le compte administrateur.",
    );
  if (["23514", "22P02", "22003", "23502"].includes(error.code))
    return new Error(
      "Une donnée ne respecte pas les contraintes : champs requis, valeurs numériques, équipes ou publication.",
    );
  if (
    error.code === "57014" ||
    /abort|timeout|fetch/i.test(error.message || "")
  )
    return new Error(
      "La connexion ou le délai de réponse a interrompu la demande. Rechargez les statuts pour vérifier si elle a abouti.",
    );
  const diagnostic = [error.code, error.message].filter(Boolean).join(" : ");
  return new Error(
    "Supabase a refusé l’opération" +
      (diagnostic
        ? ` (${diagnostic.slice(0, 600)})`
        : ". Erreur sans détail renvoyé") +
      ". Les données saisies sont conservées.",
  );
}
export async function mutate(table, action, payload, id) {
  const allowed = new Set([
    "teams",
    "competitions",
    "seasons",
    "season_teams",
    "matches",
    "simplified_results",
  ]);
  if (!allowed.has(table))
    throw new Error("Cette table ne peut pas être modifiée ici.");
  const client = await requireOwner();
  let query = client.from(table);
  if (action === "insert") query = query.insert(payload);
  else if (action === "upsert") query = query.upsert(payload);
  else if (action === "update") query = query.update(payload).eq("id", id);
  else if (action === "delete") query = query.delete().eq("id", id);
  else throw new Error("Action invalide.");
  const { error } = await query;
  if (error) throw translateError(error);
  invalidateManualData();
}
export async function setParticipants(seasonId, participants) {
  const client = await requireOwner();
  const { error } = await client.rpc("replace_season_teams", {
    target_season: seasonId,
    participants,
  });
  if (error) throw translateError(error);
  invalidateManualData();
}
export function hasDatabase() {
  return Boolean(supabase);
}

export async function saveSimplified(payload) {
  const client = await requireOwner();
  const { data, error } = await client.rpc("save_simplified_result", {
    payload,
  });
  if (error) throw translateError(error);
  invalidateManualData();
  return data;
}
