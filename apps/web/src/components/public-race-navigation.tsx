import Link from "next/link";
import React from "react";
import { sv } from "../i18n/sv";

export function PublicRaceNavigation({ raceId, currentPage }: { raceId: string; currentPage: "results" | "starts" }) {
  return <nav className="nav" aria-label={sv.publicRaceNavigation}>
    <Link href="/">{sv.publicResultsBack}</Link>
    {currentPage === "results"
      ? <Link href={`/starts/${raceId}`}>{sv.publicRaceStartListLink}</Link>
      : <Link href={`/results/${raceId}`}>{sv.publicRaceResultsLink}</Link>}
  </nav>;
}
