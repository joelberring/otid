import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/** Länksidan för kartprojektet på besökarens språk (som kartritarens sida under `/kartfel`). */
export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}</LanguageProvider>;
}
