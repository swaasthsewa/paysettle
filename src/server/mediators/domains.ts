/**
 * F4.05 — mediator domains mapped to blueprint verticals (src/data/blueprints: code + vertical). Pure, client-safe.
 * A mediator lists domain keys ("digital") and/or exact blueprint codes ("UC_WEB_MVP"). Domain fit for a case:
 * the exact blueprint code listed → 1.0, the blueprint's domain listed → 0.6, neither → not eligible.
 */
export const DOMAINS = {
  automotive: { label: "Automotive", codes: ["UC_CLASSIC_CAR"] },
  construction: { label: "Construction and engineering", codes: ["UC_HOME_ROOFING", "UC_KITCHEN_REMODEL", "UC_SOLAR_INSTALL", "UC_LANDSCAPING", "UC_EQUIPMENT_RENTAL"] },
  telecom: { label: "Telecom infrastructure", codes: ["UC_TELECOM_TOWER"] },
  interiors: { label: "Interiors and furniture", codes: ["UC_INTERIOR_MILLWORK", "UC_FURNITURE_MFG"] },
  digital: { label: "Digital and code", codes: ["UC_WEB_MVP", "UC_CONSULTING_SPRINT", "UC_APP_LOCALISATION", "UC_DATA_MIGRATION", "UC_VIDEO_POST"] },
  travel: { label: "Travel", codes: ["UC_TRAVEL_TOUR"] },
  events: { label: "Events and logistics", codes: ["UC_EVENT_PRODUCTION", "UC_TRADESHOW_LOGISTICS", "UC_FREIGHT_FORWARDING"] },
  professional: { label: "Professional services and marketing", codes: ["UC_LEGAL_REVIEW", "UC_MARKETING_CAMPAIGN"] },
} as const;
export type DomainKey = keyof typeof DOMAINS;
export const DOMAIN_KEYS = Object.keys(DOMAINS) as DomainKey[];
/** Marker for a mediator from before the network existed: no declared domains, treated as a generalist (category-level fit). */
export const GENERALIST = "*";

export const isDomainKey = (s: string): s is DomainKey => s in DOMAINS;
export function domainOf(blueprintCode: string): DomainKey | null {
  for (const k of DOMAIN_KEYS) if ((DOMAINS[k].codes as readonly string[]).includes(blueprintCode)) return k;
  return null;
}
export const ALL_BLUEPRINT_CODES: string[] = DOMAIN_KEYS.flatMap((k) => [...DOMAINS[k].codes]);

export type FitKind = "exact" | "category" | "generalist" | "none";
export const FIT_VALUE: Record<FitKind, number> = { exact: 1, category: 0.6, generalist: 0.6, none: 0 };

export function domainFit(mediatorDomains: readonly string[], blueprintCode: string): FitKind {
  if (mediatorDomains.includes(blueprintCode)) return "exact";
  const d = domainOf(blueprintCode);
  if (d && mediatorDomains.includes(d)) return "category";
  if (mediatorDomains.includes(GENERALIST)) return "generalist";
  return "none";
}

/** Human label for one stored domain value (key or blueprint code). */
export function domainLabel(v: string, titles: Record<string, string> = {}): string {
  if (v === GENERALIST) return "Generalist";
  if (isDomainKey(v)) return DOMAINS[v].label;
  return titles[v] ?? v;
}

/** Normalised domain list from user input: keeps known keys and UC_ codes, drops everything else, de-duplicated. */
export function cleanDomains(list: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const v = raw.trim();
    if (isDomainKey(v) || ALL_BLUEPRINT_CODES.includes(v)) out.add(v);
  }
  return [...out];
}
