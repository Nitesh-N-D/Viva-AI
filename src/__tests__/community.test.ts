import { describe, expect, it } from "vitest";
import { MAX_REVIEW_LENGTH, aggregateRatings, aggregateScans, buildRating, cleanReview, parseGeoTile, ratingDocId, toGeoTile, type RatingDoc } from "../lib/firebase";

const rating = (o: Partial<RatingDoc>): RatingDoc => ({
  targetType: "soilTile",
  targetId: "9.92_78.12",
  uid: "u1",
  stars: 4,
  review: "",
  status: "visible",
  createdAt: 1,
  updatedAt: 1,
  ...o,
});

describe("geo tiles", () => {
  it("rounds to ~1 km and parses back", () => {
    expect(toGeoTile(9.92512, 78.11987)).toBe("9.93,78.12");
    expect(parseGeoTile("9.93,78.12")).toEqual({ lat: 9.93, lng: 78.12 });
    expect(parseGeoTile("9.925,78.12")).toBeNull();
    expect(parseGeoTile("<b>")).toBeNull();
    expect(parseGeoTile("99.00,10.00")).toBeNull();
  });

  it("aggregates scans per tile with a dominant soil type", () => {
    const tiles = aggregateScans([
      { geoTile: "9.93,78.12", soilType: "red" },
      { geoTile: "9.93,78.12", soilType: "red" },
      { geoTile: "9.93,78.12", soilType: "black" },
      { geoTile: "11.00,77.00", soilType: "black" },
      { geoTile: "bad", soilType: "red" },
    ]);
    expect(tiles).toHaveLength(2);
    const t = tiles.find((x) => x.geoTile === "9.93,78.12")!;
    expect(t).toMatchObject({ scanCount: 3, dominantSoilType: "red", lat: 9.93 });
  });
});

describe("ratings", () => {
  it("cleans reviews: control chars, whitespace, length", () => {
    expect(cleanReview("  good\u0000soil\n\nhere ")).toBe("good soil here");
    expect(cleanReview("x".repeat(900))).toHaveLength(MAX_REVIEW_LENGTH);
  });

  it("builds a rating, keeps createdAt on update and rejects bad stars", () => {
    const input = { targetType: "soilTile" as const, targetId: "t", uid: "u", stars: 5, review: " ok " };
    const created = buildRating(input, null, 100);
    expect(created).toMatchObject({ createdAt: 100, updatedAt: 100, review: "ok", status: "visible" });
    expect(buildRating({ ...input, stars: 3 }, created, 200)).toMatchObject({ createdAt: 100, updatedAt: 200, stars: 3 });
    expect(() => buildRating({ ...input, stars: 0 }, null, 1)).toThrow();
    expect(() => buildRating({ ...input, stars: 4.5 }, null, 1)).toThrow();
  });

  it("one document per user per target", () => {
    expect(ratingDocId("soilTile", "9.93_78.12", "abc")).toBe("soilTile_9.93_78.12_abc");
  });

  it("aggregates visible, well-formed ratings only", () => {
    const m = aggregateRatings(
      [
        rating({ uid: "a", stars: 5, review: "great", updatedAt: 10 }),
        rating({ uid: "b", stars: 2, updatedAt: 30 }),
        rating({ uid: "c", stars: 1, status: "hidden" }),
        rating({ uid: "d", stars: 9 }),
        rating({ uid: "me", stars: 4, review: "mine", updatedAt: 20 }),
      ],
      "me"
    );
    const s = m.get("9.92_78.12")!;
    expect(s.count).toBe(3);
    expect(s.average).toBe(3.7);
    expect(s.latestUpdate).toBe(30);
    expect(s.mine?.uid).toBe("me");
    expect(s.reviews.map((r) => r.review)).toEqual(["mine", "great"]);
    expect(s.reviews[0].mine).toBe(true);
  });
});
