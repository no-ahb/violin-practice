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

- [ ] **Long-press drone toggle → scale-degree picker.** Pop a slider so you can shift drone to any scale degree mid-session. If changed away from the day's intended degree, log to that day's session notes ("drone changed from 5 to b3 at 04:32").
- [ ] **Per-step note prompts in scales.** After each substep (subdominant arp, dom7 arp, etc.) a quick "anything to note?" before moving on. Current flow auto-advances and there's no time to drop a thought. Keep it skippable.
- [ ] **Chord-scale block redesign.**
  - Show roman numerals + the assigned scale name underneath each chord
  - Show loop structure: 1 listen-loop, then N improvise-loops (currently just runs free)
  - Bars-per-chord control already exists; clarify it's pacing-of-changes, not loop count
  - Pulsing chord or pad sustained, instead of one-shot decay
  - Metronome audible during the block (currently absent)
  - Voice leading: revoice chord on each repetition rather than always root-position
- [ ] **Manual record toggle for system improv.** Currently auto-starts recording on session begin. User wants a manual record/stop button so they can choose when to capture.
- [ ] **Bowing — notes per bow.** "How many notes per bow? quarter / eighth / half / whole for the bpm?" Currently bowing is named ("sustained", "detaché", "slurred 4", "slurred 8") but the rhythmic implementation isn't pinned. Decide a sequence per bowing × tempo, render to user.

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
