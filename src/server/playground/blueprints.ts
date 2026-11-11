/**
 * The blueprints the Judge Playground builds contracts from (scenarios S1–S7 and Pair A vs Pair B). Kept apart from
 * scenarios.ts so the control plane can protect them in the shared demo (dual.ts) without loading the scenario engine.
 * playground.test.ts checks that every scenario's blueprints are listed here.
 */
export const PLAYGROUND_BLUEPRINTS: readonly string[] = ["UC_WEB_MVP", "UC_CLASSIC_CAR", "UC_TRAVEL_TOUR", "UC_INTERIOR_MILLWORK", "UC_CONSULTING_SPRINT"];
