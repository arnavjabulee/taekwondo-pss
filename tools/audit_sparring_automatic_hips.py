"""Compare automatically selected athlete crops against adjudicated kick order."""

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import torch
from torchvision.models.detection import ssdlite320_mobilenet_v3_large

from audit_sparring_close_hips import get_hips
from audit_sparring_phases import decide, interval

ROOT = Path("round-exports")
FOLDER = ROOT / "kick-comparison/human-check"
DETECT_EVERY = 2


def box_evidence(frame, box, red):
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    patch = frame[int(y1 + .20 * height):int(y1 + .57 * height),
                  int(x1 + .23 * width):int(x1 + .77 * width)]
    if not patch.size:
        return 0.0
    h, s, v = cv2.split(cv2.cvtColor(patch, cv2.COLOR_RGB2HSV))
    vivid = (s >= 85) & (v >= 50)
    red_fraction = np.mean(vivid & ((h <= 12) | (h >= 165)))
    blue_fraction = np.mean(vivid & (h >= 93) & (h <= 135))
    return float(red_fraction - blue_fraction if red else blue_fraction - red_fraction)


def transition(a, b):
    center_a, center_b = (a[:2] + a[2:]) / 2, (b[:2] + b[2:]) / 2
    scale = max(a[3] - a[1], b[3] - b[1], 1)
    motion = np.linalg.norm(center_a - center_b) / scale
    return 3 * motion + 0.8 * abs(np.log((b[3] - b[1]) / (a[3] - a[1])))


def track(detector, frames, red):
    sampled = frames[::DETECT_EVERY]
    observations = []
    with torch.inference_mode():
        for start in range(0, len(sampled), 8):
            batch = sampled[start:start+8]
            tensors = [torch.from_numpy(frame).permute(2, 0, 1).float() / 255 for frame in batch]
            for frame, result in zip(batch, detector(tensors)):
                boxes = result["boxes"].numpy()
                scores = result["scores"].numpy()
                valid = (result["labels"].numpy() == 1) & (scores >= .28)
                options = [(box, box_evidence(frame, box, red)) for box in boxes[valid]
                           if box[3] - box[1] >= frame.shape[0] * .17]
                observations.append(options)
    # Select a continuous detection path. Missing detections remain explicit.
    values = [[0.0]]
    parents = []
    previous = [(None, 0.0)]
    options_by_frame = []
    for options in observations:
        current = [(None, 0.0), *options]
        options_by_frame.append(current)
        weights, links = [], []
        for box, evidence in current:
            scores = []
            for i, (old, _) in enumerate(previous):
                cost = (transition(old, box) if old is not None and box is not None
                        else 1.0 if (old is None) != (box is None) else 0.0)
                scores.append(values[-1][i] - cost)
            parent = int(np.argmax(scores))
            weight = -.38 if box is None else np.clip(4 * evidence, -2.0, 1.5)
            weights.append(float(scores[parent] + weight))
            links.append(parent)
        parents.append(links)
        values.append(weights)
        previous = current
    index = int(np.argmax(values[-1]))
    path = []
    for options, links in reversed(list(zip(options_by_frame, parents))):
        path.append(options[index])
        index = links[index]
    return list(reversed(path))


def magnify(frame, box):
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    x1, x2 = max(0, int(x1 - .24 * width)), min(frame.shape[1], int(x2 + .24 * width))
    y1, y2 = max(0, int(y1 - .08 * height)), min(frame.shape[0], int(y2 + .08 * height))
    image = frame[y1:y2, x1:x2]
    scale = 384 / max(image.shape[:2])
    image = cv2.resize(image, (round(image.shape[1] * scale), round(image.shape[0] * scale)))
    out = np.zeros((384, 384, 3), dtype=np.uint8)
    y, x = (384 - image.shape[0]) // 2, (384 - image.shape[1]) // 2
    out[y:y+image.shape[0], x:x+image.shape[1]] = image
    return out


def read_video(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            width = 640
            frame = cv2.resize(frame, (width, round(frame.shape[0] * width / frame.shape[1])))
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        cap.release()
    if not frames or not fps:
        raise ValueError(f"Unable to read {path}")
    return frames, fps


def stable_axis(series):
    """Remove left/right hip swaps while keeping changes along a continuous axis."""
    output = []
    last_time, last_yaw = None, None
    for timestamp, yaw, candidates in series:
        if yaw is not None:
            if last_yaw is not None and timestamp - last_time <= 120:
                yaw += np.pi * round((last_yaw - yaw) / np.pi)
            last_time, last_yaw = timestamp, yaw
        output.append((timestamp, yaw, candidates))
    return output


def audit(case, detector, pose_options, anchor, folder):
    frames, fps = read_video(folder / (case["id"] + ".mp4"))
    red = case["athlete"] == "red"
    path = track(detector, frames, red)
    # A known gear colour is used for this benchmark, never as a spin cue.
    identity_confirmed = sum(box is not None and evidence >= .10 for box, evidence in path)
    result = []
    stable = []
    with mp.tasks.vision.PoseLandmarker.create_from_options(pose_options) as landmarker:
        for index, frame in enumerate(frames):
            timestamp = round(index * 1000 / fps)
            box, evidence = path[index // DETECT_EVERY]
            if index % DETECT_EVERY and index // DETECT_EVERY + 1 < len(path):
                next_box, _ = path[index // DETECT_EVERY + 1]
                if box is not None and next_box is not None and transition(box, next_box) < 1:
                    box = (box + next_box) / 2
            if box is None or evidence < -.12 or identity_confirmed < 2:
                result.append((timestamp, None, 0))
                stable.append((timestamp, None, 0))
                continue
            crop = magnify(frame, box)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=crop)
            found = landmarker.detect_for_video(image, timestamp)
            yaw, candidates, confirmed = get_hips(found, crop, "A" if red else "B")
            result.append((timestamp, yaw, candidates))
            stable.append((timestamp, yaw if confirmed else None, candidates))
    report = {"clip": case["id"], "expected": case.get("human_verdict", {}).get("label"),
              "detected_crop_fraction": round(sum(box is not None for box, _ in path) / len(path), 2),
              "colour_anchor_frames": identity_confirmed}
    for name, series in (("position_or_colour", result), ("colour_confirmed_only", stable),
                         ("swap_corrected_axis", stable_axis(result))):
        before = interval(series, anchor-500, anchor)
        after = interval(series, anchor, anchor+500)
        report[name] = {"before": before, "after": after, "estimate": decide(before, after)}
    report["yaw_by_frame"] = [{"time_ms": t, "yaw_degrees": round(float(np.degrees(yaw)), 1)
                              if yaw is not None else None} for t, yaw, _ in result]
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases-folder", type=Path, default=FOLDER)
    args = parser.parse_args()
    cv2.setNumThreads(1)
    torch.set_num_threads(4)
    data = json.loads((args.cases_folder / "cases.json").read_text(encoding="utf-8-sig"))
    detector = ssdlite320_mobilenet_v3_large(weights=None, weights_backbone=None, num_classes=91)
    weights = ROOT / "video-encoder/ssdlite320_mobilenet_v3_large_coco-a79551df.pth"
    detector.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    detector.eval()
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(ROOT / "pose-model/pose_landmarker_lite.task")),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=2,
    )
    rows = []
    for case in data["cases"]:
        result = audit(case, detector, options, data["anchor_in_export_ms"], args.cases_folder)
        rows.append(result)
        print(json.dumps({field: value for field, value in result.items()
                          if field != "yaw_by_frame"}), flush=True)
    report = {"inputs": "Human-supplied kick times and athlete colours. Person boxes selected automatically.",
              "cases": rows}
    (args.cases_folder / "automatic-hip-audit.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
