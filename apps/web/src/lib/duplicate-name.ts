import { entryClassAdminErrorResponseSchema } from "@o-tid/contracts";

/**
 * Sant när ett 409-svar betyder att klass- eller bannamnet redan finns i tävlingen (PLAN.md steg 22),
 * till skillnad från att tävlingen ändrats under tiden. Svaret läses bara en gång; anroparen avgör texten.
 */
export async function isDuplicateName(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  const parsed = entryClassAdminErrorResponseSchema.safeParse(await response.clone().json().catch(() => undefined));
  return parsed.success && parsed.data.error === "DUPLICATE_NAME";
}
