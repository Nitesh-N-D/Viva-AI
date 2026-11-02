import React from "react";
import { useT } from "../../i18n";
import { errorMessage } from "../../lib/errors";
import { Notice } from "./Feedback";
import { Button } from "./Button";

/** Classified, bilingual error message with a recovery action. */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, lang } = useT();
  const m = errorMessage(error, lang);
  return (
    <Notice
      tone={m.kind === "not_configured" ? "warning" : "error"}
      title={m.title}
      action={
        m.retryable && onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    >
      {m.action}
    </Notice>
  );
}
