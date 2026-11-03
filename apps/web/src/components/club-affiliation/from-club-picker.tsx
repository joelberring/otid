"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClubInviteContext, ClubInviteFromClubResponse, ClubPickerResponse } from "@o-tid/contracts";
import { normalizeClubSearch } from "@o-tid/domain";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import { affiliationRequest as clubRequest } from "../../lib/club-affiliation-client";
import { Button, Notice } from "../ui";
import styles from "./club-affiliation.module.css";

const text = clubAffiliationSv.fromClub;

/**
 * ADR-0209 beslut 3: "Från klubben" bredvid fältet för e-postadressen. En sökbar lista med bekräftade medlemmar i den inloggades
 * klubbar; att välja dem skapar inbjudningar för deras adress genom samma väg som adressfältet (servern slår upp adressen, den
 * syns aldrig här). Rollen väljs i formuläret bredvid (`role`). Visas inte när det inte finns någon att bjuda in.
 */
export function FromClubPicker({ context, role, roleLabel, disabled, onInvited }: { context: ClubInviteContext; role: string; roleLabel?: string;
  disabled?: boolean; onInvited: () => Promise<void> | void }) {
  const [data, setData] = useState<ClubPickerResponse>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  const { kind, id } = context;
  const load = useCallback(async () => {
    const result = await clubRequest(`/api/organizer/club-picker?kind=${kind}&id=${encodeURIComponent(id)}`);
    if (result.status === 200) setData(result.json as ClubPickerResponse);
  }, [kind, id]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const needle = normalizeClubSearch(query);
    return (data?.members ?? []).filter(member => !needle || normalizeClubSearch(member.displayName).includes(needle));
  }, [data, query]);

  async function invite() {
    setBusy(true); setMessage(undefined);
    const result = await clubRequest("/api/organizer/club-picker", "POST", { formatVersion: 1, requestId: crypto.randomUUID(), context, refs: selected, role });
    setBusy(false);
    if (result.status !== 200) { setMessage({ tone: "error", text: text.failed }); return; }
    const response = result.json as ClubInviteFromClubResponse;
    setMessage({ tone: response.failed > 0 ? "error" : "ok", text: response.failed > 0 ? text.failed : text.invited(response.invited, response.already) });
    setSelected([]);
    await load();
    await onInvited();
  }

  if (!data || data.members.length === 0) return null;
  return <details className={styles.panel} data-testid="from-club">
    <summary>{text.open}</summary>
    <p className={styles.muted}>{text.help}</p>
    <label className={styles.form}>{text.search}
      <input value={query} autoComplete="off" maxLength={120} onChange={event => setQuery(event.target.value)} disabled={busy || disabled} />
    </label>
    {shown.length === 0 ? <p className={styles.muted}>{text.none}</p> : <ul className={styles.checklist} aria-label={text.title}>
      {shown.map(member => <li key={member.ref}><label>
        <input type="checkbox" checked={selected.includes(member.ref)} disabled={busy || disabled || member.already}
          onChange={event => setSelected(value => event.target.checked ? [...value, member.ref] : value.filter(ref => ref !== member.ref))} />
        <span>{member.displayName} <small>· {member.clubName}{member.already ? ` · ${text.already}` : ""}</small></span>
      </label></li>)}
    </ul>}
    <div className={styles.actions}>
      <Button disabled={busy || disabled || selected.length === 0} onClick={() => void invite()}>
        {text.invite(selected.length)}{roleLabel ? ` · ${roleLabel}` : ""}</Button>
    </div>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </details>;
}
