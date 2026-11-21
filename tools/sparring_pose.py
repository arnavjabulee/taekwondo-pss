"""Evaluate a MediaPipe pose baseline on a held-out sparring broadcast."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import cv2
import numpy as np

from sparring_baseline import (
    ACTIONS, OFFSETS, RATE, THRESHOLD, detect, evaluate, find_ffmpeg, fit, read_dataset,
)

WIDTH, HEIGHT = 512, 288
JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
TORSO = [0, 1, 6, 7]
ATHLETES = ("A", "B")


def chest_colour(frame, torso):
    shoulders = torso[:2].mean(axis=0)
    hips = torso[2:].mean(axis=0)
    center = shoulders * 0.55 + hips * 0.45
    width = max(3, int(np.linalg.norm(torso[0] - torso[1]) * 0.25))
    height = max(3, int(np.linalg.norm(shoulders - hips) * 0.22))
    x, y = center.astype(int)
    crop = frame[max(0, y-height):min(HEIGHT, y+height), max(0, x-width):min(WIDTH, x+width)]
    if not crop.size or not (0 <= x < WIDTH and 0 <= y < HEIGHT):
        return None, 0.0
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    hue, saturation, value = np.moveaxis(hsv, -1, 0)
    vivid = (saturation >= 85) & (value >= 50)
    red = float(np.mean(vivid & ((hue <= 12) | (hue >= 165))))
    blue = float(np.mean(vivid & (hue >= 93) & (hue <= 135)))
    confidence = max(red, blue)
    if confidence < 0.16 or abs(red - blue) < 0.12:
        return None, 0.0
    return ("A" if red > blue else "B"), confidence


def pose_frame(result, frame=None):
    poses = []
    for landmarks in result.pose_landmarks:
        points = np.asarray([[landmarks[i].x * WIDTH, landmarks[i].y * HEIGHT,
                              landmarks[i].visibility] for i in JOINTS], dtype=np.float32)
        if np.min(points[TORSO, 2]) < 0.45:
            continue
        hips = points[[6, 7], :2].mean(axis=0)
        shoulders = points[[0, 1], :2].mean(axis=0)
        scale = float(np.linalg.norm(shoulders - hips))
        if scale < 8:
            continue
        athlete, confidence = chest_colour(frame, points[TORSO, :2]) if frame is not None else (None, 0.0)
        poses.append((hips, scale, (points[:, :2] - hips) / scale, points[:, 2] >= 0.5,
                      athlete, confidence))
    return poses


def motion(previous, current, per_athlete=False):
    # Match nearby body centres across adjacent frames before measuring joint speed.
    matches = sorted((float(np.linalg.norm(a[0] - b[0])) / max(a[1], b[1]), i, j)
                     for i, a in enumerate(previous) for j, b in enumerate(current))
    used_before, used_after = set(), set()
    velocities = []
    by_athlete = {}
    for distance, i, j in matches:
        a, b = previous[i], current[j]
        if distance > 1 or i in used_before or j in used_after or not 0.6 <= a[1] / b[1] <= 1.67:
            continue
        if per_athlete and a[4] and b[4] and a[4] != b[4]:
            continue
        used_before.add(i)
        used_after.add(j)
        visible = a[3] & b[3]
        speed = np.minimum(np.linalg.norm(a[2] - b[2], axis=1), 2.0)
        velocity = np.where(visible, speed, 0)
        velocities.append(velocity)
        identity = b[4] or a[4]
        confidence = a[5] + b[5]
        if identity and confidence > by_athlete.get(identity, (0, None))[0]:
            by_athlete[identity] = (confidence, velocity)
    if per_athlete:
        return np.array([
            np.r_[by_athlete[athlete][1], 1] if athlete in by_athlete else np.zeros(len(JOINTS) + 1)
            for athlete in ATHLETES
        ])
    # Symmetric pooling keeps the feature compatible with clips of either athlete.
    pooled = np.max(velocities, axis=0) if velocities else np.zeros(len(JOINTS))
    return np.concatenate([pooled, [bool(velocities)]])


def extract_pose(video, ffmpeg, model, cache, per_athlete=False):
    stat = video.stat()
    identity = f"{video.resolve()}:{stat.st_size}:{stat.st_mtime_ns}:{model.stat().st_mtime_ns}:pose-v1"
    if per_athlete:
        identity += ":athlete-v1"
    path = cache / (hashlib.sha256(identity.encode()).hexdigest() + ".npy")
    if path.exists():
        return np.load(path, allow_pickle=False)

    import mediapipe as mp

    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=3,
    )
    command = [
        ffmpeg, "-nostdin", "-v", "error", "-threads", "2", "-i", str(video),
        "-an", "-vf", f"fps={RATE},scale={WIDTH}:{HEIGHT}", "-f", "rawvideo",
        "-pix_fmt", "rgb24", "-threads", "1", "pipe:1",
    ]
    size = WIDTH * HEIGHT * 3
    frames = []
    previous = []
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
        with subprocess.Popen(command, stdout=subprocess.PIPE) as process:
            while data := process.stdout.read(size):
                if len(data) != size:
                    raise ValueError(f"Truncated frame in {video}")
                array = np.frombuffer(data, np.uint8).reshape(HEIGHT, WIDTH, 3)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=array)
                result = landmarker.detect_for_video(image, len(frames) * 1000 // RATE)
                current = pose_frame(result, array if per_athlete else None)
                frames.append(motion(previous, current, per_athlete))
                previous = current
            if process.wait() or not frames:
                raise ValueError(f"Could not decode {video}")
    frames = np.asarray(frames, dtype=np.float32)
    indices = np.arange(len(frames))
    features = np.concatenate([frames[np.clip(indices + offset, 0, len(frames) - 1)]
                               for offset in OFFSETS], axis=-1)
    if per_athlete:
        features = features.transpose(1, 0, 2)
    np.save(path, features, allow_pickle=False)
    print(f"{video.parent.name}/{video.name}: usable adjacent poses in "
          f"{frames[..., -1].mean():.0%} of frame slots", file=sys.stderr, flush=True)
    return features


def identified_window(features):
    return np.sum(features[:, len(JOINTS)::len(JOINTS) + 1], axis=1) >= 3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg")
    parser.add_argument("--pose-model", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("round-exports/pose-baseline"))
    parser.add_argument("--per-athlete", action="store_true",
                        help="Associate red with A and blue with B and model each athlete separately")
    sub = parser.add_subparsers(dest="command", required=True)
    train = sub.add_parser("train")
    train.add_argument("root", type=Path)
    train.add_argument("labels", type=Path)
    train.add_argument("--holdout", default="118-navarro-hyttel")
    train.add_argument("--all-folds", action="store_true",
                       help="Also evaluate the other source videos as separate holdouts")
    train.add_argument("--workers", type=int, default=3)
    predict = sub.add_parser("predict")
    predict.add_argument("video", type=Path)
    args = parser.parse_args()
    if args.per_athlete and args.output == Path("round-exports/pose-baseline"):
        args.output = Path("round-exports/athlete-pose")
    ffmpeg = args.ffmpeg or find_ffmpeg()
    if not ffmpeg or not args.pose_model.is_file():
        parser.error("FFmpeg and a MediaPipe pose model file are required")
    cv2.setNumThreads(1)
    cache = args.output / "features"
    cache.mkdir(parents=True, exist_ok=True)
    extract = partial(extract_pose, model=args.pose_model, cache=cache, per_athlete=args.per_athlete)
    validity = identified_window if args.per_athlete else None
    artifact = args.output / "model.npz"
    if args.command == "predict":
        with np.load(artifact, allow_pickle=False) as data:
            model = tuple(data[key] for key in ("center", "spread", "weights"))
        features = extract(args.video, ffmpeg)
        tracks = zip(ATHLETES, features) if args.per_athlete else [(None, features)]
        events = [{"time_ms": round(t * 1000), "action": ACTIONS[a], "confidence": round(s, 3),
                   **({"athlete_id": athlete} if athlete else {})}
                  for athlete, track in tracks for t, a, s in detect(track, model, validity)]
        print(json.dumps(sorted(events, key=lambda event: event["time_ms"]), indent=2))
        return
    videos = []
    for manifest in sorted(args.root.glob("*/rounds.json")):
        source = json.loads(manifest.read_text(encoding="utf-8-sig"))
        videos.extend(manifest.parent / item["clip"] for item in source["rounds"]
                      if not item.get("exclude_from_training"))
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(partial(extract, ffmpeg=ffmpeg), videos))
    dataset = read_dataset(args.root, args.labels, ffmpeg, extract, ATHLETES if args.per_athlete else ())
    if args.holdout not in {row[0] for row in dataset}:
        parser.error(f"Unknown held-out source: {args.holdout}")
    folds = evaluate(dataset, held_out=None if args.all_folds else {args.holdout}, validity=validity)
    model = fit([row for row in dataset if row[0] != args.holdout], validity)
    np.savez(artifact, center=model[0], spread=model[1], weights=model[2])
    report = {"feature_type": "athlete_pose" if args.per_athlete else "pose_motion",
              "sample_rate": RATE, "threshold": THRESHOLD,
              "match_tolerance_s": 0.6, "clips": len(videos),
              "saved_model_holdout": args.holdout, "folds": folds}
    if args.per_athlete:
        report["marks_with_usable_pose"] = sum(
            int(identified_window(features)[min(round(time * RATE), len(features) - 1)])
            for _, _, features, marks, _ in dataset for time, _ in marks
        )
        report["total_marks"] = sum(len(marks) for _, _, _, marks, _ in dataset)
    (args.output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
