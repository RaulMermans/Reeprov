#!/usr/bin/env python3
"""Build manuscript.html and KARMA_POLICE_Final_Paper.pdf (stdlib + Chrome)."""
import base64
import html
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path("docs/research/h3-final")
CHROME_CANDIDATES = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def chrome_bin() -> str:
    for path in CHROME_CANDIDATES:
        if Path(path).exists():
            return path
    found = shutil.which("google-chrome") or shutil.which("google-chrome-stable")
    if not found:
        raise SystemExit("Google Chrome not found")
    return found


def inline(t: str) -> str:
    t = html.escape(t, quote=False)

    def code_sub(m: re.Match[str]) -> str:
        inner = m.group(1)
        cls = ' class="long"' if len(inner) > 36 else ""
        return f"<code{cls}>{inner}</code>"

    t = re.sub(r"`([^`]+)`", code_sub, t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", t)
    t = re.sub(r"(https?://[^\s<)]+[^\s<).,])", r'<span class="url">\1</span>', t)
    return t


def fig(name: str, alt: str, caption: str) -> str:
    path = ROOT / "figures" / name
    raw = path.read_bytes()
    mime = "image/svg+xml" if path.suffix == ".svg" else "image/png"
    b64 = base64.b64encode(raw).decode()
    return (
        f'<figure><img alt="{alt}" src="data:{mime};base64,{b64}"/>'
        f"<figcaption>{caption}</figcaption></figure>"
    )


FIGS = {
    "{{FIG1}}": fig(
        "figure1-architecture.svg",
        "KARMA POLICE architecture",
        "<strong>Figure 1.</strong> KARMA POLICE evidence-verification architecture. "
        "A canonical REEPROV run passes a detector-only access gate. Evidence from all "
        "agents is indexed; claims are resolved by deterministic rules with no model calls. "
        "Outputs are a three-way factual verdict and, separately, typed provenance anomalies.",
    ),
    "{{FIG2}}": fig(
        "figure2-live-handoff.svg",
        "Live consumed handoff in H2-C",
        "<strong>Figure 2.</strong> H2-C controlled handoff propagation on an adapted "
        "Microsoft Agent Framework workflow (not HandoffBuilder). The sandbox tool reports "
        "that ORD-8841 will ship; the producer paraphrases that result; the sequential "
        "controller may deliver a false-status payload; the receiving agent's captured "
        "model input contains the delivered sentence. Refund-specialist routing changed "
        "after false-status deliveries; <code>process_refund</code> did not execute. "
        "Panel E reports frozen-monitor scores on all 22 gold claims.",
    ),
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
            if h.startswith("Appendix A"):
                cls = ' class="pb"'
            out.append(f"<h2{cls}>{inline(h)}</h2>")
            if h == "Abstract":
                j = i + 1
                while not lines[j].strip():
                    j += 1
                abstract = lines[j]
                out.append(f'<p class="abstract">{inline(abstract)}</p>')
                out.append(
                    "<div class='fn'><sup>1</sup> Research conducted at the "
                    "Apart Research Swarm Alignment Hackathon, 6–8 November 2026, "
                    "Track 4: Multi-Agent Oversight and Control. "
                    "“With Apart Research” denotes hackathon context, not employment.</div>"
                )
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
            out.append(
                f'<ul class="{refs.strip()}">'
                + "".join(f"<li>{inline(x)}</li>" for x in items)
                + "</ul>"
            )
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
@page { size: Letter; margin: 0.7in 0.78in 0.7in 0.78in; }
body { font-family: 'Times New Roman', Times, serif; font-size: 10pt; line-height: 1.22; color:#000; hyphens: none; -webkit-hyphens: none; }
.titleblock { border-top: 3px solid #000; border-bottom: 1px solid #000; padding: 7px 0; text-align:center; margin-bottom: 6px; }
.titleblock h1 { font-size: 15.5pt; margin: 2px 0; font-weight: bold; }
.authors { text-align:center; margin: 5px 0 2px; line-height:1.25; font-size: 10.5pt; }
h2 { font-size: 11.5pt; margin: 10px 0 3px; }
.pb { break-before: page; }
p { margin: 0 0 4.5px; text-align: justify; }
.abstract { margin-left: 7%; margin-right: 7%; font-size: 10pt; hyphens: none; -webkit-hyphens: none; }
h2:first-of-type { text-align:center; font-size: 11pt; margin-bottom: 2px; }
ul, ol { margin: 2px 0 5px 0; padding-left: 18px; }
li { margin-bottom: 2px; text-align: left; }
ul.refs { list-style: none; padding-left: 0; font-size: 8.8pt; }
ul.refs li { padding-left: 14px; text-indent: -14px; margin-bottom: 2.5px; text-align:left; word-break: break-word; }
code { font-family: Menlo, Courier, monospace; font-size: 8.2pt; white-space: nowrap; }
code.long { white-space: normal; overflow-wrap: anywhere; word-break: break-all; }
.url { font-family: inherit; word-break: break-all; }
table { border-collapse: collapse; width: 100%; font-size: 8pt; margin: 3px 0 2px; page-break-inside: avoid; }
th, td { border-top: 0.6px solid #555; border-bottom: 0.6px solid #555; padding: 1px 3px; text-align: left; vertical-align: top; }
th { background: #eee; }
.caption { font-size: 8.4pt; margin: 2px 0 7px; }
figure { margin: 6px 0 4px; text-align:center; page-break-inside: avoid; }
figure img { width: 100%; }
figcaption { font-size: 8.6pt; text-align: justify; margin-top: 2px; }
.fn { font-size: 8pt; border-top: 0.6px solid #000; width: 72%; margin-top: 8px; padding-top: 2px; }
"""


def main() -> None:
    title, abstract, body = convert((ROOT / "manuscript.md").read_text(encoding="utf-8"))
    n_words = len(abstract.split())
    if not (150 <= n_words <= 250):
        raise SystemExit(f"abstract word count {n_words} not in 150–250")
    header = (
        f'<div class="titleblock"><h1>{html.escape(title)}<sup>1</sup></h1></div>'
        '<div class="authors"><strong>Raúl Mermans</strong><br/>Independent Researcher'
        "<br/><br/>With<br/>Apart Research</div>"
    )
    doc = (
        f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
        f"<style>{CSS}</style></head><body>{header}{body}</body></html>"
    )
    html_path = ROOT / "manuscript.html"
    html_path.write_text(doc, encoding="utf-8")
    pdf = ROOT / "KARMA_POLICE_Final_Paper.pdf"
    subprocess.run(
        [
            chrome_bin(),
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--user-data-dir=/tmp/chrome-h3-final-pdf",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf.resolve()}",
            html_path.resolve().as_uri(),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    info = subprocess.check_output(["pdfinfo", str(pdf)], text=True)
    pages = None
    for line in info.splitlines():
        if line.startswith("Pages:"):
            pages = int(line.split(":")[1].strip())
    text = subprocess.check_output(["pdftotext", "-layout", str(pdf), "-"], text=True)
    ref_page = None
    chunks = text.split("\f")
    for idx, chunk in enumerate(chunks, 1):
        if re.search(r"(?m)^References\s*$", chunk) and ref_page is None:
            ref_page = idx
    main_pages = (ref_page - 1) if ref_page else None
    print(f"abstract_words={n_words} total_pages={pages} references_start_page={ref_page}")
    print(f"main_text_pages={main_pages} (limit 8)")
    if main_pages is None:
        raise SystemExit("could not locate References page")
    if main_pages > 8:
        raise SystemExit(f"main text is {main_pages} pages; limit is 8")
    banned = [
        "statistically significant",
        "production-ready",
        "production ready",
        "first system of its kind",
        "unauthorized refund occurred",
        "executed an unauthorized refund",
    ]
    lowered = text.lower()
    for phrase in banned:
        if phrase in lowered:
            raise SystemExit(f"banned phrase in PDF: {phrase}")
    if "process_refund executed: 0/8" not in text.replace("\n", " ") and "process_refund execution: 0/8" not in text.replace("\n", " "):
        # tolerate wrapping
        compact = re.sub(r"\s+", " ", text)
        if "0/8" not in compact or "process_refund" not in compact:
            raise SystemExit("PDF missing process_refund 0/8 disclosure")


if __name__ == "__main__":
    main()
