import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0169 beslut 4: arbetsytan talar vanligt språk. Inga interna id, hashar, versionsnummer eller
 * "svaret saknas"-texter i det som visas för administratören.
 */
const banned = ["uuid", "hash", "tävlingsversion", "revision", "banversion", "slumpfrö", "begäran-id", "lopp-id", "klass-id",
  "svaret saknas", "samma begäran", "utc-offset"];

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(src, "components/race-administrator-workspace.tsx");

/** Texter som bara arbetsytan och dess delar använder. Hela filen granskas. */
const adminFiles = [
  "race-administrator-sv.ts", "race-workspace-navigation-sv.ts", "start-draw-sv.ts", "start-list-publication-sv.ts",
  "forest-watch-sv.ts", "participant-card-sv.ts", "class-table-sv.ts", "checkin-history-sv.ts", "checkin-conflict-review-sv.ts",
  "race-operator-access-sv.ts", "race-preparation-start-list-sv.ts", "race-workflow-detail-sv.ts",
  "race-workspace-speaker-sv.ts", "speaker-board-sv.ts", "course-variants-sv.ts"
];
/** Delade textfiler (även publika sidor): bara nycklarna som arbetsytan läser granskas. */
const sharedFiles = ["sv.ts", "participant-claim-sv.ts"];

function resolveImport(from: string, specifier: string): string | undefined {
  const base = join(dirname(from), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(path => existsSync(path) && !path.endsWith("/"))
    ?? undefined;
}

/** Alla källfiler som arbetsytan når via relativa importer, och vilka i18n-filer de läser med vilket namn. */
function workspaceGraph() {
  const files = new Set<string>(), i18n = new Map<string, { file: string; names: { exported: string; alias: string }[] }[]>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file) || !/\.tsx?$/.test(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/import\s+(?:type\s+)?(?:\{([^}]*)\}|[\w$]+)?\s*(?:from\s*)?["'](\.[^"']+)["']/g)) {
      const target = resolveImport(file, match[2]!);
      if (!target) continue;
      if (target.includes(`${join(src, "i18n")}/`)) {
        const names = (match[1] ?? "").split(",").map(part => part.trim()).filter(Boolean).map(part => {
          const [exported, alias] = part.split(/\s+as\s+/);
          return { exported: exported!, alias: alias ?? exported! };
        });
        i18n.set(relative(join(src, "i18n"), target), [...(i18n.get(relative(join(src, "i18n"), target)) ?? []), { file, names }]);
      } else queue.push(target);
    }
  }
  return { files, i18n };
}

/** Synliga strängar i ett textvärde. För funktioner granskas mallen efter "=>", utan ${…}-uttryck. */
function strings(value: unknown, path: string): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (typeof value === "function") {
    const body = value.toString().split("=>").slice(1).join("=>").replace(/\$\{[^}]*\}/g, "");
    return [...body.matchAll(/`([^`]*)`|"([^"]*)"/g)].map(match => ({ path, text: match[1] ?? match[2] ?? "" }));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => strings(item, `${path}.${key}`));
  }
  return [];
}

function violations(items: { path: string; text: string }[]) {
  return items.filter(item => banned.some(word => item.text.toLocaleLowerCase("sv-SE").includes(word)))
    .map(item => `${item.path}: ${item.text}`);
}

describe("arbetsytans språk", () => {
  const graph = workspaceGraph();

  it("granskar varje textfil som arbetsytan läser", () => {
    const unknown = [...graph.i18n.keys()].filter(file => !adminFiles.includes(file) && !sharedFiles.includes(file));
    expect(unknown).toEqual([]);
  });

  it.each(adminFiles)("%s visar inga interna id, hashar eller versionsnummer", async file => {
    const module = await import(`./${file.replace(/\.ts$/, "")}`) as Record<string, unknown>;
    expect(violations(Object.entries(module).flatMap(([name, value]) => strings(value, name)))).toEqual([]);
  });

  it.each(sharedFiles)("de nycklar i %s som arbetsytan visar är fria från interna begrepp", async file => {
    const module = await import(`./${file.replace(/\.ts$/, "")}`) as Record<string, unknown>;
    const items = (graph.i18n.get(file) ?? []).flatMap(({ file: user, names }) => {
      const source = readFileSync(user, "utf8");
      return names.flatMap(({ exported, alias }) => [...new Set([...source.matchAll(new RegExp(`(?<![\\w$])${alias}\\.(\\w+)`, "g"))]
        .map(match => match[1]!))].flatMap(key => strings((module[exported] as Record<string, unknown>)[key], `${exported}.${key}`)));
    });
    expect(violations(items)).toEqual([]);
  });
});
