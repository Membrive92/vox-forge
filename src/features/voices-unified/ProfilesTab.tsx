import { API_BASE } from "@/api/client";
import { Button } from "@/components/Button";
import { useConfirm } from "@/components/ConfirmProvider";
import { IconButton } from "@/components/IconButton";
import { logger } from "@/logging/logger";
import { downloadBlob } from "@/utils/download";
import * as Icons from "@/components/icons";
import { ALL_VOICES } from "@/constants/voices";
import type { SamplePlayerState } from "@/hooks/useSamplePlayer";
import type { VoicePreviewState } from "@/hooks/useVoicePreview";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

interface ProfilesTabProps {
  t: Translations;
  profiles: readonly Profile[];
  onUse: (profile: Profile) => void;
  onEdit: (profile: Profile) => void;
  onDelete: (profileId: string) => void;
  onToggleCastilianAnchor: (profileId: string, value: boolean) => void;
  onNew: () => void;
  samplePlayer: SamplePlayerState;
  voicePreview: VoicePreviewState;
}

export function ProfilesTab({ t, profiles, onUse, onEdit, onDelete, onToggleCastilianAnchor, onNew, samplePlayer, voicePreview }: ProfilesTabProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t.savedProfiles}</h3>
        <Button variant="primary" size="sm" onClick={onNew}>
          + {t.newProfile}
        </Button>
      </div>

      {profiles.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <div className="vf-grid-2col">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              t={t}
              profile={p}
              onUse={() => onUse(p)}
              onEdit={() => onEdit(p)}
              onDelete={() => onDelete(p.id)}
              onToggleCastilianAnchor={(v) => onToggleCastilianAnchor(p.id, v)}
              samplePlayer={samplePlayer}
              voicePreview={voicePreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ t }: { t: Translations }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "60px 20px",
        background: colors.surfaceSubtle,
        borderRadius: radii.xl,
        border: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <div style={{ color: colors.textGhost, marginBottom: 12 }}>
        <Icons.Mic />
      </div>
      <p style={{ margin: 0, fontSize: typography.size.base, color: colors.textDim, fontWeight: 500 }}>
        {t.noProfiles}
      </p>
      <p style={{ margin: "8px 0 0", fontSize: typography.size.sm, color: colors.textFaint }}>
        {t.noProfilesHint}
      </p>
    </div>
  );
}

interface ProfileCardProps {
  t: Translations;
  profile: Profile;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleCastilianAnchor: (value: boolean) => void;
  samplePlayer: SamplePlayerState;
  voicePreview: VoicePreviewState;
}

function ProfileCard({ t, profile, onUse, onEdit, onDelete, onToggleCastilianAnchor, samplePlayer, voicePreview }: ProfileCardProps) {
  const confirm = useConfirm();
  const voice = ALL_VOICES.find((v) => v.id === profile.voiceId);

  // Downloads the stored voice sample named after the profile (not the
  // opaque server filename). Fetched as a blob so the anchor download
  // works regardless of API origin.
  const handleDownloadSample = async (): Promise<void> => {
    if (!profile.sampleName) return;
    const dot = profile.sampleName.lastIndexOf(".");
    const ext = dot >= 0 ? profile.sampleName.slice(dot) : ".wav";
    const base = profile.name.replace(/[^\w\s.-]/g, "_").trim() || "voice_sample";
    try {
      const res = await fetch(`${API_BASE}/voices/samples/${profile.sampleName}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      downloadBlob(await res.blob(), `${base}${ext}`);
    } catch (e) {
      logger.error("Profile sample download failed", {
        profileId: profile.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  const params = [
    { label: t.speed, value: `${profile.speed}%` },
    { label: t.pitch, value: `${profile.pitch > 0 ? "+" : ""}${profile.pitch}st` },
    { label: t.volume, value: `${profile.volume}%` },
  ] as const;
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 20,
        backdropFilter: "blur(12px)",
        transition: "all 0.2s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <h4 style={{ margin: 0, fontSize: typography.size.base, fontWeight: 700 }}>{profile.name}</h4>
          <p style={{ margin: "4px 0 0", fontSize: typography.size.xs, color: colors.textDim }}>
            {voice?.name ?? "—"} · {voice?.accent ?? "—"} · {profile.lang.toUpperCase()}
          </p>
        </div>
        <span
          style={{
            padding: "3px 8px",
            borderRadius: 4,
            fontSize: 9,
            fontWeight: 700,
            background: profile.sampleName ? colors.successSoft : "rgba(148,163,184,0.08)",
            color: profile.sampleName ? colors.success : colors.textDim,
            textTransform: "uppercase",
            letterSpacing: "1px",
            fontFamily: fonts.mono,
          }}
        >
          {profile.sampleName ? t.badgeWithSample : t.badgePreset}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {params.map((param) => (
          <div
            key={param.label}
            style={{
              padding: "8px 10px",
              borderRadius: radii.md,
              background: "rgba(30,41,59,0.5)",
              textAlign: "center",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 9,
                color: colors.textDim,
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {param.label}
            </p>
            <p
              style={{
                margin: "2px 0 0",
                fontSize: typography.size.base,
                fontWeight: 700,
                fontFamily: fonts.mono,
                color: colors.text,
              }}
            >
              {param.value}
            </p>
          </div>
        ))}
      </div>

      {profile.sampleName ? (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: radii.md,
            marginBottom: 16,
            background: "rgba(59,130,246,0.06)",
            border: "1px solid rgba(59,130,246,0.1)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={() => samplePlayer.toggle(profile.sampleName!)}
            aria-label={samplePlayer.playingFilename === profile.sampleName ? t.stop : t.play}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: samplePlayer.playingFilename === profile.sampleName
                ? colors.accent
                : colors.primary,
              border: "none",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 0.2s",
            }}
          >
            {samplePlayer.playingFilename === profile.sampleName
              ? <Icons.Stop />
              : <Icons.Play />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: typography.size.xs, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {profile.sampleName}
            </p>
            <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
              {profile.sampleDuration}s
            </p>
          </div>
          <IconButton
            aria-label={t.profileDownloadSample}
            variant="secondary"
            size="sm"
            onClick={() => void handleDownloadSample()}
          >
            <Icons.Download />
          </IconButton>
        </div>
      ) : null}

      {/* Preview: cloned profiles route through the clone engine (real
          cloned voice); preset profiles preview their base voice. */}
      {(() => {
        const isCloned = profile.sampleName !== null;
        const previewKey = isCloned ? profile.id : profile.voiceId;
        const isActive = voicePreview.previewingId === previewKey;
        const isLoading = voicePreview.loadingId === previewKey;
        const label = isLoading
          ? t.previewGenerating
          : isActive
            ? t.stop
            : isCloned
              ? t.previewClonedVoice
              : `${t.previewVoice} ${voice?.name ?? ""}`;
        return (
          <button
            onClick={() =>
              isCloned
                ? voicePreview.toggle(profile.voiceId, profile.lang, profile.id)
                : voicePreview.toggle(profile.voiceId, profile.lang)
            }
            style={{
              width: "100%",
              padding: "6px 0",
              borderRadius: radii.sm,
              marginBottom: 8,
              background: isActive ? colors.primarySoft : "transparent",
              border: `1px solid ${colors.borderFaint}`,
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: typography.size.xs,
              fontWeight: 500,
              fontFamily: fonts.sans,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "all 0.2s",
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isActive ? <Icons.Stop /> : <Icons.Volume />}
            {label}
          </button>
        );
      })()}

      {/* Castilian anchor toggle: prepend the configured reference voice
          to this profile's sample at synthesis time. Off by default. */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: radii.md,
          background: profile.castilianAnchor
            ? "rgba(245,158,11,0.1)"
            : "rgba(30,41,59,0.4)",
          border: `1px solid ${profile.castilianAnchor ? "rgba(245,158,11,0.4)" : colors.borderFaint}`,
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        <input
          type="checkbox"
          checked={profile.castilianAnchor}
          // Toggle from React state (not e.target.checked) so we don't
          // depend on the DOM being in sync — under hot-reload or race
          // conditions the DOM can lag the props by one frame.
          onChange={() => onToggleCastilianAnchor(!profile.castilianAnchor)}
          aria-label={t.profileCastilianAnchor}
          style={{ accentColor: "#f59e0b", cursor: "pointer" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <span style={{ fontSize: typography.size.xs, fontWeight: 600, color: colors.text }}>
            {t.profileCastilianAnchor}
          </span>
          <span style={{ fontSize: 10, color: colors.textFaint, lineHeight: 1.3 }}>
            {t.profileCastilianAnchorHint}
          </span>
        </div>
      </label>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <Button variant="primary" size="sm" fullWidth onClick={onUse}>
            {t.useProfile}
          </Button>
        </div>
        <IconButton aria-label={t.editProfile} variant="secondary" size="md" onClick={onEdit}>
          <Icons.Edit />
        </IconButton>
        <IconButton
          aria-label={t.deleteProfile}
          variant="danger"
          size="md"
          onClick={async () => {
            if (
              await confirm({
                title: t.confirmDeleteTitle,
                message: t.confirmDeleteProfile.replace("{name}", profile.name),
                confirmText: t.actionDelete,
                cancelText: t.cancel,
                confirmVariant: "danger",
              })
            ) {
              onDelete();
            }
          }}
        >
          <Icons.Trash />
        </IconButton>
      </div>
    </div>
  );
}
