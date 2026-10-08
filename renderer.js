// MintMusic renderer — audio-only: local files via <audio>, YouTube via hidden IFrame (no video shown)
const player = document.getElementById('player');
const list = document.getElementById('playlist');
const resultsEl = document.getElementById('results');
const nowTitle = document.getElementById('nowTitle');
const nowSub = document.getElementById('nowSub');
const playBtn = document.getElementById('playBtn');
const disc = document.getElementById('disc');
const seek = document.getElementById('seek');
const tCur = document.getElementById('tCur');
const tDur = document.getElementById('tDur');
const vol = document.getElementById('vol');

let tracks = []; // {kind:'file'|'yt', name, url?, videoId?, channel?, thumb?}
let idx = 0;
let ytPlayer = null;
let ytReady = false;
let currentKind = 'file';
let lastResults = []; // last search results — radio fallback when queue runs out
let radioPos = 0;
let playToken = 0; // bumped on every play(); stale error-skip timers check it
let errStreak = 0; // consecutive broken tracks; stop after 3 to avoid skip-loops

const fmt = s => {
  if (!isFinite(s)) return '0:00';
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

// ---- tabs ----
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ['results', 'video', 'queue', 'playlists', 'settings'].forEach(t =>
      document.getElementById('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  };
});

// ---- queue render ----
function render() {
  list.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === idx && tracks.length) li.classList.add('playing');
    li.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${t.kind === 'yt' ? '▶ ' : ''}${escapeHtml(t.name)}</span>`;
    li.title = t.channel || t.name;
    li.querySelector('.t').onclick = () => play(i);
    const x = document.createElement('button');
    x.className = 'btn mini';
    x.textContent = '✕';
    x.title = 'Remove';
    x.onclick = e => {
      e.stopPropagation();
      tracks.splice(i, 1);
      if (idx >= tracks.length) idx = 0;
      render();
    };
    li.appendChild(x);
    list.appendChild(li);
  });
}
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setPlayingUI(isPlaying) {
  playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
  disc.classList.toggle('spinning', isPlaying);
}

function stopYT() { try { ytPlayer && ytPlayer.pauseVideo(); } catch {} }
function stopFile() { player.pause(); }

function play(i) {
  if (!tracks.length) return;
  playToken++;
  idx = (i + tracks.length) % tracks.length;
  const t = tracks[idx];
  pushHistory(t);
  notifyTrack(t);
  document.getElementById('openYT').classList.toggle('hidden', t.kind !== 'yt');
  const videoTab = document.querySelector('[data-tab="video"]');
  if (videoTab) videoTab.textContent = t.kind === 'yt' ? 'Video ●' : 'Video';
  if (t.kind === 'yt') {
    stopFile();
    currentKind = 'yt';
    nowTitle.textContent = t.name;
    nowSub.textContent = (t.channel || 'YouTube') + ' • connecting… (audio only)';
    if (ytReady && ytPlayer && ytPlayer.loadVideoById) {
      try {
        ytPlayer.loadVideoById(t.videoId);
        // Click = user gesture, so unmute + play with sound (autoplay policy)
        setTimeout(() => {
          try {
            if (ytPlayer.unMute) ytPlayer.unMute();
            ytPlayer.setVolume(Number(vol.value));
            ytPlayer.playVideo();
          } catch (e) { console.warn('YT play failed', e); }
        }, 300);
      } catch (e) {
        nowSub.textContent = 'Player error: ' + e.message;
      }
    } else {
      nowSub.textContent = 'YouTube player still loading… see Video tab for status, then click again.';
      console.warn('YT not ready yet: ytReady=', ytReady);
    }
  } else {
    stopYT();
    currentKind = 'file';
    player.src = t.url;
    player.play();
    nowTitle.textContent = t.name;
    nowSub.textContent = `Track ${idx + 1} of ${tracks.length} • audio only`;
  }
  render();
}

function toggle() {
  if (!tracks.length) return;
  const t = tracks[idx];
  if (t && t.kind === 'yt' && ytPlayer) {
    const st = ytPlayer.getPlayerState && ytPlayer.getPlayerState();
    if (st === 1) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
  } else {
    if (player.paused) player.play(); else player.pause();
  }
}

playBtn.onclick = toggle;
document.getElementById('next').onclick = () => play(idx + 1);
document.getElementById('prev').onclick = () => play(idx - 1);
document.getElementById('shuffleBtn').onclick = () => {
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  }
  play(0);
};

// file audio events
player.onplay = () => { if (currentKind !== 'file') return; errStreak = 0; setPlayingUI(true); };
player.onpause = () => currentKind === 'file' && setPlayingUI(false);
player.onended = () => handleEnded();
function handleEnded() {
  if (repeatMode === 'one') return play(idx);
  if (idx < tracks.length - 1 || repeatMode === 'all') return play(idx + 1);
  // Natural end of queue with repeat off → radio fallback: continue from search results
  radioNext();
}
// If the queue is empty/ended, keep music going from the last search results.
function radioNext() {
  const pool = lastResults.filter(r => r.videoId && !tracks.some(t => t.videoId === r.videoId));
  const cand = pool.length ? pool : lastResults.filter(r => r.videoId);
  if (!cand.length) {
    setPlayingUI(false);
    nowSub.textContent = 'Queue ended — search something to keep playing.';
    return false;
  }
  const v = cand[radioPos % cand.length]; radioPos++;
  tracks.push({ kind: 'yt', name: v.title, videoId: v.videoId, channel: v.channel });
  render();
  play(tracks.length - 1);
  return true;
}
player.ontimeupdate = () => {
  if (currentKind !== 'file') return;
  if (player.duration) seek.value = Math.floor(player.currentTime / player.duration * 1000);
  tCur.textContent = fmt(player.currentTime);
  tDur.textContent = fmt(player.duration);
};
seek.oninput = () => {
  if (currentKind === 'file' && player.duration) player.currentTime = seek.value / 1000 * player.duration;
  else if (currentKind === 'yt' && ytPlayer && ytPlayer.getDuration) {
    ytPlayer.seekTo(ytPlayer.getDuration() * seek.value / 1000, true);
  }
};
vol.oninput = () => {
  player.volume = vol.value / 100;
  localStorage.setItem('mm_vol', String(vol.value));
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(Number(vol.value));
};
player.volume = (Number(localStorage.getItem('mm_vol')) || 80) / 100;
vol.value = String(Number(localStorage.getItem('mm_vol')) || 80);

// YouTube IFrame player (visible 320x200 in the Video tab — YouTube requires
// >=200x200 visible; hidden players get throttled / error 153).
// NOTE: the API script is injected AFTER this callback is defined (docs pattern).
// Previously the <script> tag came first, so a fast/cached download could fire
// before the callback existed — player never initialised ("wait 2s" forever).
function setYtStatus(s) {
  const el = document.getElementById('ytStatus');
  if (el) el.textContent = 'Player: ' + s;
}
window.onYouTubeIframeAPIReady = () => {
  console.log('YT API ready');
  setYtStatus('loaded, creating player…');
  try {
    ytPlayer = new YT.Player('ytplayer', {
      height: '200', width: '320',
      host: 'https://www.youtube.com',
      // NOTE: no `origin` / `widget_referrer` here on purpose. This page runs
      // from file:// (origin "null"); passing a fake https origin makes the
      // player post API events to the wrong targetOrigin, so the browser drops
      // them and onReady never fires ("creating player…" forever). The error-153
      // Referer fix lives in main.js (real HTTP header), not in these params.
      playerVars: {
        autoplay: 0, controls: 1, disablekb: 0, fs: 0, rel: 0, playsinline: 1
      },
      events: {
        onReady: e => {
          ytReady = true;
          try { e.target.setVolume(Number(vol.value)); } catch {}
          console.log('YT player ready');
          setYtStatus('ready ✓');
        },
        onAutoplayBlocked: () => {
          console.warn('YT autoplay blocked — unmuting + retry');
          try { ytPlayer.unMute(); ytPlayer.playVideo(); } catch {}
        },
        onError: e => {
          console.warn('YT error', e.data);
          const code = e.data;
          let msg;
          if (code === 153) msg = 'Error 153: missing client identity. Update the app / restart — the fix ships Referer headers. If it persists, use ↗ YouTube.';
          else if (code === 101 || code === 150) msg = 'This video blocks embedding (label restriction).';
          else if (code === 100) msg = 'Video not found/private.';
          else msg = 'YouTube error ' + code + '.';
          errStreak++;
          if (errStreak >= 3) {
            errStreak = 0;
            nowSub.textContent = 'Stopped: 3 broken tracks in a row. Use ↗ YouTube or pick another.';
            setPlayingUI(false);
            document.getElementById('openYT').classList.remove('hidden');
            return;
          }
          nowSub.textContent = msg + ' Skipping…';
          setPlayingUI(false);
          document.getElementById('openYT').classList.remove('hidden');
          // Auto-skip broken tracks so the queue keeps flowing (never replays on repeat-one).
          const token = playToken;
          setTimeout(() => {
            if (token !== playToken) return; // user already moved on
            if (idx < tracks.length - 1) play(idx + 1);
            else if (repeatMode === 'all') play(0);
            else radioNext();
          }, 2500);
        },
        onStateChange: e => {
          if (currentKind !== 'yt') return;
          if (e.data === YT.PlayerState.PLAYING) {
            errStreak = 0;
            setPlayingUI(true);
            nowTitle.textContent = tracks[idx] ? tracks[idx].name : 'Playing';
            nowSub.textContent = ((tracks[idx] && tracks[idx].channel) || 'YouTube') + ' • audio only';
            tickYT();
          }
          else if (e.data === YT.PlayerState.PAUSED) setPlayingUI(false);
          else if (e.data === YT.PlayerState.ENDED) {
            if (repeatMode === 'one') play(idx);
            else handleEnded();
          }
        }
      }
    });
  } catch (e) {
    console.error('YT player create failed', e);
    setYtStatus('failed: ' + e.message);
    nowSub.textContent = 'YouTube player failed to load. Check network/adblock.';
  }
  // Watchdog: created but YouTube never answered within 12s.
  setTimeout(() => {
    if (ytReady) return;
    const dbg = document.getElementById('ytDebug');
    let frame = '';
    try {
      const f = ytPlayer && ytPlayer.getIframe && ytPlayer.getIframe();
      frame = f ? f.src.slice(0, 120) : '(no iframe)';
    } catch (e) { frame = '(iframe unreadable: ' + e.message + ')'; }
    if (dbg) dbg.textContent = 'Debug: YT lib=' + (window.YT ? 'yes' : 'no') + ' iframe=' + frame;
    setYtStatus('created but no answer from YouTube — click Retry player.');
    console.warn('YT watchdog: no onReady after 12s. iframe=', frame);
  }, 12000);
};
document.getElementById('ytRetry').onclick = () => {
  console.log('YT manual retry');
  setYtStatus('retrying…');
  try { ytPlayer && ytPlayer.destroy && ytPlayer.destroy(); } catch {}
  ytPlayer = null; ytReady = false;
  // destroy() removes the iframe; rebuild the mount div, then re-create.
  const wrap = document.getElementById('ytWrap');
  wrap.innerHTML = '<div id="ytplayer"></div>';
  window.onYouTubeIframeAPIReady();
};
// Inject the API script now that the callback exists. If it was somehow already
// present, call the callback directly instead of waiting.
(function loadYTAPI() {
  setYtStatus('loading…');
  if (window.YT && window.YT.Player) {
    console.log('YT API already present');
    window.onYouTubeIframeAPIReady();
    return;
  }
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.onerror = () => {
    console.error('YT API script failed to load');
    setYtStatus('failed to load — check network/adblock, then restart the app.');
  };
  document.head.appendChild(tag);
  // Safety net: if the callback never fires (blocked/slow network), say so.
  setTimeout(() => {
    if (!ytReady && !ytPlayer) setYtStatus('still loading… if stuck, check network/adblock and restart.');
  }, 8000);
})();
function tickYT() {
  if (currentKind !== 'yt' || !ytPlayer || !ytPlayer.getDuration) return;
  const d = ytPlayer.getDuration() || 0, c = ytPlayer.getCurrentTime() || 0;
  if (d) seek.value = Math.floor(c / d * 1000);
  tCur.textContent = fmt(c); tDur.textContent = fmt(d);
  if (ytPlayer.getPlayerState && ytPlayer.getPlayerState() === 1) setTimeout(tickYT, 500);
}

// ---- YouTube search (Data API v3) ----
const getKey = () => localStorage.getItem('mm_yt_key') || '';
document.getElementById('apiKey').value = getKey();
document.getElementById('saveKey').onclick = () => {
  localStorage.setItem('mm_yt_key', document.getElementById('apiKey').value.trim());
  alert('API key saved locally.');
};
document.getElementById('clearKey').onclick = () => {
  localStorage.removeItem('mm_yt_key'); document.getElementById('apiKey').value = '';
};

// ---- tray prefs (minimize / close to taskbar tray) ----
(async () => {
  try {
    const p = await window.mintmusic.trayPrefsGet();
    document.getElementById('trayMin').checked = !!p.minimizeToTray;
    document.getElementById('trayClose').checked = !!p.closeToTray;
  } catch {}
})();
async function pushTrayPrefs() {
  try {
    await window.mintmusic.trayPrefsSet({
      minimizeToTray: document.getElementById('trayMin').checked,
      closeToTray: document.getElementById('trayClose').checked
    });
  } catch {}
}
document.getElementById('trayMin').onchange = pushTrayPrefs;
document.getElementById('trayClose').onchange = pushTrayPrefs;

function renderResults(items) {
  lastResults = items || [];
  resultsEl.innerHTML = '';
  if (!items.length) { resultsEl.innerHTML = '<div class="hint">No results.</div>'; return; }
  items.forEach(v => {
    const id = v.videoId;
    const div = document.createElement('div');
    div.className = 'res-item';
    div.innerHTML = `${v.thumb ? `<img src="${v.thumb}">` : ''}<div class="meta"><b>${escapeHtml(v.title)}</b><span>${escapeHtml(v.channel || '')}${v.duration ? ' • ' + escapeHtml(v.duration) : ''}</span></div>`;
    const acts = document.createElement('div');
    acts.className = 'acts';
    const bPlay = document.createElement('button'); bPlay.className = 'btn primary'; bPlay.textContent = '▶';
    bPlay.title = 'Play now (audio only)';
    bPlay.onclick = e => { e.stopPropagation(); tracks.push({ kind: 'yt', name: v.title, videoId: id, channel: v.channel }); play(tracks.length - 1); };
    const bQ = document.createElement('button'); bQ.className = 'btn'; bQ.textContent = '+ Queue';
    bQ.onclick = e => { e.stopPropagation(); tracks.push({ kind: 'yt', name: v.title, videoId: id, channel: v.channel }); render(); };
    const bPl = document.createElement('button'); bPl.className = 'btn'; bPl.textContent = '+ Playlist';
    bPl.onclick = e => { e.stopPropagation(); addToPlaylistPrompt({ kind: 'yt', name: v.title, videoId: id, channel: v.channel }); };
    acts.append(bPlay, bQ, bPl);
    div.appendChild(acts);
    div.onclick = () => { tracks.push({ kind: 'yt', name: v.title, videoId: id, channel: v.channel }); play(tracks.length - 1); };
    resultsEl.appendChild(div);
  });
}

async function doSearch() {
  const q = document.getElementById('search').value.trim();
  if (!q) return;
  const key = getKey();
  resultsEl.innerHTML = '<div class="hint">Searching… (no key needed)</div>';
  // 1) Keyless via main (Innertube + Piped fallback) — default, no key required
  try {
    if (window.mintmusic && window.mintmusic.searchYouTube) {
      const items = await window.mintmusic.searchYouTube(q);
      if (items && items.length) { renderResults(items); return; }
    }
  } catch (e) {
    // fall through to Data API key if available
    if (!key) { resultsEl.innerHTML = `<div class="hint">Keyless search failed: ${escapeHtml(e.message)}</div>`; return; }
  }
  // 2) Official Data API (only if user added a key — higher reliability)
  if (!key) { resultsEl.innerHTML = '<div class="hint">Keyless search returned nothing. Add a Data API key in Settings as backup.</div>'; return; }
  try {
    const s = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=15&q=${encodeURIComponent(q)}&key=${key}`).then(r => r.json());
    if (s.error) throw new Error(s.error.message);
    const ids = s.items.map(i => i.id.videoId).join(',');
    const d = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${ids}&key=${key}`).then(r => r.json());
    const dur = {}; (d.items || []).forEach(v => dur[v.id] = v.contentDetails.duration);
    renderResults(s.items.map(v => ({ videoId: v.id.videoId, title: v.snippet.title, channel: v.snippet.channelTitle, duration: dur[v.id.videoId] || '', thumb: v.snippet.thumbnails?.medium?.url || '' })));
  } catch (err) {
    resultsEl.innerHTML = `<div class="hint">Search failed: ${escapeHtml(err.message)}</div>`;
  }
}
document.getElementById('searchBtn').onclick = doSearch;
document.getElementById('search').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

// ---- local files ----
function addFiles(fileList) {
  const added = [...fileList].filter(f => f.type.startsWith('audio') || /\.(mp3|ogg|wav|flac|m4a)$/i.test(f.name));
  const firstNew = tracks.length;
  added.forEach(f => tracks.push({ kind: 'file', name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
  render();
  if (added.length && (firstNew === 0 || !player.src)) play(firstNew);
}
const fileInput = document.getElementById('fileInput');
document.getElementById('files').onclick = () => fileInput.click();
fileInput.onchange = e => addFiles(e.target.files);
const drop = document.getElementById('drop');
drop.ondragover = e => e.preventDefault();
drop.ondrop = e => { e.preventDefault(); addFiles(e.dataTransfer.files); };
document.getElementById('pick').onclick = async () => {
  const p = await window.mintmusic.pickFolder();
  if (p) alert('Picked: ' + p + '\nDrag files from that folder in for now.');
};

// ---- playlists (localStorage) ----
const loadPls = () => JSON.parse(localStorage.getItem('mm_playlists') || '{}');
const savePls = p => localStorage.setItem('mm_playlists', JSON.stringify(p));
function renderPls() {
  const pls = loadPls();
  const box = document.getElementById('plList');
  box.innerHTML = Object.keys(pls).length ? '' : '<div class="hint">No playlists yet — create one, then use + Playlist on any track.</div>';
  Object.entries(pls).forEach(([name, items]) => {
    const d = document.createElement('div');
    d.innerHTML = `<div class="pl-head"><b>${escapeHtml(name)} (${items.length})</b></div>`;
    const head = d.firstChild;
    const bPlay = document.createElement('button'); bPlay.className = 'btn primary'; bPlay.textContent = '▶';
    bPlay.onclick = () => { items.forEach(t => tracks.push(t)); play(tracks.length - items.length); };
    const bDel = document.createElement('button'); bDel.className = 'btn'; bDel.textContent = 'Delete';
    bDel.onclick = () => { const p = loadPls(); delete p[name]; savePls(p); renderPls(); };
    head.append(bPlay, bDel);
    const sub = document.createElement('div'); sub.className = 'pl-tracks';
    sub.textContent = items.slice(0, 5).map(t => t.name).join(' • ') + (items.length > 5 ? '…' : '');
    d.appendChild(sub);
    box.appendChild(d);
  });
}
document.getElementById('plCreate').onclick = () => {
  const n = document.getElementById('plName').value.trim();
  if (!n) return;
  const p = loadPls(); p[n] = p[n] || []; savePls(p);
  document.getElementById('plName').value = '';
  renderPls();
};
function addToPlaylistPrompt(track) {
  const pls = loadPls();
  const names = Object.keys(pls);
  if (!names.length) { alert('Create a playlist first (Playlists tab).'); return; }
  const pick = prompt('Add to playlist:\n' + names.join('\n'));
  if (pick && pls[pick]) { pls[pick].push(track); savePls(pls); renderPls(); alert('Added to ' + pick); }
}

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); toggle(); }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); document.getElementById('search').focus(); }
});

// ---- sleep timer ----
let sleepTimer = null, sleepEnd = 0, sleepTick = null;
const sleepSel = document.getElementById('sleep');
const sleepLeft = document.getElementById('sleepLeft');
function clearSleep() {
  if (sleepTimer) clearTimeout(sleepTimer);
  if (sleepTick) clearInterval(sleepTick);
  sleepTimer = sleepTick = null; sleepLeft.textContent = '';
}
sleepSel.onchange = () => {
  clearSleep();
  const mins = Number(sleepSel.value);
  if (!mins) return;
  sleepEnd = Date.now() + mins * 60000;
  const pauseAll = () => { stopYT(); player.pause(); setPlayingUI(false); sleepSel.value = '0'; };
  sleepTimer = setTimeout(pauseAll, mins * 60000);
  const upd = () => {
    const ms = sleepEnd - Date.now();
    if (ms <= 0) { sleepLeft.textContent = ''; return; }
    sleepLeft.textContent = Math.floor(ms / 60000) + ':' + String(Math.floor(ms % 60000 / 1000)).padStart(2, '0');
  };
  upd();
  sleepTick = setInterval(upd, 1000);
};

// ---- lyrics via lrclib.net ----
const lyricsModal = document.getElementById('lyricsModal');
const lyricsBody = document.getElementById('lyricsBody');
const lyricsTitle = document.getElementById('lyricsTitle');
document.getElementById('lyricsBtn').onclick = async () => {
  const t = tracks[idx];
  if (!t) { alert('Nothing playing.'); return; }
  lyricsTitle.textContent = t.name;
  lyricsBody.textContent = 'Loading…';
  lyricsModal.classList.remove('hidden');
  try {
    // heuristic: "Artist - Title" split, else whole as track
    let artist = t.channel || '', title = t.name;
    const m = t.name.split(' - ');
    if (m.length >= 2) { artist = m[0].trim(); title = m.slice(1).join(' - ').trim(); }
    const url = `https://lrclib.net/api/get?${artist ? 'artist_name=' + encodeURIComponent(artist) + '&' : ''}track_name=${encodeURIComponent(title)}`;
    const r = await fetch(url).then(r => r.json());
    lyricsBody.textContent = r.plainLyrics || r.syncedLyrics?.replace(/\[\d+:\d+\.\d+\]/g, '') || 'No lyrics found for this track.';
  } catch (e) {
    lyricsBody.textContent = 'Lyrics fetch failed: ' + e.message;
  }
};
document.getElementById('lyricsClose').onclick = () => lyricsModal.classList.add('hidden');
lyricsModal.onclick = e => { if (e.target === lyricsModal) lyricsModal.classList.add('hidden'); };

document.getElementById('openYT').onclick = () => {
  const t = tracks[idx];
  if (t && t.videoId && window.mintmusic && window.mintmusic.openUrl) {
    window.mintmusic.openUrl('https://www.youtube.com/watch?v=' + t.videoId);
  }
};

// ---- media keys from main ----
if (window.mintmusic && window.mintmusic.onMediaKey) {
  window.mintmusic.onMediaKey(action => {
    if (action === 'toggle') toggle();
    else if (action === 'next') play(idx + 1);
    else if (action === 'prev') play(idx - 1);
    else if (action === 'pause') { stopYT(); player.pause(); }
  });
}

// ---- repeat / history / notifications / import / export ----
let repeatMode = localStorage.getItem('mm_repeat') || 'off';
const repeatBtn = document.getElementById('repeatBtn');
function paintRepeat() { repeatBtn.textContent = 'Repeat: ' + repeatMode; }
repeatBtn.onclick = () => {
  repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
  localStorage.setItem('mm_repeat', repeatMode);
  paintRepeat();
};
paintRepeat();

function pushHistory(t) {
  try {
    const h = JSON.parse(localStorage.getItem('mm_history') || '[]');
    h.unshift({ name: t.name, channel: t.channel || '', videoId: t.videoId || null, kind: t.kind, at: Date.now() });
    localStorage.setItem('mm_history', JSON.stringify(h.slice(0, 200)));
    renderHistory();
  } catch {}
}
function renderHistory() {
  const box = document.getElementById('history');
  if (!box) return;
  const h = JSON.parse(localStorage.getItem('mm_history') || '[]');
  box.innerHTML = h.length ? '' : '<div class="hint">Nothing played yet.</div>';
  h.slice(0, 30).forEach(item => {
    const d = document.createElement('div');
    d.className = 'pl-tracks';
    d.textContent = `• ${item.name}`;
    box.appendChild(d);
  });
}
function notifyTrack(t) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(t.name, { body: t.channel || 'MintMusic' });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  } catch {}
}

document.getElementById('qClear').onclick = () => {
  stopYT(); player.pause();
  tracks = []; idx = 0;
  nowTitle.textContent = 'Nothing playing';
  render(); setPlayingUI(false);
};
document.getElementById('qExport').onclick = () => {
  const lines = ['#EXTM3U'];
  tracks.forEach(t => {
    lines.push(`#EXTINF:-1,${t.name}`);
    lines.push(t.kind === 'yt' ? `https://www.youtube.com/watch?v=${t.videoId}` : t.name);
  });
  const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mintmusic.m3u';
  a.click();
};
document.getElementById('ytPlImport').onclick = async () => {
  const url = document.getElementById('ytPlUrl').value.trim();
  const key = getKey();
  const m = url.match(/[?&]list=([^&]+)/);
  if (!m) { alert('Paste a full YouTube playlist URL (with ?list=…).'); return; }
  resultsEl.innerHTML = '<div class="hint">Importing playlist… (no key needed)</div>';
  // 1) Keyless via main (Innertube browse + continuations)
  try {
    if (window.mintmusic && window.mintmusic.importPlaylist) {
      const items = await window.mintmusic.importPlaylist(m[1]);
      if (items && items.length) {
        items.forEach(v => tracks.push({ kind: 'yt', name: v.title, videoId: v.videoId, channel: v.channel }));
        render();
        resultsEl.innerHTML = `<div class="hint">Imported ${items.length} tracks to queue. ▶ to play.</div>`;
        play(tracks.length - items.length);
        return;
      }
    }
  } catch (e) {
    console.warn('keyless playlist import failed', e);
    if (!key) { resultsEl.innerHTML = `<div class="hint">Import failed: ${escapeHtml(e.message)}</div>`; return; }
  }
  // 2) Official Data API fallback (needs key)
  if (!key) { resultsEl.innerHTML = '<div class="hint">Keyless import returned nothing. Add a Data API key in Settings as backup.</div>'; return; }
  try {
    let page = '', added = 0;
    for (let p = 0; p < 5; p++) {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${m[1]}&key=${key}${page ? '&pageToken=' + page : ''}`).then(r => r.json());
      if (r.error) throw new Error(r.error.message);
      (r.items || []).forEach(it => {
        tracks.push({ kind: 'yt', name: it.snippet.title, videoId: it.snippet.resourceId.videoId, channel: it.snippet.videoOwnerChannelTitle || it.snippet.channelTitle });
        added++;
      });
      page = r.nextPageToken || '';
      if (!page) break;
    }
    render();
    alert(`Imported ${added} tracks to queue.`);
  } catch (e) { alert('Import failed: ' + e.message); }
};

// arrow-key seek
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight') {
    if (currentKind === 'file' && player.duration) player.currentTime = Math.min(player.duration, player.currentTime + 10);
    else if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo((ytPlayer.getCurrentTime() || 0) + 10, true);
  }
  if (e.key === 'ArrowLeft') {
    if (currentKind === 'file') player.currentTime = Math.max(0, player.currentTime - 10);
    else if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(Math.max(0, (ytPlayer.getCurrentTime() || 0) - 10), true);
  }
});

// ---- random mix: selected genre + 2 related -> keyless search -> shuffled queue ----
const MIX_GENRES = ['britpop', 'uk garage', 'grime', 'drum and bass', 'uk hip hop',
  'northern soul', 'madchester', 'shoegaze', 'uk folk', 'dubstep', 'jungle',
  '2-tone ska', 'trip hop', 'post-punk', 'uk indie', 'afroswing', 'uk drill', 'brit funk'];
document.getElementById('randomMix').onclick = async () => {
  if (!window.mintmusic || !window.mintmusic.searchYouTube) { alert('Player not ready yet.'); return; }
  const chosen = document.getElementById('genre').value || MIX_GENRES[0];
  const others = MIX_GENRES.filter(g => g !== chosen).sort(() => Math.random() - 0.5).slice(0, 2);
  const picks = [chosen, ...others];
  resultsEl.innerHTML = `<div class="hint">🎲 Rolling a mix from: ${escapeHtml(picks.join(' • '))}…</div>`;
  try {
    const all = [];
    for (const g of picks) {
      const items = await window.mintmusic.searchYouTube(g + ' music');
      (items || []).slice(0, 5).forEach(v => all.push({ kind: 'yt', name: v.title, videoId: v.videoId, channel: v.channel }));
    }
    if (!all.length) { resultsEl.innerHTML = '<div class="hint">Random mix came up empty — try again.</div>'; return; }
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    const at = tracks.length;
    all.forEach(t => tracks.push(t));
    render();
    resultsEl.innerHTML = `<div class="hint">🎲 Random mix: ${all.length} tracks from ${escapeHtml(picks.join(', '))} — playing now.</div>`;
    play(at);
  } catch (e) {
    resultsEl.innerHTML = `<div class="hint">Random mix failed: ${escapeHtml(e.message)}</div>`;
  }
};

// ---- random playlist of the selected genre: find playlists -> import one ----
document.getElementById('randomPlaylist').onclick = async () => {
  if (!window.mintmusic || !window.mintmusic.searchPlaylists) { alert('Player not ready yet.'); return; }
  const genre = document.getElementById('genre').value;
  resultsEl.innerHTML = `<div class="hint">🎲 Hunting ${escapeHtml(genre)} playlists…</div>`;
  try {
    const pls = await window.mintmusic.searchPlaylists(genre + ' playlist');
    if (!pls || !pls.length) { resultsEl.innerHTML = `<div class="hint">No ${escapeHtml(genre)} playlists found — try another genre.</div>`; return; }
    const pick = pls[Math.floor(Math.random() * pls.length)];
    resultsEl.innerHTML = `<div class="hint">🎲 Importing “${escapeHtml(pick.title)}” (${escapeHtml(pick.channel || '')}${pick.count ? ' • ' + escapeHtml(String(pick.count)) : ''})…</div>`;
    const items = await window.mintmusic.importPlaylist(pick.playlistId);
    if (!items || !items.length) { resultsEl.innerHTML = '<div class="hint">That playlist came up empty — hit 🎲 again.</div>'; return; }
    const at = tracks.length;
    items.forEach(v => tracks.push({ kind: 'yt', name: v.title, videoId: v.videoId, channel: v.channel }));
    render();
    resultsEl.innerHTML = `<div class="hint">🎲 Imported ${items.length} tracks from “${escapeHtml(pick.title)}” — playing now.</div>`;
    play(at);
  } catch (e) {
    resultsEl.innerHTML = `<div class="hint">Random playlist failed: ${escapeHtml(e.message)}</div>`;
  }
};

render();
renderPls();
renderHistory();
