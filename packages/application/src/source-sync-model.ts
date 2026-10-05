import { createHash } from "node:crypto";
import type { SyncRow } from "@o-tid/contracts";
import type { CourseDataImport } from "@o-tid/iof-xml";

/**
 * Gemensam modell för uppdateringar från Eventor och banfiler (ADR-0170 beslut 4).
 * Källan sparas som en projektion (`source_snapshot.projection`); skillnaderna räknas
 * fram mot tävlingens nuvarande läge av rena funktioner och blir rader med en åtgärd.
 */

/** Eventor i O-Tids modell. Eventors id är extern identitet. */
export interface EventorProjection {
  readonly kind: "EVENTOR";
  readonly event: { readonly id: string; readonly name: string; readonly date: string; readonly clock: string | null;
    readonly form: "INDIVIDUAL" | "RELAY" | "OTHER" };
  readonly classes: readonly { readonly id: string; readonly name: string; readonly cancelled: boolean }[];
  readonly entries: readonly { readonly id: string; readonly classId: string; readonly givenName: string; readonly familyName: string;
    readonly club: string | null; readonly cardNumber: string | null }[];
  readonly teams: readonly { readonly id: string; readonly classId: string; readonly name: string; readonly club: string | null;
    readonly runners: readonly { readonly leg: number; readonly givenName: string | null; readonly familyName: string | null;
      readonly club: string | null; readonly cardNumber: string | null }[] }[];
}

export interface CourseFileProjection {
  readonly kind: "COURSE_FILE";
  readonly data: Omit<CourseDataImport, "kind">;
}

export type SourceProjection = EventorProjection | CourseFileProjection;

/** Tävlingens nuvarande läge, så mycket som skillnaderna behöver. */
export interface CurrentClass {
  readonly id: string; readonly name: string; readonly externalSource: string | null; readonly externalId: string | null;
  readonly courseId: string; readonly courseVersionId: string; readonly startRule: "FIXED" | "PUNCH";
  /** Antal sträckor; 0 för en individuell klass. */
  readonly legCount: number;
}
export interface CurrentEntry {
  readonly id: string; readonly classId: string; readonly givenName: string; readonly familyName: string;
  readonly organisationName: string | null; readonly externalSource: string | null; readonly externalId: string | null;
  readonly teamId: string | null; readonly relayLeg: number | null; readonly version: number;
  /** Den enda aktiva brickan, eller null. */
  readonly cardNumber: string | null;
  /** Löparens aktiva bricka har lästs av. */
  readonly readOut: boolean;
  /** Löparen har någon resultatrevision (avläsning eller beslut). */
  readonly hasResult: boolean;
  /** Senaste resultatet är "ej start" (redan struken). */
  readonly didNotStart: boolean;
}
export interface CurrentTeam {
  readonly id: string; readonly classId: string; readonly name: string; readonly organisationName: string | null;
  readonly externalSource: string | null; readonly externalId: string | null;
}
export interface CurrentCourse {
  readonly id: string; readonly name: string; readonly externalSource: string | null; readonly externalId: string | null;
  readonly versionId: string; readonly version: number; readonly controlCodes: readonly number[];
  readonly variants: readonly { readonly code: string; readonly controlCodes: readonly number[] }[];
}
export interface CurrentState {
  readonly timeZone: string;
  readonly raceDate: string;
  readonly classes: readonly CurrentClass[];
  readonly entries: readonly CurrentEntry[];
  readonly teams: readonly CurrentTeam[];
  readonly courses: readonly CurrentCourse[];
}

/** Banan som Eventor-klasser får innan banfilen lästs in. Den har inga kontroller. */
export const PLACEHOLDER_COURSE = { externalSource: "otid", externalId: "ingen-bana", name: "Bana saknas" } as const;

export type ClassRef = { readonly existing: string } | { readonly newEventorClass: string };
export type CourseRef = { readonly existing: string } | { readonly newCourse: string };

export type EventorAction =
  | { readonly type: "CREATE_CLASS"; readonly eventorId: string; readonly name: string; readonly legCount: number }
  | { readonly type: "RENAME_CLASS"; readonly classId: string; readonly name: string }
  | { readonly type: "CREATE_ENTRY"; readonly eventorId: string; readonly classRef: ClassRef; readonly givenName: string;
      readonly familyName: string; readonly club: string | null; readonly cardNumber: string | null }
  | { readonly type: "UPDATE_ENTRY"; readonly entryId: string; readonly eventorId: string | null;
      readonly name?: { readonly givenName: string; readonly familyName: string }; readonly club?: string | null;
      readonly classRef?: ClassRef; readonly cardNumber?: string }
  | { readonly type: "WITHDRAW"; readonly entryIds: readonly string[] }
  | { readonly type: "CREATE_TEAM"; readonly eventorId: string; readonly classRef: ClassRef; readonly name: string;
      readonly club: string | null; readonly runners: EventorProjection["teams"][number]["runners"] }
  | { readonly type: "UPDATE_TEAM"; readonly teamId: string; readonly name?: string; readonly club?: string | null }
  | { readonly type: "NONE" };

export type CourseFileAction =
  | { readonly type: "CREATE_COURSE"; readonly externalId: string; readonly name: string; readonly controlCodes: readonly number[];
      readonly variants: readonly { readonly code: string; readonly controlCodes: readonly number[] }[] }
  | { readonly type: "CHANGE_COURSE"; readonly courseId: string; readonly controlCodes: readonly number[];
      readonly variants: readonly { readonly code: string; readonly controlCodes: readonly number[] }[] }
  | { readonly type: "CREATE_CLASS"; readonly externalId: string; readonly name: string; readonly courseRef: CourseRef }
  | { readonly type: "CHANGE_CLASS_COURSE"; readonly classId: string; readonly courseRef: CourseRef }
  | { readonly type: "NONE" };

export interface PlannedRow<A> { readonly row: SyncRow; readonly action: A }

/** Det som skillnaden ger: raderna, länkar som görs tyst (matchning på namn av klass eller bana) och antal oförändrade. */
export interface SourceDiff<A> {
  readonly rows: readonly PlannedRow<A>[];
  readonly links: readonly { readonly id: string; readonly externalId: string }[];
  readonly unchanged: number;
}

/** Kort, stabilt rad-id av radens identitet. */
export function rowId(key: string): string {
  return `r${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

/** Jämförelse av namn, klubbar och klasser: blanksteg och skiftläge spelar ingen roll. */
export function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("sv-SE");
}

export function fullName(givenName: string | null, familyName: string | null): string {
  return [givenName, familyName].filter(Boolean).join(" ");
}

export function row(input: Omit<SyncRow, "id" | "matchedByName" | "readOut" | "optional" | "note" | "context" | "changes"> &
  Partial<Pick<SyncRow, "matchedByName" | "readOut" | "optional" | "note" | "context" | "changes">> & { key: string }): SyncRow {
  const { key, ...rest } = input;
  return { id: rowId(key), context: null, changes: [], matchedByName: false, readOut: false, optional: true, note: null, ...rest };
}

export function sameCodes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((code, index) => code === right[index]);
}
