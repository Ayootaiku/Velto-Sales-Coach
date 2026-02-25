#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from urllib import error, request


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def fail(message: str) -> int:
    print(
        json.dumps(
            {
                "service": "openai",
                "status": "error",
                "checks": {"auth": "failed", "network": "unknown"},
                "error": message,
            }
        )
    )
    return 1


def main() -> int:
    load_env_file(Path(".env.local"))

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return fail("Missing OPENAI_API_KEY")

    req = request.Request(
        "https://api.openai.com/v1/models",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="GET",
    )

    try:
        with request.urlopen(req, timeout=15) as resp:
            status_code = resp.getcode()
            body = resp.read().decode("utf-8")
        if status_code != 200:
            return fail(f"Unexpected HTTP status {status_code}")
        parsed = json.loads(body)
        models = parsed.get("data", []) if isinstance(parsed, dict) else []
        print(
            json.dumps(
                {
                    "service": "openai",
                    "status": "ok",
                    "checks": {"auth": "passed", "network": "passed"},
                    "model_count": len(models),
                }
            )
        )
        return 0
    except error.HTTPError as exc:
        return fail(f"HTTPError {exc.code}: {exc.reason}")
    except error.URLError as exc:
        return fail(f"URLError: {exc.reason}")
    except Exception as exc:  # noqa: BLE001
        return fail(f"Unexpected error: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    sys.exit(main())
