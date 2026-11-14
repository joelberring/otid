"use client";

import Link from "next/link";
import { superadminEn } from "../../i18n/superadmin-en";
import { useTexts, useLocale } from "../language-provider";
import { useEffect, useState, type FormEvent } from "react";
import { SUPERADMIN_NEAR_LIMIT_SHARE, superadminActionResponseSchema, superadminOverviewSchema, type SuperadminOverview } from "@o-tid/contracts";
import { superadminSv } from "../../i18n/superadmin-sv";
import { accountSv } from "../../i18n/account-sv";
import { accountPageEn, type AccountPage } from "../../i18n/account-en";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { raceTypeEn } from "../../i18n/workspace-en";
import { accountRequest } from "../../lib/account-client";
import { Button, EmptyState, Field, Notice, numeric, Section, Table } from "../ui";
import { actionRequest, ResetLink, SuperadminActionPanel, type LimitValues, type PendingAction } from "./superadmin-action-panel";
import { AccountStorageSection } from "../account-storage";
import styles from "../account-pages.module.css";
import { raceTitle, shownRaceName } from "@o-tid/domain";



function SearchForm({ label, value, onSearch }: { label: string; value: string; onSearch: (value: string) => void }) {
  const text = useTexts(superadminSv, superadminEn);
  const [draft, setDraft] = useState(value);
  const submit = (event: FormEvent) => { event.preventDefault(); onSearch(draft.trim()); };
  return <form className={styles.search} role="search" onSubmit={submit}>
    <Field label={label}><input type="search" value={draft} maxLength={120} onChange={event => setDraft(event.target.value)} /></Field>
    <Button type="submit" variant="secondary">{text.search}</Button>
  </form>;
}

/**
 * Superadmin (ADR-0172 beslut 2): alla konton och tävlingar med sök, åtgärder med skäl och loggen.
 * Sidan visas bara för konton med superadmin; servern kontrollerar varje anrop.
 */
export function SuperadminPage() {
  const locale = useLocale();
  const dateTime = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  const date = (value: string) => new Date(value).toLocaleDateString(locale);
  const text = useTexts(superadminSv, superadminEn);
  const account = useTexts<AccountPage>(accountSv, accountPageEn);
  const raceTypeText = useTexts(raceTypeSv, raceTypeEn);
  const [overview, setOverview] = useState<SuperadminOverview>();
  const [problem, setProblem] = useState<string>();
  const [query, setQuery] = useState({ accounts: "", races: "" });
  const [pending, setPending] = useState<PendingAction>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  /** Kontot vars lagring visas per kartprojekt under listan (PLAN.md steg L2). */
  const [storageFor, setStorageFor] = useState<{ accountId: string; email: string }>();
  const [done, setDone] = useState<{ section: "races" | "accounts" | "limits"; text: string; reset?: { url: string; expiresAt: string } }>();

  async function load(next = query) {
    const params = new URLSearchParams({ konton: next.accounts, tavlingar: next.races });
    try {
      const response = await accountRequest(`/api/superadmin?${params.toString()}`);
      if (response.status === 401) { setProblem(text.notLoggedIn); return; }
      if (response.status === 403) { setProblem(text.forbidden); return; }
      const parsed = superadminOverviewSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) throw new Error(account.genericError(response.status));
      setProblem(undefined);
      setOverview(parsed.data);
    } catch (error) { setProblem(error instanceof Error ? error.message : account.networkError); }
  }
  useEffect(() => { void load(); }, []);

  function search(part: "accounts" | "races", value: string) {
    const next = { ...query, [part]: value };
    setQuery(next);
    void load(next);
  }

  function start(action: PendingAction) {
    setPending(action);
    setActionError(undefined);
    setDone(undefined);
  }

  async function perform(reason: string, confirmation: string, limits?: LimitValues) {
    if (!pending) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await accountRequest("/api/superadmin/actions", { method: "POST", csrf: true, body: actionRequest(pending, reason, confirmation, limits) });
      if (response.status === 409) {
        // Tillägg 2026-11-12: "Bekräfta adressen" på en adress som redan är bekräftad (CONFLICT); annars fel bekräftelse.
        if ((response.json as { error?: unknown } | undefined)?.error === "CONFLICT") { setActionError(text.alreadyVerified); await load(); }
        else setActionError(text.mismatch);
        return;
      }
      if (response.status === 404) { setActionError(text.notFound); await load(); return; }
      if (response.status === 400 && pending.kind !== "CREATE_RESET_LINK" && pending.kind !== "VERIFY_EMAIL" && pending.kind !== "SET_ACCOUNT_LIMITS") { setActionError(text.ownAccount); return; }
      const parsed = superadminActionResponseSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) { setActionError(account.genericError(response.status)); return; }
      setDone({ section: "raceId" in pending || "eventId" in pending ? "races" : pending.kind === "SET_ACCOUNT_LIMITS" ? "limits" : "accounts",
        text: text.done(`${text.logAction[pending.kind]} – ${pending.label}`),
        ...(parsed.data.resetUrl && parsed.data.resetExpiresAt ? { reset: { url: parsed.data.resetUrl, expiresAt: parsed.data.resetExpiresAt } } : {}) });
      setPending(undefined);
      await load();
    } catch { setActionError(account.networkError); }
    finally { setBusy(false); }
  }

  const panel = (kinds: PendingAction["kind"][]) => pending && kinds.includes(pending.kind) &&
    <SuperadminActionPanel key={`${pending.kind}-${pending.label}`} action={pending} busy={busy} error={actionError}
      onSubmit={(reason, confirmation, limits) => void perform(reason, confirmation, limits)} onCancel={() => setPending(undefined)} />;
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  const limitsAction = (account: { accountId: string; email: string; mapQuotaMb: number | null; geoTilesPerMonth: number | null }): PendingAction => ({
    kind: "SET_ACCOUNT_LIMITS", accountId: account.accountId, label: account.email, mapQuotaMb: account.mapQuotaMb,
    geoTilesPerMonth: account.geoTilesPerMonth, defaultMapQuotaMb: overview?.limits.defaultMapQuotaMb ?? null,
    defaultGeoTilesPerMonth: overview?.limits.defaultGeoTilesPerMonth ?? 0 });

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div>
      <nav aria-label={text.title}><Link href="/organizer">{account.backToEvents}</Link><Link href="/konto">{account.me.title}</Link></nav>
    </header>
    {!overview && !problem && <p role="status">{text.loading}</p>}
    {problem && <Notice tone="error" role="alert">{problem} {problem === text.notLoggedIn && <Link href="/organizer">{account.logIn}</Link>}</Notice>}
    {overview && <>
      <p className={styles.lead}>{text.intro}</p>

      <Section id="superadmin-tavlingar" title={text.races} help={text.racesHelp(overview.races.length, overview.raceTotal)}>
        <SearchForm label={text.searchRaces} value={query.races} onSearch={value => search("races", value)} />
        {panel(["HIDE_RACE", "UNHIDE_RACE", "DELETE_EVENT"])}
        {done?.section === "races" && <Notice tone="ok" role="status">{done.text}</Notice>}
        {overview.races.length === 0 ? <EmptyState title={text.noRaces} /> : <Table aria-label={text.races}>
          <thead><tr><th>{text.columns.race}</th><th>{text.columns.date}</th><th>{text.columns.owner}</th><th>{text.columns.type}</th>
            <th>{text.columns.created}</th><th>{text.columns.status}</th><th>{text.columns.actions}</th></tr></thead>
          <tbody>{overview.races.map(race => <tr key={race.raceId}>
            <th scope="row">{race.eventName}{shownRaceName(race.eventName, race.raceName) && <span className={styles.muted}> – {shownRaceName(race.eventName, race.raceName)}</span>}</th>
            <td className={styles.nowrap}>{race.raceDate}</td><td>{race.ownerEmail ?? <span className={styles.muted}>{text.noOwner}</span>}</td>
            <td>{raceTypeText.types[race.raceType].name}</td><td className={styles.nowrap}>{date(race.createdAt)}</td>
            <td>{race.hidden ? <span className={styles.badge} data-tone="attention">{text.status.hidden}</span> : text.status.visible}</td>
            <td><div className={styles.rowActions}>
              <Button variant="secondary" disabled={busy} aria-label={`${race.hidden ? text.action.UNHIDE_RACE : text.action.HIDE_RACE} ${race.eventName}`}
                onClick={() => start({ kind: race.hidden ? "UNHIDE_RACE" : "HIDE_RACE", raceId: race.raceId, label: raceTitle(race.eventName, race.raceName, " – ") })}>
                {race.hidden ? text.action.UNHIDE_RACE : text.action.HIDE_RACE}</Button>
              <Button variant="secondary" disabled={busy} aria-label={`${text.action.DELETE_EVENT} ${race.eventName}`}
                onClick={() => start({ kind: "DELETE_EVENT", eventId: race.eventId, label: race.eventName, confirm: race.eventName })}>
                {text.action.DELETE_EVENT}</Button>
            </div></td>
          </tr>)}</tbody>
        </Table>}
      </Section>

      <Section id="superadmin-konton" title={text.accounts} help={text.accountsHelp(overview.accounts.length, overview.accountTotal)}>
        <SearchForm label={text.searchAccounts} value={query.accounts} onSearch={value => search("accounts", value)} />
        {panel(["BLOCK_ACCOUNT", "UNBLOCK_ACCOUNT", "DELETE_ACCOUNT", "CREATE_RESET_LINK", "VERIFY_EMAIL"])}
        {done?.section === "accounts" && <Notice tone="ok" role="status">{done.text}</Notice>}
        {done?.reset && <ResetLink url={done.reset.url} expiresAt={done.reset.expiresAt} onClose={() => setDone(undefined)} />}
        {overview.accounts.length === 0 ? <EmptyState title={text.noAccounts} /> : <Table aria-label={text.accounts}>
          <thead><tr><th>{text.columns.email}</th><th>{text.columns.name}</th><th>{text.columns.created}</th><th>{text.columns.lastLogin}</th>
            <th>{text.columns.events}</th><th>{text.columns.status}</th><th>{text.columns.actions}</th></tr></thead>
          <tbody>{overview.accounts.map(account => <tr key={account.accountId}>
            <th scope="row">{account.email}</th><td>{account.displayName}</td><td className={styles.nowrap}>{date(account.createdAt)}</td>
            <td className={styles.nowrap}>{account.lastLoginAt ? dateTime(account.lastLoginAt) : <span className={styles.muted}>{text.never}</span>}</td>
            <td className={numeric}>{account.eventCount}</td>
            <td>{account.blocked ? <span className={styles.badge} data-tone="attention">{text.status.blocked}</span> : text.status.active}
              {account.superadmin && <> <span className={styles.badge}>{text.status.superadmin}</span></>}
              {!account.emailVerified && <> <span className={styles.badge}>{text.status.unverified}</span></>}</td>
            <td><div className={styles.rowActions}>
              <Button variant="secondary" disabled={busy} aria-label={`${account.blocked ? text.action.UNBLOCK_ACCOUNT : text.action.BLOCK_ACCOUNT} ${account.email}`}
                onClick={() => start({ kind: account.blocked ? "UNBLOCK_ACCOUNT" : "BLOCK_ACCOUNT", accountId: account.accountId, label: account.email })}>
                {account.blocked ? text.action.UNBLOCK_ACCOUNT : text.action.BLOCK_ACCOUNT}</Button>
              {!account.blocked && <Button variant="secondary" disabled={busy} aria-label={`${text.action.CREATE_RESET_LINK} ${account.email}`}
                onClick={() => start({ kind: "CREATE_RESET_LINK", accountId: account.accountId, label: account.email })}>{text.action.CREATE_RESET_LINK}</Button>}
              {!account.emailVerified && <Button variant="secondary" disabled={busy} aria-label={`${text.action.VERIFY_EMAIL} ${account.email}`}
                onClick={() => start({ kind: "VERIFY_EMAIL", accountId: account.accountId, label: account.email })}>{text.action.VERIFY_EMAIL}</Button>}
              <Button variant="secondary" disabled={busy} aria-label={`${text.action.SET_ACCOUNT_LIMITS} ${account.email}`}
                onClick={() => { start(limitsAction(account)); setStorageFor({ accountId: account.accountId, email: account.email });
                  document.getElementById("superadmin-granser")?.scrollIntoView(); }}>{text.action.SET_ACCOUNT_LIMITS}</Button>
              <Button variant="secondary" disabled={busy} aria-label={`${text.action.DELETE_ACCOUNT} ${account.email}`}
                onClick={() => start({ kind: "DELETE_ACCOUNT", accountId: account.accountId, label: account.email, confirm: account.email,
                  ownedEvents: account.eventCount })}>{text.action.DELETE_ACCOUNT}</Button>
            </div></td>
          </tr>)}</tbody>
        </Table>}
      </Section>

      <Section id="superadmin-granser" title={text.limits} help={text.limitsHelp(mb(overview.limits.totalUsedBytes),
        overview.limits.totalLimitBytes === null ? null : mb(overview.limits.totalLimitBytes), overview.limits.defaultMapQuotaMb, overview.limits.defaultGeoTilesPerMonth)}>
        {panel(["SET_ACCOUNT_LIMITS"])}
        {done?.section === "limits" && <Notice tone="ok" role="status">{done.text}</Notice>}
        {overview.limits.accounts.length === 0 ? <EmptyState title={text.limitsEmpty} /> : <Table aria-label={text.limits}>
          <thead><tr><th>{text.columns.email}</th><th>{text.columns.name}</th><th>{text.limitColumns.storage}</th><th>{text.limitColumns.tiles}</th>
            <th>{text.limitColumns.own}</th><th>{text.columns.status}</th><th>{text.columns.actions}</th></tr></thead>
          <tbody>{overview.limits.accounts.map(account => {
            const storageShare = account.mapLimitBytes === null ? null : account.mapLimitBytes === 0 ? 1 : account.mapUsedBytes / account.mapLimitBytes;
            const tileShare = account.geoTilesLimit === 0 ? (account.geoTilesUsed > 0 ? 1 : 0) : account.geoTilesUsed / account.geoTilesLimit;
            const share = Math.max(storageShare ?? 0, tileShare);
            return <tr key={account.accountId}>
              <th scope="row">{account.email}</th><td>{account.displayName}</td>
              <td className={styles.nowrap}>{text.storageUse(mb(account.mapUsedBytes), account.mapLimitBytes === null ? null : mb(account.mapLimitBytes),
                storageShare === null ? null : Math.round(storageShare * 100))}</td>
              <td className={styles.nowrap}>{text.tilesUse(account.geoTilesUsed, account.geoTilesLimit)}</td>
              <td>{text.ownLimits(account.mapQuotaMb, account.geoTilesPerMonth)}</td>
              <td>{share >= 1 ? <span className={styles.badge} data-tone="attention">{text.overLimit}</span>
                : share >= SUPERADMIN_NEAR_LIMIT_SHARE ? <span className={styles.badge} data-tone="attention">{text.nearLimit}</span> : null}</td>
              <td><div className={styles.rowActions}>
                <Button variant="secondary" disabled={busy} aria-label={`${text.action.SET_ACCOUNT_LIMITS} ${account.email}`}
                  onClick={() => start(limitsAction(account))}>{text.action.SET_ACCOUNT_LIMITS}</Button>
                <Button variant="secondary" aria-label={`${text.showStorage} ${account.email}`}
                  onClick={() => setStorageFor({ accountId: account.accountId, email: account.email })}>{text.showStorage}</Button>
              </div></td>
            </tr>;
          })}</tbody>
        </Table>}
      </Section>
      {storageFor && <AccountStorageSection id="superadmin-lagring" url={`/api/superadmin/accounts/${storageFor.accountId}/storage`}
        canPrune={false} title={text.storageOf(storageFor.email)} />}

      <Section id="superadmin-logg" title={text.log} help={text.logHelp}>
        {overview.log.length === 0 ? <EmptyState title={text.logEmpty} /> : <Table aria-label={text.log}>
          <thead><tr><th>{text.logColumns.when}</th><th>{text.logColumns.who}</th><th>{text.logColumns.what}</th>
            <th>{text.logColumns.target}</th><th>{text.logColumns.reason}</th></tr></thead>
          <tbody>{overview.log.map(entry => <tr key={entry.id}>
            <td className={styles.nowrap}>{dateTime(entry.createdAt)}</td><td>{entry.actorLabel}</td><td>{text.logAction[entry.action]}</td>
            <td>{entry.targetLabel}</td><td>{entry.reason}</td>
          </tr>)}</tbody>
        </Table>}
      </Section>
    </>}
  </main>;
}
