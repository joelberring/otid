import type { MapObject, Path, PathCommand } from "@o-tid/map-file";
import { objectRefKey, parseObjectRef, type ObjectRef } from "./contract";

/**
 * ADR-0219 beslut 2: revideringens ändringar lagras per objekt. Varje objekt har en nyckel:
 * - `b:<referens>` för ett objekt i grundfilen (referensen ur kontraktet, `objectRefKey`);
 * - `n:<uuid>` för ett nytt objekt (id:t skapas i telefonen, så två nya objekt krockar aldrig).
 *
 * Ett objekts läge är `UNCHANGED` (som i grundfilen, t.ex. efter Ångra), `OBJECT` (ändrat eller nytt) eller `DELETED`.
 * Varje ändring bär id:t för den ändring den bygger på (`base`): stämmer det inte med objektets senaste ändring på servern
 * har någon annan ändrat samma objekt under tiden, och det är en krock (beslut 3).
 */
export type ObjectKey = string;

export type ObjectState =
  | { readonly kind: "UNCHANGED" }
  | { readonly kind: "OBJECT"; readonly object: MapObject }
  | { readonly kind: "DELETED" };

/** Vad ändringen gjorde, för loggen och granskningen (inte för krockarna). */
export const EDIT_KINDS = ["MOVE", "RESHAPE", "ADD", "DELETE", "SYMBOL", "TEXT", "UNDO", "REDO", "RESOLVE"] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

/** En ändring av ett objekt, skapad i telefonen eller datorn. */
export interface RevisionEdit {
  /** Ändringens id (uuid, skapat i klienten): samma ändring två gånger görs en gång. */
  readonly editId: string;
  readonly key: ObjectKey;
  /** Grundfilens objekt (bara för `b:`-nycklar). */
  readonly ref: ObjectRef | null;
  /** Id:t för objektets senaste ändring som klienten byggde på; null = grundfilens objekt (eller ett nytt objekt). */
  readonly base: string | null;
  readonly state: ObjectState;
  readonly kind: EditKind;
  /** När ändringen gjordes (klientens klocka, ISO 8601). */
  readonly at: string;
}

/** Objektets läge på servern. */
export interface ServerObject {
  readonly key: ObjectKey;
  readonly ref: ObjectRef | null;
  readonly state: ObjectState;
  /** Id:t för ändringen som gav läget. */
  readonly lastEditId: string;
  /** Hur många ändringar objektet har fått (för visning). */
  readonly version: number;
  /** Revideringens löpnummer när objektet senast ändrades (hämtningen "sedan"). */
  readonly seq: number;
  readonly authorId: string;
  readonly at: string;
}

export const baseKey = (ref: ObjectRef): ObjectKey => `b:${objectRefKey(ref)}`;
export const newKey = (id: string): ObjectKey => `n:${id}`;
export const isNewKey = (key: ObjectKey) => key.startsWith("n:");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Gränser för ett objekt (servern och telefonens lager prövar samma). */
export const LIMITS = { commands: 20_000, rings: 200, text: 2_000, symbol: 64, coordinate: 5_000_000 } as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= LIMITS.coordinate;

function validCommand(value: unknown): value is PathCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  const flags = (command.corner === undefined || command.corner === true) && (command.dash === undefined || command.dash === true) &&
    (command.gap === undefined || (typeof command.gap === "number" && Number.isInteger(command.gap) && command.gap >= 0 && command.gap <= 7));
  if (!flags || !finite(command.x) || !finite(command.y)) return false;
  if (command.type === "M" || command.type === "L") return true;
  return command.type === "C" && finite(command.x1) && finite(command.y1) && finite(command.x2) && finite(command.y2);
}

function validPath(value: unknown, minimum: number): value is Path {
  return Array.isArray(value) && value.length >= minimum && value.length <= LIMITS.commands && (value[0] as { type?: unknown } | undefined)?.type === "M" &&
    value.every(validCommand);
}

const validAngle = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= -360 && value <= 720;
const validSymbol = (value: unknown) => typeof value === "string" && value.length >= 1 && value.length <= LIMITS.symbol;
const validPoint = (value: unknown) => !!value && typeof value === "object" && finite((value as { x?: unknown }).x) && finite((value as { y?: unknown }).y);

/** Ett kartobjekt som går att rita och skriva: rätt form, ändliga koordinater och inom gränserna. */
export function validObject(value: unknown): value is MapObject {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (!validSymbol(object.symbol)) return false;
  switch (object.kind) {
    case "point": return validPoint(object.at) && validAngle(object.angle);
    case "text": return validPoint(object.at) && validAngle(object.angle) && typeof object.text === "string" && object.text.length <= LIMITS.text;
    case "line": return validPath(object.path, 2);
    case "area": {
      const rings = object.rings;
      return Array.isArray(rings) && rings.length >= 1 && rings.length <= LIMITS.rings && rings.every(ring => validPath(ring, 3)) &&
        validAngle(object.angle) && (rings as unknown[][]).reduce((sum, ring) => sum + ring.length, 0) <= LIMITS.commands;
    }
    default: return false;
  }
}

export function validState(value: unknown): value is ObjectState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  if (state.kind === "UNCHANGED" || state.kind === "DELETED") return Object.keys(state).length === 1;
  return state.kind === "OBJECT" && validObject(state.object) && Object.keys(state).length === 2;
}

/**
 * Ändringen är rimlig i sig: nyckeln stämmer med referensen (grundfilens objekt) eller är ett nytt objekt utan referens, och
 * ett nytt objekt kan inte vara "som i grundfilen". Ger felet som text, eller undefined.
 */
export function editProblem(edit: unknown): string | undefined {
  if (!edit || typeof edit !== "object") return "inte ett objekt";
  const value = edit as Record<string, unknown>;
  if (typeof value.editId !== "string" || !UUID.test(value.editId)) return "editId";
  if (typeof value.key !== "string" || value.key.length > 200) return "key";
  if (value.base !== null && (typeof value.base !== "string" || !UUID.test(value.base))) return "base";
  if (typeof value.kind !== "string" || !(EDIT_KINDS as readonly string[]).includes(value.kind)) return "kind";
  if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return "at";
  if (!validState(value.state)) return "state";
  if (value.key.startsWith("n:")) {
    if (value.ref !== null || !UUID.test(value.key.slice(2))) return "key";
    if (value.state.kind === "UNCHANGED") return "state";
    return undefined;
  }
  const ref = parseObjectRef(value.ref);
  if (!ref || baseKey(ref) !== value.key) return "ref";
  return undefined;
}

/** Två lägen är lika (för Ångra: har någon annan ändrat objektet sedan?). */
export function sameState(a: ObjectState, b: ObjectState): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "OBJECT" || JSON.stringify(a.object) === JSON.stringify((b as Extract<ObjectState, { kind: "OBJECT" }>).object);
}
