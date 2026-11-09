import Link from "next/link";
import React from "react";
import { sv } from "../i18n/sv";
import { publicRaceSv } from "../i18n/public-race-sv";
import { raceHubPath } from "../lib/public-race-format";
import { publicPagesEn } from "../i18n/public-en";
import type { Language } from "../lib/language";

/** Start- och resultatlistans navigering: tillbaka till tävlingssidan (ADR-0172 beslut 4) och till den andra listan. */
export function PublicRaceNavigation({ raceId, shortCode, currentPage, language = "sv" }: { raceId: string; shortCode: string;
  currentPage: "results" | "starts"; language?: Language }) {
  const en = language === "en";
  return <nav className="nav" aria-label={en ? publicPagesEn.navigation : sv.publicRaceNavigation}>
    <Link href={raceHubPath(shortCode)}>{en ? publicPagesEn.back : publicRaceSv.hub.back}</Link>
    {currentPage === "results"
      ? <Link href={`/starts/${raceId}`}>{en ? publicPagesEn.startListLink : sv.publicRaceStartListLink}</Link>
      : <Link href={`/results/${raceId}`}>{en ? publicPagesEn.resultsLink : sv.publicRaceResultsLink}</Link>}
  </nav>;
}
