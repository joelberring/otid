import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/**
 * Idéerna 2026-11-08 (engelska, arbetsytan del för del): arbetsytan på användarens språk. Det som ännu bara finns på svenska
 * visas på svenska.
 */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}</LanguageProvider>;
}
