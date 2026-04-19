import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
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
  onNew: () => void;
  samplePlayer: SamplePlayerState;
  voicePreview: VoicePreviewState;
}

export function ProfilesTab({ t, profiles, onUse, onEdit, onDelete, onNew, samplePlayer, voicePreview }: ProfilesTabProps) {
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
  samplePlayer: SamplePlayerState;
  voicePreview: VoicePreviewState;
}

function ProfileCard({ t, profile, onUse, onEdit, onDelete, samplePlayer, voicePreview }: ProfileCardProps) {
  const voice = ALL_VOICES.find((v) => v.id === profile.voiceId);
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
        </div>
      ) : null}

      {/* Preview the profile's base voice */}
      <button
        onClick={() => voicePreview.toggle(profile.voiceId, profile.lang)}
        style={{
          width: "100%",
          padding: "6px 0",
          borderRadius: radii.sm,
          marginBottom: 8,
          background: voicePreview.previewingId === profile.voiceId
            ? colors.primarySoft
            : "transparent",
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
        }}
      >
        {voicePreview.previewingId === profile.voiceId ? <Icons.Stop /> : <Icons.Volume />}
        {voicePreview.previewingId === profile.voiceId ? t.stop : t.previewVoice} {voice?.name ?? ""}
      </button>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <Button variant="primary" size="sm" fullWidth onClick={onUse}>
            {t.useProfile}
          </Button>
        </div>
        <IconButton aria-label={t.editProfile} variant="secondary" size="md" onClick={onEdit}>
          <Icons.Edit />
        </IconButton>
        <IconButton aria-label={t.deleteProfile} variant="danger" size="md" onClick={onDelete}>
          <Icons.Trash />
        </IconButton>
      </div>
    </div>
  );
}
