"""Controlled original-resolution crop test on adjudicated phone-like footage."""

import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import torch
from torchvision.models.detection import ssdlite320_mobilenet_v3_large
from torchvision.ops import nms

from audit_sparring_automatic_hips import DETECT_EVERY, magnify, stable_axis, track, transition
from audit_sparring_close_hips import get_hips
from audit_sparring_phases import decide, interval

ROOT = Path("round-exports")
FOLDER = ROOT / "kick-comparison/human-validation"
OFFSETS = (-500, -250, 0, 250, 500)
# Body centres checked on the original frame strips, in 480 x 270 coordinates.
MANUAL = {
    "H": ([210, 218, 227, 224, 218], 135, 105, 128),
    "I": ([302, 324, 342, 367, 378], 76, 82, 95),
    "J": ([148, 155, 184, 188, 209], 143, 121, 194),
    "L": ([330, 303, 288, 302, 328], 136, 132, 201),
}


class TiledDetector:
    """Use overlapping views so a distant person occupies more detector pixels."""

    def __init__(self, model):
        self.model = model

    def __call__(self, images):
        merged = []
        for image in images:
            height, width = image.shape[-2:]
            tile_h, tile_w = round(height * .64), round(width * .62)
            origins = [(0, 0), (width-tile_w, 0),
                       (0, height-tile_h), (width-tile_w, height-tile_h)]
            views = [image]
            views.extend(image[:, y:y+tile_h, x:x+tile_w] for x, y in origins)
            results = self.model(views)
            boxes, scores = [], []
            for index, (result, (x, y)) in enumerate(zip(results, [(0, 0), *origins])):
                valid = (result["labels"] == 1) & (result["scores"] >= .28)
                values = result["boxes"][valid]
                confidence = result["scores"][valid]
                if index:
                    # Avoid boxes cut off at an internal tile edge.
                    complete = torch.ones(len(values), dtype=torch.bool)
                    if x:
                        complete &= values[:, 0] >= 3
                    if x + tile_w < width:
                        complete &= values[:, 2] <= tile_w - 3
                    if y:
                        complete &= values[:, 1] >= 3
                    if y + tile_h < height:
                        complete &= values[:, 3] <= tile_h - 3
                    values, confidence = values[complete], confidence[complete]
                boxes.append(values + torch.tensor([x, y, x, y]))
                scores.append(confidence)
            boxes, scores = torch.cat(boxes), torch.cat(scores)
            keep = nms(boxes, scores, .48)
            merged.append({"boxes": boxes[keep], "scores": scores[keep],
                           "labels": torch.ones(len(keep), dtype=torch.int64)})
        return merged


def read_exchange(case):
    cap = cv2.VideoCapture(str(ROOT / case["source"]))
    frames, offsets = [], []
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            raise ValueError(f"Could not open {case['source']}")
        first = max(0, round((case["anchor_ms"] - 850) * fps / 1000))
        cap.set(cv2.CAP_PROP_POS_FRAMES, first)
        for index in range(round(1.70 * fps) + 1):
            ok, frame = cap.read()
            if not ok:
                break
            offsets.append(round((first + index) * 1000 / fps - case["anchor_ms"]))
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        cap.release()
    if not frames or offsets[-1] < 500:
        raise ValueError(f"Incomplete exchange in clip {case['id']}")
    return frames, offsets


def manual_boxes(case, offsets, width, height):
    hints, y, w, h = MANUAL[case["id"]]
    boxes = []
    for offset in offsets:
        x = float(np.interp(offset, OFFSETS, hints))
        boxes.append((
            np.array([max(0, x-w/2) * width / 480, max(0, y-h/2) * height / 270,
                      min(480, x+w/2) * width / 480, min(270, y+h/2) * height / 270]),
            1.0,
        ))
    return boxes


def seed_once(detector, frames, offsets, reference):
    """Use one checked starting box, then associate detections by position and size."""
    stride = DETECT_EVERY
    seed = min(range(0, len(offsets), stride), key=lambda i: abs(offsets[i] + 500))
    previous = reference[seed][0]
    midpoint = (previous[:2] + previous[2:]) / 2
    path = [(None, 0.0)] * len(frames[::stride])
    misses = 0
    with torch.inference_mode():
        for index in range(seed, len(frames), stride):
            frame = frames[index]
            view = torch.from_numpy(frame).permute(2, 0, 1).float() / 255
            output = detector([view])[0]
            boxes = output["boxes"][output["scores"] >= .28].numpy()
            boxes = [box for box in boxes if box[3] - box[1] >= frame.shape[0] * .14]
            if index == seed:
                boxes = [box for box in boxes if np.linalg.norm((box[:2] + box[2:]) / 2 - midpoint)
                         <= frame.shape[1] * .065]
            scores = sorted((transition(previous, box), j) for j, box in enumerate(boxes))
            if not scores or scores[0][0] > (1.8 if index == seed else .95 + misses * .20):
                misses += 1
                if misses > 3 or index == seed:
                    break
                continue
            previous = boxes[scores[0][1]]
            misses = 0
            path[index // stride] = (previous, 1.0)
    return path


def sustained_onset(series):
    """First sustained directional excursion after a gap-free initial baseline."""
    known = [(t, float(np.degrees(yaw))) for t, yaw, _ in series
             if yaw is not None and -550 <= t <= 500]
    runs = []
    for point in known:
        if not runs or point[0] - runs[-1][-1][0] > 100:
            runs.append([])
        runs[-1].append(point)
    # A turn detected only after a gap may have started inside the gap.
    if not runs or runs[0][0][0] > -400:
        return {"estimate": "insufficient_pose", "onset_ms": None}
    run = runs[0]
    smooth = np.array([np.median([yaw for _, yaw in run[max(0, i - 1):i + 2]])
                       for i in range(len(run))])
    for i, (start, _) in enumerate(run):
        for j in range(i + 2, len(run)):
            elapsed = run[j][0] - start
            if elapsed < 120:
                continue
            if elapsed > 300:
                break
            delta = smooth[j] - smooth[i]
            travel = np.abs(np.diff(smooth[i:j + 1])).sum()
            early = max((k for k in range(i + 1, j + 1) if run[k][0] - start <= 85),
                        default=i)
            first_change = (smooth[early] - smooth[i]) * np.sign(delta)
            if abs(delta) >= 50 and first_change >= 12 and abs(delta) / max(travel, 1) >= .80:
                if abs(start) <= 80:
                    verdict = "ambiguous_order"
                else:
                    verdict = "turn_then_kick" if start < 0 else "kick_then_turn"
                return {"estimate": verdict, "onset_ms": start,
                        "confirm_ms": run[j][0], "rotation_degrees": round(float(delta), 1)}
    return {"estimate": "insufficient_pose" if run[-1][0] < 300 else "no_clear_turn",
            "onset_ms": None}


def prediction(frames, offsets, path, stride, athlete, options):
    confirmations = sum(box is not None and evidence >= .10 for box, evidence in path)
    samples, previews = [], {}
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as pose:
        for index, (frame, offset) in enumerate(zip(frames, offsets)):
            box, evidence = path[index // stride]
            valid_crop = box is not None and evidence >= -.12 and confirmations >= 2
            yaw, count = None, 0
            if valid_crop:
                crop = magnify(frame, box)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=crop)
                observed = pose.detect_for_video(image, offset - offsets[0])
                yaw, count, _ = get_hips(observed, crop, athlete)
            else:
                crop = np.zeros((384, 384, 3), dtype=np.uint8)
            samples.append((offset, yaw, count))
            for stamp in (-400, -200, 0, 200, 400):
                distance = abs(offset - stamp)
                if distance < previews.get(stamp, (float("inf"), None))[0]:
                    tile = cv2.resize(cv2.cvtColor(crop, cv2.COLOR_RGB2BGR), (128, 128))
                    cv2.putText(tile, f"{offset:+}ms", (3, 120), 0, .42, (0, 255, 255), 1)
                    previews[stamp] = (distance, tile)
    corrected = stable_axis(samples)
    before, after = interval(corrected, -500, 0), interval(corrected, 0, 500)
    return {"crop_fraction": round(sum(box is not None for box, _ in path) / len(path), 2),
            "before": before, "after": after, "estimate": decide(before, after),
            "onset_check": sustained_onset(corrected)}, [
                previews[stamp][1] for stamp in sorted(previews)
            ]


def main():
    cv2.setNumThreads(1)
    torch.set_num_threads(4)
    data = json.loads((FOLDER / "cases.json").read_text(encoding="utf-8-sig"))
    detector = ssdlite320_mobilenet_v3_large(weights=None, weights_backbone=None, num_classes=91)
    weights = ROOT / "video-encoder/ssdlite320_mobilenet_v3_large_coco-a79551df.pth"
    detector.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    detector.eval()
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(ROOT / "pose-model/pose_landmarker_lite.task")),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=2,
    )
    report, panels = [], []
    for case in data["cases"]:
        clip = case["id"]
        if clip not in MANUAL:
            continue
        frames, offsets = read_exchange(case)
        h, w = frames[0].shape[:2]
        resized = [cv2.resize(f, (640, round(h * 640 / w))) for f in frames]
        row = {"clip": clip, "human_verdict": case["human_verdict"], "source_size": [w, h]}
        red = case["athlete"] == "red"
        athlete = "A" if red else "B"
        manual = manual_boxes(case, offsets, w, h)
        conditions = [
            ("auto_640", resized, track(detector, resized, red), DETECT_EVERY),
            ("tiled_auto_original", frames, track(TiledDetector(detector), frames, red), DETECT_EVERY),
            ("manual_original", frames, manual, 1),
        ]
        if clip == "I":
            conditions.append(("seeded_original", frames,
                               seed_once(TiledDetector(detector), frames, offsets, manual), DETECT_EVERY))
        for mode, sequence, path, stride in conditions:
            outcome, tiles = prediction(sequence, offsets, path, stride, athlete, options)
            row[mode] = outcome
            heading = np.zeros((24, 640, 3), dtype=np.uint8)
            cv2.putText(heading, f"{clip} {mode}", (4, 16), 0, .5, (230, 230, 230), 1)
            panels.append(np.vstack((heading, np.hstack(tiles))))
        report.append(row)
        print(json.dumps(row), flush=True)
    (FOLDER / "source-crop-audit.json").write_text(json.dumps({
        "scope": "Four diagnostic cases. Kick times and athlete colours supplied; same pose logic in each condition.",
        "cases": report,
    }, indent=2) + "\n", encoding="utf-8")
    cv2.imwrite(str(FOLDER / "source-crop-audit.jpg"), np.vstack(panels))


if __name__ == "__main__":
    main()
