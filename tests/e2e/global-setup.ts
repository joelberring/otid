import { createDatabase, migrate } from "@o-tid/database";
import { startFakeEventor } from "./fake-eventor";

export default async function globalSetup(): Promise<() => Promise<void>> {
  // Den falska Eventor behövs både mot utvecklingsservern och mot driftmiljön (som når den via host.docker.internal).
  const eventor = await startFakeEventor();
  const stop = () => new Promise<void>(resolve => eventor.close(() => resolve()));
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
