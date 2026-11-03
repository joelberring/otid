import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { LEADERS_BY_DEFAULT } from "./plan";
import { runImport } from "./run";

/**
 * ADR-0194 beslut 6: `pnpm archive-import <mapp med zip-filer eller mappar> [--dry-run] --server https://…`. Klubben följer av
 * importnyckeln (`--club` är valfritt och kontrolleras mot nyckeln).
 * Körs på ägarens dator; filerna går direkt därifrån till servern. Nyckeln läses från `OTID_IMPORT_TOKEN`, `--nyckel-fil` eller
 * frågas efter (aldrig som argument, så att den inte hamnar i skalets historik).
 */
const HELP = `Användning:
  pnpm archive-import <mapp> [<mapp eller zip> …] --dry-run
  pnpm archive-import <mapp> --server https://otid.example.se

  --dry-run          Läs och skriv rapporten, skicka inget.
  --server <url>     Din O-Tid-server (https).
  --club <id>        Valfritt: klubbens id. Klubben följer av importnyckeln; anges id ska det stämma.
  --utan-ledare      Ta inte med ledarens namn ur [hakparenteser].
  --med-ledare       Ta med ledarens namn ur [hakparenteser].
  --rapport <fil>    Rapportens fil (förval arkivimport-rapport-<tid>.txt här).
  --nyckel-fil <fil> Läs importnyckeln ur en fil (annars OTID_IMPORT_TOKEN eller en fråga).

Bara .ocd, .omap, .xmap, .ppen och IOF CourseData (.xml) läses och skickas. Allt annat hoppas över.`;

/** Frågar efter nyckeln utan att visa det som klistras in (inget eko, inte heller stjärnor). */
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  let muted = true;
  const output = new Writable({ write(chunk: Uint8Array | string, _encoding: BufferEncoding, callback: () => void) {
    if (!muted) process.stdout.write(chunk);
    callback();
  } });
  const prompt = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });
  try { return await prompt.question(""); } finally {
    muted = false;
    prompt.close();
    process.stdout.write("\n");
  }
}

function parse(argv: readonly string[]) {
  const inputs: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--") continue;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (["dry-run", "utan-ledare", "med-ledare", "hjalp", "help"].includes(name)) flags[name] = true;
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
    if (typeof flags.server !== "string") throw new Error("--server behövs (eller --dry-run)");
    token = process.env.OTID_IMPORT_TOKEN?.trim();
    if (!token && typeof flags["nyckel-fil"] === "string") token = (await readFile(resolve(base, flags["nyckel-fil"]), "utf8")).trim();
    if (!token) token = (await askHidden("Importnyckel (från Klubbarkiv → Import): ")).trim();
    if (!/^otid-imp-[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Nyckeln ser inte ut som en importnyckel från O-Tid");
  }
  await runImport({ inputs: inputs.map(input => resolve(base, input)), dryRun, withLeaders: flags["utan-ledare"] === true ? false : flags["med-ledare"] === true || LEADERS_BY_DEFAULT, reportPath, server: flags.server as string | undefined,
    clubId: flags.club as string | undefined, token, log: line => console.log(line) });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
