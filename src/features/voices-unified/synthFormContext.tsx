/**
 * Synth-form state for the Voices subtree (BAJO-30).
 *
 * App used to own every piece of the voice-lab form (voice, format,
 * speed/pitch/volume, profile draft, drag state, preview players) and
 * thread ~17 props through VoicesPlusLab → VoicesUnifiedTab → leaves.
 * This context owns that state instead, following the profilesContext
 * pattern: the provider is mounted once in App, consumers read it where
 * they actually use it.
 *
 * App-global state stays out: ``lang`` drives the i18n of the whole app,
 * so it comes in as props; ``toggleLang`` lives here because switching
 * language also resets the selected voice to the new language's default.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { CreateProfileInput } from "@/api/profiles";
import { VOICES } from "@/constants/voices";
import { useSharedProfiles } from "@/hooks/profilesContext";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useSamplePlayer, type SamplePlayerState } from "@/hooks/useSamplePlayer";
import { useVoicePreview, type VoicePreviewState } from "@/hooks/useVoicePreview";
import type { Translations } from "@/i18n";
import type { AudioFormat, Language, Profile, UploadedSample } from "@/types/domain";

import type { ProfileDraft, SynthSettings } from "../state";

export interface SynthFormState {
  settings: SynthSettings;
  draft: ProfileDraft;
  /** Quick Synth editor text (autosaved to localStorage). */
  text: string;
  setText: (v: string) => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  voicePreview: VoicePreviewState;
  samplePlayer: SamplePlayerState;
  /** Flip app language AND reset the selected voice to the new default. */
  toggleLang: () => void;
  saveProfile: () => Promise<void>;
  useProfile: (p: Profile) => void;
  editProfile: (p: Profile) => void;
  deleteProfile: (id: string) => Promise<void>;
  toggleCastilianAnchor: (id: string, value: boolean) => Promise<void>;
  createProfile: (input: CreateProfileInput) => Promise<unknown>;
}

const SynthFormContext = createContext<SynthFormState | null>(null);

export function useSynthForm(): SynthFormState {
  const ctx = useContext(SynthFormContext);
  if (!ctx) {
    // Reaching the synth form without a provider is a wiring mistake —
    // fail loudly instead of rendering a dead form.
    throw new Error("useSynthForm must be used inside a SynthFormProvider");
  }
  return ctx;
}

interface ProviderProps {
  lang: Language;
  setLang: (v: Language) => void;
  t: Translations;
  onToast: (msg: string) => void;
  /** Navigate to the Voices tab (used by "use profile" / "edit profile"). */
  onShowVoices: () => void;
  children: ReactNode;
}

export function SynthFormProvider({ lang, setLang, t, onToast, onShowVoices, children }: ProviderProps) {
  const initialVoice = VOICES.es[0]?.id ?? "";
  const [selectedVoice, setSelectedVoice] = useState<string>(initialVoice);
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [speed, setSpeed] = useState(100);
  // Pacing lever (P2): pause multiplier, decoupled from speed. 1.0 = base.
  const [pauseScale, setPauseScale] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(80);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const [newProfileName, setNewProfileName] = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedSample | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [text, setText] = useState("");
  useDraftPersistence({ key: "voxforge.draft.synth", value: text, onRestore: setText });

  const voicePreview = useVoicePreview();
  const samplePlayer = useSamplePlayer();
  const { create, update, remove } = useSharedProfiles();

  // Identidades estables (BAJO-12): App re-renderiza a menudo (toasts,
  // polling de jobs/errores) y el provider vive dentro de su árbol; sin
  // memoización, cada render regalaba un value nuevo y re-renderizaba todo
  // el subárbol de Voices aunque nada hubiera cambiado.
  const settings: SynthSettings = useMemo(() => ({
    lang, setLang,
    selectedVoice, setSelectedVoice,
    format, setFormat,
    speed, setSpeed,
    pauseScale, setPauseScale,
    pitch, setPitch,
    volume, setVolume,
    activeProfileId, setActiveProfileId,
  }), [lang, setLang, selectedVoice, format, speed, pauseScale, pitch, volume, activeProfileId]);

  const draft: ProfileDraft = useMemo(() => ({
    name: newProfileName, setName: setNewProfileName,
    uploadedFile, setUploadedFile,
    editingId: editingProfile, setEditingId: setEditingProfile,
  }), [newProfileName, uploadedFile, editingProfile]);

  const toggleLang = useCallback((): void => {
    const next: Language = lang === "es" ? "en" : "es";
    setLang(next);
    const firstVoice = VOICES[next][0];
    if (firstVoice) setSelectedVoice(firstVoice.id);
  }, [lang, setLang]);

  const saveProfile = useCallback(async (): Promise<void> => {
    if (!newProfileName.trim()) return;
    try {
      if (editingProfile) {
        await update(editingProfile, {
          name: newProfileName,
          voiceId: selectedVoice,
          language: lang,
          speed, pitch, volume,
        });
        setEditingProfile(null);
      } else {
        await create({
          name: newProfileName,
          voiceId: selectedVoice,
          language: lang,
          speed, pitch, volume,
          sampleFile: uploadedFile?.file ?? null,
        });
      }
      setNewProfileName("");
      setUploadedFile(null);
      onToast(t.profileSaved);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    }
  }, [newProfileName, editingProfile, selectedVoice, lang, speed, pitch, volume, uploadedFile, create, update, onToast, t]);

  const useProfile = useCallback((p: Profile): void => {
    setSelectedVoice(p.voiceId);
    setSpeed(p.speed);
    setPitch(p.pitch);
    setVolume(p.volume);
    setLang(p.lang);
    setActiveProfileId(p.id);
    // Drop any in-progress edit draft: keeping it would make the next
    // "Save" overwrite the profile being edited with THIS profile's
    // params (BAJO-6).
    setEditingProfile(null);
    setNewProfileName("");
    setUploadedFile(null);
    // The lab section renders inside the Voices tab; make sure the user
    // is there to see the profile become the active one.
    onShowVoices();
  }, [setLang, onShowVoices]);

  const editProfile = useCallback((p: Profile): void => {
    setEditingProfile(p.id);
    setNewProfileName(p.name);
    setSpeed(p.speed);
    setPitch(p.pitch);
    setVolume(p.volume);
    setSelectedVoice(p.voiceId);
    onShowVoices();
    // Scroll to editing section (upload card at top of voices section)
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }, [onShowVoices]);

  const deleteProfile = useCallback(async (id: string): Promise<void> => {
    try {
      await remove(id);
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    }
  }, [remove, onToast, t]);

  const toggleCastilianAnchor = useCallback(async (id: string, value: boolean): Promise<void> => {
    try {
      await update(id, { castilianAnchor: value });
    } catch (e) {
      onToast(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    }
  }, [update, onToast, t]);

  const value = useMemo<SynthFormState>(() => ({
    settings,
    draft,
    text,
    setText,
    dragOver,
    setDragOver,
    voicePreview,
    samplePlayer,
    toggleLang,
    saveProfile,
    useProfile,
    editProfile,
    deleteProfile,
    toggleCastilianAnchor,
    createProfile: create,
  }), [
    settings, draft, text, dragOver, voicePreview, samplePlayer,
    toggleLang, saveProfile, useProfile, editProfile, deleteProfile,
    toggleCastilianAnchor, create,
  ]);

  return (
    <SynthFormContext.Provider value={value}>
      {children}
    </SynthFormContext.Provider>
  );
}
