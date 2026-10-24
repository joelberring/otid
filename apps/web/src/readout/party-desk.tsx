import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PartyPackage, PartyStateResponse, ReadoutPackage } from "@o-tid/contracts";
import { formatPartyKronor, type PartyPurchase } from "@o-tid/domain";
import { stationClock, type SimulatedCard } from "@o-tid/sportident";
import type { FakeStationTransport } from "./fake-transport";
import { cardEvening, cardNearlyFull, decideReadout, guestName, type DeskKnowledge, type DeskMode, type DeskOutcome } from "./party-logic";
import type { PartyAction, QueuedPartyAction } from "./party-store";
import { fetchPartyState } from "./party-sync";
import { partyText as t } from "./party-text-sv";
import { runnerForCard } from "./runner-lookup";
import type { QueuedReadout } from "./store";
import type { ReadoutSoundKind } from "./sound";
import { PartyNameBox } from "./party-name-box";
import { partyThemeStyle } from "../lib/party-theme-style";

/**
 * Bardisken (PLAN.md steg 40): avläsningssidan för en fest, i ett fönster som gästerna sköter själva. Stationen, kön och
 * synken är avläsningens; här finns beskedet efter varje utläsning, namnrutan vid okänd bricka och personalens lägen.
 */
const POLL_MS = 5_000;
const STAFF_TIMEOUT_MS = 30_000;
const NAME_TIMEOUT_MS = 60_000;
const ADVANCE_MS = 3_000;

export interface PartyDeskProps {
  readonly raceId: string;
  readonly pkg: ReadoutPackage;
  readonly items: readonly QueuedReadout[];
  readonly actions: readonly QueuedPartyAction[];
  readonly reading?: number | undefined;
  readonly failure?: string | undefined;
  readonly online: boolean;
  readonly addAction: (action: PartyAction) => Promise<void>;
  readonly play: (kind: ReadoutSoundKind) => void;
  readonly exercise?: FakeStationTransport | undefined;
  /** Stationens knappar, statusraden och länkarna: bara under Personal i automatiskt läge (kiosk). */
  readonly staffArea: ReactNode;
  readonly statusArea: ReactNode;
}

function time(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export function PartyDesk(props: PartyDeskProps) {
  const { raceId, pkg, items, actions, addAction, play } = props;
  const party = pkg.party!;
  const timeZone = pkg.event.timeZone;
  const [server, setServer] = useState<PartyStateResponse>();
  const [mode, setMode] = useState<DeskMode>("AUTO");
  const [staff, setStaff] = useState(false);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<number, DeskOutcome>>(new Map());
  const [shown, setShown] = useState<number>();
  const [waiting, setWaiting] = useState<number[]>([]);
  const [naming, setNaming] = useState<{ card: string; localSequence: number }>();
  const mountedAt = useRef(Date.now());
  const seen = useRef(new Set<number>());
  // Brickor där gästen tryckt "Hoppa över": namnrutan visas inte igen i kväll (köpen sparas ändå).
  const skipped = useRef(new Set<string>());
  // Servern har den senaste varulistan och starten; paketet räcker utan nät.
  const effectiveParty = useMemo(() => server ? { startsAt: server.startsAt, items: server.items, doublePunchSeconds: server.doublePunchSeconds }
    : party, [server, party]);
  const knowledge: DeskKnowledge = useMemo(() => ({ party: effectiveParty, server, readouts: items, actions }),
    [effectiveParty, server, items, actions]);
  const knowledgeRef = useRef(knowledge);
  knowledgeRef.current = knowledge;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const namingRef = useRef(naming);
  namingRef.current = naming;

  const poll = useCallback(async () => {
    if (!navigator.onLine) return;
    const outcome = await fetchPartyState(raceId);
    if (outcome.kind === "ok") setServer(outcome.value);
  }, [raceId]);
  useEffect(() => {
    void poll().catch(() => undefined);
    const timer = setInterval(() => { void poll().catch(() => undefined); }, POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  // Personalens läge går tillbaka till automatiskt efter 30 sekunder.
  useEffect(() => {
    if (!staff && mode === "AUTO") return;
    const timer = setTimeout(() => { setStaff(false); setMode("AUTO"); }, STAFF_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [staff, mode, shown]);

  const display = useCallback((localSequence: number) => {
    setShown(localSequence);
    const outcome = outcomesRef.current.get(localSequence);
    if (!outcome) return;
    const known = guestName(outcome.cardNumber, knowledgeRef.current) ?? runnerForCard(pkg, outcome.cardNumber);
    if (!known && !skipped.current.has(outcome.cardNumber)) setNaming({ card: outcome.cardNumber, localSequence });
    play(outcome.kind === "NO_NEW" || outcome.kind === "ALREADY_IN" ? "neutral" : "ok");
  }, [play, pkg]);
  const outcomesRef = useRef(outcomes);
  outcomesRef.current = outcomes;

  // Nya utläsningar: beslutet tas en gång, när utläsningen kommer; visas direkt eller efter namnrutan.
  useEffect(() => {
    const fresh = items.filter(item => !seen.current.has(item.localSequence) && Date.parse(item.stationReceivedAt) >= mountedAt.current - 2_000)
      .sort((left, right) => left.localSequence - right.localSequence);
    for (const item of items) seen.current.add(item.localSequence);
    if (fresh.length === 0) return;
    const next = new Map(outcomesRef.current);
    for (const item of fresh) {
      const outcome = decideReadout(item, modeRef.current, knowledgeRef.current);
      next.set(item.localSequence, outcome);
      if (outcome.enqueue) {
        const kind = outcome.enqueue;
        const exists = knowledgeRef.current.actions.some(row => row.action.kind === "desk" && row.action.request.deviceId === item.deviceId &&
          row.action.request.localSequence === item.localSequence && row.action.request.kind === kind);
        if (!exists) void addAction({ kind: "desk", request: { formatVersion: 1, deviceId: item.deviceId, localSequence: item.localSequence,
          cardNumber: item.payload.cardNumber, kind, at: kind === "CHECK_OUT" ? outcome.checkedOutAt ?? item.stationReceivedAt : outcome.checkedInAt ?? item.stationReceivedAt } });
      }
      // Brickan finns i löpardatabasen: namnet sparas direkt ("Inte du? Ändra" rättar).
      const runner = runnerForCard(pkg, item.payload.cardNumber);
      if (runner && !guestName(item.payload.cardNumber, knowledgeRef.current)) {
        void addAction({ kind: "guest", request: { formatVersion: 1, cardNumber: item.payload.cardNumber,
          name: `${runner.givenName} ${runner.familyName}`, club: runner.club ?? null } });
      }
    }
    outcomesRef.current = next;
    setOutcomes(next);
    const sequences = fresh.map(item => item.localSequence);
    if (namingRef.current) setWaiting(rows => [...rows, ...sequences]);
    else {
      display(sequences[0]!);
      if (sequences.length > 1) setWaiting(rows => [...rows, ...sequences.slice(1)]);
    }
  }, [items, addAction, display, pkg]);

  // Väntande utläsningar visas en i taget när namnrutan är stängd.
  useEffect(() => {
    if (naming || waiting.length === 0) return;
    const timer = setTimeout(() => {
      const [head, ...rest] = waiting;
      setWaiting(rest);
      if (head !== undefined) display(head);
    }, shown === undefined ? 0 : ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [naming, waiting, display, shown]);

  // Namnrutan stängs själv efter 60 sekunder; köpen finns kvar på brickan.
  useEffect(() => {
    if (!naming) return;
    const timer = setTimeout(() => setNaming(undefined), NAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [naming]);

  const outcome = shown === undefined ? undefined : outcomes.get(shown);
  const shownItem = shown === undefined ? undefined : items.find(item => item.localSequence === shown);
  const startsAt = effectiveParty.startsAt;
  const notStarted = startsAt && Date.parse(startsAt) > Date.now() ? time(startsAt, timeZone) : undefined;
  const kiosk = mode === "AUTO" && !staff;

  async function saveName(card: string, name: string, club: string | null, displayName: string | null) {
    await addAction({ kind: "guest", request: { formatVersion: 1, cardNumber: card, name, club, displayName } });
    setNaming(undefined);
  }

  const theme = server?.theme ?? party.theme;
  return <div className="party" data-mode={mode} style={partyThemeStyle(theme)}>
    <div className="party-band">
      {theme?.logo ? <img src={theme.logo} alt="" /> : null}
      <span>{theme?.title ?? pkg.event.name}</span>
    </div>
    {!kiosk ? props.statusArea : null}
    {!startsAt ? <p className="notice" role="alert">{t.noStart}</p> : notStarted ? <p className="notice">{t.notStarted(notStarted)}</p> : null}
    {mode !== "AUTO" ? <p className="notice party-mode" role="status" data-testid="party-mode">{t.modeActive(t.modes[mode])}</p> : null}

    <section className="verdict party-verdict" aria-live="assertive" data-testid="party-verdict"
      data-kind={props.reading !== undefined ? "reading" : props.failure ? "failed" : outcome?.kind ?? "idle"}>
      {props.reading !== undefined ? <p className="big">{t.reading(props.reading)}</p>
        : props.failure ? <p className="big">✗ {props.failure}</p>
        : outcome && shownItem ? <Outcome outcome={outcome} item={shownItem} knowledge={knowledge} timeZone={timeZone}
          onRename={() => setNaming({ card: outcome.cardNumber, localSequence: outcome.localSequence })} />
        : <><p className="big">{t.insertCard}</p><p className="party-help">{t.insertHelp}</p></>}
    </section>

    {naming ? <PartyNameBox key={naming.localSequence} card={naming.card} pkg={pkg} server={server}
      current={guestName(naming.card, knowledge)} closesInMs={NAME_TIMEOUT_MS}
      onSave={(name, club, displayName) => saveName(naming.card, name, club, displayName)} onSkip={() => { skipped.current.add(naming.card); setNaming(undefined); }} /> : null}
    {waiting.length > 0 ? <p className="hint" data-testid="party-waiting">{t.waitingToShow(waiting.length)}</p> : null}

    {props.exercise ? <PartyExercise transport={props.exercise} pkg={pkg} items={effectiveParty.items} timeZone={timeZone} /> : null}

    <section className="party-staff">
      <div className="row">
        <FullscreenButton />
        {staff ? <button type="button" onClick={() => { setStaff(false); setMode("AUTO"); }}>{t.backToAuto}</button>
          : <button type="button" className="party-staff-button" onClick={() => { if (window.confirm(t.staffConfirm)) setStaff(true); }}>{t.staff}</button>}
      </div>
      {staff ? <>
        <fieldset className="party-modes"><legend>{t.modeLabel}</legend>
          {(["AUTO", "CHECK_IN", "BUY", "CHECK_OUT"] as const).map(value => <button key={value} type="button"
            aria-pressed={mode === value} className={mode === value ? "primary" : ""} onClick={() => setMode(value)}>{t.modes[value]}</button>)}
        </fieldset>
        {props.staffArea}
      </> : null}
    </section>
  </div>;
}

function Outcome({ outcome, item, knowledge, timeZone, onRename }: { outcome: DeskOutcome; item: QueuedReadout; knowledge: DeskKnowledge;
  timeZone: string; onRename: () => void }) {
  const name = guestName(outcome.cardNumber, knowledge);
  const evening = cardEvening(outcome.cardNumber, knowledge);
  const fresh = new Set(outcome.newPurchases.map(row => `${row.code}:${Date.parse(row.punchedAt)}`));
  const earlier = evening.purchases.filter(row => !fresh.has(`${row.code}:${Date.parse(row.punchedAt)}`));
  const full = cardNearlyFull(item);
  const checkedOut = outcome.checkedOutAt ?? knowledge.server?.guests.find(guest => guest.cardNumber === outcome.cardNumber)?.checkout?.at;
  const headline = outcome.kind === "WELCOME" ? `✓ ${t.welcome(name)}`
    : outcome.kind === "ALREADY_IN" ? t.alreadyIn(time(outcome.checkedInAt!, timeZone))
    : outcome.kind === "CHECKED_OUT" ? `✓ ${t.checkedOut(time(outcome.checkedOutAt!, timeZone))}`
    : outcome.kind === "NO_NEW" ? t.noNew : `✓ ${t.newPurchases(outcome.newPurchases.length)}`;
  const row = (purchase: PartyPurchase) => <li key={`${purchase.code}-${purchase.punchedAt}`} data-voided={purchase.voided ? "true" : undefined}>
    <span>{purchase.itemName}</span> <span>{formatPartyKronor(purchase.priceOre)} kr</span> <span>{time(purchase.punchedAt, timeZone)}</span>
    {purchase.voided ? <small> ({t.voided})</small> : null}
    {checkedOut && Date.parse(purchase.punchedAt) > Date.parse(checkedOut) ? <small> ({t.afterCheckout})</small> : null}
  </li>;
  return <div className="party-outcome">
    <p className="big" data-testid="party-headline">{headline}</p>
    <p className="card">{name && outcome.kind !== "WELCOME" ? `${name} · ` : ""}{t.card(outcome.cardNumber)}
      {name ? <> · <button type="button" className="link" onClick={onRename}>{t.notYou}</button></> : null}</p>
    {outcome.newPurchases.length > 0 ? <ul className="party-new" data-testid="party-new">
      {outcome.newPurchases.map(purchase => <li key={`${purchase.code}-${purchase.punchedAt}`}>
        {t.newRow(purchase.itemName, time(purchase.punchedAt, timeZone))}</li>)}</ul> : null}
    <p className="party-total" data-testid="party-total">{t.total(formatPartyKronor(evening.totalOre))}</p>
    {earlier.length > 0 ? <><h2>{t.earlier}</h2><ul className="party-earlier">{earlier.map(row)}</ul></> : null}
    {full ? <p className="notice" role="alert">{t.nearlyFull(full.punches, full.capacity)}</p> : null}
    <p className="sync">{item.status === "pending" ? t.savedLocally : t.sent}</p>
  </div>;
}

function FullscreenButton() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const change = () => setActive(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  if (typeof document === "undefined" || !document.fullscreenEnabled) return null;
  return <button type="button" onClick={() => {
    const done = active ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    done.catch((error: unknown) => window.alert(error instanceof Error ? error.message : String(error)));
  }}>{active ? t.exitFullscreen : t.fullscreen}</button>;
}

/** Övningsstationen för en fest: en påhittad bricka som stämplas på varornas koder och läses ut. */
function PartyExercise({ transport, pkg, items, timeZone }: { transport: FakeStationTransport; pkg: ReadoutPackage;
  items: PartyPackage["items"]; timeZone: string }) {
  const [card, setCard] = useState(() => newCardNumber());
  const [punches, setPunches] = useState<{ code: number; at: Date }[]>([]);
  const [finish, setFinish] = useState<Date>();
  const databaseCard = pkg.runnerLookup?.runners.flatMap(runner => runner.cards).find(Boolean);
  function read() {
    const clock = (value: Date) => stationClock(value, timeZone);
    const simulated: SimulatedCard = { cardType: "SIAC", cardNumber: card,
      punches: punches.map(punch => ({ code: punch.code, time: clock(punch.at) })), ...(finish ? { finish: clock(finish) } : {}) };
    transport.insert(simulated, new Date());
  }
  function guest(number: number) { setCard(number); setPunches([]); setFinish(undefined); }
  return <section className="exercise" aria-label={t.exerciseTitle}>
    <h2>{t.exerciseTitle}</h2>
    <p>{t.exerciseHelp}</p>
    <p data-testid="party-exercise-card">{t.exerciseCard(card)}</p>
    <div className="row">
      {items.filter(item => !item.hidden).map(item => <button key={item.id} type="button"
        onClick={() => setPunches(rows => [...rows, { code: item.code, at: new Date(Date.now() - 1_000) }])}>{t.exercisePunch(item.code, item.name)}</button>)}
      <button type="button" onClick={() => setFinish(new Date(Date.now() - 1_000))}>{t.exerciseFinish}</button>
      <button type="button" className="primary" onClick={read}>{t.exerciseRead}</button>
    </div>
    <div className="row">
      <button type="button" onClick={() => guest(newCardNumber())}>{t.exerciseNewGuest}</button>
      {databaseCard ? <button type="button" onClick={() => guest(Number(databaseCard))}>{t.exerciseDatabaseGuest}</button> : null}
    </div>
  </section>;
}

/** En SIAC-bricka (8 000 000–8 999 999) som inte är någons. */
function newCardNumber(): number {
  return 8_100_000 + Math.floor(Math.random() * 800_000);
}
