/**
 * Integration tests for the full App flow.
 *
 * Cover end-to-end user interactions against MSW:
 * - Tab navigation
 * - Audio synthesis
 * - Profile CRUD
 * - Language switching
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { resetProfiles } from "./__tests__/mocks/handlers";
import App from "./App";

afterEach(() => resetProfiles());

function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  return { user };
}

async function openQuickSynth(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // Default tab is now Workbench; navigate to Quick Synth (ES label = "Síntesis rápida")
  await user.click(screen.getByText(/síntesis rápida/i));
}

describe("App — navigation", () => {
  it("renders header and Workbench tab by default", () => {
    renderApp();
    expect(screen.getByText("VoxForge")).toBeInTheDocument();
    // Workbench is now the default — sidebar "+ New Project" button is visible
    expect(screen.getByText("+ New Project")).toBeInTheDocument();
  });

  it("navigates to Quick Synth and shows the textarea", async () => {
    const { user } = renderApp();
    await openQuickSynth(user);
    expect(screen.getByPlaceholderText(/escribe o pega/i)).toBeInTheDocument();
  });

  it("navigates to Voices tab and shows empty profiles state", async () => {
    const { user } = renderApp();
    await user.click(screen.getByText("Voces"));
    // Voices tab now contains the profiles section with empty state
    expect(screen.getByText(/no hay perfiles/i)).toBeInTheDocument();
  });

  it("navigates to Voices tab and shows upload zone", async () => {
    const { user } = renderApp();
    await user.click(screen.getByText("Voces"));
    expect(screen.getByText(/subir muestra de voz/i)).toBeInTheDocument();
  });
});

describe("App — audio synthesis", () => {
  it("Generate button is disabled without text", async () => {
    const { user } = renderApp();
    await openQuickSynth(user);
    const btn = screen.getByText("Generar Audio");
    expect(btn).toBeDisabled();
  });

  it("generates audio and shows playback controls", async () => {
    const { user } = renderApp();
    await openQuickSynth(user);
    const textarea = screen.getByPlaceholderText(/escribe o pega/i);
    await user.type(textarea, "Hello world");

    const genBtn = screen.getByText("Generar Audio");
    expect(genBtn).toBeEnabled();
    await user.click(genBtn);

    // Wait for synthesis to complete (MSW responds instantly)
    await waitFor(
      () => {
        expect(screen.getByText(/audio listo/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("shows EDGE-TTS engine badge after generation", async () => {
    const { user } = renderApp();
    await openQuickSynth(user);
    const textarea = screen.getByPlaceholderText(/escribe o pega/i);
    await user.type(textarea, "Test");
    await user.click(screen.getByText("Generar Audio"));

    await waitFor(
      () => {
        expect(screen.getByText("EDGE-TTS")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("shows engine label in toast after generation", async () => {
    const { user } = renderApp();
    await openQuickSynth(user);
    const textarea = screen.getByPlaceholderText(/escribe o pega/i);
    await user.type(textarea, "Test toast");
    await user.click(screen.getByText("Generar Audio"));

    await waitFor(
      () => {
        // Toast should contain both "Audio listo" and the engine label
        expect(screen.getByText(/voz del sistema/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});

describe("App — profile CRUD", () => {
  it("creates a profile from the Voices tab", async () => {
    const { user } = renderApp();
    await user.click(screen.getByText("Voces"));

    const nameInput = screen.getByPlaceholderText(/ej:/i);
    await user.type(nameInput, "My voice");

    const saveBtn = screen.getByText("Guardar perfil");
    await user.click(saveBtn);

    // Confirmation toast
    await waitFor(() => {
      expect(screen.getByText(/perfil guardado/i)).toBeInTheDocument();
    });

    // Profile appears in the "My profiles" section of the same tab
    await waitFor(() => {
      expect(screen.getByText("My voice")).toBeInTheDocument();
    });
  });

  it("deletes a profile", async () => {
    const { user } = renderApp();

    // Create first
    await user.click(screen.getByText("Voces"));
    await user.type(screen.getByPlaceholderText(/ej:/i), "Deletable");
    await user.click(screen.getByText("Guardar perfil"));
    await waitFor(() => expect(screen.getByText(/perfil guardado/i)).toBeInTheDocument());

    // Profile appears in the same tab (no navigation needed)
    await waitFor(() => expect(screen.getByText("Deletable")).toBeInTheDocument());

    const deleteBtn = screen.getByLabelText("Eliminar");
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(screen.queryByText("Deletable")).not.toBeInTheDocument();
    });
  });
});

describe("App — language switch", () => {
  it("switches UI to English when toggling", async () => {
    const { user } = renderApp();

    const langBtn = screen.getByLabelText("Idioma");
    await user.click(langBtn);

    // UI should now be in English — header label updates immediately
    await waitFor(() => {
      expect(screen.getByText("EN")).toBeInTheDocument();
    });

    // Navigate to Quick Synth (now labelled in English) and verify textarea
    await user.click(screen.getByText(/quick synth/i));
    expect(screen.getByPlaceholderText(/type or paste/i)).toBeInTheDocument();
  });
});
