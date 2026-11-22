"use client";

import { SUPERADMIN_NEAR_LIMIT_SHARE, type SuperadminOverview } from "@o-tid/contracts";
import { superadminEn } from "../../i18n/superadmin-en";
import { superadminSv } from "../../i18n/superadmin-sv";
import { useTexts } from "../language-provider";
import { Button, EmptyState, Table } from "../ui";
import type { PendingAction } from "./superadmin-action-panel";
import styles from "../account-pages.module.css";

/**
 * PLAN.md steg M7 (ägaren 2026-11-22): klubbarnas lagring på superadminsidan. Klubbarkivet räknas mot klubben (förval 2 048 MB);
 * «Gräns» öppnar samma bekräftelse med skäl som kontots gränser, tomt fält = förvalet.
 */
export function SuperadminClubs({ limits, busy, onChange }: {
  limits: SuperadminOverview["limits"]; busy: boolean; onChange: (action: PendingAction) => void;
}) {
  const all = useTexts(superadminSv, superadminEn);
  const text = all.clubs;
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  return <div className={styles.panel} aria-labelledby="superadmin-clubs-title">
    <h3 id="superadmin-clubs-title">{text.title}</h3>
    <p className={styles.muted}>{text.help(limits.defaultClubMapQuotaMb)}</p>
    {limits.clubs.length === 0 ? <EmptyState title={text.empty} /> : <Table aria-label={text.title}>
      <thead><tr><th>{text.columns.club}</th><th>{text.columns.storage}</th><th>{text.columns.own}</th><th>{all.columns.status}</th>
        <th>{all.columns.actions}</th></tr></thead>
      <tbody>{limits.clubs.map(club => {
        const share = club.limitBytes === 0 ? 1 : club.usedBytes / club.limitBytes;
        return <tr key={club.clubId}>
          <th scope="row">{club.name}</th>
          <td className={styles.nowrap}>{all.storageUse(mb(club.usedBytes), mb(club.limitBytes), Math.round(share * 100))}</td>
          <td>{text.own(club.mapQuotaMb)}</td>
          <td>{share >= 1 ? <span className={styles.badge} data-tone="attention">{all.overLimit}</span>
            : share >= SUPERADMIN_NEAR_LIMIT_SHARE ? <span className={styles.badge} data-tone="attention">{all.nearLimit}</span> : null}</td>
          <td><Button variant="secondary" disabled={busy} aria-label={`${all.action.SET_CLUB_LIMITS} ${club.name}`}
            onClick={() => onChange({ kind: "SET_CLUB_LIMITS", clubId: club.clubId, label: club.name, mapQuotaMb: club.mapQuotaMb,
              defaultMapQuotaMb: limits.defaultClubMapQuotaMb })}>{all.action.SET_CLUB_LIMITS}</Button></td>
        </tr>;
      })}</tbody>
    </Table>}
  </div>;
}
