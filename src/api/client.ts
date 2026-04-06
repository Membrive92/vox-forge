/** Cliente HTTP centralizado. Manejo uniforme de errores. */

import type { ApiErrorBody } from "./types";

export const API_BASE: string = import.meta.env["VITE_API_BASE"] ?? "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return { detail: res.statusText };
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await parseErrorBody(res);
  throw new ApiError(res.status, body.detail || `HTTP ${res.status}`, body.code);
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  await ensureOk(res);
  return (await res.json()) as T;
}

export async function postJson<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return (await res.json()) as T;
}

export async function patchJson<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return (await res.json()) as T;
}

export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
  await ensureOk(res);
  return (await res.json()) as T;
}

export async function deleteResource(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  await ensureOk(res);
}

export interface AudioResponse {
  blob: Blob;
  duration: number;
  sizeBytes: number;
  chunks: number;
  textLength: number;
}

export async function postJsonForAudio<B>(path: string, body: B): Promise<AudioResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const sizeBytes = Number.parseInt(res.headers.get("X-Audio-Size") ?? "0", 10);
  const chunks = Number.parseInt(res.headers.get("X-Audio-Chunks") ?? "1", 10);
  const textLength = Number.parseInt(res.headers.get("X-Text-Length") ?? "0", 10);
  const blob = await res.blob();
  return { blob, duration, sizeBytes, chunks, textLength };
}
