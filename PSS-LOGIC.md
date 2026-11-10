# Several protectors through one receiver

## Current interface

There is no saved-athlete roster. Court Training and Competition use directly editable names and separate body/head equipment selectors. Free Training uses named cards created with Add person. Equipment labels come from the shared physical-device inventory.

Hit routing matches the currently assigned device ID. Changing a guard keeps the participant's score, name and mode state. Selecting a guard already worn by another participant swaps the two same-type assignments atomically; future hits follow the new wearer. No device ID is assigned twice within one mode. Colour does not force a participant's side.

The sections below describe the original vendor behaviour.


These findings come from the supplied v2.02 JavaScript, with the active scoring handler executed in isolation against simulated messages. They describe application behaviour; radio pairing, packet integrity, and the actual hardware capacity remain unverified.

## Connection and discovery

The frontend connects over MQTT WebSocket to `ws://192.168.99.1:1884/mqtt`. This is the configured application endpoint, not proof that the USB receiver itself hosts that address. The native executable and `LedaSport.dll` provide additional integration.

It subscribes to `DevState`, `DevData`, and its generated client ID. It publishes `DevQuery` to request the connected-device list. Discovery splits the list into comma-separated entries, takes the first 12 characters as device ID, and reads the device type from character offset 13 onwards. Types `huju`/`xlhuju` are body protectors; `toukui`/`xltoukui` are helmets. Battery queries address either a device ID or a device-type topic.

Source: `LedaSportXunLian_V202/nginx/html/train/index.js`, component `app`, methods `onClientState`, `UpdateDeviceState`, `onAuthClientMessage`, and `MqttRequestDeviceList`.

## Assignment to training areas

The active `/gamectrl` route loads `45.index.js`, module `7754`. It maintains 16 areas. The 1/4/8/16 options select display layouts; the scoring loop still searches 16 areas.

Each area holds a left/blue athlete and a right/red athlete. Each athlete has one helmet ID and one body-protector ID. Selecting an athlete copies their stored IDs into the area's slots (`gamer_changed`). A full 16-area setup therefore has 64 equipment slots, but this does not establish that a receiver supports 64 concurrent devices.

The app determines side from the final character of the 12-character ID (`substring(11)`). Numeric odd digits mean left/blue; numeric even digits mean right/red. For letters, odd character codes mean left/blue and even mean right/red: A/C/E are left; B/D/F are right. This is character-code parity, not general hexadecimal numeric conversion.

Athlete selection lists are also split by body-protector ID parity. A helmet must have the expected side parity as well as match its assigned slot. Merely assigning an ID to the opposite side does not override the parity rule.

Source: `index.js`, shared module `8462`, `left_or_right`; `170.index.js`, `to_game`; `45.index.js`, `gamer_changed` and `handleDevData`.

## Incoming hits and scoring

The message parser expects the device ID before the first comma and a numeric value after a colon in the second comma-separated field, for example `000000000001,value:320`. The key name is not checked by the handler; this example describes the parser shape, not a captured hardware packet.

1. Accept hits only while `game_state == 2` (training running).
2. Treat the device as a helmet if its ID is in the discovered helmet list; otherwise take the body-protector path.
3. Determine the wearer's side by ID parity.
4. Search that side's matching equipment slot across the 16 areas.
5. On the first ID match, award the opponent points if the threshold is met, then stop searching.

| Hit | Threshold in raw units | Effect on opponent |
|---|---|---|
| Helmet | `round(toukui_gate * 40)` | +3 points and one helmet hit |
| Body protector | `round(area.lidu * 40)` | +2 points and one body hit |
| Body below threshold | Below that area's threshold | Increment `valid`, no points |
| Helmet below threshold | Below helmet threshold | No points or hit-counter change |

The default helmet gate is 1 (raw 40). Area body threshold defaults to 8 (raw 320). Equality passes. This handler uses fixed +3/+2 values, even though general game settings also contain scoring fields.

Example: a hit of 320 on blue's body protector in area 2 gives red in area 2 two points. It does not identify the kicker independently; the opponent is inferred from the area's assignment.

## Shared receiver implications

- Connecting additional protectors populates the discovered lists. Discovery alone does not assign athletes to areas.
- A protector ID should appear in only one area. Duplicate assignments score only in the first matching area because the loop breaks.
- An unassigned ID cannot score. A side-parity mismatch also prevents a matching hit from scoring.
- Start and stop are broadcast to `huju`, `xlhuju`, `toukui`, and `xltoukui`, using `StartWork,time:<duration>,gate:1,level:1` and `StopWork`. The frontend applies per-area thresholds after receiving hits.
- Areas share the controller's round timer and training state. They are not independent timed matches.
- There is no message-ID or timestamp deduplication in `handleDevData`. Repeated delivery of a valid hit increments the score repeatedly. Whether the receiver suppresses duplicate physical hits is unknown.
- Reconnected devices are detected by changes in assigned-slot presence. Delayed start commands address the whole device type, not only the returning ID. If body and helmet reconnect flags both appear in one update, the body branch takes priority.
- Parsing assumes well-formed payloads; it does not validate the full device ID, field key, numeric range, or source pairing. Keep those validation requirements in a future clean-source rebuild.

## Verification and remaining checks

`node tools/verify_scoring.cjs` parses all original and English JavaScript bundles and runs the actual active scoring handler from both packages. It checks side parity, area isolation, threshold boundaries, opponent scoring, duplicate assignments, unassigned IDs, pause behaviour, and repeated message handling. These isolated checks passed.

Hardware validation should confirm discovery with all protectors powered on, their IDs and side parity, one hit per area with no cross-area scoring, pause/resume behaviour, and recovery after a protector disconnects. Receiver limits and radio collision handling cannot be inferred from the frontend alone.

Competition series (current implementation)
-------------------------------------------
Competition uses a separate series controller in src/runtime/competition.js; Court Training retains its original timer. Rules are copied when a match is created/reset, so settings edits cannot silently change an underway match. Defaults: five gam-jeoms per round and a 15-point gap; both are configurable, and gap zero disables gap wins. Rounds use the existing configured count; the target is floor(rounds/2)+1. Even series tied at the configured limit require an overall SUP decision.

Each round resets points, penalties and hit counters. Reaching the penalty limit awards the opponent the round by PUN, checked before PTG when a penalty also opens the gap. PTG applies immediately whenever the configured positive gap is reached, including manual corrections while paused. Unequal scores at time expiry produce PTF. Ties stop for an operator SUP decision; the application cannot reconstruct spinning-technique/punch evidence for the full WT tie-break order. Test packets before match mode never reach this scoring state.

KO, RSC, DSQ, WDR and DQB are manual whole-match decisions, including withdrawal/disqualification before the first start. KO is an additional user-requested label; WT classifies knockdown-related stoppages under RSC. The history retains each decided round's name, side, points and method. Whole-match series decisions use PTF; the decisive round retains its actual method. Undo restores round scores/penalties/counters and remaining time, while preserving current equipment and names. Reset clears the series and adopts saved rules. Stop/settings/offline pause a live match. Equipment navigation retains round history, rules and clock, returning paused. Breaks are started explicitly; break end leaves the next round ready for Start.

Rules reference: World Taekwondo Competition Rules & Interpretation, June 1, 2026, Articles 14–16:
https://www.taekwondo.dk/files/Dokumenter/Statisk/Dommer/Regler/Competition%20Rules%20and%20Interpretation%20from%2001.06.2026.pdf
The source contains inconsistent English PTG figures (15 in Explanation 3; 12 repeated in Explanation 8). This app exposes the threshold explicitly instead of representing its custom settings as a certified WT rules implementation.

Checks: tools/verify_competition_series.cjs covers threshold wins, zero gap, best-of-3/5, even ties, referee outcomes, corrections, breaks, saved state and settings/offline pause. tools/verify_ui.cjs exercises actual Settings fields, a three-round result, result replacement, in-match settings, disabled gap and equipment navigation with synthetic MQTT messages. Physical receiver testing remains separate.

Competition spectator display
-----------------------------
Competition has Control panel and Spectator display tabs. The latter previews the separate spectator.html page. Open spectator window uses the existing native shell's window.open support (wkeOnCreateView creates and shows a separate wkeCreateWebWindow); no second application process or receiver connection is needed. Move that window to the TV and use its Full screen button/F key.

src/runtime/spectator.js publishes a small snapshot after competition changes, with a one-second heartbeat. Same-origin postMessage and session-scoped localStorage keep the popup/preview synchronized. Payloads contain only display names, points, gam-jeoms, round wins, clock, phase and the five most recent results; equipment IDs and receiver credentials are excluded. The standalone page loads no Vue application, MQTT client or match controller, and has no scoring/timer controls. It never advances its own match clock. Leaving Competition or missing heartbeat updates shows a panel-disconnected notice with the last received score. Re-entering Competition in the same app session updates an already-open TV window.

The embedded browser advertises Chromium 60, so spectator font sizes include vw fallbacks before modern min()/clamp() declarations. Browser verification exercises popup creation, preview switching without pausing, live hits and pause/result synchronization, reconnection after equipment navigation, zero spectator websockets, disconnect state and font fallbacks. The actual monitor/virtual-desktop arrangement still needs checking on the user's TV.

Spectator sizing update: the native popup constructor now uses MiniBlink's borderless window type, while Open spectator window supplies the full screen rectangle rather than fixed 1280x800 dimensions. The standalone native window fits its screen immediately on load; no browser fullscreen gesture is needed. Existing windows also receive a fullscreen request when reopened from the panel. The scoreboard is a fixed 1920x1080 design scaled uniformly and centred on resize/fullscreen changes, keeping names, scores and clock proportions consistent in the preview, 16:9 TVs, ultrawide or taller screens. Non-16:9 screens retain black margins rather than stretching. Escape closes only the detached display. The native constructor change is anchored and verified against the vendor bytes. Borderless API reference: https://github.com/weolar/miniblink49/blob/master/README.md

Embedded layout correction: the user's native screenshot demonstrated that this engine does not implement the scoreboard's CSS Grid layout, despite its advertised Chrome/60 user agent. The scoreboard now positions blue, centre, red, header and footer explicitly within the 1920x1080 stage. It uses no Grid or gap support for those regions. The stylesheet has a new cache URL. Browser regression disables Grid/gap/modern font declarations and verifies all three regions are side by side, correctly bounded at TV and laptop sizes. An experimental direct-DLL renderer could not be validated and was removed; these checks emulate missing layout features in Edge rather than claiming an actual native renderer run.

Automatic breaks, corrections and test display (current)
-------------------------------------------------------
A decided, non-final round now starts the configured break immediately. A zero-duration break moves directly to Ready for the next round. The next round still requires Start. A tied round can run its break while awaiting a referee decision; if the break expires first, Ready is withheld until the tie is resolved. Resolving a tie uses the remaining break time instead of restarting it. No winner is guessed. Spectator and panel show the most recent decided round's winner/method during the break and Ready state.

Update previous round applies the selected winner/method to the latest recorded result and recomputes series wins. It is available during a break or while paused/ready/finished; a live round must be paused first. A running break retains its remaining time. A changed result can end the series, change its winner, or reopen a formerly finished series. Undo last round remains available for reopening scores/penalties, stopping any break before restoration.

The spectator window is opened automatically from CompetitionSetup. Its test view uses a circle for each head protector and a square for each body protector, with received levels, raw values and counts. It contains no handheld-controller representations. Test impacts remain isolated from scoring. The same window/channel transitions between test and match snapshots; raw IDs and match snapshots containing equipment are excluded from its payload.

Spectator Escape is fixed in native message routing, not through document.hasFocus heuristics. The verified HWND ancestry guard uses MSG.hwnd and GetParent to distinguish the panel CWnd/children from independent web windows. Panel keys retain the existing JavaScript navigation dispatch. A foreign-window Escape returns FALSE from the panel PreTranslateMessage override, allowing that window's own DOM Escape handler to close it. The bundled MFC80U CWnd ShowWindow implementation (ordinal 6086) confirms the HWND member offset +0x20. Staged native checks verify the parent walk, foreign-window return, and relocated panel bridge. Browser checks cover local spectator Escape/close, unchanged panel state, automatic test startup, test-to-match updates, immediate break results, corrections without resetting the break and disconnect feedback. Physical native/TV behavior still requires checking after the new executable is applied by Start-English.cmd.

Native spectator close/focus commands (current)
----------------------------------------------
The legacy embedded browser did not reliably destroy the popup through JavaScript window.close(), and keyboard focus could remain on the panel. The updated shell registers HostCloseDisplay and HostFocusDisplay in addition to all existing bindings. It uses verified executable padding (the skipped old Alt branch plus unused .text bytes) and a registration trampoline; original bindings remain intact. HostCloseDisplay resolves the calling JS context's web view and HWND, rejects null handles and child/captioned panel windows, then posts WM_CLOSE asynchronously to that specific native window. HostFocusDisplay similarly rejects panel windows and calls SetForegroundWindow for the spectator; it is used on native display startup, reopening and mouse activation. The user32 module is already resident in this Windows GUI process.

The display now has an always-visible Close display button outside the scaled scoreboard, and the panel has Close spectator window. Escape (including legacy Esc/keyCode 27) and Alt+F4 route through the same native close operation when available; ordinary browsers retain window.close(). Preview frames cannot close their parent. A same-origin, channel-scoped acknowledgment clears the panel's popup reference so reopening creates a fresh display. The existing HWND-scoped native Escape guard remains in place.

Checks verify added bindings, restored registration flow, native caller-HWND/style/null guards, WM_CLOSE target, focus API resolution, JS command selection, legacy key variants, panel close requests and browser fallback. Browser regression closes/reopens the display from both buttons without altering match state. These checks cover the native code package and emulated native JS command routing; actual Windows focus/keyboard behavior should be checked after applying the new executable. Upstream native window-close behavior reference: https://github.com/weolar/miniblink49/blob/master/wke/wkeWebWindow.cpp (WM_CLOSE handler).

Competition technical scoring and tie hierarchy (current)
-------------------------------------------------------
Technical body +2 and Technical head +3 each add exactly one technical kick and the indicated points, with separate body/head technical counters and typed undo. They do not fabricate sensor-hit counts. Ordinary +/-2 and +/-3 manual controls are classified as body/head points respectively; +/-1 adjustments and gam-jeoms do not add head/body kick points. Scored body/head sensor hits also add their 2/3 points to those categories. Technical awards contribute to their corresponding head/body point total as well as the separate technical-kick count.

At tied time expiry, compare in order: technical_body + technical_head; head_points + body_points; weak_head + weak_body. The first unequal metric decides that round automatically by PTF, recording the deciding basis. If all equal, pending SUP is explicitly labelled SUP — Undecided. The configured break starts even for an unresolved final-round tie. It may finish while waiting for the agreed referee winner; the next round cannot start until that decision is recorded. Award Blue SUP/Award Red SUP enter that agreed result. Existing previous-round correction controls remain available. Normal match completion still ends the contest.

Competition weak registrations include both head and body messages strictly below their own threshold. They are attributed to the attacker (the opponent of the device wearer), matching scored hits. Equal-to-threshold messages score normally and never count as weak; paused/break/test-mode messages cannot increment competition counts. Each attacker has persistent per-round weak-head/weak-body totals, shown in the panel and as circle/head and square/body icons with counts above the spectator gam-jeom counter. Counters and categorized points reset with every new round, survive equipment navigation, and are restored with round undo. Transient weak meters are not replayed after navigation/undo.

Each weak message records raw impact, raw/40 level, the applicable threshold and arrival time. Both views show a dark-red-to-green meter with separate measured/threshold markers and numeric level. Its range uses 1.25 times the threshold (minimum 1) to keep low thresholds readable. It expires 1500 ms after the hit, rather than 1500 ms after a later heartbeat. A newer reading replaces the previous one and its expiry; old expiry callbacks cannot clear a replacement. Spectator snapshots carry only the relevant display statistics/reading and use no equipment IDs.

Checks: verify_competition_tiebreak.cjs drives actual timer/scoring paths for all hierarchy tiers, differing technical point weights, weak head/body attacker attribution, ties in the final configured round, technical undo and round reset/undo. Browser checks exercise technical awards/undo, both weak counters, marker labels, replacement extending visibility beyond the first hit's expiry, final expiry and explicit SUP votes during/after an automatic break. These are synthetic protocol tests, not physical sensor calibration.

Live leader lights, countdown precision and receiver loss (current)
-----------------------------------------------------------------
Both competition views always show green lead indicators, including pauses and breaks. Scores take precedence, followed by the configured technical-kick / kick-point / weak-hit tie hierarchy. A complete tie lights both indicators. Pauses retain the same leader calculation. Match time below 10 seconds uses SS:milliseconds (three digits); break time remains MM:SS. Competition alone uses a 50 ms elapsed-time timer; deterministic manual timer callbacks remain one-second steps for protocol tests. Frequent clock-only refreshes persist state at most once a second, except phase transitions. Weak impact meters now expire after 3000 ms, with replacement retaining the newest reading's deadline.

Receiver state is owned by MQTT connect/close/offline/error events. connection.js keeps the root online property, saved state and equipment status synchronized; the main menu previously read a root flag that was never updated. Duplicate offline events are idempotent for callbacks. Offline sends/subscriptions are suppressed, transport exceptions are handled, delayed device commands are cancelled, and lost connections pause play/breaks without clearing counters/time. Reconnect refreshes subscriptions/device queries but never resumes a match automatically. Controller callbacks are detached when navigating away, and the main menu clears stale mode callbacks.

The vendor native timer-1 routine separately queried the adapter/IP, appended a title suffix and called OnConnectEvent. Its status could conflict with the already-connected MQTT socket. This routine is now bypassed to its original cleanup/default handling, preserving the rest of the native timer handler. The redundant JS OnConnectEvent shim is a no-op. The native title remains the base app name with no offline or IP suffix. A Windows event record showed an application access violation at an unknown address; no usable native call stack was available, so the exact faulting instruction was not established. The redundant native polling path was removed and the JS recovery path hardened; physical modem disconnection was not performed in this session.

Checks cover live lead hierarchy, full ties, SS:milliseconds boundaries, menu status, three-second meter replacement/expiry, a throwing disconnected transport, reconnect without resume, stale callback cleanup, running/break pause and native polling/title anchors. Browser regression also checks both panel and spectator clocks update below ten seconds. Physical modem-loss behavior still needs verification after Start-English.cmd applies the rebuilt executable.


## Navigation and training displays

Home navigation now uses configuration already loaded at startup. Its former synchronous HostGetServerInfo/HostGetUserInfo calls could block every menu click; those redundant per-click calls are removed. Startup configuration and native licensing remain unchanged.

Competition retains its authoritative 50 ms elapsed-time clock, but publishes clock-only UI/transport updates at most every 100 ms. Both displays animate the clock with requestAnimationFrame between updates; the spectator extrapolates only briefly while receiving fresh running/break snapshots, never determines outcomes, and freezes on disconnect. Score/result/pause changes publish immediately. Spectator statistics/results are rebuilt only when non-clock content changes.

Winner announcements use Blue/Red. Both impact meters use a fixed 0–72 axis and only two integer labels above their markers (threshold line and measured circle), with a three-second lifetime.

Court Training and Free Training expose Open/Close spectator window controls. Training snapshots contain only names, scores, head/body hit totals, status and (for courts) the shared clock, or (for free training) the group total. They exclude equipment identifiers, penalties, series results and receiver credentials. Vue watches propagate names, resets, equipment-safe score changes and layout updates immediately; detach removes watchers and heartbeat ownership. The same borderless/close controls and fixed-stage scaling serve all modes. Training windows open on demand.
