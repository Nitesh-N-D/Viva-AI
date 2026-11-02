import React, { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { CROPS, CROP_SOURCE, cropById, cropName } from "../farm/cropEngine";
import { formatIsoDate } from "../../lib/format";
import { deletePlan, deleteTask, listPlans, listTasks, putTask, savePlanWithTasks, useDbQuery } from "../../lib/farmRepo";
import { downloadText, newId, toCsv, todayIso, type FarmPlan, type FarmTask, type TaskCategory } from "../../lib/localDb";
import { generateTasks, groupTasks, validateTaskInput, type TaskBucket } from "./plannerLogic";
import { notificationsSupported } from "./useTaskReminders";
import { useAppStore } from "../../app/store";
import { Screen } from "../../shared/ui/Screen";
import { Card } from "../../shared/ui/Card";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Badge, EmptyState, Notice, Skeleton } from "../../shared/ui/Feedback";
import { InputField, SelectField, TextAreaField } from "../../shared/ui/Field";
import { ErrorNotice } from "../../shared/ui/ErrorNotice";
import { AppError } from "../../lib/errors";
import { AiExplain } from "../../shared/ui/AiExplain";
import { toast } from "../../shared/ui/Toast";

const CATEGORIES: TaskCategory[] = ["land", "sowing", "irrigation", "nutrient", "weeding", "protection", "harvest", "market", "other"];
const CATEGORY_ICON: Record<TaskCategory, string> = {
  land: "🚜",
  sowing: "🌱",
  irrigation: "💧",
  nutrient: "🧪",
  weeding: "🌿",
  protection: "🔍",
  harvest: "🌾",
  market: "₹",
  other: "📌",
};
const BUCKETS: TaskBucket[] = ["overdue", "today", "week", "later", "done"];

export function taskTitle(task: FarmTask, t: (k: string) => string): string {
  return task.titleKey ? t(task.titleKey) : task.title;
}

function PlanForm({ onDone }: { onDone: () => void }) {
  const { t, lang } = useT();
  const activeCrop = useAppStore((s) => s.activeCrop);
  const [cropId, setCropId] = useState(activeCrop?.cropId ?? "");
  const [sowingDate, setSowingDate] = useState(activeCrop ? todayIso(new Date(activeCrop.plantedAt)) : todayIso());
  const [area, setArea] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: string[] = [];
    if (!cropById(cropId)) errs.push("crop");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sowingDate)) errs.push("date");
    const areaNum = area ? Number(area) : undefined;
    if (areaNum !== undefined && (!Number.isFinite(areaNum) || areaNum <= 0 || areaNum > 1000)) errs.push("area");
    setErrors(errs);
    if (errs.length) return;
    setSaving(true);
    try {
      const crop = cropById(cropId)!;
      const plan: FarmPlan = { id: newId("plan"), cropId, sowingDate, areaAcres: areaNum, label: label.trim() || cropName(crop, lang), createdAt: Date.now() };
      await savePlanWithTasks(plan, generateTasks(plan));
      toast.success(t("planner.planSaved"));
      onDone();
    } catch (err) {
      setErrors(["save"]);
      console.error("[planner] save failed", err instanceof Error ? err.message : err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <SelectField
        label={t("planner.crop")}
        value={cropId}
        onChange={(e) => setCropId(e.target.value)}
        placeholder={t("planner.chooseCrop")}
        options={CROPS.map((c) => ({ value: c.id, label: `${cropName(c, lang)} · ${t("planner.days", { n: c.durationDays })}` }))}
        error={errors.includes("crop") ? t("planner.errCrop") : null}
        required
      />
      <InputField
        label={t("planner.sowingDate")}
        type="date"
        value={sowingDate}
        onChange={(e) => setSowingDate(e.target.value)}
        hint={t("planner.sowingHint")}
        error={errors.includes("date") ? t("planner.errDate") : null}
        required
      />
      <InputField
        label={t("planner.area")}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.1"
        value={area}
        onChange={(e) => setArea(e.target.value)}
        suffix={t("planner.acres")}
        error={errors.includes("area") ? t("planner.errArea") : null}
      />
      <InputField label={t("planner.label")} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder={t("planner.labelPlaceholder")} />
      {errors.includes("save") && <ErrorNotice error={new AppError("storage")} />}
      <Button type="submit" disabled={saving} block>
        {saving ? t("common.saving") : t("planner.createPlan")}
      </Button>
      <p className="text-xs text-soil-500">{t("planner.generatedNote", { source: CROP_SOURCE.name })}</p>
    </form>
  );
}

function TaskForm({ task, plans, onDone }: { task: FarmTask | null; plans: FarmPlan[]; onDone: () => void }) {
  const { t } = useT();
  const [title, setTitle] = useState(task ? taskTitle(task, t) : "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? todayIso());
  const [category, setCategory] = useState<TaskCategory>(task?.category ?? "other");
  const [planId, setPlanId] = useState(task?.planId ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [remind, setRemind] = useState(task?.remind ?? true);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateTaskInput({ title, dueDate });
    setErrors(errs);
    if (errs.length) return;
    // Editing the title of a generated task turns it into the farmer's own text.
    const keepKey = task?.titleKey && title === taskTitle(task, t);
    const next: FarmTask = {
      ...(task ?? { id: newId("task"), done: false, createdAt: Date.now() }),
      title: keepKey ? "" : title.trim(),
      titleKey: keepKey ? task!.titleKey : undefined,
      dueDate,
      category,
      planId: planId || null,
      notes: notes.trim() || undefined,
      remind,
      remindedAt: task && task.dueDate !== dueDate ? undefined : task?.remindedAt,
    } as FarmTask;
    try {
      await putTask(next);
      toast.success(t("planner.taskSaved"));
      onDone();
    } catch {
      setErrors(["save"]);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <InputField
        label={t("planner.taskTitle")}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        error={errors.includes("title") ? t("planner.errTitle") : null}
        required
      />
      <InputField label={t("planner.dueDate")} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.includes("date") ? t("planner.errDate") : null} required />
      <SelectField label={t("planner.category")} value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)} options={CATEGORIES.map((c) => ({ value: c, label: t(`planner.cat.${c}`) }))} />
      {plans.length > 0 && (
        <SelectField
          label={t("planner.plan")}
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          placeholder={t("planner.noPlan")}
          options={plans.map((p) => ({ value: p.id, label: p.label }))}
        />
      )}
      <TextAreaField label={t("planner.notes")} value={notes} maxLength={500} rows={3} onChange={(e) => setNotes(e.target.value)} />
      <label className="flex items-center gap-2 min-h-[44px] text-sm">
        <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="w-5 h-5 accent-leaf-600" />
        {t("planner.remindMe")}
      </label>
      {errors.includes("save") && <ErrorNotice error={new AppError("storage")} />}
      <Button type="submit" block>
        {t("planner.saveTask")}
      </Button>
    </form>
  );
}

export function PlannerScreen() {
  const { t, lang } = useT();
  const plans = useDbQuery(listPlans, ["plans"], [] as FarmPlan[]);
  const tasks = useDbQuery(listTasks, ["tasks"], [] as FarmTask[]);
  const [planFilter, setPlanFilter] = useState("");
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editing, setEditing] = useState<FarmTask | null | "new">(null);
  const [confirmDelete, setConfirmDelete] = useState<FarmPlan | null>(null);
  const [perm, setPerm] = useState(() => (notificationsSupported() ? Notification.permission : "unsupported"));
  const today = todayIso();

  const visible = useMemo(() => tasks.data.filter((x) => !planFilter || x.planId === planFilter), [tasks.data, planFilter]);
  const groups = useMemo(() => groupTasks(visible, today), [visible, today]);
  const planById = useMemo(() => new Map(plans.data.map((p) => [p.id, p])), [plans.data]);
  const open = visible.filter((x) => !x.done).length;

  const toggle = async (task: FarmTask) => {
    try {
      await putTask({ ...task, done: !task.done, doneAt: !task.done ? Date.now() : undefined });
    } catch {
      toast.error(t("errors.storage"));
    }
  };

  const remove = async (task: FarmTask) => {
    if (!window.confirm(t("planner.confirmDeleteTask"))) return;
    try {
      await deleteTask(task.id);
    } catch {
      toast.error(t("errors.storage"));
    }
  };

  const askPermission = async () => {
    if (!notificationsSupported()) return;
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      setPerm(Notification.permission);
    }
  };

  const exportCsv = () => {
    const rows = [...tasks.data]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((x) => [x.dueDate, taskTitle(x, t), t(`planner.cat.${x.category}`), x.planId ? planById.get(x.planId)?.label ?? "" : "", x.done ? t("planner.doneYes") : t("planner.doneNo"), x.notes ?? ""]);
    downloadText(`viva-ai-tasks-${today}.csv`, toCsv([[t("planner.dueDate"), t("planner.taskTitle"), t("planner.category"), t("planner.plan"), t("planner.status"), t("planner.notes")], ...rows]));
  };

  const plannerContext = useMemo(() => {
    const lines = plans.data.slice(0, 3).map((p) => {
      const crop = cropById(p.cropId);
      return `Plan: ${crop?.en ?? p.cropId}, sown ${p.sowingDate}${p.areaAcres ? `, ${p.areaAcres} acres` : ""}`;
    });
    const next = groups.overdue.concat(groups.today, groups.week).slice(0, 8);
    if (next.length) lines.push(`Next tasks: ${next.map((x) => `${x.dueDate} ${x.titleKey ? t(x.titleKey) : x.title}`).join("; ")}`);
    lines.push(`Stage timing source: ${CROP_SOURCE.name}`);
    return lines.join("\n");
  }, [plans.data, groups, t]);

  return (
    <Screen
      title={t("planner.title")}
      subtitle={t("planner.subtitle")}
      wide
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")} icon="+">
            {t("planner.addTask")}
          </Button>
          <Button size="sm" onClick={() => setShowPlanForm(true)} icon="🗓️">
            {t("planner.newPlan")}
          </Button>
        </div>
      }
    >
      {Boolean(plans.error || tasks.error) && <ErrorNotice error={plans.error ?? tasks.error} onRetry={() => void Promise.all([plans.reload(), tasks.reload()])} />}

      {plans.data.length > 0 && (
        <Card title={t("planner.myPlans")}>
          <ul className="flex flex-col divide-y divide-soil-100">
            {plans.data.map((p) => {
              const crop = cropById(p.cropId);
              const pt = tasks.data.filter((x) => x.planId === p.id);
              const done = pt.filter((x) => x.done).length;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="flex-1 min-w-[12rem]">
                    <p className="font-semibold">{p.label}</p>
                    <p className="text-xs text-soil-600">
                      {crop ? cropName(crop, lang) : p.cropId} · {t("planner.sownOn", { date: formatIsoDate(p.sowingDate, lang) })}
                      {p.areaAcres ? ` · ${p.areaAcres} ${t("planner.acres")}` : ""}
                    </p>
                    <div className="mt-1 h-1.5 rounded-full bg-soil-100 overflow-hidden" aria-hidden="true">
                      <div className="h-full bg-leaf-500" style={{ width: `${pt.length ? (done / pt.length) * 100 : 0}%` }} />
                    </div>
                    <p className="text-[11px] text-soil-500 mt-0.5">{t("planner.progress", { done, total: pt.length })}</p>
                  </div>
                  <Button size="sm" variant={planFilter === p.id ? "primary" : "secondary"} onClick={() => setPlanFilter(planFilter === p.id ? "" : p.id)}>
                    {planFilter === p.id ? t("planner.showAll") : t("planner.showOnly")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(p)} aria-label={t("planner.deletePlan")}>
                    🗑
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {perm !== "granted" && perm !== "unsupported" && tasks.data.length > 0 && (
        <Notice tone="info" action={perm === "default" ? <Button size="sm" variant="secondary" onClick={() => void askPermission()}>{t("planner.enableReminders")}</Button> : undefined}>
          {perm === "denied" ? t("planner.remindersDenied") : t("planner.remindersInfo")}
        </Notice>
      )}

      {tasks.loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : tasks.data.length === 0 ? (
        <EmptyState icon="🗓️" title={t("planner.emptyTitle")} body={t("planner.emptyBody")} action={<Button onClick={() => setShowPlanForm(true)}>{t("planner.newPlan")}</Button>} />
      ) : (
        <>
          <p className="text-sm text-soil-600" aria-live="polite">
            {t("planner.openCount", { n: open })}
          </p>
          {BUCKETS.map((b) =>
            groups[b].length === 0 ? null : (
              <Card key={b} title={<span className="flex items-center gap-2">{t(`planner.bucket.${b}`)} <Badge tone={b === "overdue" ? "warning" : "neutral"}>{groups[b].length}</Badge></span>}>
                <ul className="flex flex-col divide-y divide-soil-100">
                  {(b === "later" || b === "done" ? groups[b].slice(0, 30) : groups[b]).map((task) => (
                    <li key={task.id} className="flex items-start gap-3 py-2">
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => void toggle(task)}
                        className="mt-1 w-6 h-6 shrink-0 accent-leaf-600"
                        aria-label={t(task.done ? "planner.markUndone" : "planner.markDone", { task: taskTitle(task, t) })}
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium ${task.done ? "line-through text-soil-500" : ""}`}>
                          <span aria-hidden="true" className="mr-1">
                            {CATEGORY_ICON[task.category]}
                          </span>
                          {taskTitle(task, t)}
                        </p>
                        <p className="text-xs text-soil-600">
                          {formatIsoDate(task.dueDate, lang)} · {t(`planner.cat.${task.category}`)}
                          {task.planId && planById.get(task.planId) ? ` · ${planById.get(task.planId)!.label}` : ""}
                          {task.remind && !task.done ? " · 🔔" : ""}
                        </p>
                        {task.notes && <p className="text-xs text-soil-700 mt-0.5 whitespace-pre-line">{task.notes}</p>}
                      </div>
                      <div className="flex shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(task)} aria-label={t("planner.edit")}>
                          ✎
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void remove(task)} aria-label={t("planner.delete")}>
                          🗑
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={exportCsv} icon="⬇">
              {t("planner.exportCsv")}
            </Button>
          </div>
          {plans.data.length > 0 && (
            <Card title={t("ai.sectionTitle")}>
              <AiExplain task="planner_explain" context={plannerContext} />
            </Card>
          )}
        </>
      )}

      <p className="text-xs text-soil-500">{t("planner.disclaimer")}</p>

      <Dialog open={showPlanForm} onClose={() => setShowPlanForm(false)} title={t("planner.newPlan")}>
        <PlanForm onDone={() => setShowPlanForm(false)} />
      </Dialog>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t("planner.addTask") : t("planner.editTask")}>
        {editing !== null && <TaskForm key={editing === "new" ? "new" : editing.id} task={editing === "new" ? null : editing} plans={plans.data} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title={t("planner.deletePlan")}>
        <p className="text-sm">{t("planner.confirmDeletePlan", { plan: confirmDelete?.label ?? "" })}</p>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (confirmDelete) {
                try {
                  await deletePlan(confirmDelete.id);
                  if (planFilter === confirmDelete.id) setPlanFilter("");
                } catch {
                  toast.error(t("errors.storage"));
                }
              }
              setConfirmDelete(null);
            }}
          >
            {t("planner.delete")}
          </Button>
        </div>
      </Dialog>
    </Screen>
  );
}
