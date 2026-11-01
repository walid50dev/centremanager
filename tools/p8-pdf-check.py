#!/usr/bin/env python3
"""Phase 8 helper: read a receipt PDF and print what it contains as JSON.

Used by the browser suite so the assertions are made on the real file the app
downloaded, not on the DOM around it.
"""
import json
import sys

from pypdf import PdfReader


def describe(path: str) -> dict:
    reader = PdfReader(path)
    page = reader.pages[0]
    images = 0
    try:
        images = len(list(page.images))
    except Exception:  # pragma: no cover - defensive, image extraction can fail
        images = 0
    return {
        "path": path,
        "pages": len(reader.pages),
        "width_pt": round(float(page.mediabox.width), 2),
        "height_pt": round(float(page.mediabox.height), 2),
        "title": (reader.metadata.title if reader.metadata else None),
        "images": images,
        "text": page.extract_text() or "",
    }


if __name__ == "__main__":
    print(json.dumps(describe(sys.argv[1]), ensure_ascii=False))
