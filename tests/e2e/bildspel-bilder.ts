import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

/**
 * Bildspelets bilder (`bildspel.spec.ts`): skärmbilden i datorn (1440 × 900) med telefonen infälld i en enkel ram nere till
 * höger, liten eller stor, eller (layouten) med två urklipp ur utskriften ovanpå, och sparad som WebP under 200 kB. Samma
 * ordning och namn som `HOME_SLIDES` i webben.
 */
const LAYOUT: Readonly<Record<string, "none" | "small" | "large" | "clips">> = {
  grundkarta: "none", rita: "small", vagval: "none", gps: "large", layout: "clips", forbered: "none", avlasning: "small", resultat: "small",
  arkiv: "none"
};
/** Layoutbildens urklipp: arket med kartan och tryckfärgerna, 600 px breda under överblicken. */
const CLIPS = [{ file: "layout-ark", x: 176, y: 452, width: 600 }, { file: "layout-farger", x: 808, y: 452, width: 600 }] as const;
const WIDTH = 1440, HEIGHT = 900;

function roundedRect(context: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

async function phoneOn(context: SKRSContext2D, file: string, screenHeight: number): Promise<void> {
  const screen = await loadImage(readFileSync(file));
  const screenWidth = Math.round(screenHeight * 390 / 844);
  const bezel = Math.round(screenHeight / 48);
  const width = screenWidth + 2 * bezel, height = screenHeight + 2 * bezel;
  const x = WIDTH - width - 32, y = Math.max(8, HEIGHT - height - 24);
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.28)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 6;
  roundedRect(context, x, y, width, height, bezel * 3);
  context.fillStyle = "#16181a";
  context.fill();
  context.restore();
  context.save();
  roundedRect(context, x + bezel, y + bezel, screenWidth, screenHeight, bezel * 2);
  context.clip();
  context.imageSmoothingQuality = "high";
  context.drawImage(screen, x + bezel, y + bezel, screenWidth, screenHeight);
  context.restore();
}

async function clipOn(context: SKRSContext2D, file: string, x: number, y: number, width: number): Promise<void> {
  const image = await loadImage(readFileSync(file));
  const height = Math.round(width * image.height / image.width);
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.25)";
  context.shadowBlur = 20;
  context.shadowOffsetY = 5;
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, width, height);
  context.restore();
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);
  context.strokeStyle = "#c8ccca";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}

/** Sätter ihop alla bilder ur `raw` och skriver dem till `out`; ger filstorlekarna i byte. */
export async function composeSlides(raw: string, out: string): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const [name, phone] of Object.entries(LAYOUT)) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext("2d");
    context.drawImage(await loadImage(readFileSync(join(raw, `${name}.png`))), 0, 0, WIDTH, HEIGHT);
    if (phone === "clips") for (const clip of CLIPS) await clipOn(context, join(raw, `${clip.file}.png`), clip.x, clip.y, clip.width);
    else if (phone !== "none") await phoneOn(context, join(raw, `${name}-mobil.png`), phone === "large" ? 820 : 560);
    let quality = 82;
    let bytes = await canvas.encode("webp", quality);
    while (bytes.byteLength > 190_000 && quality > 40) { quality -= 8; bytes = await canvas.encode("webp", quality); }
    writeFileSync(join(out, `${name}.webp`), bytes);
    sizes[name] = bytes.byteLength;
  }
  return sizes;
}
