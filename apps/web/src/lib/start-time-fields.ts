import { fixedStartTimeSchema } from "@o-tid/contracts";

/** Compose explicit fields only; never infer a date, zone or daylight-saving offset. */
export function parseStartTimeFields(date: string, time: string, offset: string): string | null {
  const day = date.trim(), clock = time.trim(), zone = offset.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !/^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(clock) ||
    !/^(?:Z|[+-]\d{2}:\d{2})$/.test(zone)) return null;
  const seconds = clock.length === 5 ? `${clock}:00` : clock;
  const parsed = fixedStartTimeSchema.safeParse(`${day}T${seconds}${zone}`);
  return parsed.success ? parsed.data : null;
}
