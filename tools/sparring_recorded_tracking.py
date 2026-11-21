"""Reconnect fighter tracks across short gaps using both sides of the recording."""

from collections import defaultdict
from dataclasses import dataclass, replace
from functools import lru_cache
from itertools import groupby

import cv2
import numpy as np

from sparring_box_tracking import (
    BoxTracker,
    Observation,
    Track,
    appearance_distance,
    appearance_signature,
    bracketed_observations,
    feature_points,
    flow_update,
    overlap,
    torso_point,
)


@dataclass(frozen=True)
class Reattachment:
    track_before: int
    track_after: int
    last_seen: int
    first_seen_again: int
    confirmed_at: int


@dataclass
class RecordedTracks:
    observations: list[list[Observation]]
    reattachments: list[Reattachment]
    recovered_at: dict[tuple[int, int], int]


def tracking_pass(frame_at, boxes, max_gap_frames, reverse=False):
    tracker = BoxTracker(max_gap_frames=max_gap_frames)
    observations = [[] for _ in boxes]
    indices = range(len(boxes) - 1, -1, -1) if reverse else range(len(boxes))
    for index in indices:
        rgb = frame_at(index)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        observations[index] = tracker.update(gray, boxes[index], rgb=rgb)
    return observations


def direct_runs(observations):
    runs = defaultdict(list)
    for index, frame in enumerate(observations):
        for item in frame:
            if item.detection is not None:
                runs[item.track].append((index, item))
    return runs


def endpoint_appearance(frame_at, rows):
    signatures = [appearance_signature(frame_at(index), np.asarray(item.box))
                  for index, item in rows]
    known = [row for row in signatures if row is not None]
    return None if not known else np.mean(known, axis=0)


def link_runs(frame_at, direct, reverse, max_gap_frames):
    forward_ids = {(index, item.detection): track for track, rows in direct.items()
                   for index, item in rows}
    candidates = []
    for reverse_rows in direct_runs(reverse).values():
        groups = [(key, list(rows)) for key, rows in groupby(
            reverse_rows, key=lambda row: forward_ids[row[0], row[1].detection])]
        for (first, prior), (second, following) in zip(groups, groups[1:]):
            if len(prior) < 2 or len(following) < 2:
                continue
            last, first_again = prior[-1][0], following[0][0]
            confirmed = following[1][0]
            if last != direct[first][-1][0] or first_again != direct[second][0][0]:
                continue
            if not 1 <= first_again - last - 1 <= max_gap_frames or confirmed - first_again > 3:
                continue
            before = endpoint_appearance(frame_at, prior[-3:])
            after = endpoint_appearance(frame_at, following[:2])
            if before is None or after is None or appearance_distance(before, after) > .29:
                continue
            candidates.append(Reattachment(first, second, last, first_again, confirmed))
    # An ambiguous one-to-many link stays split.
    return [link for link in candidates
            if sum(other.track_before == link.track_before for other in candidates) == 1
            and sum(other.track_after == link.track_after for other in candidates) == 1]


def trace_boxes(gray_at, start, stop, initial_box):
    previous = gray_at(start)
    box = np.asarray(initial_box, dtype=float)
    track = Track(box, feature_points(previous, box))
    direction = 1 if stop > start else -1
    path = {}
    for index in range(start + direction, stop, direction):
        gray = gray_at(index)
        box, points = flow_update(previous, gray, track)
        if points is None:
            break
        path[index] = box
        previous, track = gray, Track(box, points)
    return path


def bridge_gap(gray_at, left, right, observations):
    start, first = left
    stop, last = right
    forward = trace_boxes(gray_at, start, stop, first.box)
    backward = trace_boxes(gray_at, stop, start, last.box)
    for index in sorted(forward.keys() & backward.keys()):
        before, after = forward[index], backward[index]
        if overlap(before, after) < .40:
            continue
        box = (before + after) / 2
        height = box[3] - box[1]
        if np.linalg.norm(torso_point(before) - torso_point(after)) > .13 * height:
            continue
        if any(item.track != first.track and item.detection is not None and
               overlap(box, np.asarray(item.box)) > .46 for item in observations[index]):
            continue
        yield index, Observation(first.track, tuple(map(int, box.round())), None)


def recover_recording(frame_at, boxes, max_gap_frames=18):
    """Review recorded detections. frame_at(index) supplies the original RGB frames.

    recovered_at maps (frame index, track ID) to the confirming detection frame.
    A buffered caller can replay that prefix after reacquisition.
    """
    primary = tracking_pass(frame_at, boxes, max_gap_frames=6)
    reverse = tracking_pass(frame_at, boxes, max_gap_frames=max_gap_frames, reverse=True)
    direct = direct_runs(primary)
    links = link_runs(frame_at, direct, reverse, max_gap_frames)
    roots = {}
    for link in sorted(links, key=lambda row: row.first_seen_again):
        roots[link.track_after] = roots.get(link.track_before, link.track_before)
    observations = [[replace(item, track=roots.get(item.track, item.track)) for item in frame]
                    for frame in bracketed_observations(primary)]
    confirmations = {(roots.get(link.track_before, link.track_before), link.first_seen_again):
                     link.confirmed_at for link in links}
    recovered_at = {}

    @lru_cache(maxsize=max(2, max_gap_frames + 2))
    def gray_at(index):
        return cv2.cvtColor(frame_at(index), cv2.COLOR_RGB2GRAY)

    for track, rows in direct_runs(observations).items():
        for left, right in zip(rows, rows[1:]):
            if not 1 <= right[0] - left[0] - 1 <= max_gap_frames:
                continue
            for index, item in bridge_gap(gray_at, left, right, observations):
                if not any(candidate.track == track for candidate in observations[index]):
                    observations[index].append(item)
                    recovered_at[index, track] = confirmations.get((track, right[0]), right[0])
    return RecordedTracks(observations, links, recovered_at)
