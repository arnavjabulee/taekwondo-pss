/* Phones send live votes only; inputs are never queued while disconnected. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const invitation = new URLSearchParams(location.hash.slice(1));
  const invitationCode = invitation.get('code');
  const invitationMatch = invitation.get('match');
  if (/^\d{6}$/.test(invitationCode || '')) {
    $('match-code').value = invitationCode;
    if (invitationMatch && sessionStorage.getItem('uobtkd_judge_session') !== invitationMatch)
      sessionStorage.removeItem('uobtkd_judge_token');
  }
  let token = sessionStorage.getItem('uobtkd_judge_token') || '',
    state = null,
    connected = false;
  let socket = null,
    reconnect = null,
    received = 0,
    sequence = 0;
  const calls = new Map();
  function closeLive() {
    clearTimeout(reconnect);
    reconnect = null;
    const old = socket;
    socket = null;
    if (old) old.close();
    for (const reject of calls.values()) reject(new Error('Connection lost. Punch not queued.'));
    calls.clear();
    connected = false;
  }
  function liveRequest(path, data) {
    return new Promise((resolve, reject) => {
      if (!socket || socket.readyState !== WebSocket.OPEN)
        return reject(new Error('Disconnected. Punch not queued.'));
      const id = 'phone-' + ++sequence;
      const timeout = setTimeout(() => {
        if (calls.has(id)) calls.get(id)(new Error('Input confirmation timed out.'));
        if (socket) socket.close();
      }, 1500);
      calls.set(id, (error, value) => {
        clearTimeout(timeout);
        calls.delete(id);
        if (error) reject(error);
        else resolve(value);
      });
      socket.send(JSON.stringify({ type: 'request', id, path, data }));
    });
  }
  function openLive() {
    if (!token || socket || document.hidden) return;
    const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/live/judge');
    socket = ws;
    received = Date.now();
    ws.onopen = () => {
      if (socket === ws) ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      received = Date.now();
      const message = JSON.parse(event.data);
      if (message.type === 'state') {
        state = message.data;
        connected = true;
        render();
      }
      if (message.type === 'response' && calls.has(message.id))
        calls.get(message.id)(
          message.status === 200
            ? null
            : Object.assign(new Error(message.data.error), { status: message.status }),
          message.data
        );
    };
    ws.onerror = () => ws.close();
    ws.onclose = (event) => {
      if (socket !== ws) return;
      closeLive();
      if (event.code === 1008) {
        unpair('Pair with the current match again.');
        return;
      }
      render();
      message('Connection lost. Reconnecting. No punches will be queued.');
      reconnect = setTimeout(openLive, 500);
    };
  }
  let feedbackAt = 0;
  const phases = {
    ready: 'Waiting for the match',
    running: 'Match running',
    paused: 'Match paused',
    break: 'Break',
    'break-paused': 'Break paused',
    decision: 'Referee decision',
    finished: 'Match complete',
    offline: 'Desktop disconnected'
  };
  function message(text) {
    $('feedback').textContent = text;
  }
  function render() {
    $('pairing').hidden = !!token;
    $('controller').hidden = !token;
    $('connection').textContent = !token
      ? 'Not paired'
      : !connected
        ? 'Disconnected'
        : state && state.approved
          ? 'Connected'
          : 'Awaiting approval';
    if (!state || !token) {
      $('blue').disabled = $('red').disabled = true;
      return;
    }
    $('seat').textContent = 'Judge ' + state.seat;
    $('title').textContent = state.title || 'Competition';
    $('phase').textContent = !state.approved
      ? 'Waiting for desktop approval'
      : phases[state.phase] || 'Waiting';
    $('round').textContent = 'Round ' + state.round;
    $('blue-name').textContent = state.blue;
    $('red-name').textContent = state.red;
    $('policy').textContent =
      state.count === 1
        ? 'Every press awards one punch point.'
        : state.count === 2
          ? 'Either judge scores. Same-side inputs within 3 seconds count once.'
          : 'Two different judges must agree within 3 seconds.';
    $('blue').disabled = $('red').disabled = !(
      connected &&
      state.desktopOnline &&
      state.approved &&
      state.phase === 'running'
    );
    if (state.feedback && state.feedback.at >= feedbackAt) {
      feedbackAt = state.feedback.at;
      message(state.feedback.message);
    }
  }
  async function request(url, options = {}) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 1500);
    try {
      const response = await fetch(url, {
        ...options,
        signal: abort.signal,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(options.headers || {})
        }
      });
      const data = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(data.error || 'Connection failed.'), {
          status: response.status
        });
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
  function unpair(text) {
    closeLive();
    token = '';
    state = null;
    connected = false;
    sessionStorage.removeItem('uobtkd_judge_token');
    render();
    message(text);
  }
  $('pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('pair-button').disabled = true;
    try {
      const data = await request('/api/pair', {
        method: 'POST',
        body: JSON.stringify({ code: $('match-code').value.trim(), name: $('judge-name').value })
      });
      token = data.token;
      sessionStorage.setItem('uobtkd_judge_token', token);
      sessionStorage.setItem('uobtkd_judge_session', data.state.sessionId);
      state = data.state;
      connected = false;
      feedbackAt = 0;
      render();
      message('Paired. Wait for the desktop operator to approve you.');
      openLive();
    } catch (error) {
      message(error.message);
    } finally {
      $('pair-button').disabled = false;
    }
  });
  async function punch(side) {
    if (
      !connected ||
      !state ||
      !state.approved ||
      !state.desktopOnline ||
      state.phase !== 'running'
    )
      return;
    const current = state;
    const input = {
      id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2),
      sessionId: current.sessionId,
      round: current.round,
      revision: current.revision,
      policyRevision: current.policyRevision,
      side
    };
    message('Sending punch…');
    try {
      const data = await liveRequest('/api/judge/punch', input);
      if (state && state.sessionId === current.sessionId) {
        state = data.state;
        render();
        if (navigator.vibrate) navigator.vibrate(25);
      }
    } catch (error) {
      if (error.status === 401) unpair('Pair with the current match again.');
      else {
        if (!error.status) connected = false;
        render();
        message(error.message);
      }
    }
  }
  for (const [id, side] of [
    ['blue', 'left'],
    ['red', 'right']
  ]) {
    $(id).addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      if (!$(id).disabled) punch(side);
    });
    $(id).addEventListener('keydown', (event) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
        event.preventDefault();
        punch(side);
      }
    });
    $(id).addEventListener('contextmenu', (event) => event.preventDefault());
  }
  $('leave').addEventListener('click', async () => {
    try {
      await request('/api/judge/leave', { method: 'POST', body: '{}' });
    } catch {}
    unpair('Disconnected.');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      closeLive();
      render();
    } else openLive();
  });
  setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      if (Date.now() - received > 2500) {
        connected = false;
        render();
        socket.close();
      } else socket.send(JSON.stringify({ type: 'heartbeat' }));
    } else if (!socket) openLive();
  }, 1000);
  render();
  openLive();
})();
