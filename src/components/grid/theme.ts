/**
 * F5.01 F5.04 — the PaySettle AG Grid theme (AG Grid Community, MIT; no licence key). Built with the Theming API on
 * themeQuartz, with every colour pointing at a token from src/app/globals.css, so dark mode (data-theme="dark" on <html>,
 * or the system setting) follows the app without a second theme. Client-only: import it from client components.
 */
import { AllCommunityModule, ModuleRegistry, themeQuartz, type Theme } from "ag-grid-community";
type Params = typeof themeQuartz extends Theme<infer P> ? Partial<P> : never;

ModuleRegistry.registerModules([AllCommunityModule]);

const base: Params = {
  fontFamily: ["Outfit", "Segoe UI", "system-ui", "-apple-system", "sans-serif"],
  browserColorScheme: "inherit",
  accentColor: "var(--g1)",
  backgroundColor: "var(--card)",
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--ink-3)",
  borderColor: "var(--line)",
  chromeBackgroundColor: "var(--sunken)",
  headerBackgroundColor: "var(--sunken)",
  headerTextColor: "var(--ink-2)",
  headerFontWeight: 600,
  headerFontSize: 12.5,
  fontSize: 14,
  dataFontSize: 13.5,
  rowHoverColor: "color-mix(in srgb, var(--g1) 6%, transparent)",
  selectedRowBackgroundColor: "color-mix(in srgb, var(--g1) 12%, transparent)",
  pinnedRowBackgroundColor: "var(--sunken)",
  pinnedRowFontWeight: 600,
  wrapperBorderRadius: 14,
  borderRadius: 8,
  iconColor: "var(--ink-3)",
  menuBackgroundColor: "var(--card)",
  tooltipBackgroundColor: "var(--ink)",
  tooltipTextColor: "var(--card)",
  columnBorder: false,
  headerColumnResizeHandleColor: "var(--line-2)",
  focusShadow: { radius: 0, spread: 2, color: "color-mix(in srgb, var(--g1) 55%, transparent)" },
};

/** Comfortable (default) and compact densities; the table toolbar switches between them. */
export const psTheme = themeQuartz.withParams({ ...base, spacing: 8, rowHeight: 44, headerHeight: 42 });
export const psThemeCompact = themeQuartz.withParams({ ...base, spacing: 5, rowHeight: 32, headerHeight: 34, dataFontSize: 12.5 });
