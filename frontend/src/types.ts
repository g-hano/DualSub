export interface Word {
  w: string;
  start: number;
  end: number;
}

export interface Line {
  text: string;
  words: Word[];
}

export interface Cue {
  id: number;
  start: number;
  end: number;
  source: Line;
  target: Line;
}

export type JobMode = "subtitle" | "dub";

export type JobStatus =
  | "pending"
  | "downloading"
  | "extracting"
  | "transcribing"
  | "segmenting"
  | "translating"
  | "quality_check"
  | "building"
  | "synthesizing"
  | "separating"
  | "mixing"
  | "done"
  | "error";

export interface ProgressEvent {
  job_id: string;
  status: JobStatus;
  progress: number;
  message: string;
}

export interface JobInfo {
  job_id: string;
  status: JobStatus;
  progress: number;
  message: string;
  error?: string | null;
  media_filename?: string | null;
  export_filename?: string | null;
  dub_filename?: string | null;
  config?: { job_mode?: JobMode };
}

export type AsrEngine = "qwen" | "whisper" | "nemotron";

export type TtsBackend = "kokoro" | "qwen" | "voxcpm" | "omnivoice" | "higgs";

export type VoiceMode = "clone_video" | "clone_upload" | "preset";

export interface TrackStyle {
  font_family: string;
  font_size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  karaoke_active_color: string;
  karaoke_done_color: string;
  background_opacity: number;
}

export interface SubtitleStyleSettings {
  source: TrackStyle;
  target: TrackStyle;
}

export type LlmProvider = "lmstudio" | "ollama" | "llamacpp";

export interface CreateJobParams {
  sourceUrl?: string;
  file?: File | null;
  jobMode: JobMode;
  sourceLang: string;
  targetLang: string;
  asrEngine: AsrEngine;
  asrModel: string;
  forcedAlignerModel: string;
  whisperModel: string;
  nemotronModel: string;
  translatorBackend: string;
  nllbModel: string;
  hunyuanModel: string;
  translateBatchSize: number;
  qcEnabled: boolean;
  llmProvider: LlmProvider;
  llmBaseUrl: string;
  llmModel: string;
  lmstudioUrl: string;
  lmstudioModel: string;
  subtitleStyle: SubtitleStyleSettings;
  ttsBackend: TtsBackend;
  ttsModel: string;
  voiceMode: VoiceMode;
  voiceId: string;
  voiceDesignInstruct: string;
  voiceInstruct: string;
  refText: string;
  refAudioFile?: File | null;
  voiceCloneXVectorOnly: boolean;
  higgsServerUrl: string;
  keepBackground: boolean;
  backgroundMixLevel: number;
}

/** Job form fields; subtitle style is configured separately below the player. */
export type JobFormSubmitParams = Omit<CreateJobParams, "subtitleStyle">;

export interface AsrModelOption {
  repo_id: string;
  label: string;
}

export interface TtsVoiceOption {
  id: string;
  label: string;
}

export interface TtsModelOption {
  repo_id: string;
  label: string;
  kind?: string;
}

export interface TtsBackendInfo {
  id: TtsBackend;
  label: string;
  supports_clone: boolean;
  supports_preset: boolean;
  requires_ref_text: boolean;
  requires_voice_design: boolean;
}

export interface TtsModelsResponse {
  tokenizer: string;
  qwen_models: TtsModelOption[];
  qwen_speakers: TtsVoiceOption[];
  kokoro_voices: TtsVoiceOption[];
  backends: TtsBackendInfo[];
}

export interface NemotronLocaleOption {
  locale: string;
  label: string;
  tier: "ready" | "broad" | "adaptation";
}

export interface NemotronLangInfo {
  locale: string;
  tier: string | null;
}

export type ModelDownloadStatus =
  | "not_downloaded"
  | "downloaded"
  | "downloading"
  | "error";

export interface ModelInfo {
  id: string;
  repo_id: string;
  label: string;
  category: "asr" | "translation" | "tts";
  description: string;
  required: boolean;
  status: ModelDownloadStatus;
  progress: number;
  message: string;
  error?: string | null;
  size_on_disk: number;
}

export interface ModelProgressEvent {
  model_id: string;
  repo_id: string;
  status: ModelDownloadStatus;
  progress: number;
  message: string;
  error?: string | null;
  size_on_disk: number;
}

export interface HfAuthStatus {
  configured: boolean;
  username?: string | null;
  source?: "env" | "runtime" | null;
}
