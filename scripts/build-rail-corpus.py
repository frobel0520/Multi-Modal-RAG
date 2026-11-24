"""Build rail statistics and offline evidence charts from pinned official CSV files."""

import argparse
import csv
from hashlib import sha256
from html import escape
from io import StringIO
import json
from pathlib import Path
import re


MANIFEST = Path(__file__).resolve().parents[1] / "data" / "rail" / "sources.json"
ANNUAL = re.compile(r"([0-9]+)年")
MONTHLY = re.compile(r"([0-9]+)年\s*([0-9]+)月")


def read_rows(input_dir, source):
    path = input_dir / source["file"]
    payload = path.read_bytes()
    if sha256(payload).hexdigest() != source["sha256"]:
        raise ValueError(f"{path.name} 的 SHA-256 與來源清單不符")
    return list(csv.DictReader(StringIO(payload.decode("utf-8-sig")), strict=True))


def annual_values(rows, series, years):
    monthly = series["period"] == "month"
    pattern = MONTHLY if monthly else ANNUAL
    values = {}
    for row in rows:
        period = pattern.fullmatch((row.get("統計期") or "").strip())
        if period is None:
            raise ValueError(f'{series["id"]} 的統計期格式有誤')
        year = int(period[1]) + 1911
        if year not in years:
            continue
        month = int(period[2]) if monthly else 1
        key = (year, month)
        value = (row.get(series["column"]) or "").strip()
        if key in values or not re.fullmatch(r"[0-9]+", value):
            raise ValueError(f'{series["id"]} 在 {key} 缺少有效或唯一的人次')
        values[key] = int(value)
    result = []
    for year in years:
        expected = {(year, month) for month in range(1, 13 if monthly else 2)}
        actual = {key for key in values if key[0] == year}
        if actual != expected:
            raise ValueError(f'{series["id"]} 的 {year} 年統計期不完整')
        result.append({"year": year, "value": sum(values[key] for key in expected)})
    return result


def build_corpus(manifest, input_dir):
    sources = {source["file"]: source for source in manifest["sources"]}
    rows = {name: read_rows(input_dir, source) for name, source in sources.items()}
    return {
        "edition": manifest["edition"],
        "publisher": manifest["publisher"],
        "license": manifest["license"],
        "unit": "人次",
        "series": [
            {
                **series,
                "chart_id": f'{series["id"]}-{manifest["edition"]}',
                "source": sources[series["source"]],
                "values": annual_values(rows[series["source"]], series, manifest["years"]),
            }
            for series in manifest["series"]
        ],
    }


def render_chart(corpus, series):
    largest = max(record["value"] for record in series["values"])
    rows = []
    for record in series["values"]:
        value = record["value"]
        percentage = 100 * value / largest if largest else 0
        rows.append(
            f'<tr><th scope="row">{record["year"]}</th><td>{value:,}</td>'
            f'<td aria-hidden="true"><div class="bar" style="width:{percentage:.2f}%"></div></td></tr>'
        )
    title = escape(f'{series["label"]}｜{series["scope"]}{series["metric"]}')
    source = series["source"]
    return f'''
<section id="{escape(series["chart_id"], quote=True)}">
<h2>{title}</h2>
<table>
<caption>各年{escape(series["metric"])}（{escape(corpus["unit"])}）</caption>
<thead><tr><th scope="col">西元年</th><th scope="col">人次</th><th aria-hidden="true">相對於本序列最高年</th></tr></thead>
<tbody>{"".join(rows)}</tbody>
</table>
<p>{escape(corpus["publisher"])}・<a href="{escape(source["url"], quote=True)}">{escape(source["title"])}</a>・
資料快照 {escape(corpus["edition"])}・<a href="{escape(corpus["license"]["url"], quote=True)}">{escape(corpus["license"]["label"])}</a></p>
</section>'''


def render_html(corpus):
    charts = "".join(render_chart(corpus, series) for series in corpus["series"])
    return f'''<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>鐵道年度運量</title>
<style>
* {{ box-sizing: border-box }}
body {{ font: 1rem/1.6 system-ui,sans-serif; margin: auto; max-width: 54rem; padding: 1.25rem; color: #142525; background: #f3f7f6 }}
section {{ background: white; padding: clamp(.7rem,3vw,1.5rem); margin-block: 1.4rem; border: 1px solid #ccd9d6; border-radius: .5rem }}
h2 {{ margin-top: 0 }}
table {{ border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums }}
caption {{ text-align: left; margin-bottom: .4rem }}
th, td {{ text-align: left; padding: .4rem .3rem; border-bottom: 1px solid #ccd9d6 }}
.bar {{ height: .8rem; background: #157568; border-radius: .15rem }}
a {{ color: #075a52 }}
</style>
</head><body><main><h1>鐵道年度運量</h1>
<p>各序列的統計範圍與口徑標示於圖表，各圖使用獨立比例。</p>
{charts}</main></body></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input-dir", type=Path)
    source.add_argument("--snapshot", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.snapshot:
            corpus = json.loads(args.snapshot.read_text(encoding="utf-8"))
        else:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
            corpus = build_corpus(manifest, args.input_dir)
        preview = render_html(corpus) + "\n"
        args.output_dir.mkdir(parents=True, exist_ok=True)
        if args.input_dir:
            data = json.dumps(corpus, ensure_ascii=False, indent=2) + "\n"
            (args.output_dir / "passengers.json").write_text(data, encoding="utf-8", newline="\n")
        (args.output_dir / "index.html").write_text(preview, encoding="utf-8", newline="\n")
    except (ValueError, OSError, csv.Error) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
