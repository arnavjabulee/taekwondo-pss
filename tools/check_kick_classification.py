"""Measure ordinary-versus-spinning kick classification before scanning rounds."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch

from sparring_baseline import find_ffmpeg
from sparring_kick_comparison import PersonCropEncoder, fit_binary, score
from sparring_kick_spotter import RATE, TemporalEncoder
from sparring_video import decode, rounds

HELD_OUT = {"225-turkulj-rodrigue", "seleknas"}
JITTER = np.array([-2, 0, 2])
SPIN = 2
GATE = 0.75


def samples(root, annotations, fresh):
    for video, marks, _ in rounds(root, root / "sparring-labels.csv"):
        ordinary = annotations["ordinary_kick"].get(video.relative_to(root).as_posix(), [])
        spins = [time for time, action in marks if action == SPIN]
        if ordinary or spins:
            yield video.parent.name, video, ordinary, spins
    data = annotations["fresh"]
    yield "seleknas", fresh, data["ordinary_kick"], data["spinning_kick"]


def representations(features):
    # One view retains appearance and timing. The other emphasises changes
    # within the exchange and reduces the weight of static appearance.
    ordered = features.transpose(0, 2, 1).reshape(len(features), -1)
    changes = np.diff(features, axis=-1).transpose(0, 2, 1).reshape(len(features), -1)
    context = features.mean(axis=2)
    return {"ordered": ordered, "motion": np.column_stack((changes, 0.5 * context))}


def fit_ranker(chunks, strength):
    features = np.concatenate([entry[1] for entry in chunks], axis=0)
    labels = np.concatenate([entry[2] for entry in chunks])
    return fit_binary(features.reshape(-1, features.shape[-1]), np.repeat(labels, len(JITTER)), strength)


def score_windows(feat, model):
    return score(feat.reshape(-1, feat.shape[-1]), model).reshape(len(feat), len(JITTER)).mean(axis=1)


def measures(scores, truth, cutoff):
    results = {}
    for label, name in ((True, "spinning_kick"), (False, "ordinary_kick")):
        selected = truth == label
        results[name] = {
            "correct": int(np.count_nonzero(((scores >= cutoff) == truth) & selected)),
            "total": int(selected.sum()),
        }
    return results


def balanced(result):
    return np.mean([row["correct"] / row["total"] for row in result.values() if row["total"]])


def choose(training):
    trials = []
    sources = sorted({entry[0] for entry in training})
    for strength in (32, 256, 1024):
        data, truth = [], []
        for source in sources:
            other = [entry for entry in training if entry[0] != source]
            ranker = fit_ranker(other, strength)
            for _, feat, labels in (entry for entry in training if entry[0] == source):
                data.extend(score_windows(feat, ranker))
                truth.extend(labels)
        data, truth = np.asarray(data), np.asarray(truth)
        for cutoff in np.unique(data):
            summary = measures(data, truth, cutoff)
            trials.append((balanced(summary), strength, float(cutoff), summary))
    return max(trials, key=lambda trial: (trial[0], trial[3]["ordinary_kick"]["correct"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("round-exports"))
    parser.add_argument("--fresh", type=Path, required=True)
    parser.add_argument("--person-crop", action="store_true")
    parser.add_argument("--lead-in", action="store_true",
                        help="Add a one-second video window before the existing exchange")
    args = parser.parse_args()
    root = args.root
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        parser.error("FFmpeg is required")
    cv2.setNumThreads(1)
    torch.set_num_threads(6)
    torch.set_num_interop_threads(1)
    output = root / "kick-comparison"
    comparisons = json.loads((output / "expanded-labels.json").read_text(encoding="utf-8-sig"))
    weights = root / "video-encoder"
    if args.person_crop:
        encoder = PersonCropEncoder(weights / "r3d_18-b3b3357e.pth", output / "person-crop/features",
                                    weights / "ssdlite320_mobilenet_v3_large_coco-a79551df.pth")
    else:
        encoder = TemporalEncoder(weights / "r3d_18-b3b3357e.pth", root / "kick-spotter-crop/features")
    training = {"ordered": [], "motion": []}
    testing = {"ordered": [], "motion": []}
    for source, video, ordinary, spins in samples(root, comparisons, args.fresh):
        print(f"Extracting {len(ordinary) + len(spins)} exchanges from {source}/{video.name}", flush=True)
        frames = decode(video, ffmpeg, RATE, court_crop=not args.person_crop, person_crop=args.person_crop)
        times = np.asarray([*ordinary, *spins])
        labels = np.asarray([False] * len(ordinary) + [True] * len(spins))
        centers = np.clip(np.rint(times * RATE).astype(int)[:, None] + JITTER, 0, len(frames) - 1).ravel()
        features = encoder.features(video, frames, centers)
        if args.lead_in:
            earlier_centers = np.maximum(centers - RATE, 0)
            earlier = encoder.features(video, frames, earlier_centers)
            features = np.concatenate((earlier, features), axis=-1)
        destination = testing if source in HELD_OUT else training
        for name, feat in representations(features).items():
            destination[name].append((source, feat.reshape(len(labels), len(JITTER), -1), labels))

    candidates = {name: choose(data) for name, data in training.items()}
    winner = max(candidates, key=lambda name: candidates[name][0])
    accuracy, strength, cutoff, cross_validation = candidates[winner]
    ranker = fit_ranker(training[winner], strength)
    held_out = {}
    for source in sorted(HELD_OUT):
        rows = [entry for entry in testing[winner] if entry[0] == source]
        scores = np.concatenate([score_windows(feat, ranker) for _, feat, _ in rows])
        truth = np.concatenate([labels for _, _, labels in rows])
        held_out[source] = measures(scores, truth, cutoff)
    passed = all(row["total"] and row["correct"] / row["total"] >= GATE
                 for source in held_out.values() for row in source.values())
    report = {"representation": winner, "regularization": strength,
              "crop": "people" if args.person_crop else "fixed",
              "extra_lead_in_seconds": int(args.lead_in),
              "training_exchanges": int(sum(len(entry[2]) for entry in training[winner])),
              "out_of_source_balanced_accuracy": float(accuracy), "cutoff": cutoff,
              "training_source_validation": cross_validation, "held_out": held_out,
              "gate": {"minimum_per_class_per_source": GATE, "passed": passed}}
    variant = "people" if args.person_crop else "fixed"
    suffix = "-lead-in" if args.lead_in else ""
    destination = output / f"controlled-{variant}{suffix}.json"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
