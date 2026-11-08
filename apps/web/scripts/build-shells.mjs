import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Bygger det statiska appskal som ska fungera utan nät: /readout/.
 * Skalet får hashade filer (även typsnitten, ADR-0170),
 * index.html och en service worker med manifest över exakt de filerna.
 *
 * Steg 67: banläggningens service worker (/course-setting-sw.js) byggs här också. Banläggningen är en Next-sida, så den
 * har inget eget skal; service workern sparar sidan och Nexts filer när banläggaren väljer "Spara för offline".
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const shells = [
  { name: "readout", define: "READOUT_SHELL", title: "O-Tid – avläsning",
    noscript: "JavaScript behövs för avläsningen." }
];

async function buildShell(shell) {
  const outdir = resolve(web, `public/${shell.name}`);
  const result = await build({
    absWorkingDir: web, entryPoints: [`src/${shell.name}/main.tsx`], outdir,
    entryNames: "app-[hash]", assetNames: "[name]-[hash]", publicPath: `/${shell.name}/`, bundle: true, write: false, minify: true,
    format: "iife", platform: "browser", target: "chrome110", jsx: "automatic", loader: { ".woff2": "file" },
    define: { "process.env.NODE_ENV": '"production"' }, sourcemap: false
  });
  const js = result.outputFiles.filter((file) => file.path.endsWith(".js"));
  const css = result.outputFiles.filter((file) => file.path.endsWith(".css"));
  const fonts = result.outputFiles.filter((file) => file.path.endsWith(".woff2"));
  if (js.length !== 1 || css.length !== 1 || js.length + css.length + fonts.length !== result.outputFiles.length) {
    throw new Error(`Unexpected ${shell.name} build outputs`);
  }
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${shell.title}</title><link rel="stylesheet" href="/${shell.name}/${basename(css[0].path)}"><script defer src="/${shell.name}/${basename(js[0].path)}"></script></head><body><div id="root"></div><noscript>${shell.noscript}</noscript></body></html>`;
  const outputs = [...result.outputFiles.map((file) => ({ path: file.path, contents: file.contents })),
    { path: resolve(outdir, "index.html"), contents: Buffer.from(html) }];
  const manifest = outputs.map((file) => ({ url: `/${shell.name}/${basename(file.path)}`,
    sha256: createHash("sha256").update(file.contents).digest("hex"),
    mime: file.path.endsWith(".html") ? "text/html" : file.path.endsWith(".css") ? "text/css"
      : file.path.endsWith(".woff2") ? "font/woff2" : "application/javascript" }));
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

// ADR-0219 (K3): kartprojektets karta utan nät använder samma service worker med en egen cache (`/map-project-sw.js`).
await mkdir(resolve(web, "public"), { recursive: true });
for (const [file, cache] of [["course-setting-sw.js", "otid-course-setting-v1"], ["map-project-sw.js", "otid-map-project-v1"]]) {
  const built = await build({ absWorkingDir: web, entryPoints: ["src/course-setting-offline/service-worker.ts"], bundle: true,
    write: false, minify: true, format: "iife", platform: "browser", target: "chrome110", define: { __OTID_SW_CACHE__: JSON.stringify(cache) } });
  await writeFile(resolve(web, `public/${file}`), built.outputFiles[0].contents);
}
process.stdout.write("course-setting and map-project service workers built\n");
