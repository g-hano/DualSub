import type { Line } from "../types";
import type { SubtitleFontSettings } from "../hooks/useSubtitleFontSettings";

function WordLine({ line, time }: { line: Line; time: number }) {
  if (!line.words || line.words.length === 0) {
    return <span>{line.text}</span>;
  }
  return (
    <>
      {line.words.map((word, i) => {
        let cls = "word";
        if (time >= word.start && time < word.end) cls += " word-active";
        else if (time >= word.end) cls += " word-done";
        return (
          <span key={i} className={cls}>
            {word.w}
            {i < line.words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </>
  );
}

export default function SubtitleOverlay({
  source,
  target,
  time,
  fonts,
}: {
  source: Line;
  target: Line;
  time: number;
  fonts: SubtitleFontSettings;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-6 pb-8 text-center">
      <div
        className="max-w-4xl rounded-xl bg-black/55 px-5 py-2 font-semibold leading-snug text-white backdrop-blur-sm"
        style={{ fontSize: fonts.sourceFontSize }}
      >
        <WordLine line={source} time={time} />
      </div>
      <div
        className="max-w-4xl rounded-xl bg-black/45 px-5 py-1.5 font-medium italic leading-snug text-emerald-200 backdrop-blur-sm"
        style={{ fontSize: fonts.targetFontSize }}
      >
        <WordLine line={target} time={time} />
      </div>
    </div>
  );
}
