'use strict';
if (window.parent !== window) document.body.classList.add('embedded-replay');
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && window.parent !== window) {
    event.preventDefault();
    window.parent.postMessage('uobtkd-close-replay', 'http://127.0.0.1:11818');
  }
});
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
  pendingReplay = null,
  loopSeeking = false,
  playbackRevision = 0,
  archiveSegments = [],
  archiveGeneration = '',
  scope = 'live',
  lastPause = null,
  incidentStart = null,
  incidentEnd = null;
let previousBrowserUrl = '';
function completeUpdate() {
  updating = false;
  if (pendingReplay !== null) {
    const task = pendingReplay;
    pendingReplay = null;
    task();
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
  const browser = state.browserCamera || { phase: 'off', url: '', error: '' };
  $('enable-browser').disabled = browser.phase === 'starting' || browser.phase === 'ready';
  $('disable-browser').hidden = !['starting', 'ready'].includes(browser.phase);
  $('browser-link-status').textContent =
    browser.phase === 'starting'
      ? 'Preparing HTTPS link… First use downloads the verified Cloudflare helper. This may take a minute.'
      : browser.phase === 'ready'
        ? 'Browser camera enabled · scan the QR code in Safari. Internet required; video travels through Cloudflare.'
        : browser.error ||
          'Browser camera needs an HTTPS link. Internet required; video travels through Cloudflare.';
  if (previousBrowserUrl && previousBrowserUrl !== browser.url) {
    const option = [...$('address').options].find((item) => item.value === previousBrowserUrl);
    if (option) option.remove();
    previousBrowserUrl = '';
  }
  if (browser.phase === 'ready' && browser.url && previousBrowserUrl !== browser.url) {
    const option = document.createElement('option');
    option.value = browser.url;
    option.textContent = browser.url + ' (browser camera)';
    $('address').append(option);
    $('address').value = browser.url;
    previousBrowserUrl = browser.url;
  }
  $('code').textContent = Date.now() < state.codeExpires ? state.code : 'Expired';
  $('camera').textContent = state.camera
    ? state.camera.name +
      ' Â· ' +
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
      (state.recording ? 'Recording' : 'Recording saved') + ' Â· ' + state.recordingPath;
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
  if (generation && generation !== state.generation) {
    scope = 'live';
    mode = 'live';
    buffer = null;
    incidentStart = incidentEnd = null;
  }
  if (mode !== 'live' && scope !== 'live') {
    await updateRange();
    return;
  }
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
      (mode === 'live' ? 'Live Â· ' : 'Replay Â· ') +
      video.currentTime.toFixed(2) +
      ' / ' +
      lastEnd.toFixed(2) +
      ' s Â· ' +
      (state.end - state.start).toFixed(0) +
      ' s buffered';
  } catch (e) {
    status(e.message);
  } finally {
    completeUpdate();
  }
}
async function archiveIndex() {
  const result = await (await request('archive')).json();
  if (result.generation !== state.generation)
    throw new Error('Recording changed. Select the footage again.');
  archiveGeneration = result.generation;
  archiveSegments = result.segments;
}
function rangeUi() {
  const length = Math.max(0.001, selectedTo - selectedFrom);
  $('timeline').max = length;
  $('timeline').value = Math.max(0, Math.min(length, video.currentTime + offset - selectedFrom));
  $('position').textContent =
    scope + ' · ' + Number($('timeline').value).toFixed(2) + ' / ' + length.toFixed(2) + ' s';
}
async function loadRangeAt(absolute) {
  const segments = archiveSegments.filter(
    (s) => s.end > absolute && s.start < Math.min(selectedTo, absolute + 20)
  );
  if (!segments.length) throw new Error('No video at this point');
  await resetPlayer(segments[0].start);
  for (const segment of segments) {
    const response = await request('media?generation=' + generation + '&index=' + segment.index);
    await append(await response.arrayBuffer());
    loaded.add(segment.index);
    lastEnd = segment.end - offset;
  }
  video.currentTime = Math.max(0, absolute - offset);
}
async function selectRange(from, to, label) {
  playbackRevision++;
  if (!state?.segments.length) return;
  if (updating) {
    mode = 'replay';
    video.pause();
    pendingReplay = () => selectRange(from, to, label);
    return;
  }
  updating = true;
  mode = 'replay';
  scope = label;
  video.pause();
  try {
    await archiveIndex();
    selectedFrom = Math.max(archiveSegments[0].start, from);
    selectedTo = Math.min(archiveSegments.at(-1).end, to);
    if (selectedTo <= selectedFrom) throw new Error('Choose an end after the start');
    generation = state.generation;
    await loadRangeAt(selectedFrom);
    rangeUi();
    status('Replay ready. Recording continues on the phone.');
    if (label === 'Incident') await video.play().catch((e) => status(e.message));
  } catch (e) {
    status(e.message);
  } finally {
    completeUpdate();
  }
}
async function updateRange() {
  if (updating || !buffer) return;
  updating = true;
  try {
    const absolute = video.currentTime + offset;
    if (selectedTo - absolute > 0.03 && lastEnd + offset - absolute < 3) {
      for (const segment of archiveSegments.filter(
        (s) =>
          s.end > absolute && s.start < Math.min(selectedTo, absolute + 20) && !loaded.has(s.index)
      )) {
        const response = await request(
          'media?generation=' + generation + '&index=' + segment.index
        );
        await append(await response.arrayBuffer());
        loaded.add(segment.index);
        lastEnd = segment.end - offset;
      }
    }
    if (buffer.buffered.length && video.currentTime > 60) {
      await new Promise((resolve) => {
        buffer.addEventListener('updateend', resolve, { once: true });
        buffer.remove(0, video.currentTime - 30);
      });
    }
    rangeUi();
  } catch (e) {
    status(e.message);
  } finally {
    completeUpdate();
  }
}
async function seekRange(absolute) {
  mode = 'replay';
  video.pause();
  absolute = Math.max(selectedFrom, Math.min(selectedTo - 0.001, absolute));
  const relative = absolute - offset;
  let buffered = false;
  if (buffer)
    for (let i = 0; i < buffer.buffered.length; i++)
      if (relative >= buffer.buffered.start(i) && relative < buffer.buffered.end(i))
        buffered = true;
  if (buffered) {
    video.currentTime = relative;
    rangeUi();
    return;
  }
  if (updating) {
    pendingReplay = () => seekRange(absolute);
    return;
  }
  updating = true;
  try {
    await loadRangeAt(absolute);
    rangeUi();
  } catch (e) {
    status(e.message);
  } finally {
    completeUpdate();
  }
}
async function replay(seconds) {
  await selectRange(Math.max(state.archiveStart || 0, state.end - seconds), state.end, 'Replay');
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    state = await (await request('state')).json();
    render();
    if (
      state.pause &&
      state.pause.generation === state.generation &&
      lastPause !== state.pause.id &&
      (state.end >= state.pause.to - 0.04 || !state.recording)
    ) {
      lastPause = state.pause.id;
      incidentStart = incidentEnd = null;
      await selectRange(state.pause.from, state.pause.to, 'Pause review');
    } else await updateVideo();
  } catch (e) {
    status(e.message);
  } finally {
    busy = false;
  }
}
$('address').onchange = render;
async function browserLink(enabled) {
  $('enable-browser').disabled = true;
  $('disable-browser').disabled = true;
  try {
    await request('tunnel', { enabled });
    await poll();
  } catch (error) {
    $('browser-link-status').textContent = error.message;
  } finally {
    $('disable-browser').disabled = false;
  }
}
$('enable-browser').onclick = () => void browserLink(true);
$('disable-browser').onclick = () => void browserLink(false);
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
  status('Live camera Â· recording continues independently of replay.');
  mode = 'live';
  scope = 'live';
  buffer = null;
  video.play().catch(() => {});
  poll();
};
$('play').onclick = () => {
  playbackRevision++;
  mode = 'replay';
  video.paused ? video.play().catch((e) => status(e.message)) : video.pause();
};
$('speed').onchange = () => {
  video.playbackRate = Number($('speed').value);
};
$('timeline').oninput = () => {
  playbackRevision++;
  mode = 'replay';
  video.pause();
  if (scope === 'live') video.currentTime = Number($('timeline').value);
  else seekRange(selectedFrom + Number($('timeline').value));
};
function frame(delta) {
  playbackRevision++;
  mode = 'replay';
  video.pause();
  const absolute = video.currentTime + offset;
  const times = (state?.segments || [])
    .flatMap((s) => s.frameTimes || [])
    .filter(
      (t) =>
        t >= (scope === 'live' ? offset : selectedFrom) &&
        t < (scope === 'live' ? offset + lastEnd : selectedTo)
    );
  const next =
    delta > 0
      ? times.find((t) => t > absolute + 0.00001)
      : times
          .slice()
          .reverse()
          .find((t) => t < absolute - 0.00001);
  if (scope !== 'live') seekRange(next === undefined ? absolute + delta / 30 : next);
  else if (next !== undefined) video.currentTime = next - offset;
  if (scope === 'live') $('timeline').value = video.currentTime;
  else rangeUi();
}
$('back').onclick = () => frame(-1);
$('forward').onclick = () => frame(1);
function replayShortcut(action) {
  if (action === 'toggle') $('play').click();
  else if (action === 'back') frame(-1);
  else if (action === 'forward') frame(1);
}
document.addEventListener(
  'keydown',
  (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const action = { Space: 'toggle', ArrowLeft: 'back', ArrowRight: 'forward' }[event.code];
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) replayShortcut(action);
  },
  true
);
document.addEventListener(
  'keyup',
  (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true
);
window.addEventListener('message', (event) => {
  if (
    event.source === window.parent &&
    event.origin === 'http://127.0.0.1:11818' &&
    event.data?.type === 'uobtkd-replay-shortcut'
  )
    replayShortcut(event.data.action);
});

video.addEventListener('timeupdate', () => {
  if (scope === 'live') return;
  if (video.currentTime + offset >= selectedTo - 0.01) {
    if (scope === 'Incident' && !video.paused && !loopSeeking) {
      loopSeeking = true;
      const revision = playbackRevision;
      seekRange(selectedFrom)
        .then(() => {
          if (scope === 'Incident' && playbackRevision === revision)
            return video.play().catch((e) => status(e.message));
        })
        .finally(() => {
          loopSeeking = false;
        });
      return;
    }
    video.pause();
    video.currentTime = Math.max(0, selectedTo - offset - 0.001);
  }
  rangeUi();
});
$('pause-review').onclick = () => {
  if (state?.pause) selectRange(state.pause.from, state.pause.to, 'Pause review');
  else replay(10);
};
$('full-footage').onclick = () =>
  selectRange(state.archiveStart || 0, state.archiveEnd || state.end, 'Full footage');
window.addEventListener('message', (event) => {
  if (
    event.source !== window.parent ||
    event.origin !== 'http://127.0.0.1:11818' ||
    event.data !== 'uobtkd-default-review'
  )
    return;
  if (state?.pause) selectRange(state.pause.from, state.pause.to, 'Pause review');
  else if (state?.segments.length) replay(10);
});
$('incident-start').onclick = () => {
  incidentStart = video.currentTime + offset;
  $('incident-selection').textContent =
    'Start ' +
    incidentStart.toFixed(2) +
    ' s' +
    (incidentEnd === null ? '' : ' · End ' + incidentEnd.toFixed(2) + ' s');
};
$('incident-end').onclick = () => {
  incidentEnd = video.currentTime + offset;
  $('incident-selection').textContent =
    (incidentStart === null ? '' : 'Start ' + incidentStart.toFixed(2) + ' s · ') +
    'End ' +
    incidentEnd.toFixed(2) +
    ' s';
};
$('mark-incident').onclick = () => {
  if (incidentStart === null || incidentEnd === null || incidentEnd <= incidentStart) {
    status('Set an incident start and a later end.');
    return;
  }
  selectRange(incidentStart, incidentEnd, 'Incident');
};

$('save').onclick = async () => {
  try {
    if (!state?.segments.length) return;
    const from =
        mode === 'replay'
          ? Math.max(state.archiveStart || 0, selectedFrom)
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
    status('Ready Â· connect a camera');
    await poll();
    setInterval(poll, 500);
  } catch (e) {
    status(e.message);
  }
})();
