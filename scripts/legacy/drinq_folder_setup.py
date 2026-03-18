#!/usr/bin/env python3
"""Legacy scaffold helper kept for reference.

Use the repository's current monorepo structure instead of this script
for new development.
"""

from pathlib import Path


def main() -> None:
    root = Path.cwd()
    print("Legacy script placeholder.")
    print(f"Current directory: {root}")
    print("Use apps/mobile, apps/api, apps/web, and packages/shared.")


if __name__ == "__main__":
    main()
