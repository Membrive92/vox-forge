# Implementation Plan: UX Improvements for Sprints 1–4

## Overview

This document outlines fixes for the 8 UX gaps identified in the Sprint 1–4 audit. Each fix includes goal, scope (backend/frontend), changes, test plan, and effort estimate. Organized by priority and sprint for staged rollout.

---

## CRITICAL FIXES (P0 — Ship Next)

### Fix #1: Add Playback for Uploaded Audio in Workbench (Sprint 1)

**Goal:**
Enable users to verify uploaded/recorded audio immediately in Workbench without navigating to Studio. Audio becomes discoverable as a first-class input path.

**Symptom Addressed:**
"Audio uploaded — it's now the active take" toast appears, but user sees no way to play it.

**Frontend Changes:**

1. **ChapterCard Enhancement** (`src/features/projects/WorkbenchTab.tsx`):
   - After `<textarea>` (line 434), add a conditional playback panel that shows when `activeGen?.status === "done"` and `activeGen?.file_path` is set.
   - Panel displays:
     - `<audio controls>` element with src from `generateAudioUrl(activeGen.file_path)` (add helper to `api/studio.ts` or reuse existing).
     - Duration badge: "2:34" (from `activeGen.duration`).
     - Engine badge: "Upload" / "Recording" / "TTS" (from `activeGen.engine`).
     - Button to open in Studio for editing.

2. **New Utility** (`src/api/studio.ts`):
   - Export function `getGenerationAudioUrl(filePath: string): string` that constructs the backend audio serve URL (similar to `getStudioAudioUrl`).
   - Ensure CORS headers allow audio playback.

3. **TakeSelector Improvement** (lines 1220–1268):
   - Add mini-icons to indicate generation status and engine in the dropdown.
   - Example: `[✓ Upload] · 2m ago · 3:45` (green checkmark for done, clock icon for pending).
   - On hover, show a small play icon; clicking it focuses the audio player above.

**Backend Changes:**
- None required; audio files already served at `/static/generations/{id}` or similar.
- Verify CORS headers allow `audio/` requests from frontend origin.

**Tests:**
1. Upload a .wav file; verify playback appears in the panel and audio plays correctly.
2. Record audio; verify playback appears and engine is labeled "Recording".
3. Synthesize via TTS; verify playback appears and engine is labeled "TTS".
4. Verify audio element is keyboard-accessible (Tab to focus, Space to play/pause).
5. Delete the upload; verify audio panel disappears.

**Effort:** 2–3 hours (component layout, API integration, responsive styling).

---

### Fix #2: Add Success Feedback to Image Generation (Sprint 4)

**Goal:**
Provide clear feedback when image generation starts and completes, preventing duplicate submissions and improving discoverability of the feature.

**Symptom Addressed:**
"Generate" button clicked → dialog closes → silence. User unsure if generation is running, completed, or failed.

**Frontend Changes:**

1. **ImageGenDialog State** (`src/features/studio/VideoRenderPanel.tsx`):
   - Add `isGenerating` prop; parent (SceneManager) tracks `isGeneratingIdx` state.
   - Disable submit button while `isGenerating`.
   - Show loading spinner inside submit button (line 794).

2. **SceneManager State** (lines 466–645):
   - Change `sceneUploadingIdx` to track both upload and generation in-flight (rename to `sceneLoadingIdx`).
   - When `handleGenerateSceneImage` is called, set loading state **before** closing dialog.
   - After `generateImage()` completes, fire success toast: `t.studioScenesGenSuccess`.

3. **VideoRenderPanel Handler** (lines 111–132):
   - Add `isGenerating` prop to ImageGenDialog (line 631).
   - Pass `isGeneratingIdx === idx` to detect when this specific scene is generating.

**Backend Changes:**
- None required; `/api/studios/generate-image` already exists.

**i18n Changes:**
- Add `studioScenesGenSuccess: "Image generated successfully"` (en.ts, es.ts).

**Tests:**
1. Click "Generate" for a scene; observe loading spinner in dialog button.
2. Wait for generation to complete; observe toast "Image generated successfully".
3. Verify checkmark appears in the scene list once toast fires.
4. Verify retry doesn't spawn duplicate requests (dialog/button disabled during generation).
5. Test network failure (mock error); observe error toast instead of success.

**Effort:** 1–2 hours (state management, toast integration, i18n keys).

---

## HIGH-PRIORITY FIXES (P1 — Sprint 5+)

### Fix #3: Add Preview Mode to Studio Edit Operations (Sprint 2)

**Goal:**
Allow users to audition effect chains before committing, reducing friction and increasing confidence in DSP settings.

**Symptom Addressed:**
User adds 3 operations, clicks "Apply", realizes the LUFS target is wrong, must remove ops and re-add with new settings.

**Frontend Changes:**

1. **EditOperationsPanel Enhancement** (lines 60–404):
   - Split "Apply" into two buttons: "Preview" (ghost) and "Apply" (primary).
   - Preview button is always enabled if `operations.length > 0`.
   - On Preview click, call `onApplyPreview()` callback (new prop).
   - Set `isPreviewMode` state (visual indicator).

2. **StudioTab Integration** (`src/features/studio/StudioTab.tsx`):
   - Add new callback `handlePreview` that calls `studio.apply(outputFormat, preview: true)`.
   - This should return a preview blob without persisting.
   - Backend returns preview blob; frontend loads it into a temporary `resultUrl` with label "Preview (not saved)".

3. **Result Panel Update** (lines 134–175 in StudioTab):
   - If in preview mode, show warning: "This is a preview. Click 'Apply' to save." (yellow banner).
   - Prevent download button from working until user clicks Apply.

**Backend Changes:**

1. **`studio.py` Router** (in `backend/routers/studio.py`):
   - Add `?preview=true` query param to `/studios/apply-operations` endpoint.
   - If `preview=true`, return audio blob but don't persist to disk.
   - Return metadata header: `X-Preview-Mode: true`.

2. **`useStudioSession` Hook** (`src/features/studio/useStudioSession.ts`):
   - Add `previewUrl` and `isPreviewMode` state.
   - Add `applyPreview()` method that calls backend with `preview=true`.

**Tests:**
1. Add 3 operations; click Preview.
2. Verify audio plays in result panel with "Preview" label.
3. Adjust an operation parameter (e.g., LUFS -18 → -16); click Preview again.
4. Verify new preview loads (no download button active).
5. Click Apply; verify result is persisted and download becomes active.
6. Verify operations remain in queue if user doesn't Clear.

**Effort:** 4–5 hours (backend endpoint, state management, UI layout, dual-button logic).

---

### Fix #4: Add Confirmation Dialog to Destructive Operations (Sprint 2)

**Goal:**
Prevent accidental data loss when clearing operation queue or removing individual ops.

**Symptom Addressed:**
User clicks "Clear Queue" by mistake; 5 operations are lost; must re-add each one.

**Frontend Changes:**

1. **ConfirmDialog Component** (new or use existing PromptDialog):
   - If not already available, create a reusable `ConfirmDialog` component (title, message, cancel/confirm buttons).
   - Lives in `src/components/ConfirmDialog.tsx`.

2. **EditOperationsPanel** (lines 395–401):
   - Wrap `onClear()` in a confirmation dialog.
   - Message: "This will clear all {n} operations. Are you sure?" (bold count).
   - Cancel button (secondary), Confirm button (danger variant).

3. **Individual Op Remove** (line 368):
   - Add confirmation only if `operations.length > 1`.
   - Message: "Remove this operation?"

**Backend Changes:**
- None required.

**i18n Changes:**
- Add:
  - `studioConfirmClearQueue: "Clear all {n} operations?"` (show count).
  - `studioConfirmRemoveOp: "Remove this operation?"`
  - `studioConfirmCancel: "Cancel"` (or reuse existing).
  - `studioConfirmApply: "Yes, clear"` / `"Yes, remove"`.

**Tests:**
1. Add 3 operations; click "Clear Queue".
2. Verify confirmation dialog appears with operation count.
3. Click Cancel; verify operations remain.
4. Click Confirm; verify operations are cleared.
5. Undo/redo in browser history should NOT restore (ops are client-side only).
6. Test single op removal with dialog.

**Effort:** 2–3 hours (component, state, dialog flow, i18n).

---

### Fix #5: Clarify Recording → Upload → TTS Workflow (Sprint 1)

**Goal:**
Help users understand the purpose and limitations of recorded audio, and discover the path to synthesis.

**Symptom Addressed:**
User records audio, saves it as a "Take", then wonders why they can't synthesize narrative over it.

**Frontend Changes:**

1. **ChapterRecorder** (lines 31–334):
   - Add an onscreen **info banner** before "Start" button:
     ```
     "ℹ️ This recording will be saved as-is. To synthesize narration, use TTS in Quick Synth or Workbench voice selection."
     ```
   - Icon + smaller text, collapsible if space is tight.

2. **TakeSelector Enhancement** (lines 1220–1268):
   - When user selects a "recording" or "upload" engine, show a tooltip:
     ```
     "This is a pre-recorded take. To synthesize new narration, go to the 'Preview' panel and click 'Preview', or use 'Quick Synth' to generate TTS."
     ```

3. **ChapterCard Playback Panel** (from Fix #1):
   - If `activeGen.engine === "recording"`, show a note: "Recorded take · Ready to edit or export. To re-synthesize, switch to a TTS voice above."

**Backend Changes:**
- None required.

**i18n Changes:**
- Add:
  - `recorderInfoBanner: "ℹ️ This recording will be saved as-is. To synthesize narration, use the voice preview or Quick Synth."`
  - `takeUploadNote: "Pre-recorded take. To synthesize new narration, switch voice and use Preview or Quick Synth."`

**Tests:**
1. Open ChapterRecorder; verify info banner is visible (not intrusive).
2. Record and save; verify TakeSelector label shows "Recording".
3. Hover/click TakeSelector item; verify tooltip or note appears.
4. Click activeGen playback panel; verify "recorded take" note is shown (if recorded).

**Effort:** 1.5–2 hours (UI text, tooltips, i18n).

---

## MEDIUM-PRIORITY FIXES (P2 — Sprint 5+)

### Fix #6: Add DSP Parameter Guidance (Sprint 2)

**Goal:**
Help users understand LUFS, Denoise, and Compressor parameters without leaving the UI.

**Symptom Addressed:**
User sees "LUFS Target (-24 to -10)" and has no idea what value to choose or why it matters.

**Frontend Changes:**

1. **EditOperationsPanel** (lines 232–282):
   - Replace bare `<label>` tags with a component that includes a `?` icon.
   - Icon shows a tooltip (via title attribute or Tooltip component) with brief help text.

2. **Tooltip Content** (new i18n keys):
   - `studioLufsTip: "Target loudness (LUFS). -16 is podcast standard, -14 is audiobook. Lower = quieter."`
   - `studioDenoiseTip: "Remove background noise. 0% = off, 50% = moderate (recommended), 100% = aggressive."`
   - `studioCompressorTip: "Even out volume: quiet parts get louder, loud parts softer. Higher = more compression."`

3. **Alternatively: Inline Presets**:
   - Add radio buttons or buttons for common presets:
     - Denoise: Off / Moderate (50%) / Aggressive (100%)
     - LUFS: Podcast (-16) / Audiobook (-14) / Music (-10) / Custom
   - User can pick preset or type custom value.

**Backend Changes:**
- None required.

**i18n Changes:**
- Add tooltip keys (see above).
- If using presets, add: `studioPresetPodcast: "Podcast"`, `studioPresetAudiobook: "Audiobook"`, etc.

**Tests:**
1. Hover over each parameter label; verify tooltip appears (if using hover).
2. Read tooltip text; verify it's clear and actionable.
3. If using presets, click "Podcast" for LUFS; verify value changes to -16.
4. Verify tooltip does not block interaction (e.g., input field is still accessible).

**Effort:** 1.5–2 hours (tooltip component integration, i18n, possibly preset UI).

---

### Fix #7: Add Toast Feedback to Scene Image Upload (Sprint 3)

**Goal:**
Confirm to user that image upload succeeded; prevent duplicate submissions.

**Symptom Addressed:**
User clicks "Add Image" → file picker → uploads image → no feedback. User clicks again, thinking it didn't work.

**Frontend Changes:**

1. **SceneManager** (lines 96–106):
   - After `setSceneImages()` succeeds, fire success toast:
     ```typescript
     onToast(t.studioScenesImageAdded.replace("{filename}", res.filename));
     ```
   - Move loading state to `uploadingIdx` (already done, line 66).

2. **Error Toast**:
   - Already present in catch block (line 102).
   - Verify error message is user-friendly (line 102 shows generic error).

**i18n Changes:**
- Add: `studioScenesImageAdded: "Image added: {filename}"`

**Tests:**
1. Click "Add Image" for a scene; pick a file.
2. Verify loading spinner appears on button.
3. Wait for upload; verify success toast shows filename.
4. Verify checkmark + filename appears in scene list.
5. Test error case (mock failed upload); verify error toast appears.

**Effort:** 0.5–1 hour (single toast integration, i18n key).

---

### Fix #8: Add Toast Feedback to Video Render Success (Sprint 3)

**Goal:**
Confirm render completion to user; prevent re-clicks and improve workflow clarity.

**Symptom Addressed:**
User renders video → loading state disappears → user unsure if render is done or failed.

**Frontend Changes:**

1. **VideoRenderPanel** (lines 38–55):
   - Add props:
     - `onRenderSuccess?: () => void` (called when render completes).
     - `onRenderError?: (msg: string) => void` (called on failure).

2. **Calls** (line 373–382):
   - After `onRender()` completes successfully, call `onRenderSuccess()` → which fires a toast.
   - Example: `t.studioVideoRenderSuccess`.

3. **StudioTab Integration** (lines 186–207):
   - Pass `onRenderSuccess={() => onToast(t.studioVideoRenderSuccess)}`.

**i18n Changes:**
- Add: `studioVideoRenderSuccess: "Video rendered successfully"`

**Tests:**
1. Set up a chapter with cover + audio.
2. Click "Render video".
3. Wait for render; verify success toast appears ("Video rendered successfully").
4. Verify video appears in result panel.
5. Test error case (mock backend error); verify error toast appears.

**Effort:** 1–1.5 hours (prop handling, callback wiring, toast integration).

---

## DEFERRED / LOWER-PRIORITY IMPROVEMENTS (P3)

### Future: Keyboard Shortcuts for Studio
- **Ctrl+Shift+A** (or **Cmd+Shift+A** macOS): Apply operations.
- **Ctrl+P**: Preview.
- **Ctrl+Z**: Undo (if undo stack is implemented).

### Future: Batch Undo for Studio Operations
- Implement undo/redo stack using state management (Redux, Zustand, or Context).
- Deferred until after P0/P1 fixes.

### Future: Drag-and-Drop for Scene Images
- Allow drag-drop of image onto scene row to assign image.
- Deferred due to browser compatibility concerns.

### Future: Synthesis from Uploaded Audio
- Allow user to use uploaded narration as source for effects (currently Studio edits only support pre-generated audio).
- Requires backend changes to synthesis pipeline.

---

## Rollout Plan

### Phase 1 (Next Sprint — CRITICAL)
- **Fix #1**: Playback for uploaded audio in Workbench.
- **Fix #2**: Success feedback for image generation.
- **Effort**: ~4–5 hours total.
- **Priority**: Block P0 (these break core workflows).

### Phase 2 (Sprint 5 — HIGH + MEDIUM)
- **Fix #3**: Preview mode for Studio operations.
- **Fix #4**: Confirmation dialogs.
- **Fix #5**: Recording workflow clarity.
- **Fix #6**: DSP parameter guidance.
- **Fix #7**: Scene image upload toast.
- **Fix #8**: Video render success toast.
- **Effort**: ~11–14 hours total.
- **Priority**: Polish and friction reduction.

### Phase 3 (Future — Nice-to-Have)
- Keyboard shortcuts, undo/redo, drag-drop.

---

## Testing Strategy (All Phases)

### Manual Testing
1. **Playback** (Fix #1): Upload .wav, .mp3, .webm → verify audio plays in Workbench.
2. **Async Feedback** (Fixes #2, #7, #8): Generate image, upload image, render video → verify toast appears.
3. **Confirmation** (Fix #4): Clear queue → verify confirmation dialog.
4. **Tooltips** (Fix #6): Hover/inspect DSP labels → verify tooltip content.

### Automated Testing (vitest)
- Test toast firing for image gen success/error.
- Test state transitions in SceneManager (loading, success, error).
- Test confirmation dialog acceptance/rejection.

### Accessibility Audit
- Tab through all new buttons; verify focus states.
- Test screen reader for new toast messages and labels.
- Test color contrast for new UI elements.

### Cross-Browser Testing
- Chrome (primary), Firefox, Safari, Edge.
- Test audio playback on each (codec compatibility).
- Test modal/dialog rendering.

---

## Success Criteria

| Fix | Criterion |
|-----|-----------|
| #1 | User can upload audio in Workbench and play it back without navigating away. |
| #2 | User receives success/error toast when image generation completes. Duplicate submissions prevented (button disabled). |
| #3 | User can preview effect chain before applying; preview is clearly labeled "not saved". |
| #4 | Accidental queue clear requires confirmation; users cannot undo without manually re-adding. |
| #5 | User understands recording is a pre-recorded take; tooltip/banner points to TTS synthesis path. |
| #6 | User hovers over DSP label and sees helpful tooltip explaining parameter range and common values. |
| #7 | User sees success toast when scene image upload completes. |
| #8 | User sees success toast when video render completes. |

---

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Playback audio element breaks on slow networks | Lazy-load audio element; test with throttled network. |
| Preview mode introduces backend overhead | Limit preview to small waveforms; cache results in memory. |
| Tooltips clash with mobile UX | Provide alternate touch-friendly help (e.g., "?" button that shows panel). |
| i18n keys missing in other languages | Add all new keys to `en.ts` + `es.ts` simultaneously; CI enforces parity. |
| Confirmation dialogs add friction | Only use for **destructive** actions (Clear Queue, Remove Op). Preview/Generate don't need confirmation. |

---

## Dependencies & Blockers

- **Fix #1** (Playback): Requires `/api/generate-audio-url` or similar backend endpoint to serve generation audio files. Verify route exists.
- **Fix #3** (Preview): Requires backend support for `?preview=true` on apply-operations endpoint.
- **All**: Assumes i18n system supports placeholders (e.g., `"{n}"`, `"{filename}"`). Verify in `i18n/index.ts`.

---

## Summary

These 8 fixes target **feedback completeness** across Sprints 1–4. Phase 1 (P0) is CRITICAL and should be shipped ASAP; Phase 2 (P1–P2) is a nice-to-have polish pass; Phase 3 is future work. Combined effort: ~16–20 hours for all phases.
