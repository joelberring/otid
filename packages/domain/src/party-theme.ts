/**
 * Festens färger (PLAN.md steg 40): kontrast enligt WCAG 2.x. Texten på en färgad yta blir mörk eller ljus efter vad som
 * ger bäst kontrast, och en färg som ska användas som text på ljus bakgrund mörkas tills den klarar AA (4,5:1).
 */
const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error("Färgen måste vara #rrggbb");
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

const toHex = (values: readonly number[]) => `#${values.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(left: string, right: string): number {
  const [light, dark] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Mörk (#1a1a1a) eller vit text på bakgrunden, den som ger bäst kontrast. */
export function readableTextOn(background: string): "#1a1a1a" | "#ffffff" {
  return contrastRatio("#1a1a1a", background) >= contrastRatio("#ffffff", background) ? "#1a1a1a" : "#ffffff";
}

/** Färgen, mörkad i steg om 5 % tills den har minst `ratio` mot bakgrunden (som text). */
export function textColorOn(color: string, background: string, ratio = 4.5): string {
  let values = rgb(color);
  for (let step = 0; step < 40 && contrastRatio(toHex(values), background) < ratio; step += 1) {
    values = values.map(value => value * 0.95) as [number, number, number];
  }
  return toHex(values);
}
