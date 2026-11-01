/** Testhjälp: en utlagd beskrivning som SVG (för att titta på den och för att se att alla figurer går att rita). */
import { descriptionSymbols, type DescriptionLayout, type DescriptionStandard, type SymbolShape } from "../src";

const n = (value: number) => Number(value.toFixed(3));
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function shapeSvg(shape: SymbolShape): string {
  const pts = (points: readonly { x: number; y: number }[]) => points.map(p => `${n(p.x)},${n(p.y)}`).join(" ");
  switch (shape.kind) {
    case "polyline": {
      const cap = shape.ends === "flat" ? "butt" : "round";
      const join = shape.corners === "sharp" ? "miter" : "round";
      const tag = shape.closed ? "polygon" : "polyline";
      return `<${tag} points="${pts(shape.points)}" fill="none" stroke="black" stroke-width="${shape.width}" stroke-linecap="${cap}" stroke-linejoin="${join}" stroke-miterlimit="5"/>`;
    }
    case "polygon": return `<polygon points="${pts(shape.points)}" fill="black" fill-rule="evenodd"/>`;
    case "circle": return `<circle cx="${shape.center.x}" cy="${shape.center.y}" r="${shape.radius}" fill="none" stroke="black" stroke-width="${shape.width}"/>`;
    case "disc": return `<circle cx="${shape.center.x}" cy="${shape.center.y}" r="${shape.radius}" fill="black"/>`;
    case "bezier": {
      const [first, ...rest] = shape.points;
      let d = `M${n(first!.x)},${n(first!.y)}`;
      for (let i = 0; i + 2 < rest.length; i += 3) d += ` C${pts(rest.slice(i, i + 3))}`;
      if (shape.filled) return `<path d="${d}" fill="black" fill-rule="evenodd"/>`;
      return `<path d="${d}" fill="none" stroke="black" stroke-width="${shape.width}" stroke-linecap="${shape.ends === "flat" ? "butt" : "round"}" stroke-linejoin="round"/>`;
    }
  }
}

export function descriptionSvg(layout: DescriptionLayout, standard: DescriptionStandard, scale = 1): string {
  const symbols = new Map(descriptionSymbols(standard).map(symbol => [symbol.id, symbol]));
  const parts: string[] = [];
  for (const p of layout.primitives) {
    switch (p.kind) {
      case "line":
        parts.push(`<line x1="${n(p.from.x)}" y1="${n(p.from.y)}" x2="${n(p.to.x)}" y2="${n(p.to.y)}" stroke="black" stroke-width="${n(p.width)}"/>`);
        break;
      case "symbol": {
        const symbol = symbols.get(p.symbol);
        if (!symbol) throw new Error(`Symbolen ${p.symbol} saknas i ${standard}`);
        const s = p.size / 200;
        parts.push(`<g transform="translate(${n(p.at.x)} ${n(p.at.y)}) scale(${n(s)} ${n(-s)})">${symbol.shapes.map(shapeSvg).join("")}</g>`);
        break;
      }
      case "text": {
        const anchor = p.align === "left" ? "start" : p.align === "right" ? "end" : "middle";
        const family = p.condensed ? "'Roboto Condensed', 'Arial Narrow', sans-serif" : "Roboto, Arial, sans-serif";
        parts.push(`<text x="${n(p.at.x)}" y="${n(p.at.y)}" font-size="${n(p.heightMm)}" font-family="${family}"${p.bold ? ' font-weight="bold"' : ""} text-anchor="${anchor}">${escape(p.text)}</text>`);
        break;
      }
      case "hit": break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(layout.widthMm * scale)}mm" height="${n(layout.heightMm * scale)}mm" viewBox="0 0 ${n(layout.widthMm)} ${n(layout.heightMm)}"><rect width="100%" height="100%" fill="white"/>${parts.join("")}</svg>`;
}
