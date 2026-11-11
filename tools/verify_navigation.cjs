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
  // Duplicate router notifications must not require extra Escape presses.
  afterEach(host.$route);
  root.PSS_NAV.back();
  if (failure) {
    assert.equal(host.$route.name, 'GameCtrl');
    root.PSS_NAV.back();
  }
  assert.equal(host.$route.name, 'CompetitionSetup');
  root.PSS_NAV.back();
  assert.equal(host.$route.name, 'Index');
}
scenario();
scenario('abort');
scenario('throw');
console.log(
  'Navigation passed: repeated Escape, duplicate history and recovery from aborted or failed navigation.'
);
