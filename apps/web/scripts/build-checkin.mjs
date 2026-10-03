import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireStation = createRequire(resolve(web, "../station/package.json"));
const { build } = requireStation("esbuild");
const outdir = resolve(web, "public/checkin");
const result = await build({
  absWorkingDir: web, entryPoints: ["src/checkin/main.tsx"], outdir,
  entryNames: "app-[hash]", bundle: true, write: false, minify: true,
  format: "iife", platform: "browser", target: "chrome110", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, sourcemap: false
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js"));
const css = result.outputFiles.find((file) => file.path.endsWith(".css"));
if (!js || !css || result.outputFiles.length !== 2) throw new Error("Unexpected checkin build outputs");
const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>O-Tid – start och mål</title><link rel="stylesheet" href="/checkin/${basename(css.path)}"><script defer src="/checkin/${basename(js.path)}"></script></head><body><div id="root"></div><noscript>JavaScript behövs för lokal avprickning.</noscript></body></html>`;
const outputs = [...result.outputFiles.map((file) => ({ path: file.path, contents: file.contents })),
  { path: resolve(outdir, "index.html"), contents: Buffer.from(html) }];
const manifest = outputs.map((file) => ({ url: `/checkin/${basename(file.path)}`,
  sha256: createHash("sha256").update(file.contents).digest("hex"),
  mime: file.path.endsWith(".html") ? "text/html" : file.path.endsWith(".css") ? "text/css" : "application/javascript" }));
const version = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
const worker = await build({ absWorkingDir: web, entryPoints: ["src/checkin/service-worker.ts"],
  bundle: true, write: false, minify: true, format: "iife", platform: "browser", target: "chrome110",
  define: { CHECKIN_SHELL_MANIFEST: JSON.stringify(manifest), CHECKIN_SHELL_VERSION: JSON.stringify(version) } });
await mkdir(outdir, { recursive: true });
for (const file of outputs) await writeFile(file.path, file.contents);
await writeFile(resolve(outdir, "sw.js"), worker.outputFiles[0].contents);
process.stdout.write(`Checkin shell ${version.slice(0, 12)}: ${manifest.length} public assets\n`);
