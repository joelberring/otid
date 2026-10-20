import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { ReadoutPackage, RunnerSearchRequest, RunnerSearchResponse, RunnerSuggestion, SportidentReadoutPayload } from "@o-tid/contracts";
import { validateReadoutRegistration, type FieldErrors, type ReadoutRegistrationInput } from "../lib/form-validation";
import type { QueuedReadout, QueuedRegistration } from "./store";
import {
  classSuggestions, clubByName, entrySuggestions, foldText, runnerForCard, runnerIndex, runnerLabel, searchRunners, type EntrySuggestion
} from "./runner-lookup";
import { readoutText as t } from "./text-sv";

type Fields = ReadoutRegistrationInput;
const EMPTY: Fields = { classId: "", givenName: "", familyName: "", club: "" };

/** Det som skickas: fälten och, när de kommer ur löpardatabasen, Eventors id för personen och klubben. */
export type RegistrationFields = Fields & { readonly eventorPersonId?: string; readonly eventorOrganisationId?: string };

/** Klasserna man kan direktanmäla till: inte stafett (sträckor läggs till som lag). */
export function registrationClasses(pkg: ReadoutPackage) {
  const relay = new Set(pkg.relay?.classes.map((raceClass) => raceClass.classId) ?? []);
  return pkg.raceSnapshot.classes.filter((raceClass) => !relay.has(raceClass.id))
    .sort((left, right) => left.name.localeCompare(right.name, "sv"));
}

function fromRunner(runner: RunnerSuggestion, classId: string): Fields {
  return { classId, givenName: runner.givenName, familyName: runner.familyName, club: runner.club ?? "" };
}

/** Eventors id gäller bara så länge fälten är som löparen i databasen (och klubben som en känd klubb). */
function eventorIds(pkg: ReadoutPackage, fields: Fields, chosen: RunnerSuggestion | undefined) {
  const sameName = chosen && foldText(chosen.givenName) === foldText(fields.givenName) && foldText(chosen.familyName) === foldText(fields.familyName);
  const clubId = chosen?.clubId && chosen.club && foldText(chosen.club) === foldText(fields.club) ? chosen.clubId : clubByName(pkg, fields.club)?.id;
  return { ...(sameName && chosen.personId ? { eventorPersonId: chosen.personId } : {}), ...(clubId ? { eventorOrganisationId: clubId } : {}) };
}

/**
 * Direktanmälan av en okänd bricka på avläsningssidan (PLAN.md steg 25): stort och enkelt, med svenska fältfel vid
 * fälten. "Lägg till" köar anmälan i webbläsaren; beskedet bedöms om direkt mot den nya löparen.
 *
 * PLAN.md steg 29: namn och klubb fylls i ur löpardatabasen när brickan finns där, klassen vars bana passar
 * stämplingarna förväljs, och anmälda utan bricka eller utan avläsning i de klasserna föreslås överst. Namnfälten
 * föreslår löpare och klubbfältet klubbar. Allt fungerar offline mot paketet; `search` (när nätet finns och hela landet
 * ligger på servern) kompletterar. Funktionären väljer alltid själv.
 */
export function RegistrationForm({ pkg, cardNumber, payload, items, registrations, search, onSubmit, onLink }: {
  pkg: ReadoutPackage; cardNumber: string; payload: Pick<SportidentReadoutPayload, "punches">; items: readonly QueuedReadout[];
  registrations: readonly QueuedRegistration[]; search: ((request: RunnerSearchRequest) => Promise<RunnerSearchResponse | undefined>) | undefined;
  onSubmit: (fields: RegistrationFields) => Promise<void>; onLink: (entry: EntrySuggestion) => Promise<void> }) {
  const classes = useMemo(() => registrationClasses(pkg), [pkg]);
  const classIds = useMemo(() => new Set(classes.map((raceClass) => raceClass.id)), [classes]);
  const local = runnerForCard(pkg, cardNumber);
  const [serverRunner, setServerRunner] = useState<RunnerSuggestion>();
  const runner = local ?? serverRunner;
  const fits = useMemo(() => classSuggestions(pkg, payload, classIds, runner?.sex), [pkg, payload, classIds, runner?.sex]);
  const fitting = fits.filter((row) => row.fit.ok);
  const [fields, setFields] = useState<Fields>(() => local ? fromRunner(local, fitting[0]?.fit.classId ?? "")
    : { ...EMPTY, classId: fitting[0]?.fit.classId ?? "" });
  const [chosen, setChosen] = useState<RunnerSuggestion | undefined>(local);
  const [typing, setTyping] = useState(false);
  const [serverMatches, setServerMatches] = useState<RunnerSuggestion[]>([]);
  const [errors, setErrors] = useState<FieldErrors<keyof Fields>>({});
  const [saving, setSaving] = useState(false);
  const edited = useRef(false);
  const classChosen = useRef(false);
  // Avläsningen kan komma fram efter första ritningen: klassen som passar förväljs när den blir känd, om ingen valt själv.
  const firstFit = fitting[0]?.fit.classId;
  useEffect(() => {
    if (firstFit && !classChosen.current) setFields((value) => value.classId ? value : { ...value, classId: firstFit });
  }, [firstFit]);
  const suggestionsForEntries = useMemo(() => entrySuggestions(pkg, fits, items, registrations, runner),
    [pkg, fits, items, registrations, runner]);

  // Hela landet ligger på servern: brickan söks där när den inte finns i paketet (bara med nät).
  useEffect(() => {
    if (local || !search) return;
    let current = true;
    void search({ formatVersion: 1, kind: "CARD", cardNumber }).then((result) => {
      const found = result?.runners[0];
      if (!current || !found) return;
      setServerRunner(found);
      if (!edited.current) { setFields((value) => ({ ...fromRunner(found, value.classId) })); setChosen(found); }
    });
    return () => { current = false; };
  }, [cardNumber, local, search]);

  const query = `${fields.givenName} ${fields.familyName}`.trim();
  useEffect(() => {
    if (!search || !typing || query.length < 2) { setServerMatches([]); return; }
    let current = true;
    const timer = setTimeout(() => {
      void search({ formatVersion: 1, kind: "NAME", text: query }).then((result) => { if (current) setServerMatches(result?.runners ?? []); });
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [query, search, typing]);

  const matches = useMemo(() => {
    if (!typing) return [];
    const found = searchRunners(pkg, query);
    const key = (row: RunnerSuggestion) => row.personId ?? `${row.givenName} ${row.familyName} ${row.club ?? ""}`;
    const seen = new Set(found.map(key));
    return [...found, ...serverMatches.filter((row) => !seen.has(key(row)))].slice(0, 6);
  }, [pkg, query, serverMatches, typing]);
  const clubs = runnerIndex(pkg).clubs;

  const set = (key: keyof Fields) => (event: { target: { value: string } }) => {
    edited.current = true;
    if (key === "classId") classChosen.current = true;
    if (key === "givenName" || key === "familyName") setTyping(true);
    setFields((value) => ({ ...value, [key]: event.target.value }));
    setErrors((value) => ({ ...value, [key]: undefined }));
  };
  function choose(row: RunnerSuggestion) {
    edited.current = true;
    setChosen(row); setTyping(false);
    setFields((value) => fromRunner(row, value.classId));
    setErrors({});
    document.getElementById("register-classId")?.focus();
  }
  async function submit() {
    const found = validateReadoutRegistration(fields);
    setErrors(found);
    const first = (Object.keys(found) as (keyof Fields)[]).find((key) => found[key]);
    if (first) { document.getElementById(`register-${first}`)?.focus(); return; }
    setSaving(true);
    try { await onSubmit({ ...fields, ...eventorIds(pkg, fields, chosen) }); setFields(EMPTY); }
    finally { setSaving(false); }
  }
  async function link(entry: EntrySuggestion) {
    setSaving(true);
    try { await onLink(entry); } finally { setSaving(false); }
  }
  const field = (key: keyof Fields, label: string, control: ReactElement) => <div className="field">
    <label htmlFor={`register-${key}`}>{label}</label>
    {control}
    {errors[key] ? <span className="field-error" id={`register-${key}-error`}><span aria-hidden="true">✗ </span>{errors[key]}</span> : null}
  </div>;
  const described = (key: keyof Fields) => errors[key] ? { "aria-invalid": true as const, "aria-describedby": `register-${key}-error` } : {};
  if (classes.length === 0) return <section className="register" aria-label={t.register.title(cardNumber)}><p>{t.register.noClasses}</p></section>;
  const fitsText = fitting.length > 0 ? t.register.fits(fitting.slice(0, 4).map((row) => t.register.classWithCourse(row.className, row.courseName)))
    : fits[0] && fits[0].fit.missingControls.length > 0 && payload.punches.length > 0
      ? t.register.closest(t.register.classWithCourse(fits[0].className, fits[0].courseName), fits[0].fit.missingControls) : undefined;
  const okClasses = new Set(fitting.map((row) => row.fit.classId));
  return <form className="register" noValidate aria-label={t.register.title(cardNumber)} data-testid="register-form"
    onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h2>{t.register.title(cardNumber)}</h2>
    {suggestionsForEntries.length > 0 ? <section className="register-entries" aria-label={t.register.entriesTitle} data-testid="register-entries">
      <h3>{t.register.entriesTitle}</h3>
      <ul>{suggestionsForEntries.map((entry) => <li key={entry.entryId}>
        <button type="button" disabled={saving} onClick={() => { void link(entry); }}>{t.register.link(entry.name)}</button>
        <span>{t.register.linkDetail(entry.className, entry.cardNumber)}</span>
      </li>)}</ul>
      <p className="help">{t.register.newRunner}</p>
    </section> : null}
    {runner ? <p className="register-note" data-testid="register-runner">{t.register.found(cardNumber, `${runner.givenName} ${runner.familyName}`,
      runner.club)}</p> : null}
    {fitsText ? <p className="register-note" data-testid="register-class-fit" data-fits={fitting.length > 0 ? "yes" : "no"}>
      {fitting.length > 0 ? "✓ " : "! "}{fitsText}</p> : null}
    <p className="help">{t.register.help}</p>
    <div className="register-fields">
      {field("classId", t.register.className, <select id="register-classId" value={fields.classId} onChange={set("classId")}
        disabled={saving} {...described("classId")}>
        <option value="">{t.register.chooseClass}</option>
        {classes.map((raceClass) => <option key={raceClass.id} value={raceClass.id}>
          {okClasses.has(raceClass.id) ? t.register.classFits(raceClass.name) : raceClass.name}</option>)}
      </select>)}
      {field("givenName", t.register.givenName, <input id="register-givenName" value={fields.givenName} onChange={set("givenName")}
        autoComplete="off" maxLength={160} disabled={saving} {...described("givenName")} />)}
      {field("familyName", t.register.familyName, <input id="register-familyName" value={fields.familyName} onChange={set("familyName")}
        autoComplete="off" maxLength={160} disabled={saving} {...described("familyName")} />)}
      {field("club", t.register.club, <input id="register-club" value={fields.club} onChange={set("club")} list={clubs.length > 0 ? "register-clubs" : undefined}
        autoComplete="off" maxLength={200} disabled={saving} {...described("club")} />)}
    </div>
    {clubs.length > 0 ? <datalist id="register-clubs">{clubs.map((club) => <option key={club.id} value={club.name} />)}</datalist> : null}
    {matches.length > 0 ? <ul className="register-suggestions" aria-label={t.register.suggestions} data-testid="register-suggestions">
      {matches.map((row) => <li key={row.personId ?? `${row.givenName}-${row.familyName}-${row.club ?? ""}`}>
        <button type="button" disabled={saving} aria-label={t.register.choose(runnerLabel(row))} onClick={() => choose(row)}>
          {runnerLabel(row)}</button></li>)}
    </ul> : null}
    <div className="row"><button type="submit" className="primary" disabled={saving}>{t.register.submit}</button></div>
  </form>;
}

/** Läget för en anmälan av brickan: väntar, sparad, fanns redan eller avvisad (och detsamma för en koppling). */
export function RegistrationStatus({ registration, className }: { registration: QueuedRegistration; className: string }) {
  const request = registration.request;
  const response = registration.response;
  const linking = "target" in request;
  const name = linking ? registration.display?.entryName ?? "" : `${request.givenName} ${request.familyName}`;
  const pendingClass = linking ? registration.display?.className ?? className : className;
  const text = registration.status === "rejected" ? linking ? t.register.linkRejected(name) : t.register.rejected(name)
    : response?.outcome === "EXISTING" ? t.register.existing(response.entryName, response.className)
      : response?.outcome === "LINKED" ? t.register.linkStored(response.entryName, response.className)
        : response ? t.register.stored(response.entryName, response.className)
          : linking ? t.register.linkPending(name, pendingClass) : t.register.pending(name, className);
  return <p className="registration" data-testid="registration-status" data-state={registration.status}
    data-outcome={response?.outcome ?? ""}>{registration.status === "rejected" || response?.outcome === "EXISTING" ? "! " : ""}{text}</p>;
}
