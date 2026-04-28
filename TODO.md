# TODO

Practice-driven feedback. Each session adds items here. Triaged into ship-now / next / design-needed / answers-only.

---

## Session 1 — 2026-04-28

### Ship now (this batch)

- [x] **Can't click through to see notes from previous sessions.** History rows are inert. Tap → detail screen with date, blocks, notes, recordings.
- [x] **Metronome duplicates when already on and you hit Start.** `startMetronome` doesn't guard re-entry — second call spawns a second tick loop running on top of the first. Guard at top.
- [x] **"60 bpm" on metronome button is redundant** with the BPM display next to it. Drop the value from the toggle.
- [x] **Export-to-git is too manual.** Wire up File System Access API so one tap writes `practice-log.json` directly to the repo's `practice-log/` folder (Chromium desktop). iOS Safari falls back to download.
- [x] **Logs aren't in the export.** Action log (`kv:logs`) is only available via the separate "Download logs" button. Bundle into the main export.

### Ship next pass (bugs that need careful work)

- [x] **Drone fade glitch on toggle off.** `fadeDrone` was lowering `droneGain` to silence then *immediately* restoring it while oscillators were still ringing through their own ramping bus — drone audibly popped back at full volume before going silent. Unified the fade path on the per-drone `root.gain` only; `droneGain` is no longer touched during fades. `fadeDrone` is now just `stopDrone(ms)`.
- [x] Add countdown to performance (May 17) and days practiced logs. On home screen.
- [x] **Recording playback stop bug.** Each `listenBackUI` call was creating a fresh `Audio` element with no reference to previous playbacks — Done only hid the drawer, leaving prior recordings playing in the background. Added a `CURRENT_PLAYBACK` global, hard-stop on entry, on Done, and on any screen transition.
- [x] **No back button if you accidentally hit Next during scales.** Add a back button per step in the scales sub-blocks.
- [x] **Chord-scale: current chord disappears when it's being played.** Highlighting code is wrong — the active chord should stay visible, not toggle off.
- [x] **Adagio drone + metronome don't work, and the UI doesn't match the scales screen.** Adagio (and Fuga) now use `buildAudioPanel` in compact mode — drone + metro toggles side-by-side, tempo control below, no inline volume sliders (those still live in the drawer). Local `droneOn`/`metroOn` state replaced with `SETTINGS.drone_on`/`metro_on` synced to actual audio engine state on entry. Notes section tightened to single-line items, no "Recent notes" header, to fit phone height.
- [x] **Modal block: drone doesn't retune to the mode tonic.** Now retunes on screen render (not just on Start tap), so what's heard matches "Drone · C" the moment the modal screen appears. `startDrone` handles the crossfade from the previous tonic.
- [x] **Add session timer in UI corner.** Small `activeTimeNow()` readout in a corner of every screen, updates per second.

### Ship later (features that need design)

- [x] **Long-press drone toggle → scale-degree picker.** 500ms hold on the drone toggle opens a 12-degree picker (♭2, 2, ♭3, 3, 4, ♭5, 5, ♭6, 6, ♭7, 7) labeled relative to today's tonic (passed in as `tonicPc` from each screen). Tap a degree → drone retunes, written to `SESSION.notes` with timestamp and to the action log. Tap-to-toggle still works — long-press flag prevents the click handler from also firing.
- [x] **Per-step note prompts in scales.** New `+ Note` chip in band-bottom on scales technical and modal screens. Quick text + worked / didn't / neutral tag, saved to `SESSION.notes` with `block`, `stepIdx`, and `stepTitle` context so the session-detail view can group them. Skippable — Cancel is a no-op.
- [x] **Chord-scale block redesign.**
  - [x] Roman numerals + scale name shown under each chord (now-playing card and progression chart). Modal vamps include parent mode label, e.g. `i7 · dorian`.
  - [x] Loop counter visible. Loop 1 reads "Listen — don't play. Hear where the changes fall." Loops 2+ flip to "Improvise — clean scale switches across the bar lines."
  - [x] Bars-per-chord re-labeled "Bars per chord — chord-change pacing" so it's clearly distinct from loop count.
  - [x] Pulsed comping for functional progressions (chord re-attacks every bar with sustained envelope), pad-sustained for modal vamps. Replaced the old decay-heavy envelope.
  - [x] Audible metronome at loopTempo while the chord-scale block runs. Tempo +/- retunes the metronome live.
  - [x] Voice-led chord placement — pitch classes for the next chord are placed at the octave that minimizes movement from the previous voicing (greedy match). Common tones stay put.
- [x] **Manual record toggle for system improv.** Auto-recording removed. Band-bottom now has a Record button alongside Note and Done. Toggles between Record / Stop with toast feedback. The wrap-up still works without a recording (the existing `if (rec)` guards already handled that case).
- [x] **Bowing — notes per bow.** Default subdivision suggestion now renders under the bowing line on scales technical: `long bow · half notes · 1 per stroke` (Mon), `♩ quarter notes · 1 per bow` (Tue), `♫ eighth notes · 4 per bow` (Wed), `♬ sixteenth notes · 8 per bow` (Thu), `your choice — note what you played` (Fri). Suggestions are at practice tempo (60–80 bpm); player can deviate and capture via the new `+ Note` button.

### Answers-only (questions, not code changes)

- [ ] **Why F# drone over G minor on Tuesday?** The intent: harmonic minor's signature pitch is the *raised 7* — F# in G harmonic minor (B♭ stays the third, F natural is raised to F#). Tuesday's scale form is harmonic minor. Drone the leading tone and you hear the 7→1 pull at every cadence — this is the most useful intonation reference for harmonic minor specifically. The drone is the leading tone, not the modal third.
- [ ] **C minor modal block over F# drone — sheeesh???** Real bug: the drone should retune to C when you enter modal work (C dorian = same-key displacement on Tuesday). See "Modal block: drone doesn't retune" above. The clash you heard is *not* an intentional intonation choice — it's the technical-block drone leaking through.

### Positive — keep / reinforce

- ✓ Modal improvisation step (free improv at the end of modal sub-block) — "love this!!!"
- ✓ Extended functional progressions — "very cool and fun"

### Inferred from session-1 patterns (not user-stated, but worth flagging)

*(none yet — fill in after reading session log when available)*

---

## How this list works

- Items move from **ship now** → done as they're built and shipped
- **Ship next** is the queue I work through between sessions if I have spare bandwidth
- **Ship later** waits on user direction — typically these need a design conversation before code
- **Answers-only** are questions that get answered inline in the response; once answered, they're either deleted or converted into a task
- New session feedback gets a new dated section above this fold, never edited in place
