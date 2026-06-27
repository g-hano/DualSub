import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { getAsrModels, getLanguages } from "../api";
import type { AsrEngine, AsrModelOption, CreateJobParams } from "../types";

const CUSTOM_WHISPER = "__custom__";
import type { SubtitleFontSettings } from "../hooks/useSubtitleFontSettings";
import CollapsibleSection from "./CollapsibleSection";
import SubtitleSettingsPanel from "./SubtitleSettingsPanel";

const BACKENDS = [
  { id: "helsinki", label: "Helsinki opus-mt (fast, recommended)" },
  { id: "hunyuan", label: "Hunyuan Hy-MT2-1.8B" },
  { id: "translategemma", label: "TranslateGemma 4B" },
];

export default function JobForm({
  onSubmit,
  busy,
  fontSettings,
  onSourceFontSize,
  onTargetFontSize,
  onFontReset,
}: {
  onSubmit: (params: CreateJobParams) => void;
  busy: boolean;
  fontSettings: SubtitleFontSettings;
  onSourceFontSize: (px: number) => void;
  onTargetFontSize: (px: number) => void;
  onFontReset: () => void;
}) {
  const [languages, setLanguages] = useState<Record<string, string>>({ sv: "Swedish", en: "English" });
  const [mode, setMode] = useState<"url" | "file">("url");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState("sv");
  const [targetLang, setTargetLang] = useState("en");
  const [asrModels, setAsrModels] = useState<AsrModelOption[]>([
    { repo_id: "Qwen/Qwen3-ASR-1.7B", label: "Qwen3 ASR 1.7B" },
  ]);
  const [alignerModels, setAlignerModels] = useState<AsrModelOption[]>([
    { repo_id: "Qwen/Qwen3-ForcedAligner-0.6B", label: "Qwen3 Forced Aligner 0.6B" },
  ]);
  const [asrModel, setAsrModel] = useState("Qwen/Qwen3-ASR-1.7B");
  const [forcedAlignerModel, setForcedAlignerModel] = useState("Qwen/Qwen3-ForcedAligner-0.6B");
  const [asrEngine, setAsrEngine] = useState<AsrEngine>("qwen");
  const [whisperModels, setWhisperModels] = useState<AsrModelOption[]>([
    { repo_id: "openai/whisper-small", label: "Whisper Small" },
    { repo_id: "openai/whisper-medium", label: "Whisper Medium" },
    { repo_id: "openai/whisper-large-v3", label: "Whisper Large v3" },
  ]);
  const [whisperPreset, setWhisperPreset] = useState("openai/whisper-large-v3");
  const [whisperCustom, setWhisperCustom] = useState("");
  const [translatorBackend, setTranslatorBackend] = useState("helsinki");
  const [translateBatchSize, setTranslateBatchSize] = useState(16);
  const [qcEnabled, setQcEnabled] = useState(false);
  const [lmstudioUrl, setLmstudioUrl] = useState("http://localhost:1234/v1");
  const [lmstudioModel, setLmstudioModel] = useState("local-model");

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => undefined);
    getAsrModels()
      .then((data) => {
        setAsrModels(data.asr_models);
        setAlignerModels(data.forced_aligner_models);
        if (data.whisper_models?.length) setWhisperModels(data.whisper_models);
      })
      .catch(() => undefined);
  }, []);

  const whisperModel =
    whisperPreset === CUSTOM_WHISPER ? whisperCustom.trim() : whisperPreset;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      sourceUrl: mode === "url" ? sourceUrl.trim() : undefined,
      file: mode === "file" ? file : null,
      sourceLang,
      targetLang,
      asrEngine,
      asrModel,
      forcedAlignerModel,
      whisperModel: asrEngine === "whisper" ? whisperModel : "openai/whisper-large-v3",
      translatorBackend,
      translateBatchSize,
      qcEnabled,
      lmstudioUrl,
      lmstudioModel,
    });
  };

  const hasSource = mode === "url" ? sourceUrl.trim().length > 0 : !!file;
  const whisperValid = asrEngine !== "whisper" || whisperModel.length > 0;
  const canSubmit = hasSource && whisperValid;

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-white/10 bg-panel/60 p-6">
      <div className="flex gap-2">
        <TabButton active={mode === "url"} onClick={() => setMode("url")}>
          YouTube URL
        </TabButton>
        <TabButton active={mode === "file"} onClick={() => setMode("file")}>
          Upload file
        </TabButton>
      </div>

      {mode === "url" ? (
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-lg border border-white/10 bg-ink px-4 py-3 outline-none focus:border-brand"
        />
      ) : (
        <input
          type="file"
          accept="video/*,audio/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-lg border border-white/10 bg-ink px-4 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-white"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <Select label="Spoken language" value={sourceLang} onChange={setSourceLang} options={languages} />
        <Select label="Translate to" value={targetLang} onChange={setTargetLang} options={languages} />
      </div>

      <CollapsibleSection title="Advanced settings">
        <div>
          <Label>ASR engine</Label>
          <div className="flex gap-2">
            <TabButton active={asrEngine === "qwen"} onClick={() => setAsrEngine("qwen")}>
              Qwen3-ASR
            </TabButton>
            <TabButton active={asrEngine === "whisper"} onClick={() => setAsrEngine("whisper")}>
              Whisper
            </TabButton>
          </div>
        </div>

        {asrEngine === "qwen" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RepoSelect
              label="ASR model"
              value={asrModel}
              onChange={setAsrModel}
              options={asrModels}
            />
            <RepoSelect
              label="Forced aligner"
              value={forcedAlignerModel}
              onChange={setForcedAlignerModel}
              options={alignerModels}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Whisper model</Label>
              <select
                value={whisperPreset}
                onChange={(e) => setWhisperPreset(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
              >
                {whisperModels.map((opt) => (
                  <option key={opt.repo_id} value={opt.repo_id}>
                    {opt.label}
                  </option>
                ))}
                <option value={CUSTOM_WHISPER}>Custom HF model…</option>
              </select>
            </div>
            {whisperPreset === CUSTOM_WHISPER && (
              <input
                value={whisperCustom}
                onChange={(e) => setWhisperCustom(e.target.value)}
                placeholder="e.g. openai/whisper-large-v3"
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            )}
          </div>
        )}

        <div>
          <Label>Translation engine</Label>
          <select
            value={translatorBackend}
            onChange={(e) => setTranslatorBackend(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
          >
            {BACKENDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label>Translation batch size</Label>
          <input
            type="number"
            min={1}
            max={128}
            value={translateBatchSize}
            onChange={(e) =>
              setTranslateBatchSize(
                Math.min(128, Math.max(1, Number(e.target.value) || 1))
              )
            }
            className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-ink/60 p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={qcEnabled}
              onChange={(e) => setQcEnabled(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            <span className="font-medium">Quality control (back-translate + LM Studio fix)</span>
          </label>
          {qcEnabled && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                value={lmstudioUrl}
                onChange={(e) => setLmstudioUrl(e.target.value)}
                placeholder="LM Studio URL"
                className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <input
                value={lmstudioModel}
                onChange={(e) => setLmstudioModel(e.target.value)}
                placeholder="Model name"
                className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
          )}
        </div>

        <div className="border-t border-white/10 pt-4">
          <SubtitleSettingsPanel
            settings={fontSettings}
            onSourceChange={onSourceFontSize}
            onTargetChange={onTargetFontSize}
            onReset={onFontReset}
            sourceLabel={languages[sourceLang] ?? sourceLang}
            targetLabel={languages[targetLang] ?? targetLang}
            embedded
          />
        </div>
      </CollapsibleSection>

      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Processing..." : "Generate dual subtitles"}
      </button>
    </form>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
        active ? "bg-brand text-white" : "bg-ink text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-sm font-medium text-white/70">{children}</div>;
}

function RepoSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: AsrModelOption[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
      >
        {options.map((opt) => (
          <option key={opt.repo_id} value={opt.repo_id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
      >
        {Object.entries(options).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
