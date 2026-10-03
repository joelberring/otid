/** Display an instant in the competition's zone, never the device's zone. */
export function formatStartListTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "longOffset",
    ...(date.getUTCMilliseconds() === 0 ? {} : { fractionalSecondDigits: 3 as const })
  }).format(date);
}
