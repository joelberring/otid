"use client";

import React from "react";
import type { RaceType } from "@o-tid/contracts";
import { courseSettingRaceTypeSv as text } from "../../i18n/course-data-sv";
import styles from "./course-setting.module.css";

/**
 * Banläggningen i alla tävlingstyper (ägaren 2026-11-03). Rogaining lägger poängbanor (poängen i resultatet hör till
 * tävlingens Kontroller & poäng); en fest har inga banor i tävlingen, så banläggningen ger bara kartorna att skriva ut.
 */
export const newCourseKind = (raceType: RaceType | undefined): "NORMAL" | "SCORE" => raceType === "ROGAINING" ? "SCORE" : "NORMAL";
export const canTransfer = (raceType: RaceType | undefined) => raceType !== "PARTY";

export function RaceTypeHint({ raceType }: { raceType: RaceType | undefined }) {
  if (raceType !== "ROGAINING" && raceType !== "PARTY") return null;
  return <p className={styles.muted} data-testid="course-setting-race-type">{text[raceType]}</p>;
}
