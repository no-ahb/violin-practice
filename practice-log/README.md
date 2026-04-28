# practice-log/

Snapshots of practice data exported from the PWA. Committed so Claude can read what was actually practiced and the notes attached to each session.

## Files

- `practice-log.json` — full snapshot of IndexedDB state (settings, sessions, chunks, patches, recording metadata, action log). Recording audio blobs are **not** included — too large for git, and listening back is best done in-app from the device that recorded.

## Workflow

### Desktop (Chromium — Chrome, Edge, Arc, Brave)

1. Tap **Export JSON** in app Settings.
2. First time only: directory picker prompts you to grant access — pick this repo's root folder. Permission persists.
3. App writes `practice-log/practice-log.json` directly. No download dance.
4. `git add practice-log/practice-log.json && git commit -m "session log"`

### iOS Safari / Firefox / non-supporting browsers

File System Access API isn't available, so:

1. Tap **Export JSON** in Settings → file downloads as `practice-log.json`.
2. Move it to this folder (overwriting the existing one).
3. Commit.

On iPhone: the Files app can save into a folder synced via iCloud Drive, or AirDrop the file to your Mac.

## Schema

```jsonc
{
  "exportedAt": "2026-04-28T18:23:11.412Z",
  "settings": { /* SETTINGS object — tonic rotation state, tempo history per key, drone/metro prefs, piece configs, etc. */ },
  "sessions": [
    {
      "id": "sess_1745870400000",
      "date": "2026-04-28",
      "dow": 2,
      "week": 1,
      "tonic": "G",
      "minor": true,
      "blocks": { "scales": {}, "adagio": {}, "fuga": {}, "improv": {} },
      "notes": [
        { "block": "transition", "text": "...", "time": 1745870400000 },
        { "block": "improv", "text": "...", "tag": "worked", "atSec": 47.2, "time": 1745870400000 }
      ],
      "tempo": 72,
      "feeling": 4,
      "complete": true,
      "activeMs": 2734000
    }
  ],
  "chunks":     [ /* per-piece chunk notes (Adagio, Fuga) */ ],
  "patches":    [ /* improv patch versions */ ],
  "recordings": [ /* metadata only — annotations, durations, key, block — no audio blobs */ ],
  "logs":       [ /* action log: tempo bumps, drone toggles, sub-block completes, etc. */ ]
}
```

## Privacy

This is all local data about your own practice. There's no auth, no remote, no telemetry. The export writes to your filesystem; the import reads from it. Don't push the repo public if you're shy about your practice notes.
