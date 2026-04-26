/**
 * Regression tests for ExperimentalTab.
 *
 * Focuses on the contract between ExperimentalTab and its parent:
 * - Speed param flows from UI -> API call (was silently dropped)
 * - Profile creation uses the parent-provided callback (so the parent's
 *   profile list updates and the new profile appears in the Voices tab).
 * - Castilian-accent controls (B, D1) round-trip to the backend.
 * - Multi-candidate flow (C) hits the right endpoint with the right count.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/__tests__/mocks/server";
import {
  getLastCandidatesCall,
  getLastExperimentalCall,
  resetExperimentalCalls,
  resetProfiles,
} from "@/__tests__/mocks/handlers";
import { es } from "@/i18n/es";

import { ExperimentalTab } from "./ExperimentalTab";

afterEach(() => {
  resetProfiles();
  resetExperimentalCalls();
});

function uploadSample(user: ReturnType<typeof userEvent.setup>, container: HTMLElement): Promise<void> {
  const sample = new File([new Uint8Array([0, 1, 2, 3])], "voice.wav", {
    type: "audio/wav",
  });
  // ExperimentalTab has two file inputs: AudioRecorder's hidden one and
  // the explicit upload input. We want the upload one (accepts audio formats).
  const inputs = container.querySelectorAll<HTMLInputElement>("input[type=file]");
  const uploadInput = Array.from(inputs).find((i) =>
    (i.accept || "").includes(".wav"),
  );
  if (!uploadInput) throw new Error("upload file input not found");
  return user.upload(uploadInput, sample);
}

describe("ExperimentalTab — speed parameter (regression)", () => {
  it("sends the default speed (100) to the backend", async () => {
    const user = userEvent.setup();
    const onToast = vi.fn();
    const { container } = render(<ExperimentalTab t={es} onToast={onToast} />);

    await uploadSample(user, container);

    const textarea = screen.getByPlaceholderText(es.expTextPlaceholder);
    await user.type(textarea, "hola");

    await user.click(screen.getByText(es.expGenerate));

    await waitFor(() => {
      const call = getLastExperimentalCall();
      expect(call).not.toBeNull();
      expect(call!.speed).toBe(100);
      expect(call!.text).toBe("hola");
    }, { timeout: 5000 });
  });

  it("sends a custom speed value when the slider is moved", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExperimentalTab t={es} onToast={vi.fn()} />);

    await uploadSample(user, container);

    // Move the speed slider down to 75% — the previously-broken value.
    // userEvent doesn't fire onChange for range inputs, so use fireEvent.
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "75" } });

    await user.type(screen.getByPlaceholderText(es.expTextPlaceholder), "test");
    await user.click(screen.getByText(es.expGenerate));

    await waitFor(() => {
      const call = getLastExperimentalCall();
      expect(call).not.toBeNull();
      expect(call!.speed).toBe(75);
    }, { timeout: 5000 });
  });
});

describe("ExperimentalTab — Castilian accent controls", () => {
  it("sends castilian_warmup=true when the toggle is checked", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExperimentalTab t={es} onToast={vi.fn()} />);

    await uploadSample(user, container);

    // Toggle the warm-up checkbox by its label
    await user.click(screen.getByLabelText(es.expCastilianWarmup));

    await user.type(screen.getByPlaceholderText(es.expTextPlaceholder), "hola");
    await user.click(screen.getByText(es.expGenerate));

    await waitFor(() => {
      const call = getLastExperimentalCall();
      expect(call).not.toBeNull();
      expect(call!.castilianWarmup).toBe(true);
    }, { timeout: 5000 });
  });

  it("does NOT send the warm-up flag when target language is English", async () => {
    // Castilian warm-up only makes sense for ES targets. The toggle is
    // hidden when language=en, so even if a user previously enabled it,
    // it shouldn't leak into the request.
    const user = userEvent.setup();
    const { container } = render(<ExperimentalTab t={es} onToast={vi.fn()} />);
    await uploadSample(user, container);

    // Switch to English target
    await user.click(screen.getByText("English"));

    // The warm-up checkbox should no longer be in the DOM
    expect(screen.queryByLabelText(es.expCastilianWarmup)).toBeNull();

    await user.type(screen.getByPlaceholderText(es.expTextPlaceholder), "hello");
    await user.click(screen.getByText(es.expGenerate));

    await waitFor(() => {
      const call = getLastExperimentalCall();
      expect(call).not.toBeNull();
      expect(call!.castilianWarmup).toBe(false);
    }, { timeout: 5000 });
  });

  it("disables the reference-voice toggle when none is configured", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExperimentalTab t={es} onToast={vi.fn()} />);
    await uploadSample(user, container);

    // The default mock returns configured=false, so the toggle is disabled.
    const ref = await screen.findByLabelText(es.expCastilianReference);
    expect(ref).toBeDisabled();
  });

  it("sends use_castilian_reference=true when configured + checked", async () => {
    // Override the reference-voice mock to report it as available.
    server.use(
      http.get("/api/experimental/reference-voice", () =>
        HttpResponse.json({
          configured: true,
          filename: "alvaro_castellano.wav",
          duration_s: 12.4,
        }),
      ),
    );

    const user = userEvent.setup();
    const { container } = render(<ExperimentalTab t={es} onToast={vi.fn()} />);
    await uploadSample(user, container);

    // Wait for the reference-voice query to resolve and re-enable the toggle
    const ref = await screen.findByLabelText(es.expCastilianReference);
    await waitFor(() => expect(ref).not.toBeDisabled(), { timeout: 3000 });
    await user.click(ref);

    await user.type(screen.getByPlaceholderText(es.expTextPlaceholder), "hola");
    await user.click(screen.getByText(es.expGenerate));

    await waitFor(() => {
      const call = getLastExperimentalCall();
      expect(call).not.toBeNull();
      expect(call!.useCastilianReference).toBe(true);
    }, { timeout: 5000 });
  });
});

describe("ExperimentalTab — multi-candidate flow", () => {
  it("calls the candidates endpoint with the chosen count", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExperimentalTab t={es} onToast={vi.fn()} />);
    await uploadSample(user, container);

    // Click the "3" button under "Versiones"
    await user.click(screen.getByRole("button", { name: "3" }));

    await user.type(screen.getByPlaceholderText(es.expTextPlaceholder), "hola");
    await user.click(screen.getByText(es.expGenerate));

    await waitFor(() => {
      const call = getLastCandidatesCall();
      expect(call).not.toBeNull();
      expect(call!.candidates).toBe(3);
      expect(call!.text).toBe("hola");
    }, { timeout: 5000 });

    // The single-take endpoint should NOT have been called
    expect(getLastExperimentalCall()).toBeNull();
  });

  it("falls back to the single-take endpoint when count is 1", async () => {
    const user = userEvent.setup();
    const { container } = render(<ExperimentalTab t={es} onToast={vi.fn()} />);
    await uploadSample(user, container);

    // 1 is the default — no need to click. Type and generate.
    await user.type(screen.getByPlaceholderText(es.expTextPlaceholder), "hola");
    await user.click(screen.getByText(es.expGenerate));

    await waitFor(() => {
      expect(getLastExperimentalCall()).not.toBeNull();
    }, { timeout: 5000 });
    expect(getLastCandidatesCall()).toBeNull();
  });
});

describe("ExperimentalTab — profile creation callback (regression)", () => {
  it("uses the onCreateProfile prop when provided (parent's hook, not its own)", async () => {
    // Bug: ExperimentalTab used its own useProfiles() instance, so the parent
    // (App) never saw new profiles. Verify the prop is preferred.
    const user = userEvent.setup();
    const onCreateProfile = vi.fn().mockResolvedValue({ id: "fake-id" });
    const { container } = render(
      <ExperimentalTab
        t={es}
        onToast={vi.fn()}
        onCreateProfile={onCreateProfile}
      />,
    );

    await uploadSample(user, container);

    // Open the save-as-profile dialog
    await user.click(screen.getByText(es.expSaveAsProfile));

    // The dialog title should now be visible
    await screen.findByText(es.expSaveAsProfileTitle);

    // Type the name in the first text input inside the dialog
    const dialog = screen.getByRole("dialog");
    const textInput = dialog.querySelector<HTMLInputElement>('input[type="text"]');
    expect(textInput).not.toBeNull();
    await user.type(textInput!, "Mi voz experimental");

    // Submit by pressing Enter (the form's onSubmit triggers onConfirm)
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onCreateProfile).toHaveBeenCalledTimes(1);
    }, { timeout: 5000 });

    const arg = onCreateProfile.mock.calls[0]![0];
    expect(arg.name).toBe("Mi voz experimental");
    expect(arg.sampleFile).toBeInstanceOf(File);
  });
});
