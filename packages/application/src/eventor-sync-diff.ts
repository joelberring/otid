import type { SyncRow } from "@o-tid/contracts";
import {
  fullName, normalized, row, type ClassRef, type CurrentClass, type CurrentEntry, type CurrentState, type EventorAction,
  type EventorProjection, type PlannedRow, type SourceDiff
} from "./source-sync-model";

/**
 * Skillnaden mellan Eventor och tävlingen (ADR-0170 beslut 4). Ren funktion.
 *
 * - Klasser matchas på Eventors id, annars på namn (länkas tyst). Nya klasser skapas alltid.
 * - Anmälningar matchas på Eventors id, annars på namn + klubb + klass bland deltagare från en
 *   tidigare fil (visas som "matchad på namn"). Lokalt skapade deltagare (direktanmälan) rörs aldrig.
 * - Anmälningar som försvunnit ur Eventor blir strukna (ej start) – utom när löparen redan har
 *   resultat: då visas en konflikt i stället för att något görs tyst.
 * - Ny bricka till en löpare som läst ut ändrar inte resultatet (löparen sprang med den avlästa brickan).
 */
export function diffEventor(projection: EventorProjection, state: CurrentState): SourceDiff<EventorAction> {
  const rows: PlannedRow<EventorAction>[] = [];
  const links: { id: string; externalId: string }[] = [];
  let unchanged = 0;
  const classById = new Map(state.classes.map(raceClass => [raceClass.id, raceClass]));
  const linkedClasses = new Map(state.classes.filter(raceClass => raceClass.externalSource === "eventor")
    .map(raceClass => [raceClass.externalId!, raceClass]));
  const legsByEventorClass = new Map<string, number>();
  for (const team of projection.teams) {
    legsByEventorClass.set(team.classId, Math.max(legsByEventorClass.get(team.classId) ?? 0, ...team.runners.map(runner => runner.leg), 2));
  }

  // Klasser: var hamnar Eventor-klassen hos oss?
  const target = new Map<string, { ref: ClassRef; name: string; legCount: number }>();
  const usedByName = new Set<string>();
  for (const eventorClass of projection.classes) {
    const linked = linkedClasses.get(eventorClass.id);
    if (eventorClass.cancelled) {
      if (linked) rows.push({ row: row({ key: `class-cancelled:${eventorClass.id}`, kind: "CONFLICT", subject: "CLASS",
        label: linked.name, optional: false, note: "CLASS_CANCELLED" }), action: { type: "NONE" } });
      continue;
    }
    if (linked) {
      target.set(eventorClass.id, { ref: { existing: linked.id }, name: eventorClass.name, legCount: linked.legCount });
      if (linked.name !== eventorClass.name) rows.push({ row: row({ key: `class-name:${linked.id}`, kind: "CHANGED", subject: "CLASS",
        label: linked.name, changes: [{ field: "CLASS_NAME", from: linked.name, to: eventorClass.name }] }),
        action: { type: "RENAME_CLASS", classId: linked.id, name: eventorClass.name } });
      continue;
    }
    const byName = state.classes.filter(raceClass => raceClass.externalSource !== "eventor" && !usedByName.has(raceClass.id) &&
      normalized(raceClass.name) === normalized(eventorClass.name));
    if (byName.length === 1) {
      usedByName.add(byName[0]!.id);
      links.push({ id: byName[0]!.id, externalId: eventorClass.id });
      target.set(eventorClass.id, { ref: { existing: byName[0]!.id }, name: byName[0]!.name, legCount: byName[0]!.legCount });
      continue;
    }
    const legCount = legsByEventorClass.get(eventorClass.id) ?? 0;
    target.set(eventorClass.id, { ref: { newEventorClass: eventorClass.id }, name: eventorClass.name, legCount });
    rows.push({ row: row({ key: `class-new:${eventorClass.id}`, kind: "NEW", subject: "CLASS", label: eventorClass.name,
      context: legCount > 0 ? `${legCount}` : null, optional: false }),
      action: { type: "CREATE_CLASS", eventorId: eventorClass.id, name: eventorClass.name, legCount } });
  }
  const className = (ref: ClassRef) => "existing" in ref ? classById.get(ref.existing)!.name : target.get(ref.newEventorClass)!.name;
  const sameClass = (ref: ClassRef, classId: string) => "existing" in ref && ref.existing === classId;

  // Brickor: vem har vilken aktiv bricka, och vilka släpps av ändringar i samma uppdatering.
  const cardOwner = new Map(state.entries.filter(entry => entry.cardNumber !== null).map(entry => [entry.cardNumber!, entry.id]));
  const claimed = new Map<string, string>();
  const cardFree = (card: string, entryKey: string, ownEntryId: string | null) => {
    const owner = cardOwner.get(card);
    const claimer = claimed.get(card);
    if ((owner !== undefined && owner !== ownEntryId && !releasing.has(owner)) || (claimer !== undefined && claimer !== entryKey)) return false;
    claimed.set(card, entryKey);
    return true;
  };
  // Löpare som får en annan bricka från Eventor släpper sin nuvarande.
  const releasing = new Set<string>();
  const byEventorId = new Map(state.entries.filter(entry => entry.externalSource === "eventor" && entry.externalId !== null)
    .map(entry => [entry.externalId!, entry]));
  const runnerCards = projection.teams.flatMap(team => team.runners.map(runner => ({ key: `${team.id}:${runner.leg}`, card: runner.cardNumber })));
  for (const source of [...projection.entries.map(entry => ({ key: entry.id, card: entry.cardNumber })), ...runnerCards]) {
    const local = byEventorId.get(source.key);
    if (local && source.card && local.cardNumber && source.card !== local.cardNumber) releasing.add(local.id);
  }

  // Individuella anmälningar.
  const nameCandidates = state.entries.filter(entry => entry.externalSource === "iof" && entry.teamId === null);
  const usedEntries = new Set<string>();
  const seen = new Set<string>();
  for (const source of projection.entries) {
    const classTarget = target.get(source.classId);
    if (!classTarget) continue;
    seen.add(source.id);
    const name = fullName(source.givenName, source.familyName);
    const context = [source.club, classTarget.name].filter(Boolean).join(" · ");
    let local: CurrentEntry | undefined = byEventorId.get(source.id);
    let matchedByName = false;
    if (!local) {
      const candidates = nameCandidates.filter(entry => !usedEntries.has(entry.id) && sameClass(classTarget.ref, entry.classId) &&
        normalized(fullName(entry.givenName, entry.familyName)) === normalized(name) &&
        normalized(entry.organisationName) === normalized(source.club));
      if (candidates.length === 1) { local = candidates[0]!; matchedByName = true; }
    }
    if (local) usedEntries.add(local.id);
    const relayTarget = classTarget.legCount > 0;
    if (!local) {
      const cardOk = source.cardNumber === null || cardFree(source.cardNumber, source.id, null);
      const note = relayTarget ? "RELAY_CLASS_MISMATCH" as const : cardOk ? null : "CARD_IN_USE" as const;
      rows.push({ row: row({ key: `entry-new:${source.id}`, kind: note ? "CONFLICT" : "NEW", subject: "ENTRY", label: name, context,
        changes: source.cardNumber ? [{ field: "CARD", from: null, to: source.cardNumber }] : [], optional: !note, note }),
        action: note ? { type: "NONE" } : { type: "CREATE_ENTRY", eventorId: source.id, classRef: classTarget.ref,
          givenName: source.givenName, familyName: source.familyName, club: source.club, cardNumber: source.cardNumber } });
      continue;
    }
    const change = entryChange(local, matchedByName, { eventorId: source.id, givenName: source.givenName, familyName: source.familyName,
      club: source.club, cardNumber: source.cardNumber, classRef: relayTarget ? undefined : classTarget.ref, context, label: name },
    classById, className, sameClass, cardFree);
    if (change) rows.push(...change);
    else unchanged += 1;
  }

  // Stafettlag och sträcklöpare.
  const teamsByEventorId = new Map(state.teams.filter(team => team.externalSource === "eventor").map(team => [team.externalId!, team]));
  const seenTeams = new Set<string>();
  for (const source of projection.teams) {
    const classTarget = target.get(source.classId);
    if (!classTarget) continue;
    seenTeams.add(source.id);
    const local = teamsByEventorId.get(source.id);
    const legs = Math.max(...source.runners.map(runner => runner.leg), 0);
    const context = [source.club, classTarget.name].filter(Boolean).join(" · ");
    if (!local) {
      const mismatch = classTarget.legCount < 2 || legs > classTarget.legCount;
      const cardsOk = source.runners.every(runner => runner.cardNumber === null || cardFree(runner.cardNumber, `${source.id}:${runner.leg}`, null));
      const note = mismatch ? "RELAY_CLASS_MISMATCH" as const : cardsOk ? null : "CARD_IN_USE" as const;
      rows.push({ row: row({ key: `team-new:${source.id}`, kind: note ? "CONFLICT" : "NEW", subject: "TEAM", label: source.name, context,
        changes: source.runners.filter(runner => runner.familyName).map(runner => ({ field: "LEGS" as const, from: `${runner.leg}`,
          to: fullName(runner.givenName, runner.familyName) })), optional: !note, note }),
        action: note ? { type: "NONE" } : { type: "CREATE_TEAM", eventorId: source.id, classRef: classTarget.ref, name: source.name,
          club: source.club, runners: source.runners } });
      continue;
    }
    if (!sameClass(classTarget.ref, local.classId)) {
      rows.push({ row: row({ key: `team-class:${local.id}`, kind: "CONFLICT", subject: "TEAM", label: local.name, context,
        changes: [{ field: "CLASS", from: classById.get(local.classId)?.name ?? null, to: classTarget.name }], optional: false,
        note: "TEAM_CLASS_CHANGED" }), action: { type: "NONE" } });
      continue;
    }
    const teamChanges: SyncRow["changes"] = [];
    if (local.name !== source.name) teamChanges.push({ field: "TEAM_NAME", from: local.name, to: source.name });
    if (normalized(local.organisationName) !== normalized(source.club)) teamChanges.push({ field: "CLUB", from: local.organisationName, to: source.club });
    if (teamChanges.length > 0) rows.push({ row: row({ key: `team:${local.id}`, kind: "CHANGED", subject: "TEAM", label: local.name, context,
      changes: teamChanges }), action: { type: "UPDATE_TEAM", teamId: local.id,
        ...(local.name !== source.name ? { name: source.name } : {}), ...(teamChanges.some(change => change.field === "CLUB") ? { club: source.club } : {}) } });
    let teamUnchanged = teamChanges.length === 0;
    for (const runner of source.runners) {
      const legEntry = state.entries.find(entry => entry.teamId === local.id && entry.relayLeg === runner.leg);
      if (!legEntry || !runner.familyName) continue;
      const change = entryChange(legEntry, false, { eventorId: null, givenName: runner.givenName ?? "", familyName: runner.familyName,
        club: runner.club ?? source.club, cardNumber: runner.cardNumber, classRef: undefined, label: fullName(runner.givenName, runner.familyName),
        context: `${source.name} · ${runner.leg}` }, classById, className, sameClass, cardFree);
      if (change) { rows.push(...change); teamUnchanged = false; }
    }
    if (teamUnchanged) unchanged += 1;
  }

  // Strukna i Eventor.
  for (const entry of state.entries) {
    if (entry.externalSource !== "eventor" || entry.teamId !== null || seen.has(entry.externalId!) || entry.didNotStart) continue;
    rows.push(withdrawal(`entry-withdrawn:${entry.id}`, "ENTRY", fullName(entry.givenName, entry.familyName),
      [entry.organisationName, classById.get(entry.classId)?.name].filter(Boolean).join(" · "), [entry]));
  }
  for (const team of state.teams) {
    if (team.externalSource !== "eventor" || seenTeams.has(team.externalId!)) continue;
    const legs = state.entries.filter(entry => entry.teamId === team.id);
    if (legs.length > 0 && legs.every(entry => entry.didNotStart)) continue;
    rows.push(withdrawal(`team-withdrawn:${team.id}`, "TEAM", team.name,
      [team.organisationName, classById.get(team.classId)?.name].filter(Boolean).join(" · "), legs.filter(entry => !entry.didNotStart)));
  }
  return { rows, links, unchanged };
}

function withdrawal(key: string, subject: "ENTRY" | "TEAM", label: string, context: string, entries: readonly CurrentEntry[]): PlannedRow<EventorAction> {
  const readOut = entries.some(entry => entry.readOut);
  const note = readOut ? "WITHDRAWN_READ_OUT" as const : entries.some(entry => entry.hasResult) ? "WITHDRAWN_HAS_RESULT" as const : null;
  return { row: row({ key, kind: note ? "CONFLICT" : "WITHDRAWN", subject, label, context: context || null, readOut, optional: !note, note }),
    action: note ? { type: "NONE" } : { type: "WITHDRAW", entryIds: entries.map(entry => entry.id) } };
}

type Incoming = { eventorId: string | null; givenName: string; familyName: string; club: string | null; cardNumber: string | null;
  classRef: ClassRef | undefined; label: string; context: string };

/** Ändringar för en befintlig deltagare, eller undefined om inget skiljer (och matchningen gjordes på id). */
function entryChange(local: CurrentEntry, matchedByName: boolean, incoming: Incoming, classById: ReadonlyMap<string, CurrentClass>,
  className: (ref: ClassRef) => string, sameClass: (ref: ClassRef, classId: string) => boolean,
  cardFree: (card: string, key: string, own: string | null) => boolean): PlannedRow<EventorAction>[] | undefined {
  const changes: SyncRow["changes"] = [];
  const nameChanged = local.givenName !== incoming.givenName || local.familyName !== incoming.familyName;
  if (nameChanged) changes.push({ field: "NAME", from: fullName(local.givenName, local.familyName), to: incoming.label });
  const clubChanged = normalized(local.organisationName) !== normalized(incoming.club);
  if (clubChanged) changes.push({ field: "CLUB", from: local.organisationName, to: incoming.club });
  const classChanged = incoming.classRef !== undefined && !sameClass(incoming.classRef, local.classId);
  if (classChanged) changes.push({ field: "CLASS", from: classById.get(local.classId)?.name ?? null, to: className(incoming.classRef!) });
  const cardChanged = incoming.cardNumber !== null && incoming.cardNumber !== local.cardNumber;
  if (cardChanged) changes.push({ field: "CARD", from: local.cardNumber, to: incoming.cardNumber });
  if (changes.length === 0 && !matchedByName) return undefined;
  const key = `entry:${local.id}`;
  if (cardChanged && !cardFree(incoming.cardNumber!, key, local.id)) {
    return [{ row: row({ key, kind: "CONFLICT", subject: "ENTRY", label: incoming.label, context: incoming.context, changes, matchedByName,
      readOut: local.readOut, optional: false, note: "CARD_IN_USE" }), action: { type: "NONE" } }];
  }
  return [{ row: row({ key, kind: "CHANGED", subject: "ENTRY", label: incoming.label, context: incoming.context, changes, matchedByName,
    readOut: local.readOut && (classChanged || cardChanged), note: cardChanged && local.readOut ? "CARD_AFTER_READOUT" : null }),
  action: { type: "UPDATE_ENTRY", entryId: local.id, eventorId: matchedByName ? incoming.eventorId : null,
    ...(nameChanged ? { name: { givenName: incoming.givenName, familyName: incoming.familyName } } : {}),
    ...(clubChanged ? { club: incoming.club } : {}), ...(classChanged ? { classRef: incoming.classRef! } : {}),
    ...(cardChanged ? { cardNumber: incoming.cardNumber! } : {}) } }];
}
