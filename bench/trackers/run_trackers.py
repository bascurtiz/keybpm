#!/usr/bin/env python3
"""Run outside beat trackers over a corpus and write their beats for scoring.

The benchmark's question is "which analyzer gives the best grid", and answering it
means running the candidates on the same audio and scoring them with the same
metrics. `scripts/bench-beats.mjs` already owns the scoring side; this owns the
other side: it runs each tracker and caches its output as a MIR-standard `.beats`
file, one directory per tracker:

    bench/trackers/out/beat_this/house-128-steady.beats
    bench/trackers/out/librosa-beat/house-128-steady.beats

That cache is what `node scripts/bench-beats.mjs --corpus DIR --trackers bench/trackers/out`
reads, converts into the grid a DJ would get, and scores. Nothing here is
specific to the benchmark's own analyzer, so adding a tracker is one function in
TRACKERS plus a line in --trackers.

Trackers whose package is missing are reported and skipped rather than taking the
run down with them; the exit status is non-zero so a script notices.

    python -m venv bench/.venv
    bench/.venv/Scripts/python.exe -m pip install -r bench/trackers/requirements.txt
    python bench/trackers/run_trackers.py --corpus bench/corpus
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

AUDIO_SUFFIXES = {".wav", ".flac", ".mp3", ".m4a", ".ogg", ".aiff", ".aif", ".au"}

#: Typed `.beats` files carry a beat number per line; this is the format the
#: annotated corpora ship and the one Beat This! writes (`1` is the downbeat).
BEATS_FORMAT = "time<TAB>beat-number (1 = downbeat)"


def find_audio(corpus: Path) -> list[Path]:
    """Every audio file under the corpus, in a stable order."""
    if not corpus.is_dir():
        raise SystemExit(f"corpus directory not found: {corpus}")
    files = [
        path
        for path in sorted(corpus.rglob("*"))
        if path.is_file() and path.suffix.lower() in AUDIO_SUFFIXES
    ]
    if not files:
        raise SystemExit(f"no audio files under {corpus} (looked for {', '.join(sorted(AUDIO_SUFFIXES))})")
    return files


def beat_numbers(beats, downbeats) -> list[int]:
    """A beat number per beat, `1` on each downbeat.

    Beat This! ships this exact function, and using it keeps our files identical
    to its own CLI output. The fallback exists so a tracker whose package is not
    installed can still be written when it has downbeats from somewhere else.
    """
    if downbeats is None:
        return []
    try:
        from beat_this.utils import infer_beat_numbers

        return [int(number) for number in infer_beat_numbers(beats, downbeats)]
    except Exception:
        pass

    numbers = []
    counter = 0
    next_downbeat = 0
    downbeats = list(downbeats)
    for beat in beats:
        if next_downbeat < len(downbeats) and abs(beat - downbeats[next_downbeat]) <= 0.01:
            counter = 1
            next_downbeat += 1
        else:
            counter = counter + 1 if counter else 2
        numbers.append(counter)
    return numbers


def write_beats(path: Path, beats, downbeats) -> None:
    """Write the tracker's beats; one column when it has no bar model."""
    path.parent.mkdir(parents=True, exist_ok=True)
    times = [float(beat) for beat in beats]
    numbers = beat_numbers(times, downbeats)
    if numbers and len(numbers) == len(times):
        lines = [f"{beat:.6f}\t{number}\n" for beat, number in zip(times, numbers)]
    else:
        lines = [f"{beat:.6f}\n" for beat in times]
    temporary = path.with_suffix(".beats.tmp")
    temporary.write_text("".join(lines), encoding="utf-8")
    temporary.replace(path)


def track_beat_this(audio: Path, options: dict):
    from beat_this.inference import File2Beats

    tracker = options.get("_instance")
    if tracker is None:
        tracker = File2Beats(
            checkpoint_path=options["model"],
            device=options["device"],
            dbn=options["dbn"],
        )
        options["_instance"] = tracker
    beats, downbeats = tracker(str(audio))
    return list(beats), list(downbeats)


def track_librosa_beat(audio: Path, options: dict):
    import librosa

    signal, sample_rate = librosa.load(str(audio), sr=None, mono=True)
    _, frames = librosa.beat.beat_track(y=signal, sr=sample_rate, trim=False)
    return [float(time) for time in librosa.frames_to_time(frames, sr=sample_rate)], None


def track_librosa_plp(audio: Path, options: dict):
    """A framewise pulse tracker — included because it is the one classical
    baseline that claims to follow a changing tempo, which is the failure mode
    the current analyzer is complained about."""
    import librosa
    import numpy as np

    signal, sample_rate = librosa.load(str(audio), sr=None, mono=True)
    pulse = librosa.beat.plp(y=signal, sr=sample_rate)
    frames = np.flatnonzero(librosa.util.localmax(pulse))
    return [float(time) for time in librosa.frames_to_time(frames, sr=sample_rate)], None


TRACKERS = {
    "beat_this": {
        "run": track_beat_this,
        "options": {"model": "final0", "device": "cpu", "dbn": False},
        "note": "CPJKU Beat This! (MIT), transformer on log-mel, beats + downbeats",
    },
    "librosa-beat": {
        "run": track_librosa_beat,
        "options": {},
        "note": "librosa.beat.beat_track (Ellis DP), global tempo, beats only",
    },
    "librosa-plp": {
        "run": track_librosa_plp,
        "options": {},
        "note": "librosa.beat.plp, framewise pulse, beats only",
    },
}


def read_manifest(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def public_options(options: dict) -> dict:
    return {key: value for key, value in options.items() if not key.startswith("_")}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus", default="bench/corpus", help="directory of audio to track (default: %(default)s)")
    parser.add_argument("--out", default="bench/trackers/out", help="where the .beats cache is written (default: %(default)s)")
    parser.add_argument(
        "--trackers",
        default="beat_this,librosa-beat",
        help=f"comma-separated subset of: {', '.join(TRACKERS)} (default: %(default)s)",
    )
    parser.add_argument("--force", action="store_true", help="re-run tracks that are already cached")
    parser.add_argument("--limit", type=int, default=0, help="only the first N tracks (a quick smoke run)")
    parser.add_argument("--device", default=None, help="torch device for beat_this (cpu, cuda); default: cpu")
    parser.add_argument("--model", default=None, help="beat_this checkpoint (default: final0)")
    parser.add_argument("--dbn", action="store_true", help="run beat_this's optional madmom DBN post-processing")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    names = [name.strip() for name in args.trackers.split(",") if name.strip()]
    unknown = [name for name in names if name not in TRACKERS]
    if unknown:
        raise SystemExit(f"unknown tracker(s) {', '.join(unknown)}; known: {', '.join(TRACKERS)}")

    corpus = Path(args.corpus)
    audio_files = find_audio(corpus)
    if args.limit:
        audio_files = audio_files[: args.limit]
    out_root = Path(args.out)

    non_wav = [path for path in audio_files if path.suffix.lower() != ".wav"]
    if non_wav and not args.quiet:
        print(
            f"note: {len(non_wav)} file(s) are not WAV; trackers can read them, but the Node "
            f"scorer only decodes WAV, so they will not be scored",
            file=sys.stderr,
        )

    failures = []
    for name in names:
        spec = TRACKERS[name]
        options = dict(spec["options"])
        if name == "beat_this":
            if args.device:
                options["device"] = args.device
            if args.model:
                options["model"] = args.model
            if args.dbn:
                options["dbn"] = True

        tracker_dir = out_root / name
        manifest_path = tracker_dir / "manifest.json"
        previous = read_manifest(manifest_path)
        if previous and previous.get("options") != public_options(options):
            # A cached .beats file scored under different options is a lie about
            # which model produced it, so the cache is dropped rather than mixed.
            if not args.quiet:
                print(f"{name}: options changed ({previous.get('options')} -> {public_options(options)}); re-running all tracks")
            for stale in tracker_dir.glob("*.beats"):
                stale.unlink()
        tracker_dir.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps({"options": public_options(options), "format": BEATS_FORMAT}, indent=2) + "\n",
            encoding="utf-8",
        )

        timings_path = tracker_dir / "timings.json"
        timings = read_manifest(timings_path)
        ran = cached = 0
        started = time.perf_counter()
        for index, audio in enumerate(audio_files, start=1):
            target = tracker_dir / f"{audio.stem}.beats"
            if target.exists() and not args.force and target.stat().st_mtime >= audio.stat().st_mtime:
                cached += 1
                continue
            track_started = time.perf_counter()
            try:
                beats, downbeats = spec["run"](audio, options)
                write_beats(target, beats, downbeats)
            except ModuleNotFoundError as error:
                failures.append((name, audio.name, f"missing package: {error.name}"))
                if ran == 0 and cached == 0:
                    print(
                        f"{name}: unavailable ({error.name}). Install the tracker dependencies with "
                        f"`pip install -r bench/trackers/requirements.txt`.",
                        file=sys.stderr,
                    )
                break
            except Exception as error:  # a single bad file must not end the run
                failures.append((name, audio.name, f"{type(error).__name__}: {error}"))
                if not args.quiet:
                    traceback.print_exc()
                continue
            elapsed = time.perf_counter() - track_started
            timings[audio.stem] = round(elapsed, 3)
            ran += 1
            if not args.quiet:
                print(f"{name}: [{index}/{len(audio_files)}] {audio.name} -> {len(beats)} beats in {elapsed:.1f}s")
        timings_path.write_text(json.dumps(timings, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        audio_seconds = 0.0
        for audio in audio_files:
            if audio.stem in timings:
                audio_seconds += timings[audio.stem]
        wall = time.perf_counter() - started
        if not args.quiet:
            print(
                f"{name}: {ran} tracked, {cached} cached, {len(failures)} failed "
                f"({spec['note']}); {wall:.1f}s wall, {audio_seconds:.1f}s in inference"
            )

    if failures:
        print(f"\n{len(failures)} track(s) failed:", file=sys.stderr)
        for name, track, reason in failures[:20]:
            print(f"  {name} {track}: {reason}", file=sys.stderr)
        if len(failures) > 20:
            print(f"  … {len(failures) - 20} more", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
