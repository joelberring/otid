import { createDatabase, migrate } from "@o-tid/database";
import { startFakeEventor } from "./fake-eventor";
import { startFakeSmtp } from "./fake-smtp";

export default async function globalSetup(): Promise<() => Promise<void>> {
  // Falsk Eventor och SMTP behövs både mot utvecklingsservern och mot driftmiljön (som når dem via host.docker.internal).
  const eventor = await startFakeEventor();
  const smtp = await startFakeSmtp();
  const stop = async () => {
    await new Promise<void>(resolve => eventor.close(() => resolve()));
    await new Promise<void>(resolve => smtp.close(() => resolve()));
  };
  // Mot en körande driftmiljö migrerar servern själv vid start.
  if (process.env.E2E_BASE_URL) return stop;
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL saknas");
  const { db, pool } = createDatabase(url);
  try {
    await migrate(db, { migrationsFolder: new URL("../../packages/database/migrations", import.meta.url).pathname });
  } finally {
    await pool.end();
  }
  return stop;
}
