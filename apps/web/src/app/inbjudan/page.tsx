import type { Metadata } from "next";
import { InvitationPage } from "../../components/invitation-page";

export const metadata: Metadata = { title: "Inbjudan – O-Tid", robots: { index: false, follow: false } };

/** ADR-0206: länken i inbjudningsmejlet (/inbjudan#token=…). */
export default function InvitationRoute() {
  return <InvitationPage />;
}
