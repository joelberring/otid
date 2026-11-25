import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/** Publik layout för `/kartbank` med besökarens språk (svenska/engelska), ingen inloggning krävs. */
export default async function KartbankLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <LanguageProvider language={await currentLanguage()}>{children}</LanguageProvider>;
}
