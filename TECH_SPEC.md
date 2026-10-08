# MintMusic — Tech Spec
Desktop YouTube music player for **Linux Mint 22.x Cinnamon**. Electron + YouTube IFrame Player + YouTube Data API v3. Distributed as `.deb`.

## 1. Goal
Native-feeling desktop app (not a browser tab) to search YouTube for music, play it, manage playlists/queue/favorites/history, with Mint integration (menu entry, media keys, MPRIS). v0.1 already scaffolded as minimal local-file Electron player — this spec pivots it to YouTube-first.

Non-goals v1: downloads / MP3 ripping, offline cache, Spotify/YouTube Music Premium APIs, mobile.

## 2. Chosen stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron ^33** (Node 24) | You picked desktop + Electron. No Rust needed. YouTube embed works reliably inside Chromium. |
| UI | Vanilla HTML/CSS/JS v1 (no framework) | Keeps current scaffold, zero build step, easy to package. Migrate to Vite+React only if UI outgrows it. |
| Search | **YouTube Data API v3 `search.list`** (user-supplied API key) + fallback `yt-search` scrape | Official API = stable, ranked, thumbnails, duration via `videos.list`. Key is free (10k units/day ≈ ~100 searches). Fallback keeps app working without key. |
| Playback | **YouTube IFrame Player API** (hidden/visible `<iframe>`) | Only ToS-safe reliable path. Direct stream extraction (`yt-dlp`/`ytdl-core`) breaks weekly + violates ToS for downloads. IFrame handles ads, age-gate, VEVO. |
| Audio-only mode | IFrame with 0x0 video + audio out via PulseAudio/PipeWire | Saves CPU vs 1080p video. Optional "video mode" toggle shows player. |
| State | JSON in `~/.config/mintmusic/` (`playlists.json`, `favorites.json`, `history.json`, `settings.json`, `api-key`) | Human-editable, no DB, matches Mint Radio pattern. |
| Packaging | **electron-builder** → `.deb` (`dist/*.deb`) + `.desktop` launcher | Builds `linux/deb`, installs to `/opt/MintMusic`, Mint menu entry, auto-updates optional later. |
| Mint integration | `playerctl`/MPRIS via Electron `mediaService` + global shortcuts + `mintmusic.desktop` | Play/pause from keyboard, shows in sound applet. |

Memory budget: Electron ~180–300 MB playing (Chromium cost). Accepted — tradeoff vs Python+mpv (~55 MB) for YouTube reliability + nice UI. Documented so user knows.

## 3. Architecture
```
[ Renderer: search UI / queue / playlists ]
      | IPC (play, queue, settings)
[ Main: BrowserWindow + hidden player window + globalShortcuts + config ]
      |
[ YouTube IFrame API ] --audio--> [ PipeWire/Pulse ]
      |
[ YouTube Data API v3 ] (search, details, playlist import)
```
- One visible window (library/player). One hidden `BrowserWindow` hosting IFrame player to survive navigation.
- Preload bridge (`contextBridge`) only: `search(q)`, `play(videoId)`, `queue.*`, `playlists.*` — no full node in renderer.
- Main owns API key storage (safeStorage / keytar later, plain file v1).

## 4. Features

### v1 Must-have
- Search box (debounced 400ms): title, channel, duration, thumbnails. `/` focuses, `Enter` plays top.
- Playback: play/pause, next/prev, seek bar, volume + mute, autoplay next in queue. `Space` toggle, `←/→` seek 10s.
- Queue: now-playing + up-next, drag-reorder, remove, clear, shuffle, repeat (off/all/one).
- Playlists: create/rename/delete, add track/queue-to-playlist, import YouTube playlist URL, export `.m3u`/JSON.
- Library extras: ★ favorites, history (last 200), most-played, persistent volume + last track.
- Views: Search / Queue / Playlists / History / Settings (API key field, audio-only toggle, quality).
- Error states: age-restricted/embed-disabled → show "Open in browser" button + auto-skip option.

### v1.1 Nice-to-have
- Lyrics via `lrclib.net` (synced if available).
- Sleep timer (5/15/30/60/90 — same as Mint Radio).
- Mini-player / tray: minimize-to-tray, close-to-tray toggle.
- MPRIS `playerctl` metadata (title/artist/thumb).
- Keyboard media keys (XF86AudioPlay etc.) via `globalShortcut`.
- Theme: Mint-Y dark/light follow system.

### Explicitly out (ToS/legal)
- No download-to-MP3, no background stripping of ads, no bypass of age/region locks. "Record" button from Mint Radio is **not** carried over.

## 5. YouTube API details
- Enable in Google Cloud Console → YouTube Data API v3 → API key (no OAuth needed for search/play).
- Endpoints: `search.list(part=snippet, type=video, videoCategoryId=10, maxResults=25)`, then `videos.list(part=contentDetails,statistics)` for durations.
- Quota: search = 100 units, so 10k/day ≈ 100 searches. Cache results 1h + debounce to stay free.
- No key? Fallback to `youtube-search-api` scrape lib (mark as "limited, may break").
- Playback embed: `https://www.youtube.com/embed/<id>?autoplay=1&enablejsapi=1` via IFrame API `YT.Player` events (`onStateChange` → next on ENDED).

## 6. Packaging (.deb)
```bash
npm i -D electron-builder
# package.json: "build": { "appId": "uk.co.stubblue.mintmusic", "linux": { "target": ["deb"], "category": "AudioVideo" } }
npm run dist   # → dist/mintmusic_0.1.0_amd64.deb
sudo dpkg -i dist/*.deb
```
Installs `/opt/MintMusic/mintmusic` + `/usr/share/applications/mintmusic.desktop` + icon. Uninstall: `sudo apt remove mintmusic`.

## 7. Files (target)
| File | Purpose |
|---|---|
| `main.js` | windows, IPC, shortcuts, tray |
| `preload.js` | safe bridge |
| `index.html` / `renderer.js` / `styles.css` | search, queue, playlists UI |
| `lib/youtube.js` | Data API + cache + fallback |
| `lib/store.js` | JSON config read/write |
| `lib/player.js` | IFrame wrapper (hidden window) |
| `packaging/mintmusic.desktop` | Mint menu entry |
| `assets/icon.svg/png` | icon |
| `TECH_SPEC.md` | this file |

Config: `~/.config/mintmusic/`.

## 8. Build steps
1. `npm i -D electron-builder` + add `build` config + `dist` script.
2. Add `lib/youtube.js` + settings UI for API key.
3. Replace `<audio>` with IFrame player wrapper, keep local-file fallback for v0 compat.
4. Implement queue + playlists + history stores.
5. `npm run dist`, test `dpkg -i`, test on clean Mint VM (menu entry, media keys, uninstall).
6. Delete + recreate GitHub repo, push, add Release workflow to attach `.deb`.

## 9. Risks
- YouTube embed restrictions (some labels block embeds) → handle + "open in browser".
- API quota exhaustion → cache + clear error telling user to add own key.
- Electron size (~90 MB .deb, ~250 MB RAM) — accepted, note in README vs Mint Radio's 55 MB.
- `yt-dlp` temptation — do NOT add; breaks ToS + maintenance hell.

---
*Pivot from local-file v0.1 scaffold to YouTube-first per your picks: search + playlists + .deb.*
