import type { RevisionEdit, ServerObject } from "./state";

/**
 * ADR-0208 beslut 3: servern avgör varje ändring för sig, i den ordning den kom. Samarbetet i banläggningen (ADR-0181 beslut
 * 4 och 9) prövar krockar mot det som faktiskt ändrades; här är "det som ändrades" alltid ett enda objekt, så regeln blir enkel:
 *
 * - ändringen bygger på objektets senaste ändring (`base` = `lastEditId`, eller null när objektet aldrig ändrats): den görs;
 * - samma ändring igen (samma `editId`, t.ex. när svaret aldrig kom fram till telefonen): den är redan gjord;
 * - annars har någon annan ändrat objektet under tiden: en krock. Ingenting skrivs; den senare får välja vilket läge som ska
 *   gälla (`RESOLVE`, som bygger på det andras senaste ändring).
 *
 * Ett nytt objekt har en egen nyckel (`n:<uuid>`) och krockar därför aldrig när det läggs till. En kedja av egna ändringar på
 * samma objekt i samma omgång krockar efter den första krocken av sig själv, eftersom den bygger på en ändring som aldrig gjordes.
 */
export type EditDecision = "APPLY" | "DUPLICATE" | "CONFLICT";

export function decideEdit(current: Pick<ServerObject, "lastEditId"> | undefined, edit: Pick<RevisionEdit, "base">, alreadyApplied: boolean): EditDecision {
  if (alreadyApplied) return "DUPLICATE";
  if (!current) return edit.base === null ? "APPLY" : "CONFLICT";
  return edit.base === current.lastEditId ? "APPLY" : "CONFLICT";
}
