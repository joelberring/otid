"use client";

import React from "react";
import { courseSettingRaceTypeEn } from "../../i18n/course-setting-link-en";
import { useTexts } from "../language-provider";
import type { RaceType } from "@o-tid/contracts";
import { courseSettingRaceTypeSv } from "../../i18n/course-data-sv";
import styles from "./course-setting.module.css";

/**
 * Banläggningen i alla tävlingstyper (ägaren 2026-11-03). Rogaining lägger poängbanor (poängen i resultatet hör till
 * tävlingens Kontroller & poäng); en fest har inga banor i tävlingen, så banläggningen ger bara kartorna att skriva ut.
 */
export const newCourseKind = (raceType: RaceType | undefined): "NORMAL" | "SCORE" => raceType === "ROGAINING" ? "SCORE" : "NORMAL";
export const canTransfer = (raceType: RaceType | undefined) => raceType !== "PARTY";

export function RaceTypeHint({ raceType }: { raceType: RaceType | undefined }) {
  const text = useTexts(courseSettingRaceTypeSv, courseSettingRaceTypeEn);
  if (raceType !== "ROGAINING" && raceType !== "PARTY") return null;
  return <p className={styles.muted} data-testid="course-setting-race-type">{text[raceType]}</p>;
}
