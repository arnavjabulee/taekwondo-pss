"""Test whether existing video features support a low-noise replay detector."""

import argparse
import json
from pathlib import Path

import numpy as np

from sparring_baseline import ACTIONS, find_ffmpeg, probabilities
from sparring_video import RATE, STRIDE, TOLERANCE_S, Encoder, decode, fit, rounds, samples

HOLDOUT = "118-navarro-hyttel"
BACKGROUND_QUANTILE = 0.995
MAX_EXTRA_PER_ROUND = 5


def linear_scores(x, model):
    center, spread, weights = model
    rows = np.column_stack(((x - center) / spread, np.ones(len(x))))
    return probabilities(rows @ weights)


def exemplar_scores(x, embeddings, targets):
    similarities = x @ embeddings.T
    scores = []
    for action in range(len(ACTIONS)):
        group = similarities[:, targets == action]
        top = min(5, group.shape[1])
        scores.append(np.partition(group, -top, axis=1)[:, -top:].mean(axis=1))
    return probabilities(np.column_stack(scores) * 16)


def score_function(name, data):
    features = np.concatenate([row[1] for row in data])
    targets = np.concatenate([row[2] for row in data])
    if name == "linear":
        model = fit(features, targets)
        return lambda x: linear_scores(x, model)
    return lambda x: exemplar_scores(x, features, targets)


def average_precision(scores, positives):
    order = np.argsort(-scores, kind="stable")
    truth = positives[order]
    # Use the final precision at each shared score for tie-invariant AP.
    ordered = scores[order]
    end = np.flatnonzero(np.r_[ordered[:-1] != ordered[1:], True])
    cumulative = truth.cumsum()[end]
    gain = np.diff(np.r_[0, cumulative])
    return float(np.sum(gain * cumulative / (end + 1)) / truth.sum())


def calibrate(training):
    groups = sorted({row[0] for row in training})
    results = {}
    for name in ("linear", "exemplar"):
        folds, labels = [], []
        for group in groups:
            score = score_function(name, [row for row in training if row[0] != group])
            for source, features, truth in training:
                if source != group:
                    continue
                folds.append(score(features))
                labels.append(truth)
        scores = np.concatenate(folds)
        truth = np.concatenate(labels)
        results[name] = {
            "training_source_average_precision": {
                ACTIONS[a]: average_precision(scores[:, a], truth == a)
                for a in range(1, len(ACTIONS))
            },
            "thresholds": [float(np.quantile(scores[truth == 0, a], BACKGROUND_QUANTILE))
                           for a in range(1, len(ACTIONS))],
        }
    winner = max(results, key=lambda n: np.mean(
        list(results[n]["training_source_average_precision"].values())))
    return winner, results


def alerts(centers, scores, thresholds):
    events = []
    for action, threshold in enumerate(thresholds, 1):
        candidates = np.flatnonzero((scores[:, action] > threshold) & (scores.argmax(axis=1) == action))
        kept = []
        for index in sorted(candidates, key=lambda i: scores[i, action], reverse=True):
            if all(abs(centers[index] - earlier) >= RATE for earlier in kept):
                kept.append(centers[index])
                events.append((int(centers[index]) / RATE, action))
    return sorted(events)


def match(events, marks, gaps):
    totals = {name: dict(matched=0, unmatched=0, missed=0) for name in ACTIONS[1:]}
    remaining = list(marks)
    for seconds, action in events:
        candidates = [(abs(seconds - time), i) for i, (time, kind) in enumerate(remaining)
                      if kind == action and abs(seconds - time) <= TOLERANCE_S]
        counts = totals[ACTIONS[action]]
        if candidates:
            counts["matched"] += 1
            remaining.pop(min(candidates)[1])
        elif not any(start <= seconds <= end for start, end in gaps):
            counts["unmatched"] += 1
    for _, action in remaining:
        totals[ACTIONS[action]]["missed"] += 1
    return totals


def main():
    import torch

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("round-exports"))
    args = parser.parse_args()
    root = args.root
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        parser.error("FFmpeg is required")
    torch.set_num_threads(6)
    torch.set_num_interop_threads(1)
    destination = root / "video-baseline"
    encoder = Encoder(root / "video-encoder/r3d_18-b3b3357e.pth", destination / "features")
    dataset = rounds(root, root / "sparring-labels.csv")
    training, test = [], []
    random = np.random.default_rng(42)
    for video, marks, gaps in dataset:
        print(f"Reading {video.parent.name}/{video.name}", flush=True)
        video_frames = decode(video, ffmpeg)
        if video.parent.name == HOLDOUT:
            centers = np.arange(0, len(video_frames), STRIDE)
            features = encoder.features(video, video_frames, centers)
            motion = np.abs(np.diff(video_frames.astype(np.int16), axis=0)).mean(axis=(1, 2, 3))
            # Hard negatives are high-motion windows away from any label or flagged gap.
            eligible = [(float(motion[max(0, c - 4):c + 4].mean()), i)
                        for i, c in enumerate(centers) if 4 <= c < len(motion) - 4
                        and all(abs(c / RATE - time) > 1.5 for time, _ in marks)
                        and all(not start <= c / RATE <= end for start, end in gaps)]
            hard = [i for _, i in sorted(eligible, reverse=True)[:max(10, 3 * len(marks))]]
            test.append((video.name, centers, features, marks, gaps, hard))
        else:
            centers, truth = samples(marks, gaps, len(video_frames), random)
            training.append((video.parent.name, encoder.features(video, video_frames, centers), truth))
    winner, calibration = calibrate(training)
    score = score_function(winner, training)
    thresholds = calibration[winner]["thresholds"]
    test_scores, test_labels, results = [], [], {}
    for clip, centers, features, marks, gaps, hard in test:
        scores = score(features)
        results[clip] = match(alerts(centers, scores, thresholds), marks, gaps)
        for time, action in marks:
            at = int(np.argmin(abs(centers / RATE - time)))
            test_scores.append(scores[at])
            test_labels.append(action)
        test_scores.extend(scores[hard])
        test_labels.extend([0] * len(hard))
    scores = np.asarray(test_scores)
    labels = np.asarray(test_labels)
    totals = {name: {metric: sum(row[name][metric] for row in results.values())
                     for metric in ("matched", "unmatched", "missed")}
              for name in ACTIONS[1:]}
    passed = all(row["matched"] >= row["missed"] for row in totals.values()) and all(
        sum(count["unmatched"] for count in row.values()) <= MAX_EXTRA_PER_ROUND
        for row in results.values()
    )
    report = {
        "development_holdout": HOLDOUT,
        "model_selected_on_other_sources": winner,
        "calibration": calibration,
        "hard_negative_test": {
            "sample_counts": dict(zip(ACTIONS, np.bincount(labels, minlength=len(ACTIONS)).tolist())),
            "average_precision": {ACTIONS[a]: average_precision(scores[:, a], labels == a)
                                  for a in range(1, len(ACTIONS))},
        },
        "full_round_totals": totals,
        "full_round_results": results,
        "gate": {"minimum_recall_per_class": 0.5, "maximum_unmatched_per_round": MAX_EXTRA_PER_ROUND,
                 "passed": passed},
    }
    (destination / "replay-gate.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
