import { schema } from "@o-tid/database";
import { guessVersionYear } from "@o-tid/domain";

/**
 * ADR-0210: kartversionernas ordning, samma i klubbarkivet och i träningsgruppens bibliotek ("finns en nyare version").
 * Nyaste först: året (inskrivet eller gissat), sedan datumet och uppladdningen.
 */
export type ClubMapVersionFacts = Pick<typeof schema.clubMapVersions.$inferSelect,
  "fileName" | "sourcePath" | "versionDate" | "uploadedAt" | "versionYear">;

/** Versionens år, inskrivet eller gissat (filnamnet, mapparna, årsmappen, datumet, uppladdningen). */
export const versionYearOf = (version: ClubMapVersionFacts) => guessVersionYear({ fileName: version.fileName, sourcePath: version.sourcePath,
  versionDate: version.versionDate, uploadedAt: version.uploadedAt, manualYear: version.versionYear });

/** Nyaste först: året, sedan datumet och uppladdningen. */
export const versionOrder = (a: ClubMapVersionFacts, b: ClubMapVersionFacts) => versionYearOf(b).year - versionYearOf(a).year
  || (b.versionDate ?? "").localeCompare(a.versionDate ?? "") || b.uploadedAt.getTime() - a.uploadedAt.getTime() || a.fileName.localeCompare(b.fileName);

/** Den senaste versionen enligt `versionOrder`. */
export function latestClubMapVersion<T extends ClubMapVersionFacts>(versions: readonly T[]): T | undefined {
  return [...versions].sort(versionOrder)[0];
}
