import { existsSync, readFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * Other addresses a page's own code may send data to, read when the site is built: a list in `csp-connect.json`
 * beside this file (the public edition has none), and CSP_CONNECT_EXTRA (space-separated) for a developer's own
 * build. Only https addresses with no path, or http on this machine, are taken; anything else is left out.
 */
function extraConnect(): string[] {
  const fromFile = existsSync("csp-connect.json") ? (JSON.parse(readFileSync("csp-connect.json", "utf8")) as unknown) : [];
  const listed = [...(Array.isArray(fromFile) ? fromFile : []), ...(process.env.CSP_CONNECT_EXTRA ?? "").split(/\s+/)];
  return listed.filter((o): o is string => typeof o === "string" && /^(https:\/\/[a-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost):\d{2,5})$/.test(o));
}

/**
 * Sent with every answer. They close ways in from outside, and one of them limits where a page may send data.
 *  - nosniff: a browser never guesses a file's type
 *  - frame rules: no other site can show PaySettle inside a frame and trick a click
 *  - base-uri, form-action, object-src: a page cannot be pointed at another site's base, forms or plug-ins
 *  - connect-src: a page's own code can send data only to this site (and any address listed as below)
 *  - referrer: other sites learn the site's address, never the page a person was on
 *  - permissions: the camera is for PaySettle's own pages only (live evidence capture); the rest stay off
 *  - transport security: a browser that has seen the site over https never goes back to http
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: `frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; connect-src ${["'self'", "blob:", "data:", ...extraConnect()].join(" ")}` },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  /* lets the dev server be opened as 127.0.0.1 as well as localhost */
  allowedDevOrigins: ["127.0.0.1"],
  /* A container build sets NEXT_OUTPUT=standalone, which writes a self-contained server to .next/standalone. */
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  /* pdfkit loads its standard fonts from disk through subpath requires; keep it out of the server bundle. */
  serverExternalPackages: ["pdfkit"],
  /* NEXT_BUILD_CPUS caps the build's worker processes, each with its own heap (the container build sets it). */
  experimental: { serverActions: { bodySizeLimit: "16mb" }, ...(process.env.NEXT_BUILD_CPUS ? { cpus: Number(process.env.NEXT_BUILD_CPUS) } : {}) },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
