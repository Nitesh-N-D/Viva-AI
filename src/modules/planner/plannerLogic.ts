/**
 * planner/plannerLogic.ts — crop calendar generation and task queries.
 *
 * Stage timing comes from the TNAU crop durations and stage fractions in
 * modules/farm/data/crops.json. The generated tasks are general good-practice
 * reminders (when to weed, scout, irrigate at critical stages, plan the sale).
 * They deliberately contain NO fertiliser or pesticide doses: those depend on
 * a soil test and local extension advice.
 */
import { STAGES, cropById, stageStartDay, type Crop } from "../farm/cropEngine";
import { addDaysIso, daysBetweenIso, newId, type FarmPlan, type FarmTask, type TaskCategory } from "../../lib/localDb";

export interface TaskTemplate {
  key: string; // i18n key under planner.tasks.*
  category: TaskCategory;
  /** Day offset from sowing, resolved against the crop's stage boundaries. */
  day: (crop: Crop) => number;
  /** Only for these crops (default: all). */
  crops?: string[];
}

const stageDay = (id: string) => (crop: Crop) => {
  const s = STAGES.find((x) => x.id === id);
  return s ? stageStartDay(crop, s) : 0;
};
const between = (a: string, b: string, f: number) => (crop: Crop) => {
  const da = stageDay(a)(crop);
  const db = b === "end" ? crop.durationDays : stageDay(b)(crop);
  return Math.round(da + (db - da) * f);
};

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  { key: "soilTest", category: "land", day: () => -21 },
  { key: "landPrep", category: "land", day: () => -10 },
  { key: "nursery", category: "sowing", day: () => -25, crops: ["paddy", "tomato", "ragi"] },
  { key: "seedTreatment", category: "sowing", day: () => -1 },
  { key: "sowing", category: "sowing", day: () => 0 },
  { key: "gapFilling", category: "sowing", day: (c) => Math.max(7, Math.round(c.durationDays * 0.08)) },
  { key: "firstWeeding", category: "weeding", day: between("establishment", "vegetative", 0.9) },
  { key: "topDressing", category: "nutrient", day: between("vegetative", "flowering", 0.3) },
  { key: "secondWeeding", category: "weeding", day: between("vegetative", "flowering", 0.6) },
  { key: "scoutVegetative", category: "protection", day: between("vegetative", "flowering", 0.5) },
  { key: "irrigateFlowering", category: "irrigation", day: stageDay("flowering") },
  { key: "scoutFlowering", category: "protection", day: between("flowering", "filling", 0.3) },
  { key: "irrigateFilling", category: "irrigation", day: stageDay("filling") },
  { key: "scoutFilling", category: "protection", day: between("filling", "maturity", 0.4) },
  { key: "checkPrices", category: "market", day: (c) => c.durationDays - 10 },
  { key: "stopIrrigation", category: "irrigation", day: between("maturity", "end", 0.4) },
  { key: "harvest", category: "harvest", day: (c) => c.durationDays },
  { key: "recordSale", category: "market", day: (c) => c.durationDays + 3 },
];

/** Builds the calendar for a plan. Pure: ids and timestamps are injected for tests. */
export function generateTasks(plan: FarmPlan, opts: { id?: (p: string) => string; now?: number } = {}): FarmTask[] {
  const crop = cropById(plan.cropId);
  if (!crop) return [];
  const mkId = opts.id ?? newId;
  const now = opts.now ?? Date.now();
  return TASK_TEMPLATES.filter((t) => !t.crops || t.crops.includes(crop.id))
    .map((t) => ({
      id: mkId("task"),
      planId: plan.id,
      title: "",
      titleKey: `planner.tasks.${t.key}`,
      category: t.category,
      dueDate: addDaysIso(plan.sowingDate, t.day(crop)),
      done: false,
      remind: t.category !== "other",
      createdAt: now,
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type TaskBucket = "overdue" | "today" | "week" | "later" | "done";

export function bucketFor(task: FarmTask, today: string): TaskBucket {
  if (task.done) return "done";
  const d = daysBetweenIso(today, task.dueDate);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  return "later";
}

export function groupTasks(tasks: readonly FarmTask[], today: string): Record<TaskBucket, FarmTask[]> {
  const out: Record<TaskBucket, FarmTask[]> = { overdue: [], today: [], week: [], later: [], done: [] };
  for (const t of tasks) out[bucketFor(t, today)].push(t);
  for (const k of Object.keys(out) as TaskBucket[]) {
    out[k].sort((a, b) => (k === "done" ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : a.dueDate.localeCompare(b.dueDate)));
  }
  return out;
}

/** Tasks that should raise a reminder now: due today or overdue, not done, reminders on, not yet reminded today. */
export function dueReminders(tasks: readonly FarmTask[], today: string, now: number): FarmTask[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  return tasks.filter((t) => !t.done && t.remind && t.dueDate <= today && (t.remindedAt ?? 0) < startOfDay.getTime());
}

export function validateTaskInput(input: { title: string; dueDate: string }): string[] {
  const errs: string[] = [];
  if (!input.title.trim()) errs.push("title");
  if (input.title.length > 120) errs.push("titleLong");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) errs.push("date");
  return errs;
}
