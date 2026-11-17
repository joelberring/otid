import type { JoinCodeResolution } from "@o-tid/application";
import { raceHubPath } from "./public-race-format";

/** Startsidans besked efter "Har du en kod?" (`/?kodfel=…`): koden fanns inte, eller för många försök från samma adress. */
export type JoinCodeProblem = "missing" | "busy";
const PROBLEM_PARAM: Readonly<Record<JoinCodeProblem, string>> = { missing: "saknas", busy: "forsok" };

/** Vart `/kod` skickar besökaren. Utan kod (tomt fält) tillbaka till fältet utan besked. */
export function joinCodeLocation(result: JoinCodeResolution | undefined): string {
  if (!result) return "/#kod";
  if (result.status === "found") {
    const { kind, code } = result.target;
    return kind === "group" ? `/g/${code}` : kind === "party" ? `/fest/${code}` : raceHubPath(code);
  }
  return `/?kodfel=${PROBLEM_PARAM[result.status === "rate-limited" ? "busy" : "missing"]}#kod`;
}

/** Beskedet ur startsidans adress; okända värden ger inget. */
export function joinCodeProblem(value: unknown): JoinCodeProblem | undefined {
  return value === PROBLEM_PARAM.missing ? "missing" : value === PROBLEM_PARAM.busy ? "busy" : undefined;
}
