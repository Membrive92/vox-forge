/** Server log viewer + stats endpoints. */

import { getJson } from "./client";

export interface ServerLogEntry {
  timestamp: string;
  level: string;
  request_id: string;
  logger: string;
  message: string;
  raw: string;
}

export interface ServerLogsResponse {
  entries: ServerLogEntry[];
  source: string;
  returned: number;
}

export interface ErrorCountResponse {
  errors: number;
  warnings: number;
  minutes: number;
}

export interface StatsResponse {
  period_hours: number;
  total_requests: number;
  synthesis_count: number;
  error_count: number;
  warning_count: number;
  avg_request_ms: number;
  slowest_request_ms: number;
  slowest_request_path: string;
  top_endpoints: Record<string, number>;
  engines_used: Record<string, number>;
}

export function fetchServerLogs(
  source: "app" | "errors" = "app",
  lines = 300,
  level?: string,
  rid?: string,
  since?: string,
  until?: string,
): Promise<ServerLogsResponse> {
  const params = new URLSearchParams({ source, lines: String(lines) });
  if (level) params.set("level", level);
  if (rid) params.set("rid", rid);
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  return getJson<ServerLogsResponse>(`/logs/recent?${params.toString()}`);
}

export function fetchErrorCount(minutes = 60): Promise<ErrorCountResponse> {
  return getJson<ErrorCountResponse>(`/logs/error-count?minutes=${minutes}`);
}

export function fetchStats(hours = 24): Promise<StatsResponse> {
  return getJson<StatsResponse>(`/stats?hours=${hours}`);
}
