"""Pilot a frame-timestamped spinning-kick spotter on labelled sparring clips."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

from sparring_baseline import find_ffmpeg
from sparring_video import Encoder, decode, rounds

RATE = 16
KICK = 2
OFFSETS = np.arange(-8, 8)
TOKEN_OFFSETS = OFFSETS[::4]
SCAN_STEP = 8
HOLDOUT = "118-navarro-hyttel"
TOLERANCE = 0.6
MAX_EXTRA = 5
MATCH_RADIUS = 0.20


class TemporalEncoder(Encoder):
    def features(self, video, frames, centers, court_box=None):
        stat = video.stat()
        key = f"{video.resolve()}:{stat.st_mtime_ns}:{stat.st_size}:{self.identity}:temporal-v1"
        if frames.shape[1:3] != (64, 112):
            key += f":court-crop-v1:{frames.shape[1:3]}"
        if court_box is not None:
            key += f":box={court_box}"
        digest = hashlib.sha256(key.encode() + centers.astype("<i8").tobytes()).hexdigest()
        cache = self.cache / (digest + ".npy")
        if cache.is_file():
            return np.load(cache, allow_pickle=False)
        chunks = []
        with torch.inference_mode():
            for start in range(0, len(centers), 12):
                sample = np.clip(centers[start:start + 12, None] + OFFSETS, 0, len(frames) - 1)
                x = torch.from_numpy(frames[sample]).permute(0, 4, 1, 2, 3).float().div_(255)
                x = ((x - self.mean) / self.std).contiguous(memory_format=torch.channels_last_3d)
                x = self.model.layer3(self.model.layer2(self.model.layer1(self.model.stem(x))))
                chunks.append(nn.functional.normalize(x.mean(dim=(-1, -2)), dim=1).numpy())
        features = np.concatenate(chunks)
        np.save(cache, features, allow_pickle=False)
        return features


def in_gap(time, gaps):
    return any(start <= time <= end for start, end in gaps)


def training_centers(frames, marks, gaps, rng):
    centers = {round(t * RATE) + shift for t, action in marks if action == KICK
               for shift in (-4, 0, 4)}
    centers.update(round(t * RATE) for t, action in marks if action != KICK)
    negatives = np.array([i for i in range(RATE, len(frames) - RATE, RATE)
                          if all(abs(i / RATE - t) > 1.25 for t, _ in marks)
                          and not in_gap(i / RATE, gaps)], dtype=int)
    if len(negatives):
        small = frames[:, ::8, ::8].astype(np.int16)
        motion = np.abs(np.diff(small, axis=0)).mean(axis=(1, 2, 3))
        energy = np.convolve(motion, np.ones(12) / 12, mode="same")
        count = min(len(negatives), max(12, len(marks) * 5))
        hard = negatives[np.argsort(energy[negatives])[-count // 2:]]
        random = rng.choice(negatives, size=count - len(hard), replace=False)
        centers.update(hard.tolist())
        centers.update(random.tolist())
    return np.unique(np.clip(list(centers), 0, len(frames) - 1)).astype(int)


def targets(centers, marks, gaps):
    times = (centers[:, None] + TOKEN_OFFSETS) / RATE
    expected = np.zeros(times.shape, dtype=np.float32)
    valid = np.ones(times.shape, dtype=bool)
    for time, action in marks:
        if action == KICK:
            delta = np.abs(times - time)
            expected[delta <= MATCH_RADIUS] = 1
            valid &= (delta <= MATCH_RADIUS) | (delta > 0.50)
    for start, end in gaps:
        valid &= (times < start) | (times > end)
    valid |= expected > 0
    return expected, valid


def make_head(channels):
    return nn.Sequential(nn.Conv1d(channels, 40, 3, padding=1), nn.ReLU(),
                         nn.Dropout(.25), nn.Conv1d(40, 1, 1))


def train_head(rows):
    torch.manual_seed(9)
    x = torch.from_numpy(np.concatenate([row[1] for row in rows]))
    y = torch.from_numpy(np.concatenate([row[2] for row in rows]))
    keep = torch.from_numpy(np.concatenate([row[3] for row in rows]))
    if not torch.any(y[keep]):
        raise ValueError("No labelled spinning kicks in the training split")
    model = make_head(x.shape[1])
    optimizer = torch.optim.AdamW(model.parameters(), lr=.003, weight_decay=.02)
    balance = min(6., float((1 - y[keep]).sum() / y[keep].sum()))
    for _ in range(120):
        logits = model(x).squeeze(1)[keep]
        truth = y[keep]
        loss = nn.functional.binary_cross_entropy_with_logits(
            logits, truth, pos_weight=torch.tensor(balance))
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
    return model.eval()


def predict(model, features):
    with torch.inference_mode():
        return model(torch.from_numpy(features)).squeeze(1).sigmoid().numpy()


def collapsed_scores(centers, scores, duration):
    timestamps = ((centers[:, None] + TOKEN_OFFSETS) / RATE).ravel()
    pooled = {}
    for time, score in zip(timestamps, scores.ravel()):
        if 0 <= time < duration:
            pooled[float(time)] = max(float(score), pooled.get(float(time), 0))
    return pooled


def events(scores, threshold):
    found = []
    for time in sorted(scores, key=scores.get, reverse=True):
        if scores[time] < threshold:
            break
        if all(abs(time - other) >= 1 for other in found):
            found.append(time)
    return sorted(found)


def counts(predictions, marks, gaps):
    remaining = [t for t, action in marks if action == KICK]
    hits = unmatched = 0
    for t in predictions:
        nearest = min(range(len(remaining)), key=lambda j: abs(remaining[j] - t), default=None)
        if nearest is not None and abs(remaining[nearest] - t) <= TOLERANCE:
            remaining.pop(nearest)
            hits += 1
        elif not in_gap(t, gaps):
            unmatched += 1
    return {"matched": hits, "unmatched": unmatched, "missed": len(remaining)}


def calibrate(rows):
    # Each calibration source is scored by a head fitted only on the other sources.
    positive, negative = [], []
    sources = sorted({row[0] for row in rows})
    for source in sources:
        model = train_head([r for r in rows if r[0] != source])
        for name, features, truth, keep in rows:
            if source != name:
                continue
            scores = predict(model, features)
            positive.extend(scores[keep & (truth > 0)])
            negative.extend(scores[keep & (truth == 0)])
    if not positive or not negative:
        raise ValueError("Calibration needs both positive and negative examples")
    threshold = float(np.quantile(negative, .995))
    return threshold, {
        "positive_tokens": len(positive), "negative_tokens": len(negative),
        "positive_fraction_above_threshold": float(np.mean(np.asarray(positive) >= threshold)),
        "negative_score_quantile": .995,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("round-exports"))
    parser.add_argument("--court-crop", action="store_true")
    parser.add_argument("--holdout", default=HOLDOUT)
    parser.add_argument("--exclude-source", action="append", default=[])
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--video", type=Path, help="Scan a new video with the saved head")
    parser.add_argument("--court-box", type=float, nargs=4, metavar=("X", "Y", "WIDTH", "HEIGHT"),
                        help="Override the normalised crop for a new video")
    args = parser.parse_args()
    if args.court_box is not None:
        x, y, w, h = args.court_box
        if not (args.video and args.court_crop and 0 <= x < x + w <= 1 and 0 <= y < y + h <= 1):
            parser.error("--court-box requires --video and --court-crop and must fit inside the frame")
    root = args.root
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        parser.error("FFmpeg is required")
    torch.set_num_threads(6)
    torch.set_num_interop_threads(1)
    experiment = root / ("kick-spotter-crop" if args.court_crop else "kick-spotter")
    output = experiment
    if args.holdout != HOLDOUT:
        output /= args.holdout
    output.mkdir(parents=True, exist_ok=True)
    encoder = TemporalEncoder(root / "video-encoder/r3d_18-b3b3357e.pth", experiment / "features")
    if args.video:
        report = json.loads((output / "evaluation.json").read_text())
        state = torch.load(output / "head.pth", map_location="cpu", weights_only=True)
        model = make_head(state["0.weight"].shape[1])
        model.load_state_dict(state)
        frames = decode(args.video, ffmpeg, RATE, args.court_crop, args.court_box)
        centers = np.arange(0, len(frames), SCAN_STEP)
        scores = collapsed_scores(centers, predict(model.eval(), encoder.features(
            args.video, frames, centers, args.court_box)),
                                  len(frames) / RATE)
        predictions = events(scores, report["threshold"] if args.threshold is None else args.threshold)
        print(json.dumps([{"time_ms": round(t * 1000), "score": round(scores[t], 4)}
                          for t in predictions], indent=2))
        return
    rows, testing = [], []
    rng = np.random.default_rng(42)
    for video, marks, gaps in rounds(root, root / "sparring-labels.csv"):
        if video.parent.name == args.holdout:
            testing.append((video, marks, gaps))
            continue
        if video.parent.name in args.exclude_source:
            continue
        print(f"Training windows: {video.parent.name}/{video.name}", flush=True)
        frames = decode(video, ffmpeg, RATE, args.court_crop)
        centers = training_centers(frames, marks, gaps, rng)
        truth, keep = targets(centers, marks, gaps)
        rows.append((video.parent.name, encoder.features(video, frames, centers), truth, keep))
    if not testing:
        parser.error(f"No clips found for held-out source {args.holdout}")
    threshold, calibration = calibrate(rows)
    if args.threshold is not None:
        threshold = args.threshold
    model = train_head(rows)
    result, timestamp_rows = {}, {}
    for video, marks, gaps in testing:
        print(f"Scanning held-out {video.name}", flush=True)
        frames = decode(video, ffmpeg, RATE, args.court_crop)
        centers = np.arange(0, len(frames), SCAN_STEP)
        scores = collapsed_scores(centers, predict(model, encoder.features(video, frames, centers)),
                                  len(frames) / RATE)
        predictions = events(scores, threshold)
        result[video.name] = counts(predictions, marks, gaps)
        timestamp_rows[video.name] = [{"time_ms": round(t * 1000), "score": round(scores[t], 4)}
                                     for t in predictions]
    totals = {key: sum(r[key] for r in result.values()) for key in ("matched", "unmatched", "missed")}
    passed = (totals["matched"] >= totals["missed"] and
              all(r["unmatched"] <= MAX_EXTRA for r in result.values()))
    report = {"development_holdout": args.holdout, "video_sample_rate": RATE,
              "court_crop": args.court_crop,
              "excluded_sources": args.exclude_source,
              "threshold_from_override": args.threshold is not None,
              "timestamp_interval_s": 4 / RATE, "threshold": threshold,
              "calibration": calibration, "counts": totals, "rounds": result,
              "gate": {"minimum_recall": .5, "maximum_unmatched_per_round": MAX_EXTRA, "passed": passed}}
    (output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "held-out-predictions.json").write_text(json.dumps(timestamp_rows, indent=2) + "\n",
                                                      encoding="utf-8")
    torch.save(model.state_dict(), output / "head.pth")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
