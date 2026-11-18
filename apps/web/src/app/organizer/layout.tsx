import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";
import { SignedInTabBar } from "../../components/app-tabs/signed-in-tab-bar";

/**
 * Engelska del 4: arbetsytan för arrangörer (Mina tävlingar, klubbar, grupper och kartprojekt) på besökarens språk.
 * Förslag B (ADR-0227 tillägg): flikraden nertill för inloggade i telefonbredd (`SignedInTabBar`).
 */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}<SignedInTabBar /></LanguageProvider>;
}
