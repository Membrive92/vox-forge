import type { Chapter, Project } from "@/api/projects";
import { ALL_VOICES, VOICES } from "@/constants/voices";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

// ── ChapterVoicePicker ──────────────────────────────────────────────

interface ChapterVoicePickerProps {
  t: Translations;
  chapter: Chapter;
  project: Project;
  profiles: readonly Profile[];
  onChange: (voiceId: string | null, profileId: string | null) => void;
}

// Small inline select that lets a chapter override its voice without
// duplicating the full project selector. Value encoding:
//   "inherit"          → fall back to project (both fields cleared)
//   "voice:<id>"       → system voice override
//   "profile:<id>"     → cloned profile override
export function ChapterVoicePicker({ t, chapter, project, profiles, onChange }: ChapterVoicePickerProps) {
  const currentValue = chapter.profile_id
    ? `profile:${chapter.profile_id}`
    : chapter.voice_id
      ? `voice:${chapter.voice_id}`
      : "inherit";

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const raw = e.target.value;
    if (raw === "inherit") {
      onChange(null, null);
      return;
    }
    if (raw.startsWith("profile:")) {
      const id = raw.slice("profile:".length);
      const p = profiles.find((pp) => pp.id === id);
      if (!p) return;
      onChange(p.voiceId, p.id);
    } else if (raw.startsWith("voice:")) {
      onChange(raw.slice("voice:".length), null);
    }
  };

  const profilesWithSample = profiles.filter((p) => p.samples.length > 0);
  const isInheriting = currentValue === "inherit";

  // Label shown when inheriting — derive from the project's active voice
  // so the user sees "(heredado: Álvaro)" instead of a bare "heredar".
  const inheritedLabel =
    project.profile_id
      ? profiles.find((p) => p.id === project.profile_id)?.name ?? project.voice_id
      : ALL_VOICES.find((v) => v.id === project.voice_id)?.name ?? project.voice_id;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        marginTop: space[3],
      }}
    >
      <label
        style={{
          fontSize: typography.size.xs,
          color: colors.textDim,
          fontWeight: typography.weight.semibold,
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        {t.chapterVoice}
      </label>
      <select
        value={currentValue}
        onChange={handleChange}
        style={{
          padding: "4px 8px",
          borderRadius: radii.sm,
          background: colors.surfaceAlt,
          border: `1px solid ${isInheriting ? colors.borderFaint : colors.primaryBorder}`,
          color: colors.text,
          fontSize: typography.size.xs,
          fontFamily: fonts.sans,
          cursor: "pointer",
          minWidth: 220,
        }}
      >
        <option value="inherit">
          {t.chapterVoiceInherit.replace("{name}", inheritedLabel)}
        </option>
        {profilesWithSample.length > 0 && (
          <optgroup label={t.castingClonedProfiles}>
            {profilesWithSample.map((p) => (
              <option key={p.id} value={`profile:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label={`${t.castingSystemVoices} — ${t.voicesLangSpanish}`}>
          {VOICES.es.map((v) => (
            <option key={v.id} value={`voice:${v.id}`}>
              {v.name} · {v.accent}
            </option>
          ))}
        </optgroup>
        <optgroup label={`${t.castingSystemVoices} — ${t.voicesLangEnglish}`}>
          {VOICES.en.map((v) => (
            <option key={v.id} value={`voice:${v.id}`}>
              {v.name} · {v.accent}
            </option>
          ))}
        </optgroup>
      </select>
      {!isInheriting && (
        <button
          type="button"
          onClick={() => onChange(null, null)}
          title={t.chapterVoiceClear}
          style={{
            background: "none",
            border: "none",
            color: colors.textFaint,
            cursor: "pointer",
            fontSize: typography.size.xs,
            padding: "2px 6px",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
