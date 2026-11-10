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
  later: "Att rikta om kartan (vrida objekten och rita nya nordlinjer) är planerat men inte byggt än."
};
