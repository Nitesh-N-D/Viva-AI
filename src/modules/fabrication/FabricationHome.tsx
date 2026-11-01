import React, { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { voiceEngine } from "../../shared/voice/VoiceEngine";
import { enqueue } from "../../shared/offline-sync/SyncQueue";
import { isFirebaseConfigured } from "../../lib/firebase";
import { Screen } from "../../shared/ui/Screen";
import { Card } from "../../shared/ui/Card";
import { Button } from "../../shared/ui/Button";
import { Notice } from "../../shared/ui/Feedback";
import { InputField, TextAreaField } from "../../shared/ui/Field";
import { toast } from "../../shared/ui/Toast";
import { PARAM_SPECS, SHAPE_TYPES, validateParams, type ParamKey, type Params, type ShapeType } from "./engine/shapes";
import { buildDrawing, formatDimValue, type Drawing } from "./engine/drawing";
import { toSvgString, type SheetText } from "./engine/svg";
import { extractIntent, type IntentResult } from "./intent/extractIntent";
import { DrawingViewer } from "./ui/DrawingViewer";
import { downloadBlob, printSvg, shareFile, svgBlob, svgToPng } from "./ui/exporters";

const SHAPE_ICON: Record<ShapeType, string> = { l_bracket: "⌐", pipe_clamp: "◠", flat_stand: "⊥", hinge_mount: "⧓" };

type Inputs = Partial<Record<ParamKey, string>>;

function toParams(inputs: Inputs): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v === undefined || v.trim() === "") continue;
    out[k as ParamKey] = Number(v.replace(",", "."));
  }
  return out;
}

export function FabricationHome() {
  const { t, lang } = useT();
  const [shape, setShape] = useState<ShapeType | null>(null);
  const [inputs, setInputs] = useState<Inputs>({});
  const [request, setRequest] = useState("");
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [listening, setListening] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  const params = useMemo(() => toParams(inputs), [inputs]);
  const problems = shape ? validateParams(shape, params) : [];
  const drawing: Drawing | null = shape && problems.length === 0 ? buildDrawing(shape, params) : null;

  function applyIntent(text: string) {
    const r = extractIntent(text, shape);
    setIntent(r);
    if (r.shape) {
      if (r.shape !== shape) setInputs({});
      setShape(r.shape);
      setInputs((prev) => {
        const next: Inputs = r.shape === shape ? { ...prev } : {};
        for (const [k, v] of Object.entries(r.params)) next[k as ParamKey] = formatDimValue(v as number);
        return next;
      });
    }
  }

  async function listen() {
    setListening(true);
    const r = await voiceEngine.listen(lang);
    setListening(false);
    if (r.ok) {
      setRequest(r.transcript);
      applyIntent(r.transcript);
    } else {
      toast.error(t(`voice.error.${r.reason}`));
    }
  }

  const sheetText = (d: Drawing): SheetText => ({
    views: { front: t("fab.view.front"), top: t("fab.view.top"), side: t("fab.view.side") },
    title: `${t(`fab.shape.${d.shape}`)} — ${PARAM_SPECS[d.shape]
      .filter((s) => d.params[s.key] !== null)
      .map((s) => `${t(`fab.param.${s.key}`)} ${formatDimValue(d.params[s.key]!)}${s.unit === "deg" ? "°" : ""}`)
      .join(", ")}`,
    footer: t("fab.footer", { scale: d.printScale, kg: d.weightKg }),
    notes: [...d.assumed.map((k) => t("fab.assumedNote", { param: t(`fab.param.${k}`), value: formatDimValue(d.params[k]!) })), t("fab.disclaimer")],
  });

  const filename = drawing ? `viva-${drawing.shape}-${Date.now()}` : "viva-drawing";

  async function recordRequest() {
    if (!drawing || queued || !isFirebaseConfigured) return;
    setQueued(true);
    try {
      await enqueue("fabricationRequests", { shapeType: drawing.shape, timestamp: Date.now() });
    } catch (err) {
      console.warn("[fab] could not queue request", err);
    }
  }

  async function run(action: "svg" | "png" | "pdf" | "share") {
    if (!drawing) return;
    const text = sheetText(drawing);
    const svg = toSvgString(drawing, text, showDims);
    setBusy(true);
    try {
      if (action === "svg") downloadBlob(svgBlob(svg), `${filename}.svg`);
      else if (action === "png") downloadBlob(await svgToPng(svg), `${filename}.png`);
      else if (action === "pdf") await printSvg(svg, text.title);
      else {
        const png = await svgToPng(svg);
        const outcome = await shareFile(new File([png], `${filename}.png`, { type: "image/png" }), text.title, t("fab.shareText"));
        if (outcome === "unsupported") {
          downloadBlob(png, `${filename}.png`);
          toast.info(t("fab.shareUnsupported"));
        }
      }
      void recordRequest();
    } catch (err) {
      console.warn("[fab] export failed", err);
      toast.error(t("fab.exportFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t("fab.title")} subtitle={t("fab.subtitle")} wide>
      <Card title={t("fab.describe")}>
        <div className="flex flex-col gap-3">
          <TextAreaField
            label={t("fab.requestLabel")}
            hint={t("fab.requestHint")}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => applyIntent(request)} disabled={!request.trim()}>
              {t("fab.understand")}
            </Button>
            {voiceEngine.canListen() && (
              <Button variant="secondary" onClick={() => void listen()} disabled={listening} icon="🎤">
                {listening ? t("voice.listening") : t("fab.speak")}
              </Button>
            )}
          </div>
          {intent && !intent.shape && <Notice tone="warning">{t("fab.noShape")}</Notice>}
          {intent && intent.unitAssumed && <Notice tone="info">{t("fab.unitAssumed")}</Notice>}
          {intent && intent.unplaced.length > 0 && <Notice tone="info">{t("fab.unplaced", { values: intent.unplaced.join(", ") })}</Notice>}
        </div>
      </Card>

      <Card title={t("fab.chooseShape")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label={t("fab.chooseShape")}>
          {SHAPE_TYPES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={shape === s}
              onClick={() => {
                setShape(s);
                setQueued(false);
              }}
              className={`min-h-[72px] rounded-tile border-2 p-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold ${
                shape === s ? "border-steel-700 bg-steel-100 text-steel-900" : "border-soil-200 bg-white hover:border-steel-400"
              }`}
            >
              <span className="text-2xl" aria-hidden="true">
                {SHAPE_ICON[s]}
              </span>
              {t(`fab.shape.${s}`)}
            </button>
          ))}
        </div>
      </Card>

      {shape && (
        <Card title={t("fab.dimensions")}>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            {PARAM_SPECS[shape].map((spec) => {
              const problem = problems.find((p) => p.key === spec.key);
              return (
                <InputField
                  key={spec.key}
                  label={`${t(`fab.param.${spec.key}`)}${spec.required ? " *" : ""}`}
                  hint={!spec.required ? (spec.standard != null ? t("fab.optionalStd", { value: spec.standard }) : t("fab.optionalNone")) : undefined}
                  inputMode="decimal"
                  suffix={spec.unit === "deg" ? "°" : "mm"}
                  value={inputs[spec.key] ?? ""}
                  onChange={(e) => {
                    setInputs((prev) => ({ ...prev, [spec.key]: e.target.value }));
                    setQueued(false);
                  }}
                  error={
                    problem && problem.problem !== "missing"
                      ? problem.problem === "out_of_range"
                        ? t("fab.outOfRange", { min: spec.min, max: spec.max })
                        : t(`fab.geometry.${spec.key}`)
                      : null
                  }
                />
              );
            })}
          </div>
          {problems.some((p) => p.problem === "missing") && (
            <div className="mt-3">
              <Notice tone="info" title={t("fab.needMore")}>
                {problems
                  .filter((p) => p.problem === "missing")
                  .map((p) => t(`fab.param.${p.key}`))
                  .join(", ")}
              </Notice>
            </div>
          )}
        </Card>
      )}

      {drawing && (
        <Card title={t("fab.drawing")}>
          <div className="flex flex-col gap-3">
            <DrawingViewer drawing={drawing} text={sheetText(drawing)} showDims={showDims} onToggleDims={setShowDims} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-soil-500">{t("fab.weight")}</p>
                <p className="font-semibold">{t("fab.weightValue", { kg: drawing.weightKg })}</p>
              </div>
              <div>
                <p className="text-xs text-soil-500">{t("fab.scale")}</p>
                <p className="font-semibold">1:{drawing.printScale} (A4)</p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-xs text-soil-500">{t("fab.material")}</p>
                <p className="font-semibold">{t(`fab.materialFor.${drawing.shape}`)}</p>
              </div>
            </div>
            {drawing.assumed.length > 0 && (
              <Notice tone="info">
                {drawing.assumed.map((k) => t("fab.assumedNote", { param: t(`fab.param.${k}`), value: formatDimValue(drawing.params[k]!) })).join(" ")}
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="steel" onClick={() => void run("svg")} disabled={busy}>
                SVG
              </Button>
              <Button variant="steel" onClick={() => void run("png")} disabled={busy}>
                PNG
              </Button>
              <Button variant="steel" onClick={() => void run("pdf")} disabled={busy}>
                {t("fab.printPdf")}
              </Button>
              <Button variant="secondary" onClick={() => void run("share")} disabled={busy} icon="↗">
                {t("fab.share")}
              </Button>
            </div>
            <Notice tone="warning">{t("fab.disclaimer")}</Notice>
          </div>
        </Card>
      )}
    </Screen>
  );
}
