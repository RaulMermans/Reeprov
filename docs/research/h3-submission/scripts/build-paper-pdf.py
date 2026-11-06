#!/usr/bin/env python3
"""Build manuscript.html and the final PDF from manuscript.md (no network, stdlib + pypdf)."""
import base64
import html
import re
import subprocess
from pathlib import Path

ROOT = Path("docs/research/h3-submission")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def inline(t: str) -> str:
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", t)
    t = re.sub(r"(https?://[^\s<)]+[^\s<).,])", r'<span class="url">\1</span>', t)
    return t


def fig(name: str, alt: str, caption: str) -> str:
    b64 = base64.b64encode((ROOT / "figures" / name).read_bytes()).decode()
    return (f'<figure><img alt="{alt}" src="data:image/svg+xml;base64,{b64}"/>'
            f"<figcaption>{caption}</figcaption></figure>")


FIGS = {
    "{{FIG1}}": fig(
        "figure1-architecture.svg", "KARMA POLICE architecture",
        "<strong>Figure 1.</strong> KARMA POLICE evidence-verification architecture. A canonical REEPROV run passes through a "
        "detector-only access gate (the evaluator store with oracle labels is blocked). Evidence from all agents is indexed; "
        "claims are resolved by four deterministic rule groups with no model calls. Outputs are a three-way factual verdict and, "
        "separately, typed provenance anomalies. The independent scorer reads oracle labels only after predictions are committed and hashed."),
    "{{FIG2}}": fig(
        "figure2-handoff-mismatch.svg", "Producer to handoff to downstream decision",
        "<strong>Figure 2.</strong> Tampered episode <code>maf-cs-tamper-01</code> (pinned Microsoft Agent Framework, offline deterministic chat client, "
        "no live provider calls). The producer's recorded tool output says the order is being processed; the delivered handoff says it failed; "
        "the downstream agent then calls a simulated refund example tool (not a financial transaction). Panel D shows each monitor's label for all six gold claims "
        "(per-agent and pooled-event: 1/6 correct, 0/4 contradiction recall; KARMA POLICE: 6/6, 4/4)."),
}


def convert(md: str):
    lines = md.split("\n")
    out, i, abstract = [], 0, ""
    title = ""
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("# "):
            title = ln[2:]
            i += 1
        elif ln.startswith("## "):
            h = ln[3:]
            cls = ""
            if h == "References" or h.startswith("Appendix A"):
                cls = ' class="pb"'
            out.append(f"<h2{cls}>{inline(h)}</h2>")
            if h == "Abstract":
                j = i + 1
                while not lines[j].strip():
                    j += 1
                abstract = lines[j]
                out.append(f'<p class="abstract">{inline(abstract)}</p>')
                out.append("<div class='fn'><sup>1</sup> Research conducted at the Swarm Alignment Hackathon, November 2026</div>")
                i = j
            i += 1
        elif ln.strip() in FIGS:
            out.append(FIGS[ln.strip()])
            i += 1
        elif ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            head, body = rows[0], rows[2:]
            t = "<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
            for r in body:
                t += "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>"
            out.append(t + "</tbody></table>")
        elif re.match(r"^\d+\. ", ln):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                items.append(re.sub(r"^\d+\. ", "", lines[i]))
                i += 1
            out.append("<ol>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ol>")
        elif ln.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(lines[i][2:])
                i += 1
            refs = " refs" if out and "References" in out[-1] else ""
            out.append(f'<ul class="{refs.strip()}">' + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ul>")
        elif ln.startswith("*") and ln.endswith("*") and not ln.startswith("**"):
            out.append(f'<p class="caption">{inline(ln)}</p>')
            i += 1
        elif ln.strip():
            out.append(f"<p>{inline(ln)}</p>")
            i += 1
        else:
            i += 1
    return title, abstract, "\n".join(out)


CSS = """
@page land { size: Letter landscape; margin: 0.55in 0.5in; }
@page { size: Letter; margin: 0.75in 0.85in 0.75in 0.85in; }
body { font-family: 'Times New Roman', Times, serif; font-size: 10pt; line-height: 1.26; color:#000; }
.titleblock { border-top: 3px solid #000; border-bottom: 1px solid #000; padding: 8px 0; text-align:center; margin-bottom: 8px; }
.titleblock h1 { font-size: 17pt; margin: 2px 0; font-weight: bold; }
.authors { text-align:center; margin: 6px 0 2px; line-height:1.3 }
h2 { font-size: 12pt; margin: 12px 0 4px; }
.pb { break-before: page; }
p { margin: 0 0 5px; text-align: justify; }
.abstract { margin-left: 8%; margin-right: 8%; font-size: 10pt; }
h2:first-of-type { text-align:center; font-size: 11pt; margin-bottom: 2px; }
ul, ol { margin: 2px 0 6px 0; padding-left: 20px; }
li { margin-bottom: 2px; text-align: justify; }
ul.refs { list-style: none; padding-left: 0; font-size: 9.2pt; }
ul.refs li { padding-left: 16px; text-indent: -16px; margin-bottom: 3px; text-align:left; word-break: break-word; }
code { font-family: Menlo, Courier, monospace; font-size: 8.4pt; }
.url { font-family: inherit; word-break: break-all; }
table { border-collapse: collapse; width: 100%; font-size: 8.2pt; margin: 4px 0 2px; page-break-inside: avoid; }
th, td { border-top: 0.6px solid #555; border-bottom: 0.6px solid #555; padding: 1px 4px; text-align: left; vertical-align: top; }
th { background: #eee; }
.caption { font-size: 8.8pt; margin: 2px 0 8px; }
figure { page: land; break-before: page; break-after: page; margin: 0; text-align:center; }
figure img { width: 100%; }
figcaption { font-size: 10pt; text-align: justify; margin-top: 3px; }
.fn { font-size: 8.5pt; border-top: 0.6px solid #000; width: 35%; margin-top: 10px; padding-top: 2px; }
"""


def main():
    title, abstract, body = convert((ROOT / "manuscript.md").read_text(encoding="utf-8"))
    n_words = len(abstract.split())
    assert 150 <= n_words <= 250, n_words
    header = (
        f'<div class="titleblock"><h1>{html.escape(title)}<sup>1</sup></h1></div>'
        '<div class="authors"><strong>Raúl Mermans</strong><br/>Independent Researcher<br/><br/>With<br/>Apart Research</div>'
    )
    # page 1 footnote placed after abstract section start
    doc = (f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
           f"<style>{CSS}</style></head><body>{header}{body}"
           "</body></html>")
    (ROOT / "manuscript.html").write_text(doc, encoding="utf-8")
    pdf = ROOT / "karma-police-apart-2026.pdf"
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox",
                    "--user-data-dir=/tmp/chrome-pdf-profile", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf.resolve()}", (ROOT / "manuscript.html").resolve().as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    from pypdf import PdfReader
    r = PdfReader(str(pdf))
    ref_page = None
    for idx, p in enumerate(r.pages, 1):
        txt = p.extract_text() or ""
        if ref_page is None and re.search(r"^References\s*$", txt, re.M):
            ref_page = idx
    print(f"abstract_words={n_words} total_pages={len(r.pages)} references_start_page={ref_page}")
    print(f"main_text_pages={ref_page - 1 if ref_page else 'unknown'} (limit 8)")


if __name__ == "__main__":
    main()
