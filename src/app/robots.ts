import type { MetadataRoute } from "next";
/* Crawler rules: the public site and blog are indexable; API routes and the signed-in app are not. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/contracts/", "/admin/", "/ops/", "/finance/", "/marketing/", "/mediator/", "/client/", "/provider/"] }], sitemap: `${base}/sitemap.xml` };
}
