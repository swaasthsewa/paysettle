/**
 * Shared helpers for the journeys: demo sign-in (F1.1 sandbox personas, P9; accepts the F1.8 terms handshake when asked), the seeded personas and their homes,
 * and small API helpers for the Judge Playground (F5.06). Requirement ids sit in each spec's test titles (P12).
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { Role } from "../src/db/schema";

export interface Persona { id: string; name: string; role: Role; home: string }
/** The seeded demo people (scripts/seed.ts), one per role at least. */
export const PERSONAS: Persona[] = [
  { id: "u_judge", name: "Hackathon Judge", role: "judge", home: "/playground" },
  { id: "u_priya", name: "Priya Shah", role: "client", home: "/client" },
  { id: "u_dan", name: "Dan Okafor", role: "client", home: "/client" },
  { id: "u_arjun", name: "Arjun Rao", role: "provider", home: "/provider" },
  { id: "u_meera", name: "Meera Iyer", role: "provider", home: "/provider" },
  { id: "u_ops", name: "Olivia Grant", role: "ops", home: "/ops" },
  { id: "u_med", name: "Marcus Bell", role: "mediator", home: "/mediator" },
  { id: "u_med2", name: "Lena Park", role: "mediator", home: "/mediator" },
  { id: "u_fin", name: "Farah Ali", role: "finance", home: "/finance" },
  { id: "u_admin", name: "Alex Chen", role: "admin", home: "/admin" },
  { id: "u_mkt", name: "Maya Lopez", role: "marketing", home: "/marketing" },
];
export const persona = (name: string) => {
  const p = PERSONAS.find((x) => x.name.startsWith(name));
  if (!p) throw new Error(`No persona ${name}`);
  return p;
};

/** Signs in through the "Explore the live demo" picker on /login and waits for the role's home page. */
export async function signIn(page: Page, name: string): Promise<Persona> {
  const p = persona(name);
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`^${p.name}\\b`) }).click();
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30_000 });
  // F1.8 baseline handshake: the first sign-in after a terms version change asks to accept the platform terms
  if (new URL(page.url()).pathname === "/terms-accept") {
    await page.getByRole("checkbox", { name: /accept the platform terms/i }).check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
  }
  await page.waitForURL((u) => u.pathname === p.home, { timeout: 30_000 });
  await expect(page.locator("main#page")).toBeVisible();
  return p;
}

/** Texts of the links in the main menu (sidebar), in order. */
export async function menuLabels(page: Page): Promise<string[]> {
  const labels = await page.locator('nav[aria-label="Main menu"] .navl .nav-label').allTextContents();
  return labels.map((s) => s.trim());
}

export interface SimStep { id: string; label: string; status: string; detail?: string | null }
export interface SimState { sim: { id: string; scenario: string; mode: string } | null; steps: SimStep[]; next: string | null }

/** Starts a playground scenario through the same API the page uses. `request` must carry a Judge (or admin) session. */
export async function startScenario(request: APIRequestContext, id: string): Promise<SimState> {
  const r = await request.post(`/api/sandbox/scenarios/${id}/start`, { data: { mode: "MOCK" } });
  expect(r.ok(), `start ${id}: HTTP ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).state as SimState;
}
/** Runs steps one at a time until `untilStepId` is done (or skipped). */
export async function runUntil(request: APIRequestContext, simId: string, untilStepId: string): Promise<SimState> {
  for (let i = 0; i < 40; i++) {
    const r = await request.post("/api/sandbox/step", { data: { simId } });
    expect(r.ok(), `step: HTTP ${r.status()} ${await r.text()}`).toBeTruthy();
    const st = (await r.json()).state as SimState;
    const s = st.steps.find((x) => x.id === untilStepId);
    if (s && (s.status === "done" || s.status === "skipped")) return st;
    const bad = st.steps.find((x) => x.status === "error" || x.status === "waiting");
    if (bad) throw new Error(`step ${bad.id} is ${bad.status}: ${bad.detail ?? ""}`);
  }
  throw new Error(`step ${untilStepId} never finished`);
}

export const randomEmail = () => `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
