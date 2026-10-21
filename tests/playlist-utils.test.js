const test = require('node:test');
const assert = require('node:assert/strict');
const { toM3u } = require('../lib/playlist-utils');

test('exports playable local paths and YouTube watch URLs', () => {
  assert.equal(toM3u([
    { kind: 'file', name: 'Local song', path: '/music/local song.flac' },
    { kind: 'yt', name: 'Online song', videoId: 'abcdefghijk' }
  ]), [
    '#EXTM3U',
    '#EXTINF:-1,Local song',
    '/music/local song.flac',
    '#EXTINF:-1,Online song',
    'https://www.youtube.com/watch?v=abcdefghijk',
    ''
  ].join('\n'));
});

test('omits invalid items and prevents track names adding M3U directives', () => {
  assert.equal(toM3u([
    { kind: 'file', name: 'Bad path', path: 'relative.mp3' },
    { kind: 'file', name: 'Bad filename', path: '/music/song\n#EXT-X-evil.mp3' },
    { kind: 'yt', name: 'Bad id', videoId: 'not valid' },
    { kind: 'yt', name: 'Safe\n#EXT-X-evil', videoId: 'abcdefghijk' }
  ]), [
    '#EXTM3U',
    '#EXTINF:-1,Safe #EXT-X-evil',
    'https://www.youtube.com/watch?v=abcdefghijk',
    ''
  ].join('\n'));
});
