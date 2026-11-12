import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { normalized } from "./source-sync-model";

/**
 * Användartestet 2026-11-12: klasserna i en anmälningslista eller startlista som inte finns i tävlingen.
 * Importen avvisas med ett läsbart besked i stället för ett serverfel.
 */
export class ImportClassesMissingError extends Error {
  constructor(readonly classNames: readonly string[]) {
    super(`${classNames.length === 1 ? "Klassen" : "Klasserna"} ${listNames(classNames)} finns inte i tävlingen. ` +
      "Skapa klasserna under Klasser eller läs in banfilen först.");
    this.name = "ImportClassesMissingError";
  }
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}`;
}

export interface ImportClassRef {
  readonly classExternalId: string;
  readonly className?: string;
}

/**
 * Filens klasser mot tävlingens: först på IOF-id (klassen kom från en banfil), annars på namn med samma regel som
 * Eventor-hämtningen (`normalized`: blanksteg och skiftläge spelar ingen roll). En handskapad klass förblir handskapad;
 * kopplingen görs om vid varje import i stället för att sparas, eftersom klassens externa id annars gör den till en
 * importerad klass. Ett namn som passar flera klasser räknas som saknat.
 */
export async function matchImportClasses(tx: DbExecutor, raceId: string, refs: readonly ImportClassRef[]): Promise<{
  byExternalId: Map<string, string>;
  missing: string[];
}> {
  const classes = await tx.select({ id: schema.classes.id, name: schema.classes.name, externalSource: schema.classes.externalSource,
    externalId: schema.classes.externalId }).from(schema.classes).where(eq(schema.classes.raceId, raceId));
  const byExternalId = new Map<string, string>();
  const missing: string[] = [];
  for (const ref of refs) {
    if (byExternalId.has(ref.classExternalId)) continue;
    const byId = classes.find(row => row.externalSource === "iof" && row.externalId === ref.classExternalId);
    const name = ref.className ?? ref.classExternalId;
    const byName = byId ? [byId] : classes.filter(row => normalized(row.name) === normalized(name));
    if (byName.length === 1) byExternalId.set(ref.classExternalId, byName[0]!.id);
    else if (!missing.includes(name)) missing.push(name);
  }
  return { byExternalId, missing };
}

/** Som `matchImportClasses`, men avvisar importen när någon klass saknas. */
export async function requireImportClasses(tx: DbExecutor, raceId: string, refs: readonly ImportClassRef[]): Promise<Map<string, string>> {
  const matched = await matchImportClasses(tx, raceId, refs);
  if (matched.missing.length > 0) throw new ImportClassesMissingError(matched.missing);
  return matched.byExternalId;
}
