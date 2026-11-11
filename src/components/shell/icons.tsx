/**
 * The small line pictures beside the menu's links, so the menu can fold to a rail of pictures (components/shell/rail.tsx).
 * One picture for each kind of page, picked by the link's address; an address with none of its own gets a dot.
 * Drawn in the text colour, 20 by 20, stroke only.
 */
const P: Record<string, string> = {
  today: "M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
  test: "M5 4h14v16H5zM9 8h6M10 12h4M11 16h2",
  screening: "M8 4h8v3H8zM6 6H5v14h14V6h-1M9 13l2 2 4-4",
  clips: "M4 7h16v10H4zM4 10h16M8 7v3M12 7v3M16 7v3",
  setup: "M5 7h9M18 7h1M5 17h3M12 17h7M14 5v4M8 15v4",
  games: "M7 9h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1 1.8A3 3 0 0 1 3 14v-1a4 4 0 0 1 4-4ZM8 11v3M6.5 12.5h3M16 12h.01M18 13.5h.01",
  exercises: "M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0M12 12h.01",
  cinema: "M4 6h16v12H4zM10 9.5v5l4-2.5z",
  learn: "M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5ZM12 6v13.5",
  fine: "M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM14.5 14.5 19 19",
  journey: "M5 19c3 0 3-4 7-4s4-4 7-4M5 19h.01M19 11h.01M12 15h.01",
  together: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M16 11a2.5 2.5 0 1 0 0-5M17 14c2 .4 3.3 2.2 3.6 5",
  league: "M8 4h8v5a4 4 0 0 1-8 0ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4",
  family: "M4 11 12 5l8 6M6 10v9h12v-9M10 19v-5h4v5",
  circle: "M12 19s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 4.6-7 9-7 9Z",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8",
  admin: "M12 3 5 6v5c0 4.4 3 8 7 10 4-2 7-5.6 7-10V6Z",
  advisor: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM5 20c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5M15.5 16.5l1.5 1.5 3-3",
  sponsor: "M4 12l4-4 4 3 4-3 4 4-8 7Z",
  profile: "M4 6h16v12H4zM9 10.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6M6.5 15c.5-1.5 1.4-2.3 2.5-2.3s2 .8 2.5 2.3M14 9h4M14 12h4",
  switch: "M7 7h11l-3-3M17 17H6l3 3",
  kids: "M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8Z",
  leave: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 8v4.5l3 2",
  screen: "M4 5h16v11H4zM9 20h6M12 16v4",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14",
  person: "M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM5 20c.9-3.6 3.8-5.5 7-5.5s6.1 1.9 7 5.5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  badge: "M5 5h14v14H5zM12 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8.5 16c.6-1.5 2-2.3 3.5-2.3s2.9.8 3.5 2.3",
  inbox: "M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5",
  list: "M9 7h11M9 12h11M9 17h11M4.5 6.5l1 1 1.5-2M4.5 11.5l1 1 1.5-2M4.5 16.5l1 1 1.5-2",
  book: "M6 4h11a1 1 0 0 1 1 1v15H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1ZM5 18a2 2 0 0 1 2-2h11M9 8h6",
  flask: "M10 4h4M11 4v5l-5.5 9.5A1 1 0 0 0 6.4 20h11.2a1 1 0 0 0 .9-1.5L13 9V4M8 15h8",
  pen: "M15.5 5.5l3 3L9 18l-4 1 1-4ZM13.5 7.5l3 3",
  flag: "M6 20V4M6 5h10l-2 3.5 2 3.5H6",
  warning: "M12 4 3 19h18ZM12 10v4M12 16.5h.01",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  toggles: "M8 5h8a3 3 0 0 1 0 6H8a3 3 0 0 1 0-6ZM8 13h8a3 3 0 0 1 0 6H8a3 3 0 0 1 0-6ZM15 8h.01M9 16h.01",
  palette: "M12 4a8 8 0 0 0 0 16c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.5 0-.8.6-1.3 1.4-1.3H16a4 4 0 0 0 4-4c0-3.6-3.6-6.5-8-6.5ZM8 11h.01M10.5 7.5h.01M15 7.5h.01",
  glasses: "M3 10h18M5 10a3 3 0 1 0 6 0M13 10a3 3 0 1 0 6 0M11 10.5c.6-.4 1.4-.4 2 0",
  team: "M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 19c.6-3 2.8-5 5.5-5 1.6 0 3 .7 4 1.8M18 13v6M15 16h6",
  chart: "M5 19V5M5 19h14M9 15v-4M13 15V8M17 15v-6",
  calendar: "M5 6h14v13H5zM5 10h14M9 4v4M15 4v4M8.5 14h2M13.5 14h2",
  chat: "M5 6h14v9H10l-4 3.5V15H5z",
  doc: "M7 4h7l4 4v12H7zM14 4v4h4M10 12h5M10 15.5h5",
  spark: "M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8Z",
  phone: "M8 3.5h8v17H8zM11 17.5h2",
  text: "M5 6h14M5 10h14M5 14h9M5 18h6",
  map: "M4 6.5 9 5l6 2 5-1.5V18l-5 1.5-6-2-5 1.5ZM9 5v12.5M15 7v12.5",
  dot: "M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
};

/** The picture for a link, by its address. The longest known start of the address wins. */
const BY_PATH: [string, keyof typeof P][] = [
  ["/client/contracts", "doc"], ["/client/new", "pen"], ["/client/disputes", "flag"], ["/client/receipts", "list"], ["/client", "today"],
  ["/provider/contracts", "doc"], ["/provider/payouts", "chart"], ["/provider/onboarding", "setup"], ["/provider", "today"],
  ["/blueprints", "book"], ["/contracts", "doc"],
  ["/ops/clearance", "inbox"], ["/ops/radar", "clock"], ["/ops/providers", "badge"], ["/ops", "grid"],
  ["/mediator/cases", "flag"], ["/mediator", "advisor"],
  ["/finance/ledger", "list"], ["/finance/recon", "chart"], ["/finance/fees", "toggles"], ["/finance", "chart"],
  ["/admin/webhooks", "inbox"], ["/admin/audit", "admin"], ["/admin/dual-control", "team"], ["/admin/flags", "toggles"], ["/admin", "grid"],
  ["/marketing/blueprints", "book"], ["/marketing", "spark"],
  ["/playground", "flask"], ["/settings", "settings"], ["/account", "person"], ["/notifications", "bell"], ["/login", "switch"],
];

export function iconFor(href: string): string {
  const hit = BY_PATH.filter(([p]) => href === p || href.startsWith(p + "/")).sort((a, b) => b[0].length - a[0].length)[0];
  return P[hit?.[1] ?? "dot"];
}

export function NavIcon({ href }: { href: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d={iconFor(href)} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
