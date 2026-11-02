import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { runImport } from "./run";

/**
 * ADR-0194 beslut 6: `pnpm archive-import <mapp med zip-filer eller mappar> [--dry-run] --server https://… --club <id>`.
 * Körs på ägarens dator; filerna går direkt därifrån till servern. Nyckeln läses från `OTID_IMPORT_TOKEN`, `--nyckel-fil` eller
 * frågas efter (aldrig som argument, så att den inte hamnar i skalets historik).
 */
const HELP = `Användning:
  pnpm archive-import <mapp> [<mapp eller zip> …] --dry-run
  pnpm archive-import <mapp> --server https://otid.example.se --club <klubbens id>

  --dry-run          Läs och skriv rapporten, skicka inget.
  --server <url>     Din O-Tid-server (https).
  --club <id>        Klubbens id (står i Klubbarkiv → Import).
  --utan-ledare      Ta inte med ledarens namn ur [hakparenteser].
  --rapport <fil>    Rapportens fil (förval arkivimport-rapport-<tid>.txt här).
  --nyckel-fil <fil> Läs importnyckeln ur en fil (annars OTID_IMPORT_TOKEN eller en fråga).

Bara .ocd, .omap, .xmap, .ppen och IOF CourseData (.xml) läses och skickas. Allt annat hoppas över.`;

function parse(argv: readonly string[]) {
  const inputs: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--") continue;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (["dry-run", "utan-ledare", "hjalp", "help"].includes(name)) flags[name] = true;
      else {
        const value = argv[++index];
        if (value === undefined) throw new Error(`${arg} behöver ett värde`);
        flags[name] = value;
      }
    } else inputs.push(arg);
  }
  return { inputs, flags };
}

async function main() {
  const { inputs, flags } = parse(process.argv.slice(2));
  if (flags.hjalp || flags.help || inputs.length === 0) { console.log(HELP); process.exitCode = inputs.length === 0 && !flags.hjalp && !flags.help ? 1 : 0; return; }
  const dryRun = flags["dry-run"] === true;
  // pnpm kör kommandot i paketets mapp; sökvägarna gäller där kommandot skrevs.
  const base = process.env.INIT_CWD ?? process.cwd();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const reportPath = resolve(base, typeof flags.rapport === "string" ? flags.rapport : `arkivimport-rapport-${stamp}.txt`);
  let token: string | undefined;
  if (!dryRun) {
    if (typeof flags.server !== "string" || typeof flags.club !== "string") throw new Error("--server och --club behövs (eller --dry-run)");
    token = process.env.OTID_IMPORT_TOKEN?.trim();
    if (!token && typeof flags["nyckel-fil"] === "string") token = (await readFile(resolve(base, flags["nyckel-fil"]), "utf8")).trim();
    if (!token) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      token = (await prompt.question("Importnyckel (från Klubbarkiv → Import): ")).trim();
      prompt.close();
    }
    if (!/^otid-imp-[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Nyckeln ser inte ut som en importnyckel från O-Tid");
  }
  await runImport({ inputs: inputs.map(input => resolve(base, input)), dryRun, withLeaders: flags["utan-ledare"] !== true, reportPath, server: flags.server as string | undefined,
    clubId: flags.club as string | undefined, token, log: line => console.log(line) });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
