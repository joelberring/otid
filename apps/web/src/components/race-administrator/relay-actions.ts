import { useRef, useState } from "react";
import { relayClassCreateResponseSchema, relayLegRunnerResponseSchema, relayOverviewSchema, relayStartTimesResponseSchema,
  relayTeamCreateResponseSchema, type RelayClassCreateRequest, type RelayLegRunnerRequest, type RelayOverview,
  type RelayStartTimesRequest, type RelayTeamCreateRequest } from "@o-tid/contracts";
import { relaySv as text } from "../../i18n/relay-sv";
import { isDuplicateName } from "../../lib/duplicate-name";
import { formatClockTime, parseRaceClock } from "../../lib/clock-time";
import { hasErrors, type FieldErrors } from "../../lib/form-validation";
import type { RelayTemplateId } from "../../i18n/relay-form-sv";
import { focusFirstError } from "../ui";
import { changeoverCodeOf, relayClock, restartMinutes, validateRelayClass, validateRelayTeam } from "./relay-form-validation";
import { defaultLegs, relayTemplate, type RelayLegForm } from "./relay-templates";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

type Method = RelayClassCreateRequest["legs"][number]["startMethod"];
export type { RelayLegForm };
export { changeoverCodeOf, defaultLegs };
export type RelayRestartRanking = RelayClassCreateRequest["restartRanking"];
export type RelayForking = RelayClassCreateRequest["forking"];
/** En plats i lagformuläret: sträcka och ordning, eller (teamsprint) en person med sina sträckor. */
export type RelayRunnerForm = { givenName: string; familyName: string; card: string; leg: number; legOrder: number;
  person?: string; personLegs?: number[] };
export type RelayRunnerChange = { teamId: string; leg: number; legOrder: number; givenName: string; familyName: string; club: string; card: string };

const emptyRunner = (leg = 1, legOrder = 1): RelayRunnerForm => ({ givenName: "", familyName: "", card: "", leg, legOrder });
/** Steg 48: teamsprint – två personer, A på udda och B på jämna sträckor. */
export const TEAM_SPRINT_PERSONS = ["A", "B"] as const;
export function teamSprintPersonLegs(legCount: number) {
  return TEAM_SPRINT_PERSONS.map((person, index) => ({ person,
    legs: Array.from({ length: legCount }, (_, leg) => leg + 1).filter(leg => (leg - 1) % TEAM_SPRINT_PERSONS.length === index) }));
}
/**
 * Formulärets sträckor som begäran; undefined när en tid, ett antal minuter eller en bana saknas. Steg 56: tider skrivs
 * 18:30, 18.30 eller 1830, och varje sträcka har sin bana uttryckligen.
 */
export function relayLegSettings(forms: readonly RelayLegForm[], raceDate: string, timeZone: string) {
  const legs = forms.map((leg, index) => {
    const method: Method = index === 0 ? "MASS_START" : leg.method;
    const startTime = method === "CHANGEOVER" || method === "FLYING_RESTART" ? null : parseRaceClock(raceDate, relayClock(leg.time), timeZone);
    const restartAfterMinutes = method === "FLYING_RESTART" ? restartMinutes(leg.minutes) ?? -1 : null;
    const runners = Math.min(4, Math.max(1, Number(leg.runners) || 1));
    return { leg: index + 1, startMethod: method, startTime, variantCode: leg.variant || null, courseId: leg.course || null, restartAfterMinutes,
      runners, changeoverRule: leg.changeoverRule, approvalRule: leg.approvalRule };
  });
  if (legs.some(leg => (leg.startMethod === "MASS_START" || leg.startMethod === "RESTART") && leg.startTime === null) ||
      legs.some(leg => leg.restartAfterMinutes === -1 || leg.courseId === null)) return undefined;
  return legs;
}

/**
 * Stafett i arbetsytan (ADR-0169 beslut 3): lagvyn läses från servern; ny stafettklass, nytt lag,
 * byt sträcklöpare och start-/omstartstider sparas direkt. Ett misslyckat försök skickas om med
 * samma request-id så att det aldrig sparas två gånger.
 */
export function useRelayState() {
  const [relay, setRelay] = useState<RelayOverview>();
  const [relayError, setRelayError] = useState("");
  const [relayMessage, setRelayMessage] = useState("");
  const [relayClassName, setRelayClassName] = useState("");
  const [relayLegForms, setRelayLegForms] = useState<RelayLegForm[]>(defaultLegs(3));
  const [relayRestartRanking, setRelayRestartRanking] = useState<RelayRestartRanking>("AFTER_NORMAL");
  const [relayForking, setRelayForking] = useState<RelayForking>("EVEN");
  const [relayChangeoverCode, setRelayChangeoverCode] = useState("");
  /** Steg 50: teamsprint och dess utläsning; "" = vanlig stafett. */
  const [relayReadoutMode, setRelayReadoutMode] = useState<"" | "EACH_LEG" | "LAST_LEG">("");
  const [relayClassAttempt, setRelayClassAttempt] = useState<RelayClassCreateRequest>();
  /** Steg 56: fel vid fälten i stafettklassens formulär (nytt och ändrat), besked när sparandet nekas, mall och snabbval. */
  const [relayClassErrors, setRelayClassErrors] = useState<FieldErrors<string>>({});
  const [relayClassError, setRelayClassError] = useState("");
  const [relaySameCourse, setRelaySameCourse] = useState("");
  const [relayTemplateId, setRelayTemplateId] = useState<RelayTemplateId>();
  const [relayMoreOpen, setRelayMoreOpen] = useState(false);
  /** "Ny stafettklass" står öppen efter sparandet, för nästa klass. */
  const [relayNewClassOpen, setRelayNewClassOpen] = useState(false);
  const relayClassForm = useRef<HTMLFormElement>(null);
  const [teamErrors, setTeamErrors] = useState<FieldErrors<string>>({});
  const [teamError, setTeamError] = useState("");
  const teamForm = useRef<HTMLFormElement>(null);
  const [teamClassId, setTeamClassId] = useState("");
  const [teamNumber, setTeamNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamClub, setTeamClub] = useState("");
  const [teamRunners, setTeamRunners] = useState<RelayRunnerForm[]>([]);
  const [teamAttempt, setTeamAttempt] = useState<RelayTeamCreateRequest>();
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [runnerChange, setRunnerChange] = useState<RelayRunnerChange>();
  const [runnerAttempt, setRunnerAttempt] = useState<RelayLegRunnerRequest>();
  const [relayTimes, setRelayTimes] = useState<Record<string, string>>({});
  const [timesAttempt, setTimesAttempt] = useState<RelayStartTimesRequest>();
  return { relay, setRelay, relayError, setRelayError, relayMessage, setRelayMessage, relayClassName, setRelayClassName,
    relayLegForms, setRelayLegForms, relayClassAttempt, setRelayClassAttempt,
    relayRestartRanking, setRelayRestartRanking, relayForking, setRelayForking, relayChangeoverCode, setRelayChangeoverCode,
    relayReadoutMode, setRelayReadoutMode, relayClassErrors, setRelayClassErrors, relayClassError, setRelayClassError, relaySameCourse,
    setRelaySameCourse, relayTemplateId, setRelayTemplateId, relayMoreOpen, setRelayMoreOpen, relayNewClassOpen, setRelayNewClassOpen, relayClassForm, teamErrors, setTeamErrors,
    teamError, setTeamError, teamForm,
    teamClassId, setTeamClassId, teamNumber, setTeamNumber, teamName, setTeamName, teamClub, setTeamClub, teamRunners, setTeamRunners,
    teamAttempt, setTeamAttempt, selectedTeamId, setSelectedTeamId, runnerChange, setRunnerChange, runnerAttempt, setRunnerAttempt,
    relayTimes, setRelayTimes, timesAttempt, setTimesAttempt };
}

export function createRelayActions(ws: Base & RaceDataActions) {
  const { raceId, data, relay, writingRef, pending, requireSession, begin, beginRequest, finish, current, request, json, csrf, load,
    relayClassName, relayLegForms, relayClassAttempt, teamClassId, teamNumber, teamName, teamClub, teamRunners,
    teamAttempt, runnerChange, runnerAttempt, relayTimes, timesAttempt, setRelay, setRelayError, setRelayMessage, setRelayLegForms,
    setRelayClassAttempt, setRelayClassName, setTeamAttempt, setTeamName, setTeamNumber, setTeamRunners, setTeamClassId,
    setRunnerChange, setRunnerAttempt, setRelayTimes, setTimesAttempt, setSelectedTeamId } = ws;

  async function readRelay(op: Operation) {
    const response = await request("/relay", op);
    if (!response.ok) throw new Error("Relay overview unavailable");
    const value = relayOverviewSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Relay scope mismatch");
    setRelay(value); setRelayError("");
    return value;
  }
  /** Läser lagvyn utan att röra andra områdens underlag (som `begin` gör). */
  async function loadRelay() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = beginRequest();
    try { await readRelay(op); }
    catch { if (current(op)) setRelayError(text.loadError); }
    finally { finish(op); }
  }

  /**
   * Skickar en stafettändring. 400/404/409: beskedet visas och lagvyn läses om; försöket släpps. Steg 56: `refused` visar
   * beskedet i formuläret i stället för överst (och ett upptaget namn vid fältet).
   */
  async function send<T extends { requestId: string }>(path: string, prefix: string, attempt: T, parse: (value: unknown) => unknown,
    messages: { conflict: string; error: string }, clear: () => void, done: (receipt: unknown) => string,
    refused: (message: string, duplicate: boolean) => void = message => setRelayMessage(message)) {
    const op = begin(true);
    try {
      const response = await request(path, op, { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrf(),
        "idempotency-key": `${prefix}:${attempt.requestId}` }, body: JSON.stringify(attempt) });
      if (response.status === 400 || response.status === 404 || response.status === 409) {
        const duplicate = await isDuplicateName(response);
        clear(); refused(duplicate ? text.classDuplicate : messages.conflict, duplicate);
        await load(op); await readRelay(op);
        return;
      }
      if (!response.ok) throw new Error("Unknown relay outcome");
      const receipt = parse(await json(response, op)) as { raceId: string; requestId: string };
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Relay receipt mismatch");
      clear(); setRelayMessage(done(receipt));
      await load(op); await readRelay(op);
    } catch { if (current(op)) refused(messages.error, false); }
    finally { finish(op); }
  }

  function changeLegCount(count: number) {
    if (Number.isInteger(count) && count >= 2 && count <= 30) setRelayLegForms(defaultLegs(count, relayLegForms, ws.relaySameCourse));
  }
  /** Ett ändrat fält tar bort sitt fel. */
  function clearRelayClassError(...fields: string[]) {
    if (fields.some(field => ws.relayClassErrors[field])) {
      ws.setRelayClassErrors(Object.fromEntries(Object.entries(ws.relayClassErrors).filter(([key]) => !fields.includes(key))));
    }
  }
  function changeLeg(index: number, change: Partial<RelayLegForm>) {
    setRelayLegForms(relayLegForms.map((leg, current) => current === index ? { ...leg, ...change } : leg));
    clearRelayClassError(...Object.keys(change).map(key => `${key}-${index + 1}`), ...(change.method ? [`time-${index + 1}`, `minutes-${index + 1}`] : []));
  }
  /** Steg 56: "Samma bana på alla sträckor" fyller i banan på varje sträcka; varje sträcka kan sedan ändras. */
  function chooseSameCourse(courseId: string) {
    ws.setRelaySameCourse(courseId);
    if (!courseId) return;
    setRelayLegForms(relayLegForms.map(leg => leg.course === courseId ? leg : { ...leg, course: courseId, variant: "" }));
    clearRelayClassError(...relayLegForms.map((_, index) => `course-${index + 1}`));
  }
  /** Steg 56: en mall sätter sträckorna och inställningarna (inte namnet eller banorna) och kan bytas tills man sparar. */
  function applyRelayTemplate(id: RelayTemplateId) {
    const settings = relayTemplate(id, relayLegForms, ws.relaySameCourse);
    setRelayLegForms(settings.legs);
    ws.setRelayReadoutMode(settings.readoutMode); ws.setRelayChangeoverCode(settings.changeoverCode);
    ws.setRelayRestartRanking(settings.restartRanking); ws.setRelayForking(settings.forking);
    ws.setRelayTemplateId(id);
    if (settings.more) ws.setRelayMoreOpen(true);
    // Visas fel redan kontrolleras fälten igen med mallens sträckor, så att felen stämmer med det som syns.
    if (hasErrors(ws.relayClassErrors)) {
      ws.setRelayClassErrors(validateRelayClass({ name: relayClassName, legs: settings.legs, changeoverCode: settings.changeoverCode,
        readoutMode: settings.readoutMode }));
    }
  }
  /** Fälten kontrolleras före sparandet; felen visas vid fälten och sammanfattas överst, och fokus går till det första. */
  function checkRelayClass(): boolean {
    const errors = validateRelayClass({ name: relayClassName, legs: relayLegForms, changeoverCode: ws.relayChangeoverCode,
      readoutMode: ws.relayReadoutMode });
    ws.setRelayClassErrors(errors);
    if (!hasErrors(errors)) return true;
    if (errors.changeoverCode) ws.setRelayMoreOpen(true);
    focusFirstError(ws.relayClassForm.current);
    return false;
  }
  function relayClassRefused(message: string, duplicate: boolean) {
    if (duplicate) { ws.setRelayClassErrors({ name: message }); focusFirstError(ws.relayClassForm.current); }
    else ws.setRelayClassError(message);
  }
  async function createRelayClass() {
    if (writingRef.current || pending.current || !requireSession() || !data) return;
    setRelayMessage(""); ws.setRelayClassError("");
    let attempt = relayClassAttempt;
    if (!attempt) {
      if (!checkRelayClass()) return;
      const legs = relayLegSettings(relayLegForms, data.raceDate, data.timeZone);
      const code = changeoverCodeOf(ws.relayChangeoverCode);
      if (!legs || code === undefined) { ws.setRelayClassError(text.classInvalid); return; }
      // Steg 56 (ADR-0174 beslut 10): klassens bana är sträcka 1:s; den visas inte i formuläret.
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), name: relayClassName.trim(), courseId: legs[0]!.courseId!, legs,
        restartRanking: ws.relayRestartRanking, forking: ws.relayForking, changeoverCode: code, readoutMode: ws.relayReadoutMode || null };
      setRelayClassAttempt(attempt);
    }
    const name = attempt.name;
    await send("/relay-classes", "relay-class", attempt, value => relayClassCreateResponseSchema.parse(value),
      { conflict: text.classConflict, error: text.classError }, () => setRelayClassAttempt(undefined), () => {
        setRelayClassName(""); setRelayLegForms(defaultLegs(3)); ws.setRelaySameCourse(""); ws.setRelayTemplateId(undefined);
        ws.setRelayReadoutMode(""); ws.setRelayChangeoverCode(""); ws.setRelayRestartRanking("AFTER_NORMAL"); ws.setRelayForking("EVEN");
        ws.setRelayMoreOpen(false); ws.setRelayClassErrors({});
        return text.classSaved(name);
      }, relayClassRefused);
  }

  /** Lagformulärets platser: en per sträcka och löpare (steg 48), eller en per person i teamsprint. */
  function chooseTeamClass(classId: string) {
    setTeamClassId(classId);
    const raceClass = relay?.classes.find(row => row.id === classId);
    if (!raceClass) { setTeamRunners([]); return; }
    if (raceClass.readoutMode !== null) {
      setTeamRunners(teamSprintPersonLegs(raceClass.legs.length).map(({ person, legs }) => ({ ...emptyRunner(legs[0] ?? 1), person, personLegs: legs })));
      return;
    }
    setTeamRunners(raceClass.legs.flatMap(leg => Array.from({ length: leg.runners }, (_, order) => emptyRunner(leg.leg, order + 1))));
  }
  function changeTeamRunner(index: number, change: Partial<RelayRunnerForm>) {
    setTeamRunners(teamRunners.map((runner, current) => current === index ? { ...runner, ...change } : runner));
    clearTeamError(...[change.givenName !== undefined && `given-${index}`, change.familyName !== undefined && `family-${index}`,
      change.card !== undefined && `card-${index}`].filter((key): key is string => !!key));
  }
  function clearTeamError(...fields: string[]) {
    if (fields.some(field => ws.teamErrors[field])) {
      ws.setTeamErrors(Object.fromEntries(Object.entries(ws.teamErrors).filter(([key]) => !fields.includes(key))));
    }
  }
  async function registerTeam() {
    if (writingRef.current || pending.current || !requireSession() || !relay) return;
    setRelayMessage(""); ws.setTeamError("");
    let attempt = teamAttempt;
    if (!attempt) {
      const errors = validateRelayTeam({ classId: teamClassId, number: teamNumber, name: teamName, club: teamClub, runners: teamRunners });
      ws.setTeamErrors(errors);
      if (hasErrors(errors)) { focusFirstError(ws.teamForm.current); return; }
      const raceClass = relay.classes.find(row => row.id === teamClassId);
      const number = teamNumber.trim() === "" ? null : Number(teamNumber.trim());
      // Teamsprint: personen springer alla sina sträckor; brickan sitter på personens första sträcka.
      const runners = teamRunners.some(runner => runner.personLegs)
        ? teamRunners.flatMap(runner => (runner.personLegs ?? []).map((leg, index) => ({ givenName: runner.givenName.trim(),
          familyName: runner.familyName.trim(), organisationName: null, cardNumber: index === 0 ? runner.card.trim() || null : null, leg,
          ...(index === 0 ? {} : { sameAsLeg: runner.personLegs![0]! }) }))).sort((a, b) => a.leg - b.leg)
        : teamRunners.map(runner => ({ givenName: runner.givenName.trim(), familyName: runner.familyName.trim(),
          organisationName: null, cardNumber: runner.card.trim() || null, leg: runner.leg, legOrder: runner.legOrder }));
      const cards = runners.flatMap(runner => runner.cardNumber ? [runner.cardNumber] : []);
      const slots = raceClass ? raceClass.legs.reduce((sum, leg) => sum + leg.runners, 0) : 0;
      if (!raceClass || !teamName.trim() || runners.length !== slots || (number !== null && !(Number.isInteger(number) && number > 0)) ||
          runners.some(runner => !runner.givenName || !runner.familyName || (runner.cardNumber !== null && !/^[1-9][0-9]*$/.test(runner.cardNumber))) ||
          new Set(cards).size !== cards.length) {
        ws.setTeamError(text.teamInvalid); return;
      }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), classId: raceClass.id,
        number, name: teamName.trim(), organisationName: teamClub.trim() || null, runners };
      setTeamAttempt(attempt);
    }
    const name = attempt.name;
    await send("/relay-teams", "relay-team", attempt, value => relayTeamCreateResponseSchema.parse(value),
      { conflict: text.teamConflict, error: text.teamError }, () => setTeamAttempt(undefined), receipt => {
        setTeamName(""); setTeamNumber(""); setTeamRunners(teamRunners.map(runner => ({ ...runner, givenName: "", familyName: "", card: "" })));
        ws.setTeamErrors({});
        return text.teamSaved((receipt as { number: number }).number, name);
      }, message => ws.setTeamError(message));
  }

  function startRunnerChange(teamId: string, leg: number, legOrder = 1) {
    const runner = relay?.teams.find(row => row.id === teamId)?.legs.find(row => row.leg === leg && row.legOrder === legOrder);
    if (!runner || pending.current) return;
    setRunnerChange({ teamId, leg, legOrder, givenName: runner.givenName, familyName: runner.familyName, club: runner.organisationName ?? "",
      card: runner.cardNumber ?? "" });
    setRunnerAttempt(undefined); setRelayMessage("");
  }
  async function saveRunnerChange() {
    if (writingRef.current || pending.current || !requireSession() || !relay || !runnerChange) return;
    let attempt = runnerAttempt;
    if (!attempt) {
      const leg = relay.teams.find(row => row.id === runnerChange.teamId)?.legs.find(row => row.leg === runnerChange.leg &&
        row.legOrder === runnerChange.legOrder);
      const card = runnerChange.card.trim();
      if (!leg || !runnerChange.givenName.trim() || !runnerChange.familyName.trim() || (card !== "" && !/^[1-9][0-9]*$/.test(card))) {
        setRelayMessage(text.teamInvalid); return;
      }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), teamId: runnerChange.teamId,
        leg: runnerChange.leg, legOrder: runnerChange.legOrder, expectedEntryVersion: leg.entryVersion, runner: { givenName: runnerChange.givenName.trim(),
          familyName: runnerChange.familyName.trim(), organisationName: runnerChange.club.trim() || null, cardNumber: card || null } };
      setRunnerAttempt(attempt);
    }
    const saved = attempt;
    await send("/relay-leg-runner", "relay-leg-runner", saved, value => relayLegRunnerResponseSchema.parse(value),
      { conflict: text.runnerConflict, error: text.runnerError }, () => { setRunnerAttempt(undefined); setRunnerChange(undefined); }, receipt => {
        const name = `${saved.runner.givenName} ${saved.runner.familyName}`;
        return (receipt as { recalculatedCount: number }).recalculatedCount > 0 ? text.runnerSavedRecalculated(saved.leg, name)
          : text.runnerSaved(saved.leg, name);
      });
  }
  function cancelRunnerChange() {
    if (pending.current) return;
    setRunnerChange(undefined); setRunnerAttempt(undefined);
  }
  function openTeam(teamId: string) {
    if (pending.current) return;
    setSelectedTeamId(teamId); setRunnerChange(undefined); setRunnerAttempt(undefined);
  }

  /** Klockslaget i fältet, eller sträckans sparade tid. */
  function relayTimeValue(classId: string, leg: number): string {
    const key = `${classId}:${leg}`;
    if (key in relayTimes) return relayTimes[key]!;
    const saved = relay?.classes.find(row => row.id === classId)?.legs.find(row => row.leg === leg)?.startTime;
    return saved && relay ? formatClockTime(saved, relay.timeZone).slice(0, 5) : "";
  }
  function changeRelayTime(classId: string, leg: number, value: string) {
    setRelayTimes({ ...relayTimes, [`${classId}:${leg}`]: value });
  }
  async function saveRelayTimes(classId: string) {
    if (writingRef.current || pending.current || !requireSession() || !relay || !data) return;
    const raceClass = relay.classes.find(row => row.id === classId);
    if (!raceClass) return;
    let attempt = timesAttempt?.classId === classId ? timesAttempt : undefined;
    if (!attempt) {
      const legs = raceClass.legs.filter(leg => leg.startMethod === "MASS_START" || leg.startMethod === "RESTART").map(leg => ({ leg: leg.leg,
        startTime: parseRaceClock(data.raceDate, relayClock(relayTimeValue(classId, leg.leg)), data.timeZone) }));
      if (legs.length === 0 || legs.some(leg => leg.startTime === null)) { setRelayMessage(text.timesInvalid); return; }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), classId,
        legs: legs.map(leg => ({ leg: leg.leg, startTime: leg.startTime! })) };
      setTimesAttempt(attempt);
    }
    await send("/relay-start-times", "relay-start-times", attempt, value => relayStartTimesResponseSchema.parse(value),
      { conflict: text.timesError, error: text.timesError }, () => setTimesAttempt(undefined), receipt => {
        setRelayTimes(Object.fromEntries(Object.entries(relayTimes).filter(([key]) => !key.startsWith(`${classId}:`))));
        const count = (receipt as { recalculatedCount: number }).recalculatedCount;
        return count > 0 ? text.timesSavedRecalculated(raceClass.name, count) : text.timesSaved(raceClass.name);
      });
  }
  return { readRelay, loadRelay, send, changeLegCount, changeLeg, clearRelayClassError, chooseSameCourse, applyRelayTemplate, checkRelayClass,
    relayClassRefused, createRelayClass, chooseTeamClass, changeTeamRunner, clearTeamError, registerTeam,
    startRunnerChange, saveRunnerChange, cancelRunnerChange, openTeam, relayTimeValue, changeRelayTime, saveRelayTimes };
}
export type RelayActions = ReturnType<typeof createRelayActions>;
