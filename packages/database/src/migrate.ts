import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "./migrator";
import { createDatabase } from "./index";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL måste anges");

const { db, pool } = createDatabase(connectionString);
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

try {
  await migrate(db, { migrationsFolder });
  console.log("Databasmigrationer klara");
} finally {
  await pool.end();
}
