import { useEffect, useRef, useState } from "react";

import { Toast } from "@/components/Toast";
import * as Icons from "@/components/icons";
import { ActivityTab } from "@/features/activity/ActivityTab";
import { AudioToolsTab } from "@/features/audio-tools/AudioToolsTab";
import { WorkbenchTab } from "@/features/projects/WorkbenchTab";
import { StudioTab } from "@/features/studio/StudioTab";
import { VOICES_LAB_SECTION_ID, VoicesPlusLab } from "@/features/voices-unified/VoicesPlusLab";
import { SynthFormProvider, useSynthForm } from "@/features/voices-unified/synthFormContext";
import { JobsProgressBar } from "@/components/JobsProgressBar";
import { JobsTray } from "@/components/JobsTray";
import { useErrorBadge } from "@/hooks/useErrorBadge";
import { JobsProvider, useJobs } from "@/hooks/jobsContext";
import { ProfilesContext } from "@/hooks/profilesContext";
import { useProfiles } from "@/hooks/useProfiles";
import { useToast } from "@/hooks/useToast";
import { getTranslations } from "@/i18n";
import { colors, fonts, fontsHref, typography } from "@/theme/tokens";
import type { Language, TabId } from "@/types/domain";

/**
 * Cross-tab navigation intents (UX-01). Generalizes the old
 * `pendingStudioSourceId` one-off: any chrome (job tray, deep links,
 * resume banner) expresses WHERE it wants to land and App resolves the
 * tab switch plus any payload/side effect in one place.
 */
type NavigationIntent =
  | { kind: "tab"; tab: TabId }
  // Open Studio with a specific generation pre-selected.
  | { kind: "studio-source"; sourceId: string }
  // Land at the resume UI inside the Voices lab section (MED-UX-3).
  | { kind: "resume-jobs" };

export default function App() {
  const [lang, setLang] = useState<Language>("es");
  const [tab, setTab] = useState<TabId>("workbench");

  // Keep tabs mounted after first visit so in-flight jobs (synth, render,
  // transcribe) aren't wiped when the user navigates away mid-work. The
  // fetch/polling lives inside the tab's hooks — if we unmount the
  // component, its state setters become no-ops when the backend
  // eventually resolves.
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set([tab]));
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
  }, [tab]);

  // "studio-source" intent payload. StudioTab reads it on mount/change,
  // selects the matching source, then calls ``clearPendingStudioSource``
  // so it doesn't re-fire if the user navigates back and forth.
  const [pendingStudioSourceId, setPendingStudioSourceId] = useState<string | null>(null);
  const clearPendingStudioSource = (): void => setPendingStudioSourceId(null);

  const navigate = (intent: NavigationIntent): void => {
    switch (intent.kind) {
      case "tab":
        setTab(intent.tab);
        return;
      case "studio-source":
        setPendingStudioSourceId(intent.sourceId);
        setTab("studio");
        return;
      case "resume-jobs":
        // Land AT the resume UI, which lives in the lab section far below
        // the voices gallery fold (MED-UX-3). The timeout lets the voices
        // TabHost mount/show first; the anchor is the section itself, so
        // it exists even before the incomplete-jobs fetch resolves.
        setTab("voices");
        window.setTimeout(() => {
          document
            .getElementById(VOICES_LAB_SECTION_ID)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
        return;
    }
  };

  // Name of the currently-open project, surfaced into the global header
  // so the user always knows what they're editing.
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);

  const toast = useToast();
  const errorBadge = useErrorBadge();
  const profilesState = useProfiles();
  const { profiles } = profilesState;
  const t = getTranslations(lang);

  return (
    <JobsProvider>
    <ProfilesContext.Provider value={profilesState}>
    <SynthFormProvider
      lang={lang}
      setLang={setLang}
      t={t}
      onToast={toast.show}
      onShowVoices={() => setTab("voices")}
    >
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
      <Toast toasts={toast.toasts} onDismiss={toast.dismiss} dismissLabel={t.toastDismiss} />

      <AppHeader
        t={t}
        lang={lang}
        activeProjectName={tab === "workbench" ? activeProjectName : null}
        onNavigateTab={(target) => navigate({ kind: "tab", tab: target })}
      />
      <TabsNav t={t} tab={tab} setTab={setTab} errorCount={errorBadge} />
      <JobsProgressBar label={t.jobsAggregateLabel} />

      <main className="vf-main-narrow" style={{ position: "relative", zIndex: 10, padding: 28, maxWidth: 1400, margin: "0 auto" }}>
        {visitedTabs.has("workbench") && (
          <TabHost active={tab === "workbench"}>
            <WorkbenchTab
              t={t}
              onToast={toast.show}
              onOpenStudioWithSource={(sourceId) => navigate({ kind: "studio-source", sourceId })}
              // Sprint A: Quick Synth was absorbed into the Voices tab
              // (gallery + lab). The incomplete-jobs banner lands there,
              // scrolled to the lab section where the resume UI lives.
              onNavigateToQuickSynth={() => navigate({ kind: "resume-jobs" })}
              onActiveProjectChange={setActiveProjectName}
            />
          </TabHost>
        )}
        {visitedTabs.has("voices") && (
          <TabHost active={tab === "voices"}>
            <VoicesPlusLab t={t} onToast={toast.show} />
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
    </SynthFormProvider>
    </ProfilesContext.Provider>
    </JobsProvider>
  );
}

interface AppHeaderProps {
  t: ReturnType<typeof getTranslations>;
  lang: Language;
  activeProjectName: string | null;
  onNavigateTab: (tab: TabId) => void;
}

// Thin bridge so the header's language toggle can reach the synth-form
// context: switching the app language also resets the selected voice to
// the new language's default (logic owned by SynthFormProvider).
function AppHeader({ t, lang, activeProjectName, onNavigateTab }: AppHeaderProps) {
  const { toggleLang } = useSynthForm();
  return (
    <Header
      t={t}
      lang={lang}
      onToggleLang={toggleLang}
      activeProjectName={activeProjectName}
      onNavigateTab={onNavigateTab}
    />
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
  /** When a project is open in the Workbench tab, its name is shown
   * in the header so the user knows what they're editing without
   * having to glance at the sidebar. Null hides the badge. */
  activeProjectName: string | null;
  /** Navigation intent fired by the job tray (UX-01). */
  onNavigateTab: (tab: TabId) => void;
}

function Header({ t, lang, onToggleLang, activeProjectName, onNavigateTab }: HeaderProps) {
  return (
    <header
      style={{
        position: "relative",
        // Above the tab nav / main (both z 10) so the job tray dropdown
        // isn't covered by the sibling stacking contexts below it.
        zIndex: 20,
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

      {activeProjectName && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.25)",
            borderRadius: 8,
            fontSize: typography.size.sm,
            color: colors.text,
            fontFamily: fonts.sans,
            maxWidth: 360,
            overflow: "hidden",
          }}
        >
          <Icons.Book />
          <span
            style={{
              fontSize: typography.size.xs,
              color: colors.textDim,
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              fontWeight: 600,
            }}
          >
            {t.headerEditing}
          </span>
          <span
            style={{
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {activeProjectName}
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <JobsTray t={t} onNavigate={onNavigateTab} />
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
      </div>
    </header>
  );
}

interface TabsNavProps {
  t: ReturnType<typeof getTranslations>;
  tab: TabId;
  setTab: (t: TabId) => void;
  errorCount: number;
}

function TabsNav({ t, tab, setTab, errorCount }: TabsNavProps) {
  // Running jobs put a small count badge on their origin tab (UX-01,
  // same idea as the error badge on Activity). Studio jobs have no nav
  // entry to badge — the header tray still covers them.
  const jobs = useJobs();
  // Visible destinations: Workbench, Voices, Audio Tools, Activity. Quick
  // Synth lives inside Voices (the lab section) and Studio opens as a panel
  // from a chapter, so neither needs its own nav entry. Audio Tools (Change
  // Voice + Effects), however, is only reachable from here.
  const tabs: readonly { id: TabId; icon: JSX.Element; label: string }[] = [
    { id: "workbench", icon: <Icons.Book />, label: t.tabWorkbench },
    { id: "voices", icon: <Icons.Mic2 />, label: t.tabVoices },
    { id: "audio-tools", icon: <Icons.SlidersIcon />, label: t.tabAudioTools },
    { id: "activity", icon: <Icons.Clock />, label: errorCount > 0 ? `${t.tabActivity} (${errorCount})` : t.tabActivity },
  ];
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKeyDown = (e: React.KeyboardEvent, idx: number): void => {
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (target) {
      setTab(target.id);
      btnRefs.current[next]?.focus();
    }
  };

  return (
    <nav
      role="tablist"
      aria-label={t.mainNavLabel}
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
      {tabs.map((tb, idx) => {
        const active = tab === tb.id;
        const jobCount = jobs.filter(
          (j) => j.status === "running" && j.originTab === tb.id,
        ).length;
        return (
          <button
            key={tb.id}
            ref={(el) => { btnRefs.current[idx] = el; }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => setTab(tb.id)}
            onKeyDown={(e) => onTabKeyDown(e, idx)}
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
            {jobCount > 0 && (
              <span
                aria-label={t.jobsTabBadge.replace("{n}", String(jobCount))}
                style={{
                  minWidth: 16,
                  height: 16,
                  padding: "0 4px",
                  borderRadius: 8,
                  background: colors.primary,
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: fonts.mono,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {jobCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
