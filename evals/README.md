# Evaluations

| Command | What it runs | Needs a key |
|---|---|---|
| `npm run eval` | Golden sets: criteria (rules, and AI when keyed), evidence, mediation, injection. Writes `results.json`. | Evidence, mediation and injection sets need `AI_API_KEY`; without it they are marked skipped. |
| `npm run eval:compare` | Same criteria through the PaySettle Criteria Compiler and a plain single-prompt LLM baseline. Writes `compare-results.json`. | The rules side runs without a key. The "rules + AI" side and the baseline need `AI_API_KEY`; without it they are marked `pending: needs AI_API_KEY`. |
| `npm run eval:compare -- --text "…"` | One criterion: verdict, reason and rewrite, printed only. | Rules part: no. |

Both sides of the comparison are scored the same way: precision and recall on the vague class, agreement with the
labels, and whether each rewrite is itself checkable. The rewrite check uses the rule linter (`lintCriterion`). The rules
side wrote its rewrites with the same rules, so for that side the check is a consistency check, not an independent one.

## Adding your own criteria

1. Copy `golden/real-criteria.template.json` to `golden/real-criteria.json`.
2. Delete the three dummy rows. Add one row per criterion: `id` (unique, e.g. `R01`), `text` (the criterion as written,
   with names, amounts and client details removed) and `verifiable` (`true` when a neutral third person could check it
   yes or no from evidence alone, `false` otherwise). `domain` is optional and is not scored.
3. Label each row before you run anything, and do not change a label after seeing a result.
4. Run `npm run eval:compare -- --file evals/golden/real-criteria.json` (set `AI_API_KEY` in `.env.local` for the AI
   side and the baseline). Results go to `evals/compare-results.real-criteria.json`.
5. Decide whether the criteria file and its results should be committed; they are not ignored by git.
