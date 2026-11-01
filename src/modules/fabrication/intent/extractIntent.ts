/**
 * Rule-based extraction of a fabrication request from Tamil, English or
 * mixed speech/text. It only reports values that were actually said:
 * nothing is defaulted here. Missing required values are returned in
 * `missing` so the UI can ask for them.
 */
import { PARAM_SPECS, missingParams, type ParamKey, type Params, type ShapeType } from "../engine/shapes";

const SHAPE_WORDS: Record<ShapeType, string[]> = {
  l_bracket: ["l bracket", "l-bracket", "bracket", "angle bracket", "பிராக்கெட்", "பிரக்கெட்", "கோண ஆதரவு"],
  pipe_clamp: ["clamp", "pipe clamp", "u clamp", "saddle", "கிளாம்ப்", "குழாய் பிடி"],
  flat_stand: ["stand", "base plate", "ஸ்டாண்ட்", "நிலைப்பாடு", "தாங்கி"],
  hinge_mount: ["hinge", "கீல்", "ஹிஞ்ச்"],
};

type Quantity = "length" | "width" | "thickness" | "height" | "diameter" | "angle" | "hole" | "tab" | "pin" | "leg";

const QUANTITY_WORDS: Record<Quantity, string[]> = {
  length: ["length", "long", "நீளம்", "நீள"],
  width: ["width", "wide", "breadth", "அகலம்", "அகல"],
  thickness: ["thickness", "thick", "gauge", "தடிமன்", "தடிப்பு", "கனம்"],
  height: ["height", "tall", "high", "உயரம்", "உயர"],
  diameter: ["diameter", "dia", "pipe", "விட்டம்", "குழாய்", "பைப்"],
  angle: ["angle", "கோணம்"],
  hole: ["hole", "bolt", "screw", "துளை", "ஓட்டை", "போல்ட்"],
  tab: ["tab", "flange", "ear", "காது"],
  pin: ["pin", "பின்", "ஆணி"],
  leg: ["leg", "arm", "side", "கால்", "பக்கம்"],
};

const UNIT_TO_MM: [RegExp, number][] = [
  [/^(mm|millimet(er|re)s?|மிமீ|மி\.மீ|மில்லிமீட்டர்)/i, 1],
  [/^(cm|centimet(er|re)s?|செமீ|செ\.மீ|சென்டிமீட்டர்|சென்டி)/i, 10],
  [/^(inch(es)?|in\b|"|இன்ச்|அங்குலம்)/i, 25.4],
  [/^(feet|foot|ft|அடி)/i, 304.8],
  [/^(m\b|met(er|re)s?|மீட்டர்|மீ(?=\s|$))/i, 1000],
];
const DEGREE_RE = /^(°|deg(rees?)?|டிகிரி)/i;
const NUMBER_RE = /(\d+(?:\.\d+)?)\s*/g;

export interface Measurement {
  value: number;
  /** "mm" after unit conversion, "deg" for angles, null when no unit was said. */
  unit: "mm" | "deg" | null;
  quantity: Quantity | null;
  index: number;
}

export interface IntentResult {
  shape: ShapeType | null;
  params: Params;
  missing: ParamKey[];
  /** Numbers we heard but could not place; shown to the user. */
  unplaced: number[];
  /** True when some numbers had no unit and were read as millimetres. */
  unitAssumed: boolean;
}

function normalise(text: string): string {
  // Commas and semicolons become " ; " so they still separate phrases.
  return text.toLowerCase().replace(/[,;]+/g, " ; ").replace(/\s+/g, " ");
}

export function detectShape(text: string): ShapeType | null {
  const t = normalise(text);
  let best: { shape: ShapeType; len: number } | null = null;
  for (const [shape, words] of Object.entries(SHAPE_WORDS) as [ShapeType, string[]][]) {
    for (const w of words) if (t.includes(w) && (!best || w.length > best.len)) best = { shape, len: w.length };
  }
  return best?.shape ?? null;
}

const WINDOW = 24;
/** Words that join two values of the same quantity: "legs 100 and 80". */
const CONNECTOR_RE = /^\s*(;|and|&|x|by|மற்றும்|-)?\s*$/;

interface Span {
  start: number;
  end: number;
}

function quantityWords(text: string): { q: Quantity; start: number; end: number }[] {
  const out: { q: Quantity; start: number; end: number }[] = [];
  for (const [q, words] of Object.entries(QUANTITY_WORDS) as [Quantity, string[]][]) {
    for (const w of words) {
      for (let i = text.indexOf(w); i !== -1; i = text.indexOf(w, i + 1)) out.push({ q, start: i, end: i + w.length });
    }
  }
  return out;
}

/**
 * Labels usually come before their value ("width 40 mm"), sometimes after
 * ("40 mm wide"). A label is only considered when no other number sits
 * between it and the value, and a trailing word that is itself followed by
 * a number belongs to that next number instead.
 */
function assignQuantities(text: string, spans: readonly Span[], fixed: readonly (Quantity | null)[]): (Quantity | null)[] {
  const words = quantityWords(text);
  const result: (Quantity | null)[] = [];
  spans.forEach((s, idx) => {
    if (fixed[idx]) {
      result.push(fixed[idx]);
      return;
    }
    const prevEnd = idx > 0 ? spans[idx - 1].end : 0;
    const nextStart = idx + 1 < spans.length ? spans[idx + 1].start : text.length;

    // 1. Closest label before the value, with no number in between (longest word wins ties).
    let before: { q: Quantity; dist: number; len: number } | null = null;
    for (const w of words) {
      if (w.end > s.start || w.start < prevEnd || text.slice(w.end, s.start).includes(";")) continue;
      const dist = s.start - w.end;
      const len = w.end - w.start;
      if (dist <= WINDOW && (!before || dist < before.dist || (dist === before.dist && len > before.len))) before = { q: w.q, dist, len };
    }
    if (before) {
      result.push(before.q);
      return;
    }

    // 2. Label right after the value, unless that label introduces the next number.
    let after: { q: Quantity; dist: number } | null = null;
    for (const w of words) {
      if (w.start < s.end || w.end > nextStart) continue;
      if (/^\s*\d/.test(text.slice(w.end))) continue;
      const dist = w.start - s.end;
      if (dist <= WINDOW && (!after || dist < after.dist)) after = { q: w.q, dist };
    }
    if (after) {
      result.push(after.q);
      return;
    }

    // 3. Continuation of the previous value: "legs 100 mm and 80 mm".
    if (idx > 0 && result[idx - 1] && CONNECTOR_RE.test(text.slice(prevEnd, s.start))) {
      result.push(result[idx - 1]);
      return;
    }
    result.push(null);
  });
  return result;
}

export function findMeasurements(text: string): Measurement[] {
  const t = normalise(text);
  const found: { value: number; unit: Measurement["unit"]; span: Span }[] = [];
  NUMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(t))) {
    const raw = Number(m[1]);
    const after = t.slice(m.index + m[0].length);
    let value = raw;
    let unit: Measurement["unit"] = null;
    let consumed = 0;
    if (DEGREE_RE.test(after)) {
      unit = "deg";
      consumed = after.match(DEGREE_RE)![0].length;
    } else {
      for (const [re, factor] of UNIT_TO_MM) {
        const u = after.match(re);
        if (u) {
          value = Math.round(raw * factor * 10) / 10;
          unit = "mm";
          consumed = u[0].length;
          break;
        }
      }
    }
    // End of the number plus its unit, excluding trailing whitespace.
    const end = m.index + m[1].length + (consumed ? m[0].length - m[1].length + consumed : 0);
    found.push({ value, unit, span: { start: m.index, end } });
  }
  const quantities = assignQuantities(
    t,
    found.map((r) => r.span),
    found.map((r) => (r.unit === "deg" ? "angle" : null))
  );
  return found.map((r, i) => ({ value: r.value, unit: r.unit, quantity: quantities[i], index: r.span.start }));
}

/** Which parameter each spoken quantity fills, per shape, in order of use. */
const QUANTITY_MAP: Record<ShapeType, Partial<Record<Quantity, ParamKey[]>>> = {
  l_bracket: { leg: ["legA", "legB"], length: ["legA", "legB"], height: ["legA"], width: ["width"], thickness: ["thickness"], angle: ["angle"], hole: ["holeDia"], diameter: ["holeDia"] },
  pipe_clamp: { diameter: ["pipeDia"], width: ["strapWidth"], thickness: ["thickness"], tab: ["tabLength"], length: ["tabLength"], hole: ["boltDia"] },
  flat_stand: { length: ["length"], width: ["width"], height: ["height"], thickness: ["thickness"], hole: ["holeDia"], diameter: ["holeDia"] },
  hinge_mount: { length: ["leafLength"], leg: ["leafLength"], width: ["leafWidth"], thickness: ["thickness"], pin: ["pinDia"], diameter: ["pinDia"], hole: ["pinDia"] },
};

const EQUAL_WORDS = ["equal", "same", "both", "each", "சம", "இரண்டும்", "ஒவ்வொன்றும்"];

export function extractIntent(text: string, shapeHint: ShapeType | null = null): IntentResult {
  const shape = detectShape(text) ?? shapeHint;
  const measurements = findMeasurements(text);
  const params: Params = {};
  const unplaced: number[] = [];
  const unitAssumed = measurements.some((m) => m.unit === null);
  if (!shape) {
    return { shape: null, params, missing: [], unplaced: measurements.map((m) => m.value), unitAssumed };
  }

  const specs = new Map(PARAM_SPECS[shape].map((s) => [s.key, s]));
  const place = (key: ParamKey, value: number) => {
    if (params[key] === undefined && specs.has(key)) {
      params[key] = value;
      return true;
    }
    return false;
  };

  for (const m of measurements) {
    const targets = m.quantity ? QUANTITY_MAP[shape][m.quantity] ?? [] : [];
    if (!targets.some((k) => place(k, m.value))) unplaced.push(m.value);
  }

  // "both legs 100 mm" → equal legs.
  const t = normalise(text);
  if (shape === "l_bracket" && params.legA !== undefined && params.legB === undefined && EQUAL_WORDS.some((w) => t.includes(w))) {
    params.legB = params.legA;
  }
  // "clamp for 2 inch" with no other label → pipe diameter.
  if (shape === "pipe_clamp" && params.pipeDia === undefined && unplaced.length === 1 && measurements.length === 1) {
    params.pipeDia = unplaced.pop();
  }

  return { shape, params, missing: missingParams(shape, params), unplaced, unitAssumed };
}
