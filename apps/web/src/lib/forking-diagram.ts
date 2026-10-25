import type { ForkingChoice, ForkingItem } from "@o-tid/domain";

/**
 * Schematisk banbild för en gafflad bana (steg 49): från start till mål, vänster till höger. Enkla gafflingar blir
 * parallella grenar som går ihop igen; fjärilar blir kronblad runt den centrala kontrollen. Ren layout utan React, så
 * att samma bild kan användas i banlistan, redigeringen, resultatlistan och stafetten.
 */
export type DiagramTarget =
  | { readonly kind: "CONTROL"; readonly item: number }
  | { readonly kind: "LEG"; readonly before: number }
  | { readonly kind: "BRANCH"; readonly item: number; readonly branch: number };

export type DiagramPoint = { readonly x: number; readonly y: number };
export interface DiagramNode extends DiagramPoint {
  readonly key: string;
  readonly kind: "START" | "FINISH" | "CONTROL" | "CENTER";
  readonly label: string;
  /** null = ingen löpare markerad; annars om löparens variant passerar noden. */
  readonly active: boolean | null;
  readonly target?: DiagramTarget;
}
export interface DiagramEdge {
  readonly key: string;
  readonly d: string;
  readonly active: boolean | null;
  readonly target?: DiagramTarget;
  /** Mitten av sträckan (för en klickbar yta och en etikett). */
  readonly mid: DiagramPoint;
}
/** En etikett: mitten (x, y) och rutans bredd och höjd. Etiketterna placeras så att de inte täcker något. */
export interface DiagramLabel extends DiagramPoint {
  readonly key: string;
  readonly text: string;
  readonly kind: "LETTER" | "NOTE" | "ORDER";
  readonly active: boolean | null;
  readonly target?: DiagramTarget;
  readonly width: number;
  readonly height: number;
}
export interface ForkingDiagramLayout {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly labels: readonly DiagramLabel[];
}

export interface ForkingDiagramOptions {
  readonly compact?: boolean;
  /** Löparens val per gafflingspunkt; markerar vägen. */
  readonly choices?: readonly ForkingChoice[] | undefined;
  /** Bokstäver per gafflingspunkt (domänens `forkingLetters`). */
  readonly letters?: readonly (readonly string[] | null)[];
  /** Kort text per alternativ/slinga, t.ex. antal löpare och avlästa. */
  readonly note?: (item: number, branch: number) => string | undefined;
}

type Pending = { readonly point: DiagramPoint; readonly active: boolean | null; readonly key: string; readonly base: boolean };

const round = (value: number) => Math.round(value * 10) / 10;

type LabelRequest = Omit<DiagramLabel, "x" | "y" | "width" | "height"> & {
  /** Punkten som etiketten hör till och riktningarna att pröva först (enhetsvektorer). */
  readonly anchor: DiagramPoint;
  readonly prefer: readonly (readonly [number, number])[];
};
type Box = { x: number; y: number; w: number; h: number };

/** Etikettens ungefärliga storlek: teckenbredd efter typsnittets storlek, lite tilltaget. */
function labelSize(kind: DiagramLabel["kind"], text: string, compact: boolean): { w: number; h: number } {
  if (compact) return { w: text.length * 4.2 + 1, h: 7 };
  const char = kind === "NOTE" ? 6.1 : 8.2;
  return { w: text.length * char + (kind === "NOTE" ? 8 : 4), h: kind === "NOTE" ? 16 : 16 };
}

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Punkter längs en sträcka (rak, kurva eller kronblad) med högst ett par pixlars mellanrum. */
function samples(edge: { from: DiagramPoint; to: DiagramPoint; path?: DiagramPoint[] }): DiagramPoint[] {
  const result: DiagramPoint[] = [];
  const line = (a: DiagramPoint, b: DiagramPoint) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let step = 0; step <= steps; step += 1) result.push({ x: a.x + ((b.x - a.x) * step) / steps, y: a.y + ((b.y - a.y) * step) / steps });
  };
  if (edge.path) { for (let index = 1; index < edge.path.length; index += 1) line(edge.path[index - 1]!, edge.path[index]!); return result; }
  const { from, to } = edge;
  if (Math.abs(from.y - to.y) < 0.5) { line(from, to); return result; }
  const middle = (from.x + to.x) / 2;
  const steps = Math.max(8, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps, u = 1 - t;
    result.push({ x: u * u * u * from.x + 3 * u * u * t * middle + 3 * u * t * t * middle + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t * t * t * to.y });
  }
  return result;
}

const DIRECTIONS: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [1, 0], [-1, 0], [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7],
  [-0.7, 0.7], [0.92, -0.38], [-0.92, -0.38], [0.92, 0.38], [-0.92, 0.38], [0.38, -0.92], [-0.38, -0.92], [0.38, 0.92], [-0.38, 0.92]];

/**
 * Placerar etiketterna en i taget: närmast sin punkt i de föredragna riktningarna, annars runt om och längre ut, där rutan
 * inte täcker en kontroll, en sträcka eller en redan placerad etikett.
 */
function placeLabels(requests: readonly LabelRequest[], nodes: readonly DiagramPoint[], radius: number,
  lines: readonly DiagramPoint[], compact: boolean): DiagramLabel[] {
  const gap = compact ? 0.6 : 2;
  const nodeBoxes = nodes.map(node => ({ x: node.x - radius - gap, y: node.y - radius - gap, w: 2 * (radius + gap), h: 2 * (radius + gap) }));
  const placed: Box[] = [];
  const free = (box: Box) => !nodeBoxes.some(other => overlaps(box, other, 0)) && !placed.some(other => overlaps(box, other, gap)) &&
    !lines.some(point => point.x > box.x - gap && point.x < box.x + box.w + gap && point.y > box.y - gap && point.y < box.y + box.h + gap);
  return requests.map(request => {
    const { w, h } = labelSize(request.kind, request.text, compact);
    const base = radius + (compact ? 1 : 3);
    const directions = [...request.prefer, ...DIRECTIONS.filter(direction => !request.prefer.some(known => known[0] === direction[0] && known[1] === direction[1]))];
    let chosen: Box | undefined;
    for (let ring = 0; ring < 14 && !chosen; ring += 1) {
      const distance = base + ring * (compact ? 2 : 6);
      for (const [vx, vy] of directions) {
        // Rutans mitt så långt ut att rutans kant ligger på avståndet i riktningen.
        const reach = distance + Math.abs(vx) * w / 2 + Math.abs(vy) * h / 2;
        const box = { x: request.anchor.x + vx * reach - w / 2, y: request.anchor.y + vy * reach - h / 2, w, h };
        if (free(box)) { chosen = box; break; }
      }
    }
    const box = chosen ?? { x: request.anchor.x - w / 2, y: request.anchor.y - base - h * 2, w, h };
    placed.push(box);
    return { key: request.key, text: request.text, kind: request.kind, active: request.active,
      ...(request.target ? { target: request.target } : {}), x: box.x + w / 2, y: box.y + h / 2, width: w, height: h };
  });
}

function curve(from: DiagramPoint, to: DiagramPoint): string {
  if (Math.abs(from.y - to.y) < 0.5) return `M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}`;
  const middle = (from.x + to.x) / 2;
  return `M${round(from.x)} ${round(from.y)}C${round(middle)} ${round(from.y)} ${round(middle)} ${round(to.y)} ${round(to.x)} ${round(to.y)}`;
}

/** Kronbladens vinklar: ovanför och under linjen, aldrig längs den (där går banan vidare). */
function petalAngles(count: number): number[] {
  const above = Math.ceil(count / 2), below = count - above;
  const spread = (n: number) => n === 1 ? [42] : Array.from({ length: n }, (_v, index) => 28 + (index * 44) / (n - 1));
  const up = spread(above).map(angle => -angle), down = below === 0 ? [] : spread(below);
  return Array.from({ length: count }, (_v, index) => index % 2 === 0 ? up[index / 2]! : down[(index - 1) / 2]!);
}

export function layoutForkingDiagram(items: readonly ForkingItem[], options: ForkingDiagramOptions = {}): ForkingDiagramLayout {
  const compact = options.compact ?? false;
  const dx = compact ? 12 : 48, lane = compact ? 9 : 40, radius = compact ? 2.6 : 14, margin = compact ? 6 : 30;
  const marked = options.choices !== undefined;
  const nodes: (Omit<DiagramNode, "x" | "y"> & DiagramPoint)[] = [];
  const edges: { key: string; from: DiagramPoint; to: DiagramPoint; active: boolean | null; target?: DiagramTarget; path?: DiagramPoint[] }[] = [];
  const labels: LabelRequest[] = [];
  const on = (value: boolean) => marked ? value : null;
  let cursor = 0;
  nodes.push({ key: "S", kind: "START", label: "Start", x: 0, y: 0, active: on(true) });
  let pending: Pending[] = [{ point: { x: 0, y: 0 }, active: on(true), key: "S", base: true }];
  const connect = (to: DiagramPoint, toKey: string, active: (from: Pending) => boolean | null, target?: (from: Pending) => DiagramTarget | undefined) => {
    for (const from of pending) {
      const edgeTarget = target?.(from);
      edges.push({ key: `${from.key}>${toKey}`, from: from.point, to, active: active(from), ...(edgeTarget ? { target: edgeTarget } : {}) });
    }
  };
  items.forEach((item, index) => {
    const choice = options.choices?.[index];
    if (item.kind === "CONTROL") {
      const point = { x: cursor + dx, y: 0 };
      const key = `c${index}`;
      connect(point, key, from => from.active === null ? null : from.active, from => from.base ? { kind: "LEG", before: index } : undefined);
      nodes.push({ key, kind: "CONTROL", label: String(item.code), ...point, active: on(true), target: { kind: "CONTROL", item: index } });
      pending = [{ point, active: on(true), key, base: true }];
      cursor = point.x;
      return;
    }
    if (item.kind === "FORK") {
      const count = item.branches.length;
      const longest = Math.max(1, ...item.branches.map(branch => branch.length));
      const ends: Pending[] = [];
      item.branches.forEach((branch, branchIndex) => {
        // Med upplysningar per gren behövs plats mellan grenarna.
        const spacing = !compact && options.note ? 1.6 : count > 2 ? 1.1 : 1.5;
        const y = (branchIndex - (count - 1) / 2) * lane * spacing;
        const chosen = on(choice === branchIndex);
        let previous = pending;
        const branchTarget: DiagramTarget = { kind: "BRANCH", item: index, branch: branchIndex };
        // Grenens kontroller fördelas över gaffelns bredd så att grenarna går ihop på samma ställe.
        const step = (longest * dx) / (branch.length + (branch.length === longest ? 0 : 1));
        branch.forEach((code, position) => {
          const point = { x: cursor + step * (position + 1), y };
          const key = `f${index}.${branchIndex}.${position}`;
          for (const from of previous) {
            edges.push({ key: `${from.key}>${key}`, from: from.point, to: point,
              active: marked ? (from.active ?? false) && chosen === true : null, target: branchTarget });
          }
          nodes.push({ key, kind: "CONTROL", label: String(code), ...point, active: chosen, target: branchTarget });
          previous = [{ point, active: chosen, key, base: false }];
        });
        if (branch.length === 0) ends.push(...pending.map(from => ({ ...from, key: `${from.key}~${branchIndex}`, active: marked ? (from.active ?? false) && chosen === true : null, base: false })));
        else ends.push(...previous);
        const letter = options.letters?.[index]?.[branchIndex];
        const first = { x: cursor + step, y };
        const outward: readonly [number, number] = y < 0 ? [0, -1] : [0, 1];
        if (letter) labels.push({ key: `l${index}.${branchIndex}`, kind: "LETTER", text: letter, anchor: first,
          prefer: [[-0.7, y < 0 ? -0.7 : 0.7], [-1, 0], [0.7, y < 0 ? -0.7 : 0.7]], active: chosen, target: branchTarget });
        // Upplysningen vid grenens mitt, utåt från gaffeln.
        const note = compact ? undefined : options.note?.(index, branchIndex);
        // De yttre grenarna får upplysningen utåt, de mellersta efter grenens sista kontroll.
        const outer = branchIndex === 0 || branchIndex === count - 1;
        const last = { x: cursor + step * Math.max(1, branch.length), y };
        if (note) labels.push({ key: `n${index}.${branchIndex}`, kind: "NOTE", text: note, anchor: outer ? first : last,
          prefer: outer ? [outward, [0.38, outward[1] * 0.92]] : [[1, 0], [0.92, -0.38], [0.92, 0.38]], active: chosen });
      });
      pending = ends;
      // Lite längre till nästa kontroll så att grenarna syns gå ihop.
      cursor += longest * dx + dx * 0.6;
      return;
    }
    // Fjäril: den centrala kontrollen och ett kronblad per slinga.
    const center = { x: cursor + dx, y: 0 };
    const key = `c${index}`;
    connect(center, key, from => from.active, from => from.base ? { kind: "LEG", before: index } : undefined);
    nodes.push({ key, kind: "CENTER", label: String(item.center), ...center, active: on(true), target: { kind: "CONTROL", item: index } });
    const angles = petalAngles(item.loops.length);
    let reach = center.x;
    const order = Array.isArray(choice) ? choice as readonly number[] : undefined;
    item.loops.forEach((loop, loopIndex) => {
      const n = loop.length;
      const rx = Math.max(dx * 1.1, (compact ? 3.2 : 13) * (n + 1));
      const ry = rx * 0.42;
      const angle = (angles[loopIndex]! * Math.PI) / 180;
      const place = (theta: number) => {
        const px = rx + rx * Math.cos(theta), py = ry * Math.sin(theta);
        return { x: center.x + px * Math.cos(angle) - py * Math.sin(angle), y: px * Math.sin(angle) + py * Math.cos(angle) };
      };
      // Varvet går från den centrala kontrollen (vinkel π) runt ellipsen och tillbaka.
      const direction = angle < 0 ? 1 : -1;
      const points = loop.map((_code, position) => place(Math.PI + direction * ((position + 1) * 2 * Math.PI) / (n + 1)));
      const branchTarget: DiagramTarget = { kind: "BRANCH", item: index, branch: loopIndex };
      const chain = [center, ...points, center];
      for (let position = 1; position < chain.length; position += 1) {
        const segment = Array.from({ length: 7 }, (_v, step) => place(Math.PI + direction * (((position - 1) + step / 6) * 2 * Math.PI) / (n + 1)));
        edges.push({ key: `p${index}.${loopIndex}.${position}`, from: chain[position - 1]!, to: chain[position]!, active: on(true), target: branchTarget, path: segment });
      }
      loop.forEach((code, position) => nodes.push({ key: `p${index}.${loopIndex}.${position}`, kind: "CONTROL", label: String(code),
        ...points[position]!, active: on(true), target: branchTarget }));
      const tip = place(0);
      reach = Math.max(reach, tip.x, ...points.map(point => point.x));
      const letter = options.letters?.[index]?.[loopIndex];
      // Utåt från kronbladets spets, längs bladets riktning.
      const out: readonly [number, number] = [Math.cos(angle), Math.sin(angle)];
      const side: readonly [number, number] = [0, angle < 0 ? -1 : 1];
      if (letter) labels.push({ key: `l${index}.${loopIndex}`, kind: "LETTER", text: letter, anchor: tip, prefer: [out, side], active: on(true),
        target: branchTarget });
      const position = order?.indexOf(loopIndex) ?? -1;
      if (position >= 0) labels.push({ key: `o${index}.${loopIndex}`, kind: "ORDER", text: String(position + 1), anchor: tip,
        prefer: [out, side, [1, 0]], active: true });
      const note = compact ? undefined : options.note?.(index, loopIndex);
      if (note) labels.push({ key: `n${index}.${loopIndex}`, kind: "NOTE", text: note, anchor: tip, prefer: [side, out], active: on(true) });
    });
    // Banan går vidare rakt ut förbi kronbladen innan den grenar sig, så att en gaffling efter fjärilen inte korsar bladen.
    const junction = { x: Math.max(center.x + dx * 0.5, reach + dx * (compact ? 0.1 : 0.3)), y: 0 };
    edges.push({ key: `${key}>j${index}`, from: center, to: junction, active: on(true) });
    pending = [{ point: junction, active: on(true), key: `j${index}`, base: true }];
    cursor = junction.x - dx * (compact ? 0.5 : 0.15);
  });
  const finish = { x: cursor + dx, y: 0 };
  connect(finish, "F", from => from.active, from => from.base ? { kind: "LEG", before: items.length } : undefined);
  nodes.push({ key: "F", kind: "FINISH", label: "Mål", ...finish, active: on(true) });

  const placed = placeLabels(labels, nodes, radius, edges.flatMap(samples), compact);
  const xs = [...nodes.flatMap(node => [node.x - radius, node.x + radius]), ...placed.flatMap(label => [label.x - label.width / 2, label.x + label.width / 2])];
  const ys = [...nodes.flatMap(node => [node.y - radius, node.y + radius]), ...placed.flatMap(label => [label.y - label.height / 2, label.y + label.height / 2]),
    ...edges.flatMap(edge => edge.path?.map(point => point.y) ?? [])];
  const minX = Math.min(...xs) - margin * 0.3, maxX = Math.max(...xs) + margin * 0.3;
  const minY = Math.min(...ys) - margin * 0.3, maxY = Math.max(...ys) + margin * 0.3;
  const shift = (point: DiagramPoint) => ({ x: point.x - minX, y: point.y - minY });
  const pathOf = (edge: (typeof edges)[number]) => edge.path
    ? edge.path.map(shift).map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`).join("")
    : curve(shift(edge.from), shift(edge.to));
  return {
    width: round(maxX - minX), height: round(maxY - minY), radius,
    nodes: nodes.map(node => ({ ...node, ...shift(node) })),
    edges: edges.map(edge => {
      const mid = edge.path ? shift(edge.path[3]!) : shift({ x: (edge.from.x + edge.to.x) / 2, y: (edge.from.y + edge.to.y) / 2 });
      return { key: edge.key, d: pathOf(edge), active: edge.active, mid, ...(edge.target ? { target: edge.target } : {}) };
    }),
    labels: placed.map(label => ({ ...label, ...shift(label) }))
  };
}
