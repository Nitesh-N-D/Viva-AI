import React from "react";
import { useT } from "../../../i18n";
import guidance from "../data/guidance.json";
import { DISEASE_CLASSES, taxonName } from "../../../domain/taxonomy";
import { Screen } from "../../../shared/ui/Screen";
import { Card } from "../../../shared/ui/Card";
import { Badge, Notice } from "../../../shared/ui/Feedback";
import { Button } from "../../../shared/ui/Button";
import { goBack, navigate } from "../../../app/router";

type Localised = { en: string[]; ta: string[] };
export interface ConditionGuidance {
  severity: "none" | "moderate" | "high";
  symptoms: Localised;
  steps: Localised;
  prevention: Localised;
}

export const GUIDANCE = guidance.conditions as Record<string, ConditionGuidance>;
export const GUIDANCE_REFERENCES = guidance.references;

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 flex flex-col gap-1.5 text-soil-800">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

export function GuidanceScreen({ id }: { id: string | null }) {
  const { t, lang } = useT();

  if (!id) {
    return (
      <Screen title={t("remedy.title")} onBack={() => goBack({ name: "disease" })}>
        <Card title={t("diseaseScan.manualTitle")}>
          <div className="flex flex-col gap-2">
            {DISEASE_CLASSES.map((d) => (
              <Button key={d.id} variant="secondary" className="justify-start" onClick={() => navigate({ name: "guidance", id: d.id })}>
                {taxonName("disease", d.id, lang)}
              </Button>
            ))}
          </div>
        </Card>
      </Screen>
    );
  }

  const entry = GUIDANCE[id];
  const name = taxonName("disease", id, lang);
  if (!entry) {
    return (
      <Screen title={t("remedy.title")} onBack={() => goBack({ name: "disease" })}>
        <Notice tone="warning">{t("remedy.notFound")}</Notice>
      </Screen>
    );
  }


  return (
    <Screen title={name} subtitle={t("remedy.title")} onBack={() => goBack({ name: "disease" })}>
      <Notice tone="warning">{t("remedy.disclaimer")}</Notice>
      {entry.severity === "high" && (
        <div>
          <Badge tone="warning">{t("remedy.urgent")}</Badge>
        </div>
      )}
      <Card title={t("remedy.symptoms")}>
        <List items={entry.symptoms[lang]} />
      </Card>
      <Card title={t("remedy.steps")}>
        <List items={entry.steps[lang]} />
      </Card>
      <Card title={t("remedy.prevention")}>
        <List items={entry.prevention[lang]} />
      </Card>
      <Card title={t("remedy.consultTitle")}>
        <p className="text-sm text-soil-700 mb-2">{t("remedy.consult")}</p>
        <ul className="flex flex-col gap-1 text-sm">
          {GUIDANCE_REFERENCES.map((r) => (
            <li key={r.url}>
              <a className="text-leaf-700 underline underline-offset-2" href={r.url} target={r.url.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
                {lang === "ta" ? r.ta : r.en}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  );
}
