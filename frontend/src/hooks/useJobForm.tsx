import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { getAsrModels, getLanguages, getTranslationModels, getTtsModels } from "../api";
import type {
  AsrEngine,
  AsrModelOption,
  JobFormSubmitParams,
  JobMode,
  LlmProvider,
  TtsBackend,
  TtsBackendInfo,
  TtsModelsResponse,
  VoiceMode,
} from "../types";

const CUSTOM_WHISPER = "__custom__";

export const TRANSLATION_BACKENDS = [
  { id: "hunyuan", label: "Hunyuan Hy-MT2 (recommended)" },
  { id: "helsinki", label: "Helsinki opus-mt (fast)" },
  { id: "nllb", label: "NLLB-200 (multilingual)" },
  { id: "translategemma", label: "TranslateGemma 4B" },
];

export const TTS_BACKEND_LABELS: Record<TtsBackend, string> = {
  qwen: "Qwen3-TTS",
  kokoro: "Kokoro",
  voxcpm: "VoxCPM2",
  omnivoice: "OmniVoice",
  higgs: "Higgs TTS (external server)",
};

export const LLM_PROVIDER_PRESETS = {
  lmstudio: {
    label: "LM Studio",
    url: "http://localhost:1234/v1",
    model: "local-model",
  },
  ollama: {
    label: "Ollama",
    url: "http://localhost:11434/v1",
    model: "llama3.2",
  },
  llamacpp: {
    label: "llama.cpp server",
    url: "http://localhost:8080/v1",
    model: "",
  },
} as const;

export const CUSTOM_WHISPER_VALUE = CUSTOM_WHISPER;

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

export type JobFormContextValue = ReturnType<typeof useJobFormState>;

const JobFormContext = createContext<JobFormContextValue | null>(null);

export function JobFormProvider({
  onSubmit,
  busy,
  children,
}: {
  onSubmit: (params: JobFormSubmitParams) => void;
  busy: boolean;
  children: ReactNode;
}) {
  const value = useJobFormState(onSubmit, busy);
  return <JobFormContext.Provider value={value}>{children}</JobFormContext.Provider>;
}

export function useJobForm(): JobFormContextValue {
  const ctx = useContext(JobFormContext);
  if (!ctx) throw new Error("useJobForm must be used within JobFormProvider");
  return ctx;
}

function useJobFormState(onSubmit: (params: JobFormSubmitParams) => void, busy: boolean) {
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
  const [translatorBackend, setTranslatorBackend] = useState("hunyuan");
  const [nllbModels, setNllbModels] = useState<AsrModelOption[]>([]);
  const [nllbModel, setNllbModel] = useState("facebook/nllb-200-distilled-600M");
  const [hunyuanModels, setHunyuanModels] = useState<AsrModelOption[]>([]);
  const [hunyuanModel, setHunyuanModel] = useState("tencent/Hy-MT2-1.8B");
  const [translateBatchSize, setTranslateBatchSize] = useState(16);
  const [qcEnabled, setQcEnabled] = useState(false);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("lmstudio");
  const [llmBaseUrl, setLlmBaseUrl] = useState<string>(LLM_PROVIDER_PRESETS.lmstudio.url);
  const [llmModel, setLlmModel] = useState<string>(LLM_PROVIDER_PRESETS.lmstudio.model);

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
  const [backgroundMixLevel, setBackgroundMixLevel] = useState(0.85);

  const handleLlmProviderChange = (provider: LlmProvider) => {
    setLlmProvider(provider);
    const preset = LLM_PROVIDER_PRESETS[provider];
    setLlmBaseUrl(preset.url);
    if (preset.model) setLlmModel(preset.model);
  };

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
      llmProvider,
      llmBaseUrl,
      llmModel,
      lmstudioUrl: llmBaseUrl,
      lmstudioModel: llmModel,
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
      backgroundMixLevel,
    });
  };

  const hasSource = mode === "url" ? sourceUrl.trim().length > 0 : !!file;
  const whisperValid = asrEngine !== "whisper" || whisperModel.length > 0;
  const uploadNeedsRefText = voiceMode === "clone_upload" && !voiceCloneXVectorOnly;
  const dubValid =
    jobMode === "subtitle" ||
    ((!isVoiceDesign || voiceDesignInstruct.trim().length > 0) &&
      (voiceMode !== "clone_upload" ||
        (!!refAudioFile && (!uploadNeedsRefText || refText.trim().length > 0))) &&
      (!isVoiceClone || voiceMode === "clone_video" || voiceCloneXVectorOnly));
  const canSubmit = hasSource && whisperValid && dubValid;

  const nemotronInfo = asrEngine === "nemotron" ? nemotronByIso[sourceLang] : null;

  const sortedLanguages = Object.entries(languages).sort(([, a], [, b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  return {
    busy,
    submit,
    canSubmit,
    jobMode,
    setJobMode,
    mode,
    setMode,
    sourceUrl,
    setSourceUrl,
    file,
    setFile,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    sortedLanguages,
    asrEngine,
    setAsrEngine,
    asrModels,
    asrModel,
    setAsrModel,
    alignerModels,
    forcedAlignerModel,
    setForcedAlignerModel,
    whisperModels,
    whisperPreset,
    setWhisperPreset,
    whisperCustom,
    setWhisperCustom,
    nemotronModels,
    nemotronModel,
    setNemotronModel,
    nemotronInfo,
    translatorBackend,
    setTranslatorBackend,
    nllbModels,
    nllbModel,
    setNllbModel,
    hunyuanModels,
    hunyuanModel,
    setHunyuanModel,
    translateBatchSize,
    setTranslateBatchSize,
    qcEnabled,
    setQcEnabled,
    llmProvider,
    setLlmProvider,
    handleLlmProviderChange,
    llmBaseUrl,
    setLlmBaseUrl,
    llmModel,
    setLlmModel,
    ttsMeta,
    ttsBackend,
    handleTtsBackendChange,
    ttsModel,
    handleTtsModelChange,
    voiceMode,
    setVoiceMode,
    voiceId,
    setVoiceId,
    voiceDesignInstruct,
    setVoiceDesignInstruct,
    voiceInstruct,
    setVoiceInstruct,
    refText,
    setRefText,
    refAudioFile,
    setRefAudioFile,
    voiceCloneXVectorOnly,
    setVoiceCloneXVectorOnly,
    higgsServerUrl,
    setHiggsServerUrl,
    keepBackground,
    setKeepBackground,
    backgroundMixLevel,
    setBackgroundMixLevel,
    backendInfo,
    isVoiceDesign,
    qwenKind,
    isVoiceClone,
    showCloneUi,
    showPresetUi,
    presetVoices,
  };
}
