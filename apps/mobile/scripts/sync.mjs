// `pnpm sync`: ger reservsidan samma serveradress som appen och kör sedan `cap sync`.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const resolved = JSON.parse(execFileSync("npx", ["cap", "config", "--json"], { encoding: "utf8" }));
const serverUrl = resolved.app.extConfig.server.url;
writeFileSync(new URL("../www/server-url.js", import.meta.url), `window.OTID_SERVER_URL = ${JSON.stringify(serverUrl)};\n`);
process.stdout.write(`Serveradress: ${serverUrl}\n`);
execFileSync("npx", ["cap", "sync", ...process.argv.slice(2)], { stdio: "inherit" });
