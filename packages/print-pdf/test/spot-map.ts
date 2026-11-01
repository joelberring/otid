/**
 * En liten Mapper-karta med dekorfärger som i en riktig klubbkarta (Högdalen 2026 har samma upplägg): svart på
 * processplåten ("Process Black") med övertryck, grön och blå dekorfärg, grön 50 % + svart 50 % (två plåtar), "Vit för
 * grön" som slår ut och en processfärg utan dekorfärg. Mapper räknar y nedåt i 1/1000 mm.
 */
export const SPOT_OMAP = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><projected_crs id="Local"/></georeferencing>
<colors count="7">
<color priority="0" name="Svart 100%" c="0" m="0" y="0" k="1" opacity="1"><spotcolors><namedcolor>Process Black</namedcolor></spotcolors><cmyk method="custom"/></color>
<color priority="1" name="Blå 100%" c="0.87" m="0.185" y="0" k="0" opacity="1"><spotcolors knockout="true"><namedcolor>PMS299_Blue</namedcolor></spotcolors><cmyk method="custom"/></color>
<color priority="2" name="Vit för grön" c="0" m="0" y="0" k="0" opacity="1"><spotcolors knockout="true"><component factor="0" spotcolor="5"/></spotcolors><cmyk method="spotcolor"/></color>
<color priority="3" name="Grön 100% + 50% Svart" c="0.76" m="0" y="0.91" k="0.5" opacity="1"><spotcolors><component factor="1" spotcolor="5"/><component factor="0.5" spotcolor="0"/></spotcolors><cmyk method="spotcolor"/></color>
<color priority="4" name="Grön 50%" c="0.38" m="0" y="0.455" k="0" opacity="1"><spotcolors knockout="true"><component factor="0.5" spotcolor="5"/></spotcolors><cmyk method="spotcolor"/></color>
<color priority="5" name="PMS361_Green" c="0.76" m="0" y="0.91" k="0" opacity="1"><spotcolors knockout="true"><namedcolor>PMS361_Green</namedcolor></spotcolors><cmyk method="custom"/></color>
<color priority="6" name="Gul" c="0" m="0.27" y="0.79" k="0" opacity="1"><cmyk method="custom"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="6" id="test">
<symbol type="4" id="0" code="403.0" name="Gul yta"><area_symbol inner_color="6" patterns="0"/></symbol>
<symbol type="4" id="1" code="406.0" name="Grön yta"><area_symbol inner_color="4" patterns="0"/></symbol>
<symbol type="4" id="2" code="410.0" name="Mörkgrön"><area_symbol inner_color="3" patterns="0"/></symbol>
<symbol type="4" id="3" code="301.0" name="Sjö"><area_symbol inner_color="1" patterns="0"/></symbol>
<symbol type="2" id="4" code="505.0" name="Stig"><line_symbol color="0" line_width="350" join_style="2" cap_style="0"/></symbol>
<symbol type="4" id="5" code="401.1" name="Vit för grön"><area_symbol inner_color="2" patterns="0"/></symbol>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="6">
<object type="1" symbol="0"><coords count="5">-20000 20000;130000 20000;130000 -110000;-20000 -110000;-20000 20000 18;</coords></object>
<object type="1" symbol="1"><coords count="5">0 0;60000 0;60000 -60000;0 -60000;0 0 18;</coords></object>
<object type="1" symbol="2"><coords count="5">10000 -10000;40000 -10000;40000 -40000;10000 -40000;10000 -10000 18;</coords></object>
<object type="1" symbol="5"><coords count="5">20000 -20000;30000 -20000;30000 -30000;20000 -30000;20000 -20000 18;</coords></object>
<object type="1" symbol="3"><coords count="5">70000 -50000;100000 -50000;100000 -80000;70000 -80000;70000 -50000 18;</coords></object>
<object type="1" symbol="4"><coords count="3">0 -90000;50000 -45000;110000 0;</coords></object>
</objects></part></parts>
</barrier>
</map>
`;
