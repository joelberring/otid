import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Startar Next i utvecklingsläge med inställningarna från repots .env
 * (kopierad från .env.example). Variabler som redan är satta i skalet vinner.
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(web, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const next = resolve(web, "node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", ...process.argv.slice(2)], { cwd: web, stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
