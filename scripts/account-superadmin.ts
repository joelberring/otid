/**
 * `pnpm account:superadmin grant|revoke <e-post> [skäl]` – ger eller tar bort superadmin (ADR-0172 beslut 2).
 * Rollen sätts bara här, på servern, aldrig i appen. Åtgärden loggas som "Serverkommando" på superadminsidan.
 * `pnpm account:superadmin verify <e-post>` – bekräftar kontots e-postadress (ADR-0186), t.ex. när servern saknar e-post.
 * `pnpm account:superadmin map-content status|move` – kartornas lagring (ADR-0189): hur mycket som lagras, och steg två av
 *   övergången: flyttar kartbilder och kartfiler ur de gamla kolumnerna till innehållslagret, en rad per transaktion (kan
 *   avbrytas och köras om). Kör `move` först när den nya versionen fungerar (docs/drift.md, Kartornas lagring).
 * `pnpm account:superadmin clubs refresh [--force]` – klubblistan från Eventor (ADR-0209) med `OTID_EVENTOR_API_KEY` (eller en
 *   klubbnyckel som ett klubbarkiv har sparat), högst en gång per dygn (Eventors villkor; `--force` bara vid behov).
 *   `OTID_EVENTOR_BASE_URL` pekar på en annan Eventor (test). Nyckeln skrivs aldrig ut.
 * `pnpm account:superadmin clubs import <fil.xml|->` – samma lista ur en fil (eller stdin), t.ex. hämtad på en annan dator.
 * `pnpm account:superadmin clubs unlink <eventor-id>` – tar bort en klubbytas koppling till klubben (fel klubbyta kopplad).
 * `pnpm account:superadmin clubs sync` – klubbarnas medlemslistor från Eventor som är äldre än ett dygn (görs också i underhållet).
 *
 * I drift finns kommandot paketerat i webbens avbildning:
 *   docker compose -f docker-compose.prod.yml exec web node superadmin.mjs grant anna@klubb.se
 * Läser DATABASE_URL ur miljön. Skriver aldrig lösenord eller annat hemligt.
 */
import { readFile } from "node:fs/promises";
import { createDatabase } from "../packages/database/src/index.ts";
import {
  importOrganisationsFromXml, refreshOrganisationsFromEventor, type OrganisationRefreshResult
} from "../packages/application/src/organisations.ts";
import { anyStoredClubEventorKey, syncDueClubEventorMembers, unlinkOrganisationByCommand } from "../packages/application/src/club-eventor.ts";
import { EventorAdapterError } from "../packages/eventor/src/index.ts";
import { setSuperadmin } from "../packages/application/src/superadmin.ts";
import { markEmailVerifiedByCommand } from "../packages/application/src/email-verification.ts";
import {
  inlineMapContentRows, mapStorageQuota, mapStorageUsage, moveInlineMapContent, sweepMapContent
} from "../packages/application/src/map-content.ts";

const USAGE = "Användning: account:superadmin grant|revoke <e-postadress> [skäl] | verify <e-postadress> | map-content status|move" +
  " | clubs refresh [--force] | clubs import <fil.xml|-> | clubs unlink <eventor-id> | clubs sync";

function refreshReport(result: OrganisationRefreshResult): string {
  if (result.status === "too-soon") return `Ingen hämtning: listan hämtades ${result.lastAt.toISOString()} och Eventor ber om högst en gång per dygn. ` +
    `Nästa tidigast ${result.nextAt.toISOString()} (eller --force).\n`;
  if (result.status === "empty") return "Ingen ändring: listan var tom.\n";
  const { organisations, added, changed, removed } = result.report;
  return `Klart: ${organisations} organisationer (${added} nya, ${changed} ändrade, ${removed} borttagna).\n`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

async function clubsCommand(url: string, args: readonly string[]): Promise<void> {
  const { db, pool } = createDatabase(url);
  try {
    if (args[0] === "import" && args[1]) {
      const xml = args[1] === "-" ? await readStdin() : await readFile(args[1], "utf8");
      process.stdout.write(refreshReport(await importOrganisationsFromXml(db, xml)));
      return;
    }
    if (args[0] === "unlink" && args[1]) {
      process.stdout.write(await unlinkOrganisationByCommand(db, args[1]) === "unlinked"
        ? "Klart: klubben är inte längre kopplad till någon klubbyta. En klubbyta kan nu kopplas med klubbens nyckel.\n"
        : "Ingen ändring: ingen klubbyta är kopplad till klubben.\n");
      return;
    }
    if (args[0] === "sync") {
      const result = await syncDueClubEventorMembers(db);
      process.stdout.write(`Klart: ${result.synced} klubbars medlemslistor hämtade, ${result.failed} misslyckades.\n`);
      return;
    }
    if (args[0] !== "refresh") throw new Error(USAGE);
    const apiKey = process.env.OTID_EVENTOR_API_KEY?.trim() || await anyStoredClubEventorKey(db);
    if (!apiKey) throw new Error("Sätt OTID_EVENTOR_API_KEY (klubbens API-nyckel från Eventor), eller koppla ett klubbarkiv till Eventor först.");
    try {
      process.stdout.write(refreshReport(await refreshOrganisationsFromEventor(db, { apiKey, baseUrl: process.env.OTID_EVENTOR_BASE_URL?.trim() || undefined,
        force: args.includes("--force") })));
    } catch (error) {
      // Adapterns felkoder innehåller aldrig nyckeln eller Eventors svar.
      if (error instanceof EventorAdapterError) throw new Error(`Eventor svarade inte som väntat (${error.code}).`);
      throw error;
    }
  } finally { await pool.end(); }
}
const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export function parseSuperadminArguments(args: readonly string[]): { superadmin: boolean; email: string; reason?: string } {
  const [command, email, ...reason] = args;
  if ((command !== "grant" && command !== "revoke") || !email) throw new Error(USAGE);
  return { superadmin: command === "grant", email, ...(reason.length > 0 ? { reason: reason.join(" ") } : {}) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Sätt DATABASE_URL till databasen.");
  if (args[0] === "clubs") { await clubsCommand(url, args.slice(1)); return; }
  if (args[0] === "map-content") {
    if (args[1] !== "status" && args[1] !== "move") throw new Error(USAGE);
    const { db, pool } = createDatabase(url);
    try {
      if (args[1] === "move") {
        const moved = await moveInlineMapContent(db);
        await db.transaction(tx => sweepMapContent(tx, new Date()));
        process.stdout.write(`Klart: ${Object.entries(moved).map(([table, count]) => `${table} ${count}`).join(", ")} rader flyttade.\n`);
      }
      const usage = await mapStorageUsage(db, null);
      const left = await inlineMapContentRows(db);
      const quota = mapStorageQuota();
      process.stdout.write(`Kartor lagras: ${mb(usage.totalBytes)} (gräns ${quota.totalBytes === null ? "ingen" : mb(quota.totalBytes)}, ` +
        `per konto ${quota.accountBytes === null ? "ingen" : mb(quota.accountBytes)}). Rader kvar i de gamla kolumnerna: ${left}.\n`);
    } finally { await pool.end(); }
    return;
  }
  if (args[0] === "verify") {
    if (!args[1]) throw new Error(USAGE);
    const { db, pool } = createDatabase(url);
    try {
      const result = await markEmailVerifiedByCommand(db, args[1]);
      if (result.status === "not-found") throw new Error("Det finns inget konto med den e-postadressen.");
      process.stdout.write(result.status === "unchanged" ? "Ingen ändring: adressen är redan bekräftad.\n"
        : "Klart: adressen är bekräftad. Behörigheter som andra gett kontot gäller nu.\n");
    } finally { await pool.end(); }
    return;
  }
  const input = parseSuperadminArguments(args);
  const { db, pool } = createDatabase(url);
  try {
    const result = await setSuperadmin(db, input);
    if (result.status === "not-found") throw new Error("Det finns inget konto med den e-postadressen. Personen behöver skapa ett konto först.");
    process.stdout.write(result.status === "unchanged"
      ? `Ingen ändring: kontot ${input.superadmin ? "är redan" : "är inte"} superadmin.\n`
      : `Klart: kontot ${input.superadmin ? "är nu superadmin" : "är inte längre superadmin"}. Åtgärden syns i loggen på /superadmin.\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && /account-superadmin\.ts$|superadmin\.mjs$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
