"use client";

import type { SuperadminOverview } from "@o-tid/contracts";
import { superadminEn } from "../../i18n/superadmin-en";
import { superadminSv } from "../../i18n/superadmin-sv";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import type { PendingAction } from "./superadmin-action-panel";
import styles from "../account-pages.module.css";

/**
 * ADR-0229 (ägaren 2026-11-21): installationens gränser på superadminsidan – förrådets läge, mellanlagrets tak och hur fullt det
 * är, det fastspikade för tävlingar (PLAN.md steg M2, med varning när något saknas – fel när tävlingen är i dag), hämtningar ur
 * förrådet och kartlagringens totala gräns. "Ändra" öppnar samma bekräftelse med skäl som kontots gränser. PLAN.md steg M3:
 * flytten av befintligt innehåll till förrådet (kvar i databasen, i förrådet, väntar på frist, senaste varvet) och «Flytta nu».
 */
export function SuperadminInstallation({ limits, busy, onChange }: {
  limits: SuperadminOverview["limits"]; busy: boolean; onChange: (action: PendingAction) => void;
}) {
  const text = useTexts(superadminSv, superadminEn).installation;
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  const install = limits.installation;
  const cacheMax = install.cacheMaxMb ?? install.cacheMaxMbDefault;
  const pinMax = install.pinMaxMb ?? install.pinMaxMbDefault;
  const pinned = install.pinned;
  const migration = install.migration;
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
      <dt>{text.pinned}</dt>
      <dd>{install.pinned === null ? (install.storeMode === "off" ? text.storeMode.off : text.pinnedUnknown)
        : text.pinnedUse(install.pinned.count, mb(install.pinned.bytes), pinMax, install.pinMaxMb === null)}</dd>
      <dt>{text.total}</dt>
      <dd>{text.totalUse(mb(limits.totalUsedBytes), totalMb, install.mapQuotaTotalMb === null)}</dd>
      <dt>{text.idle}</dt>
      <dd>{text.idleUse(install.regenerableIdleDays ?? install.regenerableIdleDaysDefault ?? 90, install.regenerableIdleDays == null)}</dd>
    </dl>
    {pinned && pinned.missing > 0 && <Notice tone={pinned.missingRaceDay ? "error" : "attention"} role={pinned.missingRaceDay ? "alert" : undefined}>
      {pinned.missingRaceDay ? text.pinnedMissingToday(pinned.missing, mb(pinned.missingBytes)) : text.pinnedMissing(pinned.missing, mb(pinned.missingBytes))}
    </Notice>}
    {pinned?.overLimit && <Notice tone="attention">{text.pinnedOverLimit(mb(pinned.bytes), pinMax)}</Notice>}
    {migration && <dl className={styles.facts}>
      <dt>{text.migration}</dt>
      <dd>{text.migrationUse(migration.dbCount, mb(migration.dbBytes), migration.storeCount, mb(migration.storeBytes), migration.pendingCount,
        mb(migration.pendingBytes))} {migration.enabled ? text.migrationWindow(migration.window) : text.migrationOff}
        {migration.last && <> {text.migrationLast(new Date(migration.last.at).toLocaleString(), migration.last.moved, mb(migration.last.movedBytes),
          migration.last.freed, migration.last.failed)}{migration.last.stopped && ` ${text.migrationStopped[migration.last.stopped]}`}</>}</dd>
    </dl>}
    {migration?.last && migration.last.errors.length > 0 && <Notice tone="attention">{migration.last.errors.join("; ")}</Notice>}
    {migration?.requested && <Notice tone="info">{text.migrationRequested}</Notice>}
    {migration?.raceDay && migration.dbCount > 0 && <Notice tone="attention">{text.migrationRaceDay}</Notice>}
    {migration && migration.dbCount === 0 && migration.pendingCount === 0 && <Notice tone="info">{text.migrationDone}</Notice>}
    <div className={styles.actions}>
      <Button variant="secondary" disabled={busy} onClick={() => onChange({ kind: "SET_INSTALLATION_LIMITS", label: text.label,
        cacheMaxMb: install.cacheMaxMb, cacheMaxMbDefault: install.cacheMaxMbDefault, mapQuotaTotalMb: install.mapQuotaTotalMb,
        mapQuotaTotalDefaultMb: install.mapQuotaTotalDefaultMb, pinMaxMb: install.pinMaxMb, pinMaxMbDefault: install.pinMaxMbDefault,
        regenerableIdleDays: install.regenerableIdleDays ?? null, regenerableIdleDaysDefault: install.regenerableIdleDaysDefault ?? 90 })}>{text.change}</Button>
      {migration?.enabled && migration.dbCount > 0 && <Button variant="secondary" disabled={busy || migration.requested || migration.raceDay}
        onClick={() => onChange({ kind: "MIGRATE_MAP_CONTENT_NOW", label: text.label })}>{text.migrateNow}</Button>}
    </div>
  </div>;
}
