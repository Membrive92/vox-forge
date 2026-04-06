/**
 * Tests de integración del flujo completo de la App.
 *
 * Cubren las interacciones de usuario end-to-end contra MSW:
 * - Navegación entre tabs
 * - Síntesis de audio
 * - CRUD de perfiles
 * - Cambio de idioma
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

describe("App — navegación", () => {
  it("renderiza header y tab Sintetizar por defecto", () => {
    renderApp();
    expect(screen.getByText("VoxForge")).toBeInTheDocument();
    // Textarea de síntesis visible
    expect(
      screen.getByPlaceholderText(/escribe o pega/i),
    ).toBeInTheDocument();
  });

  it("navega al tab Perfiles y muestra estado vacío", async () => {
    const { user } = renderApp();
    await user.click(screen.getByText("Perfiles"));
    expect(screen.getByText(/no hay perfiles/i)).toBeInTheDocument();
  });

  it("navega al tab Voces y muestra zona de upload", async () => {
    const { user } = renderApp();
    await user.click(screen.getByText("Voces"));
    expect(screen.getByText(/subir muestra de voz/i)).toBeInTheDocument();
  });
});

describe("App — síntesis de audio", () => {
  it("botón Generar está desactivado sin texto", () => {
    renderApp();
    const btn = screen.getByText("Generar Audio");
    expect(btn).toBeDisabled();
  });

  it("genera audio y muestra controles de reproducción", async () => {
    const { user } = renderApp();
    const textarea = screen.getByPlaceholderText(/escribe o pega/i);
    await user.type(textarea, "Hola mundo");

    const genBtn = screen.getByText("Generar Audio");
    expect(genBtn).toBeEnabled();
    await user.click(genBtn);

    // Espera a que termine la síntesis (MSW responde al instante)
    await waitFor(
      () => {
        expect(screen.getByText(/audio listo/i)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});

describe("App — CRUD de perfiles", () => {
  it("crea un perfil desde el tab Voces", async () => {
    const { user } = renderApp();
    await user.click(screen.getByText("Voces"));

    const nameInput = screen.getByPlaceholderText(/ej:/i);
    await user.type(nameInput, "Mi voz");

    const saveBtn = screen.getByText("Guardar perfil");
    await user.click(saveBtn);

    // Toast de confirmación
    await waitFor(() => {
      expect(screen.getByText(/perfil guardado/i)).toBeInTheDocument();
    });

    // El perfil aparece en la lista
    await user.click(screen.getByText("Perfiles"));
    await waitFor(() => {
      expect(screen.getByText("Mi voz")).toBeInTheDocument();
    });
  });

  it("elimina un perfil", async () => {
    const { user } = renderApp();

    // Crear primero
    await user.click(screen.getByText("Voces"));
    await user.type(screen.getByPlaceholderText(/ej:/i), "Borrable");
    await user.click(screen.getByText("Guardar perfil"));
    await waitFor(() => expect(screen.getByText(/perfil guardado/i)).toBeInTheDocument());

    // Ir a Perfiles y eliminar
    await user.click(screen.getByText("Perfiles"));
    await waitFor(() => expect(screen.getByText("Borrable")).toBeInTheDocument());

    const deleteBtn = screen.getByLabelText("Eliminar");
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(screen.queryByText("Borrable")).not.toBeInTheDocument();
    });
  });
});

describe("App — cambio de idioma", () => {
  it("cambia la UI a inglés al pulsar el toggle", async () => {
    const { user } = renderApp();

    // Buscar y pulsar el toggle de idioma
    const langBtn = screen.getByLabelText("Idioma");
    await user.click(langBtn);

    // Ahora la UI debería estar en inglés
    await waitFor(() => {
      expect(screen.getByText("EN")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(/type or paste/i),
      ).toBeInTheDocument();
    });
  });
});
