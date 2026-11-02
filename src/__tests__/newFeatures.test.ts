import { describe, expect, it, vi } from "vitest";
import { bucketFor, dueReminders, generateTasks, groupTasks, validateTaskInput } from "../modules/planner/plannerLogic";
import { buildReport, entriesToCsv, filterEntries, validateEntry } from "../modules/finance/financeLogic";
import {
  effectiveRain,
  estimateIrrigation,
  extraterrestrialRadiation,
  hargreavesEt0,
  kcFor,
  soilAdvice,
  validateIrrigationInput,
} from "../modules/irrigation/irrigationLogic";
import { evaluateAlerts, latestByMarket, needsRecheck, observationsFrom, validateWatch, RECHECK_MS } from "../modules/watchlist/watchlistLogic";
import { AppError, classifyError, isRetryable, kindFromStatus, recoveryFor } from "../lib/errors";
import { cleanAnswer, geminiModels, handleAiProxy, interpretGemini, validateAiRequest, DEFAULT_MODELS } from "../server/aiProxy";
import type { FarmPlan, FarmTask, FinanceEntry, WatchItem } from "../lib/localDb";
import type { MandiRecord } from "../lib/mandi";

/* ------------------------------ Planner ------------------------------ */

const plan: FarmPlan = { id: "p1", cropId: "tomato", label: "Tomato", sowingDate: "2026-11-10", createdAt: 0 };
let n = 0;
const ids = (p: string) => `${p}-${++n}`;

describe("planner", () => {
  it("generates a sorted calendar anchored on the sowing date", () => {
    const tasks = generateTasks(plan, { id: ids, now: 1 });
    expect(tasks.length).toBeGreaterThan(10);
    const dates = tasks.map((t) => t.dueDate);
    expect([...dates].sort()).toEqual(dates);
    const sowing = tasks.find((t) => t.titleKey === "planner.tasks.sowing");
    expect(sowing?.dueDate).toBe("2026-11-10");
    // Nursery is crop-specific: tomato yes, groundnut no.
    expect(tasks.some((t) => t.titleKey === "planner.tasks.nursery")).toBe(true);
    const gn = generateTasks({ ...plan, cropId: "groundnut" }, { id: ids });
    expect(gn.some((t) => t.titleKey === "planner.tasks.nursery")).toBe(false);
    // Harvest is the last field operation and comes after sowing.
    const harvest = tasks.find((t) => t.titleKey === "planner.tasks.harvest")!;
    expect(harvest.dueDate > "2026-11-10").toBe(true);
    expect(tasks.every((t) => t.planId === "p1" && !t.done)).toBe(true);
  });

  it("returns nothing for an unknown crop", () => {
    expect(generateTasks({ ...plan, cropId: "nope" })).toEqual([]);
  });

  it("buckets tasks by due date", () => {
    const t = (dueDate: string, done = false): FarmTask => ({ id: dueDate, planId: null, title: "x", category: "other", dueDate, done, remind: true, createdAt: 0 });
    expect(bucketFor(t("2026-11-01"), "2026-11-02")).toBe("overdue");
    expect(bucketFor(t("2026-11-02"), "2026-11-02")).toBe("today");
    expect(bucketFor(t("2026-11-09"), "2026-11-02")).toBe("week");
    expect(bucketFor(t("2026-11-10"), "2026-11-02")).toBe("later");
    expect(bucketFor(t("2026-11-01", true), "2026-11-02")).toBe("done");
    const g = groupTasks([t("2026-11-05"), t("2026-11-03")], "2026-11-02");
    expect(g.week.map((x) => x.dueDate)).toEqual(["2026-11-03", "2026-11-05"]);
  });

  it("raises a reminder once per day for due tasks only", () => {
    const now = new Date(2026, 10, 2, 9).getTime();
    const base: FarmTask = { id: "a", planId: null, title: "x", category: "other", dueDate: "2026-11-02", done: false, remind: true, createdAt: 0 };
    expect(dueReminders([base], "2026-11-02", now)).toHaveLength(1);
    expect(dueReminders([{ ...base, remindedAt: now - 1000 }], "2026-11-02", now)).toHaveLength(0);
    expect(dueReminders([{ ...base, remind: false }], "2026-11-02", now)).toHaveLength(0);
    expect(dueReminders([{ ...base, dueDate: "2026-11-03" }], "2026-11-02", now)).toHaveLength(0);
  });

  it("validates manual tasks", () => {
    expect(validateTaskInput({ title: "Weed", dueDate: "2026-11-02" })).toEqual([]);
    expect(validateTaskInput({ title: "  ", dueDate: "x" })).toEqual(["title", "date"]);
    expect(validateTaskInput({ title: "a".repeat(121), dueDate: "2026-11-02" })).toEqual(["titleLong"]);
  });
});

/* ------------------------------ Finance ------------------------------ */

const fe = (o: Partial<FinanceEntry>): FinanceEntry => ({ id: Math.random().toString(), kind: "expense", category: "seeds", amount: 100, date: "2026-10-01", createdAt: 0, ...o });

describe("finance", () => {
  it("validates entries", () => {
    expect(validateEntry({ kind: "expense", category: "seeds", amount: 500, date: "2026-11-01" }, "2026-11-02")).toEqual([]);
    expect(validateEntry({ kind: "expense", category: "cropSale", amount: 0, date: "2026-12-01" }, "2026-11-02")).toEqual(["category", "amount", "future"]);
    expect(validateEntry({ kind: "income", category: "cropSale", amount: 2e9, date: "bad" }, "2026-11-02")).toEqual(["amountLarge", "date"]);
  });

  it("computes totals, profit and breakdowns without float noise", () => {
    const entries = [
      fe({ amount: 0.1, category: "seeds", cropId: "tomato" }),
      fe({ amount: 0.2, category: "labour", cropId: "tomato" }),
      fe({ kind: "income", category: "cropSale", amount: 1000, date: "2026-11-01", cropId: "tomato" }),
      fe({ amount: 300, category: "transport", date: "2026-11-01" }),
    ];
    const r = buildReport(entries);
    expect(r.totals).toEqual({ income: 1000, expense: 300.3, profit: 699.7 });
    expect(r.byMonth.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(r.byMonth[0].totals.expense).toBe(0.3);
    const tomato = r.byCrop.find((c) => c.cropId === "tomato")!;
    expect(tomato.totals.profit).toBe(999.7);
    expect(r.byCrop.find((c) => c.cropId === null)!.totals.profit).toBe(-300);
    expect(r.byCategory[0]).toEqual({ kind: "income", category: "cropSale", amount: 1000 });
  });

  it("reports a loss honestly and an empty report as zero", () => {
    expect(buildReport([fe({ amount: 50 })]).totals.profit).toBe(-50);
    expect(buildReport([]).totals).toEqual({ income: 0, expense: 0, profit: 0 });
  });

  it("filters by date range and crop", () => {
    const entries = [fe({ date: "2026-09-30" }), fe({ date: "2026-10-15", cropId: "paddy" }), fe({ date: "2026-10-20" })];
    expect(filterEntries(entries, { from: "2026-10-01", to: "2026-10-31" })).toHaveLength(2);
    expect(filterEntries(entries, { cropId: "paddy" })).toHaveLength(1);
    expect(filterEntries(entries, { cropId: null })).toHaveLength(2);
  });

  it("exports CSV with signed amounts in date order", () => {
    const csv = entriesToCsv(
      [fe({ kind: "income", category: "cropSale", amount: 900, date: "2026-11-01" }), fe({ amount: 200, date: "2026-10-01", note: 'a,"b"' })],
      { kind: (k) => k, category: (_k, c) => c, crop: (id) => id ?? "" },
      ["date", "kind", "category", "crop", "amount", "qty", "unit", "note"]
    );
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain("date");
    expect(lines[1]).toContain("2026-10-01");
    expect(lines[1]).toContain("-200");
    expect(lines[1]).toContain('"a,""b"""');
    expect(lines[2]).toContain("900");
  });
});

/* ----------------------------- Irrigation ---------------------------- */

describe("irrigation", () => {
  it("matches FAO-56 worked values for Ra and Hargreaves ET0", () => {
    // FAO-56 example 8: 20°S on 3 September -> Ra ≈ 32.2 MJ m-2 d-1.
    expect(extraterrestrialRadiation(-20, "2026-09-03")).toBeCloseTo(32.2, 0);
    const et0 = hargreavesEt0(34, 24, 11, "2026-04-15");
    expect(et0).toBeGreaterThan(4);
    expect(et0).toBeLessThan(7);
    expect(hargreavesEt0(20, 25, 11, "2026-04-15")).toBe(0); // inverted range clamps
  });

  it("uses FAO-56 crop coefficients and the effective-rain rule", () => {
    expect(kcFor("tomato", "establishment")).toBe(0.6);
    expect(kcFor("tomato", "flowering")).toBe(1.15);
    expect(kcFor("tomato", "vegetative")).toBe(0.88);
    expect(effectiveRain(4)).toBe(0);
    expect(effectiveRain(10)).toBe(8);
  });

  it("estimates gross water from ETc, rain and method efficiency", () => {
    const days = [
      { date: "2026-04-15", maxC: 36, minC: 25, rainMm: 0 },
      { date: "2026-04-16", maxC: 30, minC: 24, rainMm: 60 },
    ];
    const drip = estimateIrrigation({ cropId: "tomato", daysSinceSowing: 60, areaAcres: 1, method: "drip", latDeg: 12, days })!;
    const flood = estimateIrrigation({ cropId: "tomato", daysSinceSowing: 60, areaAcres: 1, method: "surface", latDeg: 12, days })!;
    expect(drip.days[1].netMm).toBe(0); // heavy rain covers the day
    expect(drip.rainCoveredDays).toBe(1);
    expect(drip.warnings).toContain("heavy_rain");
    expect(flood.totalLitres).toBeGreaterThan(drip.totalLitres);
    // 1 mm over an acre ≈ 4047 L
    // (grossMm is displayed rounded to 0.1 mm; litres use the unrounded value)
    expect(Math.abs(drip.days[0].litres - drip.days[0].grossMm * 4046.86)).toBeLessThanOrEqual(0.05 * 4046.86 + 1);
    expect(drip.latitudeAssumed).toBe(false);
    const noLat = estimateIrrigation({ cropId: "tomato", daysSinceSowing: 60, areaAcres: 1, method: "drip", latDeg: null, days: [] })!;
    expect(noLat.latitudeAssumed).toBe(true);
    expect(noLat.warnings).toContain("no_days");
  });

  it("validates inputs and gives qualitative soil advice", () => {
    expect(validateIrrigationInput({ cropId: "tomato", daysSinceSowing: 10, areaAcres: 2, days: [] })).toEqual([]);
    expect(validateIrrigationInput({ cropId: "x", daysSinceSowing: -1, areaAcres: 0, days: [{ date: "d", maxC: 20, minC: 30, rainMm: -1 }] })).toEqual([
      "crop",
      "days",
      "area",
      "temp",
      "rain",
    ]);
    expect(soilAdvice("red")).toBe("light_frequent");
    expect(soilAdvice("black")).toBe("heavy_less_often");
    expect(soilAdvice(null)).toBeNull();
  });
});

/* ------------------------------ Watchlist ---------------------------- */

const watch: WatchItem = { id: "w1", state: "Tamil Nadu", district: "Villupuram", market: "", commodity: "Tomato", targetAbove: 2000, changePct: 20, createdAt: 0 };
const rec = (market: string, arrivalDate: string, modalPrice: number, variety = "Local"): MandiRecord => ({
  state: "Tamil Nadu",
  district: "Villupuram",
  market,
  commodity: "Tomato",
  variety,
  grade: "FAQ",
  arrivalDate,
  minPrice: modalPrice - 100,
  maxPrice: modalPrice + 100,
  modalPrice,
});

describe("watchlist", () => {
  it("validates watch rules", () => {
    expect(validateWatch(watch)).toEqual([]);
    expect(validateWatch({ state: "TN", commodity: "Tomato" })).toEqual(["noRule"]);
    expect(validateWatch({ state: "TN", commodity: "Tomato", targetAbove: 100, targetBelow: 200 })).toEqual(["range"]);
    expect(validateWatch({ commodity: "", changePct: 0 })).toEqual(["state", "commodity", "changePct"]);
  });

  it("records one observation per market and date from real records only", () => {
    const obs = observationsFrom(watch, [rec("Villupuram", "2026-11-01", 1500), rec("Villupuram", "2026-11-01", 1700, "Hybrid"), rec("Tindivanam", "2026-11-01", 1200)], 5);
    expect(obs).toHaveLength(2);
    expect(obs.find((o) => o.market === "Villupuram")!.modal).toBe(1700);
    expect(observationsFrom({ ...watch, market: "tindivanam" }, [rec("Tindivanam", "2026-11-01", 1200), rec("Villupuram", "2026-11-01", 1)], 5)).toHaveLength(1);
    expect(observationsFrom(watch, [], 5)).toEqual([]);
  });

  it("raises target and change alerts with stable ids", () => {
    const obs = [
      ...observationsFrom(watch, [rec("Villupuram", "2026-10-31", 1500)], 1),
      ...observationsFrom(watch, [rec("Villupuram", "2026-11-01", 2100)], 2),
    ];
    const alerts = evaluateAlerts(watch, obs, 3);
    expect(alerts.map((a) => a.kind).sort()).toEqual(["above", "change"]);
    const change = alerts.find((a) => a.kind === "change")!;
    expect(change.previous).toBe(1500);
    expect(change.id).toBe("w1|change|Villupuram|2026-11-01");
    expect(evaluateAlerts(watch, obs, 99).map((a) => a.id)).toEqual(alerts.map((a) => a.id));
    // A single observation can never produce a "change" alert (no invented history).
    expect(evaluateAlerts({ ...watch, targetAbove: undefined }, obs.slice(1), 3)).toEqual([]);
    expect(latestByMarket(obs)[0].arrivalDate).toBe("2026-11-01");
  });

  it("re-checks only when the last check is stale", () => {
    expect(needsRecheck(watch, 0)).toBe(true);
    expect(needsRecheck({ ...watch, lastCheckedAt: 1000 }, 1000 + RECHECK_MS - 1)).toBe(false);
    expect(needsRecheck({ ...watch, lastCheckedAt: 1000 }, 1000 + RECHECK_MS + 1)).toBe(true);
  });
});

/* ------------------------------- Errors ------------------------------ */

describe("error classification", () => {
  it("maps HTTP statuses and proxy codes", () => {
    expect(kindFromStatus(400)).toBe("bad_request");
    expect(kindFromStatus(401)).toBe("session");
    expect(kindFromStatus(403)).toBe("forbidden");
    expect(kindFromStatus(404)).toBe("not_found");
    expect(kindFromStatus(408)).toBe("timeout");
    expect(kindFromStatus(429)).toBe("rate_limited");
    expect(kindFromStatus(429, "upstream_quota")).toBe("quota");
    expect(kindFromStatus(500)).toBe("server");
    expect(kindFromStatus(502)).toBe("server");
    expect(kindFromStatus(503)).toBe("unavailable");
    expect(kindFromStatus(504)).toBe("timeout");
    expect(kindFromStatus(503, "not_configured")).toBe("not_configured");
  });

  it("classifies thrown values", () => {
    expect(classifyError(new TypeError("Failed to fetch"), true).kind).toBe("network");
    expect(classifyError(new TypeError("Failed to fetch"), false).kind).toBe("offline");
    expect(classifyError(new DOMException("x", "AbortError"), true).kind).toBe("timeout");
    expect(classifyError(new SyntaxError("Unexpected token"), true).kind).toBe("invalid_response");
    expect(classifyError(new Error("FirebaseError: permission-denied"), true).kind).toBe("forbidden");
    expect(classifyError(new Error("auth/id-token-expired"), true).kind).toBe("session");
    const e = new AppError("quota");
    expect(classifyError(e, true)).toBe(e);
  });

  it("never retries auth or invalid input automatically", () => {
    expect(isRetryable("session")).toBe(false);
    expect(isRetryable("bad_request")).toBe(false);
    expect(isRetryable("forbidden")).toBe(false);
    expect(isRetryable("timeout")).toBe(true);
    expect(recoveryFor("session")).toBe("sign_in");
    expect(recoveryFor("quota")).toBe("wait");
    expect(recoveryFor("offline")).toBe("check_connection");
  });
});

/* ---------------------------- Gemini proxy --------------------------- */

const okBody = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
const res = (status: number, body: unknown) => ({ status, json: async () => body }) as unknown as Response;
const ask = (o: object = {}) => JSON.stringify({ task: "assistant", lang: "ta", question: "நெல் எப்போது விதைக்கலாம்?", ...o });

describe("AI proxy", () => {
  it("validates requests strictly", () => {
    expect(validateAiRequest({ task: "assistant", lang: "en", question: "hi" }).ok).toBe(true);
    expect(validateAiRequest({ task: "assistant", lang: "fr", question: "hi" }).ok).toBe(false);
    expect(validateAiRequest({ task: "assistant", lang: "en" }).ok).toBe(false);
    expect(validateAiRequest({ task: "soil_explain", lang: "en" }).ok).toBe(false); // needs context
    expect(validateAiRequest({ task: "assistant", lang: "en", question: "hi", apiKey: "x" }).ok).toBe(false);
    expect(validateAiRequest({ task: "assistant", lang: "en", question: "x".repeat(5000) }).ok).toBe(false);
  });

  it("returns not_configured without a key and never calls upstream", async () => {
    const fetch = vi.fn();
    const r = await handleAiProxy(ask(), "c", { apiKey: undefined, fetch });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the key in a header, not the URL, and returns the answer", async () => {
    const fetch = vi.fn(async () => res(200, okBody("பதில்")));
    const r = await handleAiProxy(ask(), "c", { apiKey: "SECRET", fetch, sleep: async () => {} });
    expect(r.status).toBe(200);
    expect((r.body as { text: string }).text).toBe("பதில்");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).not.toContain("SECRET");
    expect(init.headers["x-goog-api-key"]).toBe("SECRET");
    expect(init.body).toContain("Tamil");
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("does not retry auth failures", async () => {
    const fetch = vi.fn(async () => res(403, { error: { status: "PERMISSION_DENIED" } }));
    const r = await handleAiProxy(ask(), "c", { apiKey: "k", fetch, sleep: async () => {} });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.body).toEqual({ error: "upstream_auth" });
  });

  it("retries transient failures with backoff and falls back to the next model on quota", async () => {
    const sleeps: number[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(500, {}))
      .mockResolvedValueOnce(res(429, { error: { status: "RESOURCE_EXHAUSTED" } }))
      .mockResolvedValueOnce(res(200, okBody("ok")));
    const r = await handleAiProxy(ask(), "c", { apiKey: "k", fetch, models: ["m1", "m2"], sleep: async (ms) => void sleeps.push(ms) });
    expect(r.status).toBe(200);
    expect((r.body as { model: string }).model).toBe("m2");
    expect(sleeps).toEqual([500, 1000]);
  });

  it("maps blocked and empty answers, and rate-limits clients", async () => {
    expect(interpretGemini(200, { promptFeedback: { blockReason: "SAFETY" } }, "m")).toMatchObject({ ok: false, code: "blocked" });
    expect(interpretGemini(200, { candidates: [{ content: { parts: [{ text: "x", thought: true }] } }] }, "m")).toMatchObject({ ok: false, code: "malformed" });
    const r = await handleAiProxy(ask(), "c", { apiKey: "k", fetch: vi.fn(), limiter: { take: () => false } });
    expect(r.status).toBe(429);
    expect(r.headers["retry-after"]).toBe("60");
  });

  it("falls back to the next model on an upstream 400, and stops after the last model", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(res(400, {})).mockResolvedValueOnce(res(200, okBody("ok")));
    const r = await handleAiProxy(ask(), "c", { apiKey: "k", fetch, models: ["m1", "m2"], sleep: async () => {} });
    expect(r.status).toBe(200);
    expect((r.body as { model: string }).model).toBe("m2");
    const always400 = vi.fn(async () => res(400, {}));
    const r2 = await handleAiProxy(ask(), "c", { apiKey: "k", fetch: always400, models: ["m1", "m2"], sleep: async () => {} });
    expect(always400).toHaveBeenCalledTimes(2);
    expect(r2.status).toBe(400);
    expect(r2.body).toMatchObject({ error: "bad_request" });
  });

  it("strips echoed or invented <app_data> blocks from answers", () => {
    expect(cleanAnswer("<app_data>\nModel prediction: Blight\nConfidence: 60%\n</app_data>\n\nSuggestion: remove infected leaves.")).toBe(
      "Suggestion: remove infected leaves."
    );
    expect(cleanAnswer("Answer first.\n<app_data>unterminated")).toBe("Answer first.");
    expect(cleanAnswer("plain answer")).toBe("plain answer");
    const only = interpretGemini(200, { candidates: [{ content: { parts: [{ text: "<app_data>x</app_data>" }] } }] }, "m");
    expect(only).toMatchObject({ ok: false, code: "malformed" });
  });

  it("puts a configured model first", () => {
    expect(geminiModels({})).toEqual(DEFAULT_MODELS);
    expect(geminiModels({ GEMINI_MODEL: "custom" })[0]).toBe("custom");
  });
});
