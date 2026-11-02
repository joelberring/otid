import type { Metadata } from "next";
import { EmailVerification } from "../../components/email-verification";

export const metadata: Metadata = { title: "Bekräfta e-postadressen – O-Tid", robots: { index: false, follow: false } };

/** ADR-0186: länken i bekräftelsemejlet (/verify#token=…). */
export default function VerifyPage() {
  return <EmailVerification />;
}
