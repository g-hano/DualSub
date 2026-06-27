import { useEffect, useMemo, useRef, useState } from "react";
import type { Cue } from "../types";
import type { SubtitleFontSettings } from "../hooks/useSubtitleFontSettings";
import SubtitleOverlay from "./SubtitleOverlay";
import SubtitleSettingsPanel from "./SubtitleSettingsPanel";
import { useSubtitleFontSettings } from "../hooks/useSubtitleFontSettings";

function findCueIndex(cues: Cue[], time: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < cues[mid].start) {
      hi = mid - 1;
    } else if (time > cues[mid].end) {
      lo = mid + 1;
    } else {
      ans = mid;
      break;
    }
  }
  return ans;
}

export default function Player({
  src,
  cues,
  sourceLabel,
  targetLabel,
}: {
  src: string;
  cues: Cue[];
  sourceLabel?: string;
  targetLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const rafRef = useRef<number>(0);
  const { settings, setSourceFontSize, setTargetFontSize, reset } = useSubtitleFontSettings();

  useEffect(() => {
    const tick = () => {
      const v = videoRef.current;
      if (v) setTime(v.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const activeIndex = useMemo(() => findCueIndex(cues, time), [cues, time]);
  const activeCue = activeIndex >= 0 ? cues[activeIndex] : null;

  return (
    <div className="space-y-4">
      <SubtitleSettingsPanel
        settings={settings}
        onSourceChange={setSourceFontSize}
        onTargetChange={setTargetFontSize}
        onReset={reset}
        sourceLabel={sourceLabel}
        targetLabel={targetLabel}
      />

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
        <video ref={videoRef} src={src} controls className="block w-full" />
        {activeCue && (
          <SubtitleOverlay
            source={activeCue.source}
            target={activeCue.target}
            time={time}
            fonts={settings}
          />
        )}
      </div>

      <Transcript
        cues={cues}
        activeIndex={activeIndex}
        fonts={settings}
        onSeek={(t) => {
          if (videoRef.current) videoRef.current.currentTime = t;
        }}
      />
    </div>
  );
}

function Transcript({
  cues,
  activeIndex,
  fonts,
  onSeek,
}: {
  cues: Cue[];
  activeIndex: number;
  fonts: SubtitleFontSettings;
  onSeek: (t: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div
      ref={listRef}
      className="max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-panel/60 p-3"
    >
      {cues.map((cue, i) => (
        <button
          key={cue.id}
          data-idx={i}
          onClick={() => onSeek(cue.start)}
          className={`block w-full rounded-lg px-3 py-2 text-left transition ${
            i === activeIndex ? "bg-brand/20 ring-1 ring-brand/50" : "hover:bg-white/5"
          }`}
        >
          <div
            className="font-semibold text-white"
            style={{ fontSize: Math.max(12, fonts.sourceFontSize - 4) }}
          >
            {cue.source.text}
          </div>
          <div
            className="italic text-emerald-200/90"
            style={{ fontSize: Math.max(12, fonts.targetFontSize - 4) }}
          >
            {cue.target.text}
          </div>
        </button>
      ))}
    </div>
  );
}
