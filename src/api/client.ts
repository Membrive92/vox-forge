/** Centralized HTTP client. Uniform error handling + structured logging. */

import { logger } from "@/logging/logger";

import type { ApiErrorBody } from "./types";

export const API_BASE: string = import.meta.env["VITE_API_BASE"] ?? "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function newRequestId(): string {
  // 12-char random id — matches backend format
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return { detail: res.statusText };
  }
}

async function ensureOk(res: Response, requestId: string): Promise<void> {
  if (res.ok) return;
  const body = await parseErrorBody(res);
  const serverId = res.headers.get("X-Request-ID") ?? requestId;
  throw new ApiError(res.status, body.detail || `HTTP ${res.status}`, body.code, serverId);
}

interface RequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

async function request(path: string, opts: RequestOptions): Promise<Response> {
  const requestId = newRequestId();
  const url = `${API_BASE}${path}`;
  const started = performance.now();

  const headers = { ...(opts.headers ?? {}), "X-Request-ID": requestId };

  logger.debug(`→ ${opts.method} ${path}`, { requestId, method: opts.method, path });

  try {
    const res = await fetch(url, { method: opts.method, headers, body: opts.body ?? null });
    const elapsed = Math.round(performance.now() - started);
    const serverId = res.headers.get("X-Request-ID") ?? requestId;

    if (res.ok) {
      logger.info(`← ${opts.method} ${path} ${res.status} (${elapsed}ms)`, {
        requestId: serverId, status: res.status, elapsedMs: elapsed,
      });
    } else {
      logger.warn(`← ${opts.method} ${path} ${res.status} (${elapsed}ms)`, {
        requestId: serverId, status: res.status, elapsedMs: elapsed,
      });
    }
    await ensureOk(res, serverId);
    return res;
  } catch (err) {
    const elapsed = Math.round(performance.now() - started);
    if (err instanceof ApiError) throw err;
    logger.error(`✗ ${opts.method} ${path} network error (${elapsed}ms)`, {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await request(path, { method: "GET" });
  return (await res.json()) as T;
}

export async function postJson<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function patchJson<T, B = unknown>(path: string, body: B): Promise<T> {
  const res = await request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await request(path, { method: "POST", body: form });
  return (await res.json()) as T;
}

export async function deleteResource(path: string): Promise<void> {
  await request(path, { method: "DELETE" });
}

export interface AudioResponse {
  blob: Blob;
  duration: number;
  sizeBytes: number;
  chunks: number;
  textLength: number;
  engine: string;
  requestId: string | undefined;
}

export async function postJsonForAudio<B>(path: string, body: B): Promise<AudioResponse> {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const duration = Number.parseFloat(res.headers.get("X-Audio-Duration") ?? "0");
  const sizeBytes = Number.parseInt(res.headers.get("X-Audio-Size") ?? "0", 10);
  const chunks = Number.parseInt(res.headers.get("X-Audio-Chunks") ?? "1", 10);
  const textLength = Number.parseInt(res.headers.get("X-Text-Length") ?? "0", 10);
  const engine = res.headers.get("X-Audio-Engine") ?? "edge-tts";
  const requestId = res.headers.get("X-Request-ID") ?? undefined;
  const blob = await res.blob();
  return { blob, duration, sizeBytes, chunks, textLength, engine, requestId };
}
