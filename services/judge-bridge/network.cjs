const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(execFile);

function createNetworkSetup(root, options = {}) {
  const execute = options.execute || run;
  const platform = options.platform || process.platform;
  const runtime = fs.existsSync(path.join(root, 'node.exe'))
    ? root
    : path.join(root, 'UoBTKD Training Suite', 'judge-bridge');
  const executable = path.join(runtime, 'node.exe');
  const helper = path.join(runtime, 'Allow-Mobile-Judges.ps1');
  let pending = null;
  async function status() {
    if (platform !== 'win32')
      return { state: 'unsupported', message: 'Automatic network setup requires Windows.' };
    const quoted = executable.replace(/'/g, "''");
    const command = `$ErrorActionPreference='Stop'; $r=Get-NetFirewallRule -Name 'UoBTKD-Mobile-Judges-TCP' -ErrorAction SilentlyContinue; $ok=$false; if($r -and $r.Enabled -eq 'True' -and $r.Action -eq 'Allow' -and $r.Direction -eq 'Inbound') { $app=$r | Get-NetFirewallApplicationFilter; $port=$r | Get-NetFirewallPortFilter; $address=$r | Get-NetFirewallAddressFilter; $blocks=@(Get-NetFirewallApplicationFilter -Program '${quoted}' | Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' -and $_.Enabled -eq 'True' -and $_.Name -like 'TCP Query User*' }); $ok=($app.Program -eq '${quoted}' -and $port.LocalPort -eq '8976' -and $port.Protocol -eq 'TCP' -and $address.RemoteAddress -contains 'LocalSubnet' -and $blocks.Count -eq 0) }; @{state=$(if($ok){'ready'}else{'required'})} | ConvertTo-Json -Compress`;
    const { stdout } = await execute(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 15000, maxBuffer: 16384 }
    );
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    return {
      state: result.state,
      message:
        result.state === 'ready'
          ? 'Phone connections enabled on your local network.'
          : 'Enable phone connections to configure Windows Firewall for this app.'
    };
  }
  async function enable() {
    if (pending) return pending;
    pending = (async () => {
      if (platform !== 'win32') throw new Error('Automatic network setup requires Windows.');
      if ((await status()).state === 'ready') return status();
      if (!fs.existsSync(helper))
        throw new Error('Network setup is missing. Rebuild the app and reopen Start.cmd.');
      try {
        await execute(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper],
          { windowsHide: true, timeout: 120000, maxBuffer: 16384 }
        );
      } catch {
        throw new Error(
          'Network setup was cancelled or failed. Try again and approve the Windows permission prompt.'
        );
      }
      const result = await status();
      if (result.state !== 'ready')
        throw new Error(
          'Windows did not enable phone connections. Your network administrator may need to allow TCP port 8976.'
        );
      return result;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }
  return { status, enable };
}
module.exports = { createNetworkSetup };
