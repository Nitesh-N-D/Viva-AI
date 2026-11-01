import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMODITIES, arrivalAgeDays, getMandiPrices, normaliseDate, parseMandiResponse, summariseMandi } from "../lib/mandi";

const rec = (o: Record<string, unknown>) => ({
  state: "Tamil Nadu",
  district: "Madurai",
  market: "Madurai",
  commodity: "Tomato",
  variety: "Local",
  arrival_date: "30/10/2026",
  min_price: "800",
  max_price: "1200",
  modal_price: "1000",
  ...o,
});
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const commodity = COMMODITIES[0];

describe("mandi parsing", () => {
  it("normalises dates and parses numbers", () => {
    expect(normaliseDate("1/2/2026")).toBe("2026-02-01");
    expect(normaliseDate("2026-02-01")).toBe("2026-02-01");
    const [r] = parseMandiResponse({ records: [rec({})] });
    expect(r).toMatchObject({ modalPrice: 1000, minPrice: 800, maxPrice: 1200, arrivalDate: "2026-10-30" });
  });

  it("skips records without a modal price and rejects malformed bodies", () => {
    expect(parseMandiResponse({ records: [rec({ modal_price: "" }), rec({ modal_price: "NA" }), null] })).toEqual([]);
    expect(() => parseMandiResponse({ message: "error" })).toThrow();
    expect(() => parseMandiResponse(null)).toThrow();
  });

  it("summarises highest, lowest and median", () => {
    const rs = parseMandiResponse({
      records: [rec({ market: "A", modal_price: 900 }), rec({ market: "B", modal_price: 1500 }), rec({ market: "C", modal_price: 1100 })],
    });
    const s = summariseMandi(rs)!;
    expect(s.highest.market).toBe("B");
    expect(s.lowest.market).toBe("A");
    expect(s.median).toBe(1100);
    expect(s.markets).toBe(3);
    expect(summariseMandi([])).toBeNull();
  });

  it("computes arrival age", () => {
    expect(arrivalAgeDays("2026-10-25", new Date(2026, 9, 31))).toBe(6);
    expect(arrivalAgeDays("garbage")).toBeNull();
  });
});

describe("getMandiPrices", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_AGMARKNET_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns live data and serves it from cache, labelled cached", async () => {
    const r = await getMandiPrices(commodity, null, { fetcher: () => ok({ records: [rec({})] }) });
    expect(r.status).toBe("live");
    expect(r.records).toHaveLength(1);
    const again = await getMandiPrices(commodity, null, { fetcher: () => Promise.reject(new Error("should not fetch")) });
    expect(again.status).toBe("cached");
  });

  it("returns empty live data honestly", async () => {
    const r = await getMandiPrices(commodity, "Madurai", { fetcher: () => ok({ records: [] }) });
    expect(r).toMatchObject({ status: "live", records: [] });
  });

  it("is unavailable on network failure or timeout with no cache", async () => {
    const r = await getMandiPrices(commodity, null, { fetcher: () => Promise.reject(new DOMException("timed out", "AbortError")) });
    expect(r).toMatchObject({ status: "unavailable", failure: "network", records: [] });
  });

  it("falls back to the stale cache, labelled cached, on HTTP error", async () => {
    await getMandiPrices(commodity, null, { fetcher: () => ok({ records: [rec({})] }) });
    const r = await getMandiPrices(commodity, null, { force: true, fetcher: () => Promise.resolve(new Response("x", { status: 503 })) });
    expect(r).toMatchObject({ status: "cached", failure: "http" });
    expect(r.records).toHaveLength(1);
  });

  it("flags malformed responses", async () => {
    const r = await getMandiPrices(commodity, null, { fetcher: () => Promise.resolve(new Response("not json", { status: 200 })) });
    expect(r).toMatchObject({ status: "unavailable", failure: "malformed" });
  });

  it("never fetches without an API key", async () => {
    vi.stubEnv("VITE_AGMARKNET_API_KEY", "");
    const fetcher = vi.fn();
    const r = await getMandiPrices(commodity, null, { fetcher });
    expect(r).toMatchObject({ status: "unavailable", failure: "no_key" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
