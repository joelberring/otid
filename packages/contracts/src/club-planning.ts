import { z } from "zod";
import { accountEmailSchema } from "./account";
import { uuidSchema } from "./ids";
import { trainingLevelsSchema, trainingMomentsSchema, type TrainingLevel, type TrainingMoment } from "./training-moments";

/**
 * ADR-0221: terminsplaneringen i klubbytan. Ledare, administratörer och ägare läser och ändrar planen; den som har en
 * uppgift ser bara sina uppgifter (`MyPlanTasksResponse`). Skrivningar som skapar en rad är idempotenta på `requestId`.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const clubTermRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, name: z.string().trim().min(1).max(80), startsOn: isoDate, endsOn: isoDate
}).strict();

export const clubTermUpdateSchema = z.object({
  formatVersion: z.literal(1), name: z.string().trim().min(1).max(80), startsOn: isoDate, endsOn: isoDate
}).strict();

const sessionFields = {
  sessionDate: isoDate,
  startTime: clock.nullable(),
  title: z.string().trim().min(1).max(160),
  place: z.string().trim().max(160),
  note: z.string().trim().max(2000),
  clubMapId: uuidSchema.nullable(),
  trainingGroupId: uuidSchema.nullable(),
  responsibleAccountId: uuidSchema.nullable(),
  /** ADR-0222: moment, nivåer och egna ord (följer med till klubbarkivet). */
  moments: trainingMomentsSchema.default([]),
  levels: trainingLevelsSchema.default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]).transform(values => [...new Set(values)])
};

export const clubPlanSessionCreateSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, termId: uuidSchema, ...sessionFields,
  /** Samma träning varje vecka på samma veckodag till och med terminens sista dag. */
  weekly: z.boolean()
}).strict();

export const clubPlanSessionUpdateSchema = z.object({ formatVersion: z.literal(1), version: z.number().int().min(1), ...sessionFields }).strict();

const taskAssigneeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MEMBER"), accountId: uuidSchema }).strict(),
  z.object({ kind: z.literal("EMAIL"), email: accountEmailSchema }).strict(),
  z.object({ kind: z.literal("NONE") }).strict()
]);

export const clubPlanTaskCreateSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, title: z.string().trim().min(1).max(120), assignee: taskAssigneeSchema
}).strict();

/** Användartestet 2026-11-12 (D): en uppgift ändras (rubrik och person) i stället för att tas bort och läggas till igen. */
export const clubPlanTaskUpdateSchema = z.object({
  formatVersion: z.literal(1), title: z.string().trim().min(1).max(120), assignee: taskAssigneeSchema
}).strict();

export const clubPlanTaskDoneSchema = z.object({ formatVersion: z.literal(1), done: z.boolean() }).strict();

/**
 * Ägaren 2026-11-12: "Hämta ur arkivet" i en vecka. Arkivträningen blir en planerad träning i terminen (rubrik, plats,
 * anteckningar, kartan och, med `withMoments`, moment, nivåer och egna ord; med `withPeople` ledarna enligt personregeln).
 * Banorna och kartan läggs på träningen med Använd igen efteråt.
 */
export const clubPlanFromArchiveSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, entryId: uuidSchema, sessionDate: isoDate, startTime: clock.nullable(),
  withMoments: z.boolean(), withPeople: z.boolean()
}).strict();

/** Ägaren 2026-11-12: "Kopiera upplägg från termin" till en tom termin. */
export const clubTermCopySchema = z.object({ formatVersion: z.literal(1), fromTermId: uuidSchema }).strict();

/** Ägaren 2026-11-12: arkivträningens personer till en planerad träning (Använd igen → Till terminsplanen). */
export const clubPlanPeopleCopySchema = z.object({ formatVersion: z.literal(1), entryId: uuidSchema }).strict();

export interface ClubTermCopyResponse { readonly formatVersion: 1; readonly copied: number; readonly outside: number }

export interface ClubTermView { readonly termId: string; readonly name: string; readonly startsOn: string; readonly endsOn: string; readonly sessions: number }

export interface ClubPlanTaskView {
  readonly taskId: string; readonly title: string;
  /** Kontots namn, adressen (bara för ledarna) eller null utan person. */
  readonly assigneeName: string | null; readonly assigneeEmail: string | null; readonly pending: boolean;
  /** Kontot som har uppgiften (för att ändra den), eller null. */
  readonly assigneeAccountId: string | null;
  readonly done: boolean;
}

export interface ClubPlanSessionView {
  readonly sessionId: string; readonly version: number; readonly sessionDate: string; readonly startTime: string | null;
  readonly title: string; readonly place: string; readonly note: string;
  readonly clubMapId: string | null; readonly mapName: string | null;
  readonly trainingGroupId: string | null; readonly groupName: string | null;
  readonly responsibleAccountId: string | null; readonly responsibleName: string | null;
  /** Träningen som skapades ur planen (null tills "Skapa träningen", eller om den har tagits bort). */
  readonly raceId: string | null;
  readonly moments: readonly TrainingMoment[]; readonly levels: readonly TrainingLevel[]; readonly tags: readonly string[];
  readonly tasks: readonly ClubPlanTaskView[];
}

export interface ClubPlanPerson { readonly accountId: string; readonly name: string; readonly leader: boolean }

export interface ClubPlanResponse {
  readonly formatVersion: 1;
  readonly terms: readonly ClubTermView[];
  /** Den valda terminen med träningarna i datumordning (null utan terminer). */
  readonly term: (ClubTermView & { readonly planSessions: readonly ClubPlanSessionView[] }) | null;
  /** Klubbens bekräftade medlemmar; `leader` för dem som kan vara ansvariga (ledare, administratörer och ägare). */
  readonly people: readonly ClubPlanPerson[];
  readonly maps: readonly { readonly mapId: string; readonly name: string }[];
  /** Träningsgrupperna där den inloggade är ledare. */
  readonly groups: readonly { readonly groupId: string; readonly name: string }[];
}

export interface MyPlanTaskView {
  readonly taskId: string; readonly title: string; readonly done: boolean;
  readonly clubName: string; readonly sessionDate: string; readonly startTime: string | null;
  readonly sessionTitle: string; readonly place: string; readonly mapName: string | null;
  readonly responsibleName: string | null;
  /** De andra uppgifterna på samma träning, utan personer. */
  readonly otherTasks: readonly { readonly title: string; readonly done: boolean }[];
  /** Banläggningen när träningen finns (läsrätt för den med uppgiften). */
  readonly raceId: string | null;
}

export interface MyPlanTasksResponse { readonly formatVersion: 1; readonly tasks: readonly MyPlanTaskView[] }
