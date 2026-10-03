import type { Metadata } from "next";
import Link from "next/link";
import { sv } from "../i18n/sv";
import "./globals.css";

export const metadata: Metadata = { title: "O-Tid", description: sv.tagline };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sv"><body>
    <header><Link href="/">{sv.appName}</Link> <span aria-hidden="true">·</span> {sv.tagline}</header>
    {children}
  </body></html>;
}
