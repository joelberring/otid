import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/** Idéerna 2026-11-08 (engelska, del 8): festens sida och QR-skylten på besökarens språk. */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}</LanguageProvider>;
}
