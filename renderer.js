const player = document.getElementById('player');
const list = document.getElementById('playlist');
const nowTitle = document.getElementById('nowTitle');
const nowSub = document.getElementById('nowSub');
const playBtn = document.getElementById('playBtn');
const disc = document.getElementById('disc');
const seek = document.getElementById('seek');
const tCur = document.getElementById('tCur');
const tDur = document.getElementById('tDur');
const vol = document.getElementById('vol');

let tracks = [];
let idx = 0;

const fmt = s => {
  if (!isFinite(s)) return '0:00';
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function render() {
  list.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === idx && tracks.length) li.classList.add('playing');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1).padStart(2, '0');
    li.appendChild(n);
    li.appendChild(document.createTextNode(t.name));
    li.onclick = () => play(i);
    list.appendChild(li);
  });
}

function setPlayingUI(isPlaying) {
  playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
  disc.classList.toggle('spinning', isPlaying);
}

function play(i) {
  if (!tracks.length) return;
  idx = (i + tracks.length) % tracks.length;
  player.src = tracks[idx].url;
  player.play();
  nowTitle.textContent = tracks[idx].name;
  nowSub.textContent = `Track ${idx + 1} of ${tracks.length} • audio only`;
  render();
}

function toggle() {
  if (!tracks.length) return;
  if (player.paused) player.play();
  else player.pause();
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

player.onplay = () => setPlayingUI(true);
player.onpause = () => setPlayingUI(false);
player.onended = () => play(idx + 1);
player.ontimeupdate = () => {
  if (player.duration) seek.value = Math.floor(player.currentTime / player.duration * 1000);
  tCur.textContent = fmt(player.currentTime);
  tDur.textContent = fmt(player.duration);
};
player.onloadedmetadata = () => { tDur.textContent = fmt(player.duration); };
seek.oninput = () => {
  if (player.duration) player.currentTime = seek.value / 1000 * player.duration;
};
vol.oninput = () => { player.volume = vol.value / 100; };
player.volume = 0.8;

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); toggle(); }
  if (e.key === '/') { e.preventDefault(); document.getElementById('search').focus(); }
});

function addFiles(fileList) {
  const added = [...fileList].filter(f => f.type.startsWith('audio') || /\.(mp3|ogg|wav|flac|m4a)$/i.test(f.name));
  const firstNew = tracks.length;
  added.forEach(f => tracks.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
  render();
  if (added.length && (firstNew === 0 || !player.src)) play(firstNew);
}

const fileInput = document.getElementById('fileInput');
document.getElementById('files').onclick = () => fileInput.click();
fileInput.onchange = e => addFiles(e.target.files);

const drop = document.getElementById('drop');
drop.ondragover = e => { e.preventDefault(); };
drop.ondrop = e => { e.preventDefault(); addFiles(e.dataTransfer.files); };

document.getElementById('pick').onclick = async () => {
  const p = await window.mintmusic.pickFolder();
  if (p) alert('Picked: ' + p + '\nDrag files from that folder in for now.');
};

document.getElementById('search').addEventListener('keydown', e => {
  if (e.key === 'Enter') alert('YouTube search lands here next (per TECH_SPEC). For now use local files.');
});

render();
