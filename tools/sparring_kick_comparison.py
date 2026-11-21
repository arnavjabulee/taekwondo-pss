"""Train and compare kick proposals and spin verification with audited examples."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import cv2
import torch

from sparring_baseline import find_ffmpeg
from sparring_kick_spotter import OFFSETS, RATE, TemporalEncoder, counts, events, training_centers
from sparring_video import decode, rounds

HOLDOUT = "225-turkulj-rodrigue"
NORMAL = 1
SPIN = 2
STEP = RATE // 2


class PersonCropEncoder(TemporalEncoder):
    """Extract ordered video tokens from a crop around the people in the exchange."""

    def __init__(self, weights, cache, detector_weights):
        super().__init__(weights, cache)
        from torchvision.models.detection import ssdlite320_mobilenet_v3_large

        self.detector = ssdlite320_mobilenet_v3_large(
            weights=None, weights_backbone=None, num_classes=91,
        )
        self.detector.load_state_dict(torch.load(detector_weights, map_location="cpu", weights_only=True))
        self.detector.eval()
        self.identity += hashlib.sha256(detector_weights.read_bytes()).hexdigest()

    @staticmethod
    def crop(frame, people):
        height, width = frame.shape[:2]
        boxes = people["boxes"][(people["labels"] == 1) & (people["scores"] >= .35)].numpy()
        if len(boxes) >= 2:
            sizes = boxes[:, 3] - boxes[:, 1]
            centers = (boxes[:, 0] + boxes[:, 2]) / 2
            eligible = (sizes >= height * .13) & (np.abs(centers - width / 2) <= width * .42)
            boxes, sizes, centers = boxes[eligible], sizes[eligible], centers[eligible]
        if len(boxes) < 2:
            return round(.1 * width), round(.055 * height), round(.90 * width), round(.945 * height)
        rank = sizes / (1 + 2 * np.abs(centers - width / 2) / width)
        selected = boxes[np.argsort(-rank)[:3]]
        x1, y1 = selected[:, :2].min(axis=0)
        x2, y2 = selected[:, 2:].max(axis=0)
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        w = min(width, max((x2 - x1) * 1.5, width * .43))
        h = min(height, max((y2 - y1) * 1.4, height * .58))
        left = round(np.clip(cx - w / 2, 0, width - w))
        top = round(np.clip(cy - h / 2, 0, height - h))
        return left, top, left + round(w), top + round(h)

    def features(self, video, frames, centers):
        stat = video.stat()
        key = f"{video.resolve()}:{stat.st_size}:{stat.st_mtime_ns}:{self.identity}:person-crop-v1"
        digest = hashlib.sha256(key.encode() + centers.astype("<i8").tobytes()).hexdigest()
        path = self.cache / (digest + ".npy")
        if path.exists():
            return np.load(path, allow_pickle=False)
        output = []
        with torch.inference_mode():
            for start in range(0, len(centers), 8):
                center = centers[start:start + 8]
                view = torch.from_numpy(frames[center]).permute(0, 3, 1, 2).float().div_(255)
                people = self.detector(list(view))
                inputs = []
                for index, detected in zip(center, people):
                    x1, y1, x2, y2 = self.crop(frames[index], detected)
                    sequence = frames[np.clip(index + OFFSETS, 0, len(frames) - 1)]
                    inputs.append([cv2.resize(frame[y1:y2, x1:x2], (144, 96),
                                              interpolation=cv2.INTER_AREA) for frame in sequence])
                batch = torch.from_numpy(np.asarray(inputs)).permute(0, 4, 1, 2, 3).float().div_(255)
                batch = ((batch - self.mean) / self.std).contiguous(memory_format=torch.channels_last_3d)
                feature = self.model.layer3(self.model.layer2(self.model.layer1(self.model.stem(batch))))
                output.append(torch.nn.functional.normalize(feature.mean(dim=(-1, -2)), dim=1).numpy())
        result = np.concatenate(output)
        np.save(path, result, allow_pickle=False)
        return result


def windows(encoder, video, frames, centers):
    # Preserve the order of the four video tokens in each window.
    encoded = encoder.features(video, frames, centers)
    return encoded.transpose(0, 2, 1).reshape(len(centers), -1).astype(np.float64)


def sample(encoder, video, frames, marks, ordinary, gaps, random):
    known = [(time, SPIN) for time, action in marks if action == SPIN]
    known.extend((time, NORMAL) for time in ordinary)
    stamped = [(round(time * RATE) + shift, kind)
               for time, kind in known for shift in (-2, 0, 2)]
    background = training_centers(frames, [*marks, *[(t, NORMAL) for t in ordinary]], gaps, random)
    stamped.extend((int(index), 0) for index in background
                   if all(abs(index / RATE - time) > 1.25 for time, _ in known)
                   and all(abs(index / RATE - time) > 0.75 for time, _ in marks))
    centers, targets = np.asarray(stamped, dtype=int).T
    return windows(encoder, video, frames, np.clip(centers, 0, len(frames) - 1)), targets


def fit_binary(x, y, regularization=16):
    mean = x.mean(axis=0)
    deviation = max(float(np.std(x - mean)), 1e-6)
    rows = (x - mean) / deviation
    # Equal total weight for the two classes and a regularized feature fit.
    class_sizes = np.bincount(y.astype(int), minlength=2)
    if not min(class_sizes):
        raise ValueError("Training split needs positive and negative examples")
    row_weight = np.sqrt(len(rows) / (2 * class_sizes[y.astype(int)]))
    weighted = rows * row_weight[:, None]
    target = (2 * y - 1) * row_weight
    dual = weighted @ weighted.T
    dual.flat[::len(dual) + 1] += regularization
    weights = weighted.T @ np.linalg.solve(dual, target)
    return mean, deviation, weights


def score(x, model):
    mean, deviation, weights = model
    return (x - mean) / deviation @ weights


def fit(rows, regularization):
    x = np.concatenate([row[1] for row in rows])
    y = np.concatenate([row[2] for row in rows])
    return (fit_binary(x, y != 0, regularization),
            fit_binary(x[y != 0], y[y != 0] == SPIN, regularization))


def calibrate(rows):
    sources = sorted({row[0] for row in rows})
    candidates = []
    for strength in (16, 128, 512):
        first, second, labels = [], [], []
        for source in sources:
            proposal, verification = fit([r for r in rows if r[0] != source], strength)
            for name, features, truth in rows:
                if name != source:
                    continue
                first.extend(score(features, proposal))
                second.extend(score(features, verification))
                labels.extend(truth)
        first, second, labels = map(np.asarray, (first, second, labels))
        proposal_cutoff = float(np.quantile(first[labels == SPIN], .10))
        ordinary = second[labels == NORMAL]
        second_cutoff = float(np.quantile(ordinary, .80))
        spin_recall = float(np.mean(
            (first[labels == SPIN] >= proposal_cutoff) & (second[labels == SPIN] >= second_cutoff)))
        ordinary_rejection = float(np.mean(
            (first[labels == NORMAL] < proposal_cutoff) | (ordinary < second_cutoff)))
        candidates.append(dict(regularization=strength, proposal_cutoff=proposal_cutoff,
                               spin_cutoff=second_cutoff, spin_recall=spin_recall,
                               ordinary_rejection=ordinary_rejection))
    return max(candidates, key=lambda item: item["spin_recall"] + item["ordinary_rejection"])


def shortlist(times, scores, limit, gap=0.8):
    ranked = []
    for index in np.argsort(-scores, kind="stable"):
        time = float(times[index])
        if all(abs(time - picked) >= gap for picked in ranked):
            ranked.append(time)
            if len(ranked) >= limit:
                break
    return sorted(ranked)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("round-exports"))
    parser.add_argument("--person-crop", action="store_true")
    args = parser.parse_args()
    root = args.root
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        parser.error("FFmpeg is required")
    torch.set_num_threads(6)
    torch.set_num_interop_threads(1)
    cv2.setNumThreads(1)
    out = root / "kick-comparison"
    comparisons = json.loads((out / "ordinary-kicks.json").read_text(encoding="utf-8-sig"))["clips"]
    weights = root / "video-encoder"
    if args.person_crop:
        out /= "person-crop"
        encoder = PersonCropEncoder(weights / "r3d_18-b3b3357e.pth", out / "features",
                                    weights / "ssdlite320_mobilenet_v3_large_coco-a79551df.pth")
    else:
        encoder = TemporalEncoder(weights / "r3d_18-b3b3357e.pth", root / "kick-spotter-crop/features")
    random = np.random.default_rng(21)
    data, test = [], []
    for video, marks, gaps in rounds(root, root / "sparring-labels.csv"):
        ordinary = comparisons.get(video.relative_to(root).as_posix(), [])
        if video.parent.name == HOLDOUT:
            test.append((video, marks, gaps, ordinary))
            continue
        print(f"Preparing training exchanges in {video.parent.name}/{video.name}", flush=True)
        frames = decode(video, ffmpeg, RATE, court_crop=not args.person_crop, person_crop=args.person_crop)
        features, labels = sample(encoder, video, frames, marks, ordinary, gaps, random)
        data.append((video.parent.name, features, labels))
    calibration = calibrate(data)
    proposal, verification = fit(data, calibration["regularization"])
    result = {}
    shortlist_rows = {}
    for video, marks, gaps, ordinary in test:
        print(f"Scanning held-out {video.name}", flush=True)
        frames = decode(video, ffmpeg, RATE, court_crop=not args.person_crop, person_crop=args.person_crop)
        centers = np.arange(0, len(frames), STEP)
        features = windows(encoder, video, frames, centers)
        times = centers / RATE
        first = score(features, proposal)
        second = score(features, verification)
        enough_motion = first >= calibration["proposal_cutoff"]
        accepted = enough_motion & (second >= calibration["spin_cutoff"])
        first_pass = events(dict(zip(times[enough_motion], first[enough_motion])), -np.inf)
        verified = events(dict(zip(times[accepted], second[accepted])), -np.inf)
        picked = shortlist(times, np.minimum(first - calibration["proposal_cutoff"],
                                             second - calibration["spin_cutoff"]), 10)
        shortlist_rows[video.name] = [round(t * 1000) for t in picked]
        test_marks = [(t, SPIN) for t, action in marks if action == SPIN] + [(t, NORMAL) for t in ordinary]
        controlled = {str(kind): {"correct": 0, "total": 0} for kind in (SPIN, NORMAL)}
        if test_marks:
            anchors = np.array([round(t * RATE) for t, _ in test_marks])
            anchor_scores = score(windows(encoder, video, frames, anchors), verification)
            for (_, kind), confidence in zip(test_marks, anchor_scores):
                row = controlled[str(kind)]
                row["total"] += 1
                row["correct"] += int((confidence >= calibration["spin_cutoff"]) == (kind == SPIN))
        result[video.name] = {"controlled_comparison": controlled,
                              "proposals": counts(first_pass, marks, gaps),
                              "spin_alerts": counts(verified, marks, gaps),
                              "ten_clip_shortlist": counts(picked, marks, gaps)}
    totals = {section: {kind: sum(r[section][kind] for r in result.values())
                        for kind in ("matched", "missed", "unmatched")}
              for section in ("proposals", "spin_alerts", "ten_clip_shortlist")}
    final = totals["spin_alerts"]
    passed = final["matched"] >= final["missed"] and all(
        row["spin_alerts"]["unmatched"] <= 5 for row in result.values())
    report = {"holdout": HOLDOUT, "person_crop": args.person_crop, "ordinary_training_examples": sum(
        len(stamps) for clip, stamps in comparisons.items() if not clip.startswith(HOLDOUT + "/")),
        "calibration": calibration, "results": result, "totals": totals, "detector_gate_passed": passed}
    (out / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (out / "shortlist.json").write_text(json.dumps(shortlist_rows, indent=2) + "\n", encoding="utf-8")
    np.savez(out / "two-stage-heads.npz", proposal_mean=proposal[0], proposal_scale=proposal[1],
             proposal_weight=proposal[2], spin_mean=verification[0], spin_scale=verification[1],
             spin_weight=verification[2])
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
