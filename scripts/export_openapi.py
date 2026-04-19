"""Dump the FastAPI OpenAPI schema to ``schema/openapi.json``.

Run with ``python scripts/export_openapi.py`` (or ``npm run openapi:export``).
No server process is spawned — we import the app in-process and call
``app.openapi()``. The resulting JSON is committed so the TS type
generation step works offline and in CI.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schema" / "openapi.json"

sys.path.insert(0, str(ROOT))


def main() -> int:
    from backend import app  # imported lazily so env is set up first

    schema = app.openapi()
    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote OpenAPI schema to {SCHEMA_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
