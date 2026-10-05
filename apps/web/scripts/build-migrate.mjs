import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Paketerar serverkommandona till fristående filer för driftbilden. Se Dockerfile och docs/drift.md:
 * databasmigreringen (`node migrate.mjs`, med MIGRATIONS_DIR satt) och superadmin
 * (`node superadmin.mjs grant <e-post>`, ADR-0172).
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commands = [
  { entry: "../../packages/database/src/migrate.ts", out: ".next/migrate.mjs" },
  { entry: "../../scripts/account-superadmin.ts", out: ".next/superadmin.mjs" }
];
for (const command of commands) {
  await build({
    absWorkingDir: web,
    entryPoints: [resolve(web, command.entry)],
    outfile: resolve(web, command.out),
    bundle: true, platform: "node", target: "node22", format: "esm",
    external: ["pg-native"],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }
  });
  process.stdout.write(`Serverkommando paketerat: ${command.out}\n`);
}
