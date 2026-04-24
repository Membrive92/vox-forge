import type { SrtEntry } from "@/api/studio";

export interface Scene {
  start_s: number;
  end_s: number;
  text_preview: string;
}

/**
 * Group transcription entries into scenes of roughly ``targetSeconds``.
 *
 * Strategy: accumulate lines until either the scene duration reaches
 * ``targetSeconds`` OR the next line starts after a long pause (> 1.5s
 * of silence) which usually marks a paragraph / beat change. Prevents
 * splitting a sentence mid-word.
 *
 * This runs client-side — the transcribe API already returns entries,
 * so no backend trip is needed just to rebucket them.
 */
export function detectScenes(
  entries: readonly SrtEntry[],
  targetSeconds = 25,
): Scene[] {
  if (entries.length === 0) return [];
  const scenes: Scene[] = [];
  let current: Scene = {
    start_s: entries[0]!.start_s,
    end_s: entries[0]!.end_s,
    text_preview: entries[0]!.text,
  };
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]!;
    const prev = entries[i - 1]!;
    const gap = entry.start_s - prev.end_s;
    const sceneLen = current.end_s - current.start_s;

    const shouldBreak =
      sceneLen >= targetSeconds ||
      (sceneLen >= targetSeconds * 0.6 && gap > 1.5);

    if (shouldBreak) {
      scenes.push(current);
      current = {
        start_s: entry.start_s,
        end_s: entry.end_s,
        text_preview: entry.text,
      };
    } else {
      current = {
        ...current,
        end_s: entry.end_s,
        text_preview: `${current.text_preview} ${entry.text}`.trim(),
      };
    }
  }
  scenes.push(current);
  return scenes;
}
