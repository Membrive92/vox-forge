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

export interface ApiErrorBody {
  detail: string;
  code?: string;
}
