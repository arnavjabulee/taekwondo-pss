"""Prepare sparring clips from a scoreboard or visually reviewed timestamps.

Requires Python with opencv-python. Reference times are seconds into the source
at which each round label is clearly visible, in round order.
"""

import argparse
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np


def crop_box(frame, box):
    height, width = frame.shape[:2]
    x, y, w, h = box
    x1, x2 = round(width * x / 960), round(width * (x + w) / 960)
    y1, y2 = round(height * y / 540), round(height * (y + h) / 540)
    return cv2.resize(frame[y1:y2, x1:x2], (w, h))


def read_frame(video, seconds):
    video.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
    ok, frame = video.read()
    return frame if ok else None


def read_at(video, seconds, round_boxes, clock_box, bright_clock):
    frame = read_frame(video, seconds)
    if frame is None:
        return None
    label = np.concatenate([
        (cv2.cvtColor(crop_box(frame, box), cv2.COLOR_BGR2GRAY) > 165).ravel()
        for box in round_boxes
    ])
    clock = cv2.cvtColor(crop_box(frame, clock_box), cv2.COLOR_BGR2GRAY)
    return label, clock > 175 if bright_clock else clock < 95


def scan(video, references, duration, step, padding, gap, round_boxes=((91, 75, 32, 15),),
         clock_box=(31, 76, 43, 13), bright_clock=False):
    def sample(time):
        return read_at(video, time, round_boxes, clock_box, bright_clock)

    templates = []
    for time in references:
        result = sample(time)
        if result is None or np.count_nonzero(result[0]) < 20:
            raise ValueError(f"No readable round label at reference time {time:g}s")
        templates.append(result[0])

    samples = [[] for _ in templates]
    for index in range(int(np.ceil(duration / step))):
        time = index * step
        result = sample(time)
        if result is None:
            continue
        label, clock = result
        errors = [int(np.count_nonzero(label != template)) for template in templates]
        best = int(np.argmin(errors))
        if errors[best] <= templates[best].size / 16 and .06 <= np.mean(clock) <= .54:
            samples[best].append((time, clock))

    rounds = []
    for number, matches in enumerate(samples, 1):
        changes = [
            (previous_time, time)
            for (previous_time, previous), (time, clock) in zip(matches, matches[1:])
            if time - previous_time <= 2 * step
            and np.mean(previous != clock) >= .039
        ]
        if len(changes) < 4:
            raise ValueError(f"Round {number}: too few verified clock changes")
        start = max(0, changes[0][0] - padding)
        end = min(duration, changes[-1][1] + padding)
        gaps = [
            {"start_s": before[1] + padding, "end_s": after[0] - padding}
            for before, after in zip(changes, changes[1:])
            if after[0] - before[1] >= gap and after[0] - before[1] > 2 * padding
        ]
        rounds.append({"round": number, "start_s": start, "end_s": end, "review_gaps": gaps})
    return rounds


def contact_sheets(video, output, duration, step):
    output.mkdir(parents=True, exist_ok=True)
    for start in range(0, int(np.ceil(duration / step)), 32):
        tiles = []
        for index in range(start, start + 32):
            time = index * step
            tile = np.zeros((180, 320, 3), dtype=np.uint8)
            if time < duration:
                frame = read_frame(video, time)
                if frame is not None:
                    tile = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
                cv2.rectangle(tile, (0, 155), (106, 179), (0, 0, 0), -1)
                cv2.putText(tile, f"{time:g}s", (4, 173), cv2.FONT_HERSHEY_SIMPLEX,
                            .6, (255, 255, 255), 1, cv2.LINE_AA)
            tiles.append(tile)
        sheet = np.vstack([np.hstack(tiles[i:i+4]) for i in range(0, 32, 4)])
        if not cv2.imwrite(str(output / f"contact-{start // 32 + 1:02d}.jpg"), sheet):
            raise OSError(f"Could not write contact sheet to {output}")


def export(video, path, start, end, fps, size):
    if path.exists():
        raise FileExistsError(path)
    # OpenCV's built-in MP4 writer encodes video only.
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    if not writer.isOpened():
        raise OSError(f"Could not open video writer for {path}")
    try:
        start_frame = round(start * fps)
        video.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        for _ in range(start_frame, min(round(end * fps), int(video.get(cv2.CAP_PROP_FRAME_COUNT)))):
            ok, frame = video.read()
            if not ok:
                raise OSError(f"Source stopped decoding while writing {path}")
            writer.write(frame)
    finally:
        writer.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--reference", type=float, nargs="+", help="One visible label time per round")
    mode.add_argument("--range", type=float, nargs=2, action="append", metavar=("START", "END"),
                      help="Reviewed interval in source seconds, repeat for each round")
    mode.add_argument("--contact-sheet", type=float, metavar="SECONDS",
                      help="Create contact sheets at this interval for footage without a readable clock")
    mode.add_argument("--manifest", type=Path, help="Reuse round ranges from a reviewed rounds.json")
    parser.add_argument("--round-box", type=int, nargs=4, action="append",
                        help="Round label or match ID crop as x y width height on a 960x540 preview")
    parser.add_argument("--clock-box", type=int, nargs=4,
                        help="Clock crop as x y width height on a 960x540 preview")
    parser.add_argument("--bright-clock", action="store_true", help="Clock uses light digits")
    parser.add_argument("--step", type=float, default=1)
    parser.add_argument("--padding", type=float, default=3)
    parser.add_argument("--gap", type=float, default=12)
    parser.add_argument("--export", action="store_true", help="Save one silent MP4 per detected round")
    parser.add_argument("--ffmpeg", help="FFmpeg executable for H.264 exports")
    args = parser.parse_args()
    if args.step <= 0 or args.padding < 0 or args.gap <= 0:
        parser.error("Step and gap must be positive, and padding must be nonnegative")

    boxes = (args.round_box or []) + ([args.clock_box] if args.clock_box else [])
    for x, y, w, h in boxes:
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 960 or y + h > 540:
            parser.error("Each crop must fit within the 960x540 preview")
    video = cv2.VideoCapture(str(args.video), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 2])
    try:
        fps = video.get(cv2.CAP_PROP_FPS)
        if not video.isOpened() or fps <= 0:
            parser.error(f"Could not open {args.video}")
        duration = video.get(cv2.CAP_PROP_FRAME_COUNT) / fps
        size = tuple(int(video.get(prop)) for prop in (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT))
        if args.contact_sheet is not None:
            if not 0 < args.contact_sheet:
                parser.error("Contact sheet interval must be positive")
            contact_sheets(video, args.output, duration, args.contact_sheet)
            return
        if args.manifest:
            metadata = json.loads(args.manifest.read_text(encoding="utf-8"))
            if Path(metadata["source"]).resolve() != args.video.resolve():
                parser.error("Manifest belongs to a different source video")
            rounds = metadata["rounds"]
            for number, item in enumerate(rounds, 1):
                if item["round"] != number or not 0 <= item["start_s"] < item["end_s"] <= duration:
                    parser.error("Manifest must contain numbered ranges within the source video")
        elif args.range:
            rounds = []
            previous_end = 0
            for number, (start, end) in enumerate(args.range, 1):
                if not previous_end <= start < end <= duration:
                    parser.error("Reviewed ranges must be chronological, disjoint, and within the source")
                rounds.append({"round": number, "start_s": start, "end_s": end, "review_gaps": []})
                previous_end = end
        else:
            settings = {}
            if args.round_box:
                settings["round_boxes"] = args.round_box
            if args.clock_box:
                settings["clock_box"] = args.clock_box
            rounds = scan(video, args.reference, duration, args.step, args.padding, args.gap,
                          bright_clock=args.bright_clock, **settings)
        args.output.mkdir(parents=True, exist_ok=True)
        if args.export:
            for item in rounds:
                path = args.output / f"round-{item['round']:02d}.mp4"
                if args.ffmpeg:
                    subprocess.run([args.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
                                    "-n", "-ss", str(item["start_s"]), "-i", str(args.video),
                                    "-t", str(item["end_s"] - item["start_s"]), "-map", "0:v:0",
                                    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
                                    "-threads", "3", "-movflags", "+faststart", str(path)], check=True)
                else:
                    export(video, path, item["start_s"], item["end_s"], fps, size)
                item["clip"] = path.name
        manifest = {"source": str(args.video.resolve()), "fps": fps, "duration_s": duration, "rounds": rounds}
        (args.output / "rounds.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, indent=2))
    finally:
        video.release()


if __name__ == "__main__":
    main()

