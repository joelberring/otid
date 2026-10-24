import { useEffect, useMemo, useState } from "react";
import type { PartyStateResponse, ReadoutPackage } from "@o-tid/contracts";
import { PARTY_DISPLAY_NAME_MAX, partyDefaultDisplayName, partyDisplayName } from "@o-tid/domain";
import { foldText, runnerForCard, searchRunners } from "./runner-lookup";
import { partyText as t } from "./party-text-sv";

/**
 * Namnrutan vid okänd bricka (PLAN.md steg 40): förslag ur löpardatabasen (paketets, även utan nät) och festens gäster,
 * sökbart på för- och efternamn. Ett förslag som har just den här brickan står först och är förvalt. Annars skriver
 * gästen förnamn, efternamn och klubb. Köpen är redan sparade; rutan sparar bara namnet.
 */
type Suggestion = { key: string; name: string; label?: string | undefined; displayName?: string; club: string | null; exact: boolean };

export function PartyNameBox({ card, pkg, server, current, closesInMs, onSave, onSkip }: { card: string; pkg: ReadoutPackage;
  server: PartyStateResponse | undefined; current: string | undefined; closesInMs: number;
  onSave: (name: string, club: string | null, displayName: string | null) => Promise<void>; onSkip: () => void }) {
  const exact = runnerForCard(pkg, card);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | undefined>(exact ? "exact" : undefined);
  const [given, setGiven] = useState("");
  const [family, setFamily] = useState("");
  const [club, setClub] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string>();
  const [left, setLeft] = useState(Math.round(closesInMs / 1_000));
  useEffect(() => {
    const timer = setInterval(() => setLeft(value => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, []);
  const suggestions = useMemo(() => {
    const rows: Suggestion[] = [];
    if (exact) rows.push({ key: "exact", name: `${exact.givenName} ${exact.familyName}`, club: exact.club ?? null, exact: true });
    const words = foldText(query).split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.join("").length >= 2) {
      for (const guest of server?.guests ?? []) {
        if (!guest.name || guest.cardNumber === card) continue;
        const names = foldText(guest.name).split(/[\s-]+/);
        if (words.every(word => names.some(name => name.startsWith(word)))) {
          // Steg 41: kvällens gäster visas med visningsnamnet på kioskskärmen; det fulla namnet sparas.
          rows.push({ key: `guest:${guest.cardNumber}`, name: guest.name, label: partyDisplayName(guest), club: guest.club ?? null, exact: false,
            ...(guest.displayName ? { displayName: guest.displayName } : {}) });
        }
      }
      for (const runner of searchRunners(pkg, query)) {
        const name = `${runner.givenName} ${runner.familyName}`;
        if (!rows.some(row => row.name === name && row.club === (runner.club ?? null))) {
          rows.push({ key: `runner:${runner.personId ?? name}`, name, club: runner.club ?? null, exact: false });
        }
      }
    }
    return rows.slice(0, 8);
  }, [exact, query, server, pkg, card]);

  async function submit() {
    const chosen = suggestions.find(row => row.key === selected);
    const displayName = nickname.trim() ? nickname.trim().slice(0, PARTY_DISPLAY_NAME_MAX) : null;
    if (chosen) { await onSave(chosen.name, chosen.club, displayName ?? chosen.displayName ?? null); return; }
    const name = `${given.trim()} ${family.trim()}`.trim();
    if (!given.trim() || !family.trim()) { setError(t.nameMissing); return; }
    await onSave(name, club.trim() || null, displayName);
  }

  return <section className="party-name" aria-label={t.nameTitle} data-testid="party-name">
    <h2>{t.nameTitle}</h2>
    <p>{t.nameHelp} {t.card(card)}{current ? ` · ${current}` : ""}</p>
    <form noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>{t.search}<input type="search" value={query} autoComplete="off" onChange={event => { setQuery(event.target.value); }} /></label>
      {suggestions.length > 0 ? <fieldset><legend>{t.suggestions}</legend>
        {suggestions.map(row => <label key={row.key} className="party-suggestion">
          <input type="radio" name="party-suggestion" checked={selected === row.key} onChange={() => setSelected(row.key)} />
          <span><strong>{row.label ?? row.name}</strong>{row.club ? ` · ${row.club}` : ""}{row.exact ? ` · ${t.cardMatch}` : ""}</span>
        </label>)}
      </fieldset> : null}
      <div className="party-name-fields">
        <label>{t.givenName}<input value={given} autoComplete="off" onChange={event => { setGiven(event.target.value); setSelected(undefined); }} /></label>
        <label>{t.familyName}<input value={family} autoComplete="off" onChange={event => { setFamily(event.target.value); setSelected(undefined); }} /></label>
        <label>{t.club}<input value={club} autoComplete="off" onChange={event => setClub(event.target.value)} /></label>
        <label>{t.displayName}<input value={nickname} autoComplete="off" maxLength={PARTY_DISPLAY_NAME_MAX}
          placeholder={given.trim() ? partyDefaultDisplayName(`${given} ${family}`) : t.displayNamePlaceholder}
          onChange={event => setNickname(event.target.value)} /></label>
      </div>
      {error ? <p role="alert" className="notice">{error}</p> : null}
      <div className="row">
        <button type="submit" className="primary">{t.save}</button>
        <button type="button" onClick={onSkip}>{t.skip}</button>
      </div>
      <p className="hint">{t.closesIn(left)}</p>
    </form>
  </section>;
}
