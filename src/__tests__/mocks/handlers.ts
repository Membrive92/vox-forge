/** MSW request handlers that simulate the backend. */
import { http, HttpResponse } from "msw";

import type { ProfileDTO, SynthesisRequestDTO } from "@/api/types";

let profiles: ProfileDTO[] = [];
let nextId = 1;

function makeProfile(overrides: Partial<ProfileDTO> = {}): ProfileDTO {
  const id = String(nextId++);
  return {
    id,
    name: `Profile ${id}`,
    voice_id: "es-ES-AlvaroNeural",
    language: "es",
    speed: 100,
    pitch: 0,
    volume: 80,
    sample_filename: null,
    sample_duration: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function resetProfiles(): void {
  profiles = [];
  nextId = 1;
}

export const handlers = [
  // Health
  http.get("/api/health", () =>
    HttpResponse.json({
      status: "healthy",
      version: "1.0.0",
      profiles_count: profiles.length,
      voices: { es: 6, en: 6 },
      formats: ["mp3", "wav", "ogg", "flac"],
    }),
  ),

  // Voices
  http.get("/api/voices", () =>
    HttpResponse.json({
      es: {
        "es-ES-AlvaroNeural": { name: "Álvaro", gender: "M", accent: "España" },
      },
      en: {
        "en-US-JennyNeural": { name: "Jenny", gender: "F", accent: "US" },
      },
    }),
  ),

  // Profiles CRUD
  http.get("/api/profiles", () => HttpResponse.json(profiles)),

  http.get("/api/profiles/:id", ({ params }) => {
    const found = profiles.find((p) => p.id === params["id"]);
    if (!found) return HttpResponse.json({ detail: "Not found", code: "profile_not_found" }, { status: 404 });
    return HttpResponse.json(found);
  }),

  http.post("/api/profiles", async ({ request }) => {
    const fd = await request.formData();
    const profile = makeProfile({
      name: fd.get("name") as string,
      voice_id: fd.get("voice_id") as string,
      language: (fd.get("language") as ProfileDTO["language"]) ?? "es",
      speed: Number(fd.get("speed") ?? 100),
      pitch: Number(fd.get("pitch") ?? 0),
      volume: Number(fd.get("volume") ?? 80),
    });
    profiles.push(profile);
    return HttpResponse.json(profile);
  }),

  http.patch("/api/profiles/:id", async ({ params, request }) => {
    const found = profiles.find((p) => p.id === params["id"]);
    if (!found) return HttpResponse.json({ detail: "Not found" }, { status: 404 });
    const body = (await request.json()) as Partial<ProfileDTO>;
    Object.assign(found, body, { updated_at: new Date().toISOString() });
    return HttpResponse.json(found);
  }),

  http.delete("/api/profiles/:id", ({ params }) => {
    const idx = profiles.findIndex((p) => p.id === params["id"]);
    if (idx === -1) return HttpResponse.json({ detail: "Not found" }, { status: 404 });
    profiles.splice(idx, 1);
    return HttpResponse.json({ status: "deleted", id: params["id"] });
  }),

  // Synthesis — returns a fake audio blob
  http.post("/api/synthesize", async ({ request }) => {
    const body = (await request.json()) as SynthesisRequestDTO;
    const fakeAudio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // fake mp3 frame header
    return new HttpResponse(fakeAudio, {
      headers: {
        "Content-Type": `audio/${body.output_format}`,
        "X-Audio-Duration": "1.5",
        "X-Audio-Size": String(fakeAudio.length),
        "X-Audio-Engine": "edge-tts",
        "X-Audio-Chunks": "1",
      },
    });
  }),

  // Sample serve
  http.get("/api/voices/samples/:filename", () => {
    return new HttpResponse(new Uint8Array([0]), {
      headers: { "Content-Type": "audio/wav" },
    });
  }),
];
