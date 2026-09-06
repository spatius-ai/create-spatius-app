"""Record the built CLI in a real PTY using deterministic, offline install stubs."""

import argparse
import codecs
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time


ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 80, 30


def record(destination):
    node = shutil.which("node")
    if not node or not (ROOT / "dist/cli.js").exists():
        raise RuntimeError("Node.js and a built CLI are required. Run pnpm build first.")
    # Resolve version-manager shims before replacing HOME/PATH for the fixture.
    node = subprocess.check_output([node, "-p", "process.execPath"], text=True).strip()

    # Each response waits for its actual prompt; timing alone never advances a step.
    steps = [
        ("Where should we create your project?", "my-avatar-app\r"),
        ("Which JavaScript package manager?", "\r"),
        ("Which Python package manager?", "\r"),
        ("Install dependencies now?", "\r"),
    ]
    events = []
    with tempfile.TemporaryDirectory(prefix="spatius-recording-") as temporary:
        workspace = Path(temporary)
        binaries = workspace / "bin"
        binaries.mkdir()
        for name in ("pnpm", "npm", "bun", "uv"):
            executable = binaries / name
            executable.write_text(
                '#!/bin/sh\nif [ "$1" = "--version" ]; then\n'
                '  echo "1.0.0"\n  exit 0\nfi\n/bin/sleep 2\n'
            )
            executable.chmod(0o755)
        # Keep local credentials, agent detection variables, and CI/NO_COLOR out
        # of this visual fixture. The generator itself is unmodified.
        environment = {
            "PATH": str(binaries),
            "HOME": temporary,
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "LANG": "en_US.UTF-8",
        }
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", HEIGHT, WIDTH, 0, 0))
        started = time.monotonic()
        child = subprocess.Popen(
            [node, str(ROOT / "dist/cli.js"), "--interactive", "--no-setup"],
            cwd=workspace,
            env=environment,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            start_new_session=True,
        )
        os.close(slave)
        decoder = codecs.getincrementaldecoder("utf-8")()
        transcript = ""
        step = 0
        pending = ""
        next_key = None
        prompt_offset = 0
        try:
            while time.monotonic() - started < 45:
                now = time.monotonic()
                if select.select([master], [], [], 0.02)[0]:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        break  # PTY EOF on Linux.
                    if not data:
                        break
                    text = decoder.decode(data)
                    if text:
                        timestamp = round(time.monotonic() - started, 4)
                        # One terminal write can arrive in several PTY reads.
                        # Keep adjacent chunks together so video frames don't
                        # freeze halfway through an ANSI redraw.
                        if events and timestamp - events[-1][0] < 0.02:
                            events[-1][0] = timestamp
                            events[-1][2] += text
                        else:
                            events.append([timestamp, "o", text])
                        transcript += text
                if next_key is not None and now >= next_key:
                    os.write(master, pending[0].encode())
                    pending = pending[1:]
                    next_key = now + 0.09 if pending else None
                    if not pending:
                        step += 1
                        prompt_offset = len(transcript)
                if next_key is None and step < len(steps):
                    prompt, response = steps[step]
                    if prompt in transcript[prompt_offset:]:
                        pending = response
                        next_key = now + 1.2
                if child.poll() is not None:
                    # Continue draining until PTY EOF, including the final outro.
                    continue
            else:
                raise TimeoutError(f"Onboarding stalled at scripted prompt {step + 1}.")
            child.wait(timeout=3)
            if (
                child.returncode != 0
                or step != len(steps)
                or "Ready!" not in transcript
                or "Next steps:" not in transcript
            ):
                raise RuntimeError(f"Onboarding did not complete (exit {child.returncode}, step {step}).")
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            os.close(master)
            header = {
                "version": 2,
                "width": WIDTH,
                "height": HEIGHT,
                "title": "Spatius onboarding — simulated dependency installation",
                "env": {"TERM": "xterm-256color"},
                "theme": {
                    "fg": "#f7f5f1", "bg": "#151131",
                    "palette": ":".join([
                        "#151131", "#ef8080", "#9a9ad8", "#d9c49a",
                        "#9399e3", "#9a9ad8", "#9399e3", "#f7f5f1",
                        "#b0adc8", "#ffaaaa", "#b8b8ec", "#ead9b4",
                        "#b1b7ff", "#c5b8ff", "#cecef4", "#ffffff",
                    ]),
                },
            }
            with destination.open("w") as recording:
                for entry in [header, *events]:
                    recording.write(json.dumps(entry) + "\n")
    return events[-1][0]


def render(directory):
    agg = os.environ.get("AGG", "agg")
    subprocess.run([
        agg, "--font-size", "16", "--line-height", "1.25",
        "--fps-cap", "12", "--last-frame-duration", "3",
        str(directory / "onboarding.cast"), str(directory / "onboarding.gif"),
    ], check=True)
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(directory / "onboarding.gif"),
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(directory / "onboarding.mp4"),
    ], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/terminal")
    parser.add_argument("--render", action="store_true", help="Also render GIF/MP4 using agg and ffmpeg.")
    arguments = parser.parse_args()
    arguments.output.mkdir(parents=True, exist_ok=True)
    duration = record(arguments.output / "onboarding.cast")
    if arguments.render:
        render(arguments.output)
    print(f"Recorded {duration:.1f}s of onboarding in {arguments.output}")


if __name__ == "__main__":
    main()
