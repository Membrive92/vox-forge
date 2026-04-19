import { useRef } from "react";

import { AudioRecorder } from "@/components/AudioRecorder";
import { Button } from "@/components/Button";
import { Slider } from "@/components/Slider";
import * as Icons from "@/components/icons";
import { VOICES } from "@/constants/voices";
import { readAudioDuration } from "@/hooks/readAudioDuration";
import type { VoicePreviewState } from "@/hooks/useVoicePreview";
import type { Translations } from "@/i18n";
import { colors, fonts, radii, typography } from "@/theme/tokens";
import type { Language } from "@/types/domain";

import type { ProfileDraft, SynthSettings } from "../state";

interface VoicesTabProps {
  t: Translations;
  settings: SynthSettings;
  draft: ProfileDraft;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onSaveProfile: () => void | Promise<void>;
  onToast: (msg: string) => void;
  voicePreview: VoicePreviewState;
}

const AUDIO_EXT_RE = /\.(wav|mp3|ogg|flac)$/i;

export function VoicesTab({
  t,
  settings,
  draft,
  dragOver,
  setDragOver,
  onSaveProfile,
  onToast,
  voicePreview,
}: VoicesTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceList = VOICES[settings.lang];

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!(file.type.includes("audio") || AUDIO_EXT_RE.test(file.name))) {
      onToast(t.voicesFormatUnsupported);
      return;
    }
    const duration = await readAudioDuration(file);
    draft.setUploadedFile({
      file,
      name: file.name,
      sizeKb: (file.size / 1024).toFixed(1),
      duration: duration.toFixed(1),
    });
  };

  return (
    <div className="vf-grid-2col">
      <UploadCard
        t={t}
        dragOver={dragOver}
        setDragOver={setDragOver}
        fileInputRef={fileInputRef}
        onFile={handleFile}
        draft={draft}
        settings={settings}
        onSaveProfile={onSaveProfile}
      />

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          padding: 24,
          backdropFilter: "blur(12px)",
        }}
      >
        <h3 style={{ margin: "0 0 20px", fontSize: typography.size.lg, fontWeight: 700 }}>{t.builtinVoices}</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["es", "en"] as const).map((l) => (
            <LangPill
              key={l}
              lang={l}
              active={settings.lang === l}
              onClick={() => {
                settings.setLang(l);
                const first = VOICES[l][0];
                if (first) settings.setSelectedVoice(first.id);
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {voiceList.map((v) => {
            const active = settings.selectedVoice === v.id;
            return (
              <div
                key={v.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderRadius: radii.lg,
                  background: active ? "rgba(59,130,246,0.1)" : "rgba(30,41,59,0.3)",
                  border: active
                    ? "1px solid rgba(59,130,246,0.25)"
                    : `1px solid ${colors.borderHair}`,
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: radii.md,
                      background: v.gender === "F" ? colors.femaleSoft : colors.maleSoft,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: typography.size.base,
                    }}
                  >
                    {v.gender === "F" ? "♀" : "♂"}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: typography.size.sm, fontWeight: 600 }}>{v.name}</p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: typography.size.xs,
                        color: colors.textDim,
                        fontFamily: fonts.mono,
                      }}
                    >
                      {v.accent} · {v.gender === "F" ? t.female : t.male}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => voicePreview.toggle(v.id, settings.lang)}
                    aria-label={t.previewVoice}
                    style={{
                      padding: "6px 10px",
                      borderRadius: radii.sm,
                      fontSize: typography.size.xs,
                      fontWeight: 600,
                      background: voicePreview.previewingId === v.id
                        ? colors.primary
                        : "rgba(59,130,246,0.1)",
                      border: "1px solid rgba(59,130,246,0.2)",
                      color: voicePreview.previewingId === v.id ? "#fff" : colors.primaryLight,
                      cursor: "pointer",
                      fontFamily: fonts.sans,
                      transition: "all 0.2s",
                    }}
                  >
                    {voicePreview.previewingId === v.id ? <Icons.Stop /> : <Icons.Volume />}
                  </button>
                  <button
                    onClick={() => settings.setSelectedVoice(v.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: radii.sm,
                      fontSize: typography.size.xs,
                      fontWeight: 600,
                      background: active ? colors.primary : colors.surfaceAlt,
                      border: active ? "none" : `1px solid ${colors.border}`,
                      color: active ? "#fff" : colors.textMuted,
                      cursor: "pointer",
                      fontFamily: fonts.sans,
                    }}
                  >
                    {t.useProfile}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface LangPillProps {
  lang: Language;
  active: boolean;
  onClick: () => void;
}

function LangPill({ lang, active, onClick }: LangPillProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 16px",
        borderRadius: radii.sm,
        fontSize: typography.size.sm,
        fontWeight: 600,
        background: active ? colors.primary : colors.surfaceAlt,
        color: active ? "#fff" : colors.textDim,
        border: "none",
        cursor: "pointer",
        fontFamily: fonts.sans,
        transition: "all 0.2s",
      }}
    >
      {lang === "es" ? "Español" : "English"/* language names are intentionally not translated */}
    </button>
  );
}

interface UploadCardProps {
  t: Translations;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFile: (file: File | undefined) => void | Promise<void>;
  draft: ProfileDraft;
  settings: SynthSettings;
  onSaveProfile: () => void | Promise<void>;
}

function UploadCard({
  t,
  dragOver,
  setDragOver,
  fileInputRef,
  onFile,
  draft,
  settings,
  onSaveProfile,
}: UploadCardProps) {
  const canSave = draft.name.trim().length > 0;
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.xl,
        padding: 24,
        backdropFilter: "blur(12px)",
      }}
    >
      <h3 style={{ margin: "0 0 4px", fontSize: typography.size.lg, fontWeight: 700 }}>{t.uploadVoice}</h3>
      <p style={{ margin: "0 0 16px", fontSize: typography.size.sm, color: colors.textDim }}>{t.uploadHint}</p>

      <AudioRecorder
        onRecorded={(file) => void onFile(file)}
        labelRecord={t.recordVoice}
        labelStop={t.stopRecording}
        labelRecording={t.recording}
      />

      <div style={{ textAlign: "center", fontSize: typography.size.xs, color: colors.textDim, margin: "8px 0" }}>
        {t.or}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void onFile(e.dataTransfer.files[0]);
        }}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={t.uploadDesc}
        style={{
          border: `2px dashed ${dragOver ? colors.primary : colors.border}`,
          borderRadius: 12,
          padding: "40px 20px",
          textAlign: "center",
          background: dragOver ? colors.primarySoft : colors.surfaceSubtle,
          cursor: "pointer",
          transition: "all 0.2s",
          transform: dragOver ? "scale(1.01)" : "scale(1)",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,.mp3,.ogg,.flac"
          style={{ display: "none" }}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div
          style={{
            color: dragOver ? colors.primary : colors.textMuted,
            marginBottom: 12,
            transition: "color 0.2s",
          }}
        >
          <Icons.Upload />
        </div>
        <p
          style={{
            margin: 0,
            fontSize: typography.size.sm,
            fontWeight: dragOver ? typography.weight.semibold : typography.weight.regular,
            color: dragOver ? colors.primaryLight : colors.textMuted,
          }}
        >
          {dragOver ? t.voicesDropHere : t.uploadDesc}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: typography.size.xs, color: colors.textFaint }}>
          .wav, .mp3, .ogg, .flac
        </p>
      </div>

      {draft.uploadedFile ? (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: radii.lg,
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.2)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: radii.md,
              background: "rgba(59,130,246,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.primaryLight,
            }}
          >
            <Icons.Mic />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: typography.size.sm, fontWeight: 600 }}>{draft.uploadedFile.name}</p>
            <p style={{ margin: 0, fontSize: typography.size.xs, color: colors.textDim }}>
              {draft.uploadedFile.sizeKb}KB · {draft.uploadedFile.duration}s
            </p>
          </div>
          <Icons.Check />
        </div>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <label
          style={{
            fontSize: typography.size.xs,
            color: colors.textDim,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1.5px",
            marginBottom: 8,
            display: "block",
          }}
        >
          {t.profileName}
        </label>
        <input
          value={draft.name}
          onChange={(e) => draft.setName(e.target.value)}
          placeholder={t.profilePlaceholder}
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: radii.md,
            background: colors.surfaceAlt,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontSize: typography.size.sm,
            fontFamily: fonts.sans,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <Slider label={t.speed} value={settings.speed} onChange={settings.setSpeed} min={50} max={200} unit="%" />
        <Slider label={t.pitch} value={settings.pitch} onChange={settings.setPitch} min={-10} max={10} unit="st" />
        <Slider label={t.volume} value={settings.volume} onChange={settings.setVolume} min={0} max={100} unit="%" />
      </div>

      <div style={{ marginTop: 8 }}>
        <Button
          variant="primary"
          disabled={!canSave}
          fullWidth
          onClick={() => void onSaveProfile()}
        >
          {draft.editingId ? t.confirm : t.saveProfile}
        </Button>
      </div>
    </div>
  );
}
