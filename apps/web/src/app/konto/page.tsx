import type { Metadata } from "next";
import { AccountPage } from "../../components/account-page";
import { googleLoginEnabled } from "../../lib/google-login-enabled";

export const metadata: Metadata = { title: "Mitt konto – O-Tid" };
export const dynamic = "force-dynamic";

export default function MyAccountPage() {
  return <AccountPage googleEnabled={googleLoginEnabled()} />;
}
