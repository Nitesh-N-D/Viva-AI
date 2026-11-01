/**
 * Tiny hash router. Hash routing works on Firebase Hosting, Vercel and a
 * plain static server without rewrite rules, and survives offline reloads
 * of the PWA shell.
 */
import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "soil" }
  | { name: "disease" }
  | { name: "guidance"; id: string | null }
  | { name: "crops"; soil: string | null }
  | { name: "farm" }
  | { name: "market" }
  | { name: "map" }
  | { name: "maker" }
  | { name: "settings" };

export type RouteName = Route["name"];

const SIMPLE: readonly RouteName[] = ["home", "soil", "disease", "farm", "market", "map", "maker", "settings"];
const ID_RE = /^[a-z0-9_]{1,64}$/;

/** Parses "#/crops?soil=red" style hashes. Unknown hashes fall back to home. */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, queryString = ""] = raw.split("?", 2);
  const [head, ...rest] = path.split("/").filter(Boolean);
  const params = new URLSearchParams(queryString);
  if (!head) return { name: "home" };
  if (head === "guidance") {
    const id = rest[0] && ID_RE.test(rest[0]) ? rest[0] : null;
    return { name: "guidance", id };
  }
  if (head === "crops") {
    const soil = params.get("soil");
    return { name: "crops", soil: soil && ID_RE.test(soil) ? soil : null };
  }
  if ((SIMPLE as readonly string[]).includes(head)) return { name: head as Exclude<RouteName, "guidance" | "crops"> } as Route;
  return { name: "home" };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "guidance":
      return route.id ? `#/guidance/${route.id}` : "#/guidance";
    case "crops":
      return route.soil ? `#/crops?soil=${encodeURIComponent(route.soil)}` : "#/crops";
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  const hash = routeToHash(route);
  if (window.location.hash !== hash) window.location.hash = hash;
  window.scrollTo?.({ top: 0 });
}

export function goBack(fallback: Route = { name: "home" }): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
