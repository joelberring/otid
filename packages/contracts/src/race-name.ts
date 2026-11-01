import { z } from "zod";

/**
 * Loppets namn (etapp/lopp). Valfritt: ett evenemang med ett enda lopp har oftast inget eget namn och sparar "";
 * då visas bara evenemangets namn (`raceTitle` i @o-tid/domain). Högst 160 tecken.
 */
export const raceNameSchema = z.string().trim().max(160);
