/** Projects & chapters API client. */

import { deleteResource, getJson, patchJson, postJson } from "./client";
import type { components } from "./generated";

// Derived from the backend's Pydantic response models (single source of
// truth) — a column rename/type change now fails `npm run openapi` + tsc
// instead of silently handing the UI undefined fields.
export type Project = components["schemas"]["ProjectResponse"];
export type Chapter = components["schemas"]["ChapterResponse"];
export type Generation = components["schemas"]["GenerationResponse"];
export type Take = components["schemas"]["TakeResponse"];

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
