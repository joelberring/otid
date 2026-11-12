import type { ClubArchiveCourseFileView } from "@o-tid/contracts";

/** Banfilens banor (namnen), för att se om två filer är samma banläggning. */
const coursesOf = (file: ClubArchiveCourseFileView) => [...new Set(file.courses.map(course => course.name))].sort().join("\u0000");

/**
 * Användartestet 2026-11-12 (B): har alla banfiler samma banor (som .ppen och IOF XML ur en tävling) är det samma banläggning
 * i två format. Då används .ppen (den har layouten och allt) utan att fråga; väljaren visas bara när filerna är olika.
 */
export function preferredCourseFile(files: readonly ClubArchiveCourseFileView[]): ClubArchiveCourseFileView | undefined {
  if (files.length < 2 || new Set(files.map(coursesOf)).size > 1) return undefined;
  return files.find(file => file.kind === "PPEN");
}
