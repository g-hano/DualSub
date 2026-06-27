import type { AsrModelOption, Cue, CreateJobParams, JobInfo, ModelInfo, ModelProgressEvent, ProgressEvent } from "./types";

const API = "/api";

export async function createJob(params: CreateJobParams): Promise<{ job_id: string }> {
  const form = new FormData();
  if (params.sourceUrl) form.append("source_url", params.sourceUrl);
  if (params.file) form.append("file", params.file);
  form.append("source_lang", params.sourceLang);
  form.append("target_lang", params.targetLang);
  form.append("asr_model", params.asrModel);
  form.append("forced_aligner_model", params.forcedAlignerModel);
  form.append("translator_backend", params.translatorBackend);
  form.append("qc_enabled", String(params.qcEnabled));
  form.append("lmstudio_url", params.lmstudioUrl);
  form.append("lmstudio_model", params.lmstudioModel);

  const res = await fetch(`${API}/jobs`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Failed to create job");
  return res.json();
}

export async function getJob(jobId: string): Promise<JobInfo> {
  const res = await fetch(`${API}/jobs/${jobId}`);
  if (!res.ok) throw new Error("Job not found");
  return res.json();
}

export async function getCues(jobId: string): Promise<Cue[]> {
  const res = await fetch(`${API}/jobs/${jobId}/cues`);
  if (!res.ok) throw new Error("Cues not available");
  return res.json();
}

export function mediaUrl(jobId: string): string {
  return `${API}/jobs/${jobId}/media`;
}

export async function getLanguages(): Promise<Record<string, string>> {
  const res = await fetch(`${API}/languages`);
  const data = await res.json();
  return data.languages;
}

export async function getAsrModels(): Promise<{
  asr_models: AsrModelOption[];
  forced_aligner_models: AsrModelOption[];
}> {
  const res = await fetch(`${API}/asr-models`);
  if (!res.ok) throw new Error("Failed to load ASR models");
  return res.json();
}

export async function requestExport(jobId: string): Promise<{ export_filename: string }> {
  const res = await fetch(`${API}/jobs/${jobId}/export`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Export failed");
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
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error("Failed to load models");
  const data = await res.json();
  return data.models;
}

export async function downloadModel(modelId: string): Promise<void> {
  const res = await fetch(`${API}/models/${modelId}/download`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? "Download failed to start");
  }
}

export async function downloadRequiredModels(): Promise<string[]> {
  const res = await fetch(`${API}/models/download-required`, { method: "POST" });
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
