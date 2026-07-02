"""
Lenient Standard MIDI File parsing for the alignment worker.

Hand-rolled (not mido / @tonejs/midi) because the U1 spike found real seed files
that strict parsers reject ("no MTrk header"). Produces note events + tempo/
time-signature maps; everything the chroma templates and measure mapping need.
"""
from dataclasses import dataclass


@dataclass
class Reference:
    ppq: int
    notes: list          # (start_tick, end_tick, pitch)
    tempo_map: list       # (tick, us_per_beat) sorted
    timesig_map: list     # (tick, num, den) sorted
    max_tick: int

    def tick_to_sec(self, tick):
        sec, last, cur = 0.0, 0, self.tempo_map[0][1]
        for ev_tick, us in self.tempo_map[1:] + [(self.max_tick + 1, self.tempo_map[-1][1])]:
            seg_end = min(tick, ev_tick)
            if seg_end > last:
                sec += (seg_end - last) / self.ppq * (cur / 1_000_000)
            if ev_tick >= tick:
                break
            last, cur = ev_tick, us
        return sec

    def total_sec(self):
        return self.tick_to_sec(self.max_tick)

    def total_measures(self):
        measures, last = 0.0, 0
        num, den = self.timesig_map[0][1], self.timesig_map[0][2]
        for ev_tick, n, d in self.timesig_map[1:] + [(self.max_tick + 1, num, den)]:
            seg_end = min(self.max_tick, ev_tick)
            if seg_end > last:
                measures += (seg_end - last) / (self.ppq * 4 * num / den)
            if ev_tick >= self.max_tick:
                break
            last, num, den = ev_tick, n, d
        return measures

    def measure_starts_sec(self):
        """Start time (seconds) of each measure, in order — measure k (1-based)
        starts at result[k-1]. Walks the time-signature map; a time-signature
        change mid-measure truncates that measure and starts a new one at the
        change (matching total_measures' fractional accounting). This is the
        frames->measure table segment alignment uses (plan U2/KTD4)."""
        starts = []
        last = 0
        num, den = self.timesig_map[0][1], self.timesig_map[0][2]
        for ev_tick, n, d in self.timesig_map[1:] + [(self.max_tick + 1, num, den)]:
            seg_end = min(self.max_tick, ev_tick)
            mlen = self.ppq * 4 * num / den
            t = float(last)
            while t < seg_end:
                starts.append(self.tick_to_sec(int(t)))
                t += mlen
            if ev_tick >= self.max_tick:
                break
            last, num, den = ev_tick, n, d
        return starts or [0.0]


def _read_varlen(buf, p):
    val = 0
    while True:
        b = buf[p]; p += 1
        val = (val << 7) | (b & 0x7F)
        if not (b & 0x80):
            return val, p


def parse_smf(data: bytes) -> Reference:
    assert data[:4] == b"MThd", "not a MIDI file"
    ppq = int.from_bytes(data[12:14], "big")
    if ppq & 0x8000:
        ppq = 480
    ntracks = int.from_bytes(data[10:12], "big")
    p = 14
    notes, tempo_map, timesig_map = [], [], []
    for _ in range(ntracks):
        if data[p:p + 4] != b"MTrk":
            break
        length = int.from_bytes(data[p + 4:p + 8], "big")
        p += 8
        end = min(p + length, len(data))
        tick, running, pending = 0, 0, {}
        while p < end:
            dt, p = _read_varlen(data, p)
            tick += dt
            status = data[p]
            if status & 0x80:
                p += 1; running = status
            else:
                status = running
            hi = status & 0xF0
            if status == 0xFF:
                mtype = data[p]; p += 1
                mlen, p = _read_varlen(data, p)
                chunk = data[p:p + mlen]; p += mlen
                if mtype == 0x51 and mlen == 3:
                    tempo_map.append((tick, (chunk[0] << 16) | (chunk[1] << 8) | chunk[2]))
                elif mtype == 0x58 and mlen >= 2:
                    timesig_map.append((tick, chunk[0], 1 << chunk[1]))
            elif status in (0xF0, 0xF7):
                slen, p = _read_varlen(data, p); p += slen
            elif hi == 0x90:
                pitch, vel = data[p], data[p + 1]; p += 2
                if vel > 0:
                    pending.setdefault(pitch, []).append(tick)
                elif pending.get(pitch):
                    notes.append((pending[pitch].pop(0), tick, pitch))
            elif hi == 0x80:
                pitch = data[p]; p += 2
                if pending.get(pitch):
                    notes.append((pending[pitch].pop(0), tick, pitch))
            elif hi in (0xA0, 0xB0, 0xE0):
                p += 2
            elif hi in (0xC0, 0xD0):
                p += 1
            else:
                p += 1
        p = end
    if not notes:
        raise ValueError("MIDI contains no notes")
    if not tempo_map:
        tempo_map = [(0, 500000)]
    if not timesig_map:
        timesig_map = [(0, 4, 4)]
    tempo_map.sort(); timesig_map.sort()
    max_tick = max(e for _, e, _ in notes)
    return Reference(ppq, notes, tempo_map, timesig_map, max_tick)
