import Link from "next/link";
import React from "react";
import { sv } from "../i18n/sv";
import { publicRaceSv } from "../i18n/public-race-sv";
import { raceHubPath } from "../lib/public-race-format";

/** Start- och resultatlistans navigering: tillbaka till tävlingssidan (ADR-0172 beslut 4) och till den andra listan. */
export function PublicRaceNavigation({ raceId, shortCode, currentPage }: { raceId: string; shortCode: string; currentPage: "results" | "starts" }) {
  return <nav className="nav" aria-label={sv.publicRaceNavigation}>
    <Link href={raceHubPath(shortCode)}>{publicRaceSv.hub.back}</Link>
    {currentPage === "results"
      ? <Link href={`/starts/${raceId}`}>{sv.publicRaceStartListLink}</Link>
      : <Link href={`/results/${raceId}`}>{sv.publicRaceResultsLink}</Link>}
  </nav>;
}
