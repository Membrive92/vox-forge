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

import { resetExperimentalCalls, resetProfiles } from "./__tests__/mocks/handlers";
import App from "./App";

afterEach(() => {
  resetProfiles();
  resetExperimentalCalls();
});

function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  return { user };
}

async function openVoices(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // After Sprint A, the Voices tab is labeled "Mis voces" and contains
  // the lab section (formerly the standalone Quick Synth tab) below the
  // gallery. The standalone Quick Synth tab no longer exists.
  await user.click(screen.getByText(/^mis voces$/i));
}

describe("App — navigation", () => {
  it("renders header and Workbench tab by default", () => {
    renderApp();
    expect(screen.getByText("VoxForge")).toBeInTheDocument();
    // Workbench (now "Mis libros") is the default — sidebar "+ Nuevo proyecto" CTA visible
    expect(screen.getByText("+ Nuevo proyecto")).toBeInTheDocument();
  });

  it("nav exposes only the three Sprint A destinations", () => {
    renderApp();
    expect(screen.getByText(/^mis libros$/i)).toBeInTheDocument();
    expect(screen.getByText(/^mis voces$/i)).toBeInTheDocument();
    expect(screen.getByText(/^actividad$/i)).toBeInTheDocument();
    // Quick Synth as a standalone tab is gone — its content lives inside Mis voces
    expect(screen.queryByText(/^síntesis rápida$/i)).toBeNull();
    // Studio as a top-level destination is gone too (still reachable via intent)
    expect(screen.queryByText(/^estudio$/i)).toBeNull();
  });

  it("navigates to Voices tab and shows the lab textarea", async () => {
    const { user } = renderApp();
    await openVoices(user);
    expect(screen.getByPlaceholderText(/escribe o pega/i)).toBeInTheDocument();
  });

  it("navigates to Voices tab and shows empty profiles state", async () => {
    const { user } = renderApp();
    await openVoices(user);
    expect(screen.getByText(/no hay perfiles/i)).toBeInTheDocument();
  });

  it("navigates to Voices tab and shows upload zone", async () => {
    const { user } = renderApp();
    await openVoices(user);
    expect(screen.getByText(/subir muestra de voz/i)).toBeInTheDocument();
  });
});

describe("App — audio synthesis (lab section)", () => {
  it("Generate button is disabled without text", async () => {
    const { user } = renderApp();
    await openVoices(user);
    const btn = screen.getByText("Generar Audio");
    expect(btn).toBeDisabled();
  });

  it("generates audio and shows playback controls", async () => {
    const { user } = renderApp();
    await openVoices(user);
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
    await openVoices(user);
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
    await openVoices(user);
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
    await openVoices(user);

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
    await openVoices(user);
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

// ──────────────────────────────────────────────────────────────────
// Regression suite — covers bugs that previously slipped past tests
// because they live at component boundaries, not inside one component.
// ──────────────────────────────────────────────────────────────────

describe("App — regressions: profile edit flow", () => {
  it("clicking edit on a profile fills the form with its values", async () => {
    // Bug: Edit button was wired but didn't scroll into view, leaving users
    // confused that "nothing happened". Verify the form is populated.
    const { user } = renderApp();
    await openVoices(user);

    // Create a profile with distinctive values
    await user.type(screen.getByPlaceholderText(/ej:/i), "Editable Voice");
    await user.click(screen.getByText("Guardar perfil"));
    await waitFor(() => expect(screen.getByText("Editable Voice")).toBeInTheDocument());

    // Click the edit (pencil) icon — labelled via aria-label "Editar" (ES)
    const editBtn = screen.getByLabelText(/^editar$|^edit$/i);
    await user.click(editBtn);

    // Form should be populated with the profile's name
    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText(/ej:/i) as HTMLInputElement;
      expect(nameInput.value).toBe("Editable Voice");
    });

    // Save button label should change to "Confirm" (editing mode)
    expect(screen.getByText(/confirmar|confirm/i)).toBeInTheDocument();
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

    // Navigate to "My voices" (lab section now lives there in EN too)
    await user.click(screen.getByText(/^my voices$/i));
    expect(screen.getByPlaceholderText(/type or paste/i)).toBeInTheDocument();
  });
});
