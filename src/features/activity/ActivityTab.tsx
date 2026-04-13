import { useEffect, useState } from "react";

import {
  fetchActivity,
  type ActivityResponse,
  type GenerationActivity,
  type RecentError,
} from "@/api/activity";
import { LogsTab } from "./LogsTab";
import type { Translations } from "@/i18n";
import { colors, fonts, radii } from "@/theme/tokens";

import { SettingsSection } from "./SettingsSection";

interface ActivityTabProps {
  t: Translations;
  onToast: (msg: string) => void;
}

export function ActivityTab({ t, onToast }: ActivityTabProps) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await fetchActivity(30));
    } catch { /* silently degrade */ }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  if (loading && !data) {
    return <Section><p style={{ color: colors.textDim, fontSize: 13 }}>Loading...</p></Section>;
  }
  if (!data) {
    return <Section><p style={{ color: colors.textDim, fontSize: 13 }}>Could not load activity</p></Section>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Errors (only if any) */}
      {data.errors.length > 0 && (
        <Section>
          <SectionTitle>Recent issues</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.errors.map((err, i) => (
              <ErrorRow key={i} error={err} />
            ))}
          </div>
        </Section>
      )}

      {/* Recent generations */}
      <Section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SectionTitle>Recent generations</SectionTitle>
          <button onClick={() => void load()} style={refreshBtn}>Refresh</button>
        </div>
        {data.generations.length === 0 ? (
          <p style={{ color: colors.textDim, fontSize: 13, textAlign: "center", padding: 20 }}>
            No generations yet. Synthesize a chapter from the Workbench or use the Synthesize tab.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.generations.map((gen) => (
              <GenerationRow key={gen.id} gen={gen} />
            ))}
          </div>
        )}
      </Section>

      {/* Disk usage */}
      <Section>
        <SectionTitle>Storage</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 8 }}>
          <DiskCard label="Generated audio" value={data.disk.output} />
          <DiskCard label="Voice samples" value={data.disk.voices} />
          <DiskCard label="Logs" value={data.disk.logs} />
          <DiskCard label="Total" value={data.disk.total} highlight />
        </div>
      </Section>

      {/* Settings (pronunciation + export defaults) */}
      <SettingsSection t={t} onToast={onToast} />

      {/* Dev toggle — inconspicuous, at the bottom */}
      <div style={{ textAlign: "right" }}>
        <button
          onClick={() => setDevMode((v) => !v)}
          style={{
            background: "none", border: "none", fontSize: 10,
            color: colors.textFaint, cursor: "pointer", fontFamily: fonts.mono,
            padding: "4px 8px",
          }}
        >
          {devMode ? "Hide developer logs" : "Developer logs"}
        </button>
      </div>
      {devMode && <LogsTab />}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function GenerationRow({ gen }: { gen: GenerationActivity }) {
  const statusColor =
    gen.status === "done" ? "#34d399"
    : gen.status === "error" ? "#f87171"
    : gen.status === "running" ? "#60a5fa"
    : colors.textDim;

  const date = gen.created_at.slice(0, 16).replace("T", " ");
  const engineLabel = gen.engine === "xtts-v2" ? "CLONED" : "EDGE-TTS";
  const engineColor = gen.engine === "xtts-v2" ? colors.accent : colors.primaryLight;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", background: colors.surfaceSubtle,
      border: `1px solid ${colors.borderFaint}`, borderRadius: radii.sm,
    }}>
      {/* Status dot */}
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: statusColor, flexShrink: 0,
      }} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
          {gen.project_name}
          <span style={{ color: colors.textDim, fontWeight: 400 }}> / {gen.chapter_title}</span>
        </div>
        <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
          {date}
          {gen.duration > 0 && <span> · {gen.duration.toFixed(1)}s audio</span>}
          {gen.chunks_total > 0 && <span> · {gen.chunks_done}/{gen.chunks_total} chunks</span>}
        </div>
      </div>

      {/* Engine badge */}
      <span style={{
        fontSize: 9, fontWeight: 700, fontFamily: fonts.mono,
        padding: "2px 8px", borderRadius: 4,
        background: `${engineColor}22`, color: engineColor,
        textTransform: "uppercase", letterSpacing: "0.5px",
      }}>
        {engineLabel}
      </span>

      {/* Status label */}
      <span style={{
        fontSize: 10, fontWeight: 600, color: statusColor,
        textTransform: "uppercase", fontFamily: fonts.mono,
        minWidth: 50, textAlign: "right",
      }}>
        {gen.status}
      </span>
    </div>
  );
}

function ErrorRow({ error }: { error: RecentError }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 14px",
      background: "rgba(248,113,113,0.06)",
      border: "1px solid rgba(248,113,113,0.15)",
      borderRadius: radii.sm,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: "#f87171", flexShrink: 0, marginTop: 5,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: colors.text }}>{error.message}</div>
        <div style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>
          {error.timestamp}
        </div>
      </div>
    </div>
  );
}

function DiskCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      background: colors.surfaceAlt, borderRadius: radii.md, padding: 14,
      border: `1px solid ${highlight ? colors.primaryBorder : colors.borderFaint}`,
    }}>
      <div style={{
        fontSize: 18, fontWeight: 700, fontFamily: fonts.mono,
        color: highlight ? colors.primaryLight : colors.text,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 10, color: colors.textDim, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "1px", marginTop: 4,
      }}>
        {label}
      </div>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: radii.xl, padding: 20, backdropFilter: "blur(12px)",
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      margin: 0, fontSize: 14, fontWeight: 700,
      color: colors.text, fontFamily: fonts.sans,
    }}>
      {children}
    </h3>
  );
}

const refreshBtn: React.CSSProperties = {
  padding: "5px 12px", fontSize: 11, fontWeight: 600,
  background: colors.surfaceAlt, color: colors.textDim,
  border: `1px solid ${colors.border}`, borderRadius: radii.sm,
  cursor: "pointer", fontFamily: fonts.sans,
};
