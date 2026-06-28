import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { getAsrModels, getLanguages, getTranslationModels, getTtsModels } from "../api";
import type {
  AsrEngine,
  AsrModelOption,
  JobFormSubmitParams,
  JobMode,
  TtsBackend,
  TtsBackendInfo,
  TtsModelsResponse,
  VoiceMode,
} from "../types";
import CollapsibleSection from "./CollapsibleSection";

const CUSTOM_WHISPER = "__custom__";

const BACKENDS = [
  { id: "helsinki", label: "Helsinki opus-mt (fast, recommended)" },
  { id: "nllb", label: "NLLB-200 (multilingual)" },
  { id: "hunyuan", label: "Hunyuan (HY-MT1.5 / Hy-MT2)" },
  { id: "translategemma", label: "TranslateGemma 4B" },
];

const TTS_BACKEND_LABELS: Record<TtsBackend, string> = {
  qwen: "Qwen3-TTS",
  kokoro: "Kokoro",
  voxcpm: "VoxCPM2",
  omnivoice: "OmniVoice",
  higgs: "Higgs TTS (external server)",
};

function defaultVoiceMode(backend: TtsBackend, ttsModel?: string): VoiceMode {
  if (backend === "qwen" && ttsModel?.includes("-Base")) return "clone_video";
  return backend === "qwen" || backend === "kokoro" ? "preset" : "clone_video";
}

function qwenModelKind(
  ttsModel: string,
  models: TtsModelsResponse["qwen_models"] | undefined
): string | undefined {
  return models?.find((m) => m.repo_id === ttsModel)?.kind;
}

export default function JobForm({
  onSubmit,
  busy,
}: {
  onSubmit: (params: JobFormSubmitParams) => void;
  busy: boolean;
}) {
  const [languages, setLanguages] = useState<Record<string, string>>({ sv: "Swedish", en: "English" });
  const [nemotronByIso, setNemotronByIso] = useState<
    Record<string, { locale: string; tier: string | null }>
  >({});
  const [jobMode, setJobMode] = useState<JobMode>("subtitle");
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
  const [whisperModels, setWhisperModels] = useState<AsrModelOption[]>([]);
  const [nemotronModels, setNemotronModels] = useState<AsrModelOption[]>([
    { repo_id: "nvidia/nemotron-3.5-asr-streaming-0.6b", label: "Nemotron 3.5 ASR 0.6B" },
  ]);
  const [nemotronModel, setNemotronModel] = useState("nvidia/nemotron-3.5-asr-streaming-0.6b");
  const [whisperPreset, setWhisperPreset] = useState("openai/whisper-large-v3");
  const [whisperCustom, setWhisperCustom] = useState("");
  const [translatorBackend, setTranslatorBackend] = useState("helsinki");
  const [nllbModels, setNllbModels] = useState<AsrModelOption[]>([]);
  const [nllbModel, setNllbModel] = useState("facebook/nllb-200-distilled-600M");
  const [hunyuanModels, setHunyuanModels] = useState<AsrModelOption[]>([]);
  const [hunyuanModel, setHunyuanModel] = useState("tencent/HY-MT1.5-1.8B");
  const [translateBatchSize, setTranslateBatchSize] = useState(16);
  const [qcEnabled, setQcEnabled] = useState(false);
  const [lmstudioUrl, setLmstudioUrl] = useState("http://localhost:1234/v1");
  const [lmstudioModel, setLmstudioModel] = useState("local-model");

  const [ttsMeta, setTtsMeta] = useState<TtsModelsResponse | null>(null);
  const [ttsBackend, setTtsBackend] = useState<TtsBackend>("qwen");
  const [ttsModel, setTtsModel] = useState("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("preset");
  const [voiceId, setVoiceId] = useState("Ryan");
  const [voiceDesignInstruct, setVoiceDesignInstruct] = useState("");
  const [voiceInstruct, setVoiceInstruct] = useState("");
  const [refText, setRefText] = useState("");
  const [refAudioFile, setRefAudioFile] = useState<File | null>(null);
  const [voiceCloneXVectorOnly, setVoiceCloneXVectorOnly] = useState(false);
  const [higgsServerUrl, setHiggsServerUrl] = useState("http://localhost:8000");
  const [keepBackground, setKeepBackground] = useState(true);

  useEffect(() => {
    getLanguages()
      .then((data) => {
        setLanguages(data.languages);
        if (data.nemotron_by_iso) setNemotronByIso(data.nemotron_by_iso);
      })
      .catch(() => undefined);
    getAsrModels()
      .then((data) => {
        setAsrModels(data.asr_models);
        setAlignerModels(data.forced_aligner_models);
        if (data.whisper_models?.length) setWhisperModels(data.whisper_models);
        if (data.nemotron_models?.length) setNemotronModels(data.nemotron_models);
      })
      .catch(() => undefined);
    getTranslationModels()
      .then((data) => {
        if (data.nllb_models?.length) setNllbModels(data.nllb_models);
        if (data.hunyuan_models?.length) setHunyuanModels(data.hunyuan_models);
      })
      .catch(() => undefined);
    getTtsModels()
      .then(setTtsMeta)
      .catch(() => undefined);
  }, []);

  const backendInfo: TtsBackendInfo | undefined = useMemo(
    () => ttsMeta?.backends.find((b) => b.id === ttsBackend),
    [ttsMeta, ttsBackend]
  );

  const isVoiceDesign = ttsBackend === "qwen" && ttsModel.includes("VoiceDesign");
  const qwenKind = qwenModelKind(ttsModel, ttsMeta?.qwen_models);
  const isVoiceClone = ttsBackend === "qwen" && qwenKind === "voice_clone";
  const showCloneUi = Boolean(backendInfo?.supports_clone || isVoiceClone);
  const showPresetUi =
    (backendInfo?.supports_preset && !isVoiceClone && !isVoiceDesign) ||
    (ttsBackend === "qwen" && qwenKind === "custom_voice");

  const presetVoices = useMemo(() => {
    if (ttsBackend === "qwen") return ttsMeta?.qwen_speakers ?? [];
    if (ttsBackend === "kokoro") return ttsMeta?.kokoro_voices ?? [];
    return [];
  }, [ttsBackend, ttsMeta]);

  const handleTtsBackendChange = (backend: TtsBackend) => {
    setTtsBackend(backend);
    const nextModel =
      backend === "qwen" && ttsMeta?.qwen_models[0] ? ttsMeta.qwen_models[0].repo_id : ttsModel;
    if (backend === "qwen" && ttsMeta?.qwen_models[0]) {
      setTtsModel(ttsMeta.qwen_models[0].repo_id);
    }
    setVoiceMode(defaultVoiceMode(backend, nextModel));
    if (backend === "kokoro") {
      setVoiceId("af_heart");
    } else if (backend === "qwen") {
      setVoiceId("Ryan");
    }
  };

  const handleTtsModelChange = (modelId: string) => {
    setTtsModel(modelId);
    const kind = qwenModelKind(modelId, ttsMeta?.qwen_models);
    if (kind === "voice_clone") {
      setVoiceMode("clone_video");
    } else if (kind === "custom_voice") {
      setVoiceMode("preset");
      setVoiceId("Ryan");
    }
  };

  const whisperModel =
    whisperPreset === CUSTOM_WHISPER ? whisperCustom.trim() : whisperPreset;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      sourceUrl: mode === "url" ? sourceUrl.trim() : undefined,
      file: mode === "file" ? file : null,
      jobMode,
      sourceLang,
      targetLang,
      asrEngine,
      asrModel,
      forcedAlignerModel,
      whisperModel: asrEngine === "whisper" ? whisperModel : "openai/whisper-large-v3",
      nemotronModel: asrEngine === "nemotron" ? nemotronModel : "nvidia/nemotron-3.5-asr-streaming-0.6b",
      translatorBackend,
      nllbModel,
      hunyuanModel,
      translateBatchSize,
      qcEnabled,
      lmstudioUrl,
      lmstudioModel,
      ttsBackend,
      ttsModel,
      voiceMode,
      voiceId,
      voiceDesignInstruct,
      voiceInstruct,
      refText,
      refAudioFile: voiceMode === "clone_upload" ? refAudioFile : null,
      voiceCloneXVectorOnly,
      higgsServerUrl,
      keepBackground,
    });
  };

  const hasSource = mode === "url" ? sourceUrl.trim().length > 0 : !!file;
  const whisperValid = asrEngine !== "whisper" || whisperModel.length > 0;
  const dubValid =
    jobMode === "subtitle" ||
    ((!isVoiceDesign || voiceDesignInstruct.trim().length > 0) &&
      (voiceMode !== "clone_upload" || !!refAudioFile) &&
      (!isVoiceClone ||
        voiceMode === "clone_video" ||
        voiceCloneXVectorOnly ||
        refText.trim().length > 0) &&
      (ttsBackend !== "omnivoice" && ttsBackend !== "higgs" ||
        voiceMode === "clone_video" ||
        voiceCloneXVectorOnly ||
        (voiceMode === "clone_upload" && refText.trim().length > 0)));
  const canSubmit = hasSource && whisperValid && dubValid;

  const nemotronInfo = asrEngine === "nemotron" ? nemotronByIso[sourceLang] : null;

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-white/10 bg-panel/60 p-6">
      <div className="flex gap-2">
        <TabButton active={jobMode === "subtitle"} onClick={() => setJobMode("subtitle")}>
          Subtitles
        </TabButton>
        <TabButton active={jobMode === "dub"} onClick={() => setJobMode("dub")}>
          Dubbing
        </TabButton>
      </div>

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

      {jobMode === "dub" && (
        <div className="space-y-4 rounded-xl border border-white/10 bg-ink/40 p-4">
          {isVoiceDesign && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              VoiceDesign can vary between lines. For more consistent dubbing, use CustomVoice or
              voice clone instead.
            </p>
          )}
          <div>
            <Label>TTS engine</Label>
            <select
              value={ttsBackend}
              onChange={(e) => handleTtsBackendChange(e.target.value as TtsBackend)}
              className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
            >
              {(Object.keys(TTS_BACKEND_LABELS) as TtsBackend[]).map((id) => (
                <option key={id} value={id}>
                  {TTS_BACKEND_LABELS[id]}
                </option>
              ))}
            </select>
          </div>

          {ttsBackend === "qwen" && ttsMeta && (
            <RepoSelect
              label="Qwen3-TTS model"
              value={ttsModel}
              onChange={handleTtsModelChange}
              options={ttsMeta.qwen_models}
            />
          )}

          {showCloneUi && !isVoiceClone && (
            <div>
              <Label>Voice source</Label>
              <div className="flex flex-wrap gap-2">
                <TabButton
                  active={voiceMode === "clone_video"}
                  onClick={() => setVoiceMode("clone_video")}
                >
                  Speaker from video
                </TabButton>
                <TabButton
                  active={voiceMode === "clone_upload"}
                  onClick={() => setVoiceMode("clone_upload")}
                >
                  Upload reference
                </TabButton>
                {backendInfo?.supports_preset && (
                  <TabButton active={voiceMode === "preset"} onClick={() => setVoiceMode("preset")}>
                    Preset / design
                  </TabButton>
                )}
              </div>
            </div>
          )}

          {isVoiceClone && (
            <div>
              <Label>Voice source</Label>
              <div className="flex flex-wrap gap-2">
                <TabButton
                  active={voiceMode === "clone_video"}
                  onClick={() => setVoiceMode("clone_video")}
                >
                  Speaker from video
                </TabButton>
                <TabButton
                  active={voiceMode === "clone_upload"}
                  onClick={() => setVoiceMode("clone_upload")}
                >
                  Upload reference
                </TabButton>
              </div>
            </div>
          )}

          {showPresetUi && presetVoices.length > 0 && voiceMode === "preset" && (
            <div>
              <Label>Preset voice</Label>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
              >
                {presetVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isVoiceDesign && (
            <div>
              <Label>Voice description (required)</Label>
              <textarea
                value={voiceDesignInstruct}
                onChange={(e) => setVoiceDesignInstruct(e.target.value)}
                rows={3}
                placeholder="Describe the target voice in natural language…"
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            </div>
          )}

          {ttsBackend === "qwen" && qwenKind === "custom_voice" && voiceMode === "preset" && (
            <div>
              <Label>Style instruct (optional)</Label>
              <input
                value={voiceInstruct}
                onChange={(e) => setVoiceInstruct(e.target.value)}
                placeholder="e.g. speak cheerfully"
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            </div>
          )}

          {ttsBackend === "voxcpm" && voiceMode === "preset" && (
            <div>
              <Label>Voice design description (optional)</Label>
              <input
                value={voiceDesignInstruct}
                onChange={(e) => setVoiceDesignInstruct(e.target.value)}
                placeholder="e.g. A young woman, gentle and sweet voice"
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            </div>
          )}

          {voiceMode === "clone_upload" && (
            <>
              <div>
                <Label>Reference audio</Label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setRefAudioFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-white"
                />
              </div>
              {!voiceCloneXVectorOnly && (
                <div>
                  <Label>Reference transcript</Label>
                  <textarea
                    value={refText}
                    onChange={(e) => setRefText(e.target.value)}
                    rows={2}
                    placeholder="Exact words spoken in the reference clip"
                    className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
                  />
                </div>
              )}
            </>
          )}

          {voiceMode === "clone_video" &&
            (isVoiceClone ||
              ttsBackend === "omnivoice" ||
              ttsBackend === "higgs" ||
              ttsBackend === "voxcpm") && (
              <div>
                <Label>Reference transcript override (optional)</Label>
                <textarea
                  value={refText}
                  onChange={(e) => setRefText(e.target.value)}
                  rows={2}
                  placeholder="Leave empty to auto-detect from ASR"
                  className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
                />
              </div>
            )}

          {isVoiceClone && (
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={voiceCloneXVectorOnly}
                onChange={(e) => setVoiceCloneXVectorOnly(e.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              <span className="text-sm">
                x_vector_only mode (no ref transcript; lower clone quality)
              </span>
            </label>
          )}

          {ttsBackend === "higgs" && (
            <div>
              <Label>Higgs TTS server URL</Label>
              <input
                value={higgsServerUrl}
                onChange={(e) => setHiggsServerUrl(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
              <p className="mt-1 text-xs text-white/45">
                Run SGLang-Omni or vLLM-Omni locally. Research/non-commercial license.
              </p>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={keepBackground}
              onChange={(e) => setKeepBackground(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            <span className="text-sm">Keep background music (Demucs separation)</span>
          </label>
        </div>
      )}

      <CollapsibleSection title="Advanced settings">
        <div>
          <Label>ASR engine</Label>
          <div className="flex flex-wrap gap-2">
            <TabButton active={asrEngine === "qwen"} onClick={() => setAsrEngine("qwen")}>
              Qwen3-ASR
            </TabButton>
            <TabButton active={asrEngine === "whisper"} onClick={() => setAsrEngine("whisper")}>
              Whisper
            </TabButton>
            <TabButton active={asrEngine === "nemotron"} onClick={() => setAsrEngine("nemotron")}>
              Nemotron 3.5
            </TabButton>
          </div>
        </div>

        {asrEngine === "qwen" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RepoSelect label="ASR model" value={asrModel} onChange={setAsrModel} options={asrModels} />
            <RepoSelect
              label="Forced aligner"
              value={forcedAlignerModel}
              onChange={setForcedAlignerModel}
              options={alignerModels}
            />
          </div>
        )}

        {asrEngine === "whisper" && (
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
                placeholder="e.g. openai/whisper-large-v3-turbo"
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            )}
          </div>
        )}

        {asrEngine === "nemotron" && (
          <div className="space-y-3">
            <RepoSelect
              label="Nemotron model"
              value={nemotronModel}
              onChange={setNemotronModel}
              options={nemotronModels}
            />
            {nemotronInfo?.tier === "adaptation" && (
              <p className="text-xs text-amber-300/80">
                This language is adaptation-ready in Nemotron — accuracy may be lower unless
                fine-tuned on in-domain data.
              </p>
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

        {translatorBackend === "nllb" && (
          <RepoSelect label="NLLB model" value={nllbModel} onChange={setNllbModel} options={nllbModels} />
        )}

        {translatorBackend === "hunyuan" && (
          <RepoSelect
            label="Hunyuan model"
            value={hunyuanModel}
            onChange={setHunyuanModel}
            options={hunyuanModels}
          />
        )}

        <div>
          <Label>Translation batch size</Label>
          <input
            type="number"
            min={1}
            max={128}
            value={translateBatchSize}
            onChange={(e) =>
              setTranslateBatchSize(Math.min(128, Math.max(1, Number(e.target.value) || 1)))
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
      </CollapsibleSection>

      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy
          ? "Processing..."
          : jobMode === "dub"
            ? "Generate dubbed video"
            : "Generate dual subtitles"}
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
        {Object.entries(options)
          .sort(([, a], [, b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
          .map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
      </select>
    </div>
  );
}
