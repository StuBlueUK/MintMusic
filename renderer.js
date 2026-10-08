const player = document.getElementById('player');
const list = document.getElementById('playlist');
const now = document.getElementById('now');
let tracks = [];
let idx = 0;

function render() {
  list.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.textContent = t.name;
    if (i === idx) li.classList.add('playing');
    li.onclick = () => play(i);
    list.appendChild(li);
  });
}

function play(i) {
  if (!tracks.length) return;
  idx = (i + tracks.length) % tracks.length;
  player.src = tracks[idx].url;
  player.play();
  now.textContent = '▶ ' + tracks[idx].name;
  render();
}

document.getElementById('next').onclick = () => play(idx + 1);
document.getElementById('prev').onclick = () => play(idx - 1);
player.onended = () => play(idx + 1);

function addFiles(fileList) {
  [...fileList].filter(f => f.type.startsWith('audio') || /\.(mp3|ogg|wav|flac|m4a)$/i.test(f.name))
    .forEach(f => tracks.push({ name: f.name, url: URL.createObjectURL(f) }));
  render();
  if (tracks.length === 1 || !player.src) play(0);
}

const fileInput = document.getElementById('fileInput');
document.getElementById('files').onclick = () => fileInput.click();
fileInput.onchange = e => addFiles(e.target.files);

const drop = document.getElementById('drop');
drop.ondragover = e => { e.preventDefault(); };
drop.ondrop = e => { e.preventDefault(); addFiles(e.dataTransfer.files); };

document.getElementById('pick').onclick = async () => {
  // Folder pick via native dialog returns a path, but in renderer we can't
  // list files without node fs — for v0 use drag&drop / file picker above.
  const p = await window.mintmusic.pickFolder();
  if (p) alert('Picked: ' + p + '\nFor v0.1, drag files from that folder into here.');
};
