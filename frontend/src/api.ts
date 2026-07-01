import type {
  AsrModelOption,
  Cue,
  CreateJobParams,
  HfAuthStatus,
  JobInfo,
  JobListItem,
  ModelInfo,
  ModelProgressEvent,
  ProgressEvent,
  SubtitleStyleSettings,
  TtsModelsResponse,
} from "./types";

const API = "/api";

async function readApiError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => item?.msg ?? JSON.stringify(item)).join("; ");
    }
    if (detail && typeof detail === "object") return JSON.stringify(detail);
    return body?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status}). The backend may be down or the dev proxy failed.`;
  }
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(
      "Could not reach the backend. Run: cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000"
    );
  }
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export interface EnsureJobModelsResult {
  started: string[];
  waiting: string[];
  ready: string[];
  pending: string[];
  repos: string[];
}

export async function ensureJobModels(
  params: CreateJobParams
): Promise<EnsureJobModelsResult> {
  const res = await apiFetch(`${API}/models/ensure-for-job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_lang: params.sourceLang,
      target_lang: params.targetLang,
      asr_engine: params.asrEngine,
      asr_model: params.asrModel,
      forced_aligner_model: params.forcedAlignerModel,
      whisper_model: params.whisperModel,
      nemotron_model: params.nemotronModel,
      nllb_model: params.nllbModel,
      hunyuan_model: params.hunyuanModel,
      translator_backend: params.translatorBackend,
      qc_enabled: params.qcEnabled,
      job_mode: params.jobMode,
      tts_backend: params.ttsBackend,
      tts_model: params.ttsModel,
    }),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export function waitForModelDownloads(modelIds: string[]): Promise<void> {
  if (modelIds.length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const pending = new Set(modelIds);
    const cleanups: (() => void)[] = [];
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanups.forEach((fn) => fn());
      if (err) reject(err);
      else resolve();
    };

    for (const id of modelIds) {
      const unsub = subscribeModelProgress(id, (event) => {
        if (!pending.has(event.model_id)) return;
        if (event.status === "downloaded") {
          pending.delete(event.model_id);
          if (pending.size === 0) finish();
        } else if (event.status === "error") {
          finish(
            new Error(event.error?.split("\n")[0] ?? `Download failed: ${event.model_id}`)
          );
        }
      });
      cleanups.push(unsub);
    }
  });
}

export async function createJob(params: CreateJobParams): Promise<{ job_id: string }> {
  const form = new FormData();
  if (params.sourceUrl) form.append("source_url", params.sourceUrl);
  if (params.file) form.append("file", params.file);
  form.append("source_lang", params.sourceLang);
  form.append("target_lang", params.targetLang);
  form.append("job_mode", params.jobMode);
  form.append("asr_engine", params.asrEngine);
  form.append("asr_model", params.asrModel);
  form.append("forced_aligner_model", params.forcedAlignerModel);
  form.append("whisper_model", params.whisperModel);
  form.append("nemotron_model", params.nemotronModel);
  form.append("translator_backend", params.translatorBackend);
  form.append("nllb_model", params.nllbModel);
  form.append("hunyuan_model", params.hunyuanModel);
  form.append("translate_batch_size", String(params.translateBatchSize));
  form.append("qc_enabled", params.qcEnabled ? "true" : "false");
  form.append("llm_provider", params.llmProvider);
  form.append("llm_base_url", params.llmBaseUrl);
  form.append("llm_model", params.llmModel);
  form.append("lmstudio_url", params.llmBaseUrl);
  form.append("lmstudio_model", params.llmModel);
  form.append("subtitle_style", JSON.stringify(params.subtitleStyle));
  form.append("tts_backend", params.ttsBackend);
  form.append("tts_model", params.ttsModel);
  form.append("voice_mode", params.voiceMode);
  form.append("voice_id", params.voiceId);
  form.append("voice_design_instruct", params.voiceDesignInstruct);
  form.append("voice_instruct", params.voiceInstruct);
  form.append("ref_text", params.refText);
  form.append("voice_clone_x_vector_only", params.voiceCloneXVectorOnly ? "true" : "false");
  form.append("higgs_server_url", params.higgsServerUrl);
  form.append("keep_background", params.keepBackground ? "true" : "false");
  form.append("background_mix_level", String(params.backgroundMixLevel));
  if (params.refAudioFile) form.append("ref_audio", params.refAudioFile);

  const res = await apiFetch(`${API}/jobs`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function listJobs(): Promise<JobListItem[]> {
  const res = await apiFetch(`${API}/jobs`);
  if (!res.ok) throw new Error("Failed to load projects");
  const data = await res.json();
  return data.jobs ?? [];
}

export async function getJob(jobId: string, includeCues = false): Promise<JobInfo> {
  const query = includeCues ? "?include_cues=true" : "";
  const res = await apiFetch(`${API}/jobs/${jobId}${query}`);
  if (!res.ok) throw new Error("Job not found");
  return res.json();
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await apiFetch(`${API}/jobs/${jobId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readApiError(res));
}

export async function getCues(jobId: string): Promise<Cue[]> {
  const res = await apiFetch(`${API}/jobs/${jobId}/cues`);
  if (!res.ok) throw new Error("Cues not available");
  return res.json();
}

export function mediaUrl(jobId: string): string {
  return `${API}/jobs/${jobId}/media`;
}

export async function getLanguages(): Promise<{
  languages: Record<string, string>;
  nemotron_by_iso?: Record<string, { locale: string; tier: string | null }>;
}> {
  const res = await apiFetch(`${API}/languages`);
  const data = await res.json();
  return data;
}

export async function getAsrModels(): Promise<{
  asr_models: AsrModelOption[];
  forced_aligner_models: AsrModelOption[];
  whisper_models: AsrModelOption[];
  nemotron_models: AsrModelOption[];
}> {
  const res = await apiFetch(`${API}/asr-models`);
  if (!res.ok) throw new Error("Failed to load ASR models");
  return res.json();
}

export async function getTranslationModels(): Promise<{
  nllb_models: AsrModelOption[];
  hunyuan_models: AsrModelOption[];
}> {
  const res = await apiFetch(`${API}/translation-models`);
  if (!res.ok) throw new Error("Failed to load translation models");
  return res.json();
}

export async function getTtsModels(): Promise<TtsModelsResponse> {
  const res = await apiFetch(`${API}/tts-models`);
  if (!res.ok) throw new Error("Failed to load TTS models");
  return res.json();
}

export async function getSubtitleFonts(): Promise<string[]> {
  const res = await apiFetch(`${API}/subtitle-fonts`);
  if (!res.ok) return ["Arial", "Verdana", "Georgia"];
  const data = await res.json();
  return data.fonts ?? ["Arial"];
}

export async function getHfAuth(): Promise<HfAuthStatus> {
  const res = await apiFetch(`${API}/models/hf-auth`);
  if (!res.ok) throw new Error("Failed to load HF auth status");
  return res.json();
}

export async function setHfToken(token: string | null): Promise<HfAuthStatus> {
  const res = await apiFetch(`${API}/models/hf-auth`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function requestExport(
  jobId: string,
  subtitleStyle?: SubtitleStyleSettings,
  includeSubtitles = false
): Promise<{ export_filename: string }> {
  const res = await apiFetch(`${API}/jobs/${jobId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(subtitleStyle ? { subtitle_style: subtitleStyle } : {}),
      include_subtitles: includeSubtitles,
    }),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export function exportDownloadUrl(jobId: string): string {
  return `${API}/jobs/${jobId}/export`;
}

export function subscribeProgress(
  jobId: string,
  onEvent: (e: ProgressEvent) => void
): () => void {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}${API}/jobs/${jobId}/progress`);
  ws.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      /* ignore malformed */
    }
  };
  return () => ws.close();
}

export async function getModels(): Promise<ModelInfo[]> {
  const res = await apiFetch(`${API}/models`);
  if (!res.ok) throw new Error("Failed to load models");
  const data = await res.json();
  return data.models;
}

export async function downloadModel(modelId: string): Promise<void> {
  const res = await apiFetch(`${API}/models/${modelId}/download`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? "Download failed to start");
  }
}

export async function downloadRequiredModels(): Promise<string[]> {
  const res = await apiFetch(`${API}/models/download-required`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to start required downloads");
  const data = await res.json();
  return data.started ?? [];
}

export function subscribeModelProgress(
  modelId: string,
  onEvent: (e: ModelProgressEvent) => void
): () => void {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${proto}://${window.location.host}${API}/models/${modelId}/download/progress`
  );
  ws.onmessage = (msg) => {
    try {
      const raw = JSON.parse(msg.data);
      onEvent({
        ...raw,
        model_id: raw.model_id ?? raw.id ?? modelId,
      });
    } catch {
      /* ignore malformed */
    }
  };
  return () => ws.close();
}
