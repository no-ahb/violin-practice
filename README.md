# Violin Practice

A self-contained PWA built to the spec. No build step, no dependencies to install — just static files you can host anywhere.

## Files

- `index.html` — app shell
- `app.js` — all logic (audio, IndexedDB, screens, session flow)
- `styles.css` — Swiss/Rams flat UI
- `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png` — PWA plumbing
- `spec.md` — source of truth for the design

## Getting it on your iPhone (easiest path)

iOS Safari needs HTTPS for PWA install + microphone + service worker. Pick one:

### Option A — Netlify Drop (fastest, no account)
1. Go to <https://app.netlify.com/drop>
2. Drag this whole folder onto the page.
3. You'll get an HTTPS URL like `https://gleaming-xyz.netlify.app`.
4. On your iPhone, open that URL in Safari → Share → **Add to Home Screen**.

### Option B — Cloudflare Pages
1. `npx wrangler pages deploy .` (after `npm i -g wrangler` + `wrangler login`)
2. Follow Safari → Share → Add to Home Screen on the given URL.

### Option C — GitHub Pages
1. `git init && git add . && git commit -m init`
2. Push to a public GitHub repo.
3. Repo → Settings → Pages → deploy from `main` / root.
4. Load the `https://<user>.github.io/<repo>/` URL on your phone and add to Home Screen.

### Option D — local dev on same Wi-Fi (no PWA install, but works for testing)
```
cd /path/to/this/folder
python3 -m http.server 8080
```
Then on your phone (same Wi-Fi): `http://<your-mac-ip>:8080`. Microphone/recording may be blocked over plain HTTP; everything else works.

## First run

On first launch you get a short onboarding (start date, reference pitch, drone/metronome sounds, pieces 1 & 2, optional patch). Defaults are sane — you can skip straight through.

## How it works (quick map to spec)

- **Scales block** — technical sub-block runs VexFlow notation per step (scale 3oct, broken thirds, tonic arp, dominant 7, alternating subdominant/diminished). Drone pitch rotates per day; bowing labeled per day; scale form per day (melodic↑/natural↓, harmonic Tue, melodic Thu, major on major weeks).
- **Modal sub-block** — same-tonic/same-key daily rotation, characteristic-degree display, scaffold cell on/off after 2 cycles, tonic↔characteristic chord, free improv.
- **Chord-scale sub-block** — day-of-week progression (ii-V-i, extended, modal vamps). Web Audio chord synth (triangle for functional, sine pad for modal). Bars-per-chord 8/4/2/1 selector persists per progression.
- **Adagio / Fuga** — chunk tracking with 1-bar mastery overlap, drone/metronome default off, last-3 notes on this chunk shown on pre-start screen, "show all" for history. End-of-block: record-a-take prompt, required notes, mastered-or-not.
- **Improv** — system/acoustic split by day (Mon-Wed, Fri = system; Thu = acoustic; Sun alternates). Auto-records 15 min (30 on Sunday). Feeling + focus sliders, required note, listen-back now-or-later (next-day gate enforced via Home banner).
- **Session close** — streak (weeks with 5+ sessions), feeling slider, tomorrow preview.
- **Light day** — halves each block's duration; session still counts, flagged.
- **Recordings library** — list, play, star, download, delete, timestamped-note waveform.
- **Export / import** — JSON dump of everything. Recordings export as individual files from the library.
- **Offline** — service worker caches all assets including VexFlow. Works offline after first load.
- **Wake lock** — screen stays awake during session on supported browsers.

## Audio

Everything is synthesized in-browser — no samples to download. The tanpura drone is an additive-partial loop rendered once per tonic via OfflineAudioContext with pluck-style amplitude modulation. You get four preset timbres: tanpura / shruti / pad / sine. Just-intonation ratios baked into the partials.

Metronome and chord playback are scheduled via Web Audio lookahead; no `setInterval` drift.

## Reset / wipe

Settings → Wipe all data. Or delete the home-screen icon and clear Safari site data.

## Known constraints

- VexFlow is loaded from CDN (~200 KB). After first online load the service worker caches it — you're offline-ready after that. If the CDN is unreachable on very first load, note renderings fall back to plain note-name text and everything else still works.
- iOS Safari background audio: iOS suspends Web Audio when you leave the app. Keep the tab frontmost during a session.
- MediaRecorder format is mp4/aac on Safari, webm/opus on Chrome. Exported file extensions adjust accordingly.
