/** ADR-0223: kartans nordriktning mot dagens magnetiska nord (World Magnetic Model). */
const degrees = (value: number) => `${value.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`;

export const mapProjectNorthSv = {
  heading: "Magnetisk nord",
  map: (value: number) => `Kartans nordlinjer är ritade för missvisningen ${degrees(value)}.`,
  lines: (value: number, lines: number) => `Nordlinjerna i kartan lutar ${degrees(lines)} mot kartans kant och är ritade för missvisningen ${degrees(value)}.`,
  noAngle: (value: number) => `Kartfilen anger ingen vinkel för nordlinjerna (0°), så de antas peka mot koordinatnätets norr (missvisningen ${degrees(value)} här). Är kartan ritad mot magnetisk nord stämmer jämförelsen nedan inte; kontrollera georeferensen i OCAD eller Mapper.`,
  today: (value: number, date: string) => `Missvisningen ${date} enligt World Magnetic Model: ${degrees(value)}.`,
  difference: (value: number) => Math.abs(value) < 0.5 ? "Kartan pekar mot dagens magnetiska nord (skillnad under en halv grad)."
    : `Skillnad ${degrees(Math.abs(value))} ${value > 0 ? "åt öster" : "åt väster"}: med kompassen pekar kartans nordlinjer så mycket fel.`,
  invalid: "Datumet ligger utanför World Magnetic Model 2025 (2025–2030); värdet är osäkrare.",
  noGeoreference: "Kartan har inget känt koordinatsystem, så missvisningen kan inte räknas.",
  later: "Att rikta om kartan (vrida alla objekt mot dagens magnetiska nord) är planerat men inte byggt än.",
  draw: {
    heading: "Rita nordlinjer",
    direction: "Riktning",
    asMap: (value: number) => `Som kartan är ritad (missvisning ${degrees(value)})`,
    today: (value: number) => `Dagens magnetiska nord (${degrees(value)})`,
    spacing: (meters: number, mm: number) => `Avstånd mellan linjerna: ${meters} m (${mm.toLocaleString("sv-SE")} mm på kartan)`,
    run: "Visa som kandidater",
    name: "Nordlinjer",
    done: (count: number, code: string) => `${count} nordlinjer (${code}) visas som kandidater över hela kartan. Lägg in dem i raden under kartan.`,
    existing: "Kartan har redan nordlinjer; de nya läggs ovanpå. Ta bort de gamla först om de ska bytas.",
    noSymbol: "Kartan har ingen linjesymbol för nordlinjer (601).",
    noArea: "Kartan har ingen utbredning än."
  }
};
