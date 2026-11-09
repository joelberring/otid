import type { Metadata } from "next";
import { EmailVerification } from "../../components/email-verification";
import { LanguageProvider } from "../../components/language-provider";
import { accountEntryEn } from "../../i18n/account-en";
import { accountSv } from "../../i18n/account-sv";
import { currentLanguage } from "../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const title = await currentLanguage() === "en" ? accountEntryEn.verify.title : accountSv.verify.title;
  return { title: `${title} – O-Tid`, robots: { index: false, follow: false } };
}

/** ADR-0186: länken i bekräftelsemejlet (/verify#token=…). Engelska del 4: på besökarens språk. */
export default async function VerifyPage() {
  return <LanguageProvider language={await currentLanguage()}><EmailVerification /></LanguageProvider>;
}
