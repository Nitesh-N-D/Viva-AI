/**
 * finance/financeLogic.ts — income / expense records and profit reports.
 * All amounts are entered by the farmer, in Indian rupees.
 */
import type { EntryKind, FinanceEntry } from "../../lib/localDb";
import { isIsoDate, toCsv } from "../../lib/localDb";

export const EXPENSE_CATEGORIES = ["seeds", "fertiliser", "pesticide", "labour", "machinery", "irrigation", "transport", "landRent", "loanInterest", "other"] as const;
export const INCOME_CATEGORIES = ["cropSale", "subsidy", "byproduct", "other"] as const;

export function categoriesFor(kind: EntryKind): readonly string[] {
  return kind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

export interface EntryInput {
  kind: EntryKind;
  category: string;
  amount: number;
  date: string;
  cropId?: string;
  quantity?: number;
  unit?: string;
  note?: string;
}

export const MAX_AMOUNT = 1_00_00_00_000; // ₹100 crore: anything larger is a typo

export function validateEntry(e: Partial<EntryInput>, today: string): string[] {
  const errs: string[] = [];
  if (e.kind !== "expense" && e.kind !== "income") errs.push("kind");
  if (!e.category || !categoriesFor(e.kind ?? "expense").includes(e.category)) errs.push("category");
  if (typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount <= 0) errs.push("amount");
  else if (e.amount > MAX_AMOUNT) errs.push("amountLarge");
  if (!isIsoDate(e.date)) errs.push("date");
  else if (e.date > today) errs.push("future");
  if (e.quantity !== undefined && (!Number.isFinite(e.quantity) || e.quantity < 0)) errs.push("quantity");
  if (e.note && e.note.length > 300) errs.push("note");
  return errs;
}

export interface Totals {
  income: number;
  expense: number;
  profit: number;
}

function totals(entries: readonly FinanceEntry[]): Totals {
  let income = 0;
  let expense = 0;
  for (const e of entries) {
    if (e.kind === "income") income += e.amount;
    else expense += e.amount;
  }
  // Round to paise to avoid float noise.
  income = Math.round(income * 100) / 100;
  expense = Math.round(expense * 100) / 100;
  return { income, expense, profit: Math.round((income - expense) * 100) / 100 };
}

export interface FinanceReport {
  totals: Totals;
  byMonth: { month: string; totals: Totals }[]; // yyyy-mm, ascending
  byCrop: { cropId: string | null; totals: Totals }[];
  byCategory: { kind: EntryKind; category: string; amount: number }[];
}

export function filterEntries(entries: readonly FinanceEntry[], f: { from?: string; to?: string; cropId?: string | null }): FinanceEntry[] {
  return entries.filter(
    (e) => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to) && (f.cropId === undefined || (f.cropId === null ? !e.cropId : e.cropId === f.cropId))
  );
}

export function buildReport(entries: readonly FinanceEntry[]): FinanceReport {
  const months = new Map<string, FinanceEntry[]>();
  const crops = new Map<string | null, FinanceEntry[]>();
  const cats = new Map<string, { kind: EntryKind; category: string; amount: number }>();
  for (const e of entries) {
    const m = e.date.slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), e]);
    const c = e.cropId ?? null;
    crops.set(c, [...(crops.get(c) ?? []), e]);
    const key = `${e.kind}|${e.category}`;
    const cur = cats.get(key) ?? { kind: e.kind, category: e.category, amount: 0 };
    cur.amount = Math.round((cur.amount + e.amount) * 100) / 100;
    cats.set(key, cur);
  }
  return {
    totals: totals(entries),
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, es]) => ({ month, totals: totals(es) })),
    byCrop: [...crops.entries()].map(([cropId, es]) => ({ cropId, totals: totals(es) })).sort((a, b) => b.totals.profit - a.totals.profit),
    byCategory: [...cats.values()].sort((a, b) => b.amount - a.amount),
  };
}

export function entriesToCsv(entries: readonly FinanceEntry[], label: { kind: (k: EntryKind) => string; category: (k: EntryKind, c: string) => string; crop: (id?: string) => string }, headers: string[]): string {
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => [e.date, label.kind(e.kind), label.category(e.kind, e.category), label.crop(e.cropId), e.kind === "income" ? e.amount : -e.amount, e.quantity, e.unit, e.note]);
  return toCsv([headers, ...rows]);
}
