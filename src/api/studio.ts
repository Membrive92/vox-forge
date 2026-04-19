/** Studio module API client. */

import { API_BASE, ApiError, getJson } from "./client";

export type EditOperationType =
  | "trim"
  | "delete_region"
  | "fade_in"
  | "fade_out"
  | "normalize";

export interface StudioOperation {
  type: EditOperationType;
  params: Record<string, number>;
}

export interface StudioSource {
  id: string;
  kind: "chapter" | "mix";
  project_name: string;
  chapter_title: string;
  source_path: string;
  duration_s: number;
  created_at: string;
}

interface StudioSourcesResponse {
  sources: StudioSource[];
  count: number;
}

export interface StudioEditResult {
  blob: Blob;
  operationsCount: number;
}

export async function listStudioSources(): Promise<StudioSource[]> {
  const body = await getJson<StudioSourcesResponse>("/studio/sources");
  return body.sources;
}

export function getStudioAudioUrl(path: string): string {
  return `${API_BASE}/studio/audio?path=${encodeURIComponent(path)}`;
}

export async function applyEdit(
  sourcePath: string,
  operations: StudioOperation[],
  outputFormat: string,
): Promise<StudioEditResult> {
  const res = await fetch(`${API_BASE}/studio/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_path: sourcePath,
      operations,
      output_format: outputFormat,
    }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const b = (await res.json()) as { detail?: string; code?: string };
      if (b.detail) detail = b.detail;
      code = b.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail, code);
  }
  const operationsCount = Number.parseInt(
    res.headers.get("X-Operations-Count") ?? String(operations.length),
    10,
  );
  const blob = await res.blob();
  return { blob, operationsCount };
}
