import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Paketerar databasmigreringen till en fristående fil för driftbilden
 * (`node migrate.mjs`, med MIGRATIONS_DIR satt). Se Dockerfile och docs/drift.md.
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  absWorkingDir: web,
  entryPoints: [resolve(web, "../../packages/database/src/migrate.ts")],
  outfile: resolve(web, ".next/migrate.mjs"),
  bundle: true, platform: "node", target: "node22", format: "esm",
  external: ["pg-native"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }
});
process.stdout.write("Migrering paketerad: .next/migrate.mjs\n");
