import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/** Godkännandet av en AI-koppling på besökarens språk (översynen 2026-11-10, E). */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}</LanguageProvider>;
}
