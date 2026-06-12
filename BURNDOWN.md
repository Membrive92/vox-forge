# BURNDOWN — Plan de remediación VoxForge

> Tracking vivo de `remediation_plan/REMEDIATION_PLAN.md` (F0–F9).
> Cada hallazgo se cierra **en el mismo commit** que lo arregla, actualizando su fila.

## Baseline (F0 — 2026-06-11)

| Suite | Resultado |
|---|---|
| Backend `pytest` | **254 passed** |
| Frontend `vitest` | **61 passed** |
| `tsc --noEmit` | limpio |
| E2E Playwright | **10 passed, 3 skipped** (tras actualizar 2 selectores rotos por la migración a ARIA tabs — regla F4: selector, no flujo) |
| Módulo visual (`img_generation_module`, fuera de alcance) | 177 passed |

**Triaje**: verificado contra el working tree el 2026-06-11 por 3 agentes + spot-check manual
de 14 veredictos disputados (todos corregidos con evidencia). Commits de cierre previos:
campaña audit-fixes `c3c2228..d48eaab` (19 commits, 2026-06-08/10).

**Estados**: `RESUELTO-PREVIO` · `ABIERTO` · `NO-REPRODUCIBLE` · `WONTFIX` (justificado) · `HUMANO-PENDIENTE` · `DIFERIDO` (solo §F9).

**Recuento**: Críticos 3/3 resueltos · Altos 13/13 resueltos · Medios 23/33 resueltos, **10 abiertos** · Bajos 14/38 resueltos, **24 abiertos** · Nuevos (fuentes 2 y 3): **26 abiertos** (3 de ellos HUMANO).

---

## Críticos (AUDIT §2)

| id | título | estado | evidencia | commit |
|---|---|---|---|---|
| CRIT-1 | Path traversal vía `job_id` | RESUELTO-PREVIO | `synthesis.py:60` valida con `job_store.is_valid_job_id`; `_JOB_ID_RE` + `relative_to` en job_store | 6553c2d |
| CRIT-2 | Deletes destructivos sin confirmación | RESUELTO-PREVIO | `useConfirm` en ChapterCard, WorkbenchTab, ProfilesTab, RecentRenders | d716024 |
| CRIT-3 | `cleanup_old_files` borra generaciones persistidas | RESUELTO-PREVIO | `utils.py` consulta `_referenced_paths()` de la BD y las salta; fail-safe si BD ilegible | 6553c2d |

## Altos (AUDIT §3)

| id | título | estado | evidencia | commit |
|---|---|---|---|---|
| ALTO-01 | `narration_path` sin allowed-roots | RESUELTO-PREVIO | `ambience.py:130-134` usa `is_within_allowed_roots` | 6553c2d |
| ALTO-02 | regenerate-chunk éxito falso (sin re-splice) | RESUELTO-PREVIO | `_resplice_chapter` actualiza `generation.file_path`; takes con `file_path` (chapter_synth.py:150,239,245) | 6553c2d |
| ALTO-03 | `useProfiles()` ×4 desincronizado | RESUELTO-PREVIO | `src/hooks/profilesContext.ts` + Provider en App | d716024 |
| ALTO-04 | Studio `/edit` bloquea event loop | RESUELTO-PREVIO | `asyncio.to_thread` en studio.py:166-172 | 6553c2d |
| ALTO-05 | ZIP batch-export bloquea event loop | RESUELTO-PREVIO | `_build_zip` (ZIP_STORED) vía to_thread, batch_export.py:159 | 6553c2d |
| ALTO-06 | Monitor de cancelación fire-and-forget | RESUELTO-PREVIO | `cancellation.py:75-77` ref fuerte + `finish()`; llamado en finally de los 4 routers | 6553c2d |
| ALTO-07 | Semáforo GPU retenido todo el bucle de candidatos | RESUELTO-PREVIO | lock per-inference en `_generate_one`; scoring vía to_thread; test invariante | a614a96 |
| ALTO-08 | Deletes sin unlink de audios | RESUELTO-PREVIO | `_collect_paths`/`_unlink_audio_files` en project_manager | 6553c2d |
| ALTO-09 | Migración sin `user_version` ni `generations.engine` | RESUELTO-PREVIO | `SCHEMA_VERSION=2` + `_MIGRATION_COLUMNS` | 6553c2d |
| ALTO-10 | Filas de proyecto no enfocables | RESUELTO-PREVIO | SidebarProjectRow con role/tabIndex/onKeyDown | d716024 |
| ALTO-11 | Audio Tools inalcanzable; `tabs.ts` muerto | RESUELTO-PREVIO | entrada de nav en App; `tabs.ts` borrado | d716024 |
| ALTO-12 | Test de regenerate-chunk solo afirma 200 | RESUELTO-PREVIO | `test_workbench.py:429+` afirma cambio de `file_path`/bytes | 6553c2d |
| ALTO-13 | projects/chapters/gens/takes sin `response_model` | RESUELTO-PREVIO | response_model en projects.py + tipos TS derivados del esquema | 6553c2d, ed9aca7 |

## Medios (AUDIT §4)

| id | título | estado | evidencia | commit |
|---|---|---|---|---|
| MED-SEC-1 | CORS abierto | RESUELTO-PREVIO | config.py:32 allowlist localhost; allow_credentials=False | 6553c2d |
| MED-SEC-2 | Ruta de subtítulos sin escaping en ffmpeg | RESUELTO-PREVIO | `_escape_subtitles_path` (video_renderer, 3 usos) + test | 4a88bde |
| MED-SEC-3 | Uploads confían en content-type | RESUELTO-PREVIO | `validate_audio_bytes` magic-bytes en 4 endpoints persistentes | 4a88bde |
| MED-COR-1 | candidates fuga WAV anclado | RESUELTO-PREVIO | experimental.py:348-351 unlink en finally | 4a88bde |
| MED-COR-2 | single no borra `anchored_path` | RESUELTO-PREVIO | experimental.py:274-277 unlink en finally | 4a88bde |
| MED-COR-3 | Resume XTTS imposible; `JobRecord.engine` hardcodeado | RESUELTO | `JobRecord.engine` vía `TTSEngine.resolve_routing`; `synthesize_long` persiste `chunk_NNNN.wav` en `data/jobs/{id}` con `os.replace` y salta existentes al reanudar | c6ff522 |
| MED-COR-4 | `_spell_unknown_siglas` rompe 'NO' | RESUELTO-PREVIO | `_COMMON_UPPER_WORDS` allowlist + test | 4a88bde |
| MED-COR-5 | extract-characters `body: dict` | RESUELTO-PREVIO | `ExtractCharactersRequest` (character_synth.py:45) | 6553c2d |
| MED-COR-6 | `update_project` `type: ignore` oculta None | RESUELTO-PREVIO | 0 type:ignore; None→404 | 6553c2d |
| MED-CONC-1 | Progreso leído fuera del lock | RESUELTO-PREVIO | `snapshot()` bajo lock, usado en synthesis.py:120 | 4a88bde |
| MED-CONC-2 | chunks_total/takes con chunking Edge para perfiles XTTS | RESUELTO | `resolve_routing` ANTES de cualquier bookkeeping; `chunk_texts_for_engine` (tts_engine) da la lista real (clause-level para xtts-v2) y la usan generación+progress+takes+chunk map+regen+QC; el engine de la fila es el resuelto (también en error); QC ahora resuelve `chunk_NNNN.wav` del job dir para clones (índices ya alineados); `_resplice_chapter` con guarda explícita edge-tts. Tests: registro feliz con clone stub (3 clone chunks vs 1 edge), fallo sin CUDA conserva engine/chunks reales, QC puntúa WAVs de clon y marca solo el saboteado | F3 |
| MED-CONC-3 | Scoring CPU bajo semáforo GPU | RESUELTO-PREVIO | clone_engine.py:367 to_thread fuera del lock | a614a96 |
| MED-PERF-1 | `/analyze/sample` en el event loop | RESUELTO-PREVIO | `_analyze_bytes` vía to_thread (analyze.py:143) | 6553c2d |
| MED-PERF-2 | N inserts secuenciales de takes | RESUELTO-PREVIO | `create_takes` executemany | 6553c2d |
| MED-PERF-3 | PRAGMA WAL por query | RESUELTO-PREVIO | WAL una vez en init_db | 6553c2d |
| MED-PERF-4 | "latest done generation" sin LIMIT 1 | RESUELTO | `pm.get_latest_done_generation(chapter_id)` (`status='done' ORDER BY created_at DESC LIMIT 1`) sustituye los 3 escaneos de chapter_synth (regen/chunk-map/qc) y el de batch_export (que ahora resuelve la activa vía `get_generation(id)`); tests: el helper ignora errores más nuevos y devuelve None sin done; export reutiliza la última done sin re-sintetizar (spy en `TTSEngine.synthesize` + bytes del ZIP) | F3 |
| MED-PERF-5 | Duración decodificando completo | RESUELTO | resto cerrado: las 2 sondas de chapter_synth (post-síntesis y upload-audio) usan `audio_meta.duration_seconds` vía `asyncio.to_thread` (mutagen primero, pydub como fallback); el decode real solo queda donde el audio se procesa de verdad (`_resplice_chapter`) | c14f5a6 + F3 |
| MED-ERR-1 | Sin cleanup si bookkeeping post-síntesis falla | RESUELTO-PREVIO | chapter_synth.py:124-131 try/except + finish() | 6553c2d |
| MED-ERR-2 | `InvalidSampleError` reusada (mensaje engañoso) | RESUELTO | `PathNotAllowedError` (400, `path_not_allowed`) e `InvalidParameterError` (400, `invalid_parameter`) + entradas en `_USER_FRIENDLY_MESSAGES`; sustituidas en studio.py (edit/transcribe/render-video paths, aspect ratio, cover-or-images, kind) y experimental.py (idioma); `InvalidSampleError` queda solo para validación real de muestras (uploads, audio_editor, video_renderer); 6 asserts de tests actualizados al código honesto | F3 |
| MED-INT-1 | Escrituras atómicas sin fsync | RESUELTO-PREVIO | `atomic_io.write_text_atomic` con fsync | 6553c2d |
| MED-INT-2 | split_text_into_chapters sin cleanup/transacción | RESUELTO-PREVIO | project_manager.py:274-286 collect+unlink | 6553c2d |
| MED-INT-3 | `studio_renders` huérfanos | RESUELTO-PREVIO | DELETE studio_renders en cascade (project_manager.py:229,232) | 6553c2d |
| MED-PERF-F1 | Fetch duplicado renders 4×N | RESUELTO-PREVIO | ChunkMap.tsx:58 fetch único por capítulo | d716024 |
| MED-PERF-F2 | `timeupdate` re-renderiza lista entera | **ABIERTO** | useAudioPlayer.ts:43 sin throttle | — |
| MED-PERF-F3 | Workbench sin virtualización/colapso | **ABIERTO** | WorkbenchTab.tsx render eager de cards | — |
| MED-A11Y-1..6 | Modales/foco/cards/filas/outline (6 items) | RESUELTO-PREVIO | useFocusTrap en 3 diálogos; activateOnKey en Lab/Ambience; sweep outline | d716024, 74c26c7 |
| MED-UX-1 | Studio callejón sin salida | RESUELTO-PREVIO | breadcrumb "volver" en StudioTab | d716024 |
| MED-UX-2 | Toasts ES como 'info' neutro | RESUELTO-PREVIO | markers ES en useToast (nota: F7/UX puede preferir tipo explícito) | d716024 |
| MED-UX-3 | Banner resume lejos del fold | **ABIERTO** | App.tsx:209 navega sin scroll a la sección resume | — |
| MED-UX-4 | Delete render sin confirmación | RESUELTO-PREVIO | ConfirmDialog en RecentRenders:248 | d716024 |
| MED-UX-5 | Indicador "edited" no-op sin genId | **ABIERTO** | ChunkMap.tsx:137-158 | — |
| MED-I18N-1..8 | InteractivePlayer/Pronunciation/Settings/toasts/Toast (8 items) | RESUELTO-PREVIO | claves t.* cableadas (defaults EN de InteractivePlayer → BAJO-36) | 36d44a5..d48eaab |
| MED-TIPOS-1..3 | response_model projects/analyze/chunk-map | RESUELTO-PREVIO | response_model en los 3; tipos regenerados | 6553c2d |
| MED-TEST-1 | Test regen débil | RESUELTO-PREVIO | (= ALTO-12) | 6553c2d |
| MED-ARQ-1 | `tabs.ts` divergente | RESUELTO-PREVIO | borrado | d716024 |
| MED-ARQ-2 | useProfiles ×4 | RESUELTO-PREVIO | (= ALTO-03) | d716024 |
| MED-ARQ-3 | setState durante render (VideoRenderPanel) | **ABIERTO** | VideoRenderPanel.tsx:71 | — |
| MED-ARQ-4 | useStudioSession god-hook | **ABIERTO (parcial)** | apply/applyPreview colapsados (0a1df73); falta partir en 3 hooks | 0a1df73 parcial |
| MED-ARQ-5 | activity/stats/experimental/ambience dict crudo | RESUELTO-PREVIO | response_model en los 4 | 1466001 |

## Bajos (AUDIT §5)

| id | título | estado | evidencia |
|---|---|---|---|
| BAJO-1 | Log injection `X-Request-ID` | **ABIERTO** | middleware.py:30-31 sin sanitizar |
| BAJO-2 | Monitor fugado (dup ALTO-06) | RESUELTO-PREVIO | = ALTO-06 |
| BAJO-3 | Unidades corrompen texto | RESUELTO-PREVIO | text_normalizer.py:284 regex con word-boundary |
| BAJO-4 | `_run_loudnorm` sin guarda ffmpeg | **ABIERTO** | audio_editor.py:173-184 |
| BAJO-5 | RMS crudo bajo campo dBFS | **ABIERTO** | analyze.py:28,69 `rms` sigue siendo amplitud entera |
| BAJO-6 | Edit-draft conflictivo en `handleUseProfile` | **ABIERTO** | App.tsx:130-141 |
| BAJO-7 | Player ChunkMap sin reset por genId | **ABIERTO** | ChunkMap.tsx:39-43 |
| BAJO-8 | `onActiveProjectChange` parpadeo | **ABIERTO** | WorkbenchTab.tsx:105 |
| BAJO-9 | StatusChip con latestDoneGen | RESUELTO-PREVIO | ChapterCard.tsx:498 usa activeGen.id |
| BAJO-10 | Scrub contra duration de estado | **ABIERTO** | InteractivePlayer.tsx:47-51 |
| BAJO-11 | cleanup stat/unlink bloqueantes | **ABIERTO** | utils.py sin to_thread (la parte BD-aware sí está) |
| BAJO-12 | App reconstruye settings/draft cada render | **ABIERTO** | App.tsx:79-93 |
| BAJO-13 | AmbienceMixer 2 players sin throttle | **ABIERTO** | AmbienceMixer.tsx:42 (cae con MED-PERF-F2) |
| BAJO-14 | useErrorBadge sin pausa en hidden | **ABIERTO** | useErrorBadge.ts:20 |
| BAJO-15 | HTTPException sin mensaje amigable | **ABIERTO** | chapter_synth.py:48+ |
| BAJO-16 | `catch {}` vacíos | **ABIERTO** | WorkbenchTab.tsx:118, ChunkMap.tsx:50,58 |
| BAJO-17 | Resume concurrente mismo job_id | RESUELTO | resume devuelve 409 si `status=="running"` (check+start sin await, race-free); /synthesize acuña id fresco si el header está en vuelo; chunks con `os.replace` atómico — 479aafa |
| BAJO-18 | Takes done sin file_path | RESUELTO-PREVIO | chapter_synth.py:150,239,245 persisten file_path |
| BAJO-19 | Nav sin tablist/tab | RESUELTO-PREVIO | ARIA tabs completo (App.tsx:490+) — d6777a7 |
| BAJO-20 | `<audio>/<video>` sin nombre accesible | **ABIERTO** | ChapterCard/StudioTab/Recorder/VideoRenderPanel |
| BAJO-21 | Tooltip Slider `<span>` no enfocable | **ABIERTO** | Slider.tsx:35, EditOperationsPanel ×3 |
| BAJO-22 | M:SS duplicado | RESUELTO-PREVIO | utils/format.ts — 33abced |
| BAJO-23 | Anchor de descarga duplicado | RESUELTO-PREVIO | utils/download.ts — d6777a7 |
| BAJO-24 | `<audio>` oculto duplicado | RESUELTO-PREVIO | components/HiddenAudio.tsx — 9f5bf26 |
| BAJO-25 | Duración duplicada backend | RESUELTO-PREVIO | audio_meta.py — c14f5a6 (resto en MED-PERF-5) |
| BAJO-26 | latest-done inline duplicado | RESUELTO | = MED-PERF-4: los 4 call sites consumen `pm.get_latest_done_generation` — F3 |
| BAJO-27 | ALLOWED_AUDIO_EXTS duplicada | **ABIERTO** | chapter_synth.py:270 vs upload_utils.py:52 |
| BAJO-28 | Re-import local SynthesisRequest | **ABIERTO** | chapter_synth.py:88,195 |
| BAJO-29 | WorkbenchTab sobredimensionado | **ABIERTO (parcial)** | 1745→883 (4ba952e); objetivo F4 <600 + partir ChapterCard |
| BAJO-30 | Prop drilling Voices (~17 props) | **ABIERTO** | VoicesPlusLab.tsx:43+ |
| BAJO-31 | `moveOperation` sin UI | **ABIERTO** | useStudioSession.ts:168 |
| BAJO-32 | `_PAUSE_TAG_*` muertas | **ABIERTO** | tts_engine.py:106-108 |
| BAJO-33 | Rama fallo `_run_command` sin test | RESUELTO | test_studio.py: exit!=0 con extracto de cola de stderr, ffmpeg ausente, y render sin output file — F1 `test(audit-bajo) BAJO-33` |
| BAJO-34 | Concat character-cast sin test | RESUELTO | test_workbench.py: spy sobre `AudioSegment.silent` (600ms switch / 300ms mismo personaje, verificado vía X-Audio-Duration) + cleanup de temporales en éxito y en fallo — F1 `test(audit-bajo) BAJO-34` |
| BAJO-35 | Invariante semáforo sin test | RESUELTO-PREVIO | test_clone_engine: holds_gpu_semaphore — a614a96 |
| BAJO-36 | Defaults EN en InteractivePlayer | **ABIERTO** (→F6) | InteractivePlayer.tsx:24-31 props opcionales |
| BAJO-37 | Acentos es.ts convert/lab | **ABIERTO (resto mínimo)** | 1 cadena sospechosa restante en es.ts |
| BAJO-38 | `relativeWhen` 'ahora' hardcodeado | RESUELTO-PREVIO | workbenchHelpers.relativeTime(iso, t) — 4ba952e |

## Nuevos — fuentes 2 y 3 (REMEDIATION_PLAN §F2/F2b/F7/F8/F9)

| id | fase | título | estado |
|---|---|---|---|
| VOZ-01 | F2 | Rubber Band en voice_lab (`_apply_pitch_and_speed`) | RESUELTO — una sola pasada `pedalboard.time_stretch` (pitch+speed combinados, `preserve_formants`); `_apply_pitch_shift`/`_apply_speed` borrados; orden del chain intacto (antes de EQ/comp/reverb) — F2 `fix(voz) VOZ-01..05` |
| VOZ-02 | F2 | Rubber Band en castilian_warmup | RESUELTO — `time_stretch_wav` carga con soundfile y estira con `pedalboard.time_stretch`; docstring sin phase vocoder — F2 `fix(voz) VOZ-01..05` |
| VOZ-03 | F2 | Clamp ±25% backend + zona degradada en slider | RESUELTO — `audio_stretch.clamp_stretch_factor` (0.75–1.25, warning al exceder) aplicado en ambos caminos DSP; Edge-TTS conserva 50–200%; slider Lab marca la zona >±25% (ámbar) con tooltip es/en `infoSpeedDegraded` — F2 `fix(voz) VOZ-01..05` |
| VOZ-04 | F2 | No reenviar `speed` a XTTS; post-stretch siempre | RESUELTO — kwarg `speed` eliminado de `_generate_one`/`raw_synthesize`/`synthesize_chunk`; `synthesize_long` post-estira el máster concatenado una sola vez; comentario del acento sustituido por la política — F2 `fix(voz) VOZ-01..05` |
| VOZ-05 | F2 | Tests de stretch/clamp/no-stacking | RESUELTO — `tests/test_audio_stretch.py` con pedalboard real (1 s × 0.8 ⇒ 1.25 s, no-op en epsilon, clamp+warning, spy de pasada única en `process`) + política speed-nunca-a-XTTS en `test_clone_engine.py` — F2 `fix(voz) VOZ-01..05` |
| VOZ-06 | F2 | A/B de escucha 0.9×/1.15× | HUMANO-PENDIENTE (listo para escuchar: F2 mergeado) |
| VOZ-07 | F9 | resemble-enhance como op Studio | DIFERIDO (opcional; tras F8) |
| VOZ-08 | F2b | Re-ranking candidatos con ASR (`intelligibility.py`) | RESUELTO — núcleo compartido `services/intelligibility.py` (`score_intelligibility`: faster-whisper lazy singleton bajo `gpu_semaphore`, ambos textos por `normalize_for_tts`, `rapidfuzz.fuzz.ratio`; transcriber inyectable, reutilizable por QC-01); en `clone_engine` la selección final es por inteligibilidad con `_score_audio` como pre-filtro barato; presupuesto adaptativo 2+2 (máx 4, antes 8 ciegos) con umbral `settings.intelligibility_threshold` (0.90) y warning al aceptar bajo umbral; settings `whisper_model`/`intelligibility_threshold` vía env; `rapidfuzz` en requirements + requirements-ci; tests: saboteado pierde, escalado solo bajo umbral, "Dr." vs "Doctor" concuerdan — F2b `feat(voz) VOZ-08` |
| VOZ-09 | F2b | Reabrir sampler XTTS (tras VOZ-08; A/B HUMANO) | ABIERTO — implementado; gate A/B pendiente (HUMANO). Defaults reabiertos `temperature=0.70/top_p=0.85/top_k=50/repetition_penalty=6.0` (se mantienen `num_beams=1`, `gpt_cond_len=30`); `_XTTS_QUALITY_PARAMS` sustituido por `_xtts_quality_params()` que lee settings en cada inferencia, los 6 valores expuestos vía env `VOXFORGE_XTTS_*` para iterar la escucha sin tocar código; valores de emergencia (0.1/0.4/20/10.0) documentados en config.py como brazo "viejo" del A/B; tests: defaults + forwarding de settings al modelo — F2b `feat(voz) VOZ-09` |
| VOZ-10 | F2b | Conditioning multi-muestra (schema+UI+migración) | RESUELTO — perfiles con `samples: list[str]` (1–5) en vez de `sample_filename` único: migración one-shot e idempotente de los profiles.json viejos en `ProfileManager._load` (absorbe también el campo muerto `extra_samples`) con reescritura inmediata del archivo; alias HTTP `sample_filename` como computed field read-only deprecado (= samples[0]) para la transición; `upload-sample` ahora AÑADE (400 al sexto, sin huérfanos en disco) + nuevo `DELETE /profiles/{id}/samples/{filename}`; routing (`resolve_routing` → `sample_paths`) resuelve todas las muestras existentes y `CloneEngine` pasa la LISTA completa a `speaker_wav` (XTTS promedia los latents; el anclaje castellano solo sustituye la muestra primaria); conversion usa la primera existente (OpenVoice = 1 embedding); experimental no aplica (sample subido por request); analizador con métrica de ritmo `rhythm_sps` (síl/s aprox por picos de energía sobre duración hablada) por muestra; UI Voices: gestor por tarjeta (añadir por archivo/grabación, escuchar, analizar por muestra con ritmo, descargar, borrar con confirmación, contador n/5) + receta de curación en hint i18n es/en y apéndice en `internal-docs/xtts-finetune.md`; tests: migración idempotente, roundtrip API multi-muestra, stubs de engine reciben la lista, ritmo unit+API, 6 tests UI del gestor — F2b `feat(voz) VOZ-10` (commits 9226a83, 83907fd + UI). NOTA HUMANO: con multi-muestra mergeado, re-evaluar por A/B si `castilian_warmup`/anchor sigue aportando; si no, retirarlo en F4. |
| VOZ-11 | F2b | Fine-tuning: script + doc (entrena HUMANO) | HUMANO-PENDIENTE — prep hecha: `tools/finetune/prepare_dataset.py` (standalone, entorno propio, cero deps de runtime: trocea WAV/MP3 por silencios a clips de 6–12 s, transcribe con faster-whisper y emite metadata.csv estilo ljspeech + wavs/ 22050 Hz mono) + receta `internal-docs/xtts-finetune.md` (AllTalk o trainer oficial; 12 GB VRAM viable en Windows, 8 GB con ≥24 GB RAM vía sysmem fallback; mínimos 2–3 min / 5+ recomendado / 20–60 min objetivo; caveats: horas de GPU, herencia CPML no comercial) + setting `xtts_checkpoint_dir` (`VOXFORGE_XTTS_CHECKPOINT_DIR`, default None = stock) cableado en `CloneEngine.load_model` con tests; entrenamiento y escucha del autor pendientes — F2b `feat(voz) VOZ-11` |
| QC-01 | F8 | QC ASR-diff por chunk + badges en ChunkMap | RESUELTO — `services/qc.py` consume el núcleo VOZ-08 (`intelligibility.transcribe` bajo `gpu_semaphore` por chunk + `text_similarity` con `normalize_for_tts`); `POST /api/chapters/{id}/qc` puntúa cada chunk de la última generación done y persiste `qc_score`/`qc_transcript` en `takes` (migración SCHEMA_VERSION=3); el chunk map expone `qc_score`/`qc_flagged`/`qc_transcript` (flag calculado en lectura contra `settings.intelligibility_threshold` 0.90, así cambiar el umbral re-evalúa sin re-ASR) y regenerar un chunk limpia su veredicto obsoleto; resolución de audio por chunk: `take.file_path` → mp3 del job dir (solo edge-tts; los WAV clause-level de XTTS no se usan, índices distintos ⇒ skip antes que falso flag) → audio completo si chunk único; UI: botón "QC de audio" con loading en ChunkMap + badge ámbar con score y expansión esperado-vs-transcrito, i18n es/en; tests backend (8: saboteado ⇒ solo ese chunk marcado, "Dr." vs "Doctor" sin falso positivo, skip de clones multi-chunk, regen resetea QC, 404/400, migración v3) + 3 de UI (badge/expansión/flujo de botón) — F8 `feat(qc) QC-01` |
| PROD-01 | F7 | `POST /api/engines/unload` (política GPU inter-proceso) | ABIERTO |
| PROD-02 | F7 | ComfyUIProvider real (stack Apache, títulos, settings) | ABIERTO |
| PROD-03 | F7 | Detección de escenas desde SRT | ABIERTO |
| PROD-04 | F7 | Coherencia documental (SUPERSEDED + README) | ABIERTO |
| PROD-05 | F7 | Export de 2 workflows + BENCHMARK.md | HUMANO-PENDIENTE |
| PROD-06 | F9 | Spike Chatterbox vs XTTS optimizado | DIFERIDO (harness tras VOZ-08/09/10) |
| PROD-07 | F9 | Spike RVC para conversión | DIFERIDO (decisión HUMANO) |
| PROD-08 | F9 | Clips I2V como B-roll | DIFERIDO (gated por PROD-05) |
| UX-01 | F7 | Job tray global no bloqueante (JobsContext) | ABIERTO |
| UX-02 | F7 | Mastering one-click + fuente de export visible | ABIERTO |
| UX-03 | F9 | Studio de montaje M1–M7 | DIFERIDO (tras UX-01/02; spec en internal-docs) |
| PUB-01 | F9 | Paquete publicación YouTube | DIFERIDO |
| MET-01 | F9 | Métricas de producción en /api/stats | DIFERIDO |
| DOG-01 | F9 | Episodio dogfood publicado | HUMANO-PENDIENTE (tras F1–F8) |

---

## Pasos HUMANO-PENDIENTE (instrucciones de una línea)

- **PROD-05**: `cd img_generation_module && python -m pipeline engine up` → exportar los 2 workflows (SETUP_PROVISIONING §5) → rellenar `docs/BENCHMARK.md`.
- **VOZ-06**: escuchar A/B 0.9×/1.15× + preset "Anciano sabio" antes/después y anotar veredicto aquí.
- **VOZ-09 (gate)**: A/B mismo texto con reranker activo — brazo viejo: arrancar el backend con `VOXFORGE_XTTS_TEMPERATURE=0.1 VOXFORGE_XTTS_TOP_P=0.4 VOXFORGE_XTTS_TOP_K=20 VOXFORGE_XTTS_REPETITION_PENALTY=10.0`; brazo nuevo: sin env (defaults 0.70/0.85/50/6.0); anotar veredicto aquí y fijar los números ganadores.
- **VOZ-10 (nota)**: con 3–5 muestras curadas en el perfil (receta en `internal-docs/xtts-finetune.md`), A/B anchor castellano ON vs OFF — si el anchor ya no aporta con conditioning multi-muestra, retirarlo es limpieza de F4.
- **VOZ-11**: grabar 20–60 min de voz limpia → `python tools/finetune/prepare_dataset.py <grabaciones> <dataset> --language es` (entorno propio) → entrenar según `internal-docs/xtts-finetune.md` → `VOXFORGE_XTTS_CHECKPOINT_DIR=<dir>` y A/B contra el modelo stock.
- **DOG-01**: producir y publicar un capítulo real de punta a punta al cerrar F1–F8.
