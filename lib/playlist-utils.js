const path = require('path');

function toM3u(tracks) {
  const lines = ['#EXTM3U'];

  for (const track of Array.isArray(tracks) ? tracks : []) {
    const name = String(track && track.name || 'Unknown').replace(/[\r\n]/g, ' ').trim();
    let uri = '';

    if (track && track.kind === 'yt' && /^[A-Za-z0-9_-]{6,20}$/.test(String(track.videoId || ''))) {
      uri = `https://www.youtube.com/watch?v=${track.videoId}`;
    } else if (track && track.kind === 'file' && !/[\r\n]/.test(String(track.path || '')) && path.isAbsolute(String(track.path || ''))) {
      uri = track.path;
    }

    if (!uri) continue;
    lines.push(`#EXTINF:-1,${name}`, uri);
  }

  return `${lines.join('\n')}\n`;
}

module.exports = { toM3u };
