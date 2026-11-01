import { describe, expect, it } from "vitest";
import { PARAM_SPECS, SHAPE_TYPES, resolveParams, validateParams, type Params, type ShapeType } from "../modules/fabrication/engine/shapes";
import { STEEL_DENSITY_KG_PER_MM3, buildDrawing, chooseScale, dimLine, polygonArea, type LinearDim } from "../modules/fabrication/engine/drawing";
import { escapeXml, serializeSvg, toSvgString, type SheetText } from "../modules/fabrication/engine/svg";
import { detectShape, extractIntent, findMeasurements } from "../modules/fabrication/intent/extractIntent";

const SAMPLE: Record<ShapeType, Params> = {
  l_bracket: { legA: 100, legB: 80, width: 40, thickness: 5 },
  pipe_clamp: { pipeDia: 50, strapWidth: 25, thickness: 3 },
  flat_stand: { length: 300, width: 200, height: 150, thickness: 6 },
  hinge_mount: { leafLength: 60, leafWidth: 40, thickness: 3, pinDia: 8 },
};

const sheet: SheetText = { views: { front: "FRONT", top: "TOP", side: "SIDE" }, title: "T", footer: "F", notes: [] };

function linearDims(shape: ShapeType, params: Params): number[] {
  const d = buildDrawing(shape, params)!;
  return d.views.flatMap((v) => v.dims.filter((x): x is LinearDim => x.kind === "linear").map((x) => x.value));
}

describe("parameter validation", () => {
  it("reports missing required parameters instead of inventing them", () => {
    const p = validateParams("l_bracket", { legA: 100 });
    expect(p.filter((x) => x.problem === "missing").map((x) => x.key)).toEqual(["legB", "width", "thickness"]);
    expect(buildDrawing("l_bracket", { legA: 100 })).toBeNull();
  });
  it("rejects out-of-range and impossible geometry", () => {
    expect(validateParams("l_bracket", { ...SAMPLE.l_bracket, thickness: 500 })[0].problem).toBe("out_of_range");
    expect(validateParams("l_bracket", { ...SAMPLE.l_bracket, legA: 10, thickness: 6 })).toEqual([{ key: "legA", problem: "geometry" }]);
    expect(validateParams("l_bracket", { ...SAMPLE.l_bracket, holeDia: 40 })[0]).toMatchObject({ key: "holeDia", problem: "geometry" });
    expect(validateParams("hinge_mount", { ...SAMPLE.hinge_mount, leafLength: 10, pinDia: 20 })[0].key).toBe("leafLength");
  });
  it("marks standard optional values as assumed and leaves holes off", () => {
    const r = resolveParams("l_bracket", SAMPLE.l_bracket);
    expect(r.assumed).toEqual(["angle"]);
    expect(r.values.angle).toBe(90);
    expect(r.values.holeDia).toBeNull();
  });
  it("every shape has specs with min < max", () => {
    for (const s of SHAPE_TYPES) for (const spec of PARAM_SPECS[s]) expect(spec.min).toBeLessThan(spec.max);
  });
});

describe("drawing geometry", () => {
  it("shoelace area", () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 5], [0, 5]])).toBe(50);
  });

  it("L-bracket weight matches hand calculation", () => {
    const d = buildDrawing("l_bracket", SAMPLE.l_bracket)!;
    // Cross-section (100 + 80 - 5) * 5 = 875 mm², times width 40 mm.
    const expected = Math.round(875 * 40 * STEEL_DENSITY_KG_PER_MM3 * 1000) / 1000;
    expect(d.weightKg).toBeCloseTo(expected, 3);
  });

  it("flat stand weight matches plate volumes", () => {
    const d = buildDrawing("flat_stand", SAMPLE.flat_stand)!;
    expect(d.weightKg).toBeGreaterThan(0);
  });

  it("dimension values follow the parameters", () => {
    for (const shape of SHAPE_TYPES) {
      const dims = linearDims(shape, SAMPLE[shape]);
      expect(dims.length, shape).toBeGreaterThan(0);
      const bigger = Object.fromEntries(Object.entries(SAMPLE[shape]).map(([k, v]) => [k, (v as number) * 2]));
      const dims2 = linearDims(shape, bigger);
      expect(dims2, shape).not.toEqual(dims);
    }
    expect(linearDims("l_bracket", SAMPLE.l_bracket)).toEqual(expect.arrayContaining([100, 80, 40, 5]));
    expect(linearDims("flat_stand", SAMPLE.flat_stand)).toEqual(expect.arrayContaining([300, 200, 150]));
  });

  it("includes an angle dimension for non-right L-brackets", () => {
    const d = buildDrawing("l_bracket", { ...SAMPLE.l_bracket, angle: 120 })!;
    const angles = d.views.flatMap((v) => v.dims.filter((x) => x.kind === "angle"));
    expect(angles.map((a) => a.value)).toContain(120);
  });

  it("adds hole circles only when a hole size is given", () => {
    const count = (p: Params) => buildDrawing("flat_stand", p)!.views.flatMap((v) => v.prims).filter((x) => x.kind === "circle").length;
    expect(count(SAMPLE.flat_stand)).toBe(0);
    expect(count({ ...SAMPLE.flat_stand, holeDia: 10 })).toBe(4);
  });

  it("chooses the smallest print scale that fits A4", () => {
    expect(chooseScale(200, 100)).toBe(1);
    expect(chooseScale(400, 100)).toBe(2);
    expect(chooseScale(1e6, 1e6)).toBe(50);
    expect(buildDrawing("flat_stand", { length: 2000, width: 1000, height: 1000, thickness: 10 })!.printScale).toBeGreaterThan(1);
  });

  it("dimension offset uses the left normal", () => {
    const { a } = dimLine({ kind: "linear", p1: [0, 0], p2: [10, 0], offset: 5, value: 10 });
    expect(a).toEqual([0, -5]);
  });
});

describe("SVG output safety", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&apos;");
  });
  it("never emits user text as markup", () => {
    const d = buildDrawing("l_bracket", SAMPLE.l_bracket)!;
    const svg = toSvgString(d, { ...sheet, title: '<script>alert(1)</script>', notes: ['" onload="x'] });
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('" onload="');
    expect(svg).toContain("&lt;script&gt;");
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toMatch(/width="[\d.]+mm"/);
  });
  it("serializes attributes with escaping", () => {
    expect(serializeSvg({ tag: "text", attrs: { x: 1, "data-a": '"><b>' }, text: "a<b" })).toBe('<text x="1" data-a="&quot;&gt;&lt;b&gt;">a&lt;b</text>');
  });
  it("hides dimensions when toggled off", () => {
    const d = buildDrawing("l_bracket", SAMPLE.l_bracket)!;
    expect(toSvgString(d, sheet, false).length).toBeLessThan(toSvgString(d, sheet, true).length);
  });
});

describe("intent extraction", () => {
  it("detects shapes in English and Tamil", () => {
    expect(detectShape("I need an L bracket")).toBe("l_bracket");
    expect(detectShape("pipe clamp please")).toBe("pipe_clamp");
    expect(detectShape("ஒரு கீல் வேண்டும்")).toBe("hinge_mount");
    expect(detectShape("hello")).toBeNull();
  });

  it("converts units to mm", () => {
    const ms = findMeasurements("10 cm 2 inch 5 mm 1 feet 30 degrees");
    expect(ms.map((m) => m.value)).toEqual([100, 50.8, 5, 304.8, 30]);
    expect(ms[4].unit).toBe("deg");
  });

  it("extracts a full English L-bracket request", () => {
    const r = extractIntent("L bracket, legs 100 mm and 80 mm, width 40 mm, thickness 5 mm");
    expect(r.shape).toBe("l_bracket");
    expect(r.params).toMatchObject({ legA: 100, legB: 80, width: 40, thickness: 5 });
    expect(r.missing).toEqual([]);
    expect(r.unitAssumed).toBe(false);
  });

  it("extracts a Tamil flat-stand request", () => {
    const r = extractIntent("ஸ்டாண்ட் நீளம் 30 செமீ அகலம் 20 செமீ உயரம் 15 செமீ தடிமன் 6 மிமீ");
    expect(r.shape).toBe("flat_stand");
    expect(r.params).toMatchObject({ length: 300, width: 200, height: 150, thickness: 6 });
    expect(r.missing).toEqual([]);
  });

  it("reports missing values and never invents them", () => {
    const r = extractIntent("hinge with pin 8 mm");
    expect(r.shape).toBe("hinge_mount");
    expect(r.params).toEqual({ pinDia: 8 });
    expect(r.missing).toEqual(["leafLength", "leafWidth", "thickness"]);
  });

  it("handles equal legs and unitless numbers", () => {
    const r = extractIntent("bracket both legs 75 width 30 thickness 4");
    expect(r.params).toMatchObject({ legA: 75, legB: 75, width: 30, thickness: 4 });
    expect(r.unitAssumed).toBe(true);
  });

  it("understands labels after the value", () => {
    const r = extractIntent("hinge, leaf 60 mm long, 40 mm wide, 3 mm thick, pin 8 mm");
    expect(r.params).toEqual({ leafLength: 60, leafWidth: 40, thickness: 3, pinDia: 8 });
  });

  it("reads a single number on a clamp as the pipe diameter", () => {
    expect(extractIntent("clamp for 2 inch").params.pipeDia).toBe(50.8);
  });

  it("returns unplaced numbers when shape is unknown", () => {
    const r = extractIntent("make 100 by 50");
    expect(r.shape).toBeNull();
    expect(r.unplaced).toEqual([100, 50]);
  });
});
