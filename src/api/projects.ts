/** Projects & chapters API client. */

import { deleteResource, getJson, patchJson, postJson } from "./client";

export interface Project {
  id: string;
  name: string;
  description: string;
  language: string;
  voice_id: string;
  profile_id: string | null;
  speed: number;
  pitch: number;
  volume: number;
  output_format: string;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  project_id: string;
  title: string;
  text: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Generation {
  id: string;
  chapter_id: string;
  voice_id: string;
  profile_id: string | null;
  output_format: string;
  speed: number;
  pitch: number;
  volume: number;
  engine: string;
  duration: number;
  file_path: string | null;
  chunks_total: number;
  chunks_done: number;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Take {
  id: string;
  generation_id: string;
  chunk_index: number;
  chunk_text: string;
  file_path: string | null;
  duration: number;
  score: number;
  status: string;
  created_at: string;
}

// ── Projects ────────────────────────────────────────────────────────

export function listProjects(): Promise<Project[]> {
  return getJson<Project[]>("/projects");
}

export function getProject(id: string): Promise<Project> {
  return getJson<Project>(`/projects/${id}`);
}

export function createProject(data: Partial<Omit<Project, "id" | "created_at" | "updated_at">> & { name: string }): Promise<Project> {
  return postJson<Project>("/projects", data);
}

export function updateProject(id: string, data: Partial<Project>): Promise<Project> {
  return patchJson<Project>(`/projects/${id}`, data);
}

export function deleteProject(id: string): Promise<void> {
  return deleteResource(`/projects/${id}`);
}

// ── Chapters ────────────────────────────────────────────────────────

export function listChapters(projectId: string): Promise<Chapter[]> {
  return getJson<Chapter[]>(`/projects/${projectId}/chapters`);
}

export function createChapter(projectId: string, data: { title?: string; text?: string; sort_order?: number }): Promise<Chapter> {
  return postJson<Chapter>(`/projects/${projectId}/chapters`, data);
}

export function updateChapter(chapterId: string, data: Partial<Chapter>): Promise<Chapter> {
  return patchJson<Chapter>(`/projects/chapters/${chapterId}`, data);
}

export function deleteChapter(chapterId: string): Promise<void> {
  return deleteResource(`/projects/chapters/${chapterId}`);
}

export function splitIntoChapters(projectId: string, text: string, delimiter: "heading" | "separator" = "heading"): Promise<Chapter[]> {
  return postJson<Chapter[]>(`/projects/${projectId}/split`, { text, delimiter });
}

// ── Generations & Takes ─────────────────────────────────────────────

export function listGenerations(chapterId: string): Promise<Generation[]> {
  return getJson<Generation[]>(`/projects/chapters/${chapterId}/generations`);
}

export function listTakes(generationId: string): Promise<Take[]> {
  return getJson<Take[]>(`/projects/generations/${generationId}/takes`);
}
