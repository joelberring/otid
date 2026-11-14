/**
 * Grundkartan ur laserdata (ägaren 2026-11-13: «AI:n lägger in grundkartan»): sammansättningen av laserjobbets filer,
 * OpenStreetMap och hyggena, valen bland kullar och branter, och kandidaterna i kartans mm. Samma kod i webbläsaren
 * (kandidaternas Worker och panelerna) och på servern (kartjobbet BASE_MAP). Egen ingång (`@o-tid/map-revision/base-map`)
 * eftersom den behöver `polygon-clipping`, som resten av paketet klarar sig utan.
 */
export * from "./merge";
export * from "./clear-cuts";
export * from "./small-rings";
export * from "./flat-contours";
export * from "./clear-contours";
export * from "./marking";
export * from "./terrain-fit";
export * from "./ticks";
export * from "./yards";
export * from "./marsh-merge";
export * from "./soil";
export * from "./soil-marsh";
export * from "./water-clip";
export * from "./built-mask";
export * from "./knoll-choice";
export * from "./cliff-choice";
export * from "./rock-choice";
export * from "./candidate-merge";
export * from "./photo-interpret";
export * from "./candidates";
export * from "./assemble";
export * from "./sprint-osm";
export * from "./laser-paved";
export * from "./stages";
export * from "./water-smooth";
