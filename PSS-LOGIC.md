# Several protectors through one receiver

## English copy: court assignment update

The English copy now uses explicit court assignments instead of the original ID-parity pairing documented below. On Athletes, select a court (1–16) for each athlete. Each court accepts at most two athletes. In roster order, the first athlete on a court is blue and the second red; colours are visible on Athletes. Unassigned athletes are excluded. Train builds fresh court slots from these saved selections and opens a suitable layout. Start remains a separate action.

Hit routing now matches each assigned helmet or body ID directly to its court and side, then awards points to the opponent. ID parity no longer forces the side. Duplicate device assignments are rejected. Scoring values and thresholds remain unchanged. Hardware operation remains unverified.

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
