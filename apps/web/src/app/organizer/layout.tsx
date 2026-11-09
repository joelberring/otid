import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/** Engelska del 4: arbetsytan för arrangörer (Mina tävlingar, klubbar, grupper och kartprojekt) på besökarens språk. */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}</LanguageProvider>;
}
