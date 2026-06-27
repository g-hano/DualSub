import type { AsrModelOption, Cue, CreateJobParams, JobInfo, ModelInfo, ModelProgressEvent, ProgressEvent } from "./types";

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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      translator_backend: params.translatorBackend,
      qc_enabled: params.qcEnabled,
    }),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function waitForModelDownloads(modelIds: string[]): Promise<void> {
  if (modelIds.length === 0) return;
  const pending = new Set(modelIds);
  while (pending.size > 0) {
    const models = await getModels();
    for (const id of [...pending]) {
      const model = models.find((m) => m.id === id);
      if (!model) continue;
      if (model.status === "downloaded") pending.delete(id);
      if (model.status === "error") {
        throw new Error(model.error?.split("\n")[0] ?? `Download failed: ${model.label}`);
      }
    }
    if (pending.size > 0) await sleep(800);
  }
}

export async function createJob(params: CreateJobParams): Promise<{ job_id: string }> {
  const form = new FormData();
  if (params.sourceUrl) form.append("source_url", params.sourceUrl);
  if (params.file) form.append("file", params.file);
  form.append("source_lang", params.sourceLang);
  form.append("target_lang", params.targetLang);
  form.append("asr_engine", params.asrEngine);
  form.append("asr_model", params.asrModel);
  form.append("forced_aligner_model", params.forcedAlignerModel);
  form.append("whisper_model", params.whisperModel);
  form.append("translator_backend", params.translatorBackend);
  form.append("translate_batch_size", String(params.translateBatchSize));
  form.append("qc_enabled", params.qcEnabled ? "true" : "false");
  form.append("lmstudio_url", params.lmstudioUrl);
  form.append("lmstudio_model", params.lmstudioModel);

  const res = await apiFetch(`${API}/jobs`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function getJob(jobId: string): Promise<JobInfo> {
  const res = await apiFetch(`${API}/jobs/${jobId}`);
  if (!res.ok) throw new Error("Job not found");
  return res.json();
}

export async function getCues(jobId: string): Promise<Cue[]> {
  const res = await apiFetch(`${API}/jobs/${jobId}/cues`);
  if (!res.ok) throw new Error("Cues not available");
  return res.json();
}

export function mediaUrl(jobId: string): string {
  return `${API}/jobs/${jobId}/media`;
}

export async function getLanguages(): Promise<Record<string, string>> {
  const res = await apiFetch(`${API}/languages`);
  const data = await res.json();
  return data.languages;
}

export async function getAsrModels(): Promise<{
  asr_models: AsrModelOption[];
  forced_aligner_models: AsrModelOption[];
  whisper_models: AsrModelOption[];
}> {
  const res = await apiFetch(`${API}/asr-models`);
  if (!res.ok) throw new Error("Failed to load ASR models");
  return res.json();
}

export async function requestExport(jobId: string): Promise<{ export_filename: string }> {
  const res = await apiFetch(`${API}/jobs/${jobId}/export`, { method: "POST" });
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
      onEvent(JSON.parse(msg.data));
    } catch {
      /* ignore malformed */
    }
  };
  return () => ws.close();
}
