// Presentation state only: no probability, odds, wallet or acceptance calculation.
export const calcitoMoods = Object.freeze({
  scientific: Object.freeze({
    label: "Scientifique",
    emotion: "focused",
    comment: "Je regarde les chiffres. Mon côté supporter attendra son tour.",
  }),
  euphoric: Object.freeze({
    label: "Euphorique",
    emotion: "joyful",
    comment: "Du calme, Calcito… le ballon n’a pas encore parlé !",
  }),
  frustrated: Object.freeze({
    label: "Frustré",
    emotion: "disappointed",
    comment: "Je peux râler, les chiffres ne changent pas pour autant.",
  }),
  suspicious: Object.freeze({
    label: "Méfiant",
    emotion: "curious",
    comment: "Une belle cote ? Laisse-moi d’abord regarder les faits.",
  }),
  passionate: Object.freeze({
    label: "Passionné",
    emotion: "proud",
    comment: "Mon cœur est en tribune, mon modèle garde les pieds sur terre.",
  }),
});
export function calcitoPersonality({
  mood = "scientific",
  verdict = null,
} = {}) {
  if (!Object.hasOwn(calcitoMoods, mood))
    throw Error("Humeur Calcito inconnue.");
  return {
    ...calcitoMoods[mood],
    mood,
    scientificVerdict: verdict,
    emotionalDecision: { status: "development", decision: null, reason: null },
  };
}
