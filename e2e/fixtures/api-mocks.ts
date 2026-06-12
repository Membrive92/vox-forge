/**
 * Reusable API mocks for Playwright E2E tests.
 *
 * The frontend reads `VITE_API_BASE` (or defaults to "/api"). With Vite's
 * dev proxy not configured, "/api/..." resolves against the same origin —
 * so we intercept "**\/api/**" and respond with whatever shape the
 * backend would return. State lives in a simple in-memory store the
 * tests can introspect via the returned handle.
 */
import type { Page, Route } from "@playwright/test";

export interface ProfileDTO {
  id: string;
  name: string;
  voice_id: string;
  language: string;
  speed: number;
  pitch: number;
  volume: number;
  /** Conditioning sample filenames (0-5, VOZ-10). */
  samples: string[];
  /** Deprecated readonly alias of samples[0]. */
  sample_filename: string | null;
  sample_duration: number | null;
  created_at: string;
  updated_at: string;
}

export interface MockState {
  profiles: ProfileDTO[];
  experimentalCalls: ExperimentalCall[];
  candidatesCalls: CandidatesCall[];
  synthesisCalls: SynthesisCall[];
  /** Override default reference-voice configured state per test. */
  setReferenceVoice: (status: { configured: boolean; filename?: string }) => void;
}

export interface ExperimentalCall {
  text: string;
  language: string;
  output_format: string;
  speed: number | null;
  hasVoiceSample: boolean;
  castilianWarmup: boolean;
  useCastilianReference: boolean;
}

export interface CandidatesCall {
  text: string;
  candidates: number;
  castilianWarmup: boolean;
  useCastilianReference: boolean;
}

export interface SynthesisCall {
  text: string;
  voice_id: string;
  output_format: string;
  profile_id?: string;
  speed: number;
}

/**
 * Install API mocks on the given page. Returns a handle that lets tests
 * inspect what was sent to "the backend" and mutate the in-memory state.
 */
export async function installApiMocks(page: Page): Promise<MockState> {
  let referenceVoice: { configured: boolean; filename?: string } = { configured: false };
  const state: MockState = {
    profiles: [],
    experimentalCalls: [],
    candidatesCalls: [],
    synthesisCalls: [],
    setReferenceVoice: (s) => {
      referenceVoice = s;
    },
  };
  let nextId = 1;
  const fakeMp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

  function makeProfile(overrides: Partial<ProfileDTO>): ProfileDTO {
    const id = String(nextId++);
    const now = new Date().toISOString();
    return {
      id,
      name: overrides.name ?? `Profile ${id}`,
      voice_id: overrides.voice_id ?? "es-ES-AlvaroNeural",
      language: overrides.language ?? "es",
      speed: overrides.speed ?? 100,
      pitch: overrides.pitch ?? 0,
      volume: overrides.volume ?? 80,
      samples: overrides.samples ?? [],
      sample_filename: overrides.sample_filename ?? null,
      sample_duration: overrides.sample_duration ?? null,
      created_at: now,
      updated_at: now,
    };
  }

  // IMPORTANT: Playwright evaluates routes in REVERSE order of registration
  // (last-registered wins). Register the catch-all FIRST so the specific
  // handlers below override it.
  await page.route("http://localhost:5180/api/**", (route: Route) => {
    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: `{"detail":"E2E mock missing for ${route.request().method()} ${route.request().url()}"}`,
    });
  });

  await page.route("http://localhost:5180/api/health", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "healthy",
        version: "1.0.0",
        profiles_count: state.profiles.length,
        voices: { es: 6, en: 6 },
        formats: ["mp3", "wav", "ogg", "flac"],
      }),
    }),
  );

  await page.route("http://localhost:5180/api/voices", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        es: { "es-ES-AlvaroNeural": { name: "Álvaro", gender: "M", accent: "España" } },
        en: { "en-US-JennyNeural": { name: "Jenny", gender: "F", accent: "US" } },
      }),
    }),
  );

  await page.route("http://localhost:5180/api/profiles*", async (route: Route) => {
    const url = new URL(route.request().url());
    const idMatch = url.pathname.match(/\/profiles\/([^/]+)$/);
    const method = route.request().method();

    if (method === "GET" && !idMatch) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.profiles),
      });
    }

    if (method === "POST" && !idMatch) {
      const post = route.request().postDataBuffer();
      // FormData parsing in raw bytes is messy — instead, parse the
      // multipart body manually for the fields we care about.
      const text = post?.toString("utf-8") ?? "";
      const grab = (field: string): string | null => {
        const re = new RegExp(
          `name="${field}"\\r?\\n\\r?\\n([^\\r\\n-]*)`,
        );
        const m = text.match(re);
        return m ? m[1]!.trim() : null;
      };
      const profile = makeProfile({
        name: grab("name") ?? "Untitled",
        voice_id: grab("voice_id") ?? "es-ES-AlvaroNeural",
        language: (grab("language") as ProfileDTO["language"]) ?? "es",
        speed: Number(grab("speed") ?? 100),
        pitch: Number(grab("pitch") ?? 0),
        volume: Number(grab("volume") ?? 80),
      });
      // Detect if a sample was uploaded
      if (text.includes('name="sample"')) {
        profile.samples = [`${profile.id}_voice.wav`];
        profile.sample_filename = profile.samples[0]!;
        profile.sample_duration = 1.5;
      }
      state.profiles.push(profile);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(profile),
      });
    }

    if (idMatch) {
      const id = idMatch[1]!;
      const found = state.profiles.find((p) => p.id === id);
      if (!found) {
        return route.fulfill({ status: 404, body: '{"detail":"Not found"}' });
      }
      if (method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(found),
        });
      }
      if (method === "PATCH") {
        const body = JSON.parse(route.request().postData() || "{}");
        Object.assign(found, body, { updated_at: new Date().toISOString() });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(found),
        });
      }
      if (method === "DELETE") {
        state.profiles = state.profiles.filter((p) => p.id !== id);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "deleted", id }),
        });
      }
    }

    return route.continue();
  });

  await page.route("http://localhost:5180/api/synthesize", async (route: Route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    state.synthesisCalls.push({
      text: body.text,
      voice_id: body.voice_id,
      output_format: body.output_format,
      profile_id: body.profile_id,
      speed: body.speed ?? 100,
    });
    await route.fulfill({
      status: 200,
      contentType: `audio/${body.output_format ?? "mp3"}`,
      headers: {
        "X-Audio-Duration": "1.5",
        "X-Audio-Size": String(fakeMp3.length),
        "X-Audio-Engine": "edge-tts",
        "X-Audio-Chunks": "1",
      },
      body: fakeMp3,
    });
  });

  await page.route("http://localhost:5180/api/experimental/cross-lingual", async (route: Route) => {
    const text = route.request().postDataBuffer()?.toString("utf-8") ?? "";
    const grab = (field: string): string | null => {
      const re = new RegExp(`name="${field}"\\r?\\n\\r?\\n([^\\r\\n-]*)`);
      const m = text.match(re);
      return m ? m[1]!.trim() : null;
    };
    state.experimentalCalls.push({
      text: grab("text") ?? "",
      language: grab("language") ?? "es",
      output_format: grab("output_format") ?? "mp3",
      speed: grab("speed") ? Number(grab("speed")) : null,
      hasVoiceSample: text.includes('name="voice_sample"'),
      castilianWarmup: grab("castilian_warmup") === "true",
      useCastilianReference: grab("use_castilian_reference") === "true",
    });
    await route.fulfill({
      status: 200,
      contentType: "audio/mp3",
      headers: { "X-Audio-Duration": "1.5" },
      body: fakeMp3,
    });
  });

  await page.route(
    "http://localhost:5180/api/experimental/cross-lingual/candidates",
    async (route: Route) => {
      const text = route.request().postDataBuffer()?.toString("utf-8") ?? "";
      const grab = (field: string): string | null => {
        const re = new RegExp(`name="${field}"\\r?\\n\\r?\\n([^\\r\\n-]*)`);
        const m = text.match(re);
        return m ? m[1]!.trim() : null;
      };
      const count = Number(grab("candidates") ?? "1");
      state.candidatesCalls.push({
        text: grab("text") ?? "",
        candidates: count,
        castilianWarmup: grab("castilian_warmup") === "true",
        useCastilianReference: grab("use_castilian_reference") === "true",
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: Array.from({ length: count }, (_, i) => ({
            id: `take_${i}`,
            path: `/fake/output/take_${i}.mp3`,
            duration_s: 1.5,
          })),
          count,
          language: grab("language") ?? "es",
          castilian_warmup: grab("castilian_warmup") === "true",
          castilian_reference: grab("use_castilian_reference") === "true",
        }),
      });
    },
  );

  await page.route(
    /\/api\/experimental\/reference-voice/,
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          referenceVoice.configured
            ? { configured: true, filename: referenceVoice.filename ?? "ref.wav", duration_s: 12 }
            : { configured: false },
        ),
      }),
  );

  // Studio audio serving — used to play candidate takes in the picker.
  await page.route(/\/api\/studio\/audio/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/mp3",
      body: fakeMp3,
    }),
  );

  // Logging endpoints (badge polling) — keep them quiet
  await page.route(/\/api\/logs\/error-count/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"count":0}',
    }),
  );

  // Projects — empty by default; tests that need projects should override.
  // listProjects() expects a raw array, not a wrapped object.
  await page.route(/\/api\/projects(\?|$|\/)/, (route: Route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    }
    return route.continue();
  });

  // Activity / stats endpoints used by the Activity tab.
  await page.route(/\/api\/stats/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"generations":0,"profiles":0,"errors_24h":0}',
    }),
  );

  // In-flight synthesis recovery endpoint (called on app boot).
  await page.route(/\/api\/synthesize\/incomplete/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"jobs":[]}',
    }),
  );

  return state;
}
