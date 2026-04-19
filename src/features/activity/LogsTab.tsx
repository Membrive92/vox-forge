import { useCallback, useEffect, useRef, useState } from "react";

import { fetchServerLogs, fetchStats, type ServerLogEntry, type StatsResponse } from "@/api/logs";
import { logger, type LogEntry } from "@/logging/logger";
import { colors, fonts, radii, typography } from "@/theme/tokens";

type ViewTab = "server" | "client" | "stats";
type Source = "app" | "errors";

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "#94a3b8", INFO: "#60a5fa", WARNING: "#fbbf24",
  ERROR: "#f87171", CRITICAL: "#f87171",
  debug: "#94a3b8", info: "#60a5fa", warn: "#fbbf24", error: "#f87171",
};

const AUTO_REFRESH_MS = 5000;

export function LogsTab() {
  const [tab, setTab] = useState<ViewTab>("server");
  const [source, setSource] = useState<Source>("app");
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [ridFilter, setRidFilter] = useState<string>("");
  const [serverEntries, setServerEntries] = useState<ServerLogEntry[]>([]);
  const [clientEntries, setClientEntries] = useState<readonly LogEntry[]>(logger.getBuffer());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const intervalRef = useRef<number | null>(null);

  const loadServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchServerLogs(
        source, 500,
        levelFilter || undefined,
        ridFilter.trim() || undefined,
      );
      setServerEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [source, levelFilter, ridFilter]);

  // Load on filter change
  useEffect(() => {
    if (tab !== "server") return;
    void loadServer();
  }, [tab, loadServer]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (autoRefresh && tab === "server") {
      intervalRef.current = window.setInterval(() => void loadServer(), AUTO_REFRESH_MS);
    }
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [autoRefresh, tab, loadServer]);

  // Client tab subscription
  useEffect(() => {
    if (tab !== "client") return;
    setClientEntries([...logger.getBuffer()]);
    const unsub = logger.subscribe(() => setClientEntries([...logger.getBuffer()]));
    return unsub;
  }, [tab]);

  // Stats tab
  useEffect(() => {
    if (tab !== "stats") return;
    void fetchStats(24).then(setStats).catch(() => {});
  }, [tab]);

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radii.xl, padding: 24, backdropFilter: "blur(12px)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: typography.size.lg, fontWeight: 700 }}>Logs</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <TabBtn active={tab === "server"} onClick={() => setTab("server")}>Server</TabBtn>
          <TabBtn active={tab === "client"} onClick={() => setTab("client")}>Client</TabBtn>
          <TabBtn active={tab === "stats"} onClick={() => setTab("stats")}>Stats</TabBtn>
        </div>
      </div>

      {/* Server toolbar */}
      {tab === "server" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Select value={source} onChange={(v) => setSource(v as Source)} options={[
            { value: "app", label: "app.log (INFO+)" },
            { value: "errors", label: "errors.log (WARN+)" },
          ]} />
          <Select value={levelFilter} onChange={setLevelFilter} options={[
            { value: "", label: "All levels" },
            { value: "INFO", label: "INFO" },
            { value: "WARNING", label: "WARNING" },
            { value: "ERROR", label: "ERROR" },
          ]} />
          <input
            value={ridFilter}
            onChange={(e) => setRidFilter(e.target.value)}
            placeholder="Request ID..."
            style={{
              padding: "6px 10px", fontSize: typography.size.sm, fontFamily: fonts.mono,
              background: colors.surfaceAlt, color: colors.text,
              border: `1px solid ${colors.border}`, borderRadius: radii.sm,
              width: 130, outline: "none",
            }}
          />
          <button onClick={() => void loadServer()} disabled={loading} style={btnStyle}>
            {loading ? "..." : "Refresh"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: typography.size.xs, color: colors.textDim, cursor: "pointer", marginLeft: 4 }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ accentColor: colors.primary }}
            />
            Auto (5s)
          </label>
        </div>
      )}

      {/* Client toolbar */}
      {tab === "client" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <button onClick={() => { logger.clear(); setClientEntries([]); }} style={btnStyle}>
            Clear
          </button>
          <span style={{ fontSize: typography.size.xs, color: colors.textDim }}>
            {clientEntries.length} entries (persisted in session)
          </span>
        </div>
      )}

      {error && <p style={{ color: "#f87171", fontSize: typography.size.sm, margin: "8px 0" }}>Error: {error}</p>}

      {/* Stats view */}
      {tab === "stats" && stats && (
        <StatsView stats={stats} onRefresh={() => void fetchStats(24).then(setStats)} />
      )}

      {/* Log entries */}
      {tab !== "stats" && (
        <pre style={{
          fontFamily: fonts.mono, fontSize: typography.size.xs, lineHeight: 1.5,
          background: colors.surfaceAlt, padding: 12, borderRadius: radii.md,
          maxHeight: 600, overflow: "auto", margin: 0,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {tab === "server" ? (
            serverEntries.length === 0
              ? <span style={{ color: colors.textDim }}>No entries</span>
              : serverEntries.map((e, i) => <ServerLine key={i} entry={e} onFilterRid={setRidFilter} />)
          ) : (
            clientEntries.length === 0
              ? <span style={{ color: colors.textDim }}>No entries</span>
              : clientEntries.map((e, i) => <ClientLine key={i} entry={e} />)
          )}
        </pre>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function ServerLine({ entry: e, onFilterRid }: { entry: ServerLogEntry; onFilterRid: (rid: string) => void }) {
  const hasStack = e.message.includes("\n");
  return (
    <div style={{ marginBottom: hasStack ? 8 : 0 }}>
      <span style={{ color: colors.textDim }}>{e.timestamp ? e.timestamp.slice(0, 19) : ""}</span>{" "}
      <span style={{ color: LEVEL_COLOR[e.level] ?? colors.text, fontWeight: 700 }}>
        [{e.level || "----"}]
      </span>{" "}
      <span
        onClick={() => onFilterRid(e.request_id)}
        style={{ color: "#c4b5fd", cursor: "pointer", textDecoration: "underline", textDecorationColor: "transparent" }}
        title="Click to filter by this request ID"
        onMouseEnter={(ev) => (ev.currentTarget.style.textDecorationColor = "#c4b5fd")}
        onMouseLeave={(ev) => (ev.currentTarget.style.textDecorationColor = "transparent")}
      >
        [{e.request_id}]
      </span>{" "}
      <span style={{ color: colors.textDim }}>{e.logger}:</span>{" "}
      {e.message}
    </div>
  );
}

function ClientLine({ entry: e }: { entry: LogEntry }) {
  return (
    <div>
      <span style={{ color: colors.textDim }}>{e.timestamp.slice(11, 23)}</span>{" "}
      <span style={{ color: LEVEL_COLOR[e.level] ?? colors.text, fontWeight: 700 }}>
        [{e.level.toUpperCase()}]
      </span>{" "}
      {e.requestId && <span style={{ color: "#c4b5fd" }}>[{e.requestId}] </span>}
      {e.message}
      {e.context && <span style={{ color: colors.textDim }}> {JSON.stringify(e.context)}</span>}
    </div>
  );
}

function StatsView({ stats, onRefresh }: { stats: StatsResponse; onRefresh: () => void }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: typography.size.sm, color: colors.textDim }}>Last {stats.period_hours}h</span>
        <button onClick={onRefresh} style={btnStyle}>Refresh</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="Requests" value={stats.total_requests} />
        <StatCard label="Syntheses" value={stats.synthesis_count} />
        <StatCard label="Errors" value={stats.error_count} color="#f87171" />
        <StatCard label="Avg latency" value={`${stats.avg_request_ms}ms`} />
      </div>
      {stats.slowest_request_path && (
        <div style={{ fontSize: typography.size.xs, color: colors.textDim, marginBottom: 12 }}>
          Slowest: <span style={{ color: colors.text }}>{stats.slowest_request_path}</span>{" "}
          ({stats.slowest_request_ms}ms)
        </div>
      )}
      {Object.keys(stats.top_endpoints).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: typography.size.xs, fontWeight: 600, color: colors.textDim, textTransform: "uppercase", letterSpacing: "1px" }}>
            Top endpoints
          </span>
          <div style={{ marginTop: 6 }}>
            {Object.entries(stats.top_endpoints).map(([path, count]) => (
              <div key={path} style={{ display: "flex", justifyContent: "space-between", fontSize: typography.size.xs, color: colors.textDim, padding: "2px 0" }}>
                <span style={{ fontFamily: fonts.mono }}>{path}</span>
                <span>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {Object.keys(stats.engines_used).length > 0 && (
        <div>
          <span style={{ fontSize: typography.size.xs, fontWeight: 600, color: colors.textDim, textTransform: "uppercase", letterSpacing: "1px" }}>
            Engines
          </span>
          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            {Object.entries(stats.engines_used).map(([engine, count]) => (
              <span key={engine} style={{ fontSize: typography.size.xs, color: colors.text, fontFamily: fonts.mono }}>
                {engine}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      background: colors.surfaceAlt, borderRadius: radii.md, padding: 14,
      border: `1px solid ${colors.borderFaint}`,
    }}>
      <div style={{ fontSize: typography.size.xl, fontWeight: 700, fontFamily: fonts.mono, color: color ?? colors.text }}>
        {value}
      </div>
      <div style={{ fontSize: typography.size.xs, color: colors.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 14px", fontSize: typography.size.sm, fontWeight: 600,
  background: colors.primary, color: "#fff", border: "none",
  borderRadius: radii.sm, cursor: "pointer", fontFamily: fonts.sans,
};

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px", fontSize: typography.size.sm, fontWeight: 600,
      background: active ? colors.primary : colors.surfaceAlt,
      color: active ? "#fff" : colors.textDim, border: "none",
      borderRadius: radii.sm, cursor: "pointer", fontFamily: fonts.sans,
    }}>{children}</button>
  );
}

interface SelectProps { value: string; onChange: (v: string) => void; options: readonly { value: string; label: string }[] }
function Select({ value, onChange, options }: SelectProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{
      padding: "6px 10px", fontSize: typography.size.sm, fontFamily: fonts.sans,
      background: colors.surfaceAlt, color: colors.text,
      border: `1px solid ${colors.border}`, borderRadius: radii.sm, cursor: "pointer",
    }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
