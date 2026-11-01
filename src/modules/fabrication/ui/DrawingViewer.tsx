import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../../i18n";
import type { Drawing } from "../engine/drawing";
import { drawingTree, type SheetText, type SvgNode } from "../engine/svg";
import { Button } from "../../../shared/ui/Button";

/** kebab-case SVG attribute → React prop name. */
function reactProp(k: string): string {
  return k === "xmlns" ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function SvgElement({ node, k }: { node: SvgNode; k?: number }): React.ReactElement {
  const props: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(node.attrs)) props[reactProp(name)] = v;
  return React.createElement(
    node.tag,
    { ...props, key: k },
    node.text !== undefined ? node.text : node.children?.map((c, i) => <SvgElement key={i} node={c} k={i} />)
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_ZOOM = 0.1;

/** Zoomable, pannable drawing view. Fit = whole sheet; reset also restores dimensions. */
export function DrawingViewer({ drawing, text, showDims, onToggleDims }: { drawing: Drawing; text: SheetText; showDims: boolean; onToggleDims: (v: boolean) => void }) {
  const { t } = useT();
  const tree = drawingTree(drawing, text, { showDims });
  const [, , fullW, fullH] = String(tree.attrs.viewBox).split(" ").map(Number);
  const full: Box = { x: 0, y: 0, w: fullW, h: fullH };
  const [box, setBox] = useState<Box>(full);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null);

  const fullKey = `${fullW}x${fullH}`;
  useEffect(() => setBox({ x: 0, y: 0, w: fullW, h: fullH }), [fullKey, fullW, fullH]);

  const zoom = useCallback(
    (factor: number, cx = 0.5, cy = 0.5) =>
      setBox((b) => {
        const w = Math.min(fullW * 4, Math.max(fullW * MIN_ZOOM, b.w / factor));
        const h = (w / b.w) * b.h;
        return { x: b.x + (b.w - w) * cx, y: b.y + (b.h - h) * cy, w, h };
      }),
    [fullW]
  );

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, box };
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const start = drag.current;
    const scale = Math.max(start.box.w / r.width, start.box.h / r.height);
    setBox({ ...start.box, x: start.box.x - (e.clientX - start.x) * scale, y: start.box.y - (e.clientY - start.y) * scale });
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onKeyDown(e: React.KeyboardEvent) {
    const step = box.w * 0.1;
    if (e.key === "+" || e.key === "=") zoom(1.2);
    else if (e.key === "-") zoom(1 / 1.2);
    else if (e.key === "0") setBox(full);
    else if (e.key === "ArrowLeft") setBox({ ...box, x: box.x - step });
    else if (e.key === "ArrowRight") setBox({ ...box, x: box.x + step });
    else if (e.key === "ArrowUp") setBox({ ...box, y: box.y - step });
    else if (e.key === "ArrowDown") setBox({ ...box, y: box.y + step });
    else return;
    e.preventDefault();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label={t("fab.viewerTools")}>
        <Button size="sm" variant="secondary" onClick={() => zoom(1.25)} aria-label={t("fab.zoomIn")}>
          ＋
        </Button>
        <Button size="sm" variant="secondary" onClick={() => zoom(0.8)} aria-label={t("fab.zoomOut")}>
          －
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setBox(full)}>
          {t("fab.fit")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setBox(full);
            onToggleDims(true);
          }}
        >
          {t("fab.reset")}
        </Button>
        <label className="inline-flex items-center gap-2 text-sm min-h-[44px] px-2">
          <input type="checkbox" checked={showDims} onChange={(e) => onToggleDims(e.target.checked)} className="w-5 h-5 accent-leaf-700" />
          {t("fab.showDims")}
        </label>
      </div>
      <div className="rounded-card border border-soil-200 bg-white overflow-hidden touch-none">
        <svg
          ref={svgRef}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          className="w-full h-[55vh] min-h-[300px] cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-leaf-600"
          role="img"
          aria-label={text.title}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {tree.children?.map((c, i) => <SvgElement key={i} node={c} k={i} />)}
        </svg>
      </div>
      <p className="text-xs text-soil-500">{t("fab.viewerHint")}</p>
    </div>
  );
}
