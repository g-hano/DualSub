import type { CreateJobParams, JobConfig, JobInfo, SubtitleStyleSettings } from "../types";
import { DEFAULT_SUBTITLE_STYLE } from "../hooks/useSubtitleStyleSettings";

export function parseSubtitleStyle(
  raw: SubtitleStyleSettings | undefined
): SubtitleStyleSettings {
  if (!raw?.source || !raw?.target) return DEFAULT_SUBTITLE_STYLE;
  return {
    source: { ...DEFAULT_SUBTITLE_STYLE.source, ...raw.source },
    target: { ...DEFAULT_SUBTITLE_STYLE.target, ...raw.target },
  };
}

export function jobConfigToCreateJobParams(
  config: JobConfig | undefined,
  job: JobInfo
): CreateJobParams {
  const c = config ?? {};
  const llmBase = c.llm_base_url ?? c.lmstudio_url ?? "http://localhost:1234/v1";
  const llmModel = c.llm_model ?? c.lmstudio_model ?? "local-model";
  return {
    sourceUrl: job.source_url ?? undefined,
    file: null,
    jobMode: c.job_mode ?? "subtitle",
    sourceLang: c.source_lang ?? "sv",
    targetLang: c.target_lang ?? "en",
    asrEngine: c.asr_engine ?? "qwen",
    asrModel: c.asr_model ?? "Qwen/Qwen3-ASR-1.7B",
    forcedAlignerModel: c.forced_aligner_model ?? "Qwen/Qwen3-ForcedAligner-0.6B",
    whisperModel: c.whisper_model ?? "openai/whisper-large-v3",
    nemotronModel: c.nemotron_model ?? "nvidia/nemotron-3.5-asr-streaming-0.6b",
    translatorBackend: c.translator_backend ?? "hunyuan",
    nllbModel: c.nllb_model ?? "facebook/nllb-200-distilled-600M",
    hunyuanModel: c.hunyuan_model ?? "tencent/Hy-MT2-1.8B",
    translateBatchSize: c.translate_batch_size ?? 16,
    qcEnabled: c.qc_enabled ?? false,
    llmProvider: c.llm_provider ?? "lmstudio",
    llmBaseUrl: llmBase,
    llmModel,
    lmstudioUrl: llmBase,
    lmstudioModel: llmModel,
    subtitleStyle: parseSubtitleStyle(c.subtitle_style),
    ttsBackend: c.tts_backend ?? "qwen",
    ttsModel: c.tts_model ?? "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    voiceMode: c.voice_mode ?? "preset",
    voiceId: c.voice_id ?? "Ryan",
    voiceDesignInstruct: c.voice_design_instruct ?? "",
    voiceInstruct: c.voice_instruct ?? "",
    refText: c.ref_text ?? "",
    refAudioFile: null,
    voiceCloneXVectorOnly: c.voice_clone_x_vector_only ?? false,
    higgsServerUrl: c.higgs_server_url ?? "http://localhost:8000",
    keepBackground: c.keep_background ?? true,
    backgroundMixLevel: c.background_mix_level ?? 0.85,
  };
}
