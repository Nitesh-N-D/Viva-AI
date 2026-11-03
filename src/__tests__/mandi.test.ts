import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRESH_MS,
  arrivalAgeDays,
  buildProxyUrl,
  dateOptions,
  filterMandiRecords,
  getMandiPrices,
  marketOptions,
  normaliseDate,
  parseMandiRecords,
  parseProxyBody,
  sortMandiRecords,
  summariseMandi,
  paginate,
  RESULTS_PAGE_SIZE,
  type Fetcher,
  type MandiRecord,
} from "../lib/mandi";
import {
  MANDI_MAX_RECORDS,
  MANDI_PAGE_SIZE,
  buildUpstreamUrl,
  reduceUpstreamBody,
  validateMandiParams,
  type MandiQuery,
} from "../lib/mandiQuery";
import { RateLimiter, TtlCache, handleMandiProxy, type ProxyDeps } from "../server/mandiProxy";
import { MANDI_COMMODITIES, MANDI_STATES, TN_MANDI_DISTRICTS, districtToApi, mandiDistrictName } from "../domain/mandiPlaces";
import en from "../i18n/en.json";
import ta from "../i18n/ta.json";

// Shape of real data.gov.in records (observed 2026-11-01), with test values.
const raw = (o: Record<string, unknown> = {}) => ({
  state: "Tamil Nadu",
  district: "Villupuram",
  market: "Market A",
  commodity: "Tomato",
  variety: "Deshi",
  grade: "Local",
  arrival_date: "01/11/2026",
  min_price: 1000,
  max_price: 1200,
  modal_price: 1100,
  ...o,
});

const proxyPage = (records: unknown[], total = records.length, offset = 0) =>
  new Response(JSON.stringify({ total, offset, limit: MANDI_PAGE_SIZE, updated: "2026-11-01T13:02:32Z", records }), { status: 200 });

const VILLUPURAM_TOMATO = { state: "Tamil Nadu", district: "Villupuram", commodity: "Tomato" };

describe("query building and validation", () => {
  it("builds the verified upstream filters for Tamil Nadu + Villupuram + Tomato", () => {
    const q: MandiQuery = { ...VILLUPURAM_TOMATO, limit: 500, offset: 0 };
    const url = new URL(buildUpstreamUrl(q, "SECRET"));
    expect(url.origin).toBe("https://api.data.gov.in");
    expect(url.pathname).toBe("/resource/9ef84268-d588-465a-a308-a864a43d0070");
    expect(url.searchParams.get("filters[state.keyword]")).toBe("Tamil Nadu");
    expect(url.searchParams.get("filters[district]")).toBe("Villupuram");
    expect(url.searchParams.get("filters[commodity]")).toBe("Tomato");
    expect(url.searchParams.get("filters[state]")).toBeNull();
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("limit")).toBe("500");
    expect(url.searchParams.get("offset")).toBe("0");
  });

  it("builds a key-free proxy URL for the browser", () => {
    const u = buildProxyUrl("/api-mandi", VILLUPURAM_TOMATO, 500);
    expect(u).toBe("/api-mandi/prices?state=Tamil+Nadu&commodity=Tomato&district=Villupuram&limit=500&offset=500");
    expect(u).not.toMatch(/api-key|data\.gov\.in/);
  });

  it("accepts real Agmarknet names and rejects bad input", () => {
    const ok = (s: string) => validateMandiParams(new URLSearchParams(s)).ok;
    expect(ok("state=Tamil+Nadu&commodity=Tomato&district=Villupuram")).toBe(true);
    expect(ok("state=Tamil+Nadu&commodity=Bhindi(Ladies+Finger)&market=Gingee(Uzhavar+Sandhai+)")).toBe(true);
    expect(ok("state=Tamil+Nadu&commodity=Elephant+Yam(Suran)/Amorphophallus")).toBe(true);
    expect(ok("commodity=Tomato")).toBe(false); // state required
    expect(ok("state=Tamil+Nadu")).toBe(false); // commodity required
    expect(ok("state=Tamil+Nadu&commodity=Tomato&url=https://evil.example")).toBe(false);
    expect(ok("state=Tamil+Nadu&commodity=Tomato&resource=abc")).toBe(false);
    expect(ok("state=Tamil+Nadu&commodity=<script>")).toBe(false);
    expect(ok("state=Tamil+Nadu&commodity=Tomato&district=a%26filters[x]=y")).toBe(false);
    expect(ok(`state=Tamil+Nadu&commodity=${"x".repeat(81)}`)).toBe(false);
    expect(ok("state=Tamil+Nadu&commodity=Tomato&limit=1001")).toBe(false);
    expect(ok("state=Tamil+Nadu&commodity=Tomato&limit=0")).toBe(false);
    expect(ok("state=Tamil+Nadu&commodity=Tomato&offset=-1")).toBe(false);
    expect(ok("state=Tamil+Nadu&commodity=Tomato&offset=99999")).toBe(false);
    expect(ok("state=Tamil+Nadu&state=Kerala&commodity=Tomato")).toBe(false);
  });
});

describe("mandi proxy handler", () => {
  const deps = (over: Partial<ProxyDeps> = {}): ProxyDeps => ({
    apiKey: "SECRET-KEY-123",
    fetch: vi.fn(async () => new Response(JSON.stringify({ total: 1, offset: "0", limit: "500", records: [raw()] }), { status: 200 })),
    sleep: async () => {},
    ...over,
  });
  const qs = new URLSearchParams("state=Tamil+Nadu&district=Villupuram&commodity=Tomato");

  it("returns only record fields and never the key or upstream URL", async () => {
    const d = deps({
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ total: 1, offset: "0", limit: "500", updated_date: "x", index_name: "y", records: [{ ...raw(), extra: 1 }] }), {
          status: 200,
        })
      ),
    });
    const r = await handleMandiProxy(qs, "c1", d);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r);
    expect(text).not.toContain("SECRET-KEY-123");
    expect(text).not.toContain("api.data.gov.in");
    expect((r.body as { records: Record<string, unknown>[] }).records[0]).not.toHaveProperty("extra");
    const calledUrl = (d.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?")).toBe(true);
  });

  it("rejects invalid input before calling upstream", async () => {
    const d = deps();
    const r = await handleMandiProxy(new URLSearchParams("state=Tamil+Nadu&commodity=Tomato&url=http://x"), "c", d);
    expect(r.status).toBe(400);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("reports not_configured without a key", async () => {
    const d = deps({ apiKey: undefined });
    const r = await handleMandiProxy(qs, "c", d);
    expect(r).toMatchObject({ status: 503, body: { error: "not_configured" } });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("maps upstream failures to stable codes without leaking error text", async () => {
    const run = (res: () => Promise<Response>) => handleMandiProxy(qs, "c", deps({ fetch: res }));
    expect((await run(async () => new Response('{"error":"Key not authorised"}', { status: 403 }))).body).toEqual({ error: "upstream_auth" });
    expect((await run(async () => new Response("", { status: 429 }))).body).toEqual({ error: "upstream_rate_limited" });
    expect((await run(async () => new Response("<html>", { status: 200 }))).body).toEqual({ error: "upstream_malformed" });
    expect((await run(async () => new Response('{"message":"x"}', { status: 200 }))).body).toEqual({ error: "upstream_malformed" });
    const net = await run(async () => {
      throw new Error("fetch failed for https://api.data.gov.in/?api-key=SECRET-KEY-123");
    });
    expect(net.status).toBe(502);
    expect(JSON.stringify(net)).not.toContain("SECRET");
  });

  it("retries Cloudflare 521/523 and network refusals, then returns the real data", async () => {
    const ok = () => new Response(JSON.stringify({ total: 1, offset: "0", limit: "500", records: [raw()] }), { status: 200 });
    const sleeps: number[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 521 }))
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(new Response("", { status: 523 }))
      .mockResolvedValueOnce(ok());
    const r = await handleMandiProxy(qs, "c", deps({ fetch, sleep: async (ms) => void sleeps.push(ms) }));
    expect(r.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([300, 600, 1200]);
  });

  it("gives up after the last attempt with the upstream status, and never retries auth or 429", async () => {
    const always523 = vi.fn(async () => new Response("", { status: 523 }));
    const r = await handleMandiProxy(qs, "c", deps({ fetch: always523 }));
    expect(always523).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ status: 502, body: { error: "upstream_error", detail: "upstream status 523" } });
    const auth = vi.fn(async () => new Response("", { status: 403 }));
    expect((await handleMandiProxy(qs, "c", deps({ fetch: auth }))).body).toEqual({ error: "upstream_auth" });
    expect(auth).toHaveBeenCalledTimes(1);
    const limited = vi.fn(async () => new Response("", { status: 429 }));
    await handleMandiProxy(qs, "c", deps({ fetch: limited }));
    expect(limited).toHaveBeenCalledTimes(1);
  });

  it("does not start a retry that would overrun the time budget", async () => {
    let t = 0;
    const fetch = vi.fn(async () => {
      t += 14_800; // one slow refusal leaves less than the 300 ms backoff of the 15 s budget
      return new Response("", { status: 521 });
    });
    const r = await handleMandiProxy(qs, "c", deps({ fetch, now: () => t }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(502);
  });

  it("re-asks once after an empty 200 and never caches an empty answer", async () => {
    const empty = () => new Response(JSON.stringify({ total: 0, offset: "0", limit: "500", records: [] }), { status: 200 });
    const full = () => new Response(JSON.stringify({ total: 1, offset: "0", limit: "500", records: [raw()] }), { status: 200 });
    // Spurious empty page, then the real data.
    const flaky = vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(full());
    const cache = new TtlCache<never>(60_000);
    const r1 = await handleMandiProxy(qs, "c", deps({ fetch: flaky, cache: cache as never }));
    expect(flaky).toHaveBeenCalledTimes(2);
    expect((r1.body as { records: unknown[] }).records).toHaveLength(1);
    // Truly empty: still one re-ask only, answered with no-store and not cached.
    const alwaysEmpty = vi.fn(async () => empty());
    const c2 = new TtlCache<never>(60_000);
    const r2 = await handleMandiProxy(qs, "c", deps({ fetch: alwaysEmpty, cache: c2 as never }));
    expect(alwaysEmpty).toHaveBeenCalledTimes(2);
    expect(r2.status).toBe(200);
    expect(r2.headers["cache-control"]).toBe("no-store");
    await handleMandiProxy(qs, "c", deps({ fetch: alwaysEmpty, cache: c2 as never }));
    expect(alwaysEmpty).toHaveBeenCalledTimes(4);
  });

  it("times out a slow upstream", async () => {
    const slow: ProxyDeps["fetch"] = (_u, init) =>
      new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const r = await handleMandiProxy(qs, "c", deps({ fetch: slow, timeoutMs: 20 }));
    expect(r).toMatchObject({ status: 504, body: { error: "upstream_timeout" } });
  });

  it("caches per query and rate-limits per client", async () => {
    const d = deps({ cache: new TtlCache(60_000), limiter: new RateLimiter(2) });
    await handleMandiProxy(qs, "c", d);
    const hit = await handleMandiProxy(qs, "c", d);
    expect(hit.headers["x-viva-cache"]).toBe("hit");
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const other = (n: number) => new URLSearchParams(`state=Tamil+Nadu&commodity=Tomato&offset=${n}`);
    expect((await handleMandiProxy(other(1), "c", d)).status).toBe(200);
    expect((await handleMandiProxy(other(2), "c", d)).status).toBe(429);
    expect((await handleMandiProxy(other(2), "someone-else", d)).status).toBe(200);
  });

  it("reduces upstream bodies and rejects non-API shapes", () => {
    expect(reduceUpstreamBody({ total: 3, offset: "0", limit: "10", records: [raw()] })).toMatchObject({ total: 3, offset: 0, limit: 10 });
    expect(reduceUpstreamBody({ error: "x" })).toBeNull();
    expect(reduceUpstreamBody(null)).toBeNull();
  });
});

describe("parsing", () => {
  it("normalises dd/mm/yyyy dates", () => {
    expect(normaliseDate("01/11/2026")).toBe("2026-11-01");
    expect(normaliseDate("1/2/2026")).toBe("2026-02-01");
    expect(normaliseDate("2026-02-01")).toBe("2026-02-01");
  });

  it("parses numbers and strings, and skips missing or invalid modal prices", () => {
    const rs = parseMandiRecords([
      raw({ modal_price: "1500", min_price: "NA", max_price: 0 }),
      raw({ market: "B", modal_price: "" }),
      raw({ market: "C", modal_price: "NA" }),
      raw({ market: "D", modal_price: -5 }),
      null,
    ]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ modalPrice: 1500, minPrice: null, maxPrice: null, arrivalDate: "2026-11-01" });
  });

  it("removes duplicate records", () => {
    expect(parseMandiRecords([raw(), raw(), raw({ variety: "Hybrid" })])).toHaveLength(2);
  });

  it("rejects malformed proxy bodies", () => {
    expect(() => parseProxyBody({ records: [] })).toThrow();
    expect(() => parseProxyBody({ total: 1 })).toThrow();
    expect(() => parseProxyBody("x")).toThrow();
  });
});

describe("getMandiPrices", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches Tamil Nadu + Villupuram + Tomato through the proxy and labels it live", async () => {
    const urls: string[] = [];
    const fetcher: Fetcher = async (u) => {
      urls.push(u);
      return proxyPage([raw({ market: "Tindivanam RM" }), raw({ market: "Gingee(Uzhavar Sandhai )" }), raw({ market: "Villupuram(Uzhavar Sandhai )" })]);
    };
    const r = await getMandiPrices(VILLUPURAM_TOMATO, { fetcher, base: "/api-mandi" });
    expect(r).toMatchObject({ status: "live", total: 3, pages: 1, truncated: false, sourceUpdated: "2026-11-01T13:02:32Z" });
    expect(r.records.map((x) => x.market).sort()).toEqual(["Gingee(Uzhavar Sandhai )", "Tindivanam RM", "Villupuram(Uzhavar Sandhai )"]);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0], "http://x").searchParams.get("district")).toBe("Villupuram");
  });

  it("pages until total is reached and de-duplicates", async () => {
    const total = MANDI_PAGE_SIZE * 2 + 7;
    const offsets: number[] = [];
    const fetcher: Fetcher = async (u) => {
      const off = Number(new URL(u, "http://x").searchParams.get("offset"));
      offsets.push(off);
      const n = Math.min(MANDI_PAGE_SIZE, total - off);
      const recs = Array.from({ length: n }, (_, i) => raw({ market: `M${off + i}` }));
      if (off > 0) recs[0] = raw({ market: `M${off - 1}` }); // an overlapping duplicate
      return proxyPage(recs, total, off);
    };
    const r = await getMandiPrices({ state: "Tamil Nadu", commodity: "Tomato" }, { fetcher, base: "/p" });
    expect(offsets).toEqual([0, MANDI_PAGE_SIZE, MANDI_PAGE_SIZE * 2]);
    expect(r.pages).toBe(3);
    expect(r.records).toHaveLength(total - 2);
    expect(r.truncated).toBe(false);
  });

  it("stops at the record cap and says it truncated", async () => {
    const fetcher: Fetcher = async (u) => {
      const off = Number(new URL(u, "http://x").searchParams.get("offset"));
      return proxyPage(Array.from({ length: MANDI_PAGE_SIZE }, (_, i) => raw({ market: `M${off + i}` })), 99_999, off);
    };
    const r = await getMandiPrices({ state: "Tamil Nadu", commodity: "Onion" }, { fetcher, base: "/p" });
    expect(r.pages).toBe(MANDI_MAX_RECORDS / MANDI_PAGE_SIZE);
    expect(r.records).toHaveLength(MANDI_MAX_RECORDS);
    expect(r.truncated).toBe(true);
  });

  it("stops on an empty page even if total claims more", async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      return proxyPage([], 50);
    };
    const r = await getMandiPrices({ state: "Tamil Nadu", commodity: "Maize" }, { fetcher, base: "/p" });
    expect(calls).toBe(1);
    expect(r).toMatchObject({ status: "live", records: [], truncated: true });
  });

  it("returns an honest empty live result for no matches", async () => {
    const r = await getMandiPrices({ state: "Tamil Nadu", district: "Chennai", commodity: "Tomato" }, { fetcher: async () => proxyPage([], 0), base: "/p" });
    expect(r).toMatchObject({ status: "live", records: [], total: 0, truncated: false });
    expect(r.failure).toBeUndefined();
  });

  it("serves a fresh cache labelled cached, and refetches after FRESH_MS", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-01T10:00:00Z") });
    const fetcher = vi.fn<Fetcher>(async () => proxyPage([raw()]));
    await getMandiPrices(VILLUPURAM_TOMATO, { fetcher, base: "/p" });
    const again = await getMandiPrices(VILLUPURAM_TOMATO, { fetcher, base: "/p" });
    expect(again.status).toBe("cached");
    expect(again.pages).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + FRESH_MS + 1);
    expect((await getMandiPrices(VILLUPURAM_TOMATO, { fetcher, base: "/p" })).status).toBe("live");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares one request between identical concurrent queries", async () => {
    const fetcher = vi.fn<Fetcher>(async () => proxyPage([raw()]));
    const [a, b] = await Promise.all([
      getMandiPrices(VILLUPURAM_TOMATO, { fetcher, base: "/p" }),
      getMandiPrices(VILLUPURAM_TOMATO, { fetcher, base: "/p" }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("retries a page once after a transient upstream timeout, but not after an auth failure", async () => {
    let calls = 0;
    const flaky = vi.fn<Fetcher>(async () =>
      ++calls === 1 ? new Response(JSON.stringify({ error: "upstream_timeout" }), { status: 504 }) : proxyPage([raw()])
    );
    const r = await getMandiPrices({ state: "Tamil Nadu", commodity: "RetryTomato" }, { fetcher: flaky, base: "/p" });
    expect(r.status).toBe("live");
    expect(flaky).toHaveBeenCalledTimes(2);
    const auth = vi.fn<Fetcher>(async () => new Response(JSON.stringify({ error: "upstream_auth" }), { status: 502 }));
    expect((await getMandiPrices({ state: "Tamil Nadu", commodity: "AuthTomato" }, { fetcher: auth, base: "/p" })).failure).toBe("auth");
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it("maps proxy failures and falls back to a labelled cache", async () => {
    const fail = (status: number, error?: string): Fetcher => async () => new Response(JSON.stringify(error ? { error } : {}), { status });
    const q = (n: number) => ({ state: "Tamil Nadu", commodity: `C${n}` });
    expect((await getMandiPrices(q(1), { fetcher: fail(502, "upstream_auth"), base: "/p" })).failure).toBe("auth");
    expect((await getMandiPrices(q(2), { fetcher: fail(429, "rate_limited"), base: "/p" })).failure).toBe("rate_limit");
    expect((await getMandiPrices(q(3), { fetcher: fail(504, "upstream_timeout"), base: "/p" })).failure).toBe("timeout");
    expect((await getMandiPrices(q(4), { fetcher: fail(503, "not_configured"), base: "/p" })).failure).toBe("no_proxy");
    expect((await getMandiPrices(q(5), { fetcher: fail(500), base: "/p" })).failure).toBe("http");
    const malformed = await getMandiPrices(q(6), { fetcher: async () => new Response("<html>", { status: 200 }), base: "/p" });
    expect(malformed).toMatchObject({ status: "unavailable", failure: "malformed", records: [] });
    const timeout = await getMandiPrices(q(7), {
      fetcher: async () => {
        throw new Error("request timed out after 20000 ms");
      },
      base: "/p",
    });
    expect(timeout.failure).toBe("timeout");
    const offline = await getMandiPrices(q(8), {
      fetcher: async () => {
        throw new TypeError("Failed to fetch");
      },
      base: "/p",
    });
    expect(offline).toMatchObject({ status: "unavailable", failure: "network" });

    await getMandiPrices(VILLUPURAM_TOMATO, { fetcher: async () => proxyPage([raw()]), base: "/p" });
    const stale = await getMandiPrices(VILLUPURAM_TOMATO, { force: true, fetcher: fail(502, "upstream_error"), base: "/p" });
    expect(stale).toMatchObject({ status: "cached", failure: "http" });
    expect(stale.records).toHaveLength(1);
  });

  it("never fetches without a proxy and never shows invented data", async () => {
    const fetcher = vi.fn<Fetcher>();
    const r = await getMandiPrices(VILLUPURAM_TOMATO, { fetcher, base: null });
    expect(r).toMatchObject({ status: "unavailable", failure: "no_proxy", records: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("local filters, sorting and summary", () => {
  const recs: MandiRecord[] = parseMandiRecords([
    raw({ market: "Tindivanam RM", modal_price: 3000, arrival_date: "01/11/2026" }),
    raw({ market: "Gingee(Uzhavar Sandhai )", modal_price: 3200, arrival_date: "01/11/2026" }),
    raw({ market: "Villupuram(Uzhavar Sandhai )", modal_price: 3500, arrival_date: "31/10/2026", variety: "Hybrid" }),
    raw({ market: "Villupuram(Uzhavar Sandhai )", modal_price: 3400, arrival_date: "01/11/2026" }),
  ]);
  const none = { market: "", date: "", search: "" };

  it("filters by market, date and search text", () => {
    expect(filterMandiRecords(recs, { ...none, market: "Tindivanam RM" })).toHaveLength(1);
    expect(filterMandiRecords(recs, { ...none, date: "2026-10-31" })).toHaveLength(1);
    expect(filterMandiRecords(recs, { ...none, search: "uzhavar" })).toHaveLength(3);
    expect(filterMandiRecords(recs, { ...none, search: "hybrid" })).toHaveLength(1);
    expect(filterMandiRecords(recs, { ...none, search: "  " })).toHaveLength(4);
    expect(filterMandiRecords(recs, { market: "Tindivanam RM", date: "2026-10-31", search: "" })).toHaveLength(0);
  });

  it("lists markets and dates from the records", () => {
    expect(marketOptions(recs)).toEqual(["Gingee(Uzhavar Sandhai )", "Tindivanam RM", "Villupuram(Uzhavar Sandhai )"]);
    expect(dateOptions(recs)).toEqual(["2026-11-01", "2026-10-31"]);
  });

  it("sorts by date, price and market name", () => {
    expect(sortMandiRecords(recs, "high").map((r) => r.modalPrice)).toEqual([3500, 3400, 3200, 3000]);
    expect(sortMandiRecords(recs, "low").map((r) => r.modalPrice)).toEqual([3000, 3200, 3400, 3500]);
    expect(sortMandiRecords(recs, "date")[3].arrivalDate).toBe("2026-10-31");
    expect(sortMandiRecords(recs, "market")[0].market).toBe("Gingee(Uzhavar Sandhai )");
  });

  it("summarises only the records given", () => {
    const s = summariseMandi(recs)!;
    expect(s).toMatchObject({ median: 3300, markets: 3, latestDate: "2026-11-01" });
    expect(s.highest.modalPrice).toBe(3500);
    expect(s.lowest.market).toBe("Tindivanam RM");
    const one = summariseMandi(filterMandiRecords(recs, { ...none, market: "Tindivanam RM" }))!;
    expect(one).toMatchObject({ median: 3000, markets: 1 });
    expect(summariseMandi([])).toBeNull();
  });

  it("computes arrival age", () => {
    expect(arrivalAgeDays("2026-10-25", new Date(2026, 9, 31))).toBe(6);
    expect(arrivalAgeDays("garbage")).toBeNull();
  });
});

describe("places, commodities and translations", () => {
  it("maps app district names to Agmarknet spellings", () => {
    expect(districtToApi("Viluppuram")).toBe("Villupuram");
    expect(districtToApi("Kanniyakumari")).toBe("Kannyiakumari");
    expect(districtToApi("Madurai")).toBe("Madurai");
    expect(TN_MANDI_DISTRICTS.find((d) => d.api === "Villupuram")).toMatchObject({ en: "Villupuram", ta: "விழுப்புரம்" });
    expect(mandiDistrictName("Villupuram", "Tamil Nadu", "ta")).toBe("விழுப்புரம்");
    expect(mandiDistrictName("Pune", "Maharashtra", "ta")).toBe("Pune");
  });

  it("has unique ids and api names, with Tamil names", () => {
    for (const list of [MANDI_COMMODITIES, MANDI_STATES, TN_MANDI_DISTRICTS]) {
      expect(new Set(list.map((x) => x.api)).size).toBe(list.length);
      for (const x of list) expect(x.ta).toMatch(/[஀-௿]/);
    }
    expect(MANDI_COMMODITIES.find((c) => c.id === "tomato")).toMatchObject({ api: "Tomato", ta: "தக்காளி" });
  });

  it("translates every mandi string into Tamil", () => {
    const keys = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(ta.mandi).sort()).toEqual(keys(en.mandi).sort());
    expect(ta.mandi.district).toBe("மாவட்டம்");
    expect(ta.mandi.market).toBe("சந்தை");
    expect(ta.mandi.min).toBe("குறைந்தபட்ச விலை");
    expect(ta.mandi.max).toBe("அதிகபட்ச விலை");
    expect(ta.mandi.arrivalDate).toBe("வரத்து தேதி");
  });
});

describe("results pagination", () => {
  it("pages rows 20 at a time and clamps out-of-range pages", () => {
    const rows = Array.from({ length: 45 }, (_, i) => i);
    expect(RESULTS_PAGE_SIZE).toBe(20);
    expect(paginate(rows, 1)).toMatchObject({ page: 1, pages: 3, items: rows.slice(0, 20) });
    expect(paginate(rows, 3).items).toEqual(rows.slice(40));
    expect(paginate(rows, 99).page).toBe(3);
    expect(paginate(rows, 0).page).toBe(1);
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1 });
  });

  it("has pagination strings in English and Tamil", () => {
    for (const k of ["pageOf", "prevPage", "nextPage"]) {
      expect((en as any).mandi[k]).toBeTruthy();
      expect((ta as any).mandi[k]).toBeTruthy();
      expect((ta as any).mandi[k]).not.toBe((en as any).mandi[k]);
    }
  });
});
