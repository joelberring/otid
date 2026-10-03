import { createDatabase, migrate } from "@o-tid/database";

export default async function globalSetup(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL saknas");
  const { db, pool } = createDatabase(url);
  try {
    await migrate(db, { migrationsFolder: new URL("../../packages/database/migrations", import.meta.url).pathname });
  } finally {
    await pool.end();
  }
}
