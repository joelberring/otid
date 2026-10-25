import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { sv } from "../i18n/sv";
import { SiteFooter } from "../components/about/site-footer";
import "../components/ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = { title: "O-Tid", description: sv.tagline };

/**
 * PLAN.md steg 46: sidornas CSP har en nonce per förfrågan (`src/proxy.ts`), som Next sätter på sina skript när sidan
 * renderas. En förrenderad sida skulle sakna noncen och inte få köra sina skript, så alla sidor renderas vid förfrågan.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return <html lang="sv"><body>
    <header><Link href="/">{sv.appName}</Link> <span aria-hidden="true">·</span> {sv.tagline}</header>
    {children}
    <SiteFooter />
  </body></html>;
}
