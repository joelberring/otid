/** Ett ögonblick som klockslag (HH:MM:SS) i tävlingens tidszon, utan datum och utan tidszonsbeteckning (ADR-0169 beslut 4). */
export function formatClockTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "–";
  return new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(date);
}
