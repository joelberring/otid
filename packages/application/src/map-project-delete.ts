import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { mapProjectJournal, requireMapProject } from "./map-project-access";
import { purgeRows } from "./purge";
import type { DbExecutor } from "./snapshot";

/**
 * Ägaren 2026-11-13: ett kartprojekt ska gå att radera (listan med prov- och testprojekt blev ohanterlig).
 *
 * Bara projektets ägare (samma prövning som att avsluta och hantera medlemmar: `requireMapProject` med "manage", alltså
 * också klubbens administratörer). Raderingen är en vanlig radering utan papperskorg och sker i en transaktion med samma
 * borttagning som när ett konto tas bort (`purgeRows`): allt som pekar på projektet följer de främmande nycklarna, alltså
 * ändringar och objekt, förslag, delområden, underlag, noteringar, spår, kontroller, skisser, arbetslager, laserkörningar med
 * resultatfiler, kartjobb, medlemmar och inbjudningar.
 *
 * - Banläggningar: raden som säger att tävlingens karta kom ur projektet (`race_map_project_link`, 0117) tas bort. Tävlingens
 *   kartfil är en egen ögonblicksbild (`race_map_source`) och lämnas orörd; banläggningen visar bara inte längre
 *   «Ta in kartans ändringar».
 * - Kartversioner som skrivits ur projektet i klubbarkivet (`club_map_version`) pekar inte tillbaka på projektet och tas inte bort.
 * - Pågående laserkörningar och kartjobb (QUEUED/RUNNING) hindrar raderingen (`busy`): en arbetare kan hålla på att skriva
 *   resultat till projektet, och att avbryta åt användaren i samma steg vore att radera mer än hen bekräftat. Körningarna
 *   avbryts i projektets laserpanel, sedan går det att radera.
 * - Filerna (`map_content`) frigörs direkt, så att lagringskvoten minskar: innehållet som projektet pekade på släpps om ingen
 *   annan rad (en tävlings kartfil, ett annat projekt, en kartversion) pekar på det.
 */
export type DeleteMapProjectResult = ClubFailure | { status: "busy"; runs: number } | { status: "deleted"; name: string; releasedFiles: number };

/** Innehållet (sha256) som projektets rader pekar på, att släppa när raderna är borta. */
async function projectContents(tx: DbExecutor, projectId: string): Promise<string[]> {
  const rows = (await tx.execute<{ sha: string }>(sql`
    select base_sha256 as sha from map_project where id = ${projectId}::uuid
    union select content_sha256 from map_project_output where project_id = ${projectId}::uuid and content_sha256 is not null
    union select content_sha256 from map_project_layer where project_id = ${projectId}::uuid
    union select o.content_sha256 from map_project_geo_output o join map_project_geo_job j on j.id = o.job_id where j.project_id = ${projectId}::uuid`)).rows;
  return rows.map(row => row.sha);
}

/** Antal köade eller pågående körningar i projektet (laserkörningar och kartjobb). */
async function runningRuns(tx: DbExecutor, projectId: string): Promise<number> {
  const [geo] = (await tx.execute<{ n: string }>(sql`select count(*)::text as n from map_project_geo_job
    where project_id = ${projectId}::uuid and status in ('QUEUED', 'RUNNING')`)).rows;
  const [jobs] = (await tx.execute<{ n: string }>(sql`select count(*)::text as n from map_project_job
    where project_id = ${projectId}::uuid and status in ('QUEUED', 'RUNNING')`)).rows;
  return Number(geo?.n ?? 0) + Number(jobs?.n ?? 0);
}

export async function deleteMapProject(db: Database, input: ClubProof & { projectId: string }, now = new Date()): Promise<DeleteMapProjectResult> {
  return db.transaction(async tx => {
    // Projektraden låses här, så ingen ny körning hinner läggas till (de går genom samma lås) medan vi kontrollerar.
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    const { project } = access;
    const runs = await runningRuns(tx, project.id);
    if (runs > 0) return { status: "busy", runs } as const;
    const contents = await projectContents(tx, project.id);
    await purgeRows(tx, "map_project", [project.id]);
    // Utlösarna släpper underlagen och resultaten när deras rader försvinner, men grundfilen (`map_project.base_sha256`) har
    // ingen utlösare; släpp allt här efter borttagningen. Funktionen tar bara bort innehåll som ingen annan rad pekar på.
    let released = 0;
    for (const sha of new Set(contents)) {
      await tx.execute(sql`select otid_map_content_release(${sha})`);
      const [left] = (await tx.select({ sha: schema.mapContents.sha256 }).from(schema.mapContents).where(eq(schema.mapContents.sha256, sha)));
      if (!left) released += 1;
    }
    await mapProjectJournal(tx, project, { action: "MAP_PROJECT_DELETED", actorAccountId: access.accountId,
      details: { projectId: project.id, name: project.name }, now });
    return { status: "deleted", name: project.name, releasedFiles: released } as const;
  });
}
