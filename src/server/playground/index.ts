/** Judge Playground: F5.06 four-quadrant playground, F5.07 time machine, F5.08 chaos injector and reset. Sandbox only (P9). */
export { SCENARIOS, SCENARIO_IDS, FAULTS, injectFault, runAll, runNext, scenarioOf, type Fault, type ScenarioId, type StepOutcome } from "./scenarios";
export { MAX_OFFSET_HOURS, PLAYGROUND_ROLES, SandboxOnly, assertSandbox, checkTravel, createSim, getSim, hoursToDay, resetSim, timeTravel, withSimLock, type SimMode } from "./session";
export { playgroundState, scenarioList, type PlaygroundState } from "./state";
