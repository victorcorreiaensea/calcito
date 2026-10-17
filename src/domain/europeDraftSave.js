import { matchPayload, validateMatch } from "./match.js";
// Save only edited drafts. An error on one fixture must not discard other forms.
export async function saveEuropeanEdits(
  matches,
  edits,
  { save, onSaved = () => {}, onProgress = () => {} },
) {
  const drafts = matches.filter((m) => !m.is_published);
  const result = { total: drafts.length, saved: 0, unchanged: 0, failed: [] };
  for (let index = 0; index < drafts.length; index++) {
    const match = drafts[index],
      form = edits.get(match.id);
    if (!form) {
      result.unchanged++;
      onProgress(index + 1, drafts.length);
      continue;
    }
    try {
      const errors = Object.values(validateMatch(form, false));
      if (!form.updated_at)
        errors.push("Version du match manquante : rechargez les données.");
      if (errors.length) throw new Error(errors.join(" "));
      await save(
        matchPayload({ ...form, expected_updated_at: form.updated_at }, false),
      );
      result.saved++;
      onSaved(match.id);
    } catch (error) {
      result.failed.push({
        id: match.id,
        message: error.message || "Enregistrement non confirmé.",
      });
    }
    onProgress(index + 1, drafts.length);
  }
  return result;
}
