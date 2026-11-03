"""
O-Tid-loggan (variant B): en lila ring med "tid" i Poppins Bold i mitten. Ringen är O:et i O-Tid och en kontrollring.

Skriptet gör texten till konturer (ingen typsnittsladdning behövs) och skriver alla filer som loggan används i:

- apps/web/src/components/brand/logo-glyphs.ts  "tid" som en SVG-bana i loggans koordinater (viewBox 0 0 100 100)
- apps/web/src/app/icon.svg                     liten variant (ring och punkt), mörkt läge med prefers-color-scheme
- apps/web/src/app/favicon.ico                  liten variant, 16 och 32 px
- apps/web/src/app/apple-icon.png               hela loggan, 180 px på vitt med marginal
- apps/web/public/icons/icon-192.png, icon-512.png, icon-maskable-512.png  manifestets ikoner

Körs för hand när loggan ändras, från repots rot:

    python3 -I scripts/logo/generate.py

Kräver fonttools och Pillow (pip) och rsvg-convert (librsvg). Poppins (SIL OFL) läses ur @fontsource/poppins, som
webben redan har som beroende för festens rubriker; .woff i stället för .woff2 så att fonttools inte behöver brotli.
"""
from __future__ import annotations

import io
import pathlib
import subprocess

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = ROOT / "apps" / "web"
FONT = WEB / "node_modules" / "@fontsource" / "poppins" / "files" / "poppins-latin-700-normal.woff"

LIGHT = "#A626FF"
DARK = "#C77DFF"

# Loggans geometri (viewBox 0 0 100 100): ring r=44 med linjebredd 10; "tid" x=50 y=61.5, mitten, 32 px, -0.5 spärrning.
RING = '<circle cx="50" cy="50" r="44" fill="none" stroke="{color}" stroke-width="10"/>'
TEXT, FONT_SIZE, LETTER_SPACING, BASELINE = "tid", 32.0, -0.5, 61.5
# Liten variant (favicons, högst 24 px): bara ringen, lite tjockare, och en punkt i mitten som en kontrollpunkt.
SMALL_RING = '<circle cx="50" cy="50" r="41" fill="none" stroke="{color}" stroke-width="14"/>'
SMALL_DOT = '<circle cx="50" cy="50" r="10" fill="{color}"/>'


def outline_text() -> str:
    """"tid" som en enda SVG-bana. Poppins har ingen kerning mellan t-i och i-d; spärrningen läggs efter varje tecken
    (som Chromium gör med letter-spacing) och hela bredden centreras kring x=50 som text-anchor="middle"."""
    font = TTFont(FONT)
    scale = FONT_SIZE / font["head"].unitsPerEm
    cmap, glyphs, metrics = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    names = [cmap[ord(char)] for char in TEXT]
    width = sum(metrics[name][0] * scale + LETTER_SPACING for name in names)
    x = 50 - width / 2
    pen = SVGPathPen(glyphs, ntos=lambda value: f"{value:.2f}".rstrip("0").rstrip("."))
    for name in names:
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, BASELINE)))
        x += metrics[name][0] * scale + LETTER_SPACING
    return pen.getCommands()


def full_svg(path: str, color: str, size: int, background: str | None = None, padding: float = 0) -> str:
    """Hela loggan i en kvadrat på `size` px. `padding` är marginalen i loggans enheter (0–50) runt ringens ytterkant."""
    extent = 100 + 2 * padding
    origin = -padding
    back = f'<rect x="{origin}" y="{origin}" width="{extent}" height="{extent}" fill="{background}"/>' if background else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{origin} {origin} {extent} {extent}">'
            f'{back}{RING.format(color=color)}<path fill="{color}" d="{path}"/></svg>')


def small_svg(color: str, size: int) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 100 100">'
            f'{SMALL_RING.format(color=color)}{SMALL_DOT.format(color=color)}</svg>')


def rasterize(svg: str) -> Image.Image:
    png = subprocess.run(["rsvg-convert", "--format=png"], input=svg.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main() -> None:
    path = outline_text()
    glyphs_ts = WEB / "src" / "components" / "brand" / "logo-glyphs.ts"
    glyphs_ts.parent.mkdir(parents=True, exist_ok=True)
    glyphs_ts.write_text(
        "// Skrivs av scripts/logo/generate.py: \"tid\" i Poppins Bold (SIL OFL) som kontur i loggans viewBox 0 0 100 100.\n"
        f"export const LOGO_TEXT_PATH = \"{path}\";\n", encoding="utf-8")

    # Webbläsarens flik: liten variant, mörkt läge i SVG:n själv (fliklisten är mörk i mörkt läge).
    icon_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        f'<style>circle{{stroke:{LIGHT}}}.dot{{fill:{LIGHT};stroke:none}}'
        f'@media (prefers-color-scheme: dark){{circle{{stroke:{DARK}}}.dot{{fill:{DARK}}}}}</style>'
        '<circle cx="50" cy="50" r="41" fill="none" stroke-width="14"/><circle class="dot" cx="50" cy="50" r="10"/></svg>\n')
    (WEB / "src" / "app" / "icon.svg").write_text(icon_svg, encoding="utf-8")

    ico = [rasterize(small_svg(LIGHT, size)) for size in (16, 32)]
    ico[1].save(WEB / "src" / "app" / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)], append_images=[ico[0]])

    # Hemskärmen på iOS: vit bakgrund (iOS rundar hörnen själv) och marginal runt ringen.
    rasterize(full_svg(path, LIGHT, 180, background="#FFFFFF", padding=14)).save(WEB / "src" / "app" / "apple-icon.png", optimize=True)

    icons = WEB / "public" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        rasterize(full_svg(path, LIGHT, size, padding=2)).save(icons / f"icon-{size}.png", optimize=True)
    # Maskerbar: plattformen skär ut en form ur ytan; det säkra området är en cirkel med 40 % radie (80 % diameter).
    # Ringens ytterkant (radie 49) läggs på 32 % av sidan, väl inom den.
    rasterize(full_svg(path, LIGHT, 512, background="#FFFFFF", padding=27)).save(icons / "icon-maskable-512.png", optimize=True)
    print(path)


if __name__ == "__main__":
    main()
