export const CLASS_START_DRAW_ALGORITHM_VERSION = "xorshift32-fisher-yates-v1" as const;

export interface ClassStartDrawInput {
  readonly algorithmVersion: typeof CLASS_START_DRAW_ALGORITHM_VERSION;
  readonly seed: number;
  readonly entryIds: readonly string[];
  readonly firstStartTimeMs: number;
  readonly intervalSeconds: number;
}

export interface ClassStartDrawSlot {
  readonly entryId: string;
  readonly startTimeMs: number;
}

export type ClassStartDrawErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_ALGORITHM_VERSION"
  | "INVALID_SEED"
  | "INVALID_ENTRY_IDS"
  | "DUPLICATE_ENTRY_ID"
  | "ENTRY_COUNT_OUT_OF_BOUNDS"
  | "INVALID_FIRST_START_TIME"
  | "INVALID_INTERVAL_SECONDS"
  | "START_TIME_OUT_OF_BOUNDS";

/** A fail-closed validation error for a reproducible class start draw. */
export class ClassStartDrawError extends Error {
  readonly code: ClassStartDrawErrorCode;

  constructor(code: ClassStartDrawErrorCode, message: string) {
    super(message);
    this.name = "ClassStartDrawError";
    this.code = code;
  }
}

const MIN_EPOCH_MS = -62_135_596_800_000;
const MAX_EPOCH_MS = 253_402_300_799_999;
const MAX_UINT32 = 4_294_967_295;
const CANONICAL_LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validateInput(input: unknown): asserts input is ClassStartDrawInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ClassStartDrawError("INVALID_INPUT", "Startlottningens underlag måste vara ett objekt");
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.algorithmVersion !== CLASS_START_DRAW_ALGORITHM_VERSION) {
    throw new ClassStartDrawError("UNSUPPORTED_ALGORITHM_VERSION", "Startlottningens algoritmversion stöds inte");
  }
  if (!isSafeInteger(candidate.seed) || candidate.seed < 1 || candidate.seed > MAX_UINT32) {
    throw new ClassStartDrawError("INVALID_SEED", "Startlottningens seed måste vara ett icke-noll uint32-värde");
  }
  if (!Array.isArray(candidate.entryIds)) {
    throw new ClassStartDrawError("INVALID_ENTRY_IDS", "Startlottningen saknar en entrylista");
  }
  if (candidate.entryIds.length < 1 || candidate.entryIds.length > 10_000) {
    throw new ClassStartDrawError("ENTRY_COUNT_OUT_OF_BOUNDS", "Startlottningen måste omfatta 1 till 10 000 entries");
  }

  const entryIds = new Set<string>();
  for (const entryId of candidate.entryIds) {
    if (typeof entryId !== "string" || !CANONICAL_LOWERCASE_UUID.test(entryId)) {
      throw new ClassStartDrawError("INVALID_ENTRY_IDS", "Startlottningen kräver canonical lowercase UUID för varje entry");
    }
    if (entryIds.has(entryId)) {
      throw new ClassStartDrawError("DUPLICATE_ENTRY_ID", "Samma entry får bara förekomma en gång i startlottningen");
    }
    entryIds.add(entryId);
  }

  if (!isSafeInteger(candidate.firstStartTimeMs) ||
      candidate.firstStartTimeMs < MIN_EPOCH_MS || candidate.firstStartTimeMs > MAX_EPOCH_MS) {
    throw new ClassStartDrawError("INVALID_FIRST_START_TIME", "Första starttiden ligger utanför ISO-år 0001 till 9999");
  }
  if (!isSafeInteger(candidate.intervalSeconds) ||
      candidate.intervalSeconds < 1 || candidate.intervalSeconds > 3_600) {
    throw new ClassStartDrawError("INVALID_INTERVAL_SECONDS", "Startintervallet måste vara 1 till 3 600 hela sekunder");
  }

  const lastStartTimeMs = candidate.firstStartTimeMs +
    (candidate.entryIds.length - 1) * candidate.intervalSeconds * 1_000;
  if (!Number.isSafeInteger(lastStartTimeMs) ||
      lastStartTimeMs < MIN_EPOCH_MS || lastStartTimeMs > MAX_EPOCH_MS) {
    throw new ClassStartDrawError("START_TIME_OUT_OF_BOUNDS", "Sista starttiden ligger utanför ISO-år 0001 till 9999");
  }
}

function nextXorshift32(state: number): number {
  let next = state >>> 0;
  next ^= next << 13;
  next >>>= 0;
  next ^= next >>> 17;
  next >>>= 0;
  next ^= next << 5;
  return next >>> 0;
}

/**
 * Plans a reproducible start order for one class. The returned order is the
 * draw order and assigns consecutive slots from the supplied first instant.
 */
export function planClassStartDraw(input: ClassStartDrawInput): readonly ClassStartDrawSlot[] {
  validateInput(input);

  const shuffledEntryIds = [...input.entryIds].sort();
  let state = input.seed;
  for (let lastIndex = shuffledEntryIds.length - 1; lastIndex > 0; lastIndex -= 1) {
    const bound = lastIndex + 1;
    const limit = Math.floor(MAX_UINT32 / bound) * bound;
    let value: number;
    do {
      state = nextXorshift32(state);
      value = state - 1;
    } while (value >= limit);
    const selectedIndex = value % bound;
    const selected = shuffledEntryIds[lastIndex]!;
    shuffledEntryIds[lastIndex] = shuffledEntryIds[selectedIndex]!;
    shuffledEntryIds[selectedIndex] = selected;
  }

  const intervalMs = input.intervalSeconds * 1_000;
  return shuffledEntryIds.map((entryId, index) => ({
    entryId,
    startTimeMs: input.firstStartTimeMs + index * intervalMs
  }));
}
