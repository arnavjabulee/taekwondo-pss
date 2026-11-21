"""Check for a sustained hip turn before a kick candidate on one athlete track."""

import argparse
import json
import math
from pathlib import Path
from statistics import median

LOOKBACK_MS = 650
MAX_GAP_MS = 100
MAX_FRAME_INTERVAL_MS = 75
MIN_TURN_DURATION_MS = 130
MIN_LEAD_MS = 40
MIN_TURN_DEGREES = 70.0
MIN_DIRECTION_CONSISTENCY = 0.78


def axial_step(before, after):
    """Treat a swap of the left and right hip labels as the same axis."""
    return (after - before + 90) % 180 - 90


def find_turn(times, angles, kick_time_ms):
    # Median over three positions to reject isolated landmark jumps.
    smooth = [median(angles[max(0, i - 1):i + 2]) for i in range(len(angles))]
    best = None
    for start in range(len(smooth) - 3):
        travelled = 0.0
        for stop in range(start + 1, len(smooth)):
            step = abs(smooth[stop] - smooth[stop - 1])
            elapsed = times[stop] - times[stop - 1]
            if step > elapsed * 1.1:
                break
            travelled += step
            net = abs(smooth[stop] - smooth[start])
            duration = times[stop] - times[start]
            if (stop - start < 3 or duration < MIN_TURN_DURATION_MS
                    or times[stop] > kick_time_ms - MIN_LEAD_MS or net < MIN_TURN_DEGREES):
                continue
            if net / travelled < MIN_DIRECTION_CONSISTENCY:
                continue
            if best is None or net > best["rotation_degrees"]:
                best = {"start_ms": times[start], "end_ms": times[stop],
                        "rotation_degrees": round(net, 1),
                        "direction_consistency": round(net / travelled, 2)}
    return best


def read_turn(series, kick_time_ms):
    """Score (time in ms, yaw in degrees or None) from a single athlete track."""
    start = kick_time_ms - LOOKBACK_MS
    window = [(t, angle) for t, angle in series if start <= t <= kick_time_ms]
    known = [(t, angle) for t, angle in window if angle is not None and math.isfinite(angle)]
    coverage = len(known) / max(1, len(window))
    summary = {"readable_samples": len(known), "sample_count": len(window),
               "coverage": round(coverage, 2)}
    if len(window) < 2 or median(right[0] - left[0] for left, right in zip(window, window[1:])) > MAX_FRAME_INTERVAL_MS:
        return {**summary, "decision": "unreadable", "reason": "low_sampling_rate"}
    if coverage < .65 or len(known) < 5:
        return {**summary, "decision": "unreadable", "reason": "too_few_readable_hips"}
    if (known[0][0] - start > MAX_GAP_MS or kick_time_ms - known[-1][0] > MAX_GAP_MS
            or any(right[0] - left[0] > MAX_GAP_MS for left, right in zip(known, known[1:]))):
        return {**summary, "decision": "unreadable", "reason": "gap_in_hip_track"}

    times, raw = zip(*known)
    angles = [0.0]
    for old, new in zip(raw, raw[1:]):
        angles.append(angles[-1] + axial_step(old, new))
    turn = find_turn(times, angles, kick_time_ms)
    if turn is not None:
        return {**summary, "decision": "spin_evidence", **turn}
    span = max(angles) - min(angles)
    decision = "ambiguous_turn" if span >= MIN_TURN_DEGREES else "no_clear_turn"
    return {**summary, "decision": decision, "observed_span_degrees": round(span, 1)}


def track_series(samples, track):
    for sample in samples:
        person = next((row for row in sample["people"] if row["track"] == track), None)
        pose = person["crop"] if person is not None else None
        readable = pose is not None and pose.get("hip_ready", pose.get("ready", False))
        yield sample["time_ms"], pose["hip_angle"] if readable else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("observations", type=Path, help="Per-frame crop pose observations")
    parser.add_argument("candidates", type=Path, help="List of objects with track and time_ms")
    args = parser.parse_args()
    observations = json.loads(args.observations.read_text(encoding="utf-8-sig"))
    candidates = json.loads(args.candidates.read_text(encoding="utf-8-sig"))
    decisions = [{**row, **read_turn(track_series(observations["samples"], row["track"]), row["time_ms"])}
                 for row in candidates]
    print(json.dumps(decisions, indent=2))


if __name__ == "__main__":
    main()
