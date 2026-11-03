import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { sv } from "../i18n/sv";
import { SiteFooter } from "../components/about/site-footer";
import { Logo } from "../components/brand/logo";
import "../components/ui/tokens.css";
import "./globals.css";

/** Ikonerna ligger bredvid (`favicon.ico`, `icon.svg`, `apple-icon.png`) och manifestet i `manifest.ts`. */
export const metadata: Metadata = { title: sv.appName, applicationName: sv.appName, description: `${sv.appName} – ${sv.tagline}` };

/**
 * PLAN.md steg 46: sidornas CSP har en nonce per förfrågan (`src/proxy.ts`), som Next sätter på sina skript när sidan
 * renderas. En förrenderad sida skulle sakna noncen och inte få köra sina skript, så alla sidor renderas vid förfrågan.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return <html lang="sv"><body>
    <header className="site-header">
      <Link href="/"><Logo size={28} className="site-header-logo" />{sv.appName}</Link>
      <span className="site-header-tagline"><span aria-hidden="true">·</span> {sv.tagline}</span>
    </header>
    {children}
    <SiteFooter />
  </body></html>;
}
