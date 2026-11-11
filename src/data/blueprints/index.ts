import { CONSULTING_SPRINT, WEB_MVP, type BlueprintDef } from "./digital";
import { INTERIOR_MILLWORK, CLASSIC_CAR, TELECOM_TOWER, HOME_ROOFING } from "./physical";
import { TRAVEL_TOUR } from "./hybrid";
import { OUTLINE_BLUEPRINTS } from "./outlines";
export type { BlueprintDef } from "./digital";
export { SYSTEM_CLAUSES } from "./system";
/** All blueprints: 7 full + 13 outline. */
export const BLUEPRINTS: BlueprintDef[] = [WEB_MVP, CONSULTING_SPRINT, INTERIOR_MILLWORK, CLASSIC_CAR, TRAVEL_TOUR, TELECOM_TOWER, HOME_ROOFING, ...OUTLINE_BLUEPRINTS];
