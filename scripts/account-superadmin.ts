/**
 * `pnpm account:superadmin grant|revoke <e-post> [skäl]` – ger eller tar bort superadmin (ADR-0172 beslut 2).
 * Rollen sätts bara här, på servern, aldrig i appen. Åtgärden loggas som "Serverkommando" på superadminsidan.
 *
 * I drift finns kommandot paketerat i webbens avbildning:
 *   docker compose -f docker-compose.prod.yml exec web node superadmin.mjs grant anna@klubb.se
 * Läser DATABASE_URL ur miljön. Skriver aldrig lösenord eller annat hemligt.
 */
import { createDatabase } from "../packages/database/src/index.ts";
import { setSuperadmin } from "../packages/application/src/superadmin.ts";

const USAGE = "Användning: account:superadmin grant|revoke <e-postadress> [skäl]";

export function parseSuperadminArguments(args: readonly string[]): { superadmin: boolean; email: string; reason?: string } {
  const [command, email, ...reason] = args;
  if ((command !== "grant" && command !== "revoke") || !email) throw new Error(USAGE);
  return { superadmin: command === "grant", email, ...(reason.length > 0 ? { reason: reason.join(" ") } : {}) };
}

async function main(): Promise<void> {
  const input = parseSuperadminArguments(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Sätt DATABASE_URL till databasen.");
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
