/**
 * Converts a Drawing into a small element tree. The tree is rendered by
 * React in the viewer (no innerHTML) and serialised with full XML escaping
 * for SVG/PNG/PDF export, so user-supplied text can never inject markup.
 */
import { dimLine, drawingMetrics, formatDimValue, type Dim, type Drawing, type Prim, type Pt, type View, type ViewId } from "./drawing";

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SvgNode[];
  text?: string;
}

export interface SheetText {
  views: Record<ViewId, string>;
  title: string;
  /** e.g. "Units: mm · Scale 1:2 on A4 · Mild steel ≈ 0.45 kg" */
  footer: string;
  /** Assumptions and disclaimer lines. */
  notes: string[];
}

const INK = "#1f2a33";
const DIM = "#2f5d7c";
const SHEET = "#ffffff";

const n = (x: number) => Math.round(x * 100) / 100;

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const STYLE_DASH: Record<"center" | "hidden" | "phantom", (s: number) => string> = {
  center: (s) => `${n(s * 12)} ${n(s * 3)} ${n(s * 2)} ${n(s * 3)}`,
  hidden: (s) => `${n(s * 4)} ${n(s * 3)}`,
  phantom: (s) => `${n(s * 10)} ${n(s * 3)} ${n(s * 2)} ${n(s * 3)} ${n(s * 2)} ${n(s * 3)}`,
};

function primNode(p: Prim, m: ReturnType<typeof drawingMetrics>): SvgNode {
  if (p.kind === "poly") {
    return {
      tag: "polygon",
      attrs: { points: p.points.map(([x, y]) => `${n(x)},${n(y)}`).join(" "), fill: "#c9d3da", stroke: INK, "stroke-width": n(m.stroke), "stroke-linejoin": "round" },
    };
  }
  if (p.kind === "circle") {
    return { tag: "circle", attrs: { cx: n(p.cx), cy: n(p.cy), r: n(p.r), fill: SHEET, stroke: INK, "stroke-width": n(m.stroke) } };
  }
  return {
    tag: "line",
    attrs: { x1: n(p.x1), y1: n(p.y1), x2: n(p.x2), y2: n(p.y2), stroke: INK, "stroke-width": n(m.thin), "stroke-dasharray": STYLE_DASH[p.style](m.thin * 4) },
  };
}

function arrowHead(tip: Pt, dir: Pt, size: number): SvgNode {
  const [dx, dy] = dir;
  const bx = tip[0] - dx * size;
  const by = tip[1] - dy * size;
  const w = size * 0.35;
  return {
    tag: "polygon",
    attrs: { points: `${n(tip[0])},${n(tip[1])} ${n(bx - dy * w)},${n(by + dx * w)} ${n(bx + dy * w)},${n(by - dx * w)}`, fill: DIM },
  };
}

function dimNodes(d: Dim, m: ReturnType<typeof drawingMetrics>): SvgNode[] {
  const text = (x: number, y: number, label: string, rotate = 0): SvgNode => ({
    tag: "text",
    attrs: {
      x: n(x),
      y: n(y),
      "font-size": n(m.font),
      "font-family": "Arial, sans-serif",
      fill: DIM,
      "text-anchor": "middle",
      ...(rotate ? { transform: `rotate(${n(rotate)} ${n(x)} ${n(y)})` } : {}),
    },
    text: label,
  });

  if (d.kind === "angle") {
    const [cx, cy] = d.center;
    const pt = (deg: number): Pt => [cx + d.radius * Math.cos((deg * Math.PI) / 180), cy - d.radius * Math.sin((deg * Math.PI) / 180)];
    const a = pt(d.startDeg);
    const b = pt(d.endDeg);
    const large = Math.abs(d.endDeg - d.startDeg) > 180 ? 1 : 0;
    const mid = pt((d.startDeg + d.endDeg) / 2);
    const lx = cx + (mid[0] - cx) * 1.35;
    const ly = cy + (mid[1] - cy) * 1.35;
    return [
      { tag: "path", attrs: { d: `M ${n(a[0])} ${n(a[1])} A ${n(d.radius)} ${n(d.radius)} 0 ${large} 0 ${n(b[0])} ${n(b[1])}`, fill: "none", stroke: DIM, "stroke-width": n(m.thin) } },
      text(lx, ly + m.font * 0.35, `${formatDimValue(d.value)}°`),
    ];
  }

  const { a, b, normal } = dimLine(d);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dir: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const ext = Math.sign(d.offset) * m.font * 0.4;
  const extLine = (p: Pt, q: Pt): SvgNode => ({
    tag: "line",
    attrs: { x1: n(p[0]), y1: n(p[1]), x2: n(q[0] + normal[0] * ext), y2: n(q[1] + normal[1] * ext), stroke: DIM, "stroke-width": n(m.thin) },
  });
  let angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const side = d.offset >= 0 ? 1 : -1;
  const mx = (a[0] + b[0]) / 2 + normal[0] * side * m.font * 0.5;
  const my = (a[1] + b[1]) / 2 + normal[1] * side * m.font * 0.5 + m.font * 0.35;
  const arrow = Math.min(m.arrow, len / 3);
  return [
    extLine(d.p1, a),
    extLine(d.p2, b),
    { tag: "line", attrs: { x1: n(a[0]), y1: n(a[1]), x2: n(b[0]), y2: n(b[1]), stroke: DIM, "stroke-width": n(m.thin) } },
    arrowHead(a, [-dir[0], -dir[1]], arrow),
    arrowHead(b, dir, arrow),
    text(mx, my, `${d.prefix ?? ""}${formatDimValue(d.value)}`, angle),
  ];
}

function viewNode(v: View, title: string, showDims: boolean, m: ReturnType<typeof drawingMetrics>): SvgNode {
  return {
    tag: "g",
    attrs: { transform: `translate(${n(v.origin[0])} ${n(v.origin[1])})` },
    children: [
      {
        tag: "text",
        attrs: { x: n((v.bounds.minX + v.bounds.maxX) / 2), y: n(v.bounds.minY + m.font), "font-size": n(m.font * 1.05), "font-family": "Arial, sans-serif", "font-weight": "bold", fill: INK, "text-anchor": "middle" },
        text: title,
      },
      ...v.prims.map((p) => primNode(p, m)),
      ...(showDims ? v.dims.flatMap((d) => dimNodes(d, m)) : []),
    ],
  };
}

/** Full sheet: views + title block. Width/height are in mm so a printed SVG keeps its scale. */
export function drawingTree(d: Drawing, text: SheetText, opts: { showDims: boolean; printSize?: boolean }): SvgNode {
  const m = drawingMetrics(d);
  const pad = m.font * 2;
  const lineH = m.font * 1.4;
  const blockLines = [text.title, text.footer, ...text.notes];
  const blockH = blockLines.length * lineH + m.font;
  const W = d.width + pad * 2;
  const H = d.height + pad * 2 + blockH;
  const top = pad + d.height + m.font;
  const sizeAttrs: Record<string, string> = opts.printSize ? { width: `${n(W / d.printScale)}mm`, height: `${n(H / d.printScale)}mm` } : {};
  return {
    tag: "svg",
    attrs: { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${n(W)} ${n(H)}`, ...sizeAttrs },
    children: [
      { tag: "rect", attrs: { x: 0, y: 0, width: n(W), height: n(H), fill: SHEET } },
      { tag: "g", attrs: { transform: `translate(${n(pad)} ${n(pad)})` }, children: d.views.map((v) => viewNode(v, text.views[v.id], opts.showDims, m)) },
      { tag: "line", attrs: { x1: n(pad), y1: n(top), x2: n(W - pad), y2: n(top), stroke: INK, "stroke-width": n(m.thin) } },
      ...blockLines.map(
        (line, i): SvgNode => ({
          tag: "text",
          attrs: { x: n(pad), y: n(top + lineH * (i + 1)), "font-size": n(i === 0 ? m.font * 1.15 : m.font * 0.9), "font-family": "Arial, sans-serif", "font-weight": i === 0 ? "bold" : "normal", fill: INK },
          text: line,
        })
      ),
    ],
  };
}

export function serializeSvg(node: SvgNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
  const inner = node.text !== undefined ? escapeXml(node.text) : (node.children ?? []).map(serializeSvg).join("");
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

export function toSvgString(d: Drawing, text: SheetText, showDims = true): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializeSvg(drawingTree(d, text, { showDims, printSize: true }))}`;
}
