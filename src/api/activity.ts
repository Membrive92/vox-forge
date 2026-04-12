/** Activity feed API. */

import { getJson } from "./client";

export interface GenerationActivity {
  id: string;
  status: string;
  engine: string;
  duration: number;
  chunks_total: number;
  chunks_done: number;
  error: string | null;
  created_at: string;
  output_format: string;
  chapter_title: string;
  project_name: string;
}

export interface DiskUsage {
  total: string;
  total_bytes: number;
  output: string;
  voices: string;
  logs: string;
  temp: string;
  jobs: string;
  database: string;
}

export interface RecentError {
  timestamp: string;
  message: string;
  request_id: string;
}

export interface ActivityResponse {
  generations: GenerationActivity[];
  disk: DiskUsage;
  errors: RecentError[];
}

export function fetchActivity(limit = 20): Promise<ActivityResponse> {
  return getJson<ActivityResponse>(`/activity?limit=${limit}`);
}
