/**
 * `pnpm demo` – skapar en färdig träningstävling i den lokala databasen
 * (ADR-0168, steg 5). Kör migreringar, skapar kontot `demo@o-tid.local`, en publicerad tävling med
 * två banor, tio anmälda löpare och sju avläsningar. Tre löpare är kvar i
 * skogen och en är felstämplad, så att allt i arbetsytan går att prova.
 *
 * Endast syntetiska namn. Körs inte mot en produktionsmiljö.
 */
import { createDatabase, migrate } from "../packages/database/src/index.ts";
import { loginUserAccount, registerUserAccount, seedDemoRace, setRacePublicationAsAdmin } from "../packages/application/src/index.ts";

const EMAIL = "demo@o-tid.local";
const PASSWORD = "demo-traning-1";

function fail(message: string): never {
  throw new Error(message);
}

/** Databasen i Docker kan behöva en stund vid första starten (särskilt emulerad på Mac). */
async function waitForDatabase(pool: { query(text: string): Promise<unknown> }): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`Databasen svarar inte: ${describe(error)}. Kör "docker compose ps" och kontrollera att postgres är igång.`);
      if (attempt === 1) process.stdout.write("Väntar på databasen …\n");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? fail("Sätt DATABASE_URL till den lokala databasen (se .env.example).");
  if (process.env.NODE_ENV === "production") fail("pnpm demo körs inte i produktion.");
  const { db, pool } = createDatabase(url);
  try {
    await waitForDatabase(pool);
    await migrate(db, { migrationsFolder: new URL("../packages/database/migrations", import.meta.url).pathname });

    const registered = await registerUserAccount(db, { formatVersion: 1, email: EMAIL, displayName: "Demoarrangör", password: PASSWORD });
    const account = registered.status === "conflict"
      ? await loginUserAccount(db, { formatVersion: 1, email: EMAIL, password: PASSWORD })
      : registered;
    if (account.status !== "authenticated") fail(`Kontot ${EMAIL} finns men lösenordet är ändrat. Använd en tom databas.`);
    const owner = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };

    const seeded = await seedDemoRace(db, { sessionToken: account.sessionToken, csrfToken: account.csrfToken });
    if (seeded.status !== "created") fail(`Demoträningen kunde inte skapas: ${seeded.step}.`);
    const raceId = seeded.raceId;
    // ADR-0172 beslut 4: publicerad, så att startsidan och tävlingssidan visar demoträningen.
    const published = await setRacePublicationAsAdmin(db, { ...owner, raceId, published: true });
    if (published.status !== "saved") fail(`Tävlingen kunde inte publiceras (${published.status}).`);

    const origin = process.env.O_TID_PUBLIC_ORIGIN ?? "http://localhost:3000";
    process.stdout.write([
      "Demoträningen är klar.",
      `  Logga in:   ${origin}/organizer  (e-post: ${EMAIL}, lösenord: ${PASSWORD})`,
      `  Hantera:    ${origin}/admin/${raceId}/manage`,
      `  Avläsning:  ${origin}/admin/${raceId}/readout  (starta övningsstationen)`,
      `  Tävlingen:  ${origin}/t/${published.response.publication.shortCode}  (publicerad, öppen för alla)`,
      `  Resultat:   ${origin}/results/${raceId}`,
      "  10 anmälda, 7 avlästa (1 felstämplad), 3 kvar i skogen.",
      ""
    ].join("\n"));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${describe(error)}\n`);
  process.exitCode = 1;
});
