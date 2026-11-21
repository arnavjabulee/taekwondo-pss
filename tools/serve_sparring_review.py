"""Serve the sparring review tool on the local machine."""

import csv
import json
import os
import re
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

TOOLS = Path(__file__).resolve().parent
DATA = TOOLS.parent / "round-exports"
MODEL = DATA / "baseline" / "model.npz"
POSE_DIR = DATA / "pose-baseline"
ATHLETE_POSE_DIR = DATA / "athlete-pose"
POSE_DEPS = DATA / "pose-deps"
POSE_LANDMARKER = DATA / "pose-model" / "pose_landmarker_lite.task"
VIDEO_DIR = DATA / "video-baseline"
VIDEO_DEPS = DATA / "video-deps"
VIDEO_WEIGHTS = DATA / "video-encoder" / "r3d_18-b3b3357e.pth"
SPIN_PILOT_SOURCE = "us-open-gergely"
SPIN_PILOT_PATH = DATA / "youtube-pilot" / "cross-source-top-one.json"
SPIN_PILOT_REVIEWS = SPIN_PILOT_PATH.with_name("spin-audit-reviews.json")
SPIN_ACTION = "spinning_kick_attempt"
CLIPS = {}
for manifest in sorted(DATA.glob("*/rounds.json")):
    for row in json.loads(manifest.read_text(encoding="utf-8-sig"))["rounds"]:
        clip = manifest.parent / row["clip"]
        if clip.is_file() and not row.get("exclude_from_training"):
            CLIPS[clip.relative_to(DATA).as_posix()] = clip
with (DATA / "sparring-labels.csv").open(newline="", encoding="utf-8-sig") as file:
    LABELS = list(csv.DictReader(file))
comparison_path = DATA / "kick-comparison" / "ordinary-kicks.json"
ORDINARY_EXAMPLES = (json.loads(comparison_path.read_text(encoding="utf-8-sig"))["clips"]
                     if comparison_path.is_file() else {})

CACHE = {}
PREDICTION_LOCK = threading.Lock()
SPIN_REVIEW_LOCK = threading.Lock()


def dependency_environment(directory):
    environment = dict(os.environ)
    environment["PYTHONPATH"] = os.pathsep.join(
        filter(None, (str(directory), environment.get("PYTHONPATH")))
    )
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return environment


def saved_events(clip):
    events = [{**row, "time_ms": int(row["time_ms"])} for row in LABELS if row["clip"] == clip]
    events.extend({"clip": clip, "time_ms": round(time * 1000), "action": "ordinary_kick",
                   "athlete_id": ""} for time in ORDINARY_EXAMPLES.get(clip, []))
    return sorted(events, key=lambda event: event["time_ms"])


def spin_pilot_rounds():
    try:
        results = json.loads(SPIN_PILOT_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return {name: results[path.name] for name, path in CLIPS.items()
            if path.parent.name == SPIN_PILOT_SOURCE and path.name in results}


def spin_reviews():
    try:
        return json.loads(SPIN_PILOT_REVIEWS.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


class ReviewHandler(BaseHTTPRequestHandler):
    def reply(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def json(self, data, status=200):
        self.reply(json.dumps(data).encode(), "application/json", status)

    def do_POST(self):
        if urlsplit(self.path).path != "/spin-pilot/reviews":
            self.send_error(404)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096 or self.headers.get_content_type() != "application/json":
                raise ValueError("Expected a JSON review.")
            payload = json.loads(self.rfile.read(size))
            name, time_ms, verdict = (payload[field] for field in ("clip", "time_ms", "verdict"))
            if not isinstance(name, str) or type(time_ms) is not int or verdict not in ("Confirmed", "Rejected", ""):
                raise ValueError("Invalid review.")
        except (KeyError, TypeError, ValueError) as error:
            self.json({"error": str(error)}, 400)
            return

        try:
            if not any(row["time_ms"] == time_ms for row in spin_pilot_rounds().get(name, [])):
                self.json({"error": "No spin pilot suggestion at that timestamp."}, 404)
                return
            with SPIN_REVIEW_LOCK:
                reviews = spin_reviews()
                per_clip = reviews.setdefault(name, {})
                if verdict:
                    per_clip[str(time_ms)] = verdict
                else:
                    per_clip.pop(str(time_ms), None)
                temporary = SPIN_PILOT_REVIEWS.with_suffix(".tmp")
                temporary.write_text(json.dumps(reviews, indent=2) + "\n", encoding="utf-8")
                temporary.replace(SPIN_PILOT_REVIEWS)
            self.json({"reviews": per_clip})
        except (ValueError, OSError) as error:
            self.json({"error": str(error)}, 500)

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        model = query.get("model", ["motion"])[0]
        if url.path == "/":
            self.reply((TOOLS / "review_sparring.html").read_bytes(), "text/html; charset=utf-8")
            return
        if url.path == "/clips":
            if model == "spin-pilot":
                try:
                    self.json(list(spin_pilot_rounds()))
                except (ValueError, OSError) as error:
                    self.json({"error": str(error)}, 500)
            else:
                self.json(list(CLIPS))
            return
        if url.path == "/models":
            models = ["motion"]
            if POSE_DEPS.is_dir() and POSE_LANDMARKER.is_file():
                models.extend(name for name, directory in (("pose", POSE_DIR), ("athlete-pose", ATHLETE_POSE_DIR))
                              if (directory / "model.npz").is_file())
            if VIDEO_DEPS.is_dir() and VIDEO_WEIGHTS.is_file() and (VIDEO_DIR / "model.npz").is_file():
                models.append("video")
            if SPIN_PILOT_PATH.is_file():
                models.append("spin-pilot")
            self.json(models)
            return

        name = query.get("clip", [""])[0]
        clip = CLIPS.get(name)
        if clip is None:
            self.send_error(404)
            return
        if url.path == "/video":
            self.video(clip)
        elif url.path == "/labels":
            self.json(saved_events(name))
        elif url.path == "/track":
            try:
                start, ax, ay, bx, by = (float(query[key][0]) for key in ("time", "ax", "ay", "bx", "by"))
                if not 0 <= start <= 86400 or not all(0 <= n <= 1 for n in (ax, ay, bx, by)):
                    raise ValueError("Invalid tracking coordinates or timestamp.")
                if str(POSE_DEPS) not in sys.path:
                    sys.path.insert(0, str(POSE_DEPS))
                from audit_sparring_tracking import seeded_tracks
                self.json(seeded_tracks(clip, start, ((ax, ay), (bx, by)), POSE_LANDMARKER))
            except (KeyError, ValueError, ImportError, RuntimeError, OSError) as error:
                self.json({"error": str(error)}, 400)
        elif url.path == "/predictions":
            if model == "spin-pilot":
                try:
                    predictions = spin_pilot_rounds().get(name)
                    with SPIN_REVIEW_LOCK:
                        reviews = spin_reviews().get(name, {})
                except (ValueError, OSError) as error:
                    self.json({"error": str(error)}, 500)
                    return
                if predictions is None:
                    self.json({"error": "No spin pilot result for this clip."}, 404)
                    return
                self.json({
                    "predictions": [{"time_ms": row["time_ms"], "action": SPIN_ACTION,
                                     "confidence": row["score"]} for row in predictions],
                    "labels": [row for row in saved_events(name) if row["action"] == SPIN_ACTION],
                    "reviews": reviews,
                })
                return
            environment = None
            if model == "motion":
                command = [str(TOOLS / "sparring_baseline.py"), "predict", str(MODEL), str(clip)]
            elif model in ("pose", "athlete-pose"):
                directory = ATHLETE_POSE_DIR if model == "athlete-pose" else POSE_DIR
                flags = ["--per-athlete"] if model == "athlete-pose" else []
                command = [str(TOOLS / "sparring_pose.py"), "--pose-model", str(POSE_LANDMARKER),
                           "--output", str(directory), *flags, "predict", str(clip)]
                environment = dependency_environment(POSE_DEPS)
            elif model == "video":
                command = [str(TOOLS / "sparring_video.py"), "--weights", str(VIDEO_WEIGHTS),
                           "--output", str(VIDEO_DIR), "predict", str(clip)]
                environment = dependency_environment(VIDEO_DEPS)
            else:
                self.json({"error": "Unknown detector."}, 400)
                return
            key = (name, model)
            try:
                with PREDICTION_LOCK:
                    if key not in CACHE:
                        process = subprocess.run(
                            [sys.executable, *command], capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=600, env=environment,
                        )
                        if process.returncode:
                            self.json({"error": process.stderr.strip() or "Detector failed."}, 500)
                            return
                        CACHE[key] = json.loads(process.stdout)
                self.json({"predictions": CACHE[key], "labels": saved_events(name)})
            except (subprocess.TimeoutExpired, ValueError, OSError) as error:
                self.json({"error": str(error)}, 500)
        else:
            self.send_error(404)

    def video(self, clip):
        size = clip.stat().st_size
        start, end = 0, size - 1
        request_range = self.headers.get("Range")
        if request_range:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", request_range)
            if match and (match[1] or match[2]):
                if match[1]:
                    start = int(match[1])
                    end = min(int(match[2]), end) if match[2] else end
                else:
                    start = max(0, size - int(match[2]))
            else:
                start = size
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
        self.send_response(206 if request_range else 200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        remaining = end - start + 1
        self.send_header("Content-Length", str(remaining))
        if request_range:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with clip.open("rb") as file:
            file.seek(start)
            try:
                while remaining:
                    chunk = file.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), ReviewHandler)
    address = "http://127.0.0.1:8765/"
    if "--spin-pilot" in sys.argv:
        address += "?model=spin-pilot"
    print(f"Sparring review is running at {address}", flush=True)
    if "--no-browser" not in sys.argv:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

