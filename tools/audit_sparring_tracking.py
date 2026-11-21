"""Audit colour-free pose tracking around existing sparring marks."""

import csv
import itertools
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

from sparring_pose import HEIGHT, WIDTH, pose_frame

ROOT = Path("round-exports")
RATE = 8
PRE = 10
POST = 5


def assignments(previous, current):
    """Choose the lowest-cost one-to-one matching, allowing a track to go missing."""
    costs = {}
    for i, (last, speed, age) in enumerate(previous):
        for j, pose in enumerate(current):
            scale = max(last[1], pose[1])
            distance = np.linalg.norm(last[0] + speed * age - pose[0]) / scale
            change = abs(np.log(last[1] / pose[1]))
            if distance <= 0.85 and change <= 0.55:
                costs[i, j] = distance + 0.35 * change
    options = itertools.product(*[
        [None] + [j for j in range(len(current)) if (i, j) in costs]
        for i in range(len(previous))
    ])
    return min(
        (choice for choice in options
         if len({j for j in choice if j is not None}) == sum(j is not None for j in choice)),
        key=lambda choice: sum(0.95 if j is None else costs[i, j] for i, j in enumerate(choice)),
    )


def clip_frames(video, start):
    video.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    fps = video.get(cv2.CAP_PROP_FPS)
    origin = round(start * fps)
    cursor = origin
    for index in range(PRE + POST + 1):
        target = origin + round(index * fps / RATE)
        while cursor < target:
            if not video.grab():
                return
            cursor += 1
        ok, image = video.read()
        cursor += 1
        if not ok:
            return
        image = cv2.resize(image, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
        yield cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def chest(pose):
    return pose[0] + pose[2][:2].mean(axis=0) * pose[1] * 0.5


def torso_signature(gray, pose):
    x, y = chest(pose).round().astype(int)
    radius = max(3, round(pose[1] * 0.18))
    sample = gray[max(0, y - radius):min(HEIGHT, y + radius),
                  max(0, x - radius):min(WIDTH, x + radius)]
    if not sample.size:
        return None
    bins = np.histogram(sample, bins=8, range=(0, 256))[0]
    return bins / bins.sum()


def unique_matches(candidates):
    """Reject competing assignments instead of guessing an identity."""
    result = [None] * len(candidates)
    claimed = [j for row in candidates for j in row]
    for i, row in enumerate(candidates):
        if len(row) == 1 and claimed.count(row[0]) == 1:
            result[i] = row[0]
    return result


def seeded_tracks(path, start, seeds, model):
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=3,
    )
    video = cv2.VideoCapture(str(path))
    active = []
    frames = []
    try:
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            for index, rgb in enumerate(clip_frames(video, start)):
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                poses = pose_frame(detector.detect_for_video(image, index * 1000 // RATE))
                gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
                signatures = [torso_signature(gray, pose) for pose in poses]
                if index == 0:
                    candidates = [
                        [j for j, pose in enumerate(poses) if signatures[j] is not None
                         and np.linalg.norm(np.asarray(seed) * [WIDTH, HEIGHT] - chest(pose))
                         <= 0.45 * pose[1]]
                        for seed in seeds
                    ]
                    selected = unique_matches(candidates)
                    active = [None if j is None else (poses[j], signatures[j], poses[j][1])
                              for j in selected]
                else:
                    candidates = []
                    for track in active:
                        eligible = []
                        if track is not None:
                            last, anchor, initial_scale = track
                            for j, pose in enumerate(poses):
                                position_delta = np.linalg.norm(chest(last) - chest(pose))
                                if (signatures[j] is not None
                                    and position_delta <= 0.55 * last[1]
                                    and 0.7 <= pose[1] / last[1] <= 1.4
                                    and 0.6 <= pose[1] / initial_scale <= 1.67
                                    and np.abs(anchor - signatures[j]).sum() <= 0.8):
                                    eligible.append(j)
                        candidates.append(eligible)
                    selected = unique_matches(candidates)
                    # Once lost, an identity requires another user seed.
                    active = [None if j is None else (poses[j], track[1], track[2])
                              for track, j in zip(active, selected)]
                points = [None if j is None else (chest(poses[j]) / [WIDTH, HEIGHT]).tolist()
                          for j in selected]
                frames.append({"time": start + index / RATE, "points": points})
    finally:
        video.release()
    if not frames:
        raise ValueError("Could not decode a frame at the selected time.")
    return {"frames": frames}


def audit(video, time_ms, athlete, options):
    start = max(0, time_ms / 1000 - PRE / RATE)
    mark_index = round((time_ms / 1000 - start) * RATE)
    active = []
    observations = []
    detections = []
    seed_frame = None
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
        for index, rgb in enumerate(clip_frames(video, start)):
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = detector.detect_for_video(image, index * 1000 // RATE)
            poses = pose_frame(result)
            if seed_frame is None and len(poses) >= 2:
                # Prefer larger people near the centre of the frame for initialisation.
                indices = sorted(range(len(poses)), key=lambda j: poses[j][1] /
                                 (1 + abs(poses[j][0][0] - WIDTH / 2) / (WIDTH / 2)),
                                 reverse=True)[:2]
                active = [(poses[j], np.zeros(2), index) for j in indices]
                seed_frame = index
            elif seed_frame is not None:
                candidates = [(last, speed, index - seen) for last, speed, seen in active]
                eligible = [i for i, (_, _, age) in enumerate(candidates) if age <= 3]
                indices = [None, None]
                matches = assignments([candidates[i] for i in eligible], poses)
                for i, j in zip(eligible, matches):
                    if j is not None:
                        before, speed, age = candidates[i]
                        velocity = (poses[j][0] - before[0]) / age
                        active[i] = poses[j], 0.5 * (speed + velocity), index
                        indices[i] = j
            else:
                indices = [None, None]
            # Colour is read only after the choices above, for auditing identities.
            reference = [tag if confidence >= 0.25 else None
                         for _, _, _, _, tag, confidence in pose_frame(result, rgb)]
            detections.append([j is not None for j in indices])
            observations.append([reference[j] if j is not None else None for j in indices])
    if len(observations) <= mark_index:
        return "mark_not_decoded", 0, 0
    if seed_frame is None or mark_index <= seed_frame:
        return "two_poses_unavailable_before_mark", 0, 0
    anchor = observations[seed_frame]
    if set(anchor) != {"A", "B"}:
        return "seed_unverified", 0, 0
    track = anchor.index(athlete)
    identity = observations[mark_index][track]
    checked = sum(tag is not None for row in observations[seed_frame:]
                  for tag in row)
    wrong = sum(tag is not None and tag != anchor[i]
                for row in observations[seed_frame:] for i, tag in enumerate(row))
    if not detections[mark_index][track]:
        outcome = "track_missing_at_mark"
    elif identity == athlete:
        outcome = "verified_at_mark"
    elif identity is None:
        outcome = "unverified_at_mark"
    else:
        outcome = "wrong_at_mark"
    return outcome, checked, wrong


def main():
    from collections import Counter

    cv2.setNumThreads(1)
    with (ROOT / "sparring-labels.csv").open(encoding="utf-8-sig", newline="") as file:
        labels = list(csv.DictReader(file))
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(
            ROOT / "pose-model" / "pose_landmarker_lite.task")),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=3,
    )
    clips = {}
    results = []
    try:
        for row in labels:
            name = row["clip"]
            if name not in clips:
                for opened in clips.values():
                    opened.release()
                clips.clear()
                clips[name] = cv2.VideoCapture(str(ROOT / name), cv2.CAP_FFMPEG,
                                               [cv2.CAP_PROP_N_THREADS, 2])
                if not clips[name].isOpened():
                    raise OSError(f"Could not open {name}")
                print(f"Checking {name}", flush=True)
            outcome, checked, wrong = audit(clips[name], int(row["time_ms"]), row["athlete_id"], options)
            results.append(dict(row, outcome=outcome, checked_frame_slots=checked, wrong_frame_slots=wrong))
    finally:
        for opened in clips.values():
            opened.release()
    report = {"outcomes": dict(Counter(row["outcome"] for row in results)),
              "checked_frame_slots": sum(row["checked_frame_slots"] for row in results),
              "wrong_frame_slots": sum(row["wrong_frame_slots"] for row in results),
              "reference": "High-saturation red/blue torso check, audit only; uncertain frames are unverified.",
              "marks": results}
    destination = ROOT / "athlete-pose" / "tracking-audit.json"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "marks"}, indent=2))


if __name__ == "__main__":
    main()
