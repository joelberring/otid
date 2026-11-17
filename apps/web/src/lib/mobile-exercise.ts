import type { BingoMode, RaceType } from "@o-tid/contracts";
import { courseSettingTrainingPath } from "./course-setting-tab";

/**
 * Översynen 2026-11-17: raden "Övning i mobilen" i arbetsytan. Bingo, Sänka skepp och virtuella kontroller ställs in i
 * banläggningen (fliken Träning) och följs på ledarens sida; båda kräver administratör. Servern tillåter övningen i alla
 * typer, men raden visas alltid bara för Träning; för andra typer (utom fest, som saknar banor) när en övning redan är på.
 *
 * `LEADER`: övningen är på, raden leder till ledarens sida. `SETUP`: ingen är på, raden leder dit den slås på.
 */
export type MobileExercise = { target: "LEADER" | "SETUP"; href: string; mode?: BingoMode | undefined };

export function mobileExerciseLink(input: { raceId: string; raceType: RaceType; admin: boolean;
  bingo: { enabled: boolean; mode: BingoMode } | undefined }): MobileExercise | undefined {
  if (!input.admin || input.raceType === "PARTY") return undefined;
  if (input.bingo?.enabled) return { target: "LEADER", href: `/admin/${input.raceId}/bingo`, mode: input.bingo.mode };
  if (input.raceType !== "TRAINING") return undefined;
  return { target: "SETUP", href: courseSettingTrainingPath(input.raceId) };
}

/** Om arbetsytan behöver fråga servern om övningen (bara administratören, inte för en fest). */
export const mobileExerciseApplies = (raceType: RaceType | undefined, admin: boolean) => admin && raceType !== undefined && raceType !== "PARTY";
