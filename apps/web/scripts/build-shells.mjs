import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Bygger de statiska appskal som ska fungera utan nät: /checkin/ och
 * /readout/. Varje skal får hashade filer, index.html och en service worker
 * med manifest över exakt de filerna.
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const shells = [
  { name: "checkin", define: "CHECKIN_SHELL", title: "O-Tid – start och mål",
    noscript: "JavaScript behövs för lokal avprickning." },
  { name: "readout", define: "READOUT_SHELL", title: "O-Tid – avläsning",
    noscript: "JavaScript behövs för avläsningen." }
];

async function buildShell(shell) {
  const outdir = resolve(web, `public/${shell.name}`);
  const result = await build({
    absWorkingDir: web, entryPoints: [`src/${shell.name}/main.tsx`], outdir,
    entryNames: "app-[hash]", bundle: true, write: false, minify: true,
    format: "iife", platform: "browser", target: "chrome110", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, sourcemap: false
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js"));
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"));
  if (!js || !css || result.outputFiles.length !== 2) throw new Error(`Unexpected ${shell.name} build outputs`);
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${shell.title}</title><link rel="stylesheet" href="/${shell.name}/${basename(css.path)}"><script defer src="/${shell.name}/${basename(js.path)}"></script></head><body><div id="root"></div><noscript>${shell.noscript}</noscript></body></html>`;
  const outputs = [...result.outputFiles.map((file) => ({ path: file.path, contents: file.contents })),
    { path: resolve(outdir, "index.html"), contents: Buffer.from(html) }];
  const manifest = outputs.map((file) => ({ url: `/${shell.name}/${basename(file.path)}`,
    sha256: createHash("sha256").update(file.contents).digest("hex"),
    mime: file.path.endsWith(".html") ? "text/html" : file.path.endsWith(".css") ? "text/css" : "application/javascript" }));
  const version = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const worker = await build({ absWorkingDir: web, entryPoints: [`src/${shell.name}/service-worker.ts`],
    bundle: true, write: false, minify: true, format: "iife", platform: "browser", target: "chrome110",
    define: { [`${shell.define}_MANIFEST`]: JSON.stringify(manifest), [`${shell.define}_VERSION`]: JSON.stringify(version) } });
  await mkdir(outdir, { recursive: true });
  for (const file of outputs) await writeFile(file.path, file.contents);
  await writeFile(resolve(outdir, "sw.js"), worker.outputFiles[0].contents);
  process.stdout.write(`${shell.name} shell ${version.slice(0, 12)}: ${manifest.length} public assets\n`);
}

for (const shell of shells) await buildShell(shell);
