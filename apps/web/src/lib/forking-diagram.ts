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
export interface DiagramLabel extends DiagramPoint {
  readonly key: string;
  readonly text: string;
  readonly kind: "LETTER" | "NOTE" | "ORDER";
  readonly active: boolean | null;
  readonly target?: DiagramTarget;
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
  const labels: DiagramLabel[] = [];
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
        const y = (branchIndex - (count - 1) / 2) * lane * (count > 2 ? 1.1 : 1.5);
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
        if (letter) labels.push({ key: `l${index}.${branchIndex}`, kind: "LETTER", text: letter, x: first.x - radius * 2.2,
          y: y + (y < 0 ? -radius * 0.6 : radius * 1.3), active: chosen, target: branchTarget });
        // Upplysningen ovanför den övre grenen och under de andra, så att den inte hamnar på linjerna.
        const note = compact ? undefined : options.note?.(index, branchIndex);
        if (note) labels.push({ key: `n${index}.${branchIndex}`, kind: "NOTE", text: note, x: first.x - radius,
          y: y < 0 ? y - radius - 6 : y + radius + 13, active: chosen });
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
      const outward = { x: tip.x + (compact ? 3 : radius + 6), y: tip.y + (angle < 0 ? -2 : 6) };
      if (letter) labels.push({ key: `l${index}.${loopIndex}`, kind: "LETTER", text: letter, ...outward, active: on(true), target: branchTarget });
      const position = order?.indexOf(loopIndex) ?? -1;
      if (position >= 0) labels.push({ key: `o${index}.${loopIndex}`, kind: "ORDER", text: String(position + 1),
        x: outward.x + (compact ? 6 : 16), y: outward.y, active: true });
      const note = compact ? undefined : options.note?.(index, loopIndex);
      if (note) labels.push({ key: `n${index}.${loopIndex}`, kind: "NOTE", text: note, x: outward.x, y: outward.y + 14, active: on(true) });
    });
    pending = [{ point: center, active: on(true), key, base: true }];
    cursor = Math.max(center.x, reach - dx * 0.4);
  });
  const finish = { x: cursor + dx, y: 0 };
  connect(finish, "F", from => from.active, from => from.base ? { kind: "LEG", before: items.length } : undefined);
  nodes.push({ key: "F", kind: "FINISH", label: "Mål", ...finish, active: on(true) });

  const xs = [...nodes.map(node => node.x), ...labels.map(label => label.x + (label.kind === "NOTE" ? label.text.length * 6 : 10))];
  const ys = [...nodes.map(node => node.y), ...labels.map(label => label.y), ...edges.flatMap(edge => edge.path?.map(point => point.y) ?? [])];
  const minX = Math.min(...xs) - radius - margin * 0.5, maxX = Math.max(...xs) + radius + margin * 0.5;
  const minY = Math.min(...ys) - radius - margin * 0.6, maxY = Math.max(...ys) + radius + margin * 0.6;
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
    labels: labels.map(label => ({ ...label, ...shift(label) }))
  };
}
