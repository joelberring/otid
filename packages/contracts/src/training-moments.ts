import { z } from "zod";

/**
 * ADR-0222: träningens moment och nivåer, för klubbarkivet och terminsplaneringen. Momenten är en fast lista med koder (namnen
 * finns i webbens texter på svenska och engelska); egna ord sparas som taggar. Nivåerna är Svensk Orienterings färger
 * (samma koder som banläggningens nivåstöd, ADR-0212).
 */
export const TRAINING_MOMENTS = [
  "KARTLASNING", "LEDSTANG", "KOMPASS", "AVSTAND", "KURVBILD", "VAGVAL", "ANGREPPSPUNKT", "DETALJ", "FORENKLING", "KONTROLLTAGNING",
  "KARTMINNE", "STRAK", "KORRIDOR", "FONSTER", "NATT", "SPRINT", "GAFFLING", "FYSISK"
] as const;
export type TrainingMoment = typeof TRAINING_MOMENTS[number];

export const TRAINING_LEVELS = ["GRON", "VIT", "GUL", "ORANGE", "VIOLETT", "BLA", "SVART"] as const;
export type TrainingLevel = typeof TRAINING_LEVELS[number];

/** Momenten och nivåerna i listornas ordning, utan dubbletter och okända koder. */
export const orderedMoments = (values: readonly string[]): TrainingMoment[] => TRAINING_MOMENTS.filter(moment => values.includes(moment));
export const orderedLevels = (values: readonly string[]): TrainingLevel[] => TRAINING_LEVELS.filter(level => values.includes(level));

export const trainingMomentsSchema = z.array(z.enum(TRAINING_MOMENTS)).max(TRAINING_MOMENTS.length).transform(orderedMoments);
export const trainingLevelsSchema = z.array(z.enum(TRAINING_LEVELS)).max(TRAINING_LEVELS.length).transform(orderedLevels);
