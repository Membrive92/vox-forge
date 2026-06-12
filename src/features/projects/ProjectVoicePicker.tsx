import type { Project } from "@/api/projects";
import { ALL_VOICES, VOICES } from "@/constants/voices";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, space, typography } from "@/theme/tokens";
import type { Profile } from "@/types/domain";

// ── ProjectVoicePicker ──────────────────────────────────────────────

interface VoicePickerProps {
  t: Translations;
  project: Project;
  profiles: readonly Profile[];
  onChange: (voiceId: string, profileId: string | null) => void;
}

// Value encoding: system voices use "voice:<id>", profiles use "profile:<id>"
// so the same <select> can disambiguate with a single string value.
export function ProjectVoicePicker({ t, project, profiles, onChange }: VoicePickerProps) {
  const currentValue = project.profile_id
    ? `profile:${project.profile_id}`
    : `voice:${project.voice_id}`;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const raw = e.target.value;
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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        padding: `${space[2]}px 0 ${space[3]}px`,
        borderBottom: `1px solid ${colors.borderSubtle}`,
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
        {t.voice}
      </label>
      <select
        value={currentValue}
        onChange={handleChange}
        style={{
          padding: "6px 10px",
          borderRadius: radii.sm,
          background: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          color: colors.text,
          fontSize: typography.size.sm,
          fontFamily: fonts.sans,
          cursor: "pointer",
          minWidth: 240,
        }}
      >
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
        {/* If the project's current voice_id isn't in the known list
           (e.g. legacy empty string), show it as a fallback so the
           selector doesn't silently drop the value. */}
        {!ALL_VOICES.some((v) => v.id === project.voice_id) &&
          !project.profile_id && (
            <option value={`voice:${project.voice_id}`} disabled>
              {project.voice_id || "—"}
            </option>
          )}
      </select>
    </div>
  );
}
