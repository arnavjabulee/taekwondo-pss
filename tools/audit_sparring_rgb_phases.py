"""Check from video pixels whether the turn occurs before the known kick time."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.nn.functional import normalize

from sparring_baseline import find_ffmpeg
from sparring_kick_comparison import PersonCropEncoder
from sparring_video import Encoder, decode

RATE = 25
WINDOW_FRAMES = 12
MIN_MARGIN = 0.10


def source(case):
    return case.get("source_video_id") or case["source"].split("/")[0]


def phase_windows(frames, anchor):
    return np.stack([
        frames[anchor - WINDOW_FRAMES:anchor],
        frames[anchor:anchor + WINDOW_FRAMES],
    ])


def encode(model, windows):
    pixels = torch.from_numpy(windows).permute(0, 4, 1, 2, 3).float().div_(255)
    rgb = ((pixels - model.mean) / model.std).contiguous(memory_format=torch.channels_last_3d)
    with torch.inference_mode():
        features = model.model.layer3(model.model.layer2(model.model.layer1(model.model.stem(rgb))))
        pooled = features.mean(dim=(-1, -2))
        # Keep the temporal order of the three feature samples in the phase.
        ordered = pooled.transpose(1, 2).flatten(1)
        return normalize(ordered, dim=1).numpy()


def crop_pair(encoder, frames, anchor):
    frame = frames[anchor]
    image = torch.from_numpy(frame).permute(2, 0, 1).float().div_(255)
    with torch.inference_mode():
        people = encoder.detector([image])[0]
    x1, y1, x2, y2 = encoder.crop(frame, people)
    return np.stack([cv2.resize(row[y1:y2, x1:x2], (144, 96), interpolation=cv2.INTER_AREA)
                     for row in frames])


def ordered_score(example, direction):
    delta = example[0] - example[1]
    length = np.linalg.norm(delta)
    if not length:
        return 0.0
    return float(delta @ direction / length)


def audit(rows, frames, margin):
    output = []
    for test in rows:
        # Whole camera source is left out, including the two spins from Baku.
        references = [
            row for row in rows if row["human_verdict"]["is_spin"] and source(row) != source(test)
        ]
        deltas = np.array([frames[r["id"]][0] - frames[r["id"]][1] for r in references])
        norm = np.linalg.norm(deltas, axis=1)
        valid = norm > 0
        if not np.any(valid):
            raise ValueError("No usable phase differences in training clips")
        direction = (deltas[valid] / norm[valid, None]).mean(axis=0)
        direction /= np.linalg.norm(direction)
        value = ordered_score(frames[test["id"]], direction)
        if value >= margin:
            estimate = "turn_then_kick"
        elif value <= -margin:
            estimate = "kick_then_turn"
        else:
            estimate = "unclear"
        verdict = test["human_verdict"]
        expected = ("turn_then_kick" if verdict["is_spin"] else "kick_then_turn"
                    if verdict["label"] == "kick_then_spin" else "ordinary_kick")
        output.append({"id": test["id"], "expected": expected, "phase_estimate": estimate,
                       "would_label_spin": estimate == "turn_then_kick", "margin": round(value, 3),
                       "reference_spins": [r["id"] for r in references]})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("round-exports"))
    args = parser.parse_args()
    root = args.root
    target = root / "kick-comparison" / "human-check"
    data = json.loads((target / "cases.json").read_text(encoding="utf-8-sig"))
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        parser.error("FFmpeg is required")
    cv2.setNumThreads(1)
    torch.set_num_threads(4)
    weights = root / "video-encoder"
    video_weights = weights / "r3d_18-b3b3357e.pth"
    encoder = Encoder(video_weights, target / "rgb-features")
    people = PersonCropEncoder(video_weights, target / "rgb-features",
                               weights / "ssdlite320_mobilenet_v3_large_coco-a79551df.pth")
    anchor_ms = data["anchor_in_export_ms"]
    index = round(anchor_ms * RATE / 1000)
    records = {"court_crop": {}, "person_crop": {}}
    for item in data["cases"]:
        clip = item["id"]
        path = target / f"{clip}.mp4"
        wide = decode(path, ffmpeg, RATE, court_crop=True)
        original = decode(path, ffmpeg, RATE, person_crop=True)
        if index < WINDOW_FRAMES or len(wide) < index + WINDOW_FRAMES:
            raise ValueError(f"Missing phase-window footage for {clip}")
        records["court_crop"][clip] = encode(encoder, phase_windows(wide, index))
        records["person_crop"][clip] = encode(encoder, phase_windows(crop_pair(people, original, index), index))
    summaries = {variant: audit(data["cases"], features, MIN_MARGIN)
                 for variant, features in records.items()}
    report = {
        "purpose": "Diagnostic with known kick times and human phase labels; not full-round detection.",
        "window_seconds_per_side": WINDOW_FRAMES / RATE,
        "kick_anchor_ms": anchor_ms,
        "minimum_margin": MIN_MARGIN,
        "models": summaries,
    }
    (target / "rgb-phase-audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
