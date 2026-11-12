"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { accessSv } from "../../i18n/access-sv";
import { accessEn } from "../../i18n/access-en";
import { accessSituation, type AccessSituation } from "../../lib/access-situation";
import { parseOrganizerSessionStatus } from "../../lib/organizer-client";
import { useTexts } from "../language-provider";
import { VerifyEmailOffer } from "../verify-email-offer";

/**
 * Användartestet 2026-11-12: när tävlingens sida nekas sägs varför. Inte inloggad ger "Logga in";
 * inloggad utan behörighet säger vem man är inloggad som; obekräftad adress erbjuder bekräftelsemejlet.
 */
export function AccessNotice() {
  const text = useTexts(accessSv, accessEn);
  const [situation, setSituation] = useState<AccessSituation>();
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" });
        setSituation(accessSituation(response.ok ? parseOrganizerSessionStatus(await response.json() as unknown) : undefined));
      } catch { setSituation({ kind: "signed-out" }); }
    })();
  }, []);
  if (!situation) return <p role="status">{text.checking}</p>;
  if (situation.kind === "signed-out") return <div role="status" data-testid="access-signed-out">
    <p>{text.signedOut}</p>
    <p><Link href="/organizer" prefetch={false}>{text.signIn}</Link></p>
  </div>;
  if (situation.kind === "unverified") return <div role="status" data-testid="access-unverified">
    <p>{text.unverified(situation.email)}</p>
    <VerifyEmailOffer email={situation.email} />
  </div>;
  return <div role="status" data-testid="access-denied">
    <p>{text.noAccess(situation.email)}</p>
    <p>{text.noAccessHelp} <Link href="/organizer" prefetch={false}>{text.myRaces}</Link></p>
  </div>;
}
