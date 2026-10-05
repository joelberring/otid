/**
 * En koordinat som admin skriver eller klistrar in i georeferensen: "lat, lon" med punkt som decimaltecken
 * (som webbkartor kopierar dem), eller med decimalkomma och mellanslag eller semikolon mellan talen.
 */
export function parseCoordinate(value: string): { latitude: number; longitude: number } | undefined {
  const trimmed = value.trim();
  const parts = (/\d\.\d/.test(trimmed) ? trimmed.split(/[\s,;]+/) : trimmed.split(/[\s;]+/).map(part => part.replace(/,$/, "").replace(",", ".")))
    .filter(part => part.length > 0);
  if (parts.length !== 2 || parts.some(part => !/^[-+]?\d+(\.\d+)?$/.test(part))) return undefined;
  const [latitude, longitude] = parts.map(Number) as [number, number];
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? { latitude, longitude } : undefined;
}

export function formatCoordinate(point: { latitude: number; longitude: number }): string {
  return `${point.latitude}, ${point.longitude}`;
}
