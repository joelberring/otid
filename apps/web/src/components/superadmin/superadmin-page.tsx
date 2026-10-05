"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { superadminActionResponseSchema, superadminOverviewSchema, type SuperadminOverview } from "@o-tid/contracts";
import { superadminSv as text } from "../../i18n/superadmin-sv";
import { accountSv } from "../../i18n/account-sv";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { accountRequest } from "../../lib/account-client";
import { Button, EmptyState, Field, Notice, numeric, Section, Table } from "../ui";
import { actionRequest, ResetLink, SuperadminActionPanel, type PendingAction } from "./superadmin-action-panel";
import styles from "../account-pages.module.css";

const dateTime = (value: string) => new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
const date = (value: string) => new Date(value).toLocaleDateString("sv-SE");

function SearchForm({ label, value, onSearch }: { label: string; value: string; onSearch: (value: string) => void }) {
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
  const [overview, setOverview] = useState<SuperadminOverview>();
  const [problem, setProblem] = useState<string>();
  const [query, setQuery] = useState({ accounts: "", races: "" });
  const [pending, setPending] = useState<PendingAction>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [done, setDone] = useState<{ section: "races" | "accounts"; text: string; reset?: { url: string; expiresAt: string } }>();

  async function load(next = query) {
    const params = new URLSearchParams({ konton: next.accounts, tavlingar: next.races });
    try {
      const response = await accountRequest(`/api/superadmin?${params.toString()}`);
      if (response.status === 401) { setProblem(text.notLoggedIn); return; }
      if (response.status === 403) { setProblem(text.forbidden); return; }
      const parsed = superadminOverviewSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) throw new Error(accountSv.genericError(response.status));
      setProblem(undefined);
      setOverview(parsed.data);
    } catch (error) { setProblem(error instanceof Error ? error.message : accountSv.networkError); }
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

  async function perform(reason: string, confirmation: string) {
    if (!pending) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await accountRequest("/api/superadmin/actions", { method: "POST", csrf: true, body: actionRequest(pending, reason, confirmation) });
      if (response.status === 409) { setActionError(text.mismatch); return; }
      if (response.status === 404) { setActionError(text.notFound); await load(); return; }
      if (response.status === 400 && pending.kind !== "CREATE_RESET_LINK") { setActionError(text.ownAccount); return; }
      const parsed = superadminActionResponseSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) { setActionError(accountSv.genericError(response.status)); return; }
      setDone({ section: "raceId" in pending || "eventId" in pending ? "races" : "accounts",
        text: text.done(`${text.logAction[pending.kind]} – ${pending.label}`),
        ...(parsed.data.resetUrl && parsed.data.resetExpiresAt ? { reset: { url: parsed.data.resetUrl, expiresAt: parsed.data.resetExpiresAt } } : {}) });
      setPending(undefined);
      await load();
    } catch { setActionError(accountSv.networkError); }
    finally { setBusy(false); }
  }

  const panel = (kinds: PendingAction["kind"][]) => pending && kinds.includes(pending.kind) &&
    <SuperadminActionPanel key={`${pending.kind}-${pending.label}`} action={pending} busy={busy} error={actionError}
      onSubmit={(reason, confirmation) => void perform(reason, confirmation)} onCancel={() => setPending(undefined)} />;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div>
      <nav aria-label={text.title}><Link href="/organizer">{accountSv.backToEvents}</Link><Link href="/konto">{accountSv.me.title}</Link></nav>
    </header>
    {!overview && !problem && <p role="status">{text.loading}</p>}
    {problem && <Notice tone="error" role="alert">{problem} {problem === text.notLoggedIn && <Link href="/organizer">{accountSv.logIn}</Link>}</Notice>}
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
            <th scope="row">{race.eventName}{race.raceName !== race.eventName && <span className={styles.muted}> – {race.raceName}</span>}</th>
            <td className={styles.nowrap}>{race.raceDate}</td><td>{race.ownerEmail ?? <span className={styles.muted}>{text.noOwner}</span>}</td>
            <td>{raceTypeSv.types[race.raceType].name}</td><td className={styles.nowrap}>{date(race.createdAt)}</td>
            <td>{race.hidden ? <span className={styles.badge} data-tone="attention">{text.status.hidden}</span> : text.status.visible}</td>
            <td><div className={styles.rowActions}>
              <Button variant="secondary" disabled={busy} aria-label={`${race.hidden ? text.action.UNHIDE_RACE : text.action.HIDE_RACE} ${race.eventName}`}
                onClick={() => start({ kind: race.hidden ? "UNHIDE_RACE" : "HIDE_RACE", raceId: race.raceId, label: `${race.eventName} – ${race.raceName}` })}>
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
        {panel(["BLOCK_ACCOUNT", "UNBLOCK_ACCOUNT", "DELETE_ACCOUNT", "CREATE_RESET_LINK"])}
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
              {account.superadmin && <> <span className={styles.badge}>{text.status.superadmin}</span></>}</td>
            <td><div className={styles.rowActions}>
              <Button variant="secondary" disabled={busy} aria-label={`${account.blocked ? text.action.UNBLOCK_ACCOUNT : text.action.BLOCK_ACCOUNT} ${account.email}`}
                onClick={() => start({ kind: account.blocked ? "UNBLOCK_ACCOUNT" : "BLOCK_ACCOUNT", accountId: account.accountId, label: account.email })}>
                {account.blocked ? text.action.UNBLOCK_ACCOUNT : text.action.BLOCK_ACCOUNT}</Button>
              {!account.blocked && <Button variant="secondary" disabled={busy} aria-label={`${text.action.CREATE_RESET_LINK} ${account.email}`}
                onClick={() => start({ kind: "CREATE_RESET_LINK", accountId: account.accountId, label: account.email })}>{text.action.CREATE_RESET_LINK}</Button>}
              <Button variant="secondary" disabled={busy} aria-label={`${text.action.DELETE_ACCOUNT} ${account.email}`}
                onClick={() => start({ kind: "DELETE_ACCOUNT", accountId: account.accountId, label: account.email, confirm: account.email,
                  ownedEvents: account.eventCount })}>{text.action.DELETE_ACCOUNT}</Button>
            </div></td>
          </tr>)}</tbody>
        </Table>}
      </Section>

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
