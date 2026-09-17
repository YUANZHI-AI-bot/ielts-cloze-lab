#!/usr/bin/env python3
"""Apply source-verified corrections and produce the publishable catalog.

The source book contains five numbered etymology notes in the same four-column
table as its vocabulary. They are preserved by the raw extractor for audit but
must not become spelling questions. A small number of narrow word/definition
cells also need deterministic overrides after direct visual verification.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


NOTE_ROWS = {
    "ch07-0019",
    "ch12-0116",
    "ch15-0064",
    "ch15-0097",
    "ch16-0122",
    "ch21-0312",
}

OVERRIDES = {
    "ch01-0077": {"gloss": "adj. 地中海的；地中海地区的  n. 地中海"},
    "ch01-0119": {"word": "snowy"},
    "ch02-0103": {"gloss": "n. 起平衡作用的事物；抗衡力  v. 抵消；对……起平衡作用"},
    "ch03-0082": {"word": "pup"},
    "ch05-0227": {"word": "ounce"},
    "ch05-0181": {"word": "identical"},
    "ch05-0246": {"gloss": "v. （使）发酵；骚动  n. 酶；发酵；动乱"},
    "ch05-0307": {"word": "essay"},
    "ch05-0324": {"word": "summary"},
    "ch05-0329": {"gloss": "v. 假定，假设  n. 假定，假设"},
    "ch05-0373": {"word": "survey", "gloss": "n. 民意调查  v. 对……进行民意调查"},
    "ch05-0377": {"word": "query"},
    "ch06-0044": {"word": "accessory"},
    "ch06-0081": {"word": "pump"},
    "ch09-0077": {"word": "pop"},
    "ch10-0063": {"word": "Xerox"},
    "ch11-0048": {"gloss": "n. [英]（工作时穿的）罩衣  adj. 全面的"},
    "ch11-0104": {"word": "grey"},
    "ch12-0138": {"gloss": "n. 盐"},
    "ch12-0104": {"word": "sausage"},
    "ch12-0123": {"word": "soup"},
    "ch13-0126": {"gloss": "adj. 外部的  n. 外表"},
    "ch14-0114": {"word": "lull"},
    "ch15-0038": {"gloss": "n. 市长"},
    "ch15-0050": {"word": "significance"},
    "ch15-0057": {"word": "institution"},
    "ch16-0018": {"word": "grocery"},
    "ch16-0094": {"gloss": "v. 进口  n. 进口；进口商品"},
    "ch18-0085": {"gloss": "n. 反叛者；叛逆者  v. 造反；反抗，反对"},
    "ch18-0156": {"gloss": "n. 前进；进步；进程  v. 前进；进步"},
    "ch19-0059": {"word": "accompany"},
    "ch20-0012": {"word": "support"},
    "ch20-0074": {"word": "sway"},
    "ch20-0110": {"word": "annoy"},
    "ch20-0214": {"gloss": "v. 原谅；同意免除  n. 理由；借口"},
    "ch20-0209": {"word": "seep"},
    "ch21-0028": {"word": "lip"},
    "ch21-0326": {"word": "agony"},
    "ch21-0373": {"word": "uneasy"},
}


def role_for(gloss: str) -> str:
    value = gloss.casefold().lstrip("(（ =")
    if value.startswith(("v.", "vt.", "vi.")):
        return "verb"
    if value.startswith(("adj.", "a.")):
        return "adjective"
    if value.startswith("adv."):
        return "adverb"
    if value.startswith("n."):
        return "noun"
    return "phrase"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    source_entries = catalog["entries"]
    entries = []
    for entry in source_entries:
        if entry["id"] in NOTE_ROWS:
            continue
        entry = dict(entry)
        entry.update(OVERRIDES.get(entry["id"], {}))
        entry["normalizedWord"] = entry["word"].casefold()
        entry["role"] = role_for(entry["gloss"])
        entries.append(entry)

    by_chapter = defaultdict(list)
    for entry in entries:
        by_chapter[entry["chapterId"]].append(entry)

    units = []
    for chapter in catalog["chapters"]:
        chapter_entries = sorted(by_chapter[chapter["id"]], key=lambda item: item["sourceNumber"])
        for index, entry in enumerate(chapter_entries):
            entry["unitId"] = f"{chapter['id']}-u{index // 20 + 1:02d}"
        chapter["entryCount"] = len(chapter_entries)
        chapter["unitCount"] = (len(chapter_entries) + 19) // 20
        for unit_index in range(chapter["unitCount"]):
            start = unit_index * 20
            unit_entries = chapter_entries[start:start + 20]
            units.append({
                "id": f"{chapter['id']}-u{unit_index + 1:02d}",
                "chapterId": chapter["id"],
                "ordinal": unit_index + 1,
                "title": f"学习组 {unit_index + 1}",
                "rangeLabel": f"{start + 1}-{start + len(unit_entries)}",
                "entryCount": len(unit_entries),
            })

    empty_words = [entry["id"] for entry in entries if not entry["word"].strip()]
    cjk_words = [entry["id"] for entry in entries if re.search(r"[\u4e00-\u9fff]", entry["word"])]
    unresolved_gloss = [entry["id"] for entry in entries if entry["gloss"] == "释义待校对" or not entry["gloss"].strip()]
    invalid_words = [
        entry["id"] for entry in entries
        if not re.fullmatch(r"[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'\-’. ]*", entry["word"])
    ]
    duplicates = [key for key, count in Counter(entry["id"] for entry in entries).items() if count > 1]
    source_numbers = defaultdict(list)
    for entry in entries:
        source_numbers[entry["chapterId"]].append(entry["sourceNumber"])

    report = {
        "sourceEntries": len(entries) + len(NOTE_ROWS),
        "publishedEntries": len(entries),
        "excludedNoteRows": sorted(NOTE_ROWS),
        "chapters": len(catalog["chapters"]),
        "units": len(units),
        "emptyHeadwords": empty_words,
        "headwordsContainingChinese": cjk_words,
        "invalidHeadwords": invalid_words,
        "unresolvedGlosses": unresolved_gloss,
        "duplicateIds": duplicates,
        "chapterCounts": {chapter["id"]: chapter["entryCount"] for chapter in catalog["chapters"]},
    }
    if empty_words or cjk_words or invalid_words or unresolved_gloss or duplicates:
        raise SystemExit(json.dumps(report, ensure_ascii=False))

    catalog["schemaVersion"] = 2
    catalog["totalEntries"] = len(entries)
    catalog["units"] = units
    catalog["entries"] = entries
    args.catalog.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
