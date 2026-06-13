import { useEffect, useState } from "react";

import { isAbortError } from "@/api/client";
import { getImageProviderStatus } from "@/api/studio";
import type { ImageAspectRatio, ImageProviderStatus } from "@/api/studio";
import { Button } from "@/components/Button";
import { logger } from "@/logging/logger";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

/** What the composer hands back when the user submits. */
export interface PromptComposerSubmit {
  prompt: string;
  aspect: ImageAspectRatio;
  seed: number | undefined;
  count: number;
}

interface Props {
  t: Translations;
  /** Disables the form while a batch is generating. */
  isGenerating: boolean;
  onSubmit: (input: PromptComposerSubmit) => void;
  /** Optional seed prompt (e.g. a scene's text) the composer opens with. */
  defaultPrompt?: string;
}

const ASPECTS: ImageAspectRatio[] = ["16:9", "9:16", "1:1", "4:3"];
const COUNTS = [1, 2, 3, 4] as const;
const MAX_SEED = 2 ** 31 - 1;

/**
 * Prompt → image composer for the Studio Images section (T2I-2).
 *
 * Extracted from the modal ``ImageGenDialog`` (VideoRenderPanel) into a
 * reusable inline panel: prompt + aspect + seed (+ randomize) + the
 * provider-status banner, plus a batch ``count`` (1-4). The parent owns
 * the actual generation call and the global job registration.
 */
export function PromptComposer({ t, isGenerating, onSubmit, defaultPrompt = "" }: Props) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [aspect, setAspect] = useState<ImageAspectRatio>("16:9");
  const [seedText, setSeedText] = useState("");
  const [count, setCount] = useState(1);
  // Provider health (PROD-02, plan F2): warn before the user invests in
  // a prompt that is guaranteed to fail. Fails open.
  const [providerStatus, setProviderStatus] = useState<ImageProviderStatus | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getImageProviderStatus(ctrl.signal)
      .then(setProviderStatus)
      .catch((e) => {
        if (!isAbortError(e)) {
          logger.warn("Image provider status probe failed", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => ctrl.abort();
  }, []);

  const parseSeed = (): number | undefined => {
    const trimmed = seedText.trim();
    if (trimmed === "") return undefined;
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const randomizeSeed = (): void => {
    setSeedText(String(Math.floor(Math.random() * MAX_SEED)));
  };

  const submit = (): void => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onSubmit({ prompt: trimmed, aspect, seed: parseSeed(), count });
  };

  const submitLabel = isGenerating
    ? t.studioComposerGenerating
    : count > 1
      ? t.studioComposerSubmitN.replace("{n}", String(count))
      : t.studioComposerSubmit;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
      }}
    >
      <h3 style={{ margin: "0 0 12px", fontSize: typography.size.base, fontWeight: 700 }}>
        {t.studioComposerTitle}
      </h3>

      <label style={{ display: "block", fontSize: typography.size.xs, color: colors.textDim, marginBottom: 10 }}>
        {t.studioScenesGenPromptLabel}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t.studioScenesGenPromptPlaceholder}
          rows={3}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            marginTop: 4,
            padding: "8px 10px",
            borderRadius: radii.sm,
            background: colors.surfaceAlt,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontSize: typography.size.sm,
            fontFamily: fonts.sans,
            resize: "vertical",
          }}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <label style={{ fontSize: typography.size.xs, color: colors.textDim }}>
          {t.studioScenesGenAspectLabel}
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as ImageAspectRatio)}
            style={fieldStyle}
          >
            {ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: typography.size.xs, color: colors.textDim }}>
          {t.studioComposerCount}
          <select
            value={count}
            onChange={(e) => setCount(Number.parseInt(e.target.value, 10))}
            style={fieldStyle}
          >
            {COUNTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: "block", fontSize: typography.size.xs, color: colors.textDim, marginBottom: 6 }}>
        {t.studioScenesGenSeedLabel}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="—"
            style={{
              flex: 1,
              minWidth: 0,
              boxSizing: "border-box",
              padding: "6px 10px",
              borderRadius: radii.sm,
              background: colors.surfaceAlt,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              fontSize: typography.size.sm,
              fontFamily: fonts.mono,
            }}
          />
          <Button variant="ghost" size="sm" type="button" onClick={randomizeSeed}>
            {t.studioComposerRandomize}
          </Button>
        </div>
      </label>

      <p style={{ margin: "0 0 4px", fontSize: typography.size.xs, color: colors.textFaint }}>
        {t.studioScenesGenSeedHint}
      </p>
      <p style={{ margin: "0 0 12px", fontSize: typography.size.xs, color: colors.textFaint }}>
        {t.studioComposerCountHint}
      </p>

      {providerStatus?.name === "placeholder" ? (
        <p style={{ margin: "0 0 12px", fontSize: typography.size.xs, color: colors.textFaint }}>
          {t.studioScenesGenNote}
        </p>
      ) : null}
      {providerStatus !== null && !providerStatus.available ? (
        <p
          role="alert"
          style={{
            margin: "0 0 12px",
            padding: "8px 10px",
            fontSize: typography.size.xs,
            color: colors.warning,
            background: colors.warningSoft,
            border: `1px solid ${colors.warningBorder}`,
            borderRadius: radii.sm,
          }}
        >
          {t.studioImageProviderOffline}
          {providerStatus.error ? ` — ${providerStatus.error}` : ""}
        </p>
      ) : null}

      <Button
        variant="primary"
        type="submit"
        fullWidth
        disabled={prompt.trim().length === 0 || isGenerating}
        loading={isGenerating}
      >
        {submitLabel}
      </Button>
    </form>
  );
}

const fieldStyle: React.CSSProperties = {
  display: "block",
  marginTop: 4,
  width: "100%",
  padding: "6px 8px",
  borderRadius: radii.sm,
  background: colors.surfaceAlt,
  border: `1px solid ${colors.border}`,
  color: colors.text,
  fontSize: typography.size.sm,
  fontFamily: fonts.sans,
};
