/* P10 — sources the sample posts cite. PayPal behaviour is cited to developer.paypal.com pages only
 * (checked 8 November 2026). Each claim that uses one of these in a post carries it in the block's sources[]. */
import type { BlogSource } from "@/lib/blog/blocks";

export const PP_AUTH_CAPTURE: BlogSource = { title: "PayPal Developer — Authorize a payment and capture funds later", url: "https://developer.paypal.com/docs/checkout/standard/customize/authorization/" };
export const PP_HONOR_PERIOD: BlogSource = { title: "PayPal Developer — Authorization and honor period", url: "https://developer.paypal.com/docs/checkout/advanced/authorization-honor/" };
export const PP_DELAYED_DISBURSEMENT: BlogSource = { title: "PayPal Developer — Delay disbursement (multiparty)", url: "https://developer.paypal.com/docs/multiparty/checkout/delayed-disbursement/" };
export const PP_MULTIPARTY: BlogSource = { title: "PayPal Developer — PayPal Platforms overview", url: "https://developer.paypal.com/docs/multiparty/" };
export const PP_IDEMPOTENCY: BlogSource = { title: "PayPal Developer — Idempotency (PayPal-Request-Id)", url: "https://developer.paypal.com/api/rest/reference/idempotency/" };
export const PP_TXN_SEARCH: BlogSource = { title: "PayPal Developer — Transaction Search integration guide", url: "https://developer.paypal.com/docs/transaction-search/" };
export const MCP_SPEC: BlogSource = { title: "Model Context Protocol — Specification", url: "https://modelcontextprotocol.io/specification/2025-06-18" };
