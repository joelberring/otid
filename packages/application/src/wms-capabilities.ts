/**
 * GetCapabilities (WMS 1.3.0 och 1.1.1) tolkad med en liten egen XML-läsare. Namnrymdsprefix (`<wms:Layer>`) tas bort och
 * entiteter utom de fem vanliga och teckenkoder lämnas som de är; det räcker för lagernamn och titlar. Inget laddas från
 * nätet och ingen DTD följs.
 */
interface XmlNode { readonly name: string; readonly attributes: Record<string, string>; readonly children: XmlNode[]; text: string }

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gi;
const ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const localName = (name: string) => name.slice(name.lastIndexOf(":") + 1);
function decode(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "amp") return "&";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : Number(lower.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function parseXml(xml: string): XmlNode | undefined {
  const root: XmlNode = { name: "", attributes: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  for (const match of xml.matchAll(TOKEN)) {
    const top = stack[stack.length - 1]!;
    const [, cdata, closing, opening, attributes, selfClosing, text] = match;
    if (cdata !== undefined) top.text += cdata;
    else if (text !== undefined) top.text += decode(text);
    else if (closing !== undefined) { if (stack.length > 1) stack.pop(); }
    else if (opening !== undefined) {
      const node: XmlNode = { name: localName(opening), attributes: {}, children: [], text: "" };
      for (const attribute of (attributes ?? "").matchAll(ATTRIBUTE)) node.attributes[localName(attribute[1]!).toLowerCase()] = decode(attribute[2] ?? attribute[3] ?? "");
      top.children.push(node);
      if (selfClosing !== "/") stack.push(node);
      if (stack.length > 200) return undefined;
    }
  }
  return root.children[0];
}

const child = (node: XmlNode | undefined, name: string) => node?.children.find(row => row.name === name);
const childText = (node: XmlNode | undefined, name: string) => child(node, name)?.text.trim() ?? "";

/** EPSG-koden ur `EPSG:3006`, `epsg:3006`, `urn:ogc:def:crs:EPSG::3006` och `http://www.opengis.net/def/crs/EPSG/0/3006`. */
export function epsgOf(text: string): number | undefined {
  const code = /epsg[:/]+(?:[\d.]+[:/]+)*(\d+)\s*$/i.exec(text.trim())?.[1];
  return code ? Number(code) : undefined;
}

export interface WmsLayerInfo { readonly name: string; readonly title: string; readonly epsgCodes: ReadonlySet<number> }
export interface WmsCapabilities {
  readonly title: string;
  readonly version: "1.3.0" | "1.1.1";
  readonly formats: readonly string[];
  readonly layers: readonly WmsLayerInfo[];
  /** Tjänstens högsta bildstorlek om den anger någon (MaxWidth, MaxHeight). */
  readonly maxSide: number | undefined;
}

const MAX_LAYERS = 1000;

/** Tolkar svaret, eller undefined när det inte är ett GetCapabilities-svar (t.ex. ett ServiceException eller en HTML-sida). */
export function parseWmsCapabilities(xml: string): WmsCapabilities | undefined {
  const root = parseXml(xml);
  if (!root || !/^(WMS_Capabilities|WMT_MS_Capabilities)$/.test(root.name)) return undefined;
  const capability = child(root, "Capability");
  if (!capability) return undefined;
  const layers: WmsLayerInfo[] = [];
  // Lagrets CRS/SRS ärvs av underlagren och läggs till (WMS 1.3.0 7.2.4.6.7); lagret utan Name är bara en grupp.
  const walk = (node: XmlNode, inherited: ReadonlySet<number>) => {
    const own = new Set(inherited);
    for (const row of node.children) {
      if (row.name !== "CRS" && row.name !== "SRS") continue;
      for (const part of row.text.split(/\s+/)) { const code = epsgOf(part); if (code !== undefined) own.add(code); }
    }
    const name = childText(node, "Name");
    if (name && layers.length < MAX_LAYERS) layers.push({ name, title: childText(node, "Title") || name, epsgCodes: own });
    for (const row of node.children) if (row.name === "Layer") walk(row, own);
  };
  for (const row of capability.children) if (row.name === "Layer") walk(row, new Set());
  const getMap = child(child(capability, "Request"), "GetMap");
  const formats = (getMap?.children ?? []).filter(row => row.name === "Format").map(row => row.text.trim()).filter(Boolean);
  const service = child(root, "Service");
  const side = Math.min(...["MaxWidth", "MaxHeight"].map(name => Number(childText(service, name))).filter(value => value > 0));
  return { title: childText(service, "Title"), version: root.attributes.version?.startsWith("1.3") ? "1.3.0" : "1.1.1", formats, layers,
    maxSide: Number.isFinite(side) ? side : undefined };
}
