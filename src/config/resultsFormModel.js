// Provisional proposal, versioned separately from the owner's proprietary model.
export const resultsFormModel = Object.freeze({
  version: "results-context-v2",
  weights: Object.freeze({
    result: 55,
    goalDifference: 20,
    defence: 10,
    attack: 5,
    awayResult: 4,
    awayGoals: 3,
    homeCleanSheet: 3,
  }),
  // Away and home bonuses are mutually exclusive: the common upper bound is 97.
  maximum: 97,
});
