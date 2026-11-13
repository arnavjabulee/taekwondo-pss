'use strict';
const $ = (id) => document.getElementById(id),
  video = $('video');
let key = '',
  state = null,
  busy = false,
  mode = 'live',
  generation = '',
  source = null,
  buffer = null,
  loaded = new Set(),
  updating = false,
  offset = 0,
  lastEnd = 0,
  selectedFrom = 0,
  selectedTo = 0,
  collapsedSetup = false,
  pendingReplay = null;
function completeUpdate() {
  updating = false;
  if (pendingReplay !== null) {
    const seconds = pendingReplay;
    pendingReplay = null;
    replay(seconds);
  }
}
async function request(path, data) {
  const response = await fetch('/api/desktop/replay/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }
  return response;
}
function status(text) {
  $('status').textContent = text;
}
function networkAddresses() {
  return fetch('/api/desktop/bootstrap').then((r) => r.json());
}
function render() {
  if (!state) return;
  $('code').textContent = Date.now() < state.codeExpires ? state.code : 'Expired';
  $('camera').textContent = state.camera
    ? state.camera.name +
      ' · ' +
      (!state.camera.approved
        ? 'Awaiting approval'
        : state.camera.connected
          ? 'Connected'
          : 'Disconnected')
    : 'No camera paired';
  $('approve').hidden = !state.camera || state.camera.approved;
  $('remove').hidden = !state.camera;
  const url = $('address').value + '/camera#code=' + state.code;
  if ($('qr').dataset.url !== url && window.qrcode) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
    $('qr').dataset.url = url;
  }
  $('empty').hidden = state.segments.length > 0;
  if (state.camera?.approved && state.segments.length && !collapsedSetup) {
    document.querySelector('details').open = false;
    collapsedSetup = true;
  }
  if (!state.camera && collapsedSetup) {
    document.querySelector('details').open = true;
    collapsedSetup = false;
  }
  if (state.error) status(state.error);
  else if (state.recordingPath)
    $('recording-path').textContent =
      (state.recording ? 'Recording' : 'Recording saved') + ' · ' + state.recordingPath;
}
async function append(bytes) {
  await new Promise((resolve, reject) => {
    const finish = () => {
        buffer.removeEventListener('updateend', finish);
        buffer.removeEventListener('error', fail);
        resolve();
      },
      fail = () => {
        buffer.removeEventListener('updateend', finish);
        reject(new Error('Video fragment could not be decoded.'));
      };
    buffer.addEventListener('updateend', finish);
    buffer.addEventListener('error', fail, { once: true });
    buffer.appendBuffer(bytes);
  });
}
async function resetPlayer(start) {
  if (!window.MediaSource || !MediaSource.isTypeSupported('video/mp4;codecs="' + state.codec + '"'))
    throw new Error('This browser cannot decode the camera format. Use Microsoft Edge.');
  const old = video.src;
  source = new MediaSource();
  video.src = URL.createObjectURL(source);
  if (old.startsWith('blob:')) URL.revokeObjectURL(old);
  loaded = new Set();
  offset = start;
  lastEnd = 0;
  await new Promise((resolve) => source.addEventListener('sourceopen', resolve, { once: true }));
  buffer = source.addSourceBuffer('video/mp4;codecs="' + state.codec + '"');
  buffer.timestampOffset = -start;
  const init = await request('media?generation=' + generation + '&index=init');
  await append(await init.arrayBuffer());
}
async function updateVideo() {
  if (!state?.segments.length || updating) return;
  updating = true;
  try {
    if (generation !== state.generation || !buffer) {
      generation = state.generation;
      mode = 'live';
      const first = state.segments.find((s) => s.end > Math.max(state.start, state.end - 15));
      selectedFrom = first.start;
      selectedTo = state.end;
      await resetPlayer(first.start);
    }
    if (mode === 'live') {
      for (const segment of state.segments.filter((s) => s.end > offset && !loaded.has(s.index))) {
        const response = await request(
          'media?generation=' + generation + '&index=' + segment.index
        );
        await append(await response.arrayBuffer());
        loaded.add(segment.index);
        lastEnd = segment.end - offset;
      }
      if (buffer.buffered.length && video.currentTime < buffer.buffered.start(0))
        video.currentTime = buffer.buffered.start(0);
      if (lastEnd - video.currentTime > 3) video.currentTime = Math.max(0, lastEnd - 1.2);
      if (mode === 'live' && video.paused) await video.play().catch(() => {});
      if (buffer.buffered.length && video.currentTime > 60) {
        await new Promise((resolve) => {
          buffer.addEventListener('updateend', resolve, { once: true });
          buffer.remove(0, video.currentTime - 45);
        });
      }
    }
    $('timeline').max = Math.max(0.001, lastEnd);
    $('timeline').value = video.currentTime;
    $('position').textContent =
      (mode === 'live' ? 'Live · ' : 'Replay · ') +
      video.currentTime.toFixed(2) +
      ' / ' +
      lastEnd.toFixed(2) +
      ' s · ' +
      (state.end - state.start).toFixed(0) +
      ' s buffered';
  } catch (e) {
    status(e.message);
  } finally {
    completeUpdate();
  }
}
async function replay(seconds) {
  if (!state?.segments.length) return;
  if (updating) {
    mode = 'replay';
    video.pause();
    pendingReplay = seconds;
    return;
  }
  mode = 'replay';
  updating = true;
  video.pause();
  try {
    selectedTo = state.end;
    selectedFrom = Math.max(state.start, selectedTo - seconds);
    const segments = state.segments.filter((s) => s.end > selectedFrom && s.start < selectedTo);
    generation = state.generation;
    await resetPlayer(segments[0].start);
    for (const segment of segments) {
      const response = await request('media?generation=' + generation + '&index=' + segment.index);
      await append(await response.arrayBuffer());
      loaded.add(segment.index);
      lastEnd = segment.end - offset;
    }
    video.currentTime = 0;
    $('timeline').max = lastEnd;
    $('timeline').value = 0;
    status('Replay ready. Recording continues on the phone.');
  } catch (e) {
    status(e.message);
  } finally {
    completeUpdate();
  }
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    state = await (await request('state')).json();
    render();
    await updateVideo();
  } catch (e) {
    status(e.message);
  } finally {
    busy = false;
  }
}
$('address').onchange = render;
$('rotate').onclick = async () => {
  try {
    state = await (await request('rotate', {})).json();
    render();
  } catch (e) {
    status(e.message);
  }
};
$('approve').onclick = async () => {
  try {
    await request('approve', {});
    poll();
  } catch (e) {
    status(e.message);
  }
};
$('remove').onclick = async () => {
  if (confirm('Disconnect the camera and clear its buffered video?')) {
    await request('remove', {});
    video.pause();
    buffer = null;
    poll();
  }
};
for (const button of document.querySelectorAll('[data-replay]'))
  button.onclick = () => replay(Number(button.dataset.replay));
$('live').onclick = () => {
  status('Live camera · recording continues independently of replay.');
  mode = 'live';
  video.play().catch(() => {});
  poll();
};
$('play').onclick = () => {
  mode = 'replay';
  video.paused ? video.play().catch((e) => status(e.message)) : video.pause();
};
$('speed').onchange = () => {
  video.playbackRate = Number($('speed').value);
};
$('timeline').oninput = () => {
  mode = 'replay';
  video.pause();
  video.currentTime = Number($('timeline').value);
};
function frame(delta) {
  mode = 'replay';
  video.pause();
  const absolute = video.currentTime + offset;
  const times = (state?.segments || [])
    .flatMap((s) => s.frameTimes || [])
    .filter((t) => t >= offset && t < offset + lastEnd);
  const next =
    delta > 0
      ? times.find((t) => t > absolute + 0.00001)
      : times
          .slice()
          .reverse()
          .find((t) => t < absolute - 0.00001);
  if (next !== undefined) video.currentTime = next - offset;
  $('timeline').value = video.currentTime;
}
$('back').onclick = () => frame(-1);
$('forward').onclick = () => frame(1);
document.addEventListener('keydown', (event) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) || event.repeat) return;
  if (event.code === 'Space') {
    event.preventDefault();
    $('play').click();
  }
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    event.preventDefault();
    frame(event.code === 'ArrowLeft' ? -1 : 1);
  }
});
$('save').onclick = async () => {
  try {
    if (!state?.segments.length) return;
    const from =
        mode === 'replay'
          ? Math.max(state.start, selectedFrom || offset)
          : Math.max(state.start, state.end - 30),
      to = mode === 'replay' ? Math.min(state.end, selectedTo || state.end) : state.end;
    const blob = await (
      await request('clip?generation=' + generation + '&from=' + from + '&to=' + to)
    ).blob();
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = 'UoBTKD-replay.mp4';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    status(e.message);
  }
};
(async () => {
  try {
    const auth = await networkAddresses();
    if (!auth.key) throw new Error('Open the replay window on the laptop.');
    key = auth.key;
    const info = await (
      await fetch('/api/desktop/replay/addresses', { headers: { Authorization: 'Bearer ' + key } })
    ).json();
    for (const url of info.urls) {
      const option = document.createElement('option');
      option.value = option.textContent = url;
      $('address').append(option);
    }
    status('Ready · connect a camera');
    await poll();
    setInterval(poll, 500);
  } catch (e) {
    status(e.message);
  }
})();
