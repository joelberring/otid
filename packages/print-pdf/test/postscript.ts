/** En liten tolk för PDF:ens typ 4-funktioner (PostScript-kalkylatorn), bara operatorerna som PDF:en använder. */
type Token = number | string | Token[];

function parse(code: string): Token[] {
  const tokens = code.replace(/([{}])/g, " $1 ").trim().split(/\s+/);
  const stack: Token[][] = [[]];
  for (const token of tokens) {
    if (token === "{") stack.push([]);
    else if (token === "}") { const done = stack.pop()!; stack[stack.length - 1]!.push(done); }
    else stack[stack.length - 1]!.push(/^-?[\d.]+$/.test(token) ? Number(token) : token);
  }
  const outer = stack[0]![0];
  if (!Array.isArray(outer)) throw new Error("ingen procedur");
  return outer;
}

function run(program: readonly Token[], stack: (number | boolean)[]): void {
  const num = () => stack.pop() as number;
  for (let index = 0; index < program.length; index += 1) {
    const token = program[index]!;
    if (typeof token === "number") { stack.push(token); continue; }
    if (Array.isArray(token)) {
      const next = program[index + 1];
      if (next !== "if") throw new Error("bara if stöds");
      if (stack.pop() === true) run(token, stack);
      index += 1;
      continue;
    }
    switch (token) {
      case "add": { const b = num(), a = num(); stack.push(a + b); break; }
      case "mul": { const b = num(), a = num(); stack.push(a * b); break; }
      case "dup": stack.push(stack[stack.length - 1]!); break;
      case "pop": stack.pop(); break;
      case "gt": { const b = num(), a = num(); stack.push(a > b); break; }
      case "index": { const n = num(); stack.push(stack[stack.length - 1 - n]!); break; }
      case "roll": {
        const j = num(), n = num();
        const window = stack.splice(stack.length - n, n);
        const shift = ((j % n) + n) % n;
        stack.push(...window.slice(n - shift), ...window.slice(0, n - shift));
        break;
      }
      default: throw new Error(`okänd operator ${token}`);
    }
  }
}

export function evaluateType4(code: string, inputs: readonly number[]): number[] {
  const stack: (number | boolean)[] = [...inputs];
  run(parse(code), stack);
  return stack as number[];
}
