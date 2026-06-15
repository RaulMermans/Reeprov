"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { ArtifactCard } from "@/lib/runs/runIntelligence";

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ArtifactCardView({ artifact }: { artifact: ArtifactCard }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyPreview() {
    if (!artifact.preview) return;
    try {
      await navigator.clipboard.writeText(artifact.preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access denied — non-fatal
    }
  }

  return (
    <Card className="p-4" data-testid={`artifact-card-${artifact.ref}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{artifact.title}</h3>
          <p className="mt-1 text-xs font-mono text-slate-400">{artifact.ref}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {artifact.artifactType ? <Badge tone="info">{artifact.artifactType}</Badge> : null}
          {artifact.sizeLabel ? <Badge tone="neutral">{artifact.sizeLabel}</Badge> : null}
        </div>
      </div>

      {artifact.preview ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              className="text-xs font-medium text-teal-700 hover:underline"
              data-testid={`artifact-preview-toggle-${artifact.ref}`}
            >
              {open ? "Hide preview ▲" : "Preview ▼"}
            </button>
            <button
              type="button"
              onClick={() => void copyPreview()}
              className="text-xs font-medium text-slate-500 hover:text-teal-700 hover:underline"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => downloadText(`${artifact.ref}.md`, artifact.preview ?? "")}
              className="text-xs font-medium text-slate-500 hover:text-teal-700 hover:underline"
            >
              Download
            </button>
          </div>
          {open ? (
            <pre
              className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700"
              data-testid={`artifact-preview-${artifact.ref}`}
            >
              {artifact.preview}
            </pre>
          ) : null}
        </div>
      ) : artifact.downloadUrl ? (
        <a
          href={artifact.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs font-medium text-teal-700 hover:underline"
        >
          Open artifact →
        </a>
      ) : (
        <p className="mt-3 text-xs text-slate-500">No preview content recorded for this artifact.</p>
      )}
    </Card>
  );
}

/**
 * Surfaces final artifacts prominently — `article_markdown` artifacts get an
 * expandable markdown preview with copy/download actions.
 */
export function ArtifactPreviewPanel({ artifacts }: { artifacts: ArtifactCard[] }) {
  if (!artifacts.length) {
    return <Card className="p-5 text-sm text-slate-600">No artifacts recorded for this run.</Card>;
  }

  return (
    <div className="grid gap-3" data-testid="artifact-preview-panel">
      {artifacts.map((artifact) => (
        <ArtifactCardView key={artifact.ref} artifact={artifact} />
      ))}
    </div>
  );
}
