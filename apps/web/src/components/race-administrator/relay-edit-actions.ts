import { useState } from "react";
import {
  relayClassEditResponseSchema, relayEditRefusalSchema, relayLegVariantResponseSchema, relayTeamDidNotStartResponseSchema,
  relayTeamEditResponseSchema, relayTeamRemovalResponseSchema, type RelayClassEditPreview, type RelayClassEditRequest,
  type RelayLegVariantRequest, type RelayTeamDidNotStartRequest, type RelayTeamEditRequest, type RelayTeamRemovalRequest
} from "@o-tid/contracts";
import { relaySv as text } from "../../i18n/relay-sv";
import { isDuplicateName } from "../../lib/duplicate-name";
import { formatClockTime } from "../../lib/clock-time";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import { changeoverCodeOf, defaultLegs, relayLegSettings, type RelayActions, type RelayLegForm } from "./relay-actions";

export type RelayTeamEditForm = { teamId: string; number: string; name: string; club: string };
export type RelayVariantChange = { teamId: string; leg: number; legOrder: number; code: string };

/**
 * Steg 47 (ADR-0174) i arbetsytan: ändra stafettklassen (med besked i klartext innan resultat byter status), ändra,
 * ta bort och stryk lag, hela laget ej start och byt variant på en sträcka. Varje försök har ett request-id som
 * skickas om oförändrat vid fel, så att inget sparas två gånger.
 */
export function useRelayEditState() {
  const [relayEditClassId, setRelayEditClassId] = useState("");
  const [relayEditAttempt, setRelayEditAttempt] = useState<RelayClassEditRequest>();
  const [relayEditPreview, setRelayEditPreview] = useState<RelayClassEditPreview>();
  const [teamEdit, setTeamEdit] = useState<RelayTeamEditForm>();
  const [teamEditAttempt, setTeamEditAttempt] = useState<RelayTeamEditRequest>();
  const [teamRemovalAttempt, setTeamRemovalAttempt] = useState<RelayTeamRemovalRequest>();
  const [teamDnsAttempt, setTeamDnsAttempt] = useState<RelayTeamDidNotStartRequest>();
  const [variantChange, setVariantChange] = useState<RelayVariantChange>();
  const [variantAttempt, setVariantAttempt] = useState<RelayLegVariantRequest>();
  const [variantPreview, setVariantPreview] = useState<RelayClassEditPreview>();
  return { relayEditClassId, setRelayEditClassId, relayEditAttempt, setRelayEditAttempt, relayEditPreview, setRelayEditPreview,
    teamEdit, setTeamEdit, teamEditAttempt, setTeamEditAttempt, teamRemovalAttempt, setTeamRemovalAttempt, teamDnsAttempt,
    setTeamDnsAttempt, variantChange, setVariantChange, variantAttempt, setVariantAttempt, variantPreview, setVariantPreview };
}

type Edit = ReturnType<typeof useRelayEditState>;

export function createRelayEditActions(ws: Base & RaceDataActions & RelayActions & Edit) {
  const { raceId, data, relay, writingRef, pending, requireSession, begin, finish, current, request, json, csrf, load, readRelay, send,
    relayClassName, relayLegForms, setRelayClassName, setRelayLegForms, setRelayMessage, setRelayRestartRanking, setRelayForking,
    relayEditClassId, setRelayEditClassId, relayEditAttempt, setRelayEditAttempt, setRelayEditPreview, teamEdit, setTeamEdit,
    teamEditAttempt, setTeamEditAttempt, teamRemovalAttempt, setTeamRemovalAttempt, teamDnsAttempt, setTeamDnsAttempt, variantChange,
    setVariantChange, variantAttempt, setVariantAttempt, setVariantPreview, setSelectedTeamId } = ws;

  /**
   * Skickar en ändring som kan kräva bekräftelse. 409 med besked: beskedet visas och försöket väntar på bekräftelse.
   * Steg 56: `refused` visar ett nekat sparande i formuläret (och ett upptaget namn vid fältet).
   */
  async function sendConfirmable<T extends { requestId: string }>(path: string, prefix: string, attempt: T, parse: (value: unknown) => unknown,
    onPreview: (preview: RelayClassEditPreview) => void, clear: () => void, done: (receipt: unknown) => string,
    refused: (message: string, duplicate: boolean) => void = message => setRelayMessage(message)) {
    const op = begin(true);
    try {
      const response = await request(path, op, { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrf(),
        "idempotency-key": `${prefix}:${attempt.requestId}` }, body: JSON.stringify(attempt) });
      if (response.status === 409) {
        const refusal = relayEditRefusalSchema.safeParse(await response.clone().json().catch(() => undefined));
        if (refusal.success && refusal.data.error === "CONFIRMATION_REQUIRED" && refusal.data.preview) {
          clear(); onPreview(refusal.data.preview); return;
        }
        const duplicate = await isDuplicateName(response);
        const legHasResult = refusal.success && refusal.data.error === "LEG_HAS_RESULT";
        clear(); refused(legHasResult ? text.editLegHasResult : duplicate ? text.classDuplicate : text.classConflict, !legHasResult && duplicate);
        await readRelay(op); return;
      }
      if (response.status === 400 || response.status === 404) { clear(); refused(text.classConflict, false); await readRelay(op); return; }
      if (!response.ok) throw new Error("Unknown relay outcome");
      const receipt = parse(await json(response, op)) as { raceId: string; requestId: string };
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Relay receipt mismatch");
      clear(); setRelayMessage(done(receipt));
      await load(op); await readRelay(op);
    } catch { if (current(op)) refused(text.teamActionError, false); }
    finally { finish(op); }
  }

  /** "Ändra stafettklass": formuläret fylls med klassens sträckor. */
  function startRelayClassEdit(classId: string) {
    const raceClass = relay?.classes.find(row => row.id === classId);
    if (pending.current) return;
    setRelayEditClassId(classId); setRelayEditAttempt(undefined); setRelayEditPreview(undefined); setRelayMessage("");
    ws.setRelayClassErrors({}); ws.setRelayClassError("");
    if (!raceClass || !relay) return;
    setRelayClassName(raceClass.name);
    setRelayRestartRanking(raceClass.restartRanking); setRelayForking(raceClass.forking);
    // Steg 56: varje sträcka visar banan den springer (en äldre sträcka utan egen bana springer klassens, alltså sträcka 1:s).
    const courseOf = (leg: number) => raceClass.legCourses.find(row => row.leg === leg)?.courseId ?? raceClass.courseId;
    const courses = new Set(raceClass.legs.map(leg => courseOf(leg.leg)));
    ws.setRelaySameCourse(courses.size === 1 ? [...courses][0]! : "");
    ws.setRelayMoreOpen(raceClass.readoutMode !== null || raceClass.changeoverCode !== null || raceClass.restartRanking !== "AFTER_NORMAL" ||
      raceClass.forking !== "EVEN");
    setRelayLegForms(raceClass.legs.map((leg): RelayLegForm => ({ method: leg.startMethod,
      time: leg.startTime ? formatClockTime(leg.startTime, relay.timeZone).slice(0, 5) : "", variant: leg.variantCode ?? "",
      course: courseOf(leg.leg), minutes: leg.restartAfterMinutes === null ? "" : String(leg.restartAfterMinutes), runners: String(leg.runners),
      changeoverRule: leg.changeoverRule, approvalRule: leg.approvalRule })));
    ws.setRelayChangeoverCode(raceClass.changeoverCode === null ? "" : String(raceClass.changeoverCode));
    ws.setRelayReadoutMode(raceClass.readoutMode ?? "");
  }
  function cancelRelayClassEdit() {
    if (pending.current) return;
    setRelayEditClassId(""); setRelayEditAttempt(undefined); setRelayEditPreview(undefined);
    setRelayClassName(""); setRelayLegForms(defaultLegs(3)); setRelayRestartRanking("AFTER_NORMAL"); setRelayForking("EVEN");
    ws.setRelayReadoutMode(""); ws.setRelayChangeoverCode(""); ws.setRelaySameCourse(""); ws.setRelayMoreOpen(false);
    ws.setRelayClassErrors({}); ws.setRelayClassError(""); ws.setRelayTemplateId(undefined);
  }
  async function saveRelayClassEdit(confirm: boolean) {
    if (writingRef.current || pending.current || !requireSession() || !data || !relayEditClassId) return;
    setRelayMessage(""); ws.setRelayClassError("");
    let attempt = relayEditAttempt && relayEditAttempt.confirmResultChanges === confirm ? relayEditAttempt : undefined;
    if (!attempt) {
      if (!ws.checkRelayClass()) return;
      const legs = relayLegSettings(relayLegForms, data.raceDate, data.timeZone);
      const code = changeoverCodeOf(ws.relayChangeoverCode);
      if (!legs || code === undefined) { ws.setRelayClassError(text.classInvalid); return; }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), classId: relayEditClassId, name: relayClassName.trim(), legs,
        restartRanking: ws.relayRestartRanking, forking: ws.relayForking, confirmResultChanges: confirm, changeoverCode: code,
        readoutMode: ws.relayReadoutMode || null };
      setRelayEditAttempt(attempt);
    }
    const name = attempt.name;
    await sendConfirmable("/relay-class-edit", "relay-class-edit", attempt, value => relayClassEditResponseSchema.parse(value),
      preview => setRelayEditPreview(preview), () => setRelayEditAttempt(undefined), receipt => {
        setRelayEditPreview(undefined); setRelayEditClassId(""); setRelayClassName(""); setRelayLegForms(defaultLegs(3));
        ws.setRelaySameCourse(""); ws.setRelayMoreOpen(false); ws.setRelayClassErrors({});
        return text.editSaved(name, (receipt as { recalculatedCount: number }).recalculatedCount);
      }, ws.relayClassRefused);
  }

  function startTeamEdit(teamId: string) {
    const team = relay?.teams.find(row => row.id === teamId);
    if (!team || pending.current) return;
    setTeamEdit({ teamId, number: String(team.number), name: team.name, club: team.organisationName ?? "" });
    setTeamEditAttempt(undefined); setRelayMessage("");
  }
  async function saveTeamEdit() {
    if (writingRef.current || pending.current || !requireSession() || !teamEdit) return;
    let attempt = teamEditAttempt;
    if (!attempt) {
      const number = Number(teamEdit.number.trim());
      if (!teamEdit.name.trim() || !Number.isInteger(number) || number < 1 || number > 99_999) { setRelayMessage(text.teamInvalid); return; }
      attempt = { formatVersion: 1, requestId: crypto.randomUUID(), teamId: teamEdit.teamId, number, name: teamEdit.name.trim(),
        organisationName: teamEdit.club.trim() || null };
      setTeamEditAttempt(attempt);
    }
    const saved = attempt;
    await send("/relay-team-edit", "relay-team-edit", saved, value => relayTeamEditResponseSchema.parse(value),
      { conflict: text.teamEditConflict, error: text.teamActionError }, () => setTeamEditAttempt(undefined), () => {
        setTeamEdit(undefined);
        return text.teamEditSaved(saved.number, saved.name);
      });
  }

  async function removeTeam(teamId: string, mode: "DELETE" | "STRIKE") {
    if (writingRef.current || pending.current || !requireSession()) return;
    const team = relay?.teams.find(row => row.id === teamId);
    if (!team) return;
    const attempt = teamRemovalAttempt?.teamId === teamId && teamRemovalAttempt.mode === mode ? teamRemovalAttempt
      : { formatVersion: 1 as const, requestId: crypto.randomUUID(), teamId, mode };
    setTeamRemovalAttempt(attempt);
    await send("/relay-team-removal", "relay-team-removal", attempt, value => relayTeamRemovalResponseSchema.parse(value),
      { conflict: text.teamActionError, error: text.teamActionError }, () => setTeamRemovalAttempt(undefined), receipt => {
        const outcome = (receipt as { outcome: string }).outcome;
        if (outcome !== "HAS_RESULT") setSelectedTeamId("");
        return outcome === "DELETED" ? text.teamRemoved(team.number, team.name) : outcome === "STRUCK" ? text.teamStruck(team.number, team.name)
          : text.teamHasResult;
      });
  }

  async function teamDidNotStart(teamId: string) {
    if (writingRef.current || pending.current || !requireSession()) return;
    const team = relay?.teams.find(row => row.id === teamId);
    if (!team) return;
    const attempt = teamDnsAttempt?.teamId === teamId ? teamDnsAttempt : { formatVersion: 1 as const, requestId: crypto.randomUUID(), teamId };
    setTeamDnsAttempt(attempt);
    await send("/relay-team-dns", "relay-team-dns", attempt, value => relayTeamDidNotStartResponseSchema.parse(value),
      { conflict: text.teamActionError, error: text.teamActionError }, () => setTeamDnsAttempt(undefined),
      receipt => text.teamDidNotStartSaved(team.number, (receipt as { didNotStartCount: number }).didNotStartCount));
  }

  function chooseVariant(teamId: string, leg: number, legOrder: number, code: string) {
    if (pending.current) return;
    setVariantChange({ teamId, leg, legOrder, code }); setVariantAttempt(undefined); setVariantPreview(undefined);
  }
  async function saveVariantChange(confirm: boolean) {
    if (writingRef.current || pending.current || !requireSession() || !variantChange) return;
    const leg = relay?.teams.find(row => row.id === variantChange.teamId)?.legs.find(row => row.leg === variantChange.leg && row.legOrder === variantChange.legOrder);
    if (!leg || !variantChange.code) return;
    const attempt = variantAttempt && variantAttempt.confirmResultChanges === confirm ? variantAttempt
      : { formatVersion: 1 as const, requestId: crypto.randomUUID(), teamId: variantChange.teamId, leg: variantChange.leg,
        expectedEntryVersion: leg.entryVersion, variantCode: variantChange.code, confirmResultChanges: confirm, legOrder: variantChange.legOrder };
    setVariantAttempt(attempt);
    await sendConfirmable("/relay-leg-variant", "relay-leg-variant", attempt, value => relayLegVariantResponseSchema.parse(value),
      preview => setVariantPreview(preview), () => setVariantAttempt(undefined), () => {
        setVariantPreview(undefined); setVariantChange(undefined);
        return text.variantSaved(attempt.leg, attempt.variantCode);
      });
  }
  function cancelVariantChange() {
    if (pending.current) return;
    setVariantChange(undefined); setVariantAttempt(undefined); setVariantPreview(undefined);
  }

  return { startRelayClassEdit, cancelRelayClassEdit, saveRelayClassEdit, startTeamEdit, saveTeamEdit, removeTeam, teamDidNotStart,
    chooseVariant, saveVariantChange, cancelVariantChange };
}
