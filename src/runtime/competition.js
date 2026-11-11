/* Competition series and referee decisions; independent of the vendor round timer. */
(function (root) {
  'use strict';
  var core =
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.UOBTKD_CORE;
  var METHODS = {
    PTF: 'Final score',
    PTG: 'Point gap',
    PUN: 'Gam-jeom limit',
    SUP: 'Superiority',
    KO: 'Knockout',
    RSC: 'Referee stops contest',
    DSQ: 'Disqualification',
    WDR: 'Withdrawal',
    DQB: 'Unsportsmanlike disqualification'
  };
  function number(value, fallback, min, max) {
    value = Number(value);
    return isFinite(value) && Math.floor(value) === value && value >= min && value <= max
      ? value
      : fallback;
  }
  function rules(info) {
    info = info || {};
    return {
      rounds: number(info.game_rounds, 3, 1, 99),
      gamJeoms: number(info.competition_max_gam_jeom, 5, 1, 99),
      pointGap: number(info.competition_point_gap, 15, 0, 999),
      duration: number(info.game_time, 120, 1, 36000),
      rest: number(info.rest_time, 60, 0, 3600)
    };
  }
  function fresh(info) {
    var config = rules(info);
    return {
      rules: config,
      results: [],
      wins: { left: 0, right: 0 },
      winner: '',
      method: '',
      phase: 'ready',
      remaining: config.duration,
      breakRemaining: 0,
      decisionSide: 'left',
      decisionMethod: 'SUP',
      started: false,
      pendingDecision: false,
      roundBreak: null,
      ivrCards: { left: true, right: true },
      ivrPending: null,
      ivrHistory: []
    };
  }
  function state(controller) {
    return controller.gvi.game[0].competition || null;
  }
  function active(controller) {
    var s = state(controller);
    return s
      ? s.started &&
          !s.winner &&
          (s.phase === 'running' ||
            s.phase === 'paused' ||
            s.phase === 'decision' ||
            s.pendingDecision)
      : controller.gvi.game_state >= 2;
  }
  function reviewable(controller) {
    var s = state(controller),
      last = s && s.results[s.results.length - 1];
    return !!(
      s &&
      !s.pendingDecision &&
      last &&
      last.snapshot.remaining === 0 &&
      ['break', 'break-paused', 'finished', 'round-over'].indexOf(s.phase) >= 0
    );
  }
  function canAdjust(controller) {
    if (state(controller) && state(controller).ivrPending) return false;
    return active(controller) || reviewable(controller);
  }
  function canManagePenalties(controller) {
    var s = state(controller);
    return !!(s && !s.ivrPending && ['paused', 'break', 'break-paused'].indexOf(s.phase) >= 0);
  }
  function rememberBreak(s) {
    if (s.results.length && ['break', 'break-paused', 'ready'].indexOf(s.phase) >= 0) {
      s.roundBreak = {
        round: s.results.length,
        remaining: s.phase === 'ready' ? 0 : s.breakRemaining,
        paused: s.phase === 'break-paused'
      };
    }
  }
  function savedBreak(s, round) {
    return s.roundBreak && s.roundBreak.round === round
      ? s.roundBreak
      : { remaining: s.rules.rest, paused: false };
  }
  function correctClosedRound(controller, store) {
    var s = state(controller),
      court = controller.gvi.game[0],
      last = s.results[s.results.length - 1];
    var changed = ['left', 'right'].some(function (side) {
      return core.PARTICIPANT_COUNTERS.some(function (key) {
        return (court[side][key] || 0) !== (last.snapshot[side][key] || 0);
      });
    });
    if (!changed) return;
    rememberBreak(s);
    var oldPhase = s.phase,
      decision = null,
      method = 'PTF';
    last.blue = court.left.score;
    last.red = court.right.score;
    last.snapshot = JSON.parse(
      JSON.stringify({ left: court.left, right: court.right, remaining: s.remaining })
    );
    // Referee stoppages remain referee decisions; a score edit must not undo one.
    if (['KO', 'RSC', 'DSQ', 'WDR', 'DQB'].indexOf(last.method) >= 0) {
      publish(controller, store);
      return;
    }
    if (court.left.warning >= s.rules.gamJeoms) {
      decision = { side: 'right' };
      method = 'PUN';
    } else if (court.right.warning >= s.rules.gamJeoms) {
      decision = { side: 'left' };
      method = 'PUN';
    } else if (
      s.rules.pointGap > 0 &&
      Math.abs(court.left.score - court.right.score) >= s.rules.pointGap
    ) {
      decision = { side: court.left.score > court.right.score ? 'left' : 'right' };
      method = 'PTG';
    } else
      decision =
        court.left.score !== court.right.score
          ? { side: court.left.score > court.right.score ? 'left' : 'right' }
          : tieBreak(court);
    if (decision) {
      var selectedSide = s.decisionSide,
        selectedMethod = s.decisionMethod;
      s.decisionSide = decision.side;
      s.decisionMethod = method;
      amend(controller, store);
      last.basis = decision.basis || '';
      s.decisionSide = selectedSide;
      s.decisionMethod = selectedMethod;
      publish(controller, store);
      return;
    }
    s.results.pop();
    tally(s);
    s.winner = '';
    s.method = '';
    s.pendingDecision = true;
    s.decisionMethod = 'SUP';
    if (oldPhase !== 'break' && oldPhase !== 'break-paused') {
      controller.$parent.stopGame();
      var previousBreak = savedBreak(s, s.results.length + 1);
      s.breakRemaining = previousBreak.remaining;
      s.phase = s.breakRemaining ? (previousBreak.paused ? 'break-paused' : 'break') : 'decision';
      if (s.breakRemaining && !previousBreak.paused) startClock(controller, store, false);
    }
    publish(controller, store);
  }
  function cue(name) {
    if (name !== 'pause' && name !== 'resume' && root.PSS_AUDIO) root.PSS_AUDIO.event(name);
  }
  function timeText(seconds) {
    seconds = Math.ceil(Math.max(0, seconds));
    var minutes = String(Math.floor(seconds / 60));
    return (minutes.length < 2 ? '0' + minutes : minutes) + ':' + ('0' + (seconds % 60)).slice(-2);
  }
  function matchTimeText(s) {
    if ((s.phase === 'running' || s.phase === 'paused') && s.remaining > 0 && s.remaining < 10) {
      var milliseconds = Math.max(0, Math.floor(s.remaining * 1000));
      return (
        ('0' + Math.floor(milliseconds / 1000)).slice(-2) +
        ':' +
        ('00' + (milliseconds % 1000)).slice(-3)
      );
    }
    return timeText(
      s.phase === 'break' || s.phase === 'break-paused' ? s.breakRemaining : s.remaining
    );
  }
  function startClock(controller, store, devices) {
    var host = controller.$parent;
    controller._lastClockAt = Date.now();
    if (devices) host.startGame(controller._competitionClock || controller.timer_callback);
    else host.startTimer(controller._competitionClock || controller.timer_callback);
    if (root.document && root.setInterval && controller._competitionClock) {
      host.stopTimer();
      host.timer = root.setInterval(controller._competitionClock, 50);
    }
  }
  function save(controller, store) {
    var now = Date.now(),
      s = state(controller);
    if (
      !controller._clockOnly ||
      controller._persistPhase !== s.phase ||
      !controller._persistAt ||
      now - controller._persistAt >= 1000
    ) {
      store.SaveChangdiData(0, controller.gvi.game[0]);
      controller._persistAt = now;
      controller._persistPhase = s.phase;
    }
    controller.SendGameData();
    if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.publish(controller);
  }
  function publish(controller, store) {
    var s = state(controller),
      g = controller.gvi;
    var now = Date.now();
    if (
      controller._clockOnly &&
      controller._displayPhase === s.phase &&
      now - (controller._displayAt || 0) < 100
    )
      return;
    controller._displayAt = now;
    controller._displayPhase = s.phase;
    controller.time = s.remaining;
    g.current_round =
      s.results.length +
      (!s.pendingDecision &&
      (s.phase === 'round-over' ||
        s.phase === 'finished' ||
        s.phase === 'break' ||
        s.phase === 'break-paused')
        ? 0
        : 1);
    g.current_round = Math.max(1, Math.min(s.rules.rounds, g.current_round));
    g.time_show = true;
    g.rest_time = s.breakRemaining;
    g.time_str = matchTimeText(s);
    g.winner = s.winner;
    g.game_state =
      s.phase === 'running'
        ? 2
        : s.phase === 'paused' || s.phase === 'break-paused'
          ? 3
          : s.phase === 'break'
            ? 5
            : s.phase === 'decision' || s.phase === 'round-over'
              ? 4
              : 1;
    var labels = {
      ready: 'Ready',
      running: 'Match',
      paused: 'Pause',
      decision: 'Awaiting referee decision',
      'round-over': 'Round complete',
      break: 'Break',
      'break-paused': 'Break paused',
      finished: 'Match complete'
    };
    g.game_msg = labels[s.phase];
    controller.control_str =
      s.phase === 'running'
        ? 'Pause'
        : s.phase === 'paused'
          ? 'Resume'
          : s.phase === 'break'
            ? 'Pause break'
            : s.phase === 'break-paused'
              ? 'Resume break'
              : s.phase === 'round-over'
                ? s.rules.rest
                  ? 'Start break'
                  : 'Next round'
                : s.phase === 'decision'
                  ? 'Awaiting decision'
                  : s.phase === 'finished'
                    ? 'Match complete'
                    : 'Start';
    save(controller, store);
  }
  function tally(s) {
    s.wins.left = 0;
    s.wins.right = 0;
    s.results.forEach(function (r) {
      s.wins[r.winner]++;
    });
  }
  function tieBreak(court) {
    var left = court.left,
      right = court.right;
    var leftTechnical = 2 * (left.technical_body || 0) + 3 * (left.technical_head || 0);
    var rightTechnical = 2 * (right.technical_body || 0) + 3 * (right.technical_head || 0);
    if (leftTechnical !== rightTechnical)
      return { side: leftTechnical > rightTechnical ? 'left' : 'right', basis: 'Technical points' };
    function first(key, basis) {
      var a = left[key] || 0,
        b = right[key] || 0;
      if (a === b) return null;
      return { side: a && (!b || a < b) ? 'left' : 'right', basis: basis };
    }
    // Manual scoring and PSS scoring share arrival order; gam-jeoms do not.
    var leftFirst = left.first_score || left.first_pss_score || 0;
    var rightFirst = right.first_score || right.first_pss_score || 0;
    if (
      ((left.tkhits || 0) + (left.hjhits || 0) > 0 && !leftFirst) ||
      ((right.tkhits || 0) + (right.hjhits || 0) > 0 && !rightFirst)
    )
      return null;
    if (leftFirst || rightFirst) {
      if (leftFirst === rightFirst) return null;
      return {
        side: leftFirst && (!rightFirst || leftFirst < rightFirst) ? 'left' : 'right',
        basis: 'First scoring technique'
      };
    }
    var leftWeak = (left.weak_head || 0) + (left.weak_body || 0);
    var rightWeak = (right.weak_head || 0) + (right.weak_body || 0);
    if (leftWeak !== rightWeak)
      return {
        side: leftWeak > rightWeak ? 'left' : 'right',
        basis: 'Below-threshold registrations'
      };
    var firstHit = first('first_pss_hit', 'First PSS hit');
    if (firstHit) return firstHit;
    return null;
  }
  function leaders(court) {
    var decision =
      court.left.score !== court.right.score
        ? { side: court.left.score > court.right.score ? 'left' : 'right' }
        : tieBreak(court);
    return {
      left: !decision || decision.side === 'left',
      right: !decision || decision.side === 'right'
    };
  }
  function finish(controller, store, side, method, terminal, basis) {
    var s = state(controller),
      court = controller.gvi.game[0];
    if (
      !s ||
      s.winner ||
      (!terminal && !active(controller)) ||
      (side !== 'left' && side !== 'right') ||
      !METHODS[method]
    )
      return false;
    var resolving = s.pendingDecision,
      breakPaused = s.phase === 'break-paused',
      breakLeft = s.breakRemaining;
    controller.$parent.stopGame();
    s.pendingDecision = false;
    s.started = true;
    s.results.push({
      round: s.results.length + 1,
      winner: side,
      method: method,
      basis: basis || '',
      name: court[side].gamer || (side === 'left' ? 'Blue' : 'Red'),
      blue: court.left.score,
      red: court.right.score,
      snapshot: JSON.parse(
        JSON.stringify({ left: court.left, right: court.right, remaining: s.remaining })
      )
    });
    tally(s);
    var target = Math.floor(s.rules.rounds / 2) + 1;
    if (
      terminal ||
      s.wins[side] >= target ||
      (s.results.length >= s.rules.rounds && s.wins.left !== s.wins.right)
    ) {
      s.winner = terminal ? side : s.wins.left > s.wins.right ? 'left' : 'right';
      s.method = terminal ? method : 'PTF';
      s.phase = 'finished';
    } else if (s.results.length >= s.rules.rounds) {
      s.phase = 'decision';
    } else {
      s.breakRemaining = resolving ? breakLeft : s.rules.rest;
      if (s.breakRemaining > 0) {
        s.phase = resolving && breakPaused ? 'break-paused' : 'break';
        if (s.phase === 'break') startClock(controller, store, false);
      } else {
        cue('roundEnd');
        next(controller, store);
        return true;
      }
    }
    cue('roundEnd');
    publish(controller, store);
    return true;
  }
  function check(controller, store, penaltyReview) {
    var s = state(controller);
    if (!s) return;
    if (
      reviewable(controller) ||
      (penaltyReview &&
        !s.pendingDecision &&
        s.results.length &&
        ['break', 'break-paused', 'finished'].indexOf(s.phase) >= 0)
    ) {
      correctClosedRound(controller, store);
      return;
    }
    if (!active(controller) && !canManagePenalties(controller)) return;
    var court = controller.gvi.game[0],
      side;
    // Penalty loss takes precedence when the same action also opens a point gap.
    if (court.left.warning >= s.rules.gamJeoms) side = 'right';
    else if (court.right.warning >= s.rules.gamJeoms) side = 'left';
    if (side) return finish(controller, store, side, 'PUN', false);
    if (s.rules.pointGap > 0 && Math.abs(court.left.score - court.right.score) >= s.rules.pointGap)
      return finish(
        controller,
        store,
        court.left.score > court.right.score ? 'left' : 'right',
        'PTG',
        false
      );
    if (s.pendingDecision) {
      var decision =
        court.left.score !== court.right.score
          ? { side: court.left.score > court.right.score ? 'left' : 'right', basis: '' }
          : tieBreak(court);
      if (decision) return finish(controller, store, decision.side, 'PTF', false, decision.basis);
    }
    save(controller, store);
  }
  function record(controller, store) {
    var s = state(controller);
    if (!s || s.winner) return false;
    var method = s.decisionMethod,
      side = s.decisionSide;
    if (!METHODS[method] || (side !== 'left' && side !== 'right')) return false;
    var terminal = ['KO', 'RSC', 'DSQ', 'WDR', 'DQB'].indexOf(method) >= 0;
    if (!terminal && !active(controller)) return false;
    var court = controller.gvi.game[0];
    var tied = court.left.score === court.right.score ? tieBreak(court) : null;
    if (
      method === 'PTF' &&
      !(court[side].score > court[side === 'left' ? 'right' : 'left'].score) &&
      !(tied && tied.side === side)
    )
      return false;
    if (
      method === 'PTG' &&
      !(
        s.rules.pointGap > 0 &&
        court[side].score - court[side === 'left' ? 'right' : 'left'].score >= s.rules.pointGap
      )
    )
      return false;
    if (method === 'PUN' && court[side === 'left' ? 'right' : 'left'].warning < s.rules.gamJeoms)
      return false;
    // An even-length series can end tied; record an overall referee decision, not a fictitious extra round.
    if (s.results.length >= s.rules.rounds) {
      if (method !== 'SUP' && ['KO', 'RSC', 'DSQ', 'WDR', 'DQB'].indexOf(method) < 0) return false;
      controller.$parent.stopGame();
      s.winner = side;
      s.method = method;
      s.phase = 'finished';
      publish(controller, store);
      return true;
    }
    return finish(controller, store, side, method, terminal, tied ? tied.basis : '');
  }
  function clearRound(controller) {
    var court = controller.gvi.game[0];
    ['left', 'right'].forEach(function (side) {
      core.PARTICIPANT_COUNTERS.forEach(function (key) {
        court[side][key] = 0;
      });
      court[side].last_hit = null;
      court[side].last_weak = null;
    });
  }
  function next(controller, store) {
    var s = state(controller);
    clearRound(controller);
    s.phase = 'ready';
    s.remaining = s.rules.duration;
    s.breakRemaining = 0;
    publish(controller, store);
  }
  function skipBreak(controller, store) {
    var s = state(controller);
    if (!s || s.ivrPending || ['break', 'break-paused'].indexOf(s.phase) < 0) return false;
    if (!root.confirm('Skip the remaining break time?')) return false;
    if (['break', 'break-paused'].indexOf(s.phase) < 0) return false;
    controller.$parent.stopTimer();
    s.breakRemaining = 0;
    if (s.pendingDecision) {
      s.phase = 'decision';
      publish(controller, store);
    } else next(controller, store);
    return true;
  }
  function raiseIVR(controller, store, side) {
    var s = state(controller);
    if (
      !s ||
      (side !== 'left' && side !== 'right') ||
      !canManagePenalties(controller) ||
      !s.ivrCards[side] ||
      s.ivrPending
    )
      return false;
    if (s.phase === 'running' || s.phase === 'break') controller.gameStop();
    s.ivrCards[side] = false;
    s.ivrPending = {
      side: side,
      round: s.results.length + (s.phase === 'paused' || s.pendingDecision ? 1 : 0),
      remaining: s.remaining,
      points: s.remaining <= 10 ? 2 : 1
    };
    publish(controller, store);
    if (controller.$nextTick)
      controller.$nextTick(function () {
        var dialog = controller.$el && controller.$el.querySelector('[data-ivr-dialog]');
        if (dialog) dialog.focus();
      });
    return true;
  }
  function roundSignature(controller) {
    return JSON.stringify(
      ['left', 'right'].map(function (side) {
        var slot = controller.gvi.game[0][side];
        return core.PARTICIPANT_COUNTERS.map(function (key) {
          return slot[key] || 0;
        });
      })
    );
  }
  function outcomeSignature(s) {
    return JSON.stringify([
      s.winner,
      s.method,
      s.pendingDecision,
      s.results.map(function (result) {
        return [result.round, result.winner, result.method, result.basis];
      })
    ]);
  }
  function resolveIVR(controller, store, successful) {
    var s = state(controller),
      appeal = s && s.ivrPending;
    if (
      !appeal ||
      typeof successful !== 'boolean' ||
      ['paused', 'break', 'break-paused'].indexOf(s.phase) < 0
    )
      return false;
    var last = s.results[s.results.length - 1];
    var entry = {
      side: appeal.side,
      round: appeal.round,
      successful: successful,
      penaltyPoints: successful ? 0 : appeal.points,
      before: {
        phase: s.phase,
        result:
          s.phase !== 'paused' && !s.pendingDecision && last
            ? JSON.parse(JSON.stringify(last))
            : null,
        pendingDecision: s.pendingDecision,
        winner: s.winner,
        method: s.method,
        remaining: s.remaining,
        breakRemaining: s.breakRemaining
      }
    };
    s.ivrPending = null;
    s.ivrCards[appeal.side] = successful;
    s.ivrHistory.push(entry);
    if (
      !successful &&
      !root.UOBTKD_CONTROLLER_FIXES.adjustGamJeom(
        controller,
        store,
        appeal.side,
        1,
        false,
        appeal.points
      )
    ) {
      s.ivrHistory.pop();
      s.ivrPending = appeal;
      return false;
    }
    entry.after = roundSignature(controller);
    entry.afterOutcome = outcomeSignature(s);
    entry.endedMatch = s.phase === 'finished';
    entry.endedRound = entry.before.phase === 'paused' && s.results.length >= entry.round;
    publish(controller, store);
    return true;
  }
  function canUndoIVR(controller, side) {
    var s = state(controller),
      last = s && s.ivrHistory && s.ivrHistory[s.ivrHistory.length - 1];
    if (!last || !last.before || s.ivrPending || (side && side !== last.side)) return false;
    if (s.phase === 'paused') return last.round === s.results.length + 1;
    if (['break', 'break-paused'].indexOf(s.phase) >= 0)
      return last.round === s.results.length + (s.pendingDecision ? 1 : 0);
    return (
      s.phase === 'finished' &&
      last.endedMatch &&
      last.penaltyPoints > 0 &&
      last.round === s.results.length
    );
  }
  function undoIVR(controller, store, side) {
    if (!canUndoIVR(controller, side)) return false;
    var s = state(controller),
      last = s.ivrHistory[s.ivrHistory.length - 1],
      before = last.before;
    var unchanged =
      roundSignature(controller) === last.after && outcomeSignature(s) === last.afterOutcome;
    var remainingBreak = s.phase === 'finished' ? before.breakRemaining : s.breakRemaining;
    var currentRemaining = s.remaining;
    var returnToRound =
      before.phase === 'paused' && (s.phase === 'paused' || (unchanged && last.endedRound));
    controller.$parent.stopGame();
    var court = controller.gvi.game[0],
      offender = court[last.side],
      opponent = court[last.side === 'left' ? 'right' : 'left'];
    if (last.penaltyPoints) {
      offender.warning = Math.max(0, offender.warning - 1);
      offender.ivr_warnings = Math.max(0, (offender.ivr_warnings || 0) - 1);
      opponent.score = Math.max(0, opponent.score - last.penaltyPoints);
      if (root.PSS_AUDIO) root.PSS_AUDIO.event('deduct');
    }
    s.ivrCards[last.side] = true;
    s.ivrHistory.pop();
    if (unchanged) {
      s.results = s.results.filter(function (result) {
        return result.round !== last.round;
      });
      if (before.result) s.results.push(JSON.parse(JSON.stringify(before.result)));
      tally(s);
      s.pendingDecision = before.pendingDecision;
      s.winner = before.winner;
      s.method = before.method;
      s.remaining =
        before.phase === 'paused' && !last.endedRound ? currentRemaining : before.remaining;
    } else check(controller, store, true);
    s.breakRemaining = remainingBreak;
    if (!s.winner) {
      controller.$parent.stopTimer();
      s.phase = returnToRound
        ? 'paused'
        : remainingBreak > 0
          ? 'break-paused'
          : s.pendingDecision
            ? 'decision'
            : 'ready';
    }
    publish(controller, store);
    return true;
  }
  function cancelIVR(controller, store) {
    var s = state(controller),
      appeal = s && s.ivrPending;
    if (!appeal) return false;
    s.ivrCards[appeal.side] = true;
    s.ivrPending = null;
    publish(controller, store);
    return true;
  }
  function control(controller, store) {
    var s = state(controller),
      host = controller.$parent;
    if (!s || s.ivrPending) return;
    if (s.phase === 'finished') {
      host.stopGame();
      if (controller.$router) controller.$router.push({ name: 'CompetitionSetup' });
      return;
    }
    if (s.winner || s.phase === 'decision') return;
    if (s.phase === 'round-over') {
      if (!s.rules.rest) {
        next(controller, store);
        return;
      }
      s.phase = 'break';
      s.breakRemaining = s.rules.rest;
      startClock(controller, store, false);
    } else if (s.phase === 'break') {
      host.stopTimer();
      s.phase = 'break-paused';
      cue('pause');
    } else if (s.phase === 'break-paused') {
      s.phase = 'break';
      startClock(controller, store, false);
      cue('resume');
    } else if (s.phase === 'running') {
      host.stopGame();
      s.phase = 'paused';
      cue('pause');
    } else {
      if (!root.UOBTKD_CONTROLLER_FIXES.canStart(controller)) return;
      var resume = s.phase === 'paused';
      s.started = true;
      startClock(controller, store, true);
      // Device commands may synchronously report a stale receiver connection.
      // Enter the running state after transport setup so offline starts work too.
      s.phase = 'running';
      cue(resume ? 'resume' : 'roundStart');
    }
    publish(controller, store);
  }
  function tick(controller, store, elapsed) {
    elapsed = elapsed === undefined ? 1 : Math.max(0, elapsed);
    var s = state(controller);
    if (s.ivrPending) return;
    if (s.phase === 'break') {
      s.breakRemaining = Math.max(0, s.breakRemaining - elapsed);
      if (!s.breakRemaining) {
        controller.$parent.stopTimer();
        cue('breakEnd');
        if (s.pendingDecision) {
          s.phase = 'decision';
          publish(controller, store);
          return;
        }
        next(controller, store);
        return;
      }
    } else if (s.phase === 'running') {
      s.remaining = Math.max(0, s.remaining - elapsed);
      if (!s.remaining) {
        var court = controller.gvi.game[0];
        if (court.left.score !== court.right.score) {
          finish(
            controller,
            store,
            court.left.score > court.right.score ? 'left' : 'right',
            'PTF',
            false
          );
          return;
        }
        var decision = tieBreak(court);
        if (decision) {
          finish(controller, store, decision.side, 'PTF', false, decision.basis);
          return;
        }
        controller.$parent.stopGame();
        s.phase = 'decision';
        s.pendingDecision = true;
        if (s.rules.rest > 0) {
          s.phase = 'break';
          s.breakRemaining = s.rules.rest;
          startClock(controller, store, false);
        }
        s.decisionMethod = 'SUP';
        cue('roundEnd');
      }
    } else return;
    publish(controller, store);
  }
  function undo(controller, store) {
    var s = state(controller);
    if (!s || s.phase === 'running' || !s.results.length) return false;
    controller.$parent.stopGame();
    var result = s.results.pop(),
      court = controller.gvi.game[0];
    // Preserve current names and equipment, including changes made between rounds.
    ['left', 'right'].forEach(function (side) {
      [
        'score',
        'warning',
        'passive_warnings',
        'ivr_warnings',
        'tkhits',
        'hjhits',
        'valid',
        'technical_body',
        'technical_head',
        'body_points',
        'head_points',
        'punches',
        'first_score',
        'first_pss_score',
        'first_pss_hit',
        'weak_body',
        'weak_head'
      ].forEach(function (key) {
        court[side][key] = result.snapshot[side][key] || 0;
      });
      court[side].last_hit = result.snapshot[side].last_hit || null;
      court[side].last_weak = null;
    });
    tally(s);
    s.winner = '';
    s.method = '';
    s.pendingDecision = false;
    s.remaining = result.snapshot.remaining;
    s.phase = s.remaining ? 'paused' : 'decision';
    s.started = true;
    publish(controller, store);
    return true;
  }
  function reset(controller, store) {
    var s = state(controller);
    if (!s || s.phase === 'running' || s.phase === 'break') return;
    controller.$parent.stopGame();
    clearRound(controller);
    controller.$set(
      controller.gvi.game[0],
      'competition',
      fresh(store.ReadGameInfo() || store.GAMEINFO)
    );
    publish(controller, store);
  }
  function amend(controller, store) {
    var s = state(controller),
      side = s && s.decisionSide,
      method = s && s.decisionMethod;
    if (
      !s ||
      s.phase === 'running' ||
      !s.results.length ||
      !METHODS[method] ||
      (side !== 'left' && side !== 'right')
    )
      return false;
    rememberBreak(s);
    var last = s.results[s.results.length - 1],
      wasFinished = s.phase === 'finished',
      target = Math.floor(s.rules.rounds / 2) + 1;
    last.winner = side;
    last.method = method;
    last.basis = '';
    last.name = controller.gvi.game[0][side].gamer || (side === 'left' ? 'Blue' : 'Red');
    tally(s);
    s.winner = '';
    s.method = '';
    var terminal = ['KO', 'RSC', 'DSQ', 'WDR', 'DQB'].indexOf(method) >= 0;
    if (
      terminal ||
      s.wins.left >= target ||
      s.wins.right >= target ||
      (s.results.length >= s.rules.rounds && s.wins.left !== s.wins.right)
    ) {
      controller.$parent.stopGame();
      s.winner = terminal ? side : s.wins.left > s.wins.right ? 'left' : 'right';
      s.method = terminal ? method : 'PTF';
      s.phase = 'finished';
      s.pendingDecision = false;
    } else if (s.results.length >= s.rules.rounds) {
      controller.$parent.stopGame();
      s.phase = 'decision';
      s.pendingDecision = false;
    } else if (wasFinished) {
      var previousBreak = savedBreak(s, s.results.length);
      s.breakRemaining = previousBreak.remaining;
      if (s.breakRemaining) {
        s.phase = previousBreak.paused ? 'break-paused' : 'break';
        if (!previousBreak.paused) startClock(controller, store, false);
      } else {
        next(controller, store);
        return true;
      }
    }
    publish(controller, store);
    return true;
  }
  function attach(controller, store) {
    if (!root.PSS_MODES.isCompetition()) return;
    var court = controller.gvi.game[0];
    if (typeof court.helmetLevel === 'number') {
      controller.gameinfo = JSON.parse(JSON.stringify(controller.gameinfo));
      controller.gameinfo.toukui_gate = court.helmetLevel;
    }
    if (!court.competition) controller.$set(court, 'competition', fresh(controller.gameinfo));
    var s = state(controller);
    if (!s.ivrCards) controller.$set(s, 'ivrCards', { left: true, right: true });
    if (s.ivrPending === undefined) controller.$set(s, 'ivrPending', null);
    if (!s.ivrHistory) controller.$set(s, 'ivrHistory', []);
    controller.raiseIVR = function (side) {
      return raiseIVR(controller, store, side);
    };
    controller.resolveIVR = function (success) {
      return resolveIVR(controller, store, success);
    };
    controller.undoIVR = function (side) {
      return undoIVR(controller, store, side);
    };
    controller.cancelIVR = function () {
      return cancelIVR(controller, store);
    };
    // Navigation stops transport. Preserve scores/results/clock, and return paused.
    if (s.phase === 'running') s.phase = 'paused';
    if (s.phase === 'break') s.phase = 'break-paused';
    controller.gameControl = function () {
      control(controller, store);
    };
    controller.timer_callback = function () {
      tick(controller, store);
    };
    controller._competitionClock = function () {
      var now = Date.now(),
        elapsed = Math.max(0, now - controller._lastClockAt) / 1000;
      controller._lastClockAt = now;
      controller._clockOnly = true;
      try {
        tick(controller, store, elapsed);
      } finally {
        controller._clockOnly = false;
      }
    };
    if (root.requestAnimationFrame) {
      function animateClock() {
        if (controller._isDestroyed) return;
        var current = state(controller),
          remaining = current.remaining;
        if (current.phase === 'running')
          remaining = Math.max(
            0,
            remaining - Math.max(0, Date.now() - controller._lastClockAt) / 1000
          );
        var node = controller.$el && controller.$el.querySelector('.uobtkd-timer span');
        if (node)
          node.textContent = matchTimeText({
            phase: current.phase,
            remaining: remaining,
            breakRemaining: current.breakRemaining
          });
        controller._clockAnimation = root.requestAnimationFrame(animateClock);
      }
      controller._clockAnimation = root.requestAnimationFrame(animateClock);
    }
    controller.gameStop = function () {
      var s = state(controller);
      controller.$parent.stopGame();
      if (s.phase === 'running') s.phase = 'paused';
      if (s.phase === 'break') s.phase = 'break-paused';
      cue('pause');
      publish(controller, store);
    };
    var setup = controller.gameSetup;
    controller.gameSetup = function () {
      var current = state(controller);
      if (current.phase === 'running' || current.phase === 'break') controller.gameStop();
      if (setup) setup.call(controller);
    };
    var confirmSetup = controller.SetupConfirm;
    controller.SetupConfirm = function () {
      var rounds = controller.gameinfo.game_rounds;
      if (confirmSetup) confirmSetup.call(controller);
      // The vendor Grand Slam preset forces three rounds; custom series keep the operator's count.
      if (typeof court.helmetLevel === 'number')
        court.helmetLevel = core.savedLevel(controller.gameinfo.toukui_gate, 1);
      if (controller.gameinfo.game_rounds !== rounds) {
        controller.gameinfo.game_rounds = rounds;
        controller.SaveGameInfo();
      }
      publish(controller, store);
    };
    var online = controller.handleOnlineState;
    controller.handleOnlineState = function (value) {
      var wasOnline = controller.gvi.online;
      if (online) online.call(controller, value);
      if (
        wasOnline &&
        !controller.gvi.online &&
        (state(controller).phase === 'running' || state(controller).phase === 'break')
      )
        controller.gameStop();
    };
    controller.$parent.online_cb = controller.handleOnlineState;
    controller.recordCompetitionResult = function () {
      if (!record(controller, store))
        root.UOBTKD_UI.notify(
          'The selected result does not match the scores or configured limits. Use SUP for a referee superiority decision.'
        );
    };
    controller.undoCompetitionResult = function () {
      undo(controller, store);
    };
    controller.amendCompetitionResult = function () {
      amend(controller, store);
    };
    controller.skipCompetitionBreak = function () {
      return skipBreak(controller, store);
    };
    controller.resetCompetitionMatch = function () {
      reset(controller, store);
    };
    if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.attach(controller);
    publish(controller, store);
  }
  function render(view, h, controller) {
    var s = state(controller);
    if (!s) return view._e();
    var court = controller.gvi.game[0],
      editable = active(controller),
      live = s.phase === 'running' || s.phase === 'break';
    function text(value) {
      return view._v(String(value));
    }
    function name(side) {
      return court[side].gamer || (side === 'left' ? 'Blue' : 'Red');
    }
    function button(label, action, disabled) {
      return h('button', { attrs: { type: 'button', disabled: disabled }, on: { click: action } }, [
        text(label)
      ]);
    }
    function select(key, label, options) {
      return h(
        'select',
        {
          attrs: { 'aria-label': label },
          domProps: { value: s[key] },
          on: {
            change: function (event) {
              s[key] = event.target.value;
            }
          }
        },
        options
      );
    }
    return h(
      'section',
      { staticClass: 'pss-series', attrs: { 'aria-label': 'Competition round results' } },
      [
        s.ivrPending
          ? h('div', { staticClass: 'pss-ivr-overlay' }, [
              h(
                'section',
                {
                  staticClass: 'pss-ivr-dialog',
                  attrs: {
                    role: 'dialog',
                    'aria-modal': 'true',
                    'aria-label': 'Instant video replay appeal',
                    'data-ivr-dialog': '',
                    tabindex: '-1'
                  }
                },
                [
                  h('h2', [text((s.ivrPending.side === 'left' ? 'Blue' : 'Red') + ' IVR appeal')]),
                  h('p', [text('Was the appeal successful?')]),
                  h('p', [
                    text(
                      'Successful: return the quota card. Unsuccessful: lose the card, add one gam-jeom and award ' +
                        s.ivrPending.points +
                        ' point' +
                        (s.ivrPending.points === 1 ? '' : 's') +
                        ' to the opponent.'
                    )
                  ]),
                  button(
                    'Successful IVR',
                    function () {
                      controller.resolveIVR(true);
                    },
                    false
                  ),
                  button(
                    'Unsuccessful IVR',
                    function () {
                      controller.resolveIVR(false);
                    },
                    false
                  ),
                  button(
                    'Cancel appeal',
                    function () {
                      controller.cancelIVR();
                    },
                    false
                  )
                ]
              )
            ])
          : view._e(),
        h('div', { staticClass: 'pss-series-summary' }, [
          h('strong', [text('Rounds won · Blue ' + s.wins.left + ' – ' + s.wins.right + ' Red')]),
          h('span', [
            text(
              'Best of ' +
                s.rules.rounds +
                ' · First to ' +
                (Math.floor(s.rules.rounds / 2) + 1) +
                ' · Gam-jeom limit ' +
                s.rules.gamJeoms +
                ' · Point gap ' +
                (s.rules.pointGap || 'off')
            )
          ])
        ]),
        h('div', { staticClass: 'pss-series-outcome', attrs: { role: 'status' } }, [
          text(
            s.winner
              ? 'Match winner: ' +
                  (s.winner === 'left' ? 'Blue' : 'Red') +
                  ' · ' +
                  s.method +
                  ' — ' +
                  METHODS[s.method]
              : s.pendingDecision || s.phase === 'decision'
                ? s.results.length >= s.rules.rounds
                  ? 'Series tied — select a match winner by SUP.'
                  : 'SUP — Undecided. Referee/judges decision required.'
                : (s.phase === 'break' || s.phase === 'break-paused' || s.phase === 'ready') &&
                    s.results.length
                  ? 'Round ' +
                    s.results[s.results.length - 1].round +
                    ' winner: ' +
                    (s.results[s.results.length - 1].winner === 'left' ? 'Blue' : 'Red') +
                    ' · ' +
                    s.results[s.results.length - 1].method
                  : 'Round ' + (s.results.length + 1) + ' of ' + s.rules.rounds
          )
        ]),
        ['break', 'break-paused'].indexOf(s.phase) >= 0
          ? button(
              'Skip break',
              function () {
                controller.skipCompetitionBreak();
              },
              false
            )
          : view._e(),
        (s.pendingDecision || s.phase === 'decision') && !s.winner
          ? h(
              'div',
              {
                staticClass: 'pss-sup-vote',
                attrs: { role: 'group', 'aria-label': 'Referee superiority decision' }
              },
              [
                h('span', [text('Superiority decision — select the agreed winner: ')]),
                h('small', { style: { width: '100%' } }, [
                  text(
                    '1 corner judge: referee, review jury and judge. 2 corner judges: referee and both judges. 3 corner judges: the three judges, excluding the referee.'
                  )
                ]),
                button(
                  'Award Blue SUP',
                  function () {
                    s.decisionSide = 'left';
                    s.decisionMethod = 'SUP';
                    controller.recordCompetitionResult();
                  },
                  false
                ),
                button(
                  'Award Red SUP',
                  function () {
                    s.decisionSide = 'right';
                    s.decisionMethod = 'SUP';
                    controller.recordCompetitionResult();
                  },
                  false
                )
              ]
            )
          : view._e(),
        h(
          'div',
          { staticClass: 'pss-round-history' },
          s.results.map(function (result) {
            return h('div', { key: result.round, staticClass: 'pss-round-result' }, [
              text(
                'Round ' +
                  result.round +
                  ' · ' +
                  result.name +
                  ' (' +
                  (result.winner === 'left' ? 'Blue' : 'Red') +
                  ') · ' +
                  result.blue +
                  '–' +
                  result.red +
                  ' · ' +
                  result.method +
                  ' — ' +
                  METHODS[result.method] +
                  (result.basis ? ' · ' + result.basis : '')
              )
            ]);
          })
        ),
        h('div', { staticClass: 'pss-referee-controls' }, [
          select(
            'decisionSide',
            'Result winner',
            ['left', 'right'].map(function (side) {
              return h('option', { attrs: { value: side } }, [
                text((side === 'left' ? 'Blue' : 'Red') + ' — ' + name(side))
              ]);
            })
          ),
          select(
            'decisionMethod',
            'Win method',
            Object.keys(METHODS).map(function (method) {
              return h('option', { attrs: { value: method } }, [
                text(method + ' — ' + METHODS[method])
              ]);
            })
          ),
          button(
            'Record result',
            function () {
              controller.recordCompetitionResult();
            },
            !!s.winner ||
              (!editable && ['KO', 'RSC', 'DSQ', 'WDR', 'DQB'].indexOf(s.decisionMethod) < 0)
          ),
          button(
            'Undo last round',
            function () {
              controller.undoCompetitionResult();
            },
            s.phase === 'running' || !s.results.length
          ),
          button(
            'Update previous round',
            function () {
              controller.amendCompetitionResult();
            },
            s.phase === 'running' || !s.results.length
          ),
          button(
            'Reset match',
            function () {
              controller.resetCompetitionMatch();
            },
            live
          )
        ]),
        h('small', [
          text(
            'PTF / PTG / PUN / SUP decide a round. KO / RSC / DSQ / WDR / DQB end the match. Select a winner and method, then Update previous round to correct the last result. Pause a running round before making that correction.'
          )
        ])
      ]
    );
  }
  function renderSettings(view, h) {
    if (!root.PSS_MODES.isCompetition()) return view._e();
    var defaults = rules(view.gameinfo);
    function field(key, label, value, min, max) {
      return h('label', { staticClass: 'pss-settings-field' }, [
        h('span', [view._v(label)]),
        h('input', {
          attrs: { type: 'number', 'aria-label': label, min: min, max: max, step: 1 },
          domProps: { value: value },
          on: {
            change: function (event) {
              var next = Number(event.target.value);
              if (
                event.target.value.trim() === '' ||
                !isFinite(next) ||
                Math.floor(next) !== next ||
                next < min ||
                next > max
              ) {
                event.target.value = value;
                root.UOBTKD_UI.notify('Enter a whole number between ' + min + ' and ' + max + '.');
                return;
              }
              view.$set(view.gameinfo, key, next);
            }
          }
        })
      ]);
    }
    return h('section', { staticClass: 'pss-competition-settings' }, [
      h('h3', [view._v('Competition rules')]),
      field(
        'competition_max_gam_jeom',
        'Maximum gam-jeoms per round (1–99)',
        defaults.gamJeoms,
        1,
        99
      ),
      field(
        'competition_point_gap',
        'Point gap (0 disables, maximum 999)',
        defaults.pointGap,
        0,
        999
      ),
      h('p', [
        view._v(
          'Rules are fixed for the current match. Save, then use Reset match to apply new rules, or return to Protector test to set up another match.'
        )
      ])
    ]);
  }
  var api = {
    rules: rules,
    fresh: fresh,
    state: state,
    active: active,
    canAdjust: canAdjust,
    canManagePenalties: canManagePenalties,
    canUndoIVR: canUndoIVR,
    undoIVR: undoIVR,
    attach: attach,
    check: check,
    record: record,
    undo: undo,
    amend: amend,
    reset: reset,
    control: control,
    raiseIVR: raiseIVR,
    resolveIVR: resolveIVR,
    cancelIVR: cancelIVR,
    skipBreak: skipBreak,
    tick: tick,
    render: render,
    renderSettings: renderSettings,
    methods: METHODS,
    tieBreak: tieBreak,
    leaders: leaders,
    matchTimeText: matchTimeText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_COMPETITION = api;
})(typeof window !== 'undefined' ? window : globalThis);
