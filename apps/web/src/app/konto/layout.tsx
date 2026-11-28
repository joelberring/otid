import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";
import { SignedInShell } from "../../components/app-tabs/signed-in-shell";

/**
 * Engelska del 7: Mitt konto och kontomenyn på besökarens språk.
 * Steg F1: det inloggade skalet (vänstermenyn på datorn, sidhuvudet och flikraden i telefonen), `SignedInShell`.
 */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}><SignedInShell>{children}</SignedInShell></LanguageProvider>;
}
