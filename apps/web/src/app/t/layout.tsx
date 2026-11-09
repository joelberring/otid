import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "../../lib/no-index";
import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/** ADR-0186: tävlingssidan indexeras inte (robots-meta; robots.txt och X-Robots-Tag står i `lib/no-index.ts`). */
export const metadata: Metadata = { robots: NO_INDEX_ROBOTS };

/** Idéerna 2026-11-08 (engelska): listorna på besökarens språk. */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}</LanguageProvider>;
}
