/**
 * Compact quality readout for a voice sample analysis.
 *
 * Shared by the profile-creation upload card and the per-sample
 * analyzer on profile cards (VOZ-10). Shows the rating, the key
 * metrics line (duration, SNR, peak, rhythm in syllables/second) and
 * the list of detected issues.
 */
import type { SampleAnalysis } from "@/api/analyze";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

interface QualityFeedbackProps {
  t: Translations;
  analysis: SampleAnalysis | null;
  analyzing: boolean;
}

export function QualityFeedback({ t, analysis, analyzing }: QualityFeedbackProps) {
  if (analyzing) {
    return (
      <div style={feedbackBoxStyle(colors.surfaceAlt, colors.border)}>
        <span style={{ color: colors.textDim, fontSize: typography.size.sm }}>
          {t.sampleQuality}: ...
        </span>
      </div>
    );
  }
  if (!analysis) return null;

  const ratingColor: Record<SampleAnalysis["rating"], string> = {
    excellent: "#34d399",
    good: "#60a5fa",
    fair: "#fbbf24",
    poor: "#f87171",
  };
  const ratingLabel: Record<SampleAnalysis["rating"], string> = {
    excellent: t.sampleQualityExcellent,
    good: t.sampleQualityGood,
    fair: t.sampleQualityFair,
    poor: t.sampleQualityPoor,
  };

  const color = ratingColor[analysis.rating];

  return (
    <div style={feedbackBoxStyle(`${color}15`, `${color}40`)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", background: color,
        }} />
        <span style={{ fontSize: typography.size.sm, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "1px" }}>
          {t.sampleQuality}: {ratingLabel[analysis.rating]}
        </span>
        <span style={{ fontSize: typography.size.xs, color: colors.textDim, fontFamily: fonts.mono, marginLeft: "auto" }}>
          {analysis.duration_s.toFixed(1)}s · SNR {analysis.snr_db.toFixed(1)}dB · peak {analysis.peak_dbfs.toFixed(1)}dBFS · {analysis.rhythm_sps.toFixed(1)} {t.sampleRhythmUnit}
        </span>
      </div>
      {analysis.issues.length > 0 && (
        <ul style={{
          margin: "6px 0 0", paddingLeft: 18, fontSize: typography.size.xs,
          color: colors.textDim, lineHeight: 1.6,
        }}>
          {analysis.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function feedbackBoxStyle(bg: string, border: string): React.CSSProperties {
  return {
    padding: "10px 14px",
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: radii.md,
    fontFamily: fonts.sans,
  };
}
