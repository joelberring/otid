import { db } from "../../../../lib/db";
import { raceShortcutRoute } from "../../../../lib/race-shortcut-route";

/** Ägaren 2026-11-15: finns det en snabblänk till arbetsytan för den inloggade på tävlingssidan? */
export async function GET(request: Request): Promise<Response> { return raceShortcutRoute(db, request); }
