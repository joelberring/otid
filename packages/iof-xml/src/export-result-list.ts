/**
 * IOF XML 3.0 ResultList: klasserna med individuella resultat och stafettlag. Typerna står i `result-list-types.ts`,
 * löparens resultat i `result-list-person.ts`, lagen i `result-list-team.ts` och det gemensamma i `result-list-xml.ts`.
 */
import {
  IofResultListSerializationError, type IofResultListClass, type IofResultListPersonResult, type IofResultListProjection
} from "./result-list-types";
import { canonicalUuidPattern, escapeXml, line, serializeCourse, validateCourse, validateText } from "./result-list-xml";
import { serializeResult, validateResult, type ValidatedResult } from "./result-list-person";
import { serializeTeam, validateTeamResult } from "./result-list-team";

const IOF_NAMESPACE = "http://www.orienteering.org/datastandard/3.0";
const MAX_CLASSES = 1_000;
const MAX_RESULTS = 10_000;
const sourceHashPattern = /^[a-f0-9]{64}$/;

function validateFinalizationProof(value: unknown, issues: string[]): void {
  const path = "finalizationProof";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(`${path} måste vara ett objekt`);
    return;
  }
  const proof = value as Record<string, unknown>;
  for (const property of Object.keys(proof)) {
    if (property !== "finalizationId" && property !== "revision" && property !== "sourceHash") {
      issues.push(`${path}.${property} är inte tillåten`);
    }
  }
  if (typeof proof.finalizationId !== "string" || !canonicalUuidPattern.test(proof.finalizationId)) {
    issues.push(`${path}.finalizationId måste vara ett kanoniskt gemener-UUID`);
  }
  if (typeof proof.revision !== "number"
    || !Number.isSafeInteger(proof.revision)
    || proof.revision <= 0) {
    issues.push(`${path}.revision måste vara ett positivt säkert heltal`);
  }
  if (typeof proof.sourceHash !== "string" || !sourceHashPattern.test(proof.sourceHash)) {
    issues.push(`${path}.sourceHash måste vara exakt 64 hextecken i gemener`);
  }
}

export function serializeIofResultList(projection: IofResultListProjection): Uint8Array {
  const issues: string[] = [];
  if (typeof projection !== "object" || projection === null || Array.isArray(projection)) {
    throw new IofResultListSerializationError(["projektionen måste vara ett objekt"]);
  }
  if (projection.status !== "Snapshot" && projection.status !== "Complete") {
    issues.push("status måste vara Snapshot eller Complete");
  } else if (projection.status === "Snapshot") {
    if (Object.prototype.hasOwnProperty.call(projection, "finalizationProof")) {
      issues.push("Snapshot får inte ha finalizationProof");
    }
  } else {
    if (!Object.prototype.hasOwnProperty.call(projection, "finalizationProof")) {
      issues.push("Complete kräver finalizationProof");
    } else {
      validateFinalizationProof(projection.finalizationProof, issues);
    }
  }
  validateText(projection.eventName, "eventName", issues);
  if (!Array.isArray(projection.classes)) {
    throw new IofResultListSerializationError(["classes måste vara en lista"]);
  }
  const classes: readonly IofResultListClass[] = projection.classes;
  if (classes.length > MAX_CLASSES) {
    issues.push(`classes får innehålla högst ${MAX_CLASSES} klasser`);
  }

  let resultCount = 0;
  const validatedResults = new Map<IofResultListPersonResult, ValidatedResult>();
  for (const [classIndex, raceClass] of classes.entries()) {
    const classPath = `classes[${classIndex}]`;
    validateText(raceClass.className, `${classPath}.className`, issues);
    if (raceClass.classExternalId !== undefined) {
      validateText(raceClass.classExternalId, `${classPath}.classExternalId`, issues);
    }
    if (raceClass.course !== undefined) validateCourse(raceClass.course, `${classPath}.course`, issues);
    if (!Array.isArray(raceClass.results)) {
      issues.push(`${classPath}.results måste vara en lista`);
      continue;
    }
    const results: readonly IofResultListPersonResult[] = raceClass.results;
    resultCount += results.length;
    for (const [resultIndex, result] of results.entries()) {
      const validated = validateResult(result, `${classPath}.results[${resultIndex}]`, issues);
      validatedResults.set(result, validated);
    }
    for (const [teamIndex, team] of (raceClass.teamResults ?? []).entries()) {
      const teamPath = `${classPath}.teamResults[${teamIndex}]`;
      validateTeamResult(team, teamPath, issues);
      resultCount += team.members.length;
      for (const [memberIndex, member] of team.members.entries()) {
        validatedResults.set(member.result, validateResult(member.result, `${teamPath}.members[${memberIndex}]`, issues));
      }
    }
  }
  if (resultCount > MAX_RESULTS) issues.push(`projektionen får innehålla högst ${MAX_RESULTS} resultat`);
  if (issues.length > 0) throw new IofResultListSerializationError(issues);

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<ResultList xmlns="${IOF_NAMESPACE}" iofVersion="3.0" creator="O-Tid" status="${projection.status}">`);
  line(lines, 1, "<Event>");
  line(lines, 2, `<Name>${escapeXml(projection.eventName)}</Name>`);
  line(lines, 1, "</Event>");
  for (const raceClass of classes) {
    line(lines, 1, '<ClassResult timeResolution="0.001">');
    line(lines, 2, "<Class>");
    if (raceClass.classExternalId !== undefined) {
      line(lines, 3, `<Id>${escapeXml(raceClass.classExternalId)}</Id>`);
    }
    line(lines, 3, `<Name>${escapeXml(raceClass.className)}</Name>`);
    line(lines, 2, "</Class>");
    serializeCourse(lines, 2, raceClass.course);
    for (const result of raceClass.results) {
      serializeResult(lines, result, validatedResults.get(result)!);
    }
    for (const team of raceClass.teamResults ?? []) serializeTeam(lines, team, validatedResults);
    line(lines, 1, "</ClassResult>");
  }
  lines.push("</ResultList>");
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}
