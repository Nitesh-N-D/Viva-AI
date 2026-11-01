import { describe, expect, it } from "vitest";
import { parseRoute, routeToHash, type Route } from "../app/router";

describe("hash router", () => {
  it("parses simple routes and falls back to home", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/market")).toEqual({ name: "market" });
    expect(parseRoute("#/nonsense")).toEqual({ name: "home" });
  });

  it("parses parameters and rejects unsafe ids", () => {
    expect(parseRoute("#/crops?soil=red")).toEqual({ name: "crops", soil: "red" });
    expect(parseRoute("#/crops?soil=%3Cscript%3E")).toEqual({ name: "crops", soil: null });
    expect(parseRoute("#/guidance/tomato_late_blight")).toEqual({ name: "guidance", id: "tomato_late_blight" });
    expect(parseRoute("#/guidance/..")).toEqual({ name: "guidance", id: null });
  });

  it("round-trips every route", () => {
    const routes: Route[] = [
      { name: "home" },
      { name: "soil" },
      { name: "disease" },
      { name: "guidance", id: null },
      { name: "guidance", id: "tomato_healthy" },
      { name: "crops", soil: null },
      { name: "crops", soil: "black" },
      { name: "farm" },
      { name: "market" },
      { name: "map" },
      { name: "maker" },
      { name: "settings" },
    ];
    for (const r of routes) expect(parseRoute(routeToHash(r))).toEqual(r);
  });
});
