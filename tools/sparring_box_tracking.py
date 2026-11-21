"""Associate person boxes and recover short detector gaps from image motion."""

from dataclasses import dataclass
from functools import lru_cache
from math import log

import cv2
import numpy as np


@dataclass
class Track:
    box: np.ndarray
    points: np.ndarray | None
    appearance: np.ndarray | None = None
    missed: int = 0


@dataclass(frozen=True)
class Observation:
    track: int
    box: tuple[int, int, int, int]
    detection: int | None


def torso_point(box):
    left, top, right, bottom = box
    return np.array([(left + right) / 2, top + .31 * (bottom - top)])


def overlap(first, second):
    intersection = np.maximum(0, np.minimum(first[2:], second[2:]) - np.maximum(first[:2], second[:2]))
    shared = float(np.prod(intersection))
    return shared / (np.prod(first[2:] - first[:2]) + np.prod(second[2:] - second[:2]) - shared)


def match_cost(first, second, missed):
    height = first[3] - first[1]
    other_height = second[3] - second[1]
    distance = np.linalg.norm(torso_point(first) - torso_point(second)) / height
    scale_change = abs(log(other_height / height))
    if distance > .40 or scale_change > .48:
        return None
    return float(1.4 * distance + .26 * scale_change + .22 * (1 - overlap(first, second)) + .03 * missed)


def appearance_distance(first, second):
    if first is None or second is None:
        return 0.0
    return float(np.abs(first - second).sum() / 6)


def associate(predictions, detections, tracks, appearances):
    costs = []
    for box, track in zip(predictions, tracks, strict=True):
        row = []
        for observed, appearance in zip(detections, appearances, strict=True):
            geometry = match_cost(box, observed, track.missed)
            distance = appearance_distance(track.appearance, appearance)
            row.append(None if geometry is None else geometry + .45 * distance)
        costs.append(row)

    @lru_cache(maxsize=None)
    def choose(row, used):
        if row == len(costs):
            return 0.0, ()
        remaining_cost, tail = choose(row + 1, used)
        best = (remaining_cost + .58, (None,) + tail)
        for column, value in enumerate(costs[row]):
            bit = 1 << column
            if value is None or used & bit:
                continue
            rest, matches = choose(row + 1, used | bit)
            if value + rest < best[0]:
                best = value + rest, (column,) + matches
        return best

    return choose(0, 0)[1]


def torso_region(image, box):
    left, top, right, bottom = box.round().astype(int)
    width, height = right - left, bottom - top
    x1, x2 = left + round(.25 * width), right - round(.25 * width)
    y1, y2 = top + round(.09 * height), top + round(.53 * height)
    return image[y1:y2, x1:x2], (x1, y1)


def feature_points(gray, box):
    region, origin = torso_region(gray, box)
    if min(region.shape[:2]) < 5:
        return None
    points = cv2.goodFeaturesToTrack(region, maxCorners=24, qualityLevel=.018, minDistance=4)
    return None if points is None else points + np.array(origin, dtype=np.float32)


def appearance_signature(rgb, box):
    if rgb is None:
        return None
    region, _ = torso_region(rgb, box)
    if min(region.shape[:2]) < 5:
        return None
    sample = cv2.resize(region, (24, 24), interpolation=cv2.INTER_AREA)
    channels = [np.bincount(sample[:, :, channel].ravel() // 16, minlength=16) / 576
                for channel in range(3)]
    return np.concatenate(channels)


def flow_update(previous, gray, track):
    points = track.points
    if points is None or len(points) < 4:
        return track.box, None
    params = {"winSize": (19, 19), "maxLevel": 2}
    forward, valid, _ = cv2.calcOpticalFlowPyrLK(previous, gray, points, None, **params)
    if forward is None:
        return track.box, None
    backward, returned, _ = cv2.calcOpticalFlowPyrLK(gray, previous, forward, None, **params)
    if backward is None:
        return track.box, None
    error = np.linalg.norm((backward - points).reshape(-1, 2), axis=1)
    moves = (forward - points).reshape(-1, 2)
    good = (valid[:, 0] == 1) & (returned[:, 0] == 1) & (error <= 1.5)
    if np.count_nonzero(good) < 4:
        return track.box, None
    motion = np.median(moves[good], axis=0)
    height = track.box[3] - track.box[1]
    good &= np.linalg.norm(moves - motion, axis=1) <= max(2.5, .035 * height)
    if np.count_nonzero(good) < 4 or np.linalg.norm(motion) > .22 * height:
        return track.box, None
    shift = np.median(moves[good], axis=0)
    limit = np.array([gray.shape[1], gray.shape[0]] * 2)
    shifted = np.clip(track.box + np.tile(shift, 2), 0, limit)
    if np.any(shifted[2:] - shifted[:2] < 2):
        return track.box, None
    return shifted, forward[good]


class BoxTracker:
    def __init__(self, max_gap_frames=6):
        self.max_gap_frames = max_gap_frames
        self.previous = None
        self.tracks = {}
        self.next_id = 1

    def update(self, gray, boxes, rgb=None):
        detections = [np.asarray(box, dtype=np.float64) for box in boxes]
        appearances = [appearance_signature(rgb, box) for box in detections]
        track_ids = list(self.tracks)
        estimates = [flow_update(self.previous, gray, self.tracks[key]) for key in track_ids]
        matches = associate([box for box, _ in estimates], detections,
                            list(self.tracks.values()), appearances)
        observations = []
        for key, match, (predicted, points) in zip(track_ids, matches, estimates):
            old = self.tracks[key]
            if match is not None:
                box = detections[match]
                appearance = appearances[match]
                if old.appearance is not None:
                    appearance = old.appearance if appearance is None else .75 * old.appearance + .25 * appearance
                self.tracks[key] = Track(box, feature_points(gray, box), appearance)
                observations.append(Observation(key, tuple(map(int, box)), match))
            elif old.missed < self.max_gap_frames:
                self.tracks[key] = Track(predicted, points, old.appearance, old.missed + 1)
                if points is not None:
                    observations.append(Observation(key, tuple(map(int, predicted.round())), None))
            else:
                del self.tracks[key]
        used = set(matches)
        for index, box in enumerate(detections):
            if index not in used:
                key = self.next_id
                self.next_id += 1
                self.tracks[key] = Track(box, feature_points(gray, box), appearances[index])
                observations.append(Observation(key, tuple(map(int, box)), index))
        self.previous = gray
        return observations


def bracketed_observations(sequence):
    """Retain optical-flow boxes only inside gaps bracketed by detections."""
    ends = {}
    for index, frame in enumerate(sequence):
        for observation in frame:
            if observation.detection is not None:
                first, _ = ends.get(observation.track, (index, index))
                ends[observation.track] = first, index
    return [[item for item in frame if item.detection is not None or
             (ends[item.track][0] < index < ends[item.track][1])]
            for index, frame in enumerate(sequence)]
