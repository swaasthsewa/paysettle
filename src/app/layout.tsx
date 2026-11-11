import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "./globals.css";
import { common } from "@/copy/common";
import { THEME_BOOT } from "@/components/shell/theme";
import { JudgeTour } from "@/components/tour/JudgeTour";
import { scriptNonce } from "@/lib/nonce";

export const metadata: Metadata = { title: { default: common.product, template: `%s · ${common.product}` }, description: common.tagline };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = await scriptNonce(); // the page rules refuse inline scripts without it (src/proxy.ts)
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}
        <JudgeTour launcher={false} />
      </body>
    </html>
  );
}
