import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { z } from "zod";
import { inspectPmDockerPrestartConfiguration } from "../src/pm-docker-inspect";
import { pmDockerPrestartInputSchema } from "../src/pm-docker-prestart";

// Opt-in, read-only probe of independently provisioned synthetic Linux metadata.
// Matching metadata does not authorize execution or establish runtime isolation.
const inputSchema = z.object({
  socketPath: z.string().min(1).max(100)
    .regex(/^\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*$/),
  expected: pmDockerPrestartInputSchema
}).strict();
const invalid = { status: "invalid-configuration" as const };

async function probe() {
  const path = process.argv[2], uid = process.getuid?.();
  if (process.argv.length !== 3 || process.platform !== "linux" || uid === undefined || uid === 0 ||
    !path || !isAbsolute(path) || normalize(path) !== path ||
    [...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return invalid;
  let input: unknown;
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > 16 * 1024) return invalid;
      const bytes = Buffer.alloc(16 * 1024 + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      if (length < 1 || length > 16 * 1024) return invalid;
      input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) as unknown;
    } finally { await file.close(); }
  } catch { return invalid; }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return invalid;
  return inspectPmDockerPrestartConfiguration({ socketPath: parsed.data.socketPath }, parsed.data.expected);
}

try {
  const result = await probe();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "configuration-matches" ? 0 : result.status === "invalid-configuration" ? 2 : 1;
} catch {
  process.stdout.write(`${JSON.stringify(invalid)}\n`);
  process.exitCode = 2;
}
