"""Audit a torso-rotation cue on six human-adjudicated exchanges."""

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

from sparring_pose import HEIGHT, WIDTH, chest_colour

JOINTS = (11, 12, 23, 24)
INTERVAL_MS = 500
MIN_COVERAGE = 0.60
MIN_TURN_DEGREES = 35
MIN_ORDER_MARGIN_DEGREES = 15


def torso_yaw(rgb, result, athlete, hips_only=False):
    candidates = []
    usable_torsos = 0
    for image_pose, world_pose in zip(result.pose_landmarks, result.pose_world_landmarks):
        if min(image_pose[i].visibility for i in ((23, 24) if hips_only else JOINTS)) < 0.55:
            continue
        torso = np.array([(image_pose[i].x * WIDTH, image_pose[i].y * HEIGHT) for i in JOINTS])
        left = np.array([(world_pose[i].x, world_pose[i].z) for i in (11, 23)])
        right = np.array([(world_pose[i].x, world_pose[i].z) for i in (12, 24)])
        axes = right - left
        if hips_only:
            axes = axes[1:]
        length = np.linalg.norm(axes, axis=1)
        if length.min() < 0.08:
            continue
        average = (axes / length[:, None]).mean(axis=0)
        if np.linalg.norm(average) < 0.65:
            continue
        usable_torsos += 1
        identity, _ = chest_colour(rgb, torso)
        if identity == athlete:
            candidates.append(float(np.arctan2(average[1], average[0])))
    return (candidates[0] if len(candidates) == 1 else None), usable_torsos


def scan(path, options, athlete, hips_only=False):
    video = cv2.VideoCapture(str(path))
    frames = []
    try:
        fps = video.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            raise ValueError(f"Could not open {path}")
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            while True:
                ok, frame = video.read()
                if not ok:
                    break
                timestamp = round(len(frames) * 1000 / fps)
                frame = cv2.resize(frame, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = detector.detect_for_video(image, timestamp)
                yaw, torsos = torso_yaw(rgb, result, athlete, hips_only)
                frames.append((timestamp, yaw, torsos))
    finally:
        video.release()
    return frames


def interval(frames, start, end):
    region = [(t, yaw, torsos) for t, yaw, torsos in frames if start <= t <= end]
    known = [(t, yaw) for t, yaw, _ in region if yaw is not None]
    coverage = len(known) / max(1, len(region))
    two_torsos = round(sum(torsos >= 2 for _, _, torsos in region) / max(1, len(region)), 2)
    if (coverage < MIN_COVERAGE or len(known) < 4 or known[0][0] - start > 120
            or end - known[-1][0] > 120
            or any(right[0] - left[0] > 120 for left, right in zip(known, known[1:]))):
        return {"coverage": round(coverage, 2), "two_torso_coverage": two_torsos,
                "rotation_degrees": None}

    _, angles = zip(*known)
    unwrapped = np.unwrap(angles)
    # Median-filter isolated 3D landmark jumps before looking for a sustained turn.
    median = np.array([np.median(unwrapped[max(0, i-1):i+2]) for i in range(len(unwrapped))])
    rotation = float(np.degrees(np.max(median) - np.min(median)))
    return {"coverage": round(coverage, 2), "two_torso_coverage": two_torsos,
            "rotation_degrees": round(rotation, 1)}


def decide(before, after):
    pre, post = before["rotation_degrees"], after["rotation_degrees"]
    if pre is None or post is None:
        return "insufficient_pose"
    if max(pre, post) < MIN_TURN_DEGREES:
        return "no_clear_turn"
    if abs(pre - post) < MIN_ORDER_MARGIN_DEGREES:
        return "ambiguous_order"
    return "turn_then_kick" if pre > post else "kick_then_turn"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("round-exports"))
    parser.add_argument("--hips-only", action="store_true")
    args = parser.parse_args()
    cv2.setNumThreads(1)
    folder = args.root / "kick-comparison" / "human-check"
    labels = json.loads((folder / "cases.json").read_text(encoding="utf-8-sig"))
    anchor = labels["anchor_in_export_ms"]
    model = args.root / "pose-model" / "pose_landmarker_lite.task"
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=3,
    )
    results = []
    for case in labels["cases"]:
        name = case["id"]
        expected = ("turn_then_kick" if case["human_verdict"]["is_spin"] else
                    "kick_then_turn" if case["human_verdict"]["label"] == "kick_then_spin"
                    else "no_clear_turn")
        athlete = "A" if case["athlete"] == "red" else "B"
        frames = scan(folder / f"{name}.mp4", options, athlete, args.hips_only)
        before = interval(frames, anchor - INTERVAL_MS, anchor)
        after = interval(frames, anchor, anchor + INTERVAL_MS)
        results.append({"clip": name, "expected": expected, "estimated": decide(before, after),
                        "human_turn_start_ms": case.get("turn_start", {}).get("approximate_clip_ms"),
                        "before": before, "after": after,
                        "yaw_by_frame": [{"time_ms": t, "degrees": round(float(np.degrees(yaw)), 1)
                                          if yaw is not None else None, "usable_torsos": torsos}
                                         for t, yaw, torsos in frames]})
    report = {"kick_anchor_ms": anchor, "interval_ms_per_side": INTERVAL_MS,
              "landmark_axis": "hips" if args.hips_only else "hips and shoulders",
              "identity_method": "Protector colour used only to select the instructed athlete.",
              "correct": sum(item["expected"] == item["estimated"] for item in results),
              "cases": results}
    filename = "hip-phase-audit.json" if args.hips_only else "phase-audit.json"
    (folder / filename).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([{k: v for k, v in row.items() if k != "yaw_by_frame"}
                      for row in results], indent=2))


if __name__ == "__main__":
    main()
