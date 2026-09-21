#!/usr/bin/env python3
"""
Read a recording of him describing a meal and say what it heard.

WHY THIS EXISTS AT ALL. No Claude model takes audio as an input, so a spoken meal has to become
text somewhere. The phone's own recogniser is the cheap place to do it and it is the wrong one: it
is a small on-device model with no idea what a loukoumas is, it hands back one guess with no way to
tell a confident reading from a desperate one, and whatever it mangles is what the agent then reads
as fact. This runs on the Mac instead, on a real model, primed with the names of the foods that are
already in his own log, and it keeps the recording so a bad reading can be compared against it.

Output is one JSON object on stdout. Failure is a non-zero exit and a line on stderr, so the
caller can fall back to the phone's transcript rather than losing the meal.
"""
import argparse
import json
import sys
import time

# Small is the honest choice here: it reads his Greek food names correctly with the prompt below
# and finishes a twelve-second clip in about two seconds on this machine, which keeps a spoken
# meal inside the same minute as a typed one. Bigger models are slower for no gain we can measure.
MODEL = "small"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="the recording, wav or m4a")
    ap.add_argument("--prompt", default="", help="words to expect, his own foods")
    ap.add_argument("--model", default=MODEL)
    args = ap.parse_args()

    from faster_whisper import WhisperModel

    started = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.path,
        language="en",
        # ⛔ THE PROMPT IS THE WHOLE POINT. Without it "mpiskotogluko" comes back as "biscuit
        # glucose" and the agent logs a biscuit. Whisper reads at most 224 tokens of prompt, so the
        # caller sends a bounded list.
        initial_prompt=args.prompt or None,
        beam_size=5,
        # Silence between sentences is him thinking, and without this the model invents words to
        # fill it.
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    json.dump(
        {
            "text": text,
            "model": args.model,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 3),
            "duration": round(float(info.duration), 2),
            "seconds": round(time.time() - started, 2),
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
