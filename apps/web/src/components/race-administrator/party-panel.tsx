"use client";

import { useCallback, useEffect, useState } from "react";
import { partyStateResponseSchema, type PartyChangeRequest, type PartyStateResponse } from "@o-tid/contracts";
import { formatPartyKronor, formatPartyTime, parseRaceClock, PARTY_DISPLAY_NAME_MAX, partyDefaultDisplayName, partyDisplayName, partyMemoryWarning, partyPurchasesCsv, partySummaryCsv,
  type PartyLedger } from "@o-tid/domain";
import styles from "../race-administrator-workspace.module.css";
import local from "./party.module.css";
import { partySv as text } from "../../i18n/party-sv";
import { readAccountCsrfCookie } from "../../lib/organizer-account-cookies";
import { Button, Notice, Section, Table, numeric } from "../ui";
import type { Workspace } from "./workspace-state";
import { PartyThemeForm } from "./party-theme-form";
import { CENTRUM_PRESET } from "../../lib/party-theme-style";
import { SelfRegistrationSetting } from "./self-registration-setting";

/**
 * Fest (PLAN.md steg 40): festens start, varorna (kod, namn, pris), köpen i kväll med summa per person, in- och
 * utcheckade, ångra (admin) och export. Läget hämtas om var femte sekund. Köpen räknas på servern ur brickornas
 * stämplingar; här visas de bara.
 */
const POLL_MS = 5_000;

function parseKronor(value: string): number | undefined {
  const match = /^\s*(\d{1,6})(?:[,.](\d{1,2}))?\s*$/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
  } finally { URL.revokeObjectURL(url); }
}

export function PartyPanel({ ws }: { ws: Workspace }) {
  if (!ws.shows("PARTY")) return null;
  return <PartyWorkspace raceId={ws.raceId} admin={!ws.functionary} ws={ws} />;
}

function PartyWorkspace({ raceId, admin, ws }: { raceId: string; admin: boolean; ws: Workspace }) {
  const [state, setState] = useState<PartyStateResponse>();
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator`;
  const load = useCallback(async () => {
    const response = await fetch(`${base}/party`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    setState(partyStateResponseSchema.parse(await response.json()));
  }, [base]);
  useEffect(() => {
    let stopped = false;
    const run = () => load().then(() => { if (!stopped) setProblem(undefined); }, () => { if (!stopped) setProblem(text.loadError); });
    void run();
    const timer = setInterval(() => { void run(); }, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [load]);

  async function post(path: string, body: unknown): Promise<Response> {
    const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href)) ?? "";
    return fetch(`${base}/${path}`, { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify(body) });
  }
  async function change(change: PartyChangeRequest["change"], done?: string): Promise<boolean> {
    setBusy(true); setSaved(undefined);
    try {
      const response = await post("party", { formatVersion: 1, requestId: crypto.randomUUID(), change });
      if (response.status === 409) { setProblem(text.codeTaken); return false; }
      if (!response.ok) { setProblem(text.saveError); return false; }
      setState(partyStateResponseSchema.parse(await response.json())); setProblem(undefined);
      if (done) setSaved(done);
      return true;
    } catch { setProblem(text.saveError); return false; }
    finally { setBusy(false); }
  }
  /** Förinställningens varor: bara de koder som saknas läggs till, efter bekräftelse. Befintliga varor ändras aldrig. */
  async function addPresetItems() {
    if (!state) return;
    const taken = new Set(state.items.map(item => item.code));
    const missing = CENTRUM_PRESET.items.filter(item => !taken.has(item.code));
    if (missing.length === 0) { setSaved(text.presetNone); return; }
    if (!window.confirm(text.presetConfirm(missing.map(item => `${item.code} ${item.name} ${formatPartyKronor(item.priceOre)} kr`).join("\n")))) return;
    let added = 0;
    for (const item of missing) {
      if (await change({ kind: "item-add", code: item.code, name: item.name, priceOre: item.priceOre, group: item.group })) added += 1;
    }
    setSaved(text.presetAdded(added));
  }
  async function uploadLogo(file: File | null): Promise<boolean> {
    setBusy(true); setSaved(undefined);
    try {
      const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href)) ?? "";
      const response = await fetch(`${base}/party-logo`, { method: file ? "PUT" : "DELETE", credentials: "same-origin", cache: "no-store",
        headers: { "x-otid-csrf": csrf, ...(file ? { "content-type": file.type } : {}) }, ...(file ? { body: file } : {}) });
      if (!response.ok) { setProblem(file ? text.logoInvalid : text.saveError); return false; }
      await load(); setProblem(undefined); setSaved(file ? text.logoSaved : text.logoRemoved);
      return true;
    } catch { setProblem(text.saveError); return false; }
    finally { setBusy(false); }
  }
  async function saveGuest(cardNumber: string, name: string, club: string, displayName: string): Promise<boolean> {
    setBusy(true);
    try {
      const response = await post("party-guests", { formatVersion: 1, cardNumber, name: name.trim(), club: club.trim() || null,
        displayName: displayName.trim() || null });
      if (!response.ok) { setProblem(text.saveError); return false; }
      await load(); return true;
    } catch { setProblem(text.saveError); return false; }
    finally { setBusy(false); }
  }

  if (!state) return <Section id={`party-${raceId}`} title={text.title} help={text.help}>
    {problem ? <Notice tone="error" role="alert">{problem}</Notice> : <p role="status" className={styles.workflowHelp}>{text.loading}</p>}
  </Section>;
  const ledger: PartyLedger = { purchases: state.purchases, guests: state.guests, totalOre: state.totalOre, purchaseCount: state.purchaseCount };
  const names = new Map(state.guests.map(guest => [guest.cardNumber, guest.name]));
  const at = (value: string) => formatPartyTime(value, state.timeZone).slice(11, 16);
  const stamp = new Date().toISOString().slice(0, 10);
  return <div className={styles.workflowGroup}>
    <Section id={`party-${raceId}`} title={text.title} help={text.help}
      actions={<a className={local.open} href={`/admin/${raceId}/readout`} target="_blank" rel="noopener">{text.openDesk}</a>}>
      <p className={styles.workflowHelp}>{text.openDeskHelp}</p>
      <p className={styles.workflowHelp}>{text.publicHelp} <a href={state.publicPath} target="_blank" rel="noopener">{text.publicLink}</a></p>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      {saved && <Notice tone="ok" role="status">{saved}</Notice>}
      {!state.startsAt && <Notice tone="attention">{text.noStart}</Notice>}
      {admin && <StartForm key={`${state.startsAt}-${state.showPublicNames}`} state={state} busy={busy}
        onSave={(startsAt, showPublicNames, doublePunchSeconds) => change({ kind: "settings", startsAt, showPublicNames, doublePunchSeconds },
          text.settingsSaved)} />}
      {admin && <SelfRegistrationSetting ws={ws} />}
      {admin && <PartyThemeForm key={JSON.stringify(state.theme)} state={state} busy={busy}
        onChange={value => change(value, text.themeSaved)} onLogo={uploadLogo} />}
    </Section>

    <Section id={`party-items-${raceId}`} title={text.itemsTitle} help={text.itemsHelp} headingLevel={3}>
      {state.items.length === 0 ? <p>{text.noItems}</p> : <Table className={local.items}>
        <thead><tr><th scope="col" className={numeric}>{text.code}</th><th scope="col">{text.name}</th>
          <th scope="col" className={numeric}>{text.price}</th><th scope="col">{text.groupShort}</th><th scope="col">{text.hidden}</th>{admin && <th scope="col"><span className={local.hiddenText}>{text.saveItem}</span></th>}</tr></thead>
        <tbody>{state.items.map(item => admin
          ? <ItemRow key={`${item.id}-${item.priceOre}-${item.name}-${item.hidden}-${item.group ?? ""}`} item={item} busy={busy}
            onSave={(name, priceOre, hidden, group) => change({ kind: "item-change", itemId: item.id, name, priceOre, hidden, group })} />
          : <tr key={item.id}><td className={numeric}>{item.code}</td><td>{item.name}</td><td className={numeric}>{formatPartyKronor(item.priceOre)}</td>
            <td>{item.group ?? ""}</td><td>{item.hidden ? "✓" : ""}</td></tr>)}</tbody>
      </Table>}
      {admin && <AddItemForm busy={busy} onAdd={(code, name, priceOre, group) => change({ kind: "item-add", code, name, priceOre, group })} />}
      <div className={styles.actions}>
        {admin && <Button variant="secondary" disabled={busy} onClick={() => void addPresetItems()}>{text.presetItems}</Button>}
        <a className={local.secondaryLink} href={`/admin/${raceId}/party-labels`} target="_blank" rel="noopener">{text.labels}</a>
      </div>
      <p className={styles.workflowHelp}>{text.labelsHelp}</p>
    </Section>

    <Section id={`party-live-${raceId}`} title={text.liveTitle} help={text.liveHelp} headingLevel={3}>
      <p className={local.totals} data-testid="party-totals">{text.totals(state.purchaseCount, formatPartyKronor(state.totalOre))}
        {" · "}{text.checkedIn(state.guests.filter(guest => guest.checkIn).length)}
        {" · "}{text.checkedOut(state.guests.filter(guest => guest.checkout).length)}</p>
      <h4 className={local.subhead}>{text.guestsTitle}</h4>
      {state.guests.length === 0 ? <p>{text.noPurchases}</p> : <Table className={local.guests}>
        <thead><tr><th scope="col">{text.guest}</th><th scope="col">{text.displayName}</th><th scope="col">{text.card}</th><th scope="col" className={numeric}>{text.purchases}</th>
          <th scope="col" className={numeric}>{text.sum}</th><th scope="col">{text.checkInColumn}</th><th scope="col">{text.checkOutColumn}</th></tr></thead>
        <tbody>{state.guests.map(guest => <tr key={guest.cardNumber} data-card={guest.cardNumber}>
          <td><GuestName guest={guest} busy={busy} onSave={(name, club, displayName) => saveGuest(guest.cardNumber, name, club, displayName)} />
            {guest.selfRegistered ? <span className={local.tag}>{text.selfRegistered}</span> : null}
            {admin && guest.name ? <button type="button" className={local.linkButton} disabled={busy}
              aria-label={text.removeGuestLabel(guest.cardNumber)} onClick={() => {
                if (window.confirm(text.removeGuestConfirm(guest.cardNumber, guest.name ?? ""))) {
                  void change({ kind: "guest-remove", cardNumber: guest.cardNumber }, text.guestRemoved);
                }
              }}>{text.removeGuest}</button> : null}
            {partyMemoryWarning(guest.memory) && guest.memory ? <span className={local.warning} title={text.memoryHelp}>
              ! {text.nearlyFull(guest.memory.punches, guest.memory.capacity)}</span> : null}</td>
          <td>{partyDisplayName(guest) ?? ""}</td>
          <td>{guest.cardNumber}</td>
          <td className={numeric}>{guest.purchaseCount}</td>
          <td className={numeric}>{formatPartyKronor(guest.totalOre)}</td>
          <td>{guest.checkIn ? `${at(guest.checkIn.at)} (${text.source[guest.checkIn.source]})` : ""}</td>
          <td>{guest.checkout ? `${at(guest.checkout.at)} (${text.source[guest.checkout.source]})` : ""}</td>
        </tr>)}</tbody>
      </Table>}

      <h4 className={local.subhead}>{text.purchasesTitle}</h4>
      {state.purchases.length === 0 ? <p>{text.noPurchases}</p> : <Table className={local.purchases} data-testid="party-purchases">
        <thead><tr><th scope="col">{text.when}</th><th scope="col">{text.guest}</th><th scope="col">{text.card}</th><th scope="col">{text.item}</th>
          <th scope="col" className={numeric}>{text.price}</th>{admin && <th scope="col"><span className={local.hiddenText}>{text.void}</span></th>}</tr></thead>
        <tbody>{[...state.purchases].reverse().map(row => <tr key={`${row.cardNumber}-${row.code}-${row.punchedAt}`} data-voided={row.voided ? "true" : undefined}>
          <td>{at(row.punchedAt)}</td>
          <td>{names.get(row.cardNumber) ?? text.unknownName}</td>
          <td>{row.cardNumber}</td>
          <td>{row.itemName}{row.afterCheckout ? <small className={local.flag}> {text.afterCheckout}</small> : null}
            {row.voided ? <small className={local.flag}> {text.voided(row.voided.reason)}</small> : null}</td>
          <td className={numeric}>{formatPartyKronor(row.priceOre)}</td>
          {admin && <td>{!row.voided && <Button variant="secondary" disabled={busy} aria-label={text.voidLabel(row.itemName, row.cardNumber)}
            onClick={() => {
              const reason = window.prompt(text.voidReason)?.trim();
              if (reason) void change({ kind: "void", cardNumber: row.cardNumber, code: row.code, punchedAt: row.punchedAt, reason: reason.slice(0, 300) });
            }}>{text.void}</Button>}</td>}
        </tr>)}</tbody>
      </Table>}
    </Section>

    <Section id={`party-export-${raceId}`} title={text.exportTitle} help={text.exportHelp} headingLevel={3}>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => download(`fest-summering-${stamp}.csv`, partySummaryCsv(ledger, state.timeZone))}>{text.exportSummary}</Button>
        <Button variant="secondary" onClick={() => download(`fest-kop-${stamp}.csv`, partyPurchasesCsv(ledger, state.timeZone))}>{text.exportPurchases}</Button>
      </div>
    </Section>
  </div>;
}

function StartForm({ state, busy, onSave }: { state: PartyStateResponse; busy: boolean;
  onSave: (startsAt: string, names: boolean, doublePunchSeconds: number) => Promise<boolean> }) {
  const current = state.startsAt ? formatPartyTime(state.startsAt, state.timeZone) : undefined;
  const today = formatPartyTime(new Date().toISOString(), state.timeZone).slice(0, 10);
  const [date, setDate] = useState(current?.slice(0, 10) ?? today);
  const [clock, setClock] = useState(current?.slice(11, 16) ?? "17:00");
  const [names, setNames] = useState(state.showPublicNames);
  const [double, setDouble] = useState(String(state.doublePunchSeconds ?? 5));
  const [error, setError] = useState<string>();
  return <form noValidate className={local.form} aria-label={text.settingsTitle} onSubmit={event => {
    event.preventDefault();
    const startsAt = parseRaceClock(date, clock, state.timeZone);
    if (!startsAt) { setError(text.invalidStart); return; }
    const seconds = /^\d{1,3}$/.test(double.trim()) ? Number(double.trim()) : NaN;
    if (!(seconds >= 0 && seconds <= 600)) { setError(text.invalidDouble); return; }
    setError(undefined); void onSave(new Date(startsAt).toISOString(), names, seconds);
  }}>
    <h3>{text.settingsTitle}</h3>
    <p className={styles.workflowHelp}>{text.settingsHelp}</p>
    <div className={local.fields}>
      <label>{text.date}<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>{text.time}<input type="text" inputMode="numeric" value={clock} aria-invalid={error ? true : undefined}
        onChange={event => setClock(event.target.value)} /></label>
      <label>{text.doublePunch}<input type="text" inputMode="numeric" value={double} onChange={event => setDouble(event.target.value)} /></label>
    </div>
    <p className={styles.workflowHelp}>{text.doublePunchHelp}</p>
    <label className={local.check}><input type="checkbox" checked={names} onChange={event => setNames(event.target.checked)} />
      {text.publicNames}</label>
    <p className={styles.workflowHelp}>{text.publicNamesHelp}</p>
    {error && <p role="alert" className={local.error}>{error}</p>}
    <div><Button type="submit" disabled={busy}>{text.saveSettings}</Button></div>
  </form>;
}

function AddItemForm({ busy, onAdd }: { busy: boolean; onAdd: (code: number, name: string, priceOre: number, group: string | null) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string>();
  return <form noValidate className={local.form} aria-label={text.addItem} onSubmit={event => {
    event.preventDefault();
    const number = /^\d{1,3}$/.test(code.trim()) ? Number(code.trim()) : NaN;
    const ore = parseKronor(price);
    if (!(number >= 1 && number <= 999) || !name.trim() || ore === undefined) { setError(text.invalidItem); return; }
    setError(undefined);
    void onAdd(number, name.trim(), ore, group.trim() || null).then(ok => { if (ok) { setCode(""); setName(""); setPrice(""); } });
  }}>
    <div className={local.fields}>
      <label>{text.code}<input type="text" inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} /></label>
      <label>{text.name}<input type="text" value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{text.price}<input type="text" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label>{text.group}<input type="text" maxLength={40} value={group} placeholder="Drink" onChange={event => setGroup(event.target.value)} /></label>
    </div>
    {error && <p role="alert" className={local.error}>{error}</p>}
    <div><Button type="submit" disabled={busy}>{text.addItem}</Button></div>
  </form>;
}

function ItemRow({ item, busy, onSave }: { item: PartyStateResponse["items"][number]; busy: boolean;
  onSave: (name: string, priceOre: number, hidden: boolean, group: string | null) => Promise<boolean> }) {
  const [name, setName] = useState(item.name);
  const [group, setGroup] = useState(item.group ?? "");
  const [price, setPrice] = useState(formatPartyKronor(item.priceOre));
  const [hidden, setHidden] = useState(item.hidden);
  const ore = parseKronor(price);
  const changed = name.trim() !== item.name || ore !== item.priceOre || hidden !== item.hidden || (group.trim() || null) !== (item.group ?? null);
  return <tr>
    <td className={numeric}>{item.code}</td>
    <td><input className={local.input} aria-label={`${text.itemLabel(item.code)}: ${text.name}`} value={name} onChange={event => setName(event.target.value)} /></td>
    <td className={numeric}><input className={local.number} aria-label={`${text.itemLabel(item.code)}: ${text.price}`} inputMode="decimal" value={price}
      aria-invalid={ore === undefined ? true : undefined} onChange={event => setPrice(event.target.value)} /></td>
    <td><input className={local.input} aria-label={`${text.itemLabel(item.code)}: ${text.groupShort}`} value={group} maxLength={40}
      onChange={event => setGroup(event.target.value)} /></td>
    <td><input type="checkbox" aria-label={`${text.itemLabel(item.code)}: ${text.hidden}`} checked={hidden} onChange={event => setHidden(event.target.checked)} /></td>
    <td><Button variant="secondary" disabled={busy || !changed || ore === undefined || !name.trim()}
      onClick={() => { if (ore !== undefined) void onSave(name.trim(), ore, hidden, group.trim() || null); }}>{text.saveItem}</Button></td>
  </tr>;
}

function GuestName({ guest, busy, onSave }: { guest: PartyStateResponse["guests"][number]; busy: boolean;
  onSave: (name: string, club: string, displayName: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(guest.name ?? "");
  const [club, setClub] = useState(guest.club ?? "");
  const [displayName, setDisplayName] = useState(guest.displayName ?? "");
  if (!open) return <span className={local.guestName}><strong>{guest.name ?? text.unknownName}</strong>{guest.club ? ` · ${guest.club}` : ""}
    <button type="button" className={local.linkButton} onClick={() => setOpen(true)}>{guest.name ? text.rename : text.setName}</button></span>;
  return <form noValidate className={local.inline} onSubmit={event => {
    event.preventDefault();
    if (name.trim()) void onSave(name, club, displayName).then(ok => { if (ok) setOpen(false); });
  }}>
    <input className={local.input} aria-label={text.nameLabel(guest.cardNumber)} value={name} onChange={event => setName(event.target.value)} />
    <input className={local.input} aria-label={text.clubLabel(guest.cardNumber)} placeholder={text.club} value={club} onChange={event => setClub(event.target.value)} />
    <input className={local.input} aria-label={text.displayNameLabel(guest.cardNumber)} maxLength={PARTY_DISPLAY_NAME_MAX}
      placeholder={name.trim() ? partyDefaultDisplayName(name) : text.displayName} value={displayName} onChange={event => setDisplayName(event.target.value)} />
    <Button type="submit" disabled={busy || !name.trim()}>{text.saveName}</Button>
    <Button variant="secondary" onClick={() => setOpen(false)}>{text.cancel}</Button>
  </form>;
}

