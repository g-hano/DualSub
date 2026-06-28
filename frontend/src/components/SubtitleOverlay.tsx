import type { Line, SubtitleStyleSettings, TrackStyle } from "../types";

function WordLine({
  line,
  time,
  track,
}: {
  line: Line;
  time: number;
  track: TrackStyle;
}) {
  if (!line.words || line.words.length === 0) {
    return <span>{line.text}</span>;
  }
  return (
    <>
      {line.words.map((word, i) => {
        const active = time >= word.start && time < word.end;
        const done = time >= word.end;
        const color = active
          ? track.karaoke_active_color
          : done
            ? track.karaoke_done_color
            : track.color;
        return (
          <span
            key={i}
            className="word"
            style={{
              color,
              textShadow: active ? `0 0 14px ${track.karaoke_active_color}88` : undefined,
            }}
          >
            {word.w}
            {i < line.words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </>
  );
}

function TrackLine({
  line,
  time,
  track,
}: {
  line: Line;
  time: number;
  track: TrackStyle;
}) {
  return (
    <div
      className="max-w-[95%] rounded-xl px-5 py-2 leading-snug backdrop-blur-sm"
      style={{
        fontSize: track.font_size,
        fontFamily: track.font_family,
        color: track.color,
        fontWeight: track.bold ? 700 : 400,
        fontStyle: track.italic ? "italic" : "normal",
        backgroundColor: `rgba(0,0,0,${track.background_opacity})`,
      }}
    >
      <WordLine line={line} time={time} track={track} />
    </div>
  );
}

export default function SubtitleOverlay({
  source,
  target,
  time,
  style,
}: {
  source: Line;
  target: Line;
  time: number;
  style: SubtitleStyleSettings;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end gap-2 px-4 pb-6 text-center">
      <TrackLine line={source} time={time} track={style.source} />
      <TrackLine line={target} time={time} track={style.target} />
    </div>
  );
}
