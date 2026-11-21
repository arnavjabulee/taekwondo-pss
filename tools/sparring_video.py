"""Evaluate pretrained video features for timestamped sparring attempts."""

import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
import torch
from torch import nn
from torchvision.models.video import r3d_18

from sparring_baseline import ACTIONS, find_ffmpeg, probabilities

RATE = 8
WIDTH, HEIGHT = 112, 64
WINDOW = np.arange(-10, 6)
STRIDE = 4
THRESHOLD = 0.60
TOLERANCE_S = 0.60


def rounds(root, labels):
    with labels.open(encoding="utf-8-sig", newline="") as file:
        annotations = list(csv.DictReader(file))
    result = []
    for manifest in sorted(root.glob("*/rounds.json")):
        data = json.loads(manifest.read_text(encoding="utf-8-sig"))
        for row in data["rounds"]:
            if row.get("exclude_from_training"):
                continue
            video = manifest.parent / row["clip"]
            name = video.relative_to(root).as_posix()
            marks = [(int(label["time_ms"]) / 1000, ACTIONS.index(label["action"]))
                     for label in annotations if label["clip"] == name]
            origin = row["start_s"]
            gaps = [(gap["start_s"] - origin, gap["end_s"] - origin)
                    for gap in row["review_gaps"]]
            result.append((video, marks, gaps))
    return result


def decode(video, ffmpeg, rate=RATE, court_crop=False, court_box=None, person_crop=False):
    width, height = (320, 180) if person_crop else (144, 96) if court_crop else (WIDTH, HEIGHT)
    filters = f"fps={rate}"
    if court_crop or person_crop:
        # Keep both competitors without needing identity tracks. Mask graphic
        # regions in source coordinates so the crop retains the lower limbs.
        x, y, w, h = court_box or (.10, .055, .80, .89)
        filters += (",drawbox=x=0:y=0:w=iw*.25:h=ih*.19:color=gray:t=fill"
                    ",drawbox=x=iw*.455:y=ih*.81:w=iw*.09:h=ih*.19:color=gray:t=fill")
        if court_crop:
            filters += f",crop=iw*{w}:ih*{h}:iw*{x}:ih*{y}"
    filters += f",scale={width}:{height}"
    command = [ffmpeg, "-nostdin", "-v", "error", "-threads", "2", "-i", str(video),
               "-vf", filters, "-an", "-pix_fmt", "rgb24",
               "-f", "rawvideo", "-threads", "1", "pipe:1"]
    raw = subprocess.check_output(command)
    if not raw:
        raise ValueError(f"No decoded frames in {video}")
    frames = np.frombuffer(raw, np.uint8).reshape(-1, height, width, 3).copy()
    # Mask fixed broadcast graphic regions identically for every source.
    if not (court_crop or person_crop):
        frames[:, :12, :30] = [110, 107, 101]
        frames[:, 53:, :] = [110, 107, 101]
    return frames


class Encoder:
    def __init__(self, weights, cache):
        self.cache = cache
        cache.mkdir(exist_ok=True, parents=True)
        self.identity = hashlib.sha256(weights.read_bytes()).hexdigest()
        self.model = r3d_18(weights=None)
        self.model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
        self.model.fc = nn.Identity()
        self.model.to(memory_format=torch.channels_last_3d)
        self.model.eval()
        self.mean = torch.tensor([0.43216, 0.394666, 0.37645]).view(1, 3, 1, 1, 1)
        self.std = torch.tensor([0.22803, 0.22145, 0.216989]).view(1, 3, 1, 1, 1)

    def features(self, video, frames, centers):
        stat = video.stat()
        key = f"{video.resolve()}:{stat.st_mtime_ns}:{stat.st_size}:{self.identity}:v1"
        digest = hashlib.sha256(key.encode() + np.asarray(centers, dtype="<i8").tobytes()).hexdigest()
        cache = self.cache / (digest + ".npy")
        if cache.is_file():
            return np.load(cache, allow_pickle=False)
        extracted = []
        with torch.inference_mode():
            for start in range(0, len(centers), 8):
                indices = np.clip(centers[start:start + 8, None] + WINDOW, 0, len(frames) - 1)
                batch = torch.from_numpy(frames[indices]).permute(0, 4, 1, 2, 3).float().div_(255)
                normalised = ((batch - self.mean) / self.std).contiguous(memory_format=torch.channels_last_3d)
                features = self.model(normalised)
                extracted.append(nn.functional.normalize(features, dim=1).numpy())
        features = np.concatenate(extracted)
        np.save(cache, features, allow_pickle=False)
        return features


def samples(marks, gaps, count, random):
    rows = [(round(seconds * RATE) + delta, action)
            for seconds, action in marks for delta in (-1, 0, 1)]
    candidates = [index for index in range(RATE, count - RATE, RATE)
                  if all(abs(index / RATE - t) > 1.25 for t, _ in marks)
                  and all(not start <= index / RATE <= end for start, end in gaps)]
    selected = random.choice(candidates, min(len(candidates), max(12, 5 * len(marks))), replace=False)
    rows.extend((int(index), 0) for index in selected)
    centers, targets = np.array(rows, dtype=int).T
    return np.clip(centers, 0, count - 1), targets


def fit(features, classes):
    # Fit a regularised linear classifier while keeping the video encoder frozen.
    if len(set(classes)) != len(ACTIONS):
        raise ValueError("The training split needs examples of all three classes")
    center = features.mean(axis=0)
    spread = max(float(np.sqrt(np.mean((features - center) ** 2))), 1e-5)
    x = np.column_stack(((features - center) / spread, np.ones(len(features))))
    truth = np.eye(len(ACTIONS))[classes]
    balance = (len(classes) / (len(ACTIONS) * np.bincount(classes)))[classes, None]
    weights = np.zeros((x.shape[1], len(ACTIONS)))
    # Bound the step size using the weighted classifier's spectral Lipschitz bound.
    covariance = (x * balance).T @ x / len(x)
    step = 1 / (0.5 * np.linalg.eigvalsh(covariance)[-1] + 0.2)
    for _ in range(250):
        gradient = x.T @ ((probabilities(x @ weights) - truth) * balance) / len(x)
        gradient[:-1] += 0.2 * weights[:-1]
        weights -= step * gradient
    return center, spread, weights


def detect(centers, features, model, threshold):
    center, spread, weights = model
    x = np.column_stack(((features - center) / spread, np.ones(len(features))))
    scores = probabilities(x @ weights)
    classes = scores.argmax(axis=1)
    events = []
    for action in range(1, len(ACTIONS)):
        accepted = []
        candidates = np.flatnonzero((classes == action) & (scores[:, action] >= threshold))
        for index in sorted(candidates, key=lambda i: scores[i, action], reverse=True):
            if all(abs(centers[index] - other) >= RATE for other in accepted):
                accepted.append(centers[index])
                events.append((int(centers[index]) / RATE, action, float(scores[index, action])))
    return sorted(events)


def tally(events, marks, gaps, totals):
    remaining = list(marks)
    for time, action, _ in events:
        candidates = [(abs(time - mark), i) for i, (mark, kind) in enumerate(remaining)
                      if kind == action and abs(time - mark) <= TOLERANCE_S]
        if candidates:
            totals[ACTIONS[action]]["tp"] += 1
            remaining.pop(min(candidates)[1])
        elif not any(start <= time <= end for start, end in gaps):
            totals[ACTIONS[action]]["fp"] += 1
    for _, action in remaining:
        totals[ACTIONS[action]]["fn"] += 1


def prediction_rows(events):
    return [{"time_ms": round(time * 1000), "action": ACTIONS[action], "confidence": round(score, 3)}
            for time, action, score in events]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("round-exports/video-baseline"))
    parser.add_argument("--ffmpeg")
    modes = parser.add_subparsers(dest="mode", required=True)
    train = modes.add_parser("train")
    train.add_argument("root", type=Path)
    train.add_argument("labels", type=Path)
    train.add_argument("--holdout", default="118-navarro-hyttel")
    predict = modes.add_parser("predict")
    predict.add_argument("video", type=Path)
    args = parser.parse_args()
    ffmpeg = args.ffmpeg or find_ffmpeg()
    if not ffmpeg:
        parser.error("FFmpeg is required")
    torch.set_num_threads(6)
    torch.set_num_interop_threads(1)
    encoder = Encoder(args.weights, args.output / "features")
    artifact = args.output / "model.npz"

    def scan(video):
        frames = decode(video, ffmpeg)
        centers = np.arange(0, len(frames), STRIDE)
        return centers, encoder.features(video, frames, centers)

    if args.mode == "predict":
        with np.load(artifact, allow_pickle=False) as stored:
            model = tuple(stored[key] for key in ("center", "spread", "weights"))
        print(json.dumps(prediction_rows(detect(*scan(args.video), model, THRESHOLD)), indent=2))
        return

    dataset = rounds(args.root, args.labels)
    testing = [row for row in dataset if row[0].parent.name == args.holdout]
    training = [row for row in dataset if row[0].parent.name != args.holdout]
    if not testing or not training:
        parser.error("The dataset needs both the held-out source and training sources")
    rng = np.random.default_rng(42)
    features, targets = [], []
    for video, marks, gaps in training:
        print(f"Encoding training windows for {video.parent.name}/{video.name}", flush=True)
        frames = decode(video, ffmpeg)
        centers, truth = samples(marks, gaps, len(frames), rng)
        features.append(encoder.features(video, frames, centers))
        targets.append(truth)
    model = fit(np.concatenate(features), np.concatenate(targets))
    totals = {name: dict(tp=0, fp=0, fn=0) for name in ACTIONS[1:]}
    held_out_predictions = {}
    for video, marks, gaps in testing:
        print(f"Scanning full held-out clip {video.name}", flush=True)
        events = detect(*scan(video), model, THRESHOLD)
        tally(events, marks, gaps, totals)
        held_out_predictions[video.relative_to(args.root).as_posix()] = prediction_rows(events)

    np.savez(artifact, center=model[0], spread=model[1], weights=model[2])
    report = {"encoder": "Kinetics-pretrained R3D-18", "held_out_source": args.holdout,
              "training_clips": len(training), "held_out_clips": len(testing),
              "training_marks": sum(len(row[1]) for row in training),
              "threshold": THRESHOLD, "match_tolerance_s": TOLERANCE_S, "counts": totals}
    (args.output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output / "held-out-predictions.json").write_text(json.dumps(held_out_predictions, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
