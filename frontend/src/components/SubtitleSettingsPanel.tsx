import type { SubtitleStyleSettings, TrackStyle } from "../types";
import Accordion from "./ui/Accordion";
import Select from "./ui/Select";
import Input from "./ui/Input";

const TIER_LABEL: Record<string, string> = {
  ready: "Transcription-ready",
  broad: "Broad-coverage",
  adaptation: "Adaptation-ready",
};

export default function SubtitleSettingsPanel({
  settings,
  fonts,
  onSourceChange,
  onTargetChange,
  onReset,
  sourceLabel = "Spoken language",
  targetLabel = "Translation",
  embedded = false,
}: {
  settings: SubtitleStyleSettings;
  fonts: string[];
  onSourceChange: (patch: Partial<TrackStyle>) => void;
  onTargetChange: (patch: Partial<TrackStyle>) => void;
  onReset: () => void;
  sourceLabel?: string;
  targetLabel?: string;
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "" : "rounded-lg border border-border bg-surface p-4"}>
      <div className="mb-3 flex items-center justify-between gap-3">
        {!embedded && (
          <h3 className="text-sm font-medium text-zinc-200">Subtitle appearance</h3>
        )}
        {embedded && (
          <p className="text-xs text-accent-muted">
            Adjust on-screen preview and export styling. Export uses system fonts.
          </p>
        )}
        <button
          type="button"
          onClick={onReset}
          className="ml-auto shrink-0 text-xs text-zinc-500 transition hover:text-zinc-300"
        >
          Reset
        </button>
      </div>
      <div className="space-y-3">
        <TrackEditor
          label={sourceLabel}
          track={settings.source}
          fonts={fonts}
          onChange={onSourceChange}
        />
        <TrackEditor
          label={targetLabel}
          track={settings.target}
          fonts={fonts}
          onChange={onTargetChange}
        />
      </div>
    </div>
  );
}

function TrackEditor({
  label,
  track,
  fonts,
  onChange,
}: {
  label: string;
  track: TrackStyle;
  fonts: string[];
  onChange: (patch: Partial<TrackStyle>) => void;
}) {
  return (
    <Accordion
      title={label}
      description={`${track.font_family} · ${track.font_size}px`}
      defaultOpen={false}
      variant="ghost"
    >
      <div className="space-y-3">
        <Select
          label="Font"
          value={track.font_family}
          onChange={(e) => onChange({ font_family: e.target.value })}
        >
          {fonts.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>

        <label className="block">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-accent-muted">Size</span>
            <span className="font-mono text-zinc-500">{track.font_size}px</span>
          </div>
          <input
            type="range"
            min={12}
            max={48}
            step={1}
            value={track.font_size}
            onChange={(e) => onChange({ font_size: Number(e.target.value) })}
            className="subtitle-font-slider w-full"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Text color" value={track.color} onChange={(c) => onChange({ color: c })} />
          <ColorField
            label="Karaoke active"
            value={track.karaoke_active_color}
            onChange={(c) => onChange({ karaoke_active_color: c })}
          />
          <ColorField
            label="Karaoke done"
            value={track.karaoke_done_color}
            onChange={(c) => onChange({ karaoke_done_color: c })}
          />
          <label className="block text-xs">
            <span className="text-accent-muted">Background</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(track.background_opacity * 100)}
              onChange={(e) => onChange({ background_opacity: Number(e.target.value) / 100 })}
              className="subtitle-font-slider mt-1 w-full"
            />
          </label>
        </div>

        <div className="flex gap-4 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-zinc-400">
            <input
              type="checkbox"
              checked={track.bold}
              onChange={(e) => onChange({ bold: e.target.checked })}
              className="accent-zinc-400"
            />
            Bold
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-zinc-400">
            <input
              type="checkbox"
              checked={track.italic}
              onChange={(e) => onChange({ italic: e.target.checked })}
              className="accent-zinc-400"
            />
            Italic
          </label>
        </div>

        <p
          className="truncate rounded px-2 py-1"
          style={{
            fontSize: track.font_size,
            fontFamily: track.font_family,
            color: track.color,
            fontWeight: track.bold ? 700 : 400,
            fontStyle: track.italic ? "italic" : "normal",
            backgroundColor: `rgba(0,0,0,${track.background_opacity})`,
          }}
          aria-hidden
        >
          Sample — {label}
        </p>
      </div>
    </Accordion>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-accent-muted">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 px-2 py-1 font-mono text-[11px]"
        />
      </div>
    </label>
  );
}

export { TIER_LABEL };
