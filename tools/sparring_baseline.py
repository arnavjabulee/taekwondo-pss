"""Train and run a small motion baseline on timestamped sparring clips."""

import argparse
import csv
import json
import os
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

RATE = 8
WIDTH, HEIGHT = 160, 90
OFFSETS = (-5, -3, -1, 1, 3)
ACTIONS = ("background", "punch_attempt", "spinning_kick_attempt")
THRESHOLD = 0.60


def find_ffmpeg():
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    local = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "AppData" / "Local"
    bundled = sorted((local / "Overwolf" / "Extensions").glob("*/**/obs/bin/64bit/ffmpeg.exe"))
    if bundled:
        return str(bundled[-1])
    return None


def motion_features(video, ffmpeg):
    command = [
        ffmpeg, "-nostdin", "-v", "error", "-threads", "2", "-i", str(video),
        "-an", "-vf", f"fps={RATE},scale={WIDTH}:{HEIGHT}", "-pix_fmt", "gray",
        "-f", "rawvideo", "-threads", "1", "pipe:1",
    ]
    cells = []
    previous = None
    with subprocess.Popen(command, stdout=subprocess.PIPE) as process:
        while data := process.stdout.read(WIDTH * HEIGHT):
            if len(data) != WIDTH * HEIGHT:
                raise ValueError(f"Truncated decoded frame in {video}")
            frame = np.frombuffer(data, np.uint8).reshape(HEIGHT, WIDTH)
            # Keep the main court region to reduce the influence of score graphics.
            court = frame[17:77, 14:146]
            if previous is None:
                cells.append(np.zeros(24))
            else:
                difference = cv2.absdiff(previous, court)
                level = np.mean(difference)
                # Suppress the spikes caused by hard broadcast cuts.
                difference = np.zeros_like(difference) if level > 34 else difference
                magnitude = np.clip(difference.astype(np.float32) - 8, 0, 72) / 72
                grid = cv2.resize(magnitude, (6, 4), interpolation=cv2.INTER_AREA)
                cells.append(grid.ravel())
            previous = court
        if process.wait():
            raise RuntimeError(f"Video decode failed for {video}")
    if not cells:
        raise ValueError(f"No decoded frames in {video}")
    motion = np.asarray(cells)
    indices = np.arange(len(motion))
    return np.concatenate([motion[np.clip(indices + offset, 0, len(motion) - 1)]
                           for offset in OFFSETS], axis=1)


def read_dataset(root, labels, ffmpeg, extract=motion_features, athletes=()):
    with labels.open(newline="", encoding="utf-8-sig") as file:
        annotations = list(csv.DictReader(file))
    dataset = []
    for manifest in sorted(root.glob("*/rounds.json")):
        source = json.loads(manifest.read_text(encoding="utf-8-sig"))
        for item in source["rounds"]:
            if item.get("exclude_from_training"):
                continue
            path = manifest.parent / item["clip"]
            clip = path.relative_to(root).as_posix()
            marks = [(int(row["time_ms"]) / 1000, ACTIONS.index(row["action"]))
                     for row in annotations if row["clip"] == clip]
            source_offset = item["start_s"]
            gaps = [(gap["start_s"] - source_offset, gap["end_s"] - source_offset)
                    for gap in item["review_gaps"]]
            print(f"Reading {clip} ({len(marks)} marks)", flush=True)
            features = extract(path, ffmpeg)
            if athletes:
                for index, athlete in enumerate(athletes):
                    athlete_marks = [
                        (int(row["time_ms"]) / 1000, ACTIONS.index(row["action"]))
                        for row in annotations if row["clip"] == clip and row["athlete_id"] == athlete
                    ]
                    dataset.append((manifest.parent.name, clip, features[index], athlete_marks, gaps))
            else:
                dataset.append((manifest.parent.name, clip, features, marks, gaps))
    known_clips = {clip for _, clip, *_ in dataset}
    if any(row["clip"] not in known_clips for row in annotations):
        raise ValueError("Labels reference a missing or excluded clip")
    return dataset


def fit(dataset, validity=None):
    inputs, targets = [], []
    random = np.random.default_rng(42)
    for _, _, features, marks, gaps in dataset:
        usable = validity(features) if validity else np.ones(len(features), dtype=bool)
        for seconds, action in marks:
            index = round(seconds * RATE)
            for offset in (-1, 0, 1):
                at = np.clip(index + offset, 0, len(features) - 1)
                if not usable[at]:
                    continue
                inputs.append(features[at])
                targets.append(action)
        seconds = np.arange(0, len(features), RATE) / RATE
        available = [int(t * RATE) for t in seconds if t >= 1 and usable[int(t * RATE)] and
                     all(abs(t - mark) > 1.25 for mark, _ in marks) and
                     all(not start <= t <= end for start, end in gaps)]
        count = min(len(available), max(18, 5 * len(marks)))
        for index in random.choice(available, count, replace=False):
            inputs.append(features[index])
            targets.append(0)

    x = np.array(inputs)
    y = np.array(targets)
    if len(set(y)) != len(ACTIONS):
        raise ValueError("Training split must have examples of all three classes")
    center = x.mean(axis=0)
    spread = np.maximum(x.std(axis=0), 0.02)
    x = np.column_stack(((x - center) / spread, np.ones(len(x))))
    # L2-regularized multinomial logistic regression with equal class weights.
    truth = np.eye(len(ACTIONS))[y]
    example_weights = (len(y) / (len(ACTIONS) * np.bincount(y)))[y, None]
    weights = np.zeros((x.shape[1], len(ACTIONS)))
    for _ in range(300):
        difference = (probabilities(x @ weights) - truth) * example_weights
        gradient = x.T @ difference / len(x)
        gradient[:-1] += 0.04 * weights[:-1]
        weights -= 0.05 * gradient
    return center, spread, weights


def probabilities(logits):
    exponent = np.exp(logits - logits.max(axis=1, keepdims=True))
    return exponent / exponent.sum(axis=1, keepdims=True)


def detect(features, model, validity=None):
    center, spread, weights = model
    x = np.column_stack(((features - center) / spread, np.ones(len(features))))
    scores = probabilities(x @ weights)
    classes = scores.argmax(axis=1)
    usable = validity(features) if validity else np.ones(len(features), dtype=bool)
    events = []
    for action in range(1, len(ACTIONS)):
        candidates = np.flatnonzero(usable & (classes == action) & (scores[:, action] >= THRESHOLD))
        accepted = []
        for index in sorted(candidates, key=lambda index: scores[index, action], reverse=True):
            if all(abs(index - other) >= RATE for other in accepted):
                accepted.append(index)
                events.append((index / RATE, action, float(scores[index, action])))
    return sorted(events)


def evaluate(dataset, held_out=None, validity=None):
    results = []
    groups = {group for group, *_ in dataset}
    if held_out is not None and not held_out <= groups:
        raise ValueError(f"Unknown held-out sources: {sorted(held_out - groups)}")
    for group in sorted(groups if held_out is None else held_out):
        model = fit([row for row in dataset if row[0] != group], validity)
        counts = {name: dict(tp=0, fp=0, fn=0) for name in ACTIONS[1:]}
        for source, _, features, marks, gaps in dataset:
            if source != group:
                continue
            unmatched = list(marks)
            for seconds, action, _ in detect(features, model, validity):
                candidates = [(abs(seconds - time), index)
                              for index, (time, kind) in enumerate(unmatched)
                              if kind == action and abs(seconds - time) <= 0.6]
                if candidates:
                    counts[ACTIONS[action]]["tp"] += 1
                    unmatched.pop(min(candidates)[1])
                elif all(not start <= seconds <= end for start, end in gaps):
                    counts[ACTIONS[action]]["fp"] += 1
            for _, action in unmatched:
                counts[ACTIONS[action]]["fn"] += 1
        results.append({"held_out_source": group, "counts": counts})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", help="Path to the FFmpeg executable")
    modes = parser.add_subparsers(dest="mode", required=True)
    train = modes.add_parser("train")
    train.add_argument("root", type=Path)
    train.add_argument("labels", type=Path)
    train.add_argument("output", type=Path)
    predict = modes.add_parser("predict")
    predict.add_argument("model", type=Path)
    predict.add_argument("video", type=Path)
    args = parser.parse_args()
    args.ffmpeg = args.ffmpeg or find_ffmpeg()
    if not args.ffmpeg:
        parser.error("FFmpeg was not found. Supply its path with --ffmpeg.")
    if args.mode == "train":
        cv2.setNumThreads(1)
        dataset = read_dataset(args.root, args.labels, args.ffmpeg)
        results = evaluate(dataset)
        model = fit(dataset)
        args.output.mkdir(exist_ok=True, parents=True)
        np.savez(args.output / "model.npz", center=model[0], spread=model[1], weights=model[2])
        report = {"sample_rate": RATE, "threshold": THRESHOLD, "match_tolerance_s": 0.6,
                  "clips": len(dataset), "folds": results}
        (args.output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
    else:
        with np.load(args.model) as artifact:
            model = tuple(artifact[key] for key in ("center", "spread", "weights"))
        events = detect(motion_features(args.video, args.ffmpeg), model)
        print(json.dumps([{"time_ms": round(t * 1000), "action": ACTIONS[a], "confidence": round(s, 3)}
                          for t, a, s in events], indent=2))


if __name__ == "__main__":
    main()
