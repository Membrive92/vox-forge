import { useCallback, useState } from "react";

import { generateIntoLibrary, type MediaAsset } from "@/api/studio";
import { useJobMirror } from "@/hooks/jobsContext";
import { logger } from "@/logging/logger";
import type { Translations } from "@/i18n";
import { colors, fonts, typography } from "@/theme/tokens";

import { MediaBin } from "./MediaBin";
import { PromptComposer, type PromptComposerSubmit } from "./PromptComposer";
import { useMediaBin } from "./useMediaBin";

interface Props {
  t: Translations;
  onToast: (msg: string) => void;
  /** "Usar como portada": hand a generated asset to the video render. */
  onUseAsCover: (asset: MediaAsset) => void;
}

/**
 * Studio "Images" section (T2I-2): prompt composer over the media
 * library gallery. Generation registers a global job (kind
 * ``image-gen``) so progress survives a section/tab switch (UX-01); on
 * success the new assets are prepended to the bin without a reload.
 */
export function ImagesPanel({ t, onToast, onUseAsCover }: Props) {
  const bin = useMediaBin();
  const [isGenerating, setIsGenerating] = useState(false);

  // UX-01: keep the placeholder/diffusion run visible in the tray when
  // the user navigates away from the Images section.
  useJobMirror({ active: isGenerating, kind: "image-gen", originTab: "studio" });

  const handleSubmit = useCallback(
    async (input: PromptComposerSubmit): Promise<void> => {
      setIsGenerating(true);
      try {
        const generated = await generateIntoLibrary({
          prompt: input.prompt,
          aspectRatio: input.aspect,
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          count: input.count,
        });
        bin.prepend(generated);
        onToast(t.studioComposerGenSuccess.replace("{n}", String(generated.length)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onToast(`Error: ${msg}`);
        logger.error("Images: generation failed", { error: msg });
      } finally {
        setIsGenerating(false);
      }
    },
    [bin, onToast, t.studioComposerGenSuccess],
  );

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: typography.size.sm, color: colors.textDim, fontFamily: fonts.sans }}>
          {t.studioImagesTagline}
        </p>
      </header>

      <div className="vf-images-grid">
        <PromptComposer t={t} isGenerating={isGenerating} onSubmit={(i) => void handleSubmit(i)} />

        <MediaBin
          t={t}
          assets={bin.assets}
          loading={bin.loading}
          onRefresh={(query) => void bin.refresh({ kind: "image", ...(query ? { query } : {}) })}
          onDelete={(id) => void bin.remove(id)}
          onUseAsCover={onUseAsCover}
        />
      </div>
    </div>
  );
}
