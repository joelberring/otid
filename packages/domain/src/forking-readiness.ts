import { forkingLetters, MAX_FORKING_VARIANTS, type CourseForking, type ForkingChoice } from "./course-forking";

/**
 * Kontroll före tävlingen för en gafflad bana (PLAN.md steg 61). Stoppar aldrig något; arbetsytan visar en rad per bana:
 *
 * - Varianter utan löpare. Har banan minst lika många löpare som varianter räknas de som något att se över; annars är
 *   det väntat att några varianter står oanvända (`unusedExpected`).
 * - Löpare i en gafflad klass utan giltig variant, per klass.
 * - Fördelningen per gafflingspunkt inom varje klass: antal löpare per alternativ (enkel gaffling) eller per
 *   slingordning (fjäril). Ojämn när det skiljer mer än en löpare mellan alternativen.
 * - Antal varianter (högst 100) och bokstäver (högst 26).
 *
 * ADR-0197: bortvalda varianter (`excludedVariantCodes`) räknas inte. De är inte giltiga för löparna, antalet och
 * bokstäverna räknas bara på de behållna, och en löpare med en bortvald kod saknar variant.
 */
export interface ForkingReadinessClass {
  readonly name: string;
  /** Varje löpares kod; null eller en kod som banan inte har = saknar variant. */
  readonly runnerVariants: readonly (string | null)[];
}

export interface ForkingPointCount { readonly letters: string; readonly count: number }

export interface ForkingReadiness {
  /** Behållna varianter. */
  readonly variantCount: number;
  /** Bortvalda varianter (ADR-0197). */
  readonly excludedCount: number;
  readonly tooManyVariants: boolean;
  readonly tooManyLetters: boolean;
  readonly unusedVariants: readonly string[];
  /** Färre löpare än varianter: oanvända varianter är väntade. */
  readonly unusedExpected: boolean;
  readonly missingVariant: readonly { readonly className: string; readonly count: number }[];
  /** Ojämna gafflingspunkter: klassen, punktens nummer (1 = första gafflingen) och antal per alternativ. */
  readonly uneven: readonly { readonly className: string; readonly point: number; readonly counts: readonly ForkingPointCount[] }[];
  /** Inget att se över (oanvända varianter räknas inte när de är väntade). */
  readonly ok: boolean;
}

function choiceLetters(letters: readonly string[], item: CourseForking["items"][number], choice: ForkingChoice | undefined): string {
  if (item.kind === "FORK") return letters[typeof choice === "number" ? choice : 0] ?? "?";
  const order = Array.isArray(choice) ? choice as readonly number[] : item.kind === "LOOP" ? item.loops.map((_loop, index) => index) : [];
  return order.map((index) => letters[index] ?? "?").join("");
}

/** Alla alternativ vid gafflingspunkten, i bokstavsordning (fjärilens slingordningar i lexikografisk ordning). */
function pointOptions(letters: readonly string[], item: CourseForking["items"][number]): string[] {
  if (item.kind === "FORK") return [...letters];
  const walk = (rest: readonly string[]): string[] => rest.length <= 1 ? [rest.join("")]
    : rest.flatMap((letter, index) => walk([...rest.slice(0, index), ...rest.slice(index + 1)]).map((tail) => letter + tail));
  return walk(letters);
}

/**
 * Bokstäverna som behövs: alla alternativ och slingor, eller (med bortval) bara de alternativ som någon behållen variant
 * väljer. En fjäril behåller alla sina slingor (alla springs).
 */
function usedLetterCount(forking: CourseForking, keptCodes: readonly string[] | null,
  choices: ReadonlyMap<string, readonly ForkingChoice[]> | undefined): number {
  return forking.items.reduce((sum, item, index) => {
    if (item.kind === "LOOP") return sum + item.loops.length;
    if (item.kind !== "FORK") return sum;
    if (!keptCodes || !choices) return sum + item.branches.length;
    const used = new Set(keptCodes.map((code) => choices.get(code)?.[index]).filter((choice): choice is number => typeof choice === "number"));
    return sum + (used.size > 0 ? used.size : item.branches.length);
  }, 0);
}

export function forkingReadiness(input: {
  readonly variantCodes: readonly string[];
  readonly forking?: CourseForking | null;
  /** Varje variants val per gafflingspunkt (sparad eller härledd struktur). */
  readonly choices?: ReadonlyMap<string, readonly ForkingChoice[]>;
  readonly classes: readonly ForkingReadinessClass[];
  /** ADR-0197: varianterna som är bortvalda (räknas inte). */
  readonly excludedVariantCodes?: readonly string[];
}): ForkingReadiness {
  const excluded = new Set(input.excludedVariantCodes ?? []);
  const variantCodes = input.variantCodes.filter((code) => !excluded.has(code));
  const valid = new Set(variantCodes);
  const runners = input.classes.flatMap((row) => row.runnerVariants);
  const used = new Set(runners.filter((code): code is string => code !== null && valid.has(code)));
  const unusedVariants = variantCodes.filter((code) => !used.has(code));
  const unusedExpected = runners.length < variantCodes.length;
  const missingVariant = input.classes.flatMap((row) => {
    const count = row.runnerVariants.filter((code) => code === null || !valid.has(code)).length;
    return count > 0 ? [{ className: row.name, count }] : [];
  });
  const forking = input.forking ?? null;
  const letters = forking ? forkingLetters(forking) : [];
  const letterCount = forking ? usedLetterCount(forking, excluded.size > 0 ? variantCodes : null, input.choices) : 0;
  const uneven: { className: string; point: number; counts: ForkingPointCount[] }[] = [];
  if (forking && input.choices) {
    for (const raceClass of input.classes) {
      const codes = raceClass.runnerVariants.filter((code): code is string => code !== null && valid.has(code));
      if (codes.length < 2) continue;
      let point = 0;
      forking.items.forEach((item, index) => {
        const own = letters[index];
        if (item.kind === "CONTROL" || !own) return;
        point += 1;
        const options = pointOptions(own, item);
        // En fjäril med fler än tre slingor har för många ordningar för att jämföra var för sig.
        if (options.length > 6) return;
        const counts = new Map(options.map((option) => [option, 0]));
        for (const code of codes) {
          const key = choiceLetters(own, item, input.choices!.get(code)?.[index]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const values = [...counts.values()];
        if (Math.max(...values) - Math.min(...values) > 1) uneven.push({ className: raceClass.name, point,
          counts: [...counts.entries()].map(([option, count]) => ({ letters: option, count })) });
      });
    }
  }
  const tooManyVariants = variantCodes.length > MAX_FORKING_VARIANTS;
  const tooManyLetters = letterCount > 26;
  return { variantCount: variantCodes.length, excludedCount: input.variantCodes.length - variantCodes.length, tooManyVariants, tooManyLetters, unusedVariants, unusedExpected, missingVariant, uneven,
    ok: !tooManyVariants && !tooManyLetters && missingVariant.length === 0 && uneven.length === 0 && (unusedVariants.length === 0 || unusedExpected) };
}
