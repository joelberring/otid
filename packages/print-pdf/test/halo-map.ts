/**
 * ADR-0211 beslut 3 (tillägget 2026-11-04 kväll): en påhittad skogskarta (Mapper, y nedåt i 1/1000 mm, 1:10 000) med
 * färgerna i samma ordning som ägarens OCAD-karta till Stockholm by Night. Ingen riktig karta.
 *
 * - Framträdande träd (417): en vit gloria ("Vit över grön") med en grön ring ovanpå ("Grön 100% – Punktobjekt"), vitt
 *   direkt under grönt i färgordningen och båda över svart.
 * - Järnväg (509): en vit linje ("Vit för järnväg") under svarta streck i vägkanternas svart.
 * - Förbjudet område (709) nere till vänster: "Vit för röd" direkt under "Röd", överst i färgordningen (äkta övre vitt).
 * - Höjdkurvor (brunt 100 %) var 0,8 mm runt kontrollen i (50, 50), en svart stig, odlad mark (gult med svarta prickar,
 *   "Svart för odlad mark" långt ned) och grönt 30 %.
 *
 * Priority 0 är överst. Med den gamla regeln lyftes allt vitt över den lägsta färgen över banan (svart för odlad mark)
 * över banan, medan grönt för punkter och vägkanternas svart ligger under: skivan täckte ringen och vitt låg över
 * järnvägens svarta streck.
 */
const contours = Array.from({ length: 31 }, (_, index) => 38000 + index * 800)
  .map(y => `<object type="1" symbol="3"><coords count="2">0 -${y};100000 -${y};</coords></object>`);

/** Träden (mm i kartan, y uppåt): mitt på sträckan 1–mål och i skogen till höger. */
export const HALO_TREES = [{ x: 65, y: 35 }, { x: 70, y: 70 }, { x: 74, y: 76 }];
/** Det förbjudna området (vitt under rött), mm i kartan (y uppåt). */
export const HALO_FORBIDDEN = { minX: 5, maxX: 15, minY: 5, maxY: 12 };
/** Järnvägen: från (5, 80) till (45, 80) i kartan (y uppåt). */
export const HALO_RAILWAY = { from: { x: 5, y: 80 }, to: { x: 45, y: 80 } };
/** Glorians radie och ringens inre och yttre radie (mm). */
export const HALO_RADIUS = 0.9;
export const RING = { inner: 0.4, outer: 0.65 };

export const HALO_OMAP = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><projected_crs id="Local"/></georeferencing>
<colors count="11">
<color priority="0" name="Röd" c="0" m="1" y="0" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="1" name="Vit för röd" c="0" m="0" y="0" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="2" name="Grön 100% – Punktobjekt" c="0.76" m="0" y="0.91" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="3" name="Vit över grön" c="0" m="0" y="0" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="4" name="Svart 100%" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/></color>
<color priority="5" name="Brun 100%" c="0" m="0.56" y="1" k="0.18" opacity="1"><cmyk method="custom"/></color>
<color priority="6" name="Svart 100% vägkant och järnväg" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/></color>
<color priority="7" name="Vit för järnväg" c="0" m="0" y="0" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="8" name="Grön 30%" c="0.23" m="0" y="0.27" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="9" name="Svart för odlad mark" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/></color>
<color priority="10" name="Gul 100%" c="0" m="0.27" y="0.79" k="0" opacity="1"><cmyk method="custom"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="8" id="halo">
<symbol type="4" id="0" code="401.0" name="Öppen mark"><area_symbol inner_color="10" patterns="0"/></symbol>
<symbol type="4" id="1" code="412.0" name="Odlad mark"><area_symbol inner_color="10" patterns="1"><pattern type="2" angle="0" line_spacing="1500" point_distance="1500"><symbol type="1"><point_symbol inner_radius="150" inner_color="9" elements="0"/></symbol></pattern></area_symbol></symbol>
<symbol type="4" id="2" code="406.0" name="Skog, långsam löpning"><area_symbol inner_color="8" patterns="0"/></symbol>
<symbol type="2" id="3" code="101.0" name="Höjdkurva"><line_symbol color="5" line_width="140" join_style="2" cap_style="0"/></symbol>
<symbol type="2" id="4" code="505.0" name="Stig"><line_symbol color="4" line_width="350" join_style="2" cap_style="0"/></symbol>
<symbol type="16" id="5" code="509.0" name="Järnväg"><combined_symbol parts="2"><part private="true"><symbol type="2" code="509.0" name="Järnväg vit"><line_symbol color="7" line_width="700" join_style="2" cap_style="0"/></symbol></part><part private="true"><symbol type="2" code="509.0" name="Järnväg svart"><line_symbol color="6" line_width="400" join_style="2" cap_style="0" dashed="true" dash_length="1500" break_length="500"/></symbol></part></combined_symbol></symbol>
<symbol type="1" id="6" code="417.0" name="Framträdande träd"><point_symbol inner_radius="900" inner_color="3" outer_width="0" outer_color="-1" elements="1"><element><symbol type="1" code=""><point_symbol inner_radius="400" inner_color="-1" outer_width="250" outer_color="2" elements="0"/></symbol><object type="0"><coords count="1">0 0;</coords></object></element></point_symbol></symbol>
<symbol type="4" id="7" code="709.0" name="Förbjudet område"><area_symbol inner_color="1" patterns="1"><pattern type="1" angle="0.7854" line_spacing="1000" color="0" line_width="250"/></area_symbol></symbol>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="${9 + contours.length}">
<object type="1" symbol="0"><coords count="5">0 0;100000 0;100000 -100000;0 -100000;0 0 18;</coords></object>
<object type="1" symbol="1"><coords count="5">0 -88000;40000 -88000;40000 -100000;0 -100000;0 -88000 18;</coords></object>
<object type="1" symbol="2"><coords count="5">60000 -60000;100000 -60000;100000 -100000;60000 -100000;60000 -60000 18;</coords></object>
${contours.join("\n")}
<object type="1" symbol="4"><coords count="2">30000 0;30000 -100000;</coords></object>
<object type="1" symbol="5"><coords count="2">${HALO_RAILWAY.from.x * 1000} -${HALO_RAILWAY.from.y * 1000};${HALO_RAILWAY.to.x * 1000} -${HALO_RAILWAY.to.y * 1000};</coords></object>
${HALO_TREES.map(tree => `<object type="0" symbol="6" rotation="0"><coords count="1">${tree.x * 1000} -${tree.y * 1000};</coords></object>`).join("\n")}
<object type="1" symbol="7"><coords count="5">5000 -5000;15000 -5000;15000 -12000;5000 -12000;5000 -5000 18;</coords></object>
</objects></part></parts>
</barrier>
</map>
`;
