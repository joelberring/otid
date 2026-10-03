import type { PublicFrozenRaceResultsResponse } from "@o-tid/contracts";
import React from "react";
import { sv } from "../i18n/sv";

function duration(milliseconds: number | null) {
  if (milliseconds === null) return "–";
  const wholeSeconds = Math.floor(milliseconds / 1_000);
  const remainder = milliseconds % 1_000;
  const base = `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  return remainder === 0 ? base : `${base}.${String(remainder).padStart(3, "0")}`;
}

function resultClass(status: PublicFrozenRaceResultsResponse["results"][number]["status"]): string {
  if (status === "OK") return "result-ok";
  if (status === "MP") return "result-mp";
  if (status === "DSQ") return "result-dsq";
  if (status === "DNF") return "result-dnf";
  if (status === "OOC") return "result-ooc";
  return "result-dns";
}

export function PublicFrozenRaceResults({ result }: { result: PublicFrozenRaceResultsResponse }) {
  return <section className="public-frozen-race-results" aria-label={sv.publicFrozenResults}>
    <h1>{result.eventName}</h1>
    <p className="muted">{sv.publicFrozenResultsFinalizedAt(result.finalizedAt)}</p>
    <h2>{sv.publicFrozenResults}</h2>
    <div className="public-results"><table className="public-results-table"><thead><tr>
      <th>{sv.publicResultsClass}</th><th>{sv.publicResultsPosition}</th><th>{sv.publicResultsParticipant}</th>
      <th>{sv.publicResultsStatus}</th><th>{sv.publicResultsTime}</th><th>{sv.publicResultsTimeBehind}</th>
    </tr></thead><tbody>{result.results.map((row, index) => <tr key={`${row.className}:${row.familyName}:${row.givenName}:${index}`}>
      <td className="public-result-class" data-label={sv.publicResultsClass}>{row.className}</td>
      <td data-label={sv.publicResultsPosition}>{row.position ?? "–"}</td>
      <td className="public-result-participant" data-label={sv.publicResultsParticipant}>{row.givenName} {row.familyName}<br /><small>{row.organisationName}</small></td>
      <td className={resultClass(row.status)} data-label={sv.publicResultsStatus}>{sv.publicResultsStatusLabels[row.status]}</td>
      <td data-label={sv.publicResultsTime}>{duration(row.elapsedMs)}</td>
      <td data-label={sv.publicResultsTimeBehind}>{row.timeBehindMs === null ? "–" : `+${duration(row.timeBehindMs)}`}</td>
    </tr>)}</tbody></table></div>
  </section>;
}
