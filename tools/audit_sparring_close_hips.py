"""Measure hip rotation with manually placed athlete crops on the three spin anchors."""

import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np

from audit_sparring_phases import decide, interval
from sparring_pose import HEIGHT, WIDTH, chest_colour

ROOT = Path("round-exports")
FOLDER = ROOT / "kick-comparison/human-check"
TIMES = (.55, .75, .95, 1.15, 1.35, 1.55, 1.75)
# Approximate athlete centres picked from the original frames at TIMES.
CENTERS_X = {
    "A": (146, 157, 155, 145, 146, 135, 126),
    "C": (163, 166, 164, 134, 129, 169, 168),
    "D": (142, 145, 147, 139, 139, 143, 150),
}
SIZES = {"A": (148, 162), "C": (144, 162), "D": (102, 105)}


def crop_at(frame, clip, seconds):
    height, width = frame.shape[:2]
    x = np.interp(seconds, TIMES, CENTERS_X[clip])
    w, h = SIZES[clip]
    y = 86 if clip != "D" else 89
    x1, x2 = (round(value * width / 320) for value in (max(0, x-w/2), min(320, x+w/2)))
    y1, y2 = (round(value * height / 180) for value in (max(0, y-h/2), min(180, y+h/2)))
    image = frame[y1:y2, x1:x2]
    # Keep the court geometry proportional when magnifying the crop.
    scale = 384 / max(image.shape[:2])
    scaled = cv2.resize(image, (round(image.shape[1] * scale), round(image.shape[0] * scale)))
    top, left = (384 - scaled.shape[0]) // 2, (384 - scaled.shape[1]) // 2
    canvas = np.zeros((384, 384, 3), dtype=np.uint8)
    canvas[top:top + scaled.shape[0], left:left + scaled.shape[1]] = scaled
    return cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)


def get_hips(result, rgb, athlete):
    candidates = []
    for image, world in zip(result.pose_landmarks, result.pose_world_landmarks):
        if min(image[i].visibility for i in (23, 24)) < .55:
            continue
        x = (image[23].x + image[24].x) / 2
        if abs(x - .5) > .20:
            continue
        torso = np.array([(image[i].x * WIDTH, image[i].y * HEIGHT)
                          for i in (11, 12, 23, 24)])
        identity, _ = chest_colour(cv2.resize(rgb, (WIDTH, HEIGHT)), torso)
        if identity is not None and identity != athlete:
            continue
        axis = np.array([world[24].x - world[23].x, world[24].z - world[23].z])
        if np.linalg.norm(axis) >= .08:
            candidates.append((float(np.arctan2(axis[1], axis[0])), identity == athlete))
    exact = [yaw for yaw, confirmed in candidates if confirmed]
    if len(exact) == 1:
        return exact[0], len(candidates), True
    if not exact and len(candidates) == 1:
        return candidates[0][0], 1, False
    return None, len(candidates), False


def run(case, options, anchor):
    clip = case["id"]
    athlete = "A" if case["athlete"] == "red" else "B"
    cap = cv2.VideoCapture(str(FOLDER / f"{clip}.mp4"))
    samples = []
    preview = {}
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            raise ValueError(f"Cannot read clip {clip}")
        with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
            index = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                timestamp = round(index * 1000 / fps)
                index += 1
                rgb = crop_at(frame, clip, timestamp / 1000)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                detected = detector.detect_for_video(image, timestamp)
                yaw, candidates, confirmed = get_hips(detected, rgb, athlete)
                samples.append((timestamp, yaw, candidates, confirmed))
                for target in (750, 1000, 1250, 1500, 1750):
                    distance = abs(timestamp - target)
                    if distance < preview.get(target, (float("inf"), None))[0]:
                        thumb = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), (160, 160))
                        cv2.putText(thumb, f"{clip} {timestamp} ms", (4, 152), 0, .45, (255, 255, 0), 1)
                        preview[target] = (distance, thumb)
    finally:
        cap.release()
    both = [(time, yaw, candidates) for time, yaw, candidates, _ in samples]
    verified = [(time, yaw if confirmed else None, candidates)
                for time, yaw, candidates, confirmed in samples]
    result = {"clip": clip, "human_turn_start_ms": case["turn_start"]["approximate_clip_ms"]}
    for name, series in (("position_or_colour", both), ("colour_confirmed_only", verified)):
        before = interval(series, anchor-500, anchor)
        after = interval(series, anchor, anchor+500)
        result[name] = {"before": before, "after": after, "estimate": decide(before, after)}
    return result, [preview[time][1] for time in sorted(preview)]


def main():
    labels = json.loads((FOLDER / "cases.json").read_text(encoding="utf-8-sig"))
    cv2.setNumThreads(1)
    model = ROOT / "pose-model/pose_landmarker_lite.task"
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=2,
    )
    result, previews = [], []
    for case in labels["cases"]:
        if case["id"] in CENTERS_X:
            item, images = run(case, options, labels["anchor_in_export_ms"])
            result.append(item)
            if len(images) == 5:
                previews.append(np.hstack(images))
    report = {"method": "Manual athlete crop; identity grounded by position or visible protector colour.",
              "cases": result}
    (FOLDER / "close-hip-audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if previews:
        cv2.imwrite(str(FOLDER / "close-hip-crops.jpg"), np.vstack(previews))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
