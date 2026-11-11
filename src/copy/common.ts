/** Shared words of the product shell: one place for every visible string. */
export const common = {
  product: "PaySettle",
  tagline: "Checkable milestone contracts. Money held through PayPal, released on proof.",
  loading: "Loading…",
  notMedical: "",
  nav: { tabs: "Sections", skip: "Skip to content", menu: "Main menu" },
  shell: {
    home: "PaySettle home", menu: "Menu", collapse: "Fold the menu into a rail", expand: "Open the menu",
    search: { label: "Search", placeholder: "Search pages and contracts", hint: "Type to search", none: "Nothing found", open: "Open search", close: "Close search", groups: { pages: "Pages" } },
    theme: { label: "Appearance", light: "Light", dark: "Dark", system: "Device" },
    trail: "You are here", filter: { none: "Nothing matches" },
    footer: { rights: "PaySettle — PayPal AI Hackathon build. Sandbox: no real money moves.", privacy: "Privacy", terms: "Terms" },
  },
  trouble: { title: "Something went wrong", body: "Your money is safe: nothing moves without a signed approval. Try again.", retry: "Try again", home: "Go home" },
  roles: { client: "Client", provider: "Provider", admin: "Platform admin", ops: "Operations", mediator: "Mediator", finance: "Finance", judge: "Judge", marketing: "Growth & marketing" },
} as const;
