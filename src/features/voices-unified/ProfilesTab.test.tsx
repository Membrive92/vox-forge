/**
 * VOZ-10 UI contract for the profile sample manager:
 * - every stored sample renders its own row with play/analyze/download/
 *   delete controls and the counter shows n/5;
 * - deleting a sample asks for confirmation, then calls removeSample on
 *   the shared profiles context;
 * - picking a file in the add-sample input calls addSample;
 * - a full profile (5 samples) hides the add controls and shows the
 *   limit hint;
 * - analyzing a sample renders the QualityFeedback block including the
 *   rhythm metric (syllables/second).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/__tests__/mocks/server";
import type { ProfilesState } from "@/hooks/useProfiles";
import { ProfilesContext } from "@/hooks/profilesContext";
import { es } from "@/i18n/es";
import type { Profile } from "@/types/domain";

import { ProfilesTab } from "./ProfilesTab";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    name: "Narrador",
    voiceId: "es-ES-AlvaroNeural",
    lang: "es",
    speed: 100,
    pitch: 0,
    volume: 80,
    samples: ["a.wav", "b.wav"],
    sampleDuration: 7.5,
    castilianAnchor: false,
    ...overrides,
  };
}

function makeProfilesState(profile: Profile): ProfilesState {
  return {
    profiles: [profile],
    error: null,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addSample: vi.fn().mockResolvedValue(profile),
    removeSample: vi.fn().mockResolvedValue(profile),
  };
}

function renderTab(profile: Profile, state: ProfilesState, onToast = vi.fn()) {
  return render(
    <ProfilesContext.Provider value={state}>
      <ProfilesTab
        t={es}
        profiles={[profile]}
        onUse={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleCastilianAnchor={vi.fn()}
        onNew={vi.fn()}
        onToast={onToast}
        samplePlayer={{ playingFilename: null, toggle: vi.fn() }}
        voicePreview={{ previewingId: null, loadingId: null, toggle: vi.fn() }}
      />
    </ProfilesContext.Provider>,
  );
}

describe("ProfilesTab sample manager (VOZ-10)", () => {
  it("renders one row per sample with the n/5 counter", () => {
    const profile = makeProfile();
    renderTab(profile, makeProfilesState(profile));

    expect(screen.getByText("a.wav")).toBeInTheDocument();
    expect(screen.getByText("b.wav")).toBeInTheDocument();
    expect(screen.getByText(`${es.profileSamples} (2/5)`)).toBeInTheDocument();
    expect(screen.getByText(`+ ${es.profileAddSample}`)).toBeInTheDocument();
    // Curation recipe hint is visible
    expect(screen.getByText(es.profileSamplesHint)).toBeInTheDocument();
  });

  it("confirms before removing a sample and calls removeSample", async () => {
    const user = userEvent.setup();
    const profile = makeProfile();
    const state = makeProfilesState(profile);
    const onToast = vi.fn();
    window.confirm = vi.fn(() => true);
    renderTab(profile, state, onToast);

    const deleteButtons = screen.getAllByRole("button", { name: es.profileDeleteSample });
    expect(deleteButtons).toHaveLength(2);
    await user.click(deleteButtons[0]!);

    expect(state.removeSample).toHaveBeenCalledWith("p1", "a.wav");
    expect(onToast).toHaveBeenCalledWith(es.profileSampleRemoved);
  });

  it("does not remove when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const profile = makeProfile();
    const state = makeProfilesState(profile);
    window.confirm = vi.fn(() => false);
    renderTab(profile, state);

    await user.click(
      screen.getAllByRole("button", { name: es.profileDeleteSample })[0]!,
    );
    expect(state.removeSample).not.toHaveBeenCalled();
  });

  it("uploads a picked file through addSample", async () => {
    const user = userEvent.setup();
    const profile = makeProfile();
    const state = makeProfilesState(profile);
    const onToast = vi.fn();
    const { container } = renderTab(profile, state, onToast);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["RIFF"], "extra.wav", { type: "audio/wav" });
    await user.upload(input, file);

    expect(state.addSample).toHaveBeenCalledWith("p1", file);
    expect(onToast).toHaveBeenCalledWith(es.profileSampleAdded);
  });

  it("hides add controls and shows the limit hint at 5 samples", () => {
    const profile = makeProfile({
      samples: ["1.wav", "2.wav", "3.wav", "4.wav", "5.wav"],
    });
    renderTab(profile, makeProfilesState(profile));

    expect(screen.queryByText(`+ ${es.profileAddSample}`)).not.toBeInTheDocument();
    expect(screen.getByText(es.profileSamplesFull)).toBeInTheDocument();
  });

  it("analyzes a sample and shows the rhythm metric", async () => {
    server.use(
      http.post("/api/analyze/sample", () =>
        HttpResponse.json({
          duration_s: 7.2,
          sample_rate: 44100,
          channels: 1,
          peak_dbfs: -6.0,
          rms_amplitude: 1000,
          snr_db: 20.0,
          clip_ratio: 0,
          silence_ratio: 0.1,
          rhythm_sps: 5.4,
          rating: "good",
          issues: [],
        }),
      ),
    );
    const user = userEvent.setup();
    const profile = makeProfile({ samples: ["a.wav"] });
    renderTab(profile, makeProfilesState(profile));

    await user.click(screen.getByRole("button", { name: es.profileAnalyzeSample }));

    expect(
      await screen.findByText(new RegExp(`5\\.4 ${es.sampleRhythmUnit}`)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${es.sampleQuality}: ${es.sampleQualityGood}`),
    ).toBeInTheDocument();
  });
});
