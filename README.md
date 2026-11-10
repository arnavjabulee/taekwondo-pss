# UoBTKD Training Suite

1. Place the original package in `LedaSportXunLian_V202` and run `python tools/build_english.py`.
2. Launch `LedaSport-English/Start-English.cmd`.
3. Add protectors in **Equipment**, then enter names and select their equipment within a mode.

- **Court Training:** timed pairs across multiple courts.
- **Free Training:** untimed individuals, with individual/group score resets.
- **Competition:** test protectors first, then **Enter match mode**. The spectator window opens automatically. Use **Close display** or the panel's **Close spectator window** to close it.
- Both training modes have **Open spectator window** for a simplified live display. Free Training shows individuals and the group total; Court Training shows each pair and the shared timer.
- **Settings:** round count, durations, thresholds and sound. Point gap `0` disables point-gap wins.

Competition uses best-of rounds and automatic breaks. Press **Start** after the break. Technical body/head buttons add 2/3 points and track technical kicks separately. Tied rounds compare technical-kick counts, head/body points, then weak-hit counts; otherwise use **Award Blue/Red SUP**. **Update previous round** corrects its result; **Undo last round** reopens scores; **Reset match** clears the series.

Green lights show the leader and stay visible when paused; both light when fully tied. Match time below 10 seconds shows seconds and milliseconds. Breaks keep minutes/seconds. Circle/head and square/body weak-hit counters sit above gam-jeoms; impact meters show measured/threshold integers on a 0–72 scale for 3 seconds.

Receiver loss pauses play without clearing scores. Reconnect, then press **Resume**. Guard changes preserve names/scores. **Sensor levels** shows impact readings (threshold maximum 71). **Escape** returns to the previous screen; in a detached spectator window it closes that display.
