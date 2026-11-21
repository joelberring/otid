"use client";

import type { SuperadminOverview } from "@o-tid/contracts";
import { superadminEn } from "../../i18n/superadmin-en";
import { superadminSv } from "../../i18n/superadmin-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { PendingAction } from "./superadmin-action-panel";
import styles from "../account-pages.module.css";

/**
 * ADR-0229 (ägaren 2026-11-21): installationens gränser på superadminsidan – förrådets läge, mellanlagrets tak och hur fullt det
 * är, hämtningar ur förrådet och kartlagringens totala gräns. "Ändra" öppnar samma bekräftelse med skäl som kontots gränser.
 */
export function SuperadminInstallation({ limits, busy, onChange }: {
  limits: SuperadminOverview["limits"]; busy: boolean; onChange: (action: PendingAction) => void;
}) {
  const text = useTexts(superadminSv, superadminEn).installation;
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  const install = limits.installation;
  const cacheMax = install.cacheMaxMb ?? install.cacheMaxMbDefault;
  const totalMb = install.mapQuotaTotalMb === null ? install.mapQuotaTotalDefaultMb : install.mapQuotaTotalMb === 0 ? null : install.mapQuotaTotalMb;
  return <div className={styles.panel} aria-labelledby="superadmin-installation-title">
    <h3 id="superadmin-installation-title">{text.title}</h3>
    <dl className={styles.facts}>
      <dt>{text.store}</dt><dd>{text.storeMode[install.storeMode]}</dd>
      <dt>{text.cache}</dt>
      <dd>{text.cacheUse(install.cacheUsedBytes === null ? null : mb(install.cacheUsedBytes), cacheMax, install.cacheFiles,
        install.cacheMaxMb === null)}</dd>
      <dt>{text.fetches}</dt>
      <dd>{text.fetchesUse(install.storeFetchesToday, mb(install.storeFetchBytesToday), install.storeFetchesYesterday)}</dd>
      <dt>{text.total}</dt>
      <dd>{text.totalUse(mb(limits.totalUsedBytes), totalMb, install.mapQuotaTotalMb === null)}</dd>
    </dl>
    <div className={styles.actions}>
      <Button variant="secondary" disabled={busy} onClick={() => onChange({ kind: "SET_INSTALLATION_LIMITS", label: text.label,
        cacheMaxMb: install.cacheMaxMb, cacheMaxMbDefault: install.cacheMaxMbDefault, mapQuotaTotalMb: install.mapQuotaTotalMb,
        mapQuotaTotalDefaultMb: install.mapQuotaTotalDefaultMb })}>{text.change}</Button>
    </div>
  </div>;
}
