# PDF 题库解析

## 1) 安装依赖
```bash
python3 -m pip install -r requirements.txt
```

## 2) 运行解析
示例：解析第 5 到 30 页（推荐先小范围验证）
```bash
python3 -u scripts/parse_pdf_questions.py \
  --pdf gaoxiang.pdf \
  --start-page 5 \
  --end-page 30 \
  --zoom 1.6 \
  --workers 4 \
  --output output/questions_p5_p30.json \
  --ocr-cache output/ocr_p5_p30.jsonl \
  --log-every 5
```

## 3) 全量解析（439 页）
```bash
python3 -u scripts/parse_pdf_questions.py \
  --pdf gaoxiang.pdf \
  --start-page 1 \
  --end-page 439 \
  --zoom 1.6 \
  --workers 6 \
  --output output/questions_all.json \
  --ocr-cache output/ocr_all.jsonl \
  --log-every 10
```

## 并行建议
- `--workers 1`: 串行（最稳但最慢）
- `--workers 4~8`: 常见 8 核/16 核机器推荐区间
- 如果机器内存不足或发热明显，先把 `workers` 降到 `3~4`

## 输出说明
- `output/*.json`: 结构化题库，含章节/小节/题干/选项/答案/解析/页码。
- `output/*.jsonl`: 每页 OCR 文本缓存，便于后续复查或二次清洗。

## 已知情况
- 扫描质量导致个别“试题X-【来源】”标题会漏识别。脚本有“隐式分题”兜底，能避免多题粘连。
- 这类兜底题目可能缺少 `source` / `knowledge_point` 字段，建议在后台校对页补齐。
