# Leda PSS English interface

An English web-interface build is in `LedaSport-English`. The original `LedaSportXunLian_V202` folder is untouched.

Close the original application, then open `LedaSport-English/Start-English.cmd`. Both copies use the same local server ports, so run one at a time. The launcher preserves the vendor executable and hardware library. The translated interface is under `nginx/html/train`.

This is an interface localisation of the supplied distribution, not a rebuild of the native Windows executable from source. Native dialogs, splash artwork, sound recordings, and existing athlete/team names have not been translated. Native host callbacks can supply company text dynamically. Hardware operation and the full rendered interface still require checking on the PSS computer; no receiver was exercised during this work.

The CSV `Athletes-English.csv` shows the English import headers. English and original Chinese headers are supported by the translated importer. Athlete records saved previously can still contain Chinese names and titles.

To reproduce the package, run `python tools/build_english.py`. This refreshes the English copy from the original, so save any runtime data from that copy before rebuilding. Run `node tools/verify_scoring.cjs` to check JavaScript syntax and the original and translated scoring handlers.

The build translates 26 JavaScript bundles and the HTML title/language. Spreadsheet encoding tables and legacy sex markers in the weight-category parser are preserved. Receiver communication is preserved. Court assignments now control blue/red hit routing; point values and thresholds remain unchanged.

See `PSS-LOGIC.md` for the rules when several protectors share one receiver.

Choose Court 1–16 beside each athlete. Each court accepts at most two; the first in roster order is Blue and the second Red. Train opens those courts; Start begins the timer. Court and colour checks: `node tools/verify_controller.cjs`.


Sensor levels: on the training screen open Sensor levels (top left). The panel shows up to 40 received impacts, device ID, court/side, raw value, raw/40 level, and the threshold/result at receipt. It monitors while scoring is paused or stopped as well as while running. Listen for hits sends the existing StartWork command to all four protector types without starting the timer; closing the panel stops a listening session it owns unless training has taken over. A receiver connection is required.

Body thresholds can now be entered directly from 0 to 71 levels (raw 0–2840), and +/- supports the same range. This is a software limit, not a verified hardware range. The original raw = level * 40 conversion is preserved. Court thresholds persist through Train preparation. Helmet threshold entry is available in the sensor panel too.

Pressure-only/no-socks: no documented RFID/NFC bypass command was found in the supplied app. The support-check button explains this; it does not enable a device mode. The scoring code already accepts received impact values without a sock check. Compare gentle impacts with and without socks in Listen for hits. No sockless messages could indicate filtering upstream, but does not isolate firmware from receiver, connectivity, or sensor behaviour. Identifying an actual bypass requires protocol/firmware support or controlled captures from a known pressure-only mode. No guessed WriteParams or gate/level changes were sent.

Validation: node tools/verify_sensors.cjs checks monitoring while stopped, parsing, higher thresholds, persistence, panel lifecycle, and the exact start/stop commands. No physical sensors were exercised.
