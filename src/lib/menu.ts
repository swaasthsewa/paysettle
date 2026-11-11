/** One menu list per role, so the sidebar, the rail and the search never disagree (see REUSE.md). */
import type { NavItem } from "@/components/nav";
import type { Role } from "@/db/schema";
export interface MenuGroup { title: string; items: NavItem[]; icon?: string }

const BY_ROLE: Record<Role, MenuGroup[]> = {
  client: [
    { title: "Work", items: [{ href: "/client", label: "Overview" }, { href: "/client/new", label: "New contract" }, { href: "/client/contracts", label: "Contracts" }] },
    { title: "Money", items: [{ href: "/client/disputes", label: "Disputes" }, { href: "/client/receipts", label: "Receipts" }] },
    { title: "Explore", items: [{ href: "/blueprints", label: "Blueprints" }] },
  ],
  provider: [
    { title: "Work", items: [{ href: "/provider", label: "Overview" }, { href: "/provider/contracts", label: "Contracts" }] },
    { title: "Money", items: [{ href: "/provider/payouts", label: "Payouts" }, { href: "/disputes", label: "Disputes" }, { href: "/provider/onboarding", label: "Onboarding & PayPal" }] },
    { title: "Explore", items: [{ href: "/blueprints", label: "Blueprints" }] },
  ],
  admin: [{ title: "Platform", items: [{ href: "/admin", label: "Health" }, { href: "/admin/webhooks", label: "Webhooks & DLQ" }, { href: "/admin/audit", label: "Audit chain" }, { href: "/admin/dual-control", label: "Four-eyes queue" }, { href: "/admin/flags", label: "Switchboard" }, { href: "/admin/identities", label: "Identity auditor" }, { href: "/ops/representments", label: "PayPal disputes" }, { href: "/finance/compliance", label: "Compliance" }, { href: "/marketing/blog", label: "Blog studio" }, { href: "/playground", label: "Judge Playground" }] }],
  ops: [{ title: "Operations", items: [{ href: "/ops", label: "Overview" }, { href: "/ops/clearance", label: "Contract clearance" }, { href: "/ops/radar", label: "Hold-expiry radar" }, { href: "/ops/providers", label: "Provider health" }, { href: "/ops/mediators", label: "Mediator network" }, { href: "/ops/representments", label: "PayPal disputes" }, { href: "/admin/identities", label: "Identity auditor" }, { href: "/admin/dual-control", label: "Four-eyes queue" }, { href: "/disputes", label: "Disputes" }] }],
  mediator: [{ title: "Disputes", items: [{ href: "/mediator", label: "Overview" }, { href: "/mediator/cases", label: "Case queue" }, { href: "/mediator/schedule", label: "Schedule" }, { href: "/mediator/profile", label: "My profile & credentials" }, { href: "/admin/dual-control", label: "Four-eyes queue" }] }],
  finance: [{ title: "Finance", items: [{ href: "/finance", label: "Overview" }, { href: "/finance/ledger", label: "Ledger" }, { href: "/finance/recon", label: "Reconciliation" }, { href: "/finance/fees", label: "Fee schedule" }, { href: "/ops/mediators", label: "Mediator fees" }, { href: "/finance/compliance", label: "Compliance" }, { href: "/admin/dual-control", label: "Four-eyes queue" }] }],
  judge: [{ title: "Judge", items: [{ href: "/playground", label: "Playground" }, { href: "/blueprints", label: "Blueprints" }] }],
  marketing: [{ title: "Growth", items: [{ href: "/marketing", label: "Funnel" }, { href: "/marketing/blueprints", label: "Blueprint studio" }, { href: "/marketing/blog", label: "Blog studio" }] }],
};

export function menuGroups(role: Role, demo: boolean): MenuGroup[] {
  const g = [...BY_ROLE[role]];
  g.push({ title: "You", icon: "/account", items: [{ href: "/account", label: "Account & security" }, { href: "/account/ai", label: "AI & agents" }, ...(demo ? [{ href: "/login", label: "Switch person" }] : []), { href: "/logout", label: "Sign out" }] });
  return g;
}
export const menuPages = (role: Role) => BY_ROLE[role].flatMap((g) => g.items);
