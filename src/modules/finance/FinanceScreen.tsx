import React, { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { CROPS, cropById, cropName } from "../farm/cropEngine";
import { formatInr, formatIsoDate } from "../../lib/format";
import { deleteEntry, listEntries, putEntry, useDbQuery } from "../../lib/farmRepo";
import { downloadText, newId, todayIso, type EntryKind, type FinanceEntry } from "../../lib/localDb";
import { AppError } from "../../lib/errors";
import { buildReport, categoriesFor, entriesToCsv, filterEntries, validateEntry } from "./financeLogic";
import { Screen } from "../../shared/ui/Screen";
import { Card, Stat } from "../../shared/ui/Card";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { EmptyState, Skeleton } from "../../shared/ui/Feedback";
import { InputField, Segmented, SelectField, TextAreaField } from "../../shared/ui/Field";
import { ErrorNotice } from "../../shared/ui/ErrorNotice";
import { toast } from "../../shared/ui/Toast";

type Period = "all" | "month" | "year";

function EntryForm({ entry, onDone }: { entry: FinanceEntry | null; onDone: () => void }) {
  const { t, lang } = useT();
  const today = todayIso();
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? "expense");
  const [category, setCategory] = useState(entry?.category ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [date, setDate] = useState(entry?.date ?? today);
  const [cropId, setCropId] = useState(entry?.cropId ?? "");
  const [quantity, setQuantity] = useState(entry?.quantity !== undefined ? String(entry.quantity) : "");
  const [unit, setUnit] = useState(entry?.unit ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);

  const err = (k: string) => (errors.includes(k) ? t(`finance.err.${k}`) : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      kind,
      category,
      amount: amount.trim() === "" ? NaN : Number(amount),
      date,
      cropId: cropId || undefined,
      quantity: quantity.trim() === "" ? undefined : Number(quantity),
      unit: unit.trim() || undefined,
      note: note.trim() || undefined,
    };
    const errs = validateEntry(input, today);
    setErrors(errs);
    if (errs.length) return;
    try {
      await putEntry({ ...input, id: entry?.id ?? newId("fin"), createdAt: entry?.createdAt ?? Date.now() });
      toast.success(t("finance.saved"));
      onDone();
    } catch {
      setSaveError(new AppError("storage"));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Segmented
        label={t("finance.kind")}
        value={kind}
        onChange={(v) => {
          setKind(v);
          setCategory("");
        }}
        options={[
          { value: "expense", label: t("finance.expense") },
          { value: "income", label: t("finance.income") },
        ]}
      />
      <SelectField
        label={t("finance.category")}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder={t("finance.chooseCategory")}
        options={categoriesFor(kind).map((c) => ({ value: c, label: t(`finance.cat.${kind}.${c}`) }))}
        error={err("category")}
        required
      />
      <InputField
        label={t("finance.amount")}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        suffix="₹"
        error={err("amount") ?? err("amountLarge")}
        required
      />
      <InputField label={t("finance.date")} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} error={err("date") ?? err("future")} required />
      <SelectField
        label={t("finance.crop")}
        value={cropId}
        onChange={(e) => setCropId(e.target.value)}
        placeholder={t("finance.noCrop")}
        options={CROPS.map((c) => ({ value: c.id, label: cropName(c, lang) }))}
      />
      <div className="grid grid-cols-2 gap-2">
        <InputField label={t("finance.quantity")} type="number" inputMode="decimal" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} error={err("quantity")} />
        <InputField label={t("finance.unit")} value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} placeholder={t("finance.unitPlaceholder")} />
      </div>
      <TextAreaField label={t("finance.note")} value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} error={err("note")} />
      {saveError !== null && <ErrorNotice error={saveError} />}
      <Button type="submit" block>
        {t("finance.save")}
      </Button>
    </form>
  );
}

function MonthBars({ months }: { months: { month: string; totals: { income: number; expense: number } }[] }) {
  const { t, lang } = useT();
  const recent = months.slice(-6);
  const max = Math.max(1, ...recent.flatMap((m) => [m.totals.income, m.totals.expense]));
  return (
    <div>
      <div className="flex items-end gap-3 h-40 overflow-x-auto" role="img" aria-label={t("finance.chartLabel")}>
        {recent.map((m) => (
          <div key={m.month} className="flex flex-col items-center gap-1 min-w-[3.5rem] h-full justify-end">
            <div className="flex items-end gap-1 h-full">
              <div className="w-4 rounded-t bg-leaf-500" style={{ height: `${(m.totals.income / max) * 100}%` }} title={`${t("finance.income")} ${formatInr(m.totals.income, lang)}`} />
              <div className="w-4 rounded-t bg-ember-400" style={{ height: `${(m.totals.expense / max) * 100}%` }} title={`${t("finance.expense")} ${formatInr(m.totals.expense, lang)}`} />
            </div>
            <span className="text-[11px] text-soil-600">{formatIsoDate(`${m.month}-01`, lang).replace(/^\d+\s*/, "")}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-2 text-xs text-soil-600">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-leaf-500" aria-hidden="true" /> {t("finance.income")}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-ember-400" aria-hidden="true" /> {t("finance.expense")}
        </span>
      </div>
      {/* Screen-reader / print table with the exact figures behind the bars. */}
      <table className="sr-only print:not-sr-only">
        <caption>{t("finance.byMonth")}</caption>
        <thead>
          <tr>
            <th>{t("finance.month")}</th>
            <th>{t("finance.income")}</th>
            <th>{t("finance.expense")}</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((m) => (
            <tr key={m.month}>
              <td>{m.month}</td>
              <td>{formatInr(m.totals.income, lang)}</td>
              <td>{formatInr(m.totals.expense, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FinanceScreen() {
  const { t, lang } = useT();
  const entries = useDbQuery(listEntries, ["finance"], [] as FinanceEntry[]);
  const [period, setPeriod] = useState<Period>("all");
  const [cropFilter, setCropFilter] = useState("");
  const [editing, setEditing] = useState<FinanceEntry | null | "new">(null);
  const today = todayIso();

  const filtered = useMemo(() => {
    const from = period === "month" ? `${today.slice(0, 7)}-01` : period === "year" ? `${today.slice(0, 4)}-01-01` : undefined;
    return filterEntries(entries.data, { from, cropId: cropFilter === "" ? undefined : cropFilter === "none" ? null : cropFilter }).sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt
    );
  }, [entries.data, period, cropFilter, today]);
  const report = useMemo(() => buildReport(filtered), [filtered]);

  const cropLabel = (id?: string | null) => {
    const c = id ? cropById(id) : undefined;
    return c ? cropName(c, lang) : t("finance.general");
  };

  const remove = async (e: FinanceEntry) => {
    if (!window.confirm(t("finance.confirmDelete"))) return;
    try {
      await deleteEntry(e.id);
    } catch {
      toast.error(t("errors.storage"));
    }
  };

  const exportCsv = () => {
    const csv = entriesToCsv(
      filtered,
      { kind: (k) => t(`finance.${k}`), category: (k, c) => t(`finance.cat.${k}.${c}`), crop: (id) => cropLabel(id) },
      [t("finance.date"), t("finance.kind"), t("finance.category"), t("finance.crop"), t("finance.amountSigned"), t("finance.quantity"), t("finance.unit"), t("finance.note")]
    );
    downloadText(`viva-ai-finance-${today}.csv`, csv);
  };

  return (
    <Screen
      title={t("finance.title")}
      subtitle={t("finance.subtitle")}
      wide
      actions={
        <Button size="sm" onClick={() => setEditing("new")} icon="+">
          {t("finance.add")}
        </Button>
      }
    >
      {Boolean(entries.error) && <ErrorNotice error={entries.error} onRetry={() => void entries.reload()} />}

      <div className="flex flex-wrap gap-3 items-end print:hidden">
        <Segmented
          label={t("finance.period")}
          value={period}
          onChange={setPeriod}
          options={[
            { value: "all", label: t("finance.periodAll") },
            { value: "year", label: t("finance.periodYear") },
            { value: "month", label: t("finance.periodMonth") },
          ]}
        />
        <div className="min-w-[12rem]">
          <SelectField
            label={t("finance.crop")}
            value={cropFilter}
            onChange={(e) => setCropFilter(e.target.value)}
            options={[{ value: "", label: t("finance.allCrops") }, { value: "none", label: t("finance.general") }, ...CROPS.map((c) => ({ value: c.id, label: cropName(c, lang) }))]}
          />
        </div>
      </div>

      {entries.loading ? (
        <Skeleton className="h-32" />
      ) : entries.data.length === 0 ? (
        <EmptyState icon="₹" title={t("finance.emptyTitle")} body={t("finance.emptyBody")} action={<Button onClick={() => setEditing("new")}>{t("finance.add")}</Button>} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label={t("finance.totalIncome")} value={formatInr(report.totals.income, lang)} />
            <Stat label={t("finance.totalExpense")} value={formatInr(report.totals.expense, lang)} />
            <Stat
              label={report.totals.profit >= 0 ? t("finance.profit") : t("finance.loss")}
              value={<span className={report.totals.profit >= 0 ? "text-leaf-700" : "text-danger-600"}>{formatInr(Math.abs(report.totals.profit), lang)}</span>}
            />
          </div>

          {report.byMonth.length > 0 && (
            <Card title={t("finance.byMonth")}>
              <MonthBars months={report.byMonth} />
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card title={t("finance.byCrop")}>
              <ul className="flex flex-col divide-y divide-soil-100 text-sm">
                {report.byCrop.map((c) => (
                  <li key={c.cropId ?? "none"} className="flex justify-between gap-2 py-2">
                    <span>{cropLabel(c.cropId)}</span>
                    <span className={c.totals.profit >= 0 ? "text-leaf-700 font-semibold" : "text-danger-600 font-semibold"}>
                      {c.totals.profit >= 0 ? "+" : "−"}
                      {formatInr(Math.abs(c.totals.profit), lang)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t("finance.byCategory")}>
              <ul className="flex flex-col divide-y divide-soil-100 text-sm">
                {report.byCategory.map((c) => (
                  <li key={`${c.kind}|${c.category}`} className="flex justify-between gap-2 py-2">
                    <span>
                      {c.kind === "income" ? "⬆ " : "⬇ "}
                      {t(`finance.cat.${c.kind}.${c.category}`)}
                    </span>
                    <span>{formatInr(c.amount, lang)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card
            title={t("finance.entries", { n: filtered.length })}
            action={
              <div className="flex gap-1 print:hidden">
                <Button size="sm" variant="ghost" onClick={exportCsv} icon="⬇" disabled={!filtered.length}>
                  CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={() => window.print()} icon="🖨">
                  {t("finance.print")}
                </Button>
              </div>
            }
          >
            {filtered.length === 0 ? (
              <p className="text-sm text-soil-600">{t("finance.noneInFilter")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-soil-100">
                {filtered.slice(0, 200).map((e) => (
                  <li key={e.id} className="flex items-start gap-2 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">
                        {t(`finance.cat.${e.kind}.${e.category}`)} <span className="text-xs text-soil-500">· {cropLabel(e.cropId)}</span>
                      </p>
                      <p className="text-xs text-soil-600">
                        {formatIsoDate(e.date, lang)}
                        {e.quantity !== undefined ? ` · ${e.quantity} ${e.unit ?? ""}` : ""}
                        {e.note ? ` · ${e.note}` : ""}
                      </p>
                    </div>
                    <span className={`font-semibold whitespace-nowrap ${e.kind === "income" ? "text-leaf-700" : "text-danger-600"}`}>
                      {e.kind === "income" ? "+" : "−"}
                      {formatInr(e.amount, lang)}
                    </span>
                    <div className="flex print:hidden">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={t("finance.edit")}>
                        ✎
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(e)} aria-label={t("finance.delete")}>
                        🗑
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <p className="text-xs text-soil-500">{t("finance.privacy")}</p>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? t("finance.add") : t("finance.edit")}>
        {editing !== null && <EntryForm key={editing === "new" ? "new" : editing.id} entry={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </Screen>
  );
}
