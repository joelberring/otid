import type { PublicFrozenRaceResultsResponse } from "@o-tid/contracts";
import React from "react";
import { frozenResultsEn, frozenResultsSv, publicResultEn, publicResultSv } from "../i18n/public-en";
import { pickTexts, type Language } from "../lib/language";
import { formatDuration } from "../lib/clock-time";

function duration(milliseconds: number | null) {
  if (milliseconds === null) return "–";
  return formatDuration(milliseconds);
}

function resultClass(status: PublicFrozenRaceResultsResponse["results"][number]["status"]): string {
  if (status === "OK") return "result-ok";
  if (status === "MP") return "result-mp";
  if (status === "DSQ") return "result-dsq";
  if (status === "DNF") return "result-dnf";
  if (status === "OOC") return "result-ooc";
  return "result-dns";
}

export function PublicFrozenRaceResults({ result, language = "sv" }: { result: PublicFrozenRaceResultsResponse; language?: Language }) {
  const frozen = pickTexts(language, frozenResultsSv, frozenResultsEn), text = pickTexts(language, publicResultSv, publicResultEn);
  return <section className="public-frozen-race-results" aria-label={frozen.heading}>
    <h1>{result.eventName}</h1>
    <p className="muted">{frozen.finalizedAt(result.finalizedAt)}</p>
    <h2>{frozen.heading}</h2>
    <div className="public-results"><table className="public-results-table"><thead><tr>
      <th>{frozen.className}</th><th>{text.position}</th><th>{frozen.participant}</th>
      <th>{text.status}</th><th>{text.time}</th><th>{text.behind}</th>
    </tr></thead><tbody>{result.results.map((row, index) => <tr key={`${row.className}:${row.familyName}:${row.givenName}:${index}`}>
      <td className="public-result-class" data-label={frozen.className}>{row.className}</td>
      <td data-label={text.position}>{row.position ?? "–"}</td>
      <td className="public-result-participant" data-label={frozen.participant}>{row.givenName} {row.familyName}<br /><small>{row.organisationName}</small></td>
      <td className={resultClass(row.status)} data-label={text.status}>{text.statusLabels[row.status]}</td>
      <td data-label={text.time}>{duration(row.elapsedMs)}</td>
      <td data-label={text.behind}>{row.timeBehindMs === null ? "–" : `+${duration(row.timeBehindMs)}`}</td>
    </tr>)}</tbody></table></div>
  </section>;
}
