import type { Metadata } from "next";
import { AccountPage } from "../../components/account-page";

export const metadata: Metadata = { title: "Mitt konto – O-Tid" };

export default function MyAccountPage() {
  return <AccountPage />;
}
