const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function scenario(failure) {
  let afterEach;
  let attempts = 0;
  const root = {
    document: {
      addEventListener() {},
      querySelector() {
        return null;
      }
    },
    PSS_MODES: {
      isCompetition() {
        return true;
      }
    }
  };
  const host = {
    $route: { name: 'Index' },
    $children: [],
    $router: {
      beforeEach() {},
      afterEach(callback) {
        afterEach = callback;
      },
      push(target, complete, abort) {
        attempts++;
        if (attempts === 1 && failure === 'throw') throw new Error('Navigation failed');
        if (attempts === 1 && failure === 'abort') return abort(new Error('Navigation aborted'));
        host.$route = target;
        afterEach(target);
        complete();
      }
    }
  };
  vm.runInNewContext(fs.readFileSync('src/runtime/navigation.js', 'utf8'), { window: root });
  root.PSS_NAV.attach(host, {});
  host.$route = { name: 'CompetitionSetup' };
  afterEach(host.$route);
  host.$route = { name: 'GameCtrl' };
  afterEach(host.$route);
  // Revisited setup pages must not create a back-navigation loop.
  afterEach({ name: 'CompetitionJudges' });
  afterEach({ name: 'CompetitionSetup' });
  // Duplicate router notifications must not require extra Escape presses.
  afterEach(host.$route);
  root.PSS_NAV.back();
  if (failure) {
    assert.equal(host.$route.name, 'GameCtrl');
    root.PSS_NAV.back();
  }
  assert.equal(host.$route.name, 'CompetitionSetup');
  root.PSS_NAV.back();
  assert.equal(host.$route.name, 'CompetitionJudges');
  root.PSS_NAV.back();
  assert.equal(host.$route.name, 'Index');
}
scenario();
scenario('abort');
scenario('throw');
console.log(
  'Navigation passed: repeated Escape, duplicate history and recovery from aborted or failed navigation.'
);
function confirmCompetition(started) {
  let after,
    accept = false,
    prompts = 0,
    pushes = 0;
  const state = { started, phase: 'running', remaining: 42 };
  const child = { gvi: { game: [{ competition: state }] }, exit_to_data() {} };
  const root = {
    document: {
      addEventListener() {},
      querySelector() {
        return null;
      }
    },
    PSS_MODES: { isCompetition: () => true },
    UOBTKD_UI: {
      confirm(message, done) {
        prompts++;
        done(accept);
        return () => {};
      }
    }
  };
  const host = {
    $route: { name: 'Index' },
    $children: [child],
    $router: {
      beforeEach() {},
      afterEach(fn) {
        after = fn;
      },
      push(target, done) {
        pushes++;
        host.$route = target;
        after(target);
        done();
      }
    }
  };
  vm.runInNewContext(fs.readFileSync('src/runtime/navigation.js', 'utf8'), { window: root });
  root.PSS_NAV.attach(host, {});
  host.$route = { name: 'CompetitionSetup' };
  after(host.$route);
  host.$route = { name: 'GameCtrl' };
  after(host.$route);
  root.PSS_NAV.back();
  if (started) {
    assert.equal(host.$route.name, 'GameCtrl');
    assert.equal(pushes, 0);
    assert.equal(state.phase, 'running');
    assert.equal(state.remaining, 42);
    accept = true;
    root.PSS_NAV.back();
    assert.equal(prompts, 2);
  } else assert.equal(prompts, 0);
  assert.equal(host.$route.name, 'CompetitionSetup');
}
confirmCompetition(true);
confirmCompetition(false);
console.log(
  'Competition Escape confirmation passed: cancel preserves route/state/time; confirm leaves; unstarted matches skip confirmation.'
);
