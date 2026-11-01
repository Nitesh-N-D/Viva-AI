/**
 * Parametric shape definitions for the fabrication drawing generator.
 * All lengths are millimetres, angles are degrees.
 *
 * Required parameters are never invented: if the user has not given one,
 * validation reports it as missing and the UI asks for it. Optional
 * parameters (holes, bend angle, tab length) have a documented standard
 * value that is shown on the drawing as an assumption.
 */

export type ShapeType = "l_bracket" | "pipe_clamp" | "flat_stand" | "hinge_mount";
export const SHAPE_TYPES: readonly ShapeType[] = ["l_bracket", "pipe_clamp", "flat_stand", "hinge_mount"];

export type ParamKey =
  | "legA"
  | "legB"
  | "width"
  | "thickness"
  | "angle"
  | "holeDia"
  | "pipeDia"
  | "strapWidth"
  | "tabLength"
  | "boltDia"
  | "length"
  | "height"
  | "leafLength"
  | "leafWidth"
  | "pinDia";

export interface ParamSpec {
  key: ParamKey;
  unit: "mm" | "deg";
  min: number;
  max: number;
  required: boolean;
  /** Standard value used when an optional parameter is not given. null = feature omitted (e.g. no holes). */
  standard?: number | null;
}

const mm = (key: ParamKey, min: number, max: number, required = true, standard?: number | null): ParamSpec => ({
  key,
  unit: "mm",
  min,
  max,
  required,
  standard,
});

export const PARAM_SPECS: Record<ShapeType, readonly ParamSpec[]> = {
  l_bracket: [
    mm("legA", 10, 2000),
    mm("legB", 10, 2000),
    mm("width", 5, 1000),
    mm("thickness", 0.5, 50),
    { key: "angle", unit: "deg", min: 30, max: 150, required: false, standard: 90 },
    mm("holeDia", 2, 60, false, null),
  ],
  pipe_clamp: [
    mm("pipeDia", 5, 600),
    mm("strapWidth", 5, 300),
    mm("thickness", 0.5, 30),
    mm("tabLength", 5, 200, false, 25),
    mm("boltDia", 2, 40, false, null),
  ],
  flat_stand: [
    mm("length", 20, 3000),
    mm("width", 10, 2000),
    mm("height", 10, 3000),
    mm("thickness", 0.5, 50),
    mm("holeDia", 2, 60, false, null),
  ],
  hinge_mount: [
    mm("leafLength", 10, 1000),
    mm("leafWidth", 10, 1000),
    mm("thickness", 0.5, 30),
    mm("pinDia", 2, 100),
  ],
};

export type Params = Partial<Record<ParamKey, number>>;

export interface ParamProblem {
  key: ParamKey;
  problem: "missing" | "out_of_range" | "geometry";
  min?: number;
  max?: number;
}

export interface ResolvedParams {
  values: Record<ParamKey, number | null>;
  /** Optional parameters that were filled with their standard value. */
  assumed: ParamKey[];
}

/** Returns every problem with the given parameters; empty means drawable. */
export function validateParams(shape: ShapeType, params: Params): ParamProblem[] {
  const problems: ParamProblem[] = [];
  for (const spec of PARAM_SPECS[shape]) {
    const v = params[spec.key];
    if (v === undefined || v === null || Number.isNaN(v)) {
      if (spec.required) problems.push({ key: spec.key, problem: "missing" });
      continue;
    }
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
      problems.push({ key: spec.key, problem: "out_of_range", min: spec.min, max: spec.max });
    }
  }
  if (problems.length) return problems;

  // Cross-parameter geometry checks: the part must be physically drawable.
  const p = params as Record<ParamKey, number | undefined>;
  const t = p.thickness ?? 0;
  if (shape === "l_bracket") {
    if (p.legA! <= t * 2) problems.push({ key: "legA", problem: "geometry" });
    if (p.legB! <= t * 2) problems.push({ key: "legB", problem: "geometry" });
    if (p.holeDia !== undefined && p.holeDia >= p.width! - 2) problems.push({ key: "holeDia", problem: "geometry" });
  } else if (shape === "pipe_clamp") {
    const tab = p.tabLength ?? 25;
    if (p.boltDia !== undefined && p.boltDia >= Math.min(tab, p.strapWidth!) - 2) problems.push({ key: "boltDia", problem: "geometry" });
  } else if (shape === "flat_stand") {
    if (p.height! <= t * 2) problems.push({ key: "height", problem: "geometry" });
    if (p.holeDia !== undefined && p.holeDia * 4 >= Math.min(p.length!, p.width!)) problems.push({ key: "holeDia", problem: "geometry" });
  } else if (shape === "hinge_mount") {
    if (p.leafLength! <= p.pinDia! / 2 + t) problems.push({ key: "leafLength", problem: "geometry" });
  }
  return problems;
}

export function missingParams(shape: ShapeType, params: Params): ParamKey[] {
  return validateParams(shape, params)
    .filter((p) => p.problem === "missing")
    .map((p) => p.key);
}

/** Fills optional parameters with their standard values. Call only after validateParams() is empty. */
export function resolveParams(shape: ShapeType, params: Params): ResolvedParams {
  const values = {} as Record<ParamKey, number | null>;
  const assumed: ParamKey[] = [];
  for (const spec of PARAM_SPECS[shape]) {
    const v = params[spec.key];
    if (v !== undefined && Number.isFinite(v)) values[spec.key] = v;
    else {
      values[spec.key] = spec.standard ?? null;
      if (spec.standard !== undefined && spec.standard !== null) assumed.push(spec.key);
    }
  }
  return { values, assumed };
}
