/**
 * Builds a dimensioned, multi-view technical drawing model from shape
 * parameters. Coordinates are millimetres in SVG orientation (y down).
 * The model is rendered both as React elements (viewer) and as an
 * escaped SVG string (export) from the same data.
 */
import { resolveParams, validateParams, type ParamKey, type Params, type ShapeType } from "./shapes";

export type Pt = [number, number];

export type Prim =
  | { kind: "poly"; points: Pt[] }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; style: "center" | "hidden" | "phantom" };

/** Linear dimension between two points; `offset` moves the dimension line along the left normal of p1→p2. */
export interface LinearDim {
  kind: "linear";
  p1: Pt;
  p2: Pt;
  offset: number;
  value: number;
  prefix?: string;
}

export interface AngleDim {
  kind: "angle";
  center: Pt;
  radius: number;
  startDeg: number;
  endDeg: number;
  value: number;
}

export type Dim = LinearDim | AngleDim;

export type ViewId = "front" | "top" | "side";

export interface View {
  id: ViewId;
  prims: Prim[];
  dims: Dim[];
  /** Position of the view's local origin on the sheet (set by layout). */
  origin: Pt;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface Drawing {
  shape: ShapeType;
  views: View[];
  width: number;
  height: number;
  /** Suggested print scale denominator for an A4 landscape sheet (1:n). */
  printScale: number;
  weightKg: number;
  assumed: ParamKey[];
  params: Record<ParamKey, number | null>;
}

export const STEEL_DENSITY_KG_PER_MM3 = 7.85e-6; // 7.85 g/cm³ mild steel
const DIM_GAP = 12; // distance from part to dimension line, mm (scaled with the part)

const rad = (deg: number) => (deg * Math.PI) / 180;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Shoelace area of a simple polygon. */
export function polygonArea(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function arcPoints(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, segments = 32): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = rad(fromDeg + ((toDeg - fromDeg) * i) / segments);
    pts.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]);
  }
  return pts;
}

const rect = (x: number, y: number, w: number, h: number): Prim => ({
  kind: "poly",
  points: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});

const lin = (p1: Pt, p2: Pt, offset: number, value: number, prefix?: string): LinearDim => ({ kind: "linear", p1, p2, offset, value: round1(value), prefix });

function holeMarks(cx: number, cy: number, d: number, g: number): Prim[] {
  const r = d / 2;
  const ext = r + g * 0.25;
  return [
    { kind: "circle", cx, cy, r },
    { kind: "line", x1: cx - ext, y1: cy, x2: cx + ext, y2: cy, style: "center" },
    { kind: "line", x1: cx, y1: cy - ext, x2: cx, y2: cy + ext, style: "center" },
  ];
}

interface Built {
  views: Omit<View, "origin" | "bounds">[];
  /** Front-view area × depth gives the solid volume before holes. */
  frontArea: number;
  depth: number;
  holeVolume: number;
}

function lBracket(v: Record<ParamKey, number | null>, g: number): Built {
  const A = v.legA!;
  const B = v.legB!;
  const W = v.width!;
  const t = v.thickness!;
  const theta = v.angle ?? 90;
  const th = rad(theta);
  // Front (profile) view in maths orientation, then flipped (y → -y).
  const d: Pt = [Math.cos(th), Math.sin(th)];
  const n: Pt = [Math.sin(th), -Math.cos(th)];
  const s = (t * (1 + Math.cos(th))) / Math.sin(th);
  const inner: Pt = [t * n[0] + s * d[0], t];
  const profile: Pt[] = [
    [0, 0],
    [B, 0],
    [B, t],
    inner,
    [A * d[0] + t * n[0], A * d[1] + t * n[1]],
    [A * d[0], A * d[1]],
  ];
  const flip = (p: Pt): Pt => [p[0], -p[1]];
  const front: Pt[] = profile.map(flip);
  const aEnd = flip([A * d[0], A * d[1]]);
  const frontDims: Dim[] = [
    lin([0, 0], [B, 0], -g, B),
    lin([0, 0], aEnd, g, A),
    lin([B, 0], [B, -t], -g * 0.6, t),
    { kind: "angle", center: [0, 0], radius: Math.min(A, B) * 0.35, startDeg: 0, endDeg: theta, value: theta },
  ];

  // Top view: face of leg B (B × W); side view: face of leg A (A × W).
  const hole = v.holeDia;
  const topPrims: Prim[] = [rect(0, 0, B, W), { kind: "line", x1: t, y1: 0, x2: t, y2: W, style: "hidden" }];
  const sidePrims: Prim[] = [rect(0, 0, W, A), { kind: "line", x1: 0, y1: A - t, x2: W, y2: A - t, style: "hidden" }];
  const topDims: Dim[] = [lin([0, W], [0, 0], g, W)];
  const sideDims: Dim[] = [lin([0, A], [0, 0], g, A), lin([0, 0], [W, 0], g, W)];
  let holes = 0;
  if (hole) {
    const hx = t + (B - t) / 2;
    topPrims.push(...holeMarks(hx, W / 2, hole, g));
    sidePrims.push(...holeMarks(W / 2, (A - t) / 2, hole, g));
    topDims.push(lin([hx - hole / 2, W], [hx + hole / 2, W], -g * 0.6, hole, "⌀"));
    holes = 2;
  }
  return {
    views: [
      { id: "front", prims: [{ kind: "poly", points: front }], dims: frontDims },
      { id: "top", prims: topPrims, dims: topDims },
      { id: "side", prims: sidePrims, dims: sideDims },
    ],
    frontArea: polygonArea(front),
    depth: W,
    holeVolume: holes * Math.PI * (hole ?? 0) ** 2 * 0.25 * t,
  };
}

function pipeClamp(v: Record<ParamKey, number | null>, g: number): Built {
  const R = v.pipeDia! / 2;
  const t = v.thickness!;
  const tab = v.tabLength!;
  const Wd = v.strapWidth!;
  const outerEnd = R + t + tab;
  const outer = arcPoints(0, 0, R + t, 0, 180);
  const innerArc = arcPoints(0, 0, R, 180, 0);
  const front: Pt[] = [
    ...outer,
    [-outerEnd, 0],
    [-outerEnd, t],
    [-R, t],
    ...innerArc,
    [R, t],
    [outerEnd, t],
    [outerEnd, 0],
  ];
  const frontPrims: Prim[] = [
    { kind: "poly", points: front },
    { kind: "circle", cx: 0, cy: 0, r: R },
    { kind: "line", x1: -R - t, y1: 0, x2: R + t, y2: 0, style: "center" },
    { kind: "line", x1: 0, y1: -R - t - g * 0.3, x2: 0, y2: t + g * 0.3, style: "center" },
  ];
  const frontDims: Dim[] = [
    lin([-R, 0], [R, 0], R * 0.45, 2 * R, "⌀"),
    lin([-outerEnd, t], [outerEnd, t], -g, 2 * outerEnd),
    lin([outerEnd - tab, 0], [outerEnd, 0], g * 0.8, tab),
    lin([outerEnd, 0], [outerEnd, t], g * 0.8, t),
    lin([-outerEnd, t], [-outerEnd, -(R + t)], g, R + 2 * t),
  ];
  const topPrims: Prim[] = [rect(-outerEnd, 0, outerEnd * 2, Wd)];
  topPrims.push({ kind: "line", x1: -R - t, y1: 0, x2: -R - t, y2: Wd, style: "hidden" });
  topPrims.push({ kind: "line", x1: R + t, y1: 0, x2: R + t, y2: Wd, style: "hidden" });
  const topDims: Dim[] = [lin([-outerEnd, Wd], [-outerEnd, 0], g, Wd)];
  const bolt = v.boltDia;
  if (bolt) {
    const hx = R + t + tab / 2;
    topPrims.push(...holeMarks(-hx, Wd / 2, bolt, g), ...holeMarks(hx, Wd / 2, bolt, g));
    topDims.push(lin([-hx, Wd], [hx, Wd], -g, 2 * hx), lin([hx - bolt / 2, 0], [hx + bolt / 2, 0], g * 0.6, bolt, "⌀"));
  }
  return {
    views: [
      { id: "front", prims: frontPrims, dims: frontDims },
      { id: "top", prims: topPrims, dims: topDims },
    ],
    frontArea: polygonArea(front),
    depth: Wd,
    holeVolume: bolt ? 2 * Math.PI * (bolt / 2) ** 2 * t : 0,
  };
}

function flatStand(v: Record<ParamKey, number | null>, g: number): Built {
  const L = v.length!;
  const Wd = v.width!;
  const H = v.height!;
  const t = v.thickness!;
  const base = rect(-L / 2, -t, L, t);
  // "height" is the overall height, base plate included.
  const upright = rect(-t / 2, -H, t, H - t);
  const frontDims: Dim[] = [
    lin([-L / 2, 0], [L / 2, 0], -g, L),
    lin([-L / 2, 0], [-L / 2, -H], g, H),
    lin([L / 2, 0], [L / 2, -t], -g * 0.6, t),
  ];
  const topPrims: Prim[] = [rect(-L / 2, 0, L, Wd), rect(-t / 2, 0, t, Wd)];
  const topDims: Dim[] = [lin([-L / 2, Wd], [-L / 2, 0], g, Wd)];
  const hole = v.holeDia;
  if (hole) {
    const inset = Math.max(hole * 1.5, 10);
    for (const x of [-L / 2 + inset, L / 2 - inset]) for (const y of [inset, Wd - inset]) topPrims.push(...holeMarks(x, y, hole, g));
    topDims.push(lin([-L / 2, Wd], [-L / 2 + inset, Wd], -g * 0.6, inset), lin([L / 2 - inset - hole / 2, 0], [L / 2 - inset + hole / 2, 0], g * 0.6, hole, "⌀"));
  }
  const area = polygonArea((base as { points: Pt[] }).points) + polygonArea((upright as { points: Pt[] }).points);
  return {
    views: [
      { id: "front", prims: [base, upright], dims: frontDims },
      { id: "top", prims: topPrims, dims: topDims },
    ],
    frontArea: area,
    depth: Wd,
    holeVolume: hole ? 4 * Math.PI * (hole / 2) ** 2 * t : 0,
  };
}

function hingeMount(v: Record<ParamKey, number | null>, g: number): Built {
  const Lf = v.leafLength!;
  const Wd = v.leafWidth!;
  const t = v.thickness!;
  const rp = v.pinDia! / 2;
  const ro = rp + t;
  // Edge view, hinge opened flat: knuckle ring at the origin, leaves run outward tangent to its bottom.
  const leafL = rect(-Lf, ro - t, Lf - ro * 0.6, t);
  const leafR = rect(ro * 0.6, ro - t, Lf - ro * 0.6, t);
  const frontPrims: Prim[] = [
    leafL,
    leafR,
    { kind: "circle", cx: 0, cy: 0, r: ro },
    { kind: "circle", cx: 0, cy: 0, r: rp },
    { kind: "line", x1: -ro - g * 0.3, y1: 0, x2: ro + g * 0.3, y2: 0, style: "center" },
  ];
  const frontDims: Dim[] = [
    lin([-Lf, ro], [Lf, ro], -g, 2 * Lf),
    lin([-rp, 0], [rp, 0], ro + g * 0.6, 2 * rp, "⌀"),
    lin([Lf, ro], [Lf, ro - t], -g * 0.6, t),
  ];
  const topPrims: Prim[] = [
    rect(-Lf, 0, 2 * Lf, Wd),
    { kind: "line", x1: -ro, y1: 0, x2: -ro, y2: Wd, style: "hidden" },
    { kind: "line", x1: ro, y1: 0, x2: ro, y2: Wd, style: "hidden" },
    { kind: "line", x1: 0, y1: -g * 0.3, x2: 0, y2: Wd + g * 0.3, style: "center" },
  ];
  const topDims: Dim[] = [lin([-Lf, Wd], [-Lf, 0], g, Wd)];
  const leafArea = 2 * (Lf - ro * 0.6) * t;
  const ringArea = Math.PI * (ro * ro - rp * rp);
  return {
    views: [
      { id: "front", prims: frontPrims, dims: frontDims },
      { id: "top", prims: topPrims, dims: topDims },
    ],
    frontArea: leafArea + ringArea,
    depth: Wd,
    holeVolume: 0,
  };
}

const BUILDERS: Record<ShapeType, (v: Record<ParamKey, number | null>, g: number) => Built> = {
  l_bracket: lBracket,
  pipe_clamp: pipeClamp,
  flat_stand: flatStand,
  hinge_mount: hingeMount,
};

function primBounds(p: Prim): [number, number, number, number] {
  if (p.kind === "poly") {
    const xs = p.points.map((q) => q[0]);
    const ys = p.points.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  if (p.kind === "circle") return [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
  return [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)];
}

/** Geometry of a linear dimension: the dimension line endpoints after offset. */
export function dimLine(d: LinearDim): { a: Pt; b: Pt; normal: Pt } {
  const dx = d.p2[0] - d.p1[0];
  const dy = d.p2[1] - d.p1[1];
  const len = Math.hypot(dx, dy) || 1;
  // Left normal in SVG (y-down) coordinates.
  const normal: Pt = [dy / len, -dx / len];
  return {
    a: [d.p1[0] + normal[0] * d.offset, d.p1[1] + normal[1] * d.offset],
    b: [d.p2[0] + normal[0] * d.offset, d.p2[1] + normal[1] * d.offset],
    normal,
  };
}

function dimBounds(d: Dim, g: number): [number, number, number, number] {
  if (d.kind === "angle") {
    const r = d.radius + g;
    return [d.center[0] - r, d.center[1] - r, d.center[0] + r, d.center[1] + r * 0.2];
  }
  const { a, b } = dimLine(d);
  const pad = g * 0.9;
  return [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad];
}

const PRINT_SCALES = [1, 2, 5, 10, 20, 50];
const A4_DRAWABLE = { w: 267, h: 160 };

export function chooseScale(width: number, height: number): number {
  return PRINT_SCALES.find((s) => width / s <= A4_DRAWABLE.w && height / s <= A4_DRAWABLE.h) ?? PRINT_SCALES[PRINT_SCALES.length - 1];
}

/** Builds the drawing, or returns null when parameters are invalid (see validateParams). */
export function buildDrawing(shape: ShapeType, params: Params): Drawing | null {
  if (validateParams(shape, params).length) return null;
  const { values, assumed } = resolveParams(shape, params);
  // Dimension spacing grows with part size so labels stay legible at any scale.
  const sizes = Object.values(values).filter((x): x is number => typeof x === "number");
  const g = Math.max(8, Math.max(...sizes) * 0.08);
  const built = BUILDERS[shape](values, g);

  const gap = g * 3;
  let cursorX = 0;
  let maxH = 0;
  const views: View[] = built.views.map((v) => {
    const boxes = [...v.prims.map(primBounds), ...v.dims.map((d) => dimBounds(d, g))];
    const minX = Math.min(...boxes.map((b) => b[0]));
    const minY = Math.min(...boxes.map((b) => b[1])) - g * 1.6; // room for the view title
    const maxX = Math.max(...boxes.map((b) => b[2]));
    const maxY = Math.max(...boxes.map((b) => b[3]));
    const origin: Pt = [cursorX - minX, -minY];
    cursorX += maxX - minX + gap;
    maxH = Math.max(maxH, maxY - minY);
    return { ...v, origin, bounds: { minX, minY, maxX, maxY } };
  });
  const width = cursorX - gap;
  const height = maxH;
  const volume = Math.max(0, built.frontArea * built.depth - built.holeVolume);
  return {
    shape,
    views,
    width,
    height,
    printScale: chooseScale(width, height),
    weightKg: Math.round(volume * STEEL_DENSITY_KG_PER_MM3 * 1000) / 1000,
    assumed,
    params: values,
  };
}

/** Text size and stroke widths in drawing units, proportional to the sheet. */
export function drawingMetrics(d: Drawing) {
  const base = Math.max(d.width, d.height);
  return { font: Math.max(3, base * 0.022), stroke: Math.max(0.35, base * 0.0035), thin: Math.max(0.2, base * 0.0018), arrow: Math.max(2, base * 0.012) };
}

export function formatDimValue(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
