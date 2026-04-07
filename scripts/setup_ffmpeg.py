"""Download and install ffmpeg on Windows (no admin required).

Downloads a static ffmpeg build from gyan.dev, extracts it to the project's
tools/ directory, and adds it to the current process PATH. Also creates a
.env entry so the backend can find it on startup.

Usage:
    python scripts/setup_ffmpeg.py

After running, restart your terminal or run the backend — it will
detect ffmpeg automatically.
"""
from __future__ import annotations

import io
import os
import platform
import shutil
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen

FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = PROJECT_ROOT / "tools"
FFMPEG_DIR = TOOLS_DIR / "ffmpeg"


def main() -> None:
    if platform.system() != "Windows":
        print("This script is for Windows only.")
        print("On macOS: brew install ffmpeg")
        print("On Linux: sudo apt install ffmpeg")
        sys.exit(0)

    # Check if already installed system-wide
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        print(f"ffmpeg already found: {shutil.which('ffmpeg')}")
        print("No action needed.")
        return

    # Check if already downloaded locally
    local_ffmpeg = FFMPEG_DIR / "bin" / "ffmpeg.exe"
    if local_ffmpeg.exists():
        print(f"ffmpeg already downloaded: {local_ffmpeg}")
        _update_env()
        _print_path_instructions()
        return

    print(f"Downloading ffmpeg from {FFMPEG_URL}...")
    print("This may take a minute (~80MB)...")

    try:
        response = urlopen(FFMPEG_URL)  # noqa: S310
        data = response.read()
    except Exception as exc:
        print(f"\nDownload failed: {exc}")
        print("\nManual alternative:")
        print(f"  1. Download from {FFMPEG_URL}")
        print(f"  2. Extract to {FFMPEG_DIR}")
        print(f"  3. Ensure {FFMPEG_DIR / 'bin' / 'ffmpeg.exe'} exists")
        sys.exit(1)

    print(f"Downloaded {len(data) / 1024 / 1024:.1f}MB. Extracting...")

    TOOLS_DIR.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        # Find the root folder name inside the zip (e.g. ffmpeg-7.1-essentials_build)
        root_dirs = {name.split("/")[0] for name in zf.namelist() if "/" in name}
        if len(root_dirs) != 1:
            print(f"Unexpected zip structure: {root_dirs}")
            sys.exit(1)

        zip_root = root_dirs.pop()
        zf.extractall(str(TOOLS_DIR))

    # Rename extracted folder to "ffmpeg"
    extracted = TOOLS_DIR / zip_root
    if FFMPEG_DIR.exists():
        shutil.rmtree(FFMPEG_DIR, ignore_errors=True)
    shutil.move(str(extracted), str(FFMPEG_DIR))

    # Verify
    if not local_ffmpeg.exists():
        print(f"ERROR: {local_ffmpeg} not found after extraction")
        sys.exit(1)

    print(f"ffmpeg installed to {FFMPEG_DIR}")

    _update_env()
    _print_path_instructions()


def _update_env() -> None:
    """Add ffmpeg bin dir to PATH for the current process and .env file."""
    bin_dir = str(FFMPEG_DIR / "bin")

    # Current process
    os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")

    # .env file for backend auto-detection
    env_file = PROJECT_ROOT / ".env"
    env_line = f'VOXFORGE_FFMPEG_PATH="{bin_dir}"'

    if env_file.exists():
        content = env_file.read_text(encoding="utf-8")
        if "VOXFORGE_FFMPEG_PATH" not in content:
            with env_file.open("a", encoding="utf-8") as f:
                f.write(f"\n{env_line}\n")
    else:
        env_file.write_text(env_line + "\n", encoding="utf-8")

    print(f"\nAdded to .env: {env_line}")


def _print_path_instructions() -> None:
    bin_dir = FFMPEG_DIR / "bin"
    print(f"""
To make ffmpeg available everywhere, add it to your system PATH:

  1. Press Windows + R, type: sysdm.cpl
  2. Advanced tab -> Environment Variables
  3. Under System Variables, find "Path", click Edit
  4. Click "New" and add: {bin_dir}
  5. Click OK on all dialogs

Or just restart the backend — it will find the local copy automatically.

Verify: ffmpeg -version
""")


if __name__ == "__main__":
    main()
