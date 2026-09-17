#!/usr/bin/env python3
"""Build the chapter/unit vocabulary catalog from the supplied four-column PDF.

The PDF stores the headword, IPA and definition as individual image XObjects.
This extractor preserves the source ordering, OCRs each cell with macOS Vision,
and emits a deterministic JSON catalog plus a QA report.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import unicodedata
from collections import defaultdict
from pathlib import Path

from docx import Document
from PIL import ImageOps
from pypdf import PdfReader
from pypdf.generic import ContentStream


CHAPTER_COUNTS = {
    1: ("自然地理", 241), 2: ("植物研究", 130), 3: ("动物保护", 168),
    4: ("太空探索", 75), 5: ("学校教育", 401), 6: ("科技发明", 122),
    7: ("文化历史", 79), 8: ("语言演化", 68), 9: ("娱乐运动", 176),
    10: ("物品材料", 152), 11: ("时尚潮流", 113), 12: ("饮食健康", 174),
    13: ("建筑场所", 133), 14: ("交通旅行", 134), 15: ("国家政府", 151),
    16: ("社会经济", 172), 17: ("法律法规", 117), 18: ("沙场争锋", 213),
    19: ("社会角色", 121), 20: ("行为动作", 268), 21: ("身心健康", 418),
    22: ("时间日期", 52),
}


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFC", value).strip()
    value = value.replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--master-docx", type=Path, required=True)
    parser.add_argument("--vision-script", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args()


def master_definitions(path: Path) -> dict[str, list[dict[str, str]]]:
    found: dict[str, list[dict[str, str]]] = defaultdict(list)
    for table in Document(path).tables:
        for row in table.rows[1:]:
            cells = [cell.text.strip() for cell in row.cells]
            if len(cells) < 4 or not cells[0].isdigit() or not cells[1]:
                continue
            found[normalized(cells[1]).casefold()].append({
                "word": normalized(cells[1]),
                "ipa": normalized(cells[2]).strip("[]"),
                "gloss": normalized(cells[3]),
            })
    return found


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_cells(pdf: Path, work_dir: Path) -> list[dict]:
    word_dir = work_dir / "word"
    ipa_dir = work_dir / "ipa"
    gloss_dir = work_dir / "gloss"
    for directory in (word_dir, ipa_dir, gloss_dir):
        directory.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(pdf)
    entries: list[dict] = []
    current_chapter = 0
    for page_index, page in enumerate(reader.pages, 1):
        page_text = page.extract_text() or ""
        match = re.search(r"Chapter\s+(\d+)", page_text)
        if match:
            current_chapter = int(match.group(1))
        numbers = [int(value) for value in re.findall(r"^\s*(\d+)\s*$", page_text, re.M)]

        stream = ContentStream(page.get_contents(), reader)
        last_matrix = None
        placements = []
        for operands, operator in stream.operations:
            if operator == b"cm":
                last_matrix = [float(value) for value in operands]
            elif operator == b"Do" and last_matrix:
                placements.append((last_matrix[4], last_matrix[5], operands[0]))

        rows: list[dict] = []
        for x, y, name in placements:
            field = "word" if x < 100 else "ipa" if x < 250 else "gloss"
            if field == "word":
                rows.append({"word": (y, name)})
            elif rows:
                rows[-1][field] = (y, name)

        if len(rows) != len(numbers):
            raise RuntimeError(f"page {page_index}: {len(rows)} image rows for {len(numbers)} numbers")

        for row_index, (number, row) in enumerate(zip(numbers, rows), 1):
            entry_id = f"ch{current_chapter:02d}-{number:04d}"
            record = {
                "id": entry_id,
                "chapterId": f"ch{current_chapter:02d}",
                "sourceNumber": number,
                "sourcePdfPage": page_index,
                "sourceRow": row_index,
            }
            for field, directory in (("word", word_dir), ("ipa", ipa_dir), ("gloss", gloss_dir)):
                if field not in row:
                    continue
                image = page.images[row[field][1]].image.convert("L")
                image = ImageOps.expand(image, border=24, fill=255)
                filename = f"{entry_id}.png"
                image.save(directory / filename)
                record[f"{field}Image"] = filename
            entries.append(record)
    return entries


def vision_ocr(script: Path, directory: Path) -> dict[str, str]:
    result = subprocess.run(
        ["swift", str(script), str(directory)],
        check=True,
        capture_output=True,
        text=True,
    )
    rows = {}
    for line in result.stdout.splitlines():
        filename, _, text = line.partition("\t")
        rows[filename] = normalized(text)
    return rows


def parse_role(gloss: str) -> str:
    start = gloss.casefold().lstrip("(（ =")
    if start.startswith(("v.", "vt.", "vi.")):
        return "verb"
    if start.startswith(("adj.", "a.")):
        return "adjective"
    if start.startswith("adv."):
        return "adverb"
    if start.startswith("n."):
        return "noun"
    return "phrase"


def main() -> None:
    args = parse_args()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    master = master_definitions(args.master_docx)
    entries = extract_cells(args.pdf, args.work_dir)
    words = vision_ocr(args.vision_script, args.work_dir / "word")
    ipas = vision_ocr(args.vision_script, args.work_dir / "ipa")
    glosses = vision_ocr(args.vision_script, args.work_dir / "gloss")

    missing_gloss = []
    low_quality = []
    for entry in entries:
        filename = f"{entry['id']}.png"
        word = normalized(words.get(filename, ""))
        ipa = normalized(ipas.get(filename, "")).strip("/[] ")
        gloss = normalized(glosses.get(filename, ""))
        candidates = master.get(word.casefold(), [])
        if not gloss and candidates:
            gloss = candidates[0]["gloss"]
        if not ipa and candidates:
            ipa = candidates[0]["ipa"]
        if not gloss:
            missing_gloss.append(entry["id"])
            gloss = "释义待校对"
        if not word or re.search(r"[\u4e00-\u9fff]", word):
            low_quality.append(entry["id"])
        entry.update({
            "word": word,
            "normalizedWord": word.casefold(),
            "ipa": ipa,
            "gloss": gloss,
            "role": parse_role(gloss),
            "unitId": f"ch{int(entry['chapterId'][2:]):02d}-u{((entry['sourceNumber'] - 1) // 20) + 1:02d}",
        })
        for key in ("wordImage", "ipaImage", "glossImage"):
            entry.pop(key, None)

    by_chapter: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        by_chapter[entry["chapterId"]].append(entry)

    chapters = []
    units = []
    count_errors = []
    for ordinal, (title, expected) in CHAPTER_COUNTS.items():
        chapter_id = f"ch{ordinal:02d}"
        chapter_entries = sorted(by_chapter[chapter_id], key=lambda item: item["sourceNumber"])
        actual = len(chapter_entries)
        if actual != expected:
            count_errors.append({"chapter": ordinal, "expected": expected, "actual": actual})
        unit_count = (actual + 19) // 20
        chapters.append({
            "id": chapter_id,
            "ordinal": ordinal,
            "titleZh": title,
            "entryCount": actual,
            "unitCount": unit_count,
        })
        for unit_ordinal in range(1, unit_count + 1):
            start = (unit_ordinal - 1) * 20 + 1
            end = min(unit_ordinal * 20, actual)
            units.append({
                "id": f"{chapter_id}-u{unit_ordinal:02d}",
                "chapterId": chapter_id,
                "ordinal": unit_ordinal,
                "title": f"单元 {unit_ordinal}",
                "rangeLabel": f"{start}-{end}",
                "entryCount": end - start + 1,
            })

    duplicate_ids = [item for item, count in __import__("collections").Counter(e["id"] for e in entries).items() if count > 1]
    report = {
        "sourceSha256": sha256(args.pdf),
        "expectedChapters": 22,
        "actualChapters": len(chapters),
        "expectedEntries": 3678,
        "actualEntries": len(entries),
        "units": len(units),
        "countErrors": count_errors,
        "duplicateIds": duplicate_ids,
        "missingGloss": missing_gloss,
        "lowQualityHeadwords": low_quality,
    }
    catalog = {
        "schemaVersion": 1,
        "id": "ielts-vocabulary-zhenjing-a4",
        "title": "雅思词汇真经",
        "edition": "A4四列表·原书校对版",
        "sourceSha256": report["sourceSha256"],
        "totalEntries": len(entries),
        "chapters": chapters,
        "units": units,
        "entries": entries,
    }
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))

    if count_errors or duplicate_ids or low_quality or len(entries) != 3678:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
