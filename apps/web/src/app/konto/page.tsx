import type { Metadata } from "next";
import { AccountPage } from "../../components/account-page";
import { googleLoginEnabled } from "../../lib/google-login-enabled";
import { accountPageEn } from "../../i18n/account-en";
import { accountSv } from "../../i18n/account-sv";
import { currentLanguage } from "../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await currentLanguage() === "en" ? accountPageEn.me.title : accountSv.me.title} – O-Tid` };
}
export const dynamic = "force-dynamic";

export default function MyAccountPage() {
  return <AccountPage googleEnabled={googleLoginEnabled()} />;
}
