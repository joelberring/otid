#!/usr/bin/env node
/**
 * Karttapullautin för bildspelets bild av guiden Ny grundkarta (`bildspel.spec.ts`): den falska (`fake-pullauta.mjs`) gör
 * jobbet, men bilden och kurvorna byts mot de färdiga ur `OTID_BILDSPEL_LASER` (Tallbackens bild och kurvor i SWEREF 99 TM,
 * `bildspel-laser.ts`), så att körningen ser ut som en riktig körning på den påhittade kartan.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [join(here, "fake-pullauta.mjs"), ...process.argv.slice(2)], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const ready = process.env.OTID_BILDSPEL_LASER, command = process.argv[2] ?? "";
const files = command === "pngmerge" ? ["merged.png", "merged.pgw"] : command === "dxfmerge" ? ["merged_contours.dxf", "merged_c2g.dxf"] : [];
if (ready) for (const file of files) copyFileSync(join(ready, file), file);
