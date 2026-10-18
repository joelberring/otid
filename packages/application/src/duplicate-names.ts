import { and, eq, ne, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * Dubbla klass- och bannamn i en tävling avvisas (PLAN.md steg 22). Jämförelsen bortser från skiftläge,
 * som det unika indexet i migration 0104. Tjänsterna frågar här innan de skriver, så att svaret blir ett
 * begripligt "finns redan" i stället för ett databasfel.
 */
export async function classNameTaken(tx: DbExecutor, raceId: string, name: string, exceptClassId?: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.classes.id }).from(schema.classes)
    .where(and(eq(schema.classes.raceId, raceId), sql`lower(${schema.classes.name}) = lower(${name})`,
      ...(exceptClassId ? [ne(schema.classes.id, exceptClassId)] : []))).limit(1);
  return row !== undefined;
}

export async function courseNameTaken(tx: DbExecutor, raceId: string, name: string, exceptCourseId?: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.courses.id }).from(schema.courses)
    .where(and(eq(schema.courses.raceId, raceId), sql`lower(${schema.courses.name}) = lower(${name})`,
      ...(exceptCourseId ? [ne(schema.courses.id, exceptCourseId)] : []))).limit(1);
  return row !== undefined;
}

/** Ett namn som redan finns i tävlingen (banfilens banor). */
export class DuplicateNameError extends Error {
  constructor(readonly kind: "class" | "course", readonly duplicateName: string) {
    super(`${kind === "class" ? "Klassen" : "Banan"} "${duplicateName}" finns redan i tävlingen`);
    this.name = "DuplicateNameError";
  }
}
