"use client";

import type { VisualReplayEvent } from "@/lib/visualGraph/replay";

const SPEEDS = [1, 2, 4] as const;

export interface ReplayControlsProps {
  events: VisualReplayEvent[];
  currentIndex: number;
  playing: boolean;
  speed: 1 | 2 | 4;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onScrub: (index: number) => void;
  onSpeedChange: (speed: 1 | 2 | 4) => void;
}

export function ReplayControls({
  events,
  currentIndex,
  playing,
  speed,
  onPlay,
  onPause,
  onReset,
  onStepForward,
  onStepBackward,
  onScrub,
  onSpeedChange,
}: ReplayControlsProps) {
  const max = Math.max(0, events.length - 1);
  const currentEvent = currentIndex >= 0 ? events[currentIndex] : undefined;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid="replay-controls">
      <div className="flex flex-wrap items-center gap-2">
        {playing ? (
          <button type="button" className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white" onClick={onPause}>
            Pause
          </button>
        ) : (
          <button type="button" className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-medium text-white" onClick={onPlay}>
            Play
          </button>
        )}
        <button type="button" className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600" onClick={onReset}>
          Reset
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600"
          onClick={onStepBackward}
          disabled={currentIndex <= -1}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600"
          onClick={onStepForward}
          disabled={currentIndex >= max}
        >
          Step
        </button>
        <div className="ml-auto flex items-center gap-1">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={[
                "rounded-md border px-2 py-1 text-xs",
                speed === value ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500",
              ].join(" ")}
              onClick={() => onSpeedChange(value)}
            >
              {value}x
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 grid gap-1.5">
        <input
          type="range"
          min={-1}
          max={max}
          value={Math.min(currentIndex, max)}
          onChange={(event) => onScrub(Number(event.target.value))}
          aria-label="Replay timeline"
          data-testid="replay-scrubber"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <span className="min-w-0 truncate" data-testid="replay-current-event">
            {currentEvent?.label ?? "Replay reset"}
          </span>
          <span className="shrink-0 tabular-nums">
            {Math.max(0, currentIndex + 1)} / {events.length}
          </span>
        </div>
      </div>
    </div>
  );
}
