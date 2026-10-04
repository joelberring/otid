import { useState } from "react";
import { relayClassCreateResponseSchema, relayLegRunnerResponseSchema, relayOverviewSchema, relayStartTimesResponseSchema,
  relayTeamCreateResponseSchema, type RelayClassCreateRequest, type RelayLegRunnerRequest, type RelayOverview,
  type RelayStartTimesRequest, type RelayTeamCreateRequest } from "@o-tid/contracts";
import { relaySv as text } from "../../i18n/relay-sv";
import { formatClockTime, parseRaceClock } from "../../lib/clock-time";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

type Method = RelayClassCreateRequest["legs"][number]["startMethod"];
export type RelayLegForm = { method: Method; time: string; variant: string };
export type RelayRunnerForm = { givenName: string; familyName: string; card: string };
export type RelayRunnerChange = { teamId: string; leg: number; givenName: string; familyName: string; club: string; card: string };

const emptyRunner = (): RelayRunnerForm => ({ givenName: "", familyName: "", card: "" });
const defaultLegs = (count: number, previous: readonly RelayLegForm[] = []): RelayLegForm[] =>
  Array.from({ length: count }, (_, index) => previous[index] ?? { method: index === 0 ? "MASS_START" : "CHANGEOVER", time: "", variant: "" });

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
  const [relayClassCourseId, setRelayClassCourseId] = useState("");
  const [relayLegForms, setRelayLegForms] = useState<RelayLegForm[]>(defaultLegs(3));
  const [relayClassAttempt, setRelayClassAttempt] = useState<RelayClassCreateRequest>();
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
    relayClassCourseId, setRelayClassCourseId, relayLegForms, setRelayLegForms, relayClassAttempt, setRelayClassAttempt,
    teamClassId, setTeamClassId, teamNumber, setTeamNumber, teamName, setTeamName, teamClub, setTeamClub, teamRunners, setTeamRunners,
    teamAttempt, setTeamAttempt, selectedTeamId, setSelectedTeamId, runnerChange, setRunnerChange, runnerAttempt, setRunnerAttempt,
    relayTimes, setRelayTimes, timesAttempt, setTimesAttempt };
}

export function createRelayActions(ws: Base & RaceDataActions) {
  const { raceId, data, relay, busyRef, pending, requireSession, begin, beginRequest, finish, current, request, json, csrf, load,
    relayClassName, relayClassCourseId, relayLegForms, relayClassAttempt, teamClassId, teamNumber, teamName, teamClub, teamRunners,
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
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest();
    try { await readRelay(op); }
    catch { if (current(op)) setRelayError(text.loadError); }
    finally { finish(op); }
  }

  /** Skickar en stafettändring. 400/404/409: beskedet visas och lagvyn läses om; försöket släpps. */
  async function send<T extends { requestId: string }>(path: string, prefix: string, attempt: T, parse: (value: unknown) => unknown,
    messages: { conflict: string; error: string }, clear: () => void, done: (receipt: unknown) => string) {
    const op = begin();
    try {
      const response = await request(path, op, { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrf(),
        "idempotency-key": `${prefix}:${attempt.requestId}` }, body: JSON.stringify(attempt) });
      if (response.status === 400 || response.status === 404 || response.status === 409) {
        clear(); setRelayMessage(messages.conflict);
        await load(op); await readRelay(op);
        return;
      }
      if (!response.ok) throw new Error("Unknown relay outcome");
      const receipt = parse(await json(response, op)) as { raceId: string; requestId: string };
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Relay receipt mismatch");
      clear(); setRelayMessage(done(receipt));
      await load(op); await readRelay(op);
    } catch { if (current(op)) setRelayMessage(messages.error); }
    finally { finish(op); }
  }

  function changeLegCount(count: number) {
    if (Number.isInteger(count) && count >= 2 && count <= 20) setRelayLegForms(defaultLegs(count, relayLegForms));
  }
  function changeLeg(index: number, change: Partial<RelayLegForm>) {
    setRelayLegForms(relayLegForms.map((leg, current) => current === index ? { ...leg, ...change } : leg));
  }
  async function createRelayClass() {
    if (busyRef.current || pending.current || !requireSession() || !data) return;
    setRelayMessage("");
    let attempt = relayClassAttempt;
    if (!attempt) {
      const legs = relayLegForms.map((leg, index) => {
        const method: Method = index === 0 ? "MASS_START" : leg.method;
        const startTime = method === "CHANGEOVER" ? null : parseRaceClock(data.raceDate, leg.time, data.timeZone);
        return { leg: index + 1, startMethod: method, startTime, variantCode: leg.variant || null };
      });
      if (!relayClassName.trim() || !relayClassCourseId || legs.some(leg => leg.startMethod !== "CHANGEOVER" && leg.startTime === null)) {
        setRelayMessage(text.classInvalid); return;
      }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), expectedSnapshotVersion: data.snapshotVersion,
        name: relayClassName.trim(), courseId: relayClassCourseId, legs };
      setRelayClassAttempt(attempt);
    }
    const name = attempt.name;
    await send("/relay-classes", "relay-class", attempt, value => relayClassCreateResponseSchema.parse(value),
      { conflict: text.classConflict, error: text.classError }, () => setRelayClassAttempt(undefined), () => {
        setRelayClassName(""); setRelayLegForms(defaultLegs(3));
        return text.classSaved(name);
      });
  }

  function chooseTeamClass(classId: string) {
    setTeamClassId(classId);
    const legs = relay?.classes.find(row => row.id === classId)?.legs.length ?? 0;
    setTeamRunners(Array.from({ length: legs }, (_, index) => teamRunners[index] ?? emptyRunner()));
  }
  function changeTeamRunner(index: number, change: Partial<RelayRunnerForm>) {
    setTeamRunners(teamRunners.map((runner, current) => current === index ? { ...runner, ...change } : runner));
  }
  async function registerTeam() {
    if (busyRef.current || pending.current || !requireSession() || !relay) return;
    setRelayMessage("");
    let attempt = teamAttempt;
    if (!attempt) {
      const raceClass = relay.classes.find(row => row.id === teamClassId);
      const number = teamNumber.trim() === "" ? null : Number(teamNumber.trim());
      const runners = teamRunners.map(runner => ({ givenName: runner.givenName.trim(), familyName: runner.familyName.trim(),
        organisationName: null, cardNumber: runner.card.trim() || null }));
      const cards = runners.flatMap(runner => runner.cardNumber ? [runner.cardNumber] : []);
      if (!raceClass || !teamName.trim() || runners.length !== raceClass.legs.length || (number !== null && !(Number.isInteger(number) && number > 0)) ||
          runners.some(runner => !runner.givenName || !runner.familyName || (runner.cardNumber !== null && !/^[1-9][0-9]*$/.test(runner.cardNumber))) ||
          new Set(cards).size !== cards.length) {
        setRelayMessage(text.teamInvalid); return;
      }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), expectedSnapshotVersion: relay.snapshotVersion, classId: raceClass.id,
        number, name: teamName.trim(), organisationName: teamClub.trim() || null, runners };
      setTeamAttempt(attempt);
    }
    const name = attempt.name;
    await send("/relay-teams", "relay-team", attempt, value => relayTeamCreateResponseSchema.parse(value),
      { conflict: text.teamConflict, error: text.teamError }, () => setTeamAttempt(undefined), receipt => {
        setTeamName(""); setTeamNumber(""); setTeamRunners(teamRunners.map(emptyRunner));
        return text.teamSaved((receipt as { number: number }).number, name);
      });
  }

  function startRunnerChange(teamId: string, leg: number) {
    const runner = relay?.teams.find(row => row.id === teamId)?.legs.find(row => row.leg === leg);
    if (!runner || pending.current) return;
    setRunnerChange({ teamId, leg, givenName: runner.givenName, familyName: runner.familyName, club: runner.organisationName ?? "",
      card: runner.cardNumber ?? "" });
    setRunnerAttempt(undefined); setRelayMessage("");
  }
  async function saveRunnerChange() {
    if (busyRef.current || pending.current || !requireSession() || !relay || !runnerChange) return;
    let attempt = runnerAttempt;
    if (!attempt) {
      const leg = relay.teams.find(row => row.id === runnerChange.teamId)?.legs.find(row => row.leg === runnerChange.leg);
      const card = runnerChange.card.trim();
      if (!leg || !runnerChange.givenName.trim() || !runnerChange.familyName.trim() || (card !== "" && !/^[1-9][0-9]*$/.test(card))) {
        setRelayMessage(text.teamInvalid); return;
      }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), expectedSnapshotVersion: relay.snapshotVersion, teamId: runnerChange.teamId,
        leg: runnerChange.leg, expectedEntryVersion: leg.entryVersion, runner: { givenName: runnerChange.givenName.trim(),
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
    if (busyRef.current || pending.current || !requireSession() || !relay || !data) return;
    const raceClass = relay.classes.find(row => row.id === classId);
    if (!raceClass) return;
    let attempt = timesAttempt?.classId === classId ? timesAttempt : undefined;
    if (!attempt) {
      const legs = raceClass.legs.filter(leg => leg.startMethod !== "CHANGEOVER").map(leg => ({ leg: leg.leg,
        startTime: parseRaceClock(data.raceDate, relayTimeValue(classId, leg.leg), data.timeZone) }));
      if (legs.length === 0 || legs.some(leg => leg.startTime === null)) { setRelayMessage(text.timesInvalid); return; }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), expectedSnapshotVersion: relay.snapshotVersion, classId,
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
  return { readRelay, loadRelay, changeLegCount, changeLeg, createRelayClass, chooseTeamClass, changeTeamRunner, registerTeam,
    startRunnerChange, saveRunnerChange, cancelRunnerChange, openTeam, relayTimeValue, changeRelayTime, saveRelayTimes };
}
export type RelayActions = ReturnType<typeof createRelayActions>;
