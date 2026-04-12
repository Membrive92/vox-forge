import { useState } from "react";

import { Toast } from "@/components/Toast";
import * as Icons from "@/components/icons";
import { VOICES } from "@/constants/voices";
import { CompareTab } from "@/features/compare/CompareTab";
import { ConvertTab } from "@/features/convert/ConvertTab";
import { ExperimentalTab } from "@/features/experimental/ExperimentalTab";
import { LabTab } from "@/features/lab/LabTab";
import { ActivityTab } from "@/features/activity/ActivityTab";
import { useErrorBadge } from "@/features/logs/LogsTab";
import { ProfilesTab } from "@/features/profiles/ProfilesTab";
import { WorkbenchTab } from "@/features/projects/WorkbenchTab";
import { PronunciationTab } from "@/features/pronunciation/PronunciationTab";
import { SynthTab } from "@/features/synth/SynthTab";
import { VoicesTab } from "@/features/voices/VoicesTab";
import type { ProfileDraft, SynthSettings } from "@/features/state";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useProfiles } from "@/hooks/useProfiles";
import { useToast } from "@/hooks/useToast";
import { useSamplePlayer } from "@/hooks/useSamplePlayer";
import { useVoicePreview } from "@/hooks/useVoicePreview";
import { getTranslations } from "@/i18n";
import { colors, fonts, fontsHref } from "@/theme/tokens";
import type { AudioFormat, Language, Profile, UploadedSample } from "@/types/domain";

type Tab = "synth" | "workbench" | "voices" | "profiles" | "convert" | "compare" | "lab" | "experimental" | "pronunciation" | "activity";

export default function App() {
  const [lang, setLang] = useState<Language>("es");
  const [tab, setTab] = useState<Tab>("synth");
  const [text, setText] = useState("");

  const esVoices = VOICES.es;
  const initialVoice = esVoices[0]?.id ?? "";
  const [selectedVoice, setSelectedVoice] = useState<string>(initialVoice);
  const [format, setFormat] = useState<AudioFormat>("mp3");
  const [speed, setSpeed] = useState(100);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(80);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const [newProfileName, setNewProfileName] = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedSample | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const toast = useToast();
  const errorBadge = useErrorBadge();
  useDraftPersistence({ key: "voxforge.draft.synth", value: text, onRestore: setText });
  const { profiles, create, update, remove } = useProfiles();
  const voicePreview = useVoicePreview();
  const samplePlayer = useSamplePlayer();
  const t = getTranslations(lang);

  const settings: SynthSettings = {
    lang, setLang,
    selectedVoice, setSelectedVoice,
    format, setFormat,
    speed, setSpeed,
    pitch, setPitch,
    volume, setVolume,
    activeProfileId, setActiveProfileId,
  };

  const draft: ProfileDraft = {
    name: newProfileName, setName: setNewProfileName,
    uploadedFile, setUploadedFile,
    editingId: editingProfile, setEditingId: setEditingProfile,
  };

  const handleToggleLang = (): void => {
    const next: Language = lang === "es" ? "en" : "es";
    setLang(next);
    const firstVoice = VOICES[next][0];
    if (firstVoice) setSelectedVoice(firstVoice.id);
  };

  const handleSaveProfile = async (): Promise<void> => {
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
      toast.show(t.profileSaved);
    } catch (e) {
      toast.show(`Error: ${e instanceof Error ? e.message : "desconocido"}`);
    }
  };

  const handleUseProfile = (p: Profile): void => {
    setSelectedVoice(p.voiceId);
    setSpeed(p.speed);
    setPitch(p.pitch);
    setVolume(p.volume);
    setLang(p.lang);
    setActiveProfileId(p.id);
    setTab("synth");
  };

  const handleEditProfile = (p: Profile): void => {
    setEditingProfile(p.id);
    setNewProfileName(p.name);
    setSpeed(p.speed);
    setPitch(p.pitch);
    setVolume(p.volume);
    setSelectedVoice(p.voiceId);
    setTab("voices");
  };

  const handleDeleteProfile = async (id: string): Promise<void> => {
    try {
      await remove(id);
    } catch (e) {
      toast.show(`Error: ${e instanceof Error ? e.message : "desconocido"}`);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        fontFamily: fonts.sans,
        color: colors.text,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <link href={fontsHref} rel="stylesheet" />

      <BackgroundTexture />
      <Toast message={toast.message} visible={toast.visible} />

      <Header t={t} lang={lang} onToggleLang={handleToggleLang} />
      <TabsNav t={t} tab={tab} setTab={setTab} errorCount={errorBadge} />

      <main style={{ position: "relative", zIndex: 10, padding: 28, maxWidth: 1400, margin: "0 auto" }}>
        {tab === "synth" && (
          <SynthTab t={t} text={text} setText={setText} settings={settings} onToast={toast.show} />
        )}
        {tab === "workbench" && <WorkbenchTab onToast={toast.show} />}
        {tab === "voices" && (
          <VoicesTab
            t={t}
            settings={settings}
            draft={draft}
            dragOver={dragOver}
            setDragOver={setDragOver}
            onSaveProfile={handleSaveProfile}
            onToast={toast.show}
            voicePreview={voicePreview}
          />
        )}
        {tab === "profiles" && (
          <ProfilesTab
            t={t}
            profiles={profiles}
            onUse={handleUseProfile}
            onEdit={handleEditProfile}
            onDelete={(id) => void handleDeleteProfile(id)}
            onNew={() => setTab("voices")}
            samplePlayer={samplePlayer}
            voicePreview={voicePreview}
          />
        )}
        {tab === "convert" && (
          <ConvertTab
            t={t}
            profiles={profiles}
            onToast={toast.show}
          />
        )}
        {tab === "compare" && (
          <CompareTab t={t} profiles={profiles} onToast={toast.show} />
        )}
        {tab === "lab" && (
          <LabTab
            t={t}
            onToast={toast.show}
          />
        )}
        {tab === "experimental" && (
          <ExperimentalTab
            t={t}
            onToast={toast.show}
          />
        )}
        {tab === "pronunciation" && <PronunciationTab onToast={toast.show} />}
        {tab === "activity" && <ActivityTab />}
      </main>
    </div>
  );
}

function BackgroundTexture() {
  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          opacity: 0.03,
          pointerEvents: "none",
          backgroundImage: `radial-gradient(circle at 20% 50%, #3b82f6 0%, transparent 50%),
                            radial-gradient(circle at 80% 20%, #f97316 0%, transparent 50%),
                            radial-gradient(circle at 50% 80%, #8b5cf6 0%, transparent 50%)`,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          opacity: 0.04,
          pointerEvents: "none",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")",
        }}
      />
    </>
  );
}

interface HeaderProps {
  t: ReturnType<typeof getTranslations>;
  lang: Language;
  onToggleLang: () => void;
}

function Header({ t, lang, onToggleLang }: HeaderProps) {
  return (
    <header
      style={{
        position: "relative",
        zIndex: 10,
        padding: "20px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(59,130,246,0.3)",
          }}
        >
          <Icons.Waveform />
        </div>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "-0.5px",
              fontFamily: fonts.serif,
              background: `linear-gradient(135deg, ${colors.text}, ${colors.textMuted})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {t.appName}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              color: colors.textDim,
              letterSpacing: "2px",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {t.appTagline}
          </p>
        </div>
      </div>

      <button
        onClick={onToggleLang}
        aria-label={t.language}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(30,41,59,0.8)",
          border: "1px solid rgba(148,163,184,0.15)",
          borderRadius: 8,
          padding: "8px 14px",
          color: colors.text,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: fonts.sans,
          transition: "all 0.2s",
        }}
      >
        <Icons.Globe />
        {lang === "es" ? "ES" : "EN"}
        <Icons.ChevDown />
      </button>
    </header>
  );
}

interface TabsNavProps {
  t: ReturnType<typeof getTranslations>;
  tab: Tab;
  setTab: (t: Tab) => void;
  errorCount: number;
}

function TabsNav({ t, tab, setTab, errorCount }: TabsNavProps) {
  const tabs: readonly { id: Tab; icon: JSX.Element; label: string }[] = [
    { id: "synth", icon: <Icons.Waveform />, label: t.tabSynth },
    { id: "workbench", icon: <Icons.Settings />, label: t.tabWorkbench },
    { id: "voices", icon: <Icons.Settings />, label: t.tabVoices },
    { id: "profiles", icon: <Icons.User />, label: t.tabProfiles },
    { id: "convert", icon: <Icons.Mic />, label: t.tabConvert },
    { id: "compare", icon: <Icons.Waveform />, label: t.tabCompare },
    { id: "lab", icon: <Icons.Settings />, label: t.tabLab },
    { id: "experimental", icon: <Icons.Waveform />, label: t.tabExperimental },
    { id: "pronunciation", icon: <Icons.Settings />, label: t.tabPronunciation },
    { id: "activity", icon: <Icons.Settings />, label: errorCount > 0 ? `${t.tabActivity} (${errorCount})` : t.tabActivity },
  ];
  return (
    <nav
      style={{
        position: "relative",
        zIndex: 10,
        display: "flex",
        gap: 0,
        padding: "0 28px",
        borderBottom: `1px solid ${colors.borderSubtle}`,
      }}
    >
      {tabs.map((tb) => {
        const active = tab === tb.id;
        return (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "14px 20px",
              fontSize: 13,
              fontWeight: 600,
              background: "none",
              border: "none",
              color: active ? colors.primary : colors.textDim,
              cursor: "pointer",
              fontFamily: fonts.sans,
              borderBottom: active ? `2px solid ${colors.primary}` : "2px solid transparent",
              transition: "all 0.2s",
            }}
          >
            {tb.icon} {tb.label}
          </button>
        );
      })}
    </nav>
  );
}
