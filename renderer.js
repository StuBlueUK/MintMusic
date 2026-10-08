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
    ['results', 'queue', 'playlists', 'settings'].forEach(t =>
      document.getElementById('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  };
});

// ---- queue render ----
function render() {
  list.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === idx && tracks.length) li.classList.add('playing');
    li.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span>${t.kind === 'yt' ? '▶ ' : ''}${escapeHtml(t.name)}</span>`;
    li.title = t.channel || t.name;
    li.onclick = () => play(i);
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
  idx = (i + tracks.length) % tracks.length;
  const t = tracks[idx];
  if (t.kind === 'yt') {
    stopFile();
    currentKind = 'yt';
    nowTitle.textContent = t.name;
    nowSub.textContent = (t.channel || 'YouTube') + ' • audio only';
    if (ytReady && ytPlayer && ytPlayer.loadVideoById) ytPlayer.loadVideoById(t.videoId);
    else alert('YouTube player still loading — try again in a second.');
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
player.onplay = () => currentKind === 'file' && setPlayingUI(true);
player.onpause = () => currentKind === 'file' && setPlayingUI(false);
player.onended = () => play(idx + 1);
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
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(Number(vol.value));
};
player.volume = 0.8;

// hidden YT IFrame (audio only — 2px, invisible)
window.onYouTubeIframeAPIReady = () => {
  ytPlayer = new YT.Player('ytplayer', {
    height: '2', width: '2',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0 },
    events: {
      onReady: () => { ytReady = true; ytPlayer.setVolume(Number(vol.value)); },
      onStateChange: e => {
        if (currentKind !== 'yt') return;
        if (e.data === YT.PlayerState.PLAYING) {
          setPlayingUI(true);
          nowTitle.textContent = tracks[idx] ? tracks[idx].name : 'Playing';
          tickYT();
        }
        else if (e.data === YT.PlayerState.PAUSED) setPlayingUI(false);
        else if (e.data === YT.PlayerState.ENDED) play(idx + 1);
      }
    }
  });
};
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

async function doSearch() {
  const q = document.getElementById('search').value.trim();
  if (!q) return;
  const key = getKey();
  if (!key) {
    resultsEl.innerHTML = '<div class="hint">Add your YouTube Data API key in Settings first (free).</div>';
    document.querySelector('[data-tab="settings"]').click();
    return;
  }
  resultsEl.innerHTML = '<div class="hint">Searching…</div>';
  try {
    const s = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=15&q=${encodeURIComponent(q)}&key=${key}`).then(r => r.json());
    if (s.error) throw new Error(s.error.message);
    const ids = s.items.map(i => i.id.videoId).join(',');
    const d = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${ids}&key=${key}`).then(r => r.json());
    const dur = {}; (d.items || []).forEach(v => dur[v.id] = v.contentDetails.duration);
    resultsEl.innerHTML = '';
    s.items.forEach(v => {
      const id = v.id.videoId;
      const div = document.createElement('div');
      div.className = 'res-item';
      div.innerHTML = `<img src="${v.snippet.thumbnails.medium.url}"><div class="meta"><b>${escapeHtml(v.snippet.title)}</b><span>${escapeHtml(v.snippet.channelTitle)} • ${dur[id] || ''}</span></div>`;
      const acts = document.createElement('div');
      acts.className = 'acts';
      const bPlay = document.createElement('button'); bPlay.className = 'btn primary'; bPlay.textContent = '▶';
      bPlay.title = 'Play now (audio only)';
      bPlay.onclick = e => { e.stopPropagation(); tracks.push({ kind: 'yt', name: v.snippet.title, videoId: id, channel: v.snippet.channelTitle }); play(tracks.length - 1); };
      const bQ = document.createElement('button'); bQ.className = 'btn'; bQ.textContent = '+ Queue';
      bQ.onclick = e => { e.stopPropagation(); tracks.push({ kind: 'yt', name: v.snippet.title, videoId: id, channel: v.snippet.channelTitle }); render(); };
      const bPl = document.createElement('button'); bPl.className = 'btn'; bPl.textContent = '+ Playlist';
      bPl.onclick = e => { e.stopPropagation(); addToPlaylistPrompt({ kind: 'yt', name: v.snippet.title, videoId: id, channel: v.snippet.channelTitle }); };
      acts.append(bPlay, bQ, bPl);
      div.appendChild(acts);
      div.onclick = () => { tracks.push({ kind: 'yt', name: v.snippet.title, videoId: id, channel: v.snippet.channelTitle }); play(tracks.length - 1); };
      resultsEl.appendChild(div);
    });
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
  if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); toggle(); }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); document.getElementById('search').focus(); }
});

render();
renderPls();
