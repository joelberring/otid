import type { Metadata } from "next";
import Link from "next/link";
import { sv } from "../i18n/sv";
import { accountSv } from "../i18n/account-sv";
import "../components/ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = { title: "O-Tid", description: sv.tagline };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sv"><body>
    <header><Link href="/">{sv.appName}</Link> <span aria-hidden="true">·</span> {sv.tagline}</header>
    {children}
    <footer className="site-footer"><Link href="/integritet">{accountSv.footerPrivacy}</Link></footer>
  </body></html>;
}
