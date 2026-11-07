/** IOF ResultList: stafettens lagresultat (TeamResult med sträcklöparnas TeamMemberResult). */
import type { IofResultListPersonResult, IofResultListTeamResult } from "./result-list-types";
import { escapeXml, line, validateMilliseconds, validateText } from "./result-list-xml";
import { serializeResult, type ValidatedResult } from "./result-list-person";

export function validateTeamResult(team: IofResultListTeamResult, path: string, issues: string[]): void {
  validateText(team.name, `${path}.name`, issues);
  if (team.organisationName !== undefined) validateText(team.organisationName, `${path}.organisationName`, issues);
  if (!Number.isSafeInteger(team.bibNumber) || team.bibNumber <= 0) issues.push(`${path}.bibNumber måste vara ett positivt heltal`);
  if (!Number.isSafeInteger(team.legCount) || team.legCount < 2) issues.push(`${path}.legCount måste vara minst 2`);
  if ((team.position !== undefined) !== (team.timeBehindMs !== undefined)) {
    issues.push(`${path}.position och ${path}.timeBehindMs måste anges tillsammans`);
  }
  if (team.status === "OK" && team.elapsedMs === undefined) issues.push(`${path} med status OK måste ha elapsedMs`);
  if (team.status !== "OK" && (team.elapsedMs !== undefined || team.position !== undefined)) {
    issues.push(`${path} får bara ha tid och placering när laget är godkänt`);
  }
  if (team.elapsedMs !== undefined) validateMilliseconds(team.elapsedMs, `${path}.elapsedMs`, issues);
  // Steg 48: flera löpare på samma sträcka har var sin ordning (LegOrder).
  const legs = team.members.map((member) => member.leg * 10 + (member.legOrder ?? 1));
  if (new Set(legs).size !== legs.length || team.members.some((member, index) => !Number.isSafeInteger(member.leg) || member.leg < 1 ||
      member.leg > team.legCount || (index > 0 && legs[index]! <= legs[index - 1]!))) {
    issues.push(`${path}.members måste ha unika sträckor i ordning`);
  }
}

export function serializeTeam(lines: string[], team: IofResultListTeamResult, validated: ReadonlyMap<IofResultListPersonResult, ValidatedResult>): void {
  line(lines, 2, "<TeamResult>");
  line(lines, 3, `<Name>${escapeXml(team.name)}</Name>`);
  if (team.organisationName !== undefined) {
    line(lines, 3, "<Organisation>");
    line(lines, 4, `<Name>${escapeXml(team.organisationName)}</Name>`);
    line(lines, 3, "</Organisation>");
  }
  line(lines, 3, `<BibNumber>${team.bibNumber}</BibNumber>`);
  // Lagets resultat efter den senaste avlästa sträckan: tid och placering när laget är klart, annars status.
  for (const [index, member] of team.members.entries()) {
    serializeResult(lines, member.result, validated.get(member.result)!, { indent: 3, leg: member.leg,
      ...(member.legOrder !== undefined ? { legOrder: member.legOrder } : {}),
      ...(index === team.members.length - 1 ? { overall: team } : {}) });
  }
  line(lines, 2, "</TeamResult>");
}
