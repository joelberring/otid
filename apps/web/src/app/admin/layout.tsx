import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";
import { SignedInTabBar } from "../../components/app-tabs/signed-in-tab-bar";

/**
 * Idéerna 2026-11-08 (engelska, arbetsytan del för del): arbetsytan på användarens språk. Det som ännu bara finns på svenska
 * visas på svenska.
 * Förslag B (ADR-0227 tillägg): flikraden nertill för inloggade i telefonbredd (`SignedInTabBar`).
 */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}<SignedInTabBar /></LanguageProvider>;
}
