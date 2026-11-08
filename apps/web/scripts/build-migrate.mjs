import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync } from "node:fs";
import { build } from "esbuild";

/**
 * Paketerar serverkommandona till fristående filer för driftbilden. Se Dockerfile och docs/drift.md:
 * databasmigreringen (`node migrate.mjs`, med MIGRATIONS_DIR satt), superadmin
 * (`node superadmin.mjs grant <e-post>`, ADR-0172) och utskriftsarbetaren (`node print-worker.mjs`, steg 65; typsnitten
 * kopieras till `fonts/` bredvid den).
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commands = [
  { entry: "../../packages/database/src/migrate.ts", out: ".next/migrate.mjs" },
  { entry: "../../scripts/account-superadmin.ts", out: ".next/superadmin.mjs" },
  { entry: "../../scripts/print-worker.ts", out: ".next/print-worker.mjs" }
];
for (const command of commands) {
  await build({
    absWorkingDir: web,
    entryPoints: [resolve(web, command.entry)],
    outfile: resolve(web, command.out),
    bundle: true, platform: "node", target: "node22", format: "esm",
    // ADR-0219 (K2): Skia-canvasen är en inbyggd modul och installeras bredvid kommandot i avbildningen (Dockerfile).
    external: ["pg-native", "@napi-rs/canvas"],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }
  });
  process.stdout.write(`Serverkommando paketerat: ${command.out}\n`);
}
cpSync(resolve(web, "../../packages/print-pdf/fonts"), resolve(web, ".next/fonts"), { recursive: true });
process.stdout.write("Typsnitten för PDF:en kopierade: .next/fonts\n");
