/**
 * `pnpm account:superadmin grant|revoke <e-post> [skäl]` – ger eller tar bort superadmin (ADR-0172 beslut 2).
 * Rollen sätts bara här, på servern, aldrig i appen. Åtgärden loggas som "Serverkommando" på superadminsidan.
 * `pnpm account:superadmin verify <e-post>` – bekräftar kontots e-postadress (ADR-0186), t.ex. när servern saknar e-post.
 * `pnpm account:superadmin map-content status|move` – kartornas lagring (ADR-0189): hur mycket som lagras, och steg två av
 *   övergången: flyttar kartbilder och kartfiler ur de gamla kolumnerna till innehållslagret, en rad per transaktion (kan
 *   avbrytas och köras om). Kör `move` först när den nya versionen fungerar (docs/drift.md, Kartornas lagring).
 *
 * I drift finns kommandot paketerat i webbens avbildning:
 *   docker compose -f docker-compose.prod.yml exec web node superadmin.mjs grant anna@klubb.se
 * Läser DATABASE_URL ur miljön. Skriver aldrig lösenord eller annat hemligt.
 */
import { createDatabase } from "../packages/database/src/index.ts";
import { setSuperadmin } from "../packages/application/src/superadmin.ts";
import { markEmailVerifiedByCommand } from "../packages/application/src/email-verification.ts";
import {
  inlineMapContentRows, mapStorageQuota, mapStorageUsage, moveInlineMapContent, sweepMapContent
} from "../packages/application/src/map-content.ts";

const USAGE = "Användning: account:superadmin grant|revoke <e-postadress> [skäl] | verify <e-postadress> | map-content status|move";
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
