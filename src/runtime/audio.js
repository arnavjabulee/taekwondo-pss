/* Unbranded, locally synthesised cues. No media downloads or vendor recordings. */
(function (root) {
  'use strict';
  var config =
    typeof module !== 'undefined' && module.exports
      ? require('../audio.json')
      : root.PSS_AUDIO_CONFIG;
  var STORAGE_KEY = 'bristol_audio_v1';

  function hitRate(kind, key) {
    var id = Math.max(1, Math.floor(Number(key) || 1));
    return Math.pow(2, kind === 'court' ? ((id - 1) % 16) / 32 : ((id - 1) % 256) / 256);
  }

  function hitPattern(kind, key) {
    var id = Math.max(1, Math.floor(Number(key) || 1));
    var step = (id - 1) % 24;
    var group = Math.floor((id - 1) / 24);
    var base = (kind === 'court' ? 330 : 440) * Math.pow(2, step / 12);
    // Pitch and interval identify each court/person. Later groups add a third note.
    var notes = [
      [base, 0.065],
      [base * (1.2 + (group % 8) * 0.05), 0.085]
    ];
    if (group)
      notes.push([base * (0.7 + (group % 17) * 0.025), 0.05 + Math.floor(group / 17) * 0.005]);
    return notes;
  }

  function wavData(notes, encode) {
    var rate = 16000,
      gap = 0.025;
    var length = Math.ceil(
      notes.reduce(function (sum, note) {
        return sum + note[1] + gap;
      }, 0) * rate
    );
    var bytes = new Uint8Array(44 + length * 2),
      data = new DataView(bytes.buffer);
    function text(offset, value) {
      for (var i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
    }
    text(0, 'RIFF');
    data.setUint32(4, bytes.length - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, 1, true);
    data.setUint32(24, rate, true);
    data.setUint32(28, rate * 2, true);
    data.setUint16(32, 2, true);
    data.setUint16(34, 16, true);
    text(36, 'data');
    data.setUint32(40, length * 2, true);
    var position = 0;
    notes.forEach(function (note) {
      var count = Math.floor(note[1] * rate);
      for (var i = 0; i < count; i++) {
        var envelope = Math.min(1, i / (rate * 0.005)) * Math.pow(1 - i / count, 1.6);
        var sample = Math.sin((2 * Math.PI * note[0] * i) / rate) * envelope * 0.35;
        data.setInt16(44 + (position + i) * 2, Math.round(sample * 32767), true);
      }
      position += count + Math.floor(gap * rate);
    });
    var binary = '';
    for (var index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    return 'data:audio/wav;base64,' + encode(binary);
  }

  function createAudio(host) {
    var state = { enabled: true, volume: config.defaultVolume };
    var listeners = [];
    var context = null,
      master = null,
      controls = null,
      media = [],
      voices = [],
      warningShown = false;
    try {
      var saved = JSON.parse(host.localStorage && host.localStorage.getItem(STORAGE_KEY));
      if (saved) {
        state.enabled = saved.enabled !== false;
        if (isFinite(saved.volume)) state.volume = Math.max(0, Math.min(1, Number(saved.volume)));
      }
    } catch (error) {
      /* Defaults remain usable if storage is unavailable. */
    }

    function persist() {
      try {
        if (host.localStorage) host.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        /* Audio still works without saved preferences. */
      }
    }
    function unavailable() {
      if (!warningShown && host.LEDA_UI) {
        host.LEDA_UI.notify(
          'Audio could not start. Click Test sound and check the Windows volume mixer.'
        );
        warningShown = true;
      }
    }
    function unlock() {
      if (!state.enabled) return;
      try {
        var AudioContext = host.AudioContext || host.webkitAudioContext;
        if (!context && AudioContext) {
          context = new AudioContext();
          master = context.createGain();
          master.gain.value = state.volume * 0.45;
          var limiter = context.createDynamicsCompressor();
          master.connect(limiter);
          limiter.connect(context.destination);
        }
        if (context && context.state === 'suspended' && context.resume) {
          var result = context.resume();
          if (result && result.catch) result.catch(unavailable);
        }
      } catch (error) {
        context = null;
      }
    }
    function play(notes, priority) {
      if (!state.enabled || !state.volume || !notes) return false;
      unlock();
      try {
        if (context) {
          if (context.state === 'suspended') {
            unavailable();
            return false;
          }
          var now = context.currentTime;
          voices = voices.filter(function (until) {
            return until > now;
          });
          if (voices.length >= 16 && !priority) return false; // No delayed queue of stale impacts.
          var cursor = now;
          notes.forEach(function (note) {
            var oscillator = context.createOscillator(),
              gain = context.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(note[0], cursor);
            gain.gain.setValueAtTime(0.0001, cursor);
            gain.gain.exponentialRampToValueAtTime(0.55, cursor + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, cursor + note[1]);
            oscillator.connect(gain);
            gain.connect(master);
            oscillator.onended = function () {
              oscillator.disconnect();
              gain.disconnect();
            };
            oscillator.start(cursor);
            oscillator.stop(cursor + note[1] + 0.005);
            cursor += note[1] + 0.025;
          });
          voices.push(cursor);
          return true;
        }
        if (host.Audio && host.btoa) {
          var player = new host.Audio(wavData(notes, host.btoa.bind(host)));
          player.volume = state.volume;
          media = media.filter(function (item) {
            return !item.ended && !item.paused;
          });
          if (media.length >= 16) media.shift().pause();
          media.push(player);
          var pending = player.play();
          if (pending && pending.catch) pending.catch(unavailable);
          return true;
        }
      } catch (error) {
        unavailable();
        return false;
      }
      unavailable();
      return false;
    }
    function signal(cue) {
      listeners.forEach(function (listener) {
        try {
          listener(cue);
        } catch (error) {
          /* Observers cannot interrupt scoring. */
        }
      });
    }
    function nativePlay(name) {
      if (typeof host.HostPlaySound !== 'function') return null;
      if (!state.enabled || !state.volume) return false;
      try {
        var volume = Math.max(1, Math.min(10, Math.round(state.volume * 10)));
        host.HostPlaySound('pss_' + name + '_v' + volume + '.wav');
        return true;
      } catch (error) {
        return null;
      }
    }
    function event(name) {
      var played = config.events[name] ? nativePlay(name) : false;
      if (played === null) played = play(config.events[name], true);
      signal({ type: 'event', name: name, played: played });
      return played;
    }
    function hit(kind, key) {
      var id = Math.max(1, Math.floor(Number(key) || 1));
      // The native host takes filenames, so the build supplies a reusable cue bank.
      var nativeId = kind === 'court' ? ((id - 1) % 16) + 1 : ((id - 1) % 256) + 1;
      var played = nativePlay(kind + '_' + nativeId);
      if (played === null) {
        played = false;
        if (state.enabled && state.volume && host.Audio) {
          try {
            var player = new host.Audio('hit.mp3');
            player.volume = state.volume;
            player.playbackRate = hitRate(kind, key);
            player.preservesPitch = false;
            player.webkitPreservesPitch = false;
            media = media.filter(function (item) {
              return !item.ended && !item.paused;
            });
            if (media.length >= 16) media.shift().pause();
            media.push(player);
            var pending = player.play();
            if (pending && pending.catch) pending.catch(unavailable);
            played = true;
          } catch (error) {
            unavailable();
          }
        }
      }
      signal({ type: 'hit', kind: kind, key: key, played: played });
      return played;
    }
    function setEnabled(value) {
      state.enabled = !!value;
      if (master) master.gain.value = state.enabled ? state.volume * 0.45 : 0;
      if (!state.enabled)
        media.forEach(function (player) {
          player.pause();
        });
      persist();
      refresh();
      if (state.enabled) unlock();
    }
    function setVolume(value) {
      state.volume = Math.max(0, Math.min(1, Number(value) || 0));
      if (master) master.gain.value = state.enabled ? state.volume * 0.45 : 0;
      media.forEach(function (player) {
        player.volume = state.volume;
      });
      persist();
      refresh();
    }
    function refresh() {
      if (!controls) return;
      controls.querySelector('button').textContent = state.enabled ? 'Sounds on' : 'Sounds off';
      controls.querySelector('button').setAttribute('aria-pressed', String(state.enabled));
      controls.querySelector('input').value = Math.round(state.volume * 100);
    }
    function mount() {
      if (controls || !host.document || !host.document.body) return;
      var document = host.document;
      controls = document.createElement('div');
      controls.className = 'pss-audio-controls';
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.onclick = function () {
        setEnabled(!state.enabled);
      };
      controls.appendChild(toggle);
      var label = document.createElement('label');
      label.textContent = 'Volume ';
      var volume = document.createElement('input');
      volume.type = 'range';
      volume.min = 0;
      volume.max = 100;
      volume.setAttribute('aria-label', 'Sound volume');
      volume.oninput = function () {
        setVolume(volume.value / 100);
      };
      label.appendChild(volume);
      controls.appendChild(label);
      var test = document.createElement('button');
      test.type = 'button';
      test.textContent = 'Test sound';
      test.onclick = function () {
        event('roundStart');
      };
      controls.appendChild(test);
      document.body.appendChild(controls);
      refresh();
    }
    function attachCourt(controller) {
      if (controller._pssAudioAttached) return;
      controller._pssAudioAttached = true;
      var roundLive = controller.gvi.game_state === 2 || controller.gvi.game_state === 3;
      function endRound() {
        if (roundLive) {
          event('roundEnd');
          roundLive = false;
        }
      }
      function wrap(name, after) {
        var original = controller[name];
        if (typeof original !== 'function') return;
        controller[name] = function () {
          var before = controller.gvi.game_state,
            rest = controller.gvi.rest_time;
          var result = original.apply(controller, arguments);
          after(before, rest);
          return result;
        };
      }
      wrap('gameControl', function (before) {
        var after = controller.gvi.game_state;
        if (after === 2 && before !== 2) {
          roundLive = true;
          event(before === 3 || before === 4 ? 'resume' : 'roundStart');
        } else if (after === 3 && (before === 2 || before === 5)) event('pause');
      });
      wrap('gameSetup', function (before) {
        if (before === 2 && controller.gvi.game_state === 3) event('pause');
      });
      wrap('auto_rest', endRound);
      wrap('SetGameOver', endRound);
      wrap('wait_next_round', endRound);
      wrap('WaitRoundOver', function (before) {
        if (before === 5) event('breakEnd');
      });
    }
    function legacy(name) {
      if (name === 'start.wav') return event('roundStart');
      if (name === 'stop.wav') return event('roundEnd');
      return false;
    }
    if (host.document) {
      host.document.addEventListener('mousedown', unlock, true);
      host.document.addEventListener('keydown', unlock, true);
      if (host.document.readyState === 'loading')
        host.document.addEventListener('DOMContentLoaded', mount);
      else mount();
    }
    return {
      state: state,
      event: event,
      hit: hit,
      setEnabled: setEnabled,
      setVolume: setVolume,
      unlock: unlock,
      attachCourt: attachCourt,
      legacy: legacy,
      subscribe: function (listener) {
        listeners.push(listener);
        return function () {
          var index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
      status: function () {
        return {
          enabled: state.enabled,
          volume: state.volume,
          backend:
            typeof host.HostPlaySound === 'function'
              ? 'native'
              : context
                ? 'webaudio'
                : media.length
                  ? 'media'
                  : 'idle',
          state: context ? context.state : null
        };
      }
    };
  }

  var api = createAudio(root);
  api.createAudio = createAudio;
  api.hitPattern = hitPattern;
  api.hitRate = hitRate;
  api.wavData = wavData;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_AUDIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
