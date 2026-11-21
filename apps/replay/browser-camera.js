'use strict';
const cameraUI = (id) => document.getElementById(id);
cameraUI('camera-code').value = new URLSearchParams(location.hash.slice(1)).get('code') || '';
let token = '',
  approved = false,
  stream = null,
  recorder = null,
  generation = '',
  active = false,
  stopping = false,
  processing = Promise.resolve(),
  upload = Promise.resolve(),
  failure = null,
  queuedBytes = 0,
  pendingBlobs = 0,
  index = 0,
  capturedAt = 0,
  wakeLock = null,
  finished = null,
  complete = null,
  sawFragment = false,
  recordingNumber = 0;
let lastApproval = null,
  stateChecking = false;
try {
  token = sessionStorage.getItem('uobtkd-camera-token') || '';
} catch (_) {}
function cameraStatus(message) {
  cameraUI('browser-status').textContent = message;
}
function controls() {
  cameraUI('pair-browser').disabled = active || stopping || !!token || !window.isSecureContext;
  cameraUI('camera-code').disabled = active || stopping || !!token;
  cameraUI('camera-name').disabled = active || stopping || !!token;
  cameraUI('start-browser').disabled = !approved || active || stopping || !window.isSecureContext;
  cameraUI('stop-browser').disabled = !active || stopping;
}
async function api(path, fields, body) {
  const response = await fetch('/api/camera/' + path, {
    method: fields === undefined && body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': body ? 'video/mp4' : 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    ...(body ? { body } : fields === undefined ? {} : { body: JSON.stringify(fields) }),
    signal: AbortSignal.timeout(12000)
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'The camera request failed.');
    error.status = response.status;
    throw error;
  }
  return result;
}
function saveToken(value) {
  token = value;
  try {
    if (value) sessionStorage.setItem('uobtkd-camera-token', value);
    else sessionStorage.removeItem('uobtkd-camera-token');
  } catch (_) {}
}
function releaseCamera() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  cameraUI('preview').srcObject = null;
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
function fail(error) {
  if (!failure) failure = error;
  if (active && !stopping) void stopRecording();
}
async function checkState() {
  if (!token || stateChecking) return;
  stateChecking = true;
  const checkedGeneration = generation;
  try {
    const state = await api('state');
    approved = state.approved;
    if (
      active &&
      checkedGeneration &&
      checkedGeneration === generation &&
      (!approved || state.generation !== generation)
    )
      fail(new Error('The desktop camera session changed. Pair again.'));
    if (!active && !stopping && lastApproval !== approved)
      cameraStatus(
        approved ? 'Approved. Ready to record.' : 'Waiting for approval in desktop replay.'
      );
    lastApproval = approved;
  } catch (error) {
    if (active) fail(error);
    if (error.status === 401) {
      saveToken('');
      approved = false;
    }
    if (!active && !stopping) cameraStatus(error.message);
  }
  stateChecking = false;
  controls();
}
cameraUI('pair-browser').onclick = async () => {
  cameraUI('pair-browser').disabled = true;
  try {
    const value = cameraUI('camera-code').value.trim();
    if (!/^\d{6}$/.test(value))
      throw new Error('Enter the six-digit camera code from desktop replay.');
    const result = await api('pair', {
      code: value,
      name: cameraUI('camera-name').value.trim() || 'Browser camera'
    });
    saveToken(result.token);
    await checkState();
  } catch (error) {
    cameraStatus(error.message);
  }
  controls();
};
async function startRecording() {
  if (active || stopping || !approved) return;
  active = true;
  failure = null;
  stopping = false;
  generation = '';
  controls();
  cameraStatus('Opening camera…');
  let started = false;
  const currentRecording = ++recordingNumber;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        'Use the HTTPS browser-camera QR code from the desktop. Camera access is unavailable over ordinary HTTP.'
      );
    if (!window.MediaRecorder)
      throw new Error('This browser cannot record video. Use current Safari on iPhone.');
    const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'].find(
      (type) => MediaRecorder.isTypeSupported(type)
    );
    if (!mimeType)
      throw new Error('This browser cannot record H.264 MP4. Use Safari 18.4 or newer.');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    if (document.hidden || stopping) throw new Error('Keep the camera page open to record.');
    cameraUI('preview').srcObject = stream;
    await cameraUI('preview').play();
    const sentAt = Date.now(),
      result = await api('start', {}),
      receivedAt = Date.now();
    generation = result.generation;
    started = true;
    capturedAt = receivedAt + result.serverTime - (sentAt + receivedAt) / 2;
    if (document.hidden || stopping) throw new Error('Keep the camera page open to record.');
    index = 0;
    queuedBytes = 0;
    pendingBlobs = 0;
    sawFragment = false;
    processing = Promise.resolve();
    upload = Promise.resolve();
    const parser = new CameraMP4((bytes) => {
      if (failure) return;
      if (queuedBytes + bytes.length > 8 * 1024 * 1024)
        throw new Error('The internet connection cannot keep up. Recording stopped.');
      const current = index++;
      if (current > 0) sawFragment = true;
      queuedBytes += bytes.length;
      upload = upload
        .then(async () => {
          if (!failure)
            await api(
              'chunk?generation=' +
                generation +
                '&index=' +
                current +
                '&captureStartMs=' +
                Math.round(capturedAt),
              undefined,
              bytes
            );
        })
        .catch(fail)
        .finally(() => {
          queuedBytes -= bytes.length;
        });
    });
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 3_000_000,
      videoKeyFrameIntervalDuration: 1000
    });
    finished = new Promise((resolve) => {
      complete = resolve;
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size || failure) return;
      if (++pendingBlobs > 4 || event.data.size > 8 * 1024 * 1024) {
        --pendingBlobs;
        fail(new Error('Camera data is arriving too quickly. Recording stopped.'));
        return;
      }
      processing = processing
        .then(async () => {
          if (!failure) parser.push(new Uint8Array(await event.data.arrayBuffer()));
        })
        .catch(fail)
        .finally(() => {
          --pendingBlobs;
        });
    };
    recorder.onerror = (event) =>
      fail(new Error(event.error?.message || 'Camera recording failed.'));
    recorder.onstop = () => {
      void (async () => {
        stopping = true;
        releaseCamera();
        controls();
        await processing;
        if (!failure) {
          try {
            parser.finish();
            if (!sawFragment) throw new Error('No video frames were captured.');
          } catch (error) {
            failure = error;
          }
        }
        await upload;
        try {
          await api('stop?generation=' + generation, {});
        } catch (error) {
          failure ||= error;
        }
        releaseCamera();
        active = false;
        stopping = false;
        recorder = null;
        cameraStatus(failure ? failure.message : 'Recording saved on the desktop.');
        controls();
        complete?.();
      })();
    };
    stream.getVideoTracks()[0].onended = () => {
      if (active && !stopping) void stopRecording();
    };
    recorder.start(1000);
    if (navigator.wakeLock) {
      void navigator.wakeLock
        .request('screen')
        .then((lock) => {
          if (active && !stopping && recordingNumber === currentRecording) wakeLock = lock;
          else void lock.release();
        })
        .catch(() => {});
    }
    cameraStatus('Recording · keep this page visible and the phone unlocked');
    controls();
    setTimeout(() => {
      if (recordingNumber === currentRecording && active && !stopping && !sawFragment)
        fail(new Error('No streamable video received. Use Safari/iOS 18.4 or newer.'));
    }, 10000);
  } catch (error) {
    if (started) await api('stop?generation=' + generation, {}).catch(() => {});
    releaseCamera();
    active = false;
    stopping = false;
    recorder = null;
    cameraStatus(error.message);
    controls();
  }
}
async function stopRecording() {
  if (!active || stopping) return finished;
  stopping = true;
  controls();
  cameraStatus('Finishing recording…');
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
    return finished;
  }
}
cameraUI('start-browser').onclick = () => void startRecording();
cameraUI('stop-browser').onclick = () => void stopRecording();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && active) void stopRecording();
});
window.addEventListener('pagehide', () => {
  if (recorder?.state === 'recording') recorder.stop();
  releaseCamera();
});
if (!window.isSecureContext)
  cameraStatus(
    'For browser recording, enable the HTTPS browser-camera link on the desktop and scan its QR code. Native Android pairing still works here.'
  );
else
  cameraStatus(
    'Pair this camera, approve it on the desktop, then start recording. Safari 18.4 or newer is required on iPhone.'
  );
setInterval(checkState, 1500);
if (token) void checkState();
controls();
