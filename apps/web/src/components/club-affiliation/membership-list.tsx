"use client";

import { useState } from "react";
import Link from "next/link";
import type { AccountClubMembershipView } from "@o-tid/contracts";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { Button, Notice } from "../ui";
import styles from "./club-affiliation.module.css";

const text = clubAffiliationSv;
export const membershipName = (membership: AccountClubMembershipView) => membership.organisation?.name ?? membership.freeText ?? "";

/** Startar en klubbyta för klubben i listan och går till "Koppla till Eventor" (ADR-0209 beslut E). */
function StartSpace({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function start() {
    setBusy(true); setFailed(false);
    const result = await clubRequest("/api/organizer/clubs", "POST", { formatVersion: 1, requestId: crypto.randomUUID(), name: name.slice(0, 120) });
    if (result.status === 200 || result.status === 201) {
      const clubId = (result.json as { club: { clubId: string } }).club.clubId;
      window.location.assign(`/organizer/clubs/${encodeURIComponent(clubId)}#club`);
      return;
    }
    setBusy(false); setFailed(true);
  }
  return <div className={styles.actions}>
    <Button variant="secondary" disabled={busy} onClick={() => void start()}>{busy ? text.onboarding.starting : text.onboarding.start}</Button>
    {failed && <Notice tone="error" role="alert">{text.onboarding.startFailed}</Notice>}
  </div>;
}

/**
 * Kontots klubbar med läget: bekräftad ("Du är med i …", via Eventor eller av klubben), väntar (och om klubben saknar klubbyta:
 * "Starta klubbytan"), eller inte bekräftad. Ta bort finns när `onRemove` ges.
 */
export function MembershipList({ memberships, onRemove, busy }: { memberships: readonly AccountClubMembershipView[];
  onRemove?: (membership: AccountClubMembershipView) => void; busy?: boolean }) {
  return <ul className={styles.list} data-testid="account-clubs">
    {memberships.map(membership => {
      const name = membershipName(membership);
      const confirmed = membership.status === "CONFIRMED";
      return <li key={membership.membershipId} data-status={membership.status}>
        <div>
          <strong>{confirmed ? text.onboarding.member(membership.clubName ?? name) : name}</strong>
          {confirmed && <span>{membership.via ? text.confirmedVia[membership.via] : text.status.CONFIRMED}</span>}
          {membership.status === "PENDING" && <span>{text.status.PENDING}{membership.organisation && membership.spaceExists ? ` · ${text.onboarding.pendingHelp}` : ""}</span>}
          {membership.status === "DECLINED" && <span>{text.status.DECLINED}</span>}
          {membership.status === "PENDING" && membership.organisation && !membership.spaceExists && <>
            <span data-testid="club-no-space">{text.onboarding.noSpace}</span>
            <StartSpace name={membership.organisation.name} />
          </>}
        </div>
        <div className={styles.actions}>
          {confirmed && membership.clubId && <Link href={`/organizer/clubs/${encodeURIComponent(membership.clubId)}`}>{text.onboarding.open}</Link>}
          {onRemove && <Button variant="secondary" disabled={busy} aria-label={`${text.account.remove}: ${name}`}
            onClick={() => onRemove(membership)}>{text.account.remove}</Button>}
        </div>
      </li>;
    })}
  </ul>;
}
