#!/usr/bin/env python3
"""Parse scanned exam PDF into structured question JSON.

Pipeline:
1) Render each PDF page to image (PyMuPDF)
2) OCR lines (RapidOCR)
3) Clean headers/watermarks
4) Parse chapter/section/questions/options/answer/explanation
"""

from __future__ import annotations

import argparse
import json
import os
import re
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import fitz
import numpy as np
from rapidocr_onnxruntime import RapidOCR


CHAPTER_RE = re.compile(r"第\s*(\d+)\s*章\s*(.+)")
SECTION_RE = re.compile(r"^(\d+\.\d+)\s*(.+)")
QUESTION_LINE_RE = re.compile(r"试题\s*(\d+)\s*[-－]\s*【([^】]+)】\s*[-－]\s*(.+)")
QUESTION_START_RE = re.compile(r"试题\s*\d+\s*[-－]")
ANSWER_RE = re.compile(r"【答案】\s*([A-D]+)")
ANALYSIS_RE = re.compile(r"【解析】\s*([\s\S]*)")
OPTION_MARK_RE = re.compile(r"([A-D])[\.、．]\s*")
IMPLICIT_STEM_RE = re.compile(r"[（(]\s*[）)]\s*[。.]?$")

_WORKER_DOC: Optional[fitz.Document] = None
_WORKER_OCR: Optional[RapidOCR] = None
_WORKER_ZOOM: float = 1.8


@dataclass
class Question:
    id: int
    chapter: str
    section: str
    source: str
    knowledge_point: str
    stem: str
    options: Dict[str, str]
    answer: str
    explanation: str
    page_start: int
    raw_text: str = field(repr=False)


def normalize_line(line: str) -> str:
    line = line.replace("\u3000", " ").replace("\xa0", " ")
    line = re.sub(r"\s+", " ", line)
    return line.strip()


def is_noise_line(line: str) -> bool:
    if not line:
        return True
    noise_patterns = [
        r"野人老师",
        r"yeren\.taobao\.com",
        r"公众号",
        r"www\.",
        r"^-\s*\d+\s*-$",
        r"^\d+\s*$",
    ]
    return any(re.search(pat, line, re.IGNORECASE) for pat in noise_patterns)


def ocr_page(doc: fitz.Document, page_idx: int, ocr: RapidOCR, zoom: float) -> List[str]:
    page = doc[page_idx]
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    result, _ = ocr(img)
    if not result:
        return []

    lines = [normalize_line(item[1]) for item in result]
    lines = [line for line in lines if not is_noise_line(line)]
    return lines


def init_worker(pdf_path: str, zoom: float) -> None:
    global _WORKER_DOC, _WORKER_OCR, _WORKER_ZOOM
    _WORKER_DOC = fitz.open(pdf_path)
    _WORKER_OCR = RapidOCR()
    _WORKER_ZOOM = zoom


def ocr_page_worker(page_idx: int) -> Tuple[int, List[str]]:
    if _WORKER_DOC is None or _WORKER_OCR is None:
        raise RuntimeError("Worker OCR state is not initialized")
    page_no = page_idx + 1
    lines = ocr_page(_WORKER_DOC, page_idx, _WORKER_OCR, zoom=_WORKER_ZOOM)
    return page_no, lines


def parse_title_line(text: str) -> Tuple[int, str, str]:
    match = QUESTION_LINE_RE.search(text)
    if match:
        qid = int(match.group(1))
        source = match.group(2).strip()
        kp = match.group(3).strip()
        return qid, source, kp

    fallback = re.search(r"试题\s*(\d+)", text)
    if fallback:
        return int(fallback.group(1)), "", ""

    raise ValueError(f"Cannot parse question title line: {text}")


def extract_stem_and_options(body: str) -> Tuple[str, Dict[str, str]]:
    body = body.strip()
    matches = list(OPTION_MARK_RE.finditer(body))
    if not matches:
        return body, {}

    stem = body[: matches[0].start()].strip()
    options: Dict[str, str] = {}

    for idx, match in enumerate(matches):
        label = match.group(1)
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        options[label] = body[start:end].strip(" ;；\n")

    return stem, options


def parse_question_block(
    block_lines: List[str], chapter: str, section: str, page_start: int, fallback_id: int
) -> Optional[Question]:
    if not block_lines:
        return None

    first_line = block_lines[0]
    raw_text = "\n".join(block_lines)

    try:
        qid, source, knowledge_point = parse_title_line(first_line)
    except ValueError:
        qid = fallback_id
        source = ""
        knowledge_point = ""

    merged = "\n".join(block_lines)
    answer_match = ANSWER_RE.search(merged)
    answer = answer_match.group(1).strip() if answer_match else ""

    analysis_match = ANALYSIS_RE.search(merged)
    explanation = analysis_match.group(1).strip() if analysis_match else ""

    before_answer = merged.split("【答案】")[0]
    if QUESTION_LINE_RE.search(first_line) or re.search(r"试题\s*\d+", first_line):
        body = before_answer[len(first_line) :].strip()
    else:
        body = before_answer.strip()

    stem, options = extract_stem_and_options(body)

    return Question(
        id=qid,
        chapter=chapter,
        section=section,
        source=source,
        knowledge_point=knowledge_point,
        stem=stem,
        options=options,
        answer=answer,
        explanation=explanation,
        page_start=page_start,
        raw_text=raw_text,
    )


def parse_questions(lines_by_page: List[Tuple[int, List[str]]]) -> List[Question]:
    questions: List[Question] = []
    current_chapter = ""
    current_section = ""

    block_lines: List[str] = []
    block_page_start = 0
    last_question_id = 0

    def flush_block() -> None:
        nonlocal block_lines, block_page_start, last_question_id
        if not block_lines:
            return
        q = parse_question_block(
            block_lines=block_lines,
            chapter=current_chapter,
            section=current_section,
            page_start=block_page_start,
            fallback_id=last_question_id + 1,
        )
        if q:
            questions.append(q)
            last_question_id = max(last_question_id, q.id)
        block_lines = []
        block_page_start = 0

    def block_has_answer(lines: List[str]) -> bool:
        return any("【答案】" in ln for ln in lines)

    def looks_like_implicit_stem(line: str) -> bool:
        if not line or line.startswith(("【", "A.", "B.", "C.", "D.")):
            return False
        if QUESTION_START_RE.search(line):
            return False
        if len(line) < 8 or len(line) > 80:
            return False
        return bool(IMPLICIT_STEM_RE.search(line))

    for page_no, lines in lines_by_page:
        for line in lines:
            chapter_match = CHAPTER_RE.search(line)
            if chapter_match:
                flush_block()
                current_chapter = f"第{chapter_match.group(1)}章 {chapter_match.group(2).strip()}"
                continue

            section_match = SECTION_RE.search(line)
            if section_match:
                flush_block()
                current_section = f"{section_match.group(1)} {section_match.group(2).strip()}"
                continue

            if "目录" in line:
                continue

            if QUESTION_START_RE.search(line):
                flush_block()
                block_lines = [line]
                block_page_start = page_no
                continue

            if block_lines:
                if block_has_answer(block_lines) and looks_like_implicit_stem(line):
                    flush_block()
                    block_lines = [line]
                    block_page_start = page_no
                    continue
                block_lines.append(line)

    flush_block()
    return questions


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse scanned PDF exam questions into JSON")
    parser.add_argument("--pdf", required=True, help="Path to source PDF")
    parser.add_argument("--start-page", type=int, default=1, help="1-based page index")
    parser.add_argument("--end-page", type=int, default=0, help="1-based page index, 0 means last page")
    parser.add_argument("--zoom", type=float, default=1.8, help="Render zoom for OCR")
    parser.add_argument(
        "--workers",
        type=int,
        default=max(1, (os.cpu_count() or 2) // 2),
        help="OCR worker processes (1 = serial)",
    )
    parser.add_argument(
        "--log-every",
        type=int,
        default=1,
        help="Print OCR progress every N pages",
    )
    parser.add_argument("--output", default="output/questions.json", help="Output JSON file")
    parser.add_argument(
        "--ocr-cache",
        default="output/ocr_pages.jsonl",
        help="Per-page OCR text cache (JSONL)",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    out_path = Path(args.output)
    ocr_cache_path = Path(args.ocr_cache)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    ocr_cache_path.parent.mkdir(parents=True, exist_ok=True)

    meta_doc = fitz.open(str(pdf_path))
    start_idx = max(1, args.start_page) - 1
    end_idx = (len(meta_doc) - 1) if args.end_page <= 0 else min(args.end_page - 1, len(meta_doc) - 1)
    meta_doc.close()

    if start_idx > end_idx:
        raise ValueError("Invalid page range")

    workers = max(1, args.workers)
    lines_by_page: List[Tuple[int, List[str]]] = []
    page_indices = list(range(start_idx, end_idx + 1))
    page_results: Dict[int, List[str]] = {}

    if workers == 1:
        doc = fitz.open(str(pdf_path))
        ocr = RapidOCR()
        for idx in page_indices:
            page_no = idx + 1
            page_results[page_no] = ocr_page(doc, idx, ocr, zoom=args.zoom)
            if args.log_every > 0 and page_no % args.log_every == 0:
                print(f"OCR done: page {page_no}")
        doc.close()
    else:
        total = len(page_indices)
        done = 0
        with ProcessPoolExecutor(
            max_workers=workers,
            initializer=init_worker,
            initargs=(str(pdf_path), args.zoom),
        ) as executor:
            futures = [executor.submit(ocr_page_worker, idx) for idx in page_indices]
            for future in as_completed(futures):
                page_no, lines = future.result()
                page_results[page_no] = lines
                done += 1
                if args.log_every > 0 and done % args.log_every == 0:
                    print(f"OCR done: {done}/{total} pages")

    with ocr_cache_path.open("w", encoding="utf-8") as cache_fp:
        for page_no in sorted(page_results.keys()):
            lines = page_results[page_no]
            payload = {"page": page_no, "lines": lines}
            cache_fp.write(json.dumps(payload, ensure_ascii=False) + "\n")
            lines_by_page.append((page_no, lines))

    questions = parse_questions(lines_by_page)

    result = {
        "pdf": str(pdf_path),
        "page_range": {"start": start_idx + 1, "end": end_idx + 1},
        "question_count": len(questions),
        "questions": [asdict(q) for q in questions],
    }

    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Parsed {len(questions)} questions -> {out_path}")
    print(f"OCR cache -> {ocr_cache_path}")


if __name__ == "__main__":
    main()
