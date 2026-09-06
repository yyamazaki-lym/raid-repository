"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Save, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setScheduleUrlAction } from "@/lib/server/categories-actions";
import { httpUrlError } from "@/lib/url-validation";
import { useMessages } from "@/lib/i18n/client";

/**
 * Onboarding card shown on the schedule page when no source URL is configured.
 * Same shape as the settings dialog's body, but lives inline so the user can
 * resolve the missing config without opening the gear menu.
 */
export function ScheduleOnboarding() {
  const m = useMessages();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // onBlur 即時バリデーション (TODO #51 P2-6)。詳細な形式チェック
  // (character-sheets の URL か等) は server action 側が引き続き担う。
  const [fieldError, setFieldError] = useState<string | null>(null);

  const onSave = async () => {
    setError(null);
    const err = httpUrlError(url);
    if (err) {
      setFieldError(err);
      setError(err);
      return;
    }
    setBusy(true);
    const result = await setScheduleUrlAction(url);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason ?? m.onboarding.saveFailed);
      return;
    }
    toast.success(m.onboarding.toastSaved);
    router.refresh();
  };

  return (
    <Card className="glass flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--neon-cyan)]/40 bg-background/40 text-[var(--neon-cyan)] shadow-[0_0_18px_-6px_var(--neon-cyan)]">
          <Calendar className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-base tracking-[0.16em] uppercase">
            {m.onboarding.title}
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {m.onboarding.descLine1}
            <br />
            {m.onboarding.descLine2Prefix}<strong>{m.onboarding.descLine2Strong}</strong>{m.onboarding.descLine2Suffix}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="onboard-url"
            className="text-[10px] font-medium tracking-normal text-muted-foreground"
          >
            {m.onboarding.urlLabel}
          </Label>
          <Input
            id="onboard-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            onBlur={() => setFieldError(httpUrlError(url))}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={
              (fieldError ? "onboard-url-error " : "") + "onboard-url-help"
            }
            placeholder="https://character-sheets.appspot.com/schedule/list?key=..."
            className="font-mono text-[12px]"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          {fieldError && (
            <p
              id="onboard-url-error"
              role="alert"
              className="text-destructive text-[11px] leading-relaxed"
            >
              {fieldError}
            </p>
          )}
          <p
            id="onboard-url-help"
            className="text-muted-foreground text-[11px] leading-relaxed"
          >
            {m.onboarding.helpPrefix}{" "}
            <code className="font-mono">schedule/list?key=…</code>{" "}
            {m.onboarding.helpSuffix}
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border/40 bg-secondary/20 px-3 py-2">
          <ExternalLink
            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {m.onboarding.createHintPrefix}{" "}
            <a
              href="https://character-sheets.appspot.com/schedule/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-foreground/80 underline decoration-dotted decoration-[var(--neon-cyan)]/60 underline-offset-2 transition-colors hover:text-[var(--neon-cyan)]"
            >
              character-sheets.appspot.com/schedule/
            </a>{" "}
            {m.onboarding.createHintSuffix}
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
              aria-hidden
            />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="gap-1.5 text-[11px] tracking-normal"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? m.common.saving : m.onboarding.submit}
          </Button>
        </div>
      </div>
    </Card>
  );
}
