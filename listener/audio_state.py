"""Deterministic timing and interruption policy; no audio/ML dependencies.

The worker holds its lock when calling these methods. Sample blocks are 100 ms.
"""
from collections import deque
from dataclasses import dataclass


@dataclass
class Snapshot:
    epoch: int
    segment: int
    serial: int
    voice_serial: int
    blocks: list


class AudioWindow:
    interval = 0.5  # start-to-start: inference time is not added to an idle delay
    minimum_blocks = 8
    pause_blocks = 12

    def __init__(self):
        self.blocks = deque(maxlen=40)
        self.epoch = 0
        self.segment = 0
        self.serial = 0
        self.voice_serial = -1
        self.quiet = 0
        self.enabled = True
        self.ended = False
        self.gap_reported = False
        self.events = deque()
        self.last_start = float('-inf')
        self.last_voice_decoded = -1
        self.last_rejection = None

    def context(self, epoch, enabled):
        self.epoch = epoch
        self.enabled = enabled
        self.segment += 1
        self.blocks.clear()
        self.events.clear()
        self.quiet = 0
        self.voice_serial = -1
        self.last_voice_decoded = -1
        self.gap_reported = False
        self.last_start = float('-inf')
        self.last_rejection = None

    def append(self, block, voiced):
        if not self.enabled:
            return
        self.serial += 1
        self.blocks.append((self.serial, block))
        if voiced:
            self.voice_serial = self.serial
            self.quiet = 0
            self.gap_reported = False
        else:
            self.quiet += 1
            if self.voice_serial >= 0 and self.quiet >= self.pause_blocks and not self.gap_reported:
                self.invalidate('silence', self.serial)
                self.gap_reported = True

    def invalidate(self, reason, through_serial):
        self.segment += 1
        # Preserve samples captured after a slow inference snapshot. They may
        # already contain resumed Arabic and must not be thrown away with it.
        self.blocks = deque((item for item in self.blocks if item[0] > through_serial), maxlen=40)
        self.events.append({'type': 'interruption', 'epoch': self.epoch,
                            'segment': self.segment, 'reason': reason})

    def snapshot(self, now):
        endpoint = self.quiet >= 3 and self.quiet < self.pause_blocks
        if (not self.enabled or len(self.blocks) < self.minimum_blocks or
                self.voice_serial <= self.last_voice_decoded or self.quiet >= self.pause_blocks or
                (now - self.last_start < self.interval and not endpoint)):
            return None
        self.last_start = now
        self.last_voice_decoded = self.voice_serial
        return Snapshot(self.epoch, self.segment, self.serial, self.voice_serial,
                        [block for _, block in self.blocks])

    def valid(self, snapshot):
        return self.enabled and snapshot.epoch == self.epoch and snapshot.segment == self.segment

    def reject(self, snapshot, reason):
        if not self.valid(snapshot):
            return
        # Each rejection flushes its audio, but only a reason change needs a new
        # recovery event. This keeps continuous English from flooding admin.
        if self.last_rejection != reason:
            self.invalidate(reason, snapshot.serial)
        else:
            self.blocks = deque((item for item in self.blocks if item[0] > snapshot.serial), maxlen=40)
        self.last_rejection = reason

    def drain_events(self):
        events = list(self.events)
        self.events.clear()
        return events


def language_decision(probabilities):
    """Whisper's language-token probabilities are heuristics, not guarantees."""
    if not probabilities:
        return 'uncertain'
    ranked = sorted(probabilities.items(), key=lambda item: item[1], reverse=True)
    language, probability = ranked[0]
    margin = probability - (ranked[1][1] if len(ranked) > 1 else 0)
    # Short Arabic syllables can spread probability across related languages.
    # Accept a clearly dominant Arabic winner, while close/mixed votes hold.
    if language == '<|ar|>' and ((probability >= 0.55 and margin >= 0.15) or
                                 (probability >= 0.35 and margin >= 0.2)):
        return 'arabic'
    if language != '<|ar|>' and probability >= 0.55 and margin >= 0.15:
        return 'non_arabic'
    return 'uncertain'
