/**
 * P2: the synth form's "Pacing / pauses" lever rides on the request as
 * ``pause_scale``. The API client must forward ``params.pauseScale``
 * verbatim — it's the only thing that scales the backend's inter-chunk
 * silences, decoupled from ``speed``.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { SynthesisParams } from "@/types/domain";

import { server } from "../__tests__/mocks/server";
import type { SynthesisRequestDTO } from "./types";

import { synthesize } from "./synthesis";

function captureSynthesisBody(): Promise<SynthesisRequestDTO> {
  return new Promise((resolve) => {
    server.use(
      http.post("/api/synthesize", async ({ request }) => {
        const body = (await request.json()) as SynthesisRequestDTO;
        resolve(body);
        const fakeAudio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
        return new HttpResponse(fakeAudio, {
          headers: {
            "Content-Type": "audio/mp3",
            "X-Audio-Duration": "1.0",
            "X-Audio-Size": String(fakeAudio.length),
            "X-Audio-Engine": "edge-tts",
            "X-Audio-Chunks": "1",
          },
        });
      }),
    );
  });
}

const BASE_PARAMS: SynthesisParams = {
  text: "Hola mundo.",
  voiceId: "es-ES-AlvaroNeural",
  format: "mp3",
  speed: 100,
  pauseScale: 1,
  pitch: 0,
  volume: 80,
};

describe("synthesize", () => {
  it("forwards pauseScale as pause_scale", async () => {
    const captured = captureSynthesisBody();
    await synthesize({ ...BASE_PARAMS, pauseScale: 1.8 });
    const body = await captured;
    expect(body.pause_scale).toBe(1.8);
  });

  it("keeps pauseScale decoupled from speed", async () => {
    const captured = captureSynthesisBody();
    await synthesize({ ...BASE_PARAMS, speed: 100, pauseScale: 2.5 });
    const body = await captured;
    expect(body.speed).toBe(100);
    expect(body.pause_scale).toBe(2.5);
  });
});
