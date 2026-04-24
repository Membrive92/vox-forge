# UX Audit: Sprints 1-4 (d1baccb–b97e230)

## Executive Summary

Sprints 1–4 introduced critical features (audio upload/recording, LUFS/denoise/compressor, slideshow video with per-scene images, image generation) but contain **5 critical-to-high UX gaps** where users cannot perform essential actions without unexpected friction or confusion. The most pressing: **uploaded audio appears to "work" but is invisible and unplayable** until the user navigates away from Workbench to Studio—a dead-end user experience.

---

## Findings by Severity

### CRITICAL: Audio Upload Feels Like Nothing Happened (Sprint 1 — Workbench)

**Symptom:**
- User uploads audio in Workbench (WorkbenchTab.tsx, lines 196–207).
- Toast says "Audio uploaded — it's now the active take" (chapterUploadSuccess).
- No playback affordance appears; user cannot listen to what they uploaded without leaving Workbench.
- The uploaded file becomes an invisible "active take" in the TakeSelector dropdown but is never displayed, previewed, or played in the UI.

**Root Cause:**
- `ChapterCard` has upload/record buttons but **zero playback UI for uploaded audio**.
- TakeSelector only shows metadata (engine type, timestamp, duration) but no play button.
- Audio sources are only playable in **Studio** (via waveform player), not in Workbench.
- User workflow is broken: upload → silence → forced navigation to Studio to verify it worked.

**Impact:** CRITICAL
- Users doubt if upload succeeded.
- Encourages duplicate uploads (retry → "why isn't this working?").
- Breaks discoverability of recorded/uploaded audio as a valid input path vs. TTS-only.

**Current State:**
- Lines 456–514 (WorkbenchTab): Two buttons (Upload, Record) with loading states but no playback.
- Lines 1220–1268 (TakeSelector): Dropdown only; no preview or playback.
- Line 199 in WorkbenchTab: `await loadStatus()` refreshes the generation list but the UI doesn't surface the file as playable.

---

### CRITICAL: Image Generation Dialog Does Not Confirm Success (Sprint 4 — VideoRenderPanel)

**Symptom:**
- User clicks "Generate" in ImageGenDialog (VideoRenderPanel.tsx, lines 656–800).
- Dialog closes; no toast, no status message, no confirmation that generation started or completed.
- If generation fails (network, quota, invalid prompt), the user never learns why—the image just doesn't appear.
- User may click "Generate" repeatedly, spawning duplicate requests.

**Root Cause:**
- `handleGenerateSceneImage` (lines 111–132 in VideoRenderPanel) has try/catch with error toast but **no success toast**.
- Dialog closes immediately on submit (line 638: `closeGenDialog()`), removing all UI context.
- State update (line 126: `setSceneImages()`) happens silently in the background.
- No loading/progress indicator while generation runs.

**Impact:** CRITICAL
- Generates false sense of "did that work?" and invites retry spam.
- Users may abandon feature if they see no visual feedback.
- Network/inference failures are invisible unless the user stares at the scene list.

**Current State:**
- Lines 661–667: Submit validation but no success feedback.
- Lines 101–102 (handleGenerateSceneImage): Toast only on error.

---

### HIGH: Edit Operations Have No Undo/Cancel/Preview (Sprint 2 — Studio)

**Symptom:**
- User adds operations (Trim, Delete, Fade, LUFS, Denoise, Compressor) in EditOperationsPanel.
- User can only remove operations one at a time via trash icon (line 369).
- No way to preview the effect before applying.
- No "Apply & Preview" mode—user commits to all ops at once (line 387–393).
- If result is wrong, user must manually remove ops and re-add new ones.

**Root Cause:**
- `EditOperationsPanel` is **batch-only**; no intermediate feedback.
- `onApply` (line 387) is "Apply All" with no undo.
- Waveform player shows the original source, never a preview after ops.
- Operations are visual list items only; no real-time scrubbing or "what-if."

**Impact:** HIGH
- Users hesitate to apply complex effect chains.
- Mistakes are costly—must remove and re-add ops.
- Discourages experimentation with LUFS and Denoise settings.

**Current State:**
- Lines 378–402: Single "Apply" button, no preview mode.
- Lines 313–375: Operations list with per-op remove but no batch undo.

---

### HIGH: Recorder Playback is Isolated; No Synthesis Path from Recording (Sprint 1 — ChapterRecorder)

**Symptom:**
- User records audio in ChapterRecorder (lines 268–270 shows inline `<audio controls>`).
- User can play back the recording, then Save.
- But once saved, the recording is a "Take" (Upload engine), not a TTS-eligible source for synthesis.
- User cannot synthesize over the recording without re-uploading or using a different chapter.

**Root Cause:**
- Recording goes straight to `uploadChapterAudio()` (line 212 in WorkbenchTab).
- Backend returns `engine: "recording"` (or "upload").
- Synthesis workflow (ChunkMap, QuickPreview) expects TTS engines, not uploads.
- User journey is: Record → Save → (dead end; must use as-is or start TTS in QuickSynth).

**Impact:** HIGH
- Confuses users about the purpose of recording (is it for playback or synthesis?).
- Inconsistent UX: RecorderStart/Stop UI is rich (timer, level meter, states) but the saved artifact is frozen in UI.

**Current State:**
- Lines 177–183 (ChapterRecorder): Converts blob to File.
- Line 212 (WorkbenchTab): Uploads directly without clarifying downstream options.

---

### HIGH: Scene Image Assignments Have No Visual Feedback During Upload (Sprint 3 — VideoRenderPanel)

**Symptom:**
- User clicks "Add Image" for a scene (SceneManager, line 597).
- File picker opens, user selects image.
- Image is uploading but the button state doesn't clearly show "uploading" vs. "idle."
- User may click again, thinking the action didn't register.
- Once uploaded, the confirmation checkmark (line 585: `✓ {img.filename}`) appears, but no toast or status message.

**Root Cause:**
- Button loading state (line 596: `loading={uploading}`) is the only feedback.
- No toast on successful upload (compare to `handlePickCover`, which has error toast but no success).
- `setSceneImages()` state update is silent.
- User must visually inspect the scene list to confirm.

**Impact:** HIGH
- Unclear if upload is in-flight, pending, or complete.
- Encourages duplicate file selections (user thinks they missed the upload).
- Especially bad in SceneManager where multiple scenes exist—which one is uploading?

**Current State:**
- Lines 96–106 (handlePickSceneImage): Silent state update.
- Line 597: Button loading state only; no toast.
- Lines 572–590: Visual confirmation (checkmark) but no toast.

---

### MEDIUM: Denoise/Compressor/LUFS Parameters Lack Explanatory Tooltips (Sprint 2 — EditOperationsPanel)

**Symptom:**
- User sees input fields for Denoise Strength (0–100%), Compressor Amount (0–100%), LUFS Target (-24 to -10).
- No inline help text for what these values mean or why they matter.
- Field for LUFS has a `title` attribute (line 223) but users rarely discover tooltips.
- User must know DSP terminology or guess.

**Root Cause:**
- Input labels are bare: "Denoise Strength", "Compressor Amount", "LUFS Target" (lines 252, 272, 232).
- Only LUFS has a title attribute for hover; Denoise and Compressor do not.
- No "?" icon or expandable help.
- Activity tab has pronunciation settings but not DSP settings docs.

**Impact:** MEDIUM
- Advanced users unfamiliar with these DSP concepts may avoid the feature.
- Parameter ranges look arbitrary (0–100 vs. -24 to -10).
- No guidance on recommended starting values.

**Current State:**
- Lines 241, 260, 279: Number inputs with minimal labels.
- Line 223: Single title on LUFS label.

---

### MEDIUM: Video Render Success Is Silent; User Must Check Recent Renders Tab (Sprint 3 — Studio)

**Symptom:**
- User renders a video in VideoRenderPanel (line 373–383: `onRender()`).
- Button text changes to show count: "Render slideshow (N images)" (line 385–387).
- User clicks; loading state appears briefly.
- When done, **no toast** — user must scroll to "Recent Renders" tab to see the result.
- If render failed silently, user has no way to know without polling Recent Renders.

**Root Cause:**
- `VideoRenderPanel` accepts `onRender` callback but does not fire success/failure toasts.
- Parent (StudioTab, line 198–202) receives `onRender` but calls `refreshRenders()` only on success.
- No success message; error is silent if refresh fails.
- Result video appears in a dedicated panel (lines 391–428) but only if the same component re-renders.

**Impact:** MEDIUM
- Users unsure if render is processing, done, or failed.
- Encourages re-clicking the Render button ("Why isn't it working?").
- Workflow is opaque—user must know to check Recent Renders tab.

**Current State:**
- Lines 363–389: Render button with no success feedback.
- Line 31: Callback `onRender` has no feedback contract.

---

### MEDIUM: No Confirmation Before Deleting Operations or Clearing Queue (Sprint 2 — Studio)

**Symptom:**
- User has 5 operations queued (Trim, Fade-in, Denoise, Normalize, Fade-out).
- User clicks "Clear Queue" button (line 400) to remove all at once.
- **No confirmation dialog** — queue is cleared immediately.
- User realizes they cleared the wrong set of ops and must re-add.

**Root Cause:**
- `onClear()` callback (line 395–401) has no confirmation.
- Individual op remove (line 364–371) also has no confirmation.
- Button label says "Clear Queue" but has no affordance (e.g., red color) to signal destructive action.

**Impact:** MEDIUM
- Accidental queue clears are costly (must re-add 3+ ops).
- Inconsistent with other destructive actions (e.g., Delete chapter has no toast warning, but feels more serious).

**Current State:**
- Lines 395–401: Ghost variant, no warn color.
- No confirmation modal or inline prompt.

---

## Table of Findings

| Finding | Sprint | Severity | Component | Lines | Root Cause |
|---------|--------|----------|-----------|-------|-----------|
| Audio upload invisible; no playback | 1 | **CRITICAL** | WorkbenchTab, ChapterCard, TakeSelector | 196–1268 | No upload playback UI; must go to Studio |
| Image generation has no success feedback | 4 | **CRITICAL** | ImageGenDialog | 656–800 | No success toast; dialog closes immediately |
| Edit operations batch-only, no preview | 2 | **HIGH** | EditOperationsPanel | 37–402 | Single "Apply All" button; no undo or preview mode |
| Recording → upload path is unclear | 1 | **HIGH** | ChapterRecorder, WorkbenchTab | 31–335 | Recording engine frozen; no synthesis path |
| Scene image upload feedback unclear | 3 | **HIGH** | SceneManager | 466–645 | Button loading state only; no toast |
| DSP parameters lack guidance | 2 | **MEDIUM** | EditOperationsPanel | 232–282 | Minimal labels; no help text or presets |
| Video render success is silent | 3 | **MEDIUM** | VideoRenderPanel | 38–55, 156–431 | No toast feedback; user must check Recent Renders |
| No confirmation on destructive ops | 2 | **MEDIUM** | EditOperationsPanel | 395–401 | Buttons lack confirmation; too easy to clear |

---

## Accessibility & Keyboard Navigation Notes

- **ChapterRecorder**: Recorder controls (Start, Pause, Stop, Save) are properly labeled and keyboard-accessible.
- **EditOperationsPanel**: No obvious missing aria-labels, but "Clear Queue" should have `aria-description` about consequences.
- **VideoRenderPanel**: ImageGenDialog is a modal with `role="dialog"` and `aria-modal="true"` — good (lines 671–673).
- **Minor gap**: No keyboard shortcut for "Apply" in Studio (could be Ctrl+Shift+A or similar); user must mouse to button.

---

## Performance & Responsiveness Notes

- **SceneManager upload loop**: Multiple scenes with file uploads may create a performance bottleneck if user clicks "Generate" 5 times in quick succession. No debounce or queue.
- **ImageGenDialog submit**: Generator call is not debounced; rapid "Generate" clicks will spawn multiple requests (no request coalescing).
- **RecorderStart**: Initializes `AudioContext` and `AnalyserNode` on demand—good. Cleanup (lines 50–70) is thorough.

---

## Discoverability Issues

1. **Upload audio as a core feature**: The "Upload Audio" button (line 477 in WorkbenchTab) lacks any indication that it's a primary input method alongside TTS. Users may miss it.
2. **Recorder vs. Upload**: Two separate buttons (lines 477, 486) but no clear distinction in tooltips about when to use each.
3. **Character Casting vs. Take Selector**: Both are "panels" (lines 542–550 for cast, lines 495–502 for takes) but cast is hidden until user clicks "Cast" toggle. Takes selector is always visible but in a small dropdown. Cognitive overhead.
4. **Scene Slideshow**: Only appears if user transcribes audio (line 350 in VideoRenderPanel). No upfront explanation of this feature; user may never discover it.

---

## Summary

These gaps fell through because **Sprints 1–4 added features faster than the UI feedback layer**. Each sprint added backend capability + a button but overlooked:

- Toast notifications for async completion (image gen, scene upload).
- Preview modes for destructive operations (Studio edits).
- Playback integration (uploaded audio in Workbench).
- Confirmation dialogs for bulk destructive actions.
- DSP parameter guidance.

The next audit should focus on **feedback completeness**: every async action (upload, generate, render, apply) should have explicit feedback (toast or modal) on success and failure.
