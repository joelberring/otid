"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { superadminEn } from "../../i18n/superadmin-en";
import { useTexts, useLocale } from "../language-provider";
import type { SuperadminActionRequest } from "@o-tid/contracts";
import { superadminSv } from "../../i18n/superadmin-sv";
import { Button, CopyButton, Field, Notice } from "../ui";
import styles from "../account-pages.module.css";


export type PendingAction =
  | { kind: "HIDE_RACE" | "UNHIDE_RACE"; raceId: string; label: string }
  | { kind: "DELETE_EVENT"; eventId: string; label: string; confirm: string }
  | { kind: "BLOCK_ACCOUNT" | "UNBLOCK_ACCOUNT" | "CREATE_RESET_LINK" | "VERIFY_EMAIL"; accountId: string; label: string }
  | { kind: "DELETE_ACCOUNT"; accountId: string; label: string; confirm: string; ownedEvents: number }
  /** Ägaren 2026-11-13: kontots egna gränser; fälten fylls med de nuvarande och förvalen visas i etiketterna. */
  | { kind: "SET_ACCOUNT_LIMITS"; accountId: string; label: string; mapQuotaMb: number | null; geoTilesPerMonth: number | null;
      regenerableQuotaMb: number | null; defaultMapQuotaMb: number | null; defaultGeoTilesPerMonth: number; defaultRegenerableQuotaMb: number }
  /** ADR-0229: installationens gränser (mellanlagrets tak och kartlagringens totala gräns). */
  | { kind: "SET_INSTALLATION_LIMITS"; label: string; cacheMaxMb: number | null; cacheMaxMbDefault: number; mapQuotaTotalMb: number | null;
      mapQuotaTotalDefaultMb: number | null; pinMaxMb: number | null; pinMaxMbDefault: number; regenerableIdleDays?: number | null;
      regenerableIdleDaysDefault?: number }
  /** PLAN.md steg M7: klubbens gräns för lagring (klubbarkivet). */
  | { kind: "SET_CLUB_LIMITS"; clubId: string; label: string; mapQuotaMb: number | null; defaultMapQuotaMb: number }
  /** PLAN.md steg M3: «Flytta nu». */
  | { kind: "MIGRATE_MAP_CONTENT_NOW"; label: string };

export interface LimitValues { mapQuotaMb: number | null; geoTilesPerMonth: number | null; regenerableQuotaMb: number | null;
  cacheMaxMb: number | null; mapQuotaTotalMb: number | null; pinMaxMb?: number | null; regenerableIdleDays?: number | null }
/** Fältets text som gräns: tomt = förvalet (null); annars ett heltal inom gränserna, eller undefined om det inte går att tolka. */
function limitValue(text: string, min: number, max: number): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : undefined;
}

export function actionRequest(action: PendingAction, reason: string, confirmation: string, limits?: LimitValues): SuperadminActionRequest {
  switch (action.kind) {
    case "SET_ACCOUNT_LIMITS": return { formatVersion: 1, action: action.kind, accountId: action.accountId, reason,
      mapQuotaMb: limits?.mapQuotaMb ?? null, geoTilesPerMonth: limits?.geoTilesPerMonth ?? null, regenerableQuotaMb: limits?.regenerableQuotaMb ?? null };
    case "SET_INSTALLATION_LIMITS": return { formatVersion: 1, action: action.kind, reason,
      cacheMaxMb: limits?.cacheMaxMb ?? null, mapQuotaTotalMb: limits?.mapQuotaTotalMb ?? null, pinMaxMb: limits?.pinMaxMb ?? null,
      regenerableIdleDays: limits?.regenerableIdleDays ?? null };
    case "MIGRATE_MAP_CONTENT_NOW": return { formatVersion: 1, action: action.kind, reason };
    case "SET_CLUB_LIMITS": return { formatVersion: 1, action: action.kind, clubId: action.clubId, reason, mapQuotaMb: limits?.mapQuotaMb ?? null };
    case "HIDE_RACE": case "UNHIDE_RACE": return { formatVersion: 1, action: action.kind, raceId: action.raceId, reason };
    case "DELETE_EVENT": return { formatVersion: 1, action: action.kind, eventId: action.eventId, reason, confirmation };
    case "DELETE_ACCOUNT": return { formatVersion: 1, action: action.kind, accountId: action.accountId, reason, confirmation };
    default: return { formatVersion: 1, action: action.kind, accountId: action.accountId, reason };
  }
}

/** Bekräftelse av en superadminåtgärd: skäl (loggas) och, vid borttagning, namnet eller adressen. */
export function SuperadminActionPanel({ action, busy, error, onSubmit, onCancel }: {
  action: PendingAction; busy: boolean; error: string | undefined;
  onSubmit: (reason: string, confirmation: string, limits?: LimitValues) => void; onCancel: () => void;
}) {
  const text = useTexts(superadminSv, superadminEn);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [action]);
  const confirm = "confirm" in action ? action.confirm : undefined;
  const destructive = action.kind === "DELETE_EVENT" || action.kind === "DELETE_ACCOUNT";
  const account = action.kind === "SET_ACCOUNT_LIMITS" ? action : undefined;
  const installation = action.kind === "SET_INSTALLATION_LIMITS" ? action : undefined;
  const club = action.kind === "SET_CLUB_LIMITS" ? action : undefined;
  const [mapQuota, setMapQuota] = useState((account ?? club)?.mapQuotaMb?.toString() ?? "");
  const [geoTiles, setGeoTiles] = useState(account?.geoTilesPerMonth?.toString() ?? "");
  const [regenerable, setRegenerable] = useState(account?.regenerableQuotaMb?.toString() ?? "");
  const [cacheMax, setCacheMax] = useState(installation?.cacheMaxMb?.toString() ?? "");
  const [totalQuota, setTotalQuota] = useState(installation?.mapQuotaTotalMb?.toString() ?? "");
  const [pinMax, setPinMax] = useState(installation?.pinMaxMb?.toString() ?? "");
  const [idleDays, setIdleDays] = useState(installation?.regenerableIdleDays?.toString() ?? "");
  const values = account ? { mapQuotaMb: limitValue(mapQuota, 1, 1_000_000), geoTilesPerMonth: limitValue(geoTiles, 0, 100_000),
    regenerableQuotaMb: limitValue(regenerable, 1, 1_000_000), cacheMaxMb: null, mapQuotaTotalMb: null }
    : installation ? { mapQuotaMb: null, geoTilesPerMonth: null, regenerableQuotaMb: null, cacheMaxMb: limitValue(cacheMax, 100, 10_000_000),
      mapQuotaTotalMb: limitValue(totalQuota, 0, 100_000_000), pinMaxMb: limitValue(pinMax, 100, 10_000_000),
      regenerableIdleDays: limitValue(idleDays, 0, 3650) }
    : club ? { mapQuotaMb: limitValue(mapQuota, 1, 1_000_000), geoTilesPerMonth: null, regenerableQuotaMb: null, cacheMaxMb: null, mapQuotaTotalMb: null }
    : undefined;
  const limitsValid = !values || Object.values(values).every(value => value !== undefined);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!limitsValid) return;
    onSubmit(reason.trim(), confirmation, values as LimitValues | undefined);
  };
  const numberField = (label: string, value: string, set: (value: string) => void, max: number, invalid: boolean) =>
    <Field label={label}>
      <input value={value} inputMode="numeric" maxLength={String(max).length} disabled={busy} aria-invalid={invalid}
        onChange={event => set(event.target.value)} />
    </Field>;
  return <form className={styles.panel} onSubmit={submit} aria-labelledby="superadmin-action-title">
    <h3 id="superadmin-action-title" ref={heading} tabIndex={-1}>{text.confirmTitle[action.kind]}</h3>
    <dl className={styles.facts}><dt>{text.target}</dt><dd>{action.label}</dd></dl>
    <p>{text.confirmHelp[action.kind]}</p>
    {action.kind === "DELETE_ACCOUNT" && action.ownedEvents > 0 && <Notice tone="attention">{text.ownedEvents(action.ownedEvents)}</Notice>}
    {account && <>
      {numberField(text.mapQuotaField(account.defaultMapQuotaMb), mapQuota, setMapQuota, 1_000_000, values?.mapQuotaMb === undefined)}
      {numberField(text.regenerableQuotaField(account.defaultRegenerableQuotaMb), regenerable, setRegenerable, 1_000_000,
        values?.regenerableQuotaMb === undefined)}
      {numberField(text.geoTilesField(account.defaultGeoTilesPerMonth), geoTiles, setGeoTiles, 100_000, values?.geoTilesPerMonth === undefined)}
    </>}
    {club && numberField(text.clubs.field(club.defaultMapQuotaMb), mapQuota, setMapQuota, 1_000_000, values?.mapQuotaMb === undefined)}
    {installation && <>
      {numberField(text.cacheMaxField(installation.cacheMaxMbDefault), cacheMax, setCacheMax, 10_000_000, values?.cacheMaxMb === undefined)}
      {numberField(text.pinMaxField(installation.pinMaxMbDefault), pinMax, setPinMax, 10_000_000, values?.pinMaxMb === undefined)}
      {numberField(text.totalQuotaField(installation.mapQuotaTotalDefaultMb), totalQuota, setTotalQuota, 100_000_000,
        values?.mapQuotaTotalMb === undefined)}
      {numberField(text.idleDaysField(installation.regenerableIdleDaysDefault ?? 90), idleDays, setIdleDays, 3650,
        values?.regenerableIdleDays === undefined)}
    </>}
    <Field label={text.reason}>
      <input value={reason} maxLength={500} required disabled={busy} onChange={event => setReason(event.target.value)} />
    </Field>
    {confirm && <Field label={action.kind === "DELETE_EVENT" ? text.confirmName(confirm) : text.confirmEmail(confirm)}>
      <input value={confirmation} autoComplete="off" spellCheck={false} required disabled={busy} onChange={event => setConfirmation(event.target.value)} />
    </Field>}
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    <div className={styles.actions}>
      <Button type="submit" className={destructive ? styles.danger : undefined}
        disabled={busy || !reason.trim() || !limitsValid || (confirm !== undefined && !confirmation.trim())}>{busy ? text.working : text.perform}</Button>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>{text.cancel}</Button>
    </div>
  </form>;
}

/** Återställningslänken visas en gång, med kopiering. */
export function ResetLink({ url, expiresAt, onClose }: { url: string; expiresAt: string; onClose: () => void }) {
  const locale = useLocale();
  const text = useTexts(superadminSv, superadminEn);
  const [copied, setCopied] = useState<string>();
  const time = new Date(expiresAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return <div className={styles.panel} role="status">
    <h3>{text.resetTitle}</h3>
    <p>{text.resetHelp(time)}</p>
    <output className={styles.link} aria-label={text.resetTitle}>{url}</output>
    <div className={styles.actions}>
      <CopyButton value={url} onResult={ok => setCopied(ok ? text.copied : text.copyFailed)}>{text.copy}</CopyButton>
      <Button variant="secondary" onClick={onClose}>{text.closeLink}</Button>
      {copied && <span>{copied}</span>}
    </div>
  </div>;
}
