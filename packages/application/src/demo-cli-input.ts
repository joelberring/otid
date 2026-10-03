/** Strict CLI grammar; rejected values never appear in error messages. */
export function parseDemoCliArguments(args: readonly string[]): { confirmation: string; outputPath: string } {
  const values = new Map<string, string>();
  if (args.length !== 4) throw new Error("DEMO_ARGUMENTS_INVALID");
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!, value = args[index + 1]!;
    if (!["--confirm", "--private-output"].includes(key) || values.has(key) || !value || value.startsWith("--")) throw new Error("DEMO_ARGUMENTS_INVALID");
    values.set(key, value);
  }
  if (values.get("--confirm") !== "synthetic-empty-database" || !values.has("--private-output")) throw new Error("DEMO_ARGUMENTS_INVALID");
  return { confirmation: values.get("--confirm")!, outputPath: values.get("--private-output")! };
}
