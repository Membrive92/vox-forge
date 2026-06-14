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
export type MediaAssetDTO = Schema["MediaAsset"];
export type MediaAssetsResponseDTO = Schema["MediaAssetsResponse"];
export type MediaGenerateRequestDTO = Schema["MediaGenerateRequest"];

/** Shape of an error response. ``detail`` is a string for our domain
 * errors and for bare HTTPExceptions, but FastAPI's request-validation
 * errors (422) make it an array of ``{loc, msg, type}`` entries. */
export interface ValidationDetail {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

export interface ApiErrorBody {
  detail: string | ValidationDetail[];
  code?: string;
}
