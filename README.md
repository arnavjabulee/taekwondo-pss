# Leda PSS English training interface

English interface and training improvements for the supplied Leda Sport v2.02 Windows package.

- English interface labels and import headers.
- Court selection on the Athletes page, with a maximum of two athletes per court.
- Blue/red assignment in roster order; impact routing follows assigned equipment IDs.
- Sensor monitor with raw impact values, equivalent levels, and threshold comparisons.
- Latest impact reading displayed on the wearer's side in all court layouts.
- Adjustable thresholds capped at level 71 (2,840 raw units). Reported readings remain uncapped.

## Build and run

The original vendor distribution is required and is **not included** in this repository. Neither the compiled Windows executable nor its DLLs are rebuilt by these scripts.

1. Place the original package in `LedaSportXunLian_V202` beside this README.
2. Install Python 3 and run `python tools/build_english.py`.
3. Close any running Leda instance, then double-click `LedaSport-English/Start-English.cmd`.

The build produces a complete local copy with modified web assets. The original folder is preserved. Rebuilding refreshes the output from the original package: back up your working English copy before rebuilding to avoid overwriting runtime data.

## Checks

With Node.js installed and both vendor and generated packages available:

```sh
node tools/verify_controller.cjs
node tools/verify_scoring.cjs
node tools/verify_sensors.cjs
```

These checks exercise application logic with simulated messages. Physical receiver and sensor behaviour must be checked with the actual equipment.

## Hardware notes

No verified RFID/NFC bypass command was found. The support-check button explains the current limitation; it does not enable a pressure-only device mode. The app can score received impacts but cannot recover impacts suppressed by the protector or receiver.

The repository excludes vendor packages, generated app files, athlete records, local storage, and runtime logs. No licence to redistribute the vendor software is granted here.

See [the operating guide](README-English.md) and [protocol and pairing notes](PSS-LOGIC.md) for details. The latter distinguishes the original vendor logic from the modified court-assignment flow.
