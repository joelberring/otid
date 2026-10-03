import { parseCaptureArguments, parseReplayArguments } from "./cli-arguments.js";
import { runCaptureCommand } from "./capture-command.js";
import { runPortsCommand } from "./ports-command.js";
import { runReplayCommand } from "./replay-command.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(args: readonly string[]): Promise<void> {
  const [command, ...commandArguments] = args;
  if (command === "replay") {
    const parsed = parseReplayArguments(commandArguments);
    process.stdout.write(`${await runReplayCommand(parsed.manifestPath)}\n`);
    return;
  }
  if (command === "ports" || command === "capture") {
    const { serialPortDriver } = await import("./serial-driver.js");
    if (command === "ports") {
      if (commandArguments.length > 0) throw new Error("Usage: pnpm si:ports");
      process.stdout.write(`${await runPortsCommand(serialPortDriver)}\n`);
      return;
    }
    const parsed = parseCaptureArguments(commandArguments);
    const finalized = await runCaptureCommand(parsed, {
      driver: serialPortDriver,
      statusOutput: process.stderr
    });
    process.stdout.write(`${JSON.stringify({ manifestPath: finalized.manifestPath })}\n`);
    return;
  }
  throw new Error("Usage: pnpm si:ports | pnpm si:capture --port <path> --baud <rate> --out <directory> | pnpm si:replay <session.json>");
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
