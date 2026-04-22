import { useEffect, useState } from "react";

import { Toast } from "@/components/Toast";
import * as Icons from "@/components/icons";
import { VOICES } from "@/constants/voices";
import { ActivityTab } from "@/features/activity/ActivityTab";
import { AudioToolsTab } from "@/features/audio-tools/AudioToolsTab";
import { WorkbenchTab } from "@/features/projects/WorkbenchTab";
import { QuickSynthTab } from "@/features/quick-synth/QuickSynthTab";
import { StudioTab } from "@/features/studio/StudioTab";
import { VoicesUnifiedTab } from "@/features/voices-unified/VoicesUnifiedTab";
import { useErrorBadge } from "@/hooks/useErrorBadge";
import type { ProfileDraft, SynthSettings } from "@/features/state";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useProfiles } from "@/hooks/useProfiles";
import { useToast } from "@/hooks/useToast";
import { useSamplePlayer } from "@/hooks/useSamplePlayer";
import { useVoicePreview } from "@/hooks/useVoicePreview";
import { getTranslations } from "@/i18n";
import { colors, fonts, fontsHref, typography } from "@/theme/tokens";
import type { AudioFormat, Language, Profile, UploadedSample } from "@/types/domain";

type Tab = "quick-synth" | "workbench" | "voices" | "audio-tools" | "studio" | "activity";

export default function App() {
  const [lang, setLang] = useState<Language>("es");
  const [tab, setTab] = useState<Tab>("workbench");
  const [text, setText] = useState("");

  // Keep tabs mounted after first visit so in-flight jobs (synth, render,
  // transcribe) aren't wiped when the user navigates away mid-work. The
  // fetch/polling lives inside the tab's hooks — if we unmount the
  // component, its state setters become no-ops when the backend
  // eventually resolves.
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set([tab]));
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
  }, [tab]);

  // Cross-tab navigation intent. When the Workbench triggers "Edit in
  // Studio" on a chapter, it stashes the generation id here + switches
  // tab. StudioTab reads it on mount/change, selects the matching
  // source, then calls ``clearPendingStudioSource`` so it doesn't
  // re-fire if the user navigates back and forth.
  const [pendingStudioSourceId, setPendingStudioSourceId] = useState<string | null>(null);
  const openStudioWithSource = (sourceId: string): void => {
    setPendingStudioSourceId(sourceId);
    setTab("studio");
  };
  const clearPendingStudioSource = (): void => setPendingStudioSourceId(null);

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
      toast.show(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
    }
  };

  const handleUseProfile = (p: Profile): void => {
    setSelectedVoice(p.voiceId);
    setSpeed(p.speed);
    setPitch(p.pitch);
    setVolume(p.volume);
    setLang(p.lang);
    setActiveProfileId(p.id);
    setTab("quick-synth");
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
      toast.show(`Error: ${e instanceof Error ? e.message : t.unknownError}`);
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
      <Toast toasts={toast.toasts} onDismiss={toast.dismiss} />

      <Header t={t} lang={lang} onToggleLang={handleToggleLang} />
      <TabsNav t={t} tab={tab} setTab={setTab} errorCount={errorBadge} />

      <main className="vf-main-narrow" style={{ position: "relative", zIndex: 10, padding: 28, maxWidth: 1400, margin: "0 auto" }}>
        {visitedTabs.has("quick-synth") && (
          <TabHost active={tab === "quick-synth"}>
            <QuickSynthTab t={t} text={text} setText={setText} settings={settings} onToast={toast.show} />
          </TabHost>
        )}
        {visitedTabs.has("workbench") && (
          <TabHost active={tab === "workbench"}>
            <WorkbenchTab
              t={t}
              onToast={toast.show}
              onOpenStudioWithSource={openStudioWithSource}
              onNavigateToQuickSynth={() => setTab("quick-synth")}
            />
          </TabHost>
        )}
        {visitedTabs.has("voices") && (
          <TabHost active={tab === "voices"}>
            <VoicesUnifiedTab
              t={t}
              settings={settings}
              draft={draft}
              profiles={profiles}
              dragOver={dragOver}
              setDragOver={setDragOver}
              onSaveProfile={handleSaveProfile}
              onUseProfile={handleUseProfile}
              onEditProfile={handleEditProfile}
              onDeleteProfile={(id) => void handleDeleteProfile(id)}
              onToast={toast.show}
              voicePreview={voicePreview}
              samplePlayer={samplePlayer}
            />
          </TabHost>
        )}
        {visitedTabs.has("audio-tools") && (
          <TabHost active={tab === "audio-tools"}>
            <AudioToolsTab t={t} profiles={profiles} onToast={toast.show} />
          </TabHost>
        )}
        {visitedTabs.has("studio") && (
          <TabHost active={tab === "studio"}>
            <StudioTab
              t={t}
              onToast={toast.show}
              pendingSourceId={pendingStudioSourceId}
              onPendingSourceConsumed={clearPendingStudioSource}
            />
          </TabHost>
        )}
        {visitedTabs.has("activity") && (
          <TabHost active={tab === "activity"}>
            <ActivityTab t={t} onToast={toast.show} />
          </TabHost>
        )}
      </main>
    </div>
  );
}

interface TabHostProps {
  active: boolean;
  children: React.ReactNode;
}

// Wraps a tab so it stays mounted when hidden (to preserve in-flight jobs,
// polling, form drafts, audio players). Inactive hosts are visually hidden
// AND taken out of the a11y / focus tree so screen readers and Tab
// keyboard nav don't see stale content.
function TabHost({ active, children }: TabHostProps) {
  return (
    <div
      hidden={!active}
      aria-hidden={active ? undefined : "true"}
      // @ts-expect-error — "inert" is valid HTML5; React types haven't caught up everywhere.
      inert={active ? undefined : ""}
      style={active ? undefined : { display: "none" }}
    >
      {children}
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
              fontSize: typography.size.xl,
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
              fontSize: typography.size.xs,
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
          fontSize: typography.size.sm,
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
  // Audio Tools (Convert + Lab) is deliberately excluded from the top
  // nav — it's standalone file-processing that doesn't fit the
  // audiobook production flow. The component is still reachable via
  // ``tab === "audio-tools"`` (legacy links) but nothing surfaces it.
  const tabs: readonly { id: Tab; icon: JSX.Element; label: string }[] = [
    { id: "workbench", icon: <Icons.Book />, label: t.tabWorkbench },
    { id: "quick-synth", icon: <Icons.Zap />, label: t.tabQuickSynth },
    { id: "voices", icon: <Icons.Mic2 />, label: t.tabVoices },
    { id: "studio", icon: <Icons.Scissors />, label: t.tabStudio },
    { id: "activity", icon: <Icons.Clock />, label: errorCount > 0 ? `${t.tabActivity} (${errorCount})` : t.tabActivity },
  ];
  return (
    <nav
      className="vf-tabs-nav"
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
            aria-current={active ? "page" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "14px 20px",
              fontSize: typography.size.sm,
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
            {tb.icon}
            <span className="vf-tab-label">{tb.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
