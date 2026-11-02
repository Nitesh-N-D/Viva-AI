/**
 * shared/voice/pageText.ts — turns the visible page into readable sections.
 *
 * Walks the DOM under a root (normally <main>) in document order and keeps
 * only meaningful, visible text:
 *  - skips hidden content (`hidden`, `aria-hidden="true"`, `display:none`,
 *    `visibility:hidden`, closed <details>), navigation, scripts, styles,
 *    code blocks, SVG/canvas, images, and anything marked `data-no-read`
 *  - reads form controls by their current value (a <select> reads its chosen
 *    option, never the whole option list); never reads passwords
 *  - reads `data-read` instead of the element's text when present, so a
 *    screen can supply a clearer spoken form (e.g. "₹3500 per quintal")
 *  - removes emoji and other pictographs, which speech engines read badly
 *  - starts a new section at each heading (h1–h6) or `data-read-section`
 *
 * It re-reads the live DOM on every call, so dynamic React content (loaded
 * prices, a scan result) is included as soon as it is on screen.
 */

export interface ReadSection {
  heading: string;
  text: string;
}

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "CODE", "PRE", "SVG", "CANVAS", "VIDEO", "AUDIO", "IMG", "PICTURE",
  "IFRAME", "OBJECT", "NAV", "OPTION", "OPTGROUP", "DATALIST", "BUTTON",
]);
const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "DL", "DT", "DD", "TR", "TABLE", "THEAD", "TBODY", "SECTION", "ARTICLE", "HEADER",
  "FOOTER", "ASIDE", "FIGURE", "FIGCAPTION", "BLOCKQUOTE", "FORM", "FIELDSET", "LEGEND", "LABEL", "H1", "H2", "H3",
  "H4", "H5", "H6", "BR", "HR", "DETAILS", "SUMMARY", "MAIN",
]);
const CELL_TAGS = new Set(["TD", "TH"]);
const HEADING = /^H[1-6]$/;
// Emoji, pictographs, variation selectors and keycap/ZWJ glue.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

export function cleanSpokenText(s: string): string {
  return s.replace(PICTOGRAPHS, " ").replace(/\s+/g, " ").trim();
}

function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("data-no-read")) return true;
  if (el.getAttribute("role") === "navigation") return true;
  if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "hidden") return true;
  const view = el.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    const cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return true;
  }
  return false;
}

function controlText(el: Element): string | null {
  if (el.tagName === "SELECT") {
    const sel = el as HTMLSelectElement;
    const opt = sel.selectedOptions?.[0] ?? sel.options[sel.selectedIndex];
    return opt && opt.value !== "" ? opt.text : null;
  }
  if (el.tagName === "INPUT") {
    const input = el as HTMLInputElement;
    if (["password", "hidden", "file", "submit", "button", "reset", "image"].includes(input.type)) return null;
    if (input.type === "checkbox" || input.type === "radio") return null;
    return input.value.trim() || null;
  }
  if (el.tagName === "TEXTAREA") return null; // a draft the user is typing is not page content
  return null;
}

/** Extracts readable sections from `root`. Empty sections are dropped; consecutive duplicates are merged. */
export function extractSections(root: Element | null | undefined): ReadSection[] {
  if (!root) return [];
  const sections: ReadSection[] = [];
  let cur: ReadSection = { heading: "", text: "" };
  let parts: string[] = [];
  let line = "";

  const flushLine = () => {
    const l = cleanSpokenText(line);
    line = "";
    if (!l) return;
    if (parts[parts.length - 1] === l) return;
    parts.push(/[.!?।:]$/.test(l) ? l : `${l}.`);
  };
  const flushSection = () => {
    flushLine();
    cur.text = parts.join(" ").trim();
    if (cur.text) sections.push(cur);
    parts = [];
  };

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      line += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag) || isHidden(el)) return;
    if (tag === "DETAILS" && !(el as HTMLDetailsElement).open) {
      const summary = el.querySelector("summary");
      if (summary) walk(summary);
      return;
    }

    const isHeading = HEADING.test(tag) || el.hasAttribute("data-read-section");
    if (isHeading) {
      flushSection();
      cur = { heading: "", text: "" };
    }
    const spoken = el.getAttribute("data-read");
    const ctl = controlText(el);
    const block = BLOCK_TAGS.has(tag) || isHeading;
    if (block) flushLine();

    if (spoken !== null) {
      line += ` ${spoken} `;
    } else if (ctl !== null) {
      line += ` ${ctl} `;
    } else if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      // empty control: nothing to say
    } else {
      for (const child of Array.from(el.childNodes)) walk(child);
    }

    if (CELL_TAGS.has(tag)) line += ", ";
    else if (block) flushLine();
    if (HEADING.test(tag)) {
      cur.heading = cleanSpokenText(el.textContent ?? "");
    }
  };

  walk(root);
  flushSection();

  // Merge a heading-only section into the next one, and drop exact repeats.
  const out: ReadSection[] = [];
  for (const s of sections) {
    const text = s.text.replace(/,\s*\./g, ".").replace(/\s+([,.])/g, "$1").replace(/,\s*,/g, ",");
    const prev = out[out.length - 1];
    if (prev && prev.text === text) continue;
    const headingOnly = prev && prev.heading && (prev.text === prev.heading || prev.text === `${prev.heading}.`);
    if (prev && headingOnly) {
      prev.text = `${prev.text} ${text}`;
      continue;
    }
    out.push({ heading: s.heading, text });
  }
  return out;
}
