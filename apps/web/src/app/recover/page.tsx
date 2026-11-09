import { PasswordReset } from "../../components/password-reset";
import { LanguageProvider } from "../../components/language-provider";
import { currentLanguage } from "../../lib/language-server";

/** Glömt lösenordet och länken i mejlet (/recover#token=…). Engelska del 4: på besökarens språk. */
export default async function RecoverPage() {
  return <LanguageProvider language={await currentLanguage()}><PasswordReset /></LanguageProvider>;
}
