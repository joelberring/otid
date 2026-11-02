/**
 * En liten skogskarta för BL-profilen (Mapper, y nedåt i 1/1000 mm): gul yta överallt, blå 50 % sjö, en brun höjdkurva och
 * en svart stig genom kontrollen i (50, 50) och en blå bäck. Färgerna har inte BL:s CMYK, så att förslaget ändrar dem.
 * Ordningen (priority 0 överst) som i en vanlig OCAD-karta: brunt, svart och blå linje över, blå 50 % och gult under.
 */
export const BL_OMAP = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><projected_crs id="Local"/></georeferencing>
<colors count="5">
<color priority="0" name="Brun 100%" c="0.2" m="0.7" y="1" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="1" name="Svart" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/></color>
<color priority="2" name="Blå 100%" c="0.95" m="0.3" y="0" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="3" name="Blå 50%" c="0.475" m="0.195" y="0" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="4" name="Gul 100%" c="0" m="0.25" y="0.95" k="0" opacity="1"><cmyk method="custom"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="5" id="bl">
<symbol type="4" id="0" code="401.0" name="Öppen mark"><area_symbol inner_color="4" patterns="0"/></symbol>
<symbol type="4" id="1" code="302.0" name="Sjö"><area_symbol inner_color="3" patterns="0"/></symbol>
<symbol type="2" id="2" code="101.0" name="Höjdkurva"><line_symbol color="0" line_width="600" join_style="2" cap_style="0"/></symbol>
<symbol type="2" id="3" code="505.0" name="Stig"><line_symbol color="1" line_width="350" join_style="2" cap_style="0"/></symbol>
<symbol type="2" id="4" code="304.0" name="Bäck"><line_symbol color="2" line_width="300" join_style="2" cap_style="0"/></symbol>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="5">
<object type="1" symbol="0"><coords count="5">0 0;100000 0;100000 -100000;0 -100000;0 0 18;</coords></object>
<object type="1" symbol="1"><coords count="5">60000 -60000;90000 -60000;90000 -90000;60000 -90000;60000 -60000 18;</coords></object>
<object type="1" symbol="2"><coords count="2">0 -50000;100000 -50000;</coords></object>
<object type="1" symbol="3"><coords count="2">50000 0;50000 -100000;</coords></object>
<object type="1" symbol="4"><coords count="2">0 -10000;100000 -95000;</coords></object>
</objects></part></parts>
</barrier>
</map>
`;
