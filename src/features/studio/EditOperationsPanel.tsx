import { useId, useState } from "react";

import type { StudioOperation } from "@/api/studio";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/IconButton";
import * as Icons from "@/components/icons";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";

import type { StudioRegion } from "./StudioWaveform";

interface Props {
  t: Translations;
  region: StudioRegion | null;
  operations: readonly StudioOperation[];
  isProcessing: boolean;
  outputFormat: string;
  onAdd: (op: StudioOperation) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
  onApply: () => void;
  onApplyPreview: () => void;
  onCancelApply: () => void;
  onClearRegion: () => void;
  onOutputFormatChange: (fmt: string) => void;
  onNeedRegion: () => void;
}

const FORMATS = ["mp3", "wav", "ogg", "flac"] as const;

function formatMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(2);
  return `${m}:${sec.padStart(5, "0")}`;
}

function describeOp(op: StudioOperation, t: Translations): string {
  switch (op.type) {
    case "trim":
      return `${t.studioOpTrim} · ${formatMs(op.params["start_ms"] ?? 0)} → ${formatMs(op.params["end_ms"] ?? 0)}`;
    case "delete_region":
      return `${t.studioOpDeleteRegion} · ${formatMs(op.params["start_ms"] ?? 0)} → ${formatMs(op.params["end_ms"] ?? 0)}`;
    case "fade_in":
      return `${t.studioOpFadeIn} · ${op.params["duration_ms"] ?? 0}ms`;
    case "fade_out":
      return `${t.studioOpFadeOut} · ${op.params["duration_ms"] ?? 0}ms`;
    case "normalize":
      return `${t.studioOpNormalize} · ${op.params["headroom_db"] ?? -1}dB`;
    case "loudness":
      return `${t.studioOpLoudness} · ${op.params["target_lufs"] ?? -16} LUFS`;
    case "denoise":
      return `${t.studioOpDenoise} · ${Math.round((op.params["strength"] ?? 0.5) * 100)}%`;
    case "compressor":
      return `${t.studioOpCompressor} · ${Math.round((op.params["amount"] ?? 0.5) * 100)}%`;
    default:
      return op.type;
  }
}

export function EditOperationsPanel({
  t,
  region,
  operations,
  isProcessing,
  outputFormat,
  onAdd,
  onRemove,
  onMove,
  onClear,
  onApply,
  onApplyPreview,
  onCancelApply,
  onClearRegion,
  onOutputFormatChange,
  onNeedRegion,
}: Props) {
  const [fadeMs, setFadeMs] = useState(1000);
  const [headroom, setHeadroom] = useState(-1);
  const [lufs, setLufs] = useState(-16);
  const [denoiseStrength, setDenoiseStrength] = useState(50);   // 0..100
  const [compressorAmount, setCompressorAmount] = useState(40); // 0..100
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [openTip, setOpenTip] = useState<"lufs" | "denoise" | "compressor" | null>(null);
  const idBase = useId();

  const toggleTip = (tip: "lufs" | "denoise" | "compressor"): void =>
    setOpenTip((current) => (current === tip ? null : tip));

  const requireRegion = (): StudioRegion | null => {
    if (!region) {
      onNeedRegion();
      return null;
    }
    return region;
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: typography.size.base, fontWeight: 700 }}>
          {t.studioToolbarTitle}
        </h3>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const r = requireRegion();
              if (!r) return;
              onAdd({ type: "trim", params: { start_ms: r.startMs, end_ms: r.endMs } });
            }}
          >
            {t.studioOpTrim}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const r = requireRegion();
              if (!r) return;
              onAdd({
                type: "delete_region",
                params: { start_ms: r.startMs, end_ms: r.endMs },
              });
            }}
          >
            {t.studioOpDeleteRegion}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAdd({ type: "fade_in", params: { duration_ms: fadeMs } })}
          >
            {t.studioOpFadeIn}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAdd({ type: "fade_out", params: { duration_ms: fadeMs } })}
          >
            {t.studioOpFadeOut}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAdd({ type: "normalize", params: { headroom_db: headroom } })}
          >
            {t.studioOpNormalize}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAdd({ type: "loudness", params: { target_lufs: lufs } })}
          >
            {t.studioOpLoudness}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAdd({ type: "denoise", params: { strength: denoiseStrength / 100 } })}
          >
            {t.studioOpDenoise}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAdd({ type: "compressor", params: { amount: compressorAmount / 100 } })}
          >
            {t.studioOpCompressor}
          </Button>
          {region ? (
            <Button variant="ghost" size="sm" onClick={onClearRegion}>
              {t.studioClearRegion}
            </Button>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: typography.size.xs,
              color: colors.textDim,
            }}
          >
            {t.studioFadeDuration}
            <input
              type="number"
              min={50}
              max={10000}
              step={100}
              value={fadeMs}
              onChange={(e) => setFadeMs(Number(e.target.value) || 0)}
              style={inputStyle}
            />
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: typography.size.xs,
              color: colors.textDim,
            }}
          >
            {t.studioNormalizeHeadroom}
            <input
              type="number"
              min={-12}
              max={0}
              step={0.5}
              value={headroom}
              onChange={(e) => setHeadroom(Number(e.target.value))}
              style={inputStyle}
            />
          </label>
          <div style={fieldRowStyle}>
            <label htmlFor={`${idBase}-lufs`}>{t.studioLufsTarget}</label>
            <button
              type="button"
              aria-label={t.studioLufsTarget}
              aria-expanded={openTip === "lufs"}
              aria-controls={`${idBase}-lufs-tip`}
              title={t.studioLufsTip}
              onClick={() => toggleTip("lufs")}
              style={tipButtonStyle}
            >
              ?
            </button>
            <input
              id={`${idBase}-lufs`}
              type="number"
              min={-24}
              max={-10}
              step={1}
              value={lufs}
              onChange={(e) => setLufs(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <div style={fieldRowStyle}>
            <label htmlFor={`${idBase}-denoise`}>{t.studioDenoiseStrength}</label>
            <button
              type="button"
              aria-label={t.studioDenoiseStrength}
              aria-expanded={openTip === "denoise"}
              aria-controls={`${idBase}-denoise-tip`}
              title={t.studioDenoiseTip}
              onClick={() => toggleTip("denoise")}
              style={tipButtonStyle}
            >
              ?
            </button>
            <input
              id={`${idBase}-denoise`}
              type="number"
              min={0}
              max={100}
              step={5}
              value={denoiseStrength}
              onChange={(e) => setDenoiseStrength(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <div style={fieldRowStyle}>
            <label htmlFor={`${idBase}-compressor`}>{t.studioCompressorAmount}</label>
            <button
              type="button"
              aria-label={t.studioCompressorAmount}
              aria-expanded={openTip === "compressor"}
              aria-controls={`${idBase}-compressor-tip`}
              title={t.studioCompressorTip}
              onClick={() => toggleTip("compressor")}
              style={tipButtonStyle}
            >
              ?
            </button>
            <input
              id={`${idBase}-compressor`}
              type="number"
              min={0}
              max={100}
              step={5}
              value={compressorAmount}
              onChange={(e) => setCompressorAmount(Number(e.target.value))}
              style={inputStyle}
            />
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: typography.size.xs,
              color: colors.textDim,
              marginLeft: "auto",
            }}
          >
            {t.studioOutputFormat}
            <select
              value={outputFormat}
              onChange={(e) => onOutputFormatChange(e.target.value)}
              style={inputStyle}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>

        {openTip && (
          <div
            id={`${idBase}-${openTip}-tip`}
            style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: radii.md,
              background: colors.surfaceAlt,
              border: `1px solid ${colors.borderFaint}`,
              fontSize: typography.size.xs,
              color: colors.textMuted,
              lineHeight: 1.5,
            }}
          >
            {openTip === "lufs"
              ? t.studioLufsTip
              : openTip === "denoise"
                ? t.studioDenoiseTip
                : t.studioCompressorTip}
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${colors.borderHair}`, paddingTop: 12 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: typography.size.sm, fontWeight: 700 }}>
          {t.studioOpsTitle}
        </h4>
        {operations.length === 0 ? (
          <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textFaint }}>
            {t.studioOpsEmpty}
          </p>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {operations.map((op, idx) => (
              <li
                key={`${op.type}-${idx}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: radii.md,
                  background: colors.surfaceAlt,
                  border: `1px solid ${colors.borderFaint}`,
                }}
              >
                <span
                  style={{
                    fontSize: typography.size.xs,
                    fontWeight: 700,
                    fontFamily: fonts.mono,
                    color: colors.textDim,
                    minWidth: 18,
                  }}
                >
                  {idx + 1}.
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: typography.size.xs,
                    color: colors.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {describeOp(op, t)}
                </span>
                <IconButton
                  aria-label={t.studioMoveOpUp}
                  variant="ghost"
                  size="sm"
                  disabled={idx === 0}
                  onClick={() => onMove(idx, idx - 1)}
                >
                  <Icons.ChevUp />
                </IconButton>
                <IconButton
                  aria-label={t.studioMoveOpDown}
                  variant="ghost"
                  size="sm"
                  disabled={idx === operations.length - 1}
                  onClick={() => onMove(idx, idx + 1)}
                >
                  <Icons.ChevDown />
                </IconButton>
                <IconButton
                  aria-label={t.studioRemoveOperation}
                  variant="danger"
                  size="sm"
                  onClick={() => onRemove(idx)}
                >
                  <Icons.Trash />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {isProcessing ? (
          <Button variant="danger" fullWidth onClick={onCancelApply}>
            {t.cancel}
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              fullWidth
              disabled={operations.length === 0}
              onClick={onApplyPreview}
            >
              {t.studioPreview}
            </Button>
            <Button
              variant="primary"
              fullWidth
              disabled={operations.length === 0}
              onClick={onApply}
            >
              {operations.length === 1
                ? t.studioApplyOne
                : t.studioApply.replace("{n}", String(operations.length))}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          onClick={() => setShowClearConfirm(true)}
          disabled={operations.length === 0 || isProcessing}
        >
          {t.studioClearQueue}
        </Button>
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title={t.studioConfirmClearQueue.replace("{n}", String(operations.length))}
        message={`This will remove ${operations.length} ${operations.length === 1 ? "operation" : "operations"} from the queue.`}
        confirmText={t.studioConfirmApply}
        confirmVariant="danger"
        cancelText={t.studioConfirmCancel}
        onConfirm={() => {
          onClear();
          setShowClearConfirm(false);
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: 90,
  padding: "4px 8px",
  borderRadius: radii.sm,
  background: colors.surfaceAlt,
  border: `1px solid ${colors.border}`,
  color: colors.text,
  fontSize: typography.size.xs,
  fontFamily: fonts.mono,
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: typography.size.xs,
  color: colors.textDim,
};

const tipButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: colors.textDim,
  cursor: "pointer",
  fontSize: "1.1em",
  fontFamily: "inherit",
  lineHeight: 1,
};
