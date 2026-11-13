const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNetworkSetup } = require('../services/judge-bridge/network.cjs');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uobtkd-network-'));
  try {
    fs.writeFileSync(path.join(root, 'node.exe'), '');
    fs.writeFileSync(path.join(root, 'Allow-Mobile-Judges.ps1'), '');
    let ready = false,
      cancelled = false,
      setupCalls = 0,
      reads = 0;
    const execute = async (file, args, options) => {
      assert.equal(file, 'powershell.exe');
      assert.equal(options.windowsHide, true);
      if (args.includes('-File')) {
        assert.equal(args[args.indexOf('-File') + 1], path.join(root, 'Allow-Mobile-Judges.ps1'));
        setupCalls++;
        if (cancelled) throw new Error('User declined UAC');
        ready = true;
        return { stdout: '' };
      }
      reads++;
      assert(args.includes('-NonInteractive'));
      assert(args.at(-1).includes('LocalSubnet'));
      assert(args.at(-1).includes("'8976'"));
      return { stdout: JSON.stringify({ state: ready ? 'ready' : 'required' }) };
    };
    const network = createNetworkSetup(root, { execute, platform: 'win32' });
    assert.equal((await network.status()).state, 'required');
    assert.equal(setupCalls, 0, 'Reading status never requests administrator permission');
    cancelled = true;
    await assert.rejects(network.enable(), /cancelled or failed/);
    cancelled = false;
    const results = await Promise.all([network.enable(), network.enable()]);
    assert(results.every((x) => x.state === 'ready'));
    assert.equal(setupCalls, 2, 'Concurrent clicks share one setup request');
    await network.enable();
    assert.equal(setupCalls, 2, 'Configured installs do not elevate again');
    assert(reads >= 4);
    assert.equal(
      (await createNetworkSetup(root, { platform: 'linux' }).status()).state,
      'unsupported'
    );
    console.log(
      'Network setup passed: read-only checks, cancellation/retry, concurrent request suppression and persistent-rule reuse.'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
