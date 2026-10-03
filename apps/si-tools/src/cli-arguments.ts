import { access, realpath } from "node:fs/promises";
import path from "node:path";

export interface CaptureCommandArguments {
  readonly port: string;
  readonly baudRate: number;
  readonly outputDirectory: string;
  readonly allowRepositoryOutput: boolean;
}

export interface ReplayCommandArguments {
  readonly manifestPath: string;
}

function takeOptionValue(args: readonly string[], index: number, name: string): readonly [string, number] {
  const argument = args[index];
  if (argument?.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value`);
    return [value, index];
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return [value, index + 1];
}

export function parseCaptureArguments(args: readonly string[]): CaptureCommandArguments {
  let port: string | undefined;
  let baudText: string | undefined;
  let outputDirectory: string | undefined;
  let allowRepositoryOutput = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-repository-output") {
      if (allowRepositoryOutput) throw new Error("--allow-repository-output may only be specified once");
      allowRepositoryOutput = true;
      continue;
    }
    if (argument === "--port" || argument?.startsWith("--port=")) {
      if (port !== undefined) throw new Error("--port may only be specified once");
      [port, index] = takeOptionValue(args, index, "--port");
      continue;
    }
    if (argument === "--baud" || argument?.startsWith("--baud=")) {
      if (baudText !== undefined) throw new Error("--baud may only be specified once");
      [baudText, index] = takeOptionValue(args, index, "--baud");
      continue;
    }
    if (argument === "--out" || argument?.startsWith("--out=")) {
      if (outputDirectory !== undefined) throw new Error("--out may only be specified once");
      [outputDirectory, index] = takeOptionValue(args, index, "--out");
      continue;
    }
    throw new Error(`Unknown capture argument: ${argument ?? ""}`);
  }

  if (!port) throw new Error("si:capture requires --port");
  if (!baudText) throw new Error("si:capture requires --baud");
  if (!outputDirectory) throw new Error("si:capture requires --out");
  if (!/^[1-9][0-9]*$/.test(baudText)) throw new Error("--baud must be a positive integer");
  const baudRate = Number(baudText);
  if (!Number.isSafeInteger(baudRate)) throw new Error("--baud is outside the safe integer range");

  return { port, baudRate, outputDirectory, allowRepositoryOutput };
}

export function parseReplayArguments(args: readonly string[]): ReplayCommandArguments {
  if (args.length !== 1 || !args[0] || args[0].startsWith("--")) {
    throw new Error("Usage: pnpm si:replay <session.json>");
  }
  return { manifestPath: args[0] };
}

export async function findWorkspaceRoot(startDirectory: string): Promise<string | undefined> {
  let current = path.resolve(startDirectory);
  for (;;) {
    try {
      await access(path.join(current, "pnpm-workspace.yaml"));
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

export function isPathInside(parentDirectory: string, candidate: string): boolean {
  const relative = path.relative(parentDirectory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalizeThroughExistingAncestor(candidate: string): Promise<string> {
  let ancestor = path.resolve(candidate);
  const suffix: string[] = [];
  for (;;) {
    try {
      const canonicalAncestor = await realpath(ancestor);
      return path.resolve(canonicalAncestor, ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

export async function assertCaptureOutputAllowed(
  outputDirectory: string,
  workspaceRoot: string | undefined,
  allowRepositoryOutput: boolean
): Promise<void> {
  if (allowRepositoryOutput || !workspaceRoot) return;
  const resolvedOutput = path.resolve(outputDirectory);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  if (isPathInside(resolvedWorkspaceRoot, resolvedOutput)) {
    throw new Error("Capture output inside the repository requires --allow-repository-output");
  }
  const canonicalWorkspaceRoot = await realpath(resolvedWorkspaceRoot);
  const canonicalOutput = await canonicalizeThroughExistingAncestor(resolvedOutput);
  if (isPathInside(canonicalWorkspaceRoot, canonicalOutput)) {
    throw new Error("Capture output inside the repository requires --allow-repository-output");
  }
}
