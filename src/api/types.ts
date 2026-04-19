/** Backend DTOs (snake_case).
 *
 * The schemas listed here are aliases over the auto-generated types in
 * ``generated.ts``. Regenerate with ``npm run openapi`` whenever the
 * backend's Pydantic models change.
 *
 * Hand-written additions (``ApiErrorBody``) stay below — they are not
 * part of the FastAPI-exposed schema but are the shape returned by our
 * custom exception handler.
 */

import type { components } from "./generated";

type Schema = components["schemas"];

export type ProfileDTO = Schema["VoiceProfile"];
export type SynthesisRequestDTO = Schema["SynthesisRequest"];
export type ProfileUpdateDTO = Schema["ProfileUpdate"];
export type SampleUploadResponseDTO = Schema["SampleUploadResponse"];
export type HealthResponseDTO = Schema["HealthResponse"];
export type LogEntryDTO = Schema["LogEntry"];
export type PronunciationEntryDTO = Schema["PronunciationEntry"];
export type IncompleteJobSummaryDTO = Schema["IncompleteJobSummary"];
export type JobProgressResponseDTO = Schema["JobProgressResponse"];
export type StudioSourceDTO = Schema["StudioSource"];
export type StudioEditRequestDTO = Schema["StudioEditRequest"];
export type StudioOperationDTO = Schema["StudioOperation"];

export interface ApiErrorBody {
  detail: string;
  code?: string;
}
