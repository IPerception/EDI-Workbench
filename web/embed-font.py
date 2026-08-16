#!/usr/bin/env python3
"""Subset Barlow Condensed and emit the @font-face CSS pasted into EDIWorkbench.html.

The app is one self-contained HTML file with no external requests -- lint.mjs
fails the suite on any src/href, fetch, XHR or socket -- so a webfont is either
embedded as a base64 data URI or not used at all. Barlow Condensed carries the
design's character in the wordmark, headings, card titles and tile numerals.

Full Google "latin" subsets are ~22 KB per weight: +24% on a 250 KB app, for
glyph coverage this app never renders. Cutting to the marks below lands near
7 KB per weight, ~9.7 KB once base64'd -- about +7.6% for both weights.

This is an authoring-time tool. Its output is a string baked into the HTML, so
the app keeps its zero-dependency, zero-build-step property: nothing here runs
at page load, and nothing here is needed to run the test suites.

Requires fontTools and brotli (brotli is what writes woff2):
    python -m pip install fonttools brotli

Usage:
    python web/embed-font.py SRC_600.woff2 SRC_700.woff2 > web/fonts/face.css

Sources: any Barlow Condensed woff2 at weights 600 and 700 -- the latin subsets
from Google Fonts, or the copies inside the design artifact under
docs/notes/design-sources/unpacked/ (gitignored).
"""

import base64
import io
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

# Printable ASCII covers every heading, label and numeral the app renders in
# this family. The extras are the typographic marks the markup actually uses
# (&middot;, &mdash;, &ndash;, &hellip;, curly quotes) plus a few that turn up in
# decoded EDI values and check messages.
UNICODES = ",".join([
    "U+0020-007E",   # printable ASCII
    "U+00A0",        # no-break space
    "U+00A9",        # (c)
    "U+00B0",        # degree
    "U+00B7",        # middle dot -- the wordmark and tagline separators
    "U+00D7",        # multiplication sign
    "U+2013-2014",   # en dash, em dash
    "U+2018-201D",   # curly quotes
    "U+2022",        # bullet
    "U+2026",        # ellipsis
    "U+2192",        # right arrow -- before/after captions
    "U+2212",        # true minus, for tabular figures
    "U+2713",        # check mark
])

# Barlow is published under the SIL Open Font License 1.1 with NO Reserved Font
# Name -- its copyright string carries no "with Reserved Font Name" clause. That
# is what makes it legal to keep the family name on a subset; a Modified Version
# of a reserved-name family would have to be renamed.
#
# OFL section 1 requires the copyright and permission notices to travel with
# every copy, and states they "can be included either as text files or in
# machine-readable metadata fields". The single HTML file travels detached from
# this repo, so the repo's copy of the licence cannot be what satisfies that --
# the notices have to ride inside the font, which is what the name records below
# do. web/fonts/OFL.txt keeps the full text for the repo.
LICENSE_NOTICE = (
    "This Font Software is licensed under the SIL Open Font License, "
    "Version 1.1. This licence is available with a FAQ at "
    "https://scripts.sil.org/OFL"
)
LICENSE_URL = "https://scripts.sil.org/OFL"

NAME_COPYRIGHT, NAME_LICENSE, NAME_LICENSE_URL = 0, 13, 14

# Windows/Unicode/US-English, the platform triple every browser reads.
WIN_UNICODE_EN = (3, 1, 0x409)


def parse_unicodes(spec):
    """Expand a 'U+0020-007E,U+00A9' spec into a set of codepoints."""
    points = set()
    for part in spec.split(","):
        part = part.strip().removeprefix("U+")
        if "-" in part:
            low, high = part.split("-")
            points.update(range(int(low, 16), int(high, 16) + 1))
        else:
            points.add(int(part, 16))
    return points


def build(src_path):
    """Subset src_path to UNICODES and return (woff2 bytes, copyright string)."""
    font = TTFont(src_path)

    options = subset.Options()
    # Keep kerning; drop the rest. This family's other features (figure
    # variants, alternates) are never selected by the app's CSS, and each one
    # drags in a glyph set of its own.
    options.layout_features = ["kern"]
    options.hinting = False
    options.desubroutinize = True
    # Without 13 and 14 here the subsetter keeps only name IDs 0-6, dropping the
    # licence records this font is required to carry.
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=parse_unicodes(UNICODES))
    subsetter.subset(font)

    copyright_notice = font["name"].getDebugName(NAME_COPYRIGHT)
    if not copyright_notice:
        raise SystemExit(f"{src_path}: no copyright record -- refusing to embed")

    # Google's webfont builds carry the copyright but no licence notice. Set
    # both explicitly so the embedded font states its own terms wherever the
    # HTML file ends up.
    font["name"].setName(LICENSE_NOTICE, NAME_LICENSE, *WIN_UNICODE_EN)
    font["name"].setName(LICENSE_URL, NAME_LICENSE_URL, *WIN_UNICODE_EN)

    font.flavor = "woff2"
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue(), copyright_notice


def main(argv):
    if len(argv) != 3:
        raise SystemExit(__doc__)

    faces, notice = [], None
    for weight, src in zip((600, 700), argv[1:]):
        woff2, copyright_notice = build(src)
        notice = notice or copyright_notice
        encoded = base64.b64encode(woff2).decode("ascii")
        # Sizes go to stderr so stdout stays pasteable CSS.
        print(
            f"Barlow Condensed {weight}: {len(woff2):,} bytes woff2, "
            f"{len(encoded):,} base64",
            file=sys.stderr,
        )
        faces.append(
            "  @font-face {\n"
            "    font-family: 'Barlow Condensed';\n"
            "    font-style: normal;\n"
            f"    font-weight: {weight};\n"
            "    font-display: swap;\n"
            f"    src: url(data:font/woff2;base64,{encoded}) format('woff2');\n"
            "  }"
        )

    print(f"  /* {notice}")
    print(f"     {LICENSE_NOTICE}")
    print("     Subset to the glyphs this app renders, by web/embed-font.py.")
    print("     Full licence text: web/fonts/OFL.txt */")
    print("\n".join(faces))


if __name__ == "__main__":
    main(sys.argv)
