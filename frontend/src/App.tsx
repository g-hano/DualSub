import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkBackendHealth,
  createJob,
  ensureJobModels,
  exportDownloadUrl,
  getCues,
  getLanguages,
  getSubtitleFonts,
  mediaUrl,
  requestExport,
  subscribeProgress,
  waitForModelDownloads,
} from "./api";
import { useSubtitleStyleSettings } from "./hooks/useSubtitleStyleSettings";
import { JobFormProvider } from "./hooks/useJobForm";
import JobForm from "./components/JobForm";
import { AdvancedSettingsToolbar } from "./components/AdvancedSettingsPanel";
import ModelsModal from "./components/ModelsModal";
import Player from "./components/Player";
import Accordion from "./components/ui/Accordion";
import SlidePanel from "./components/ui/SlidePanel";
import SubtitleSettingsPanel from "./components/SubtitleSettingsPanel";
import Button from "./components/ui/Button";
import Alert from "./components/ui/Alert";
import WorkflowStepper, { type Step } from "./components/ui/WorkflowStepper";
import { IconDatabase, IconDownload, IconPlay, IconSettings } from "./components/ui/Icons";
import type { Cue, CreateJobParams, JobFormSubmitParams, ProgressEvent } from "./types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  downloading: "Fetching Media",
  extracting: "Extracting Audio",
  transcribing: "Transcribing",
  segmenting: "Building Cues",
  translating: "Translating",
  quality_check: "Quality Check",
  building: "Writing Subtitles",
  synthesizing: "Synthesizing Speech",
  separating: "Separating Background",
  mixing: "Mixing Dubbed Audio",
  done: "Done",
  error: "Error",
};

function pipelineSteps(params: CreateJobParams | null): string[] {
  const steps = ["pending", "downloading"];
  if (params?.jobMode === "dub" && params.keepBackground) {
    steps.push("separating");
  }
  steps.push("transcribing", "segmenting", "translating");
  if (params?.qcEnabled) steps.push("quality_check");
  steps.push("building");
  if (params?.jobMode === "dub") {
    steps.push("synthesizing", "mixing");
  }
  steps.push("done");
  return steps;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function interpolateColor(from: string, to: string, t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  const r = Math.round(r1 + (r2 - r1) * clamped);
  const g = Math.round(g1 + (g2 - g1) * clamped);
  const b = Math.round(b1 + (b2 - b1) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

const PROGRESS_INDIGO = "#6366f1";
const PROGRESS_EMERALD = "#10b981";

function progressGreenness(
  stepIdx: number,
  workStepCount: number,
  status: string,
  pct: number
): number {
  if (status === "done") return 1;
  if (stepIdx < 0 || workStepCount <= 0) return 0;
  const stepBase = stepIdx / workStepCount;
  const stepBoost = pct / 100 / workStepCount;
  return Math.min(stepBase + stepBoost, 0.99);
}

function progressBarFill(
  stepIdx: number,
  workStepCount: number,
  isError: boolean,
  status: string,
  pct: number
): string {
  if (isError) return "#ef4444";
  const t = progressGreenness(stepIdx, workStepCount, status, pct);
  if (status === "done") return PROGRESS_EMERALD;
  return interpolateColor(PROGRESS_INDIGO, PROGRESS_EMERALD, t);
}

function progressPillColor(
  i: number,
  stepIdx: number,
  workStepCount: number,
  isError: boolean,
  status: string,
  pct: number
): string {
  if (isError) return "bg-zinc-800/60 text-zinc-600";
  if (i < stepIdx) return "bg-emerald-500/20 text-emerald-300";
  if (i === stepIdx) {
    const t = progressGreenness(stepIdx, workStepCount, status, pct);
    if (t >= 0.55) return "bg-emerald-500/30 text-emerald-200 ring-1 ring-emerald-500/40";
    if (t >= 0.3) return "bg-teal-500/30 text-teal-200 ring-1 ring-teal-500/40";
    return "bg-indigo-500/30 text-indigo-200 ring-1 ring-indigo-500/40";
  }
  return "bg-zinc-800/60 text-zinc-600";
}

function translatorModelName(params: CreateJobParams, jobRepos: string[] = []): string {
  switch (params.translatorBackend) {
    case "nllb":
      return params.nllbModel;
    case "hunyuan":
      return params.hunyuanModel;
    case "translategemma":
      return "google/translategemma-4b-it";
    case "helsinki": {
      const repo = jobRepos.find((r) => r.startsWith("Helsinki-NLP/"));
      return repo ?? `Helsinki ${params.sourceLang}→${params.targetLang}`;
    }
    default:
      return params.translatorBackend;
  }
}

function statusLabel(
  status: string,
  params: CreateJobParams | null,
  jobRepos: string[] = []
): string {
  if (status === "transcribing" && params) {
    const model =
      params.asrEngine === "whisper"
        ? params.whisperModel
        : params.asrEngine === "nemotron"
          ? params.nemotronModel
          : params.asrModel;
    return `Transcribing (${model})`;
  }
  if (status === "translating" && params) {
    return `Translating (${translatorModelName(params, jobRepos)})`;
  }
  if (status === "synthesizing" && params?.jobMode === "dub") {
    return `Synthesizing (${params.ttsModel})`;
  }
  return STATUS_LABEL[status] ?? status;
}

function workflowStep(
  progress: ProgressEvent | null,
  cues: Cue[] | null,
  exportReady: boolean
): Step {
  if (exportReady) return "export";
  if (cues) return "preview";
  if (progress && progress.status !== "error") return "processing";
  return "configure";
}

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobParams, setJobParams] = useState<CreateJobParams | null>(null);
  const [jobRepos, setJobRepos] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(true);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelsWatchIds, setModelsWatchIds] = useState<string[]>([]);
  const [modelPrepMessage, setModelPrepMessage] = useState<string | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [languages, setLanguages] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<string[]>(["Arial", "Verdana", "Georgia"]);
  const unsubRef = useRef<(() => void) | null>(null);
  const {
    settings: styleSettings,
    updateSource,
    updateTarget,
    reset: resetStyle,
  } = useSubtitleStyleSettings();

  const busy =
    !!modelPrepMessage ||
    (!!jobId && progress?.status !== "done" && progress?.status !== "error");

  const handleSubmit = useCallback(
    async (params: JobFormSubmitParams) => {
      setError(null);
      setCues(null);
      setProgress(null);
      setExportReady(false);
      setJobRepos([]);
      const fullParams: CreateJobParams = { ...params, subtitleStyle: styleSettings };
      setJobParams(fullParams);
      try {
        const ensure = await ensureJobModels(fullParams);
        setJobRepos(ensure.repos ?? []);
        if (ensure.pending.length > 0) {
          setModelsWatchIds(ensure.pending);
          setModelsOpen(true);
          setModelPrepMessage(
            ensure.started.length > 0
              ? `Downloading ${ensure.pending.length} required model(s)…`
              : `Waiting for ${ensure.pending.length} model download(s)…`
          );
          await waitForModelDownloads(ensure.pending);
          setModelPrepMessage(null);
        }

        const { job_id } = await createJob(fullParams);
        setJobId(job_id);
        unsubRef.current?.();
        unsubRef.current = subscribeProgress(job_id, (e) => setProgress(e));
      } catch (err) {
        setModelPrepMessage(null);
        setError((err as Error).message);
      }
    },
    [styleSettings]
  );

  useEffect(() => {
    checkBackendHealth().then(setBackendOk);
    getLanguages()
      .then((data) => setLanguages(data.languages))
      .catch(() => undefined);
    getSubtitleFonts().then(setFonts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (progress?.status === "done" && jobId) {
      getCues(jobId).then(setCues).catch((e) => setError(e.message));
    }
    if (progress?.status === "error") {
      setError(progress.message || "Pipeline failed");
    }
  }, [progress?.status, jobId]);

  useEffect(() => () => unsubRef.current?.(), []);

  useEffect(() => {
    if (exportReady) setExportReady(false);
  }, [styleSettings]);

  const handleExport = async () => {
    if (!jobId) return;
    setExporting(true);
    setError(null);
    try {
      await requestExport(jobId, styleSettings, false);
      setExportReady(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const isDubJob = jobParams?.jobMode === "dub";
  const currentStep = workflowStep(progress, cues, exportReady);

  const sourceLabel =
    (jobParams && languages[jobParams.sourceLang]) || jobParams?.sourceLang || "Source";
  const targetLabel =
    (jobParams && languages[jobParams.targetLang]) || jobParams?.targetLang || "Translation";

  return (
    <JobFormProvider onSubmit={handleSubmit} busy={busy}>
    <div className="app-shell flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-[#09090b]/90 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20">
              <IconPlay className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none text-zinc-100">PolyVoice</h1>
              <p className="mt-0.5 hidden text-[11px] text-zinc-500 sm:block">
                Local AI Pipeline for Transcription, Translation, Subtitles and Dubbing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {backendOk !== null && (
              <span
                className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                  backendOk
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-amber-500/10 text-amber-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${backendOk ? "bg-emerald-400" : "bg-amber-400 animate-pulse-ring"}`}
                />
                {backendOk ? "Backend Online" : "Backend Offline"}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              icon={<IconDatabase />}
              onClick={() => setModelsOpen(true)}
            >
              Models
            </Button>
          </div>
        </div>
      </header>

      <ModelsModal
        open={modelsOpen}
        watchModelIds={modelsWatchIds}
        onClose={() => setModelsOpen(false)}
      />

      {backendOk === false && (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2.5 lg:px-6">
          <Alert variant="warning" className="border-0 bg-transparent p-0">
            Backend not reachable — start with{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs">
              cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
            </code>
          </Alert>
        </div>
      )}

      {/* Main split layout: left form | center workspace | right advanced */}
      <div className="flex flex-1 flex-col xl:flex-row">
        {/* Left config panel */}
        <aside className="flex w-full shrink-0 flex-col border-b border-border bg-[var(--panel-bg)] lg:max-h-[calc(100vh-3.5rem)] xl:w-[380px] xl:border-b-0 xl:border-r 2xl:w-[400px]">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border px-5 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                New project
              </h2>
              <p className="mt-1 text-sm text-zinc-400">Configure your transcription job</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <JobForm />
              <div className="mt-4 space-y-3">
                {modelPrepMessage && <Alert variant="info">{modelPrepMessage}</Alert>}
                {error && <Alert variant="error">{error}</Alert>}
              </div>
            </div>
          </div>
        </aside>

        {/* Workspace + optional appearance panel */}
        <div className="flex min-h-[50vh] min-w-0 flex-1 flex-col lg:min-h-0 lg:max-h-[calc(100vh-3.5rem)] xl:flex-row">
          <div className="app-grid-bg flex min-w-0 flex-1 flex-col">
            <div className="relative shrink-0 border-b border-border bg-[var(--panel-bg)]/80 px-5 py-4 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <WorkflowStepper current={currentStep} className="min-w-0 flex-1" />
                {!cues && <AdvancedSettingsToolbar />}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
            {progress && progress.status !== "done" && progress.status !== "error" && (
              <ProgressPanel progress={progress} params={jobParams} jobRepos={jobRepos} />
            )}

            {progress?.status === "error" && (
              <Alert variant="error" className="mb-5">
                {progress.message || "Pipeline failed"}
              </Alert>
            )}

            {progress?.status === "done" && !cues && (
              <div className="flex flex-1 items-center justify-center py-20">
                <div className="text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                  <p className="text-sm text-zinc-400">Loading preview…</p>
                </div>
              </div>
            )}

            {cues && jobId ? (
              <div className="flex flex-1 flex-col gap-5">
                <Player
                  src={mediaUrl(jobId)}
                  cues={cues}
                  style={styleSettings}
                  showSubtitles={!isDubJob}
                />

                {!isDubJob && (
                  <div className="xl:hidden">
                    <Accordion
                      title="Subtitle appearance"
                      description="Font, colors, and karaoke styling for preview and export"
                      icon={<IconSettings className="h-4 w-4" />}
                      defaultOpen={false}
                    >
                      <SubtitleSettingsPanel
                        settings={styleSettings}
                        fonts={fonts}
                        onSourceChange={updateSource}
                        onTargetChange={updateTarget}
                        onReset={resetStyle}
                        sourceLabel={sourceLabel}
                        targetLabel={targetLabel}
                        embedded
                      />
                    </Accordion>
                  </div>
                )}

                {/* Export toolbar */}
                <div className="mt-auto rounded-xl border border-border bg-[var(--panel-bg)] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Export
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      icon={<IconDownload />}
                      onClick={handleExport}
                      disabled={exporting}
                    >
                      {exporting
                        ? isDubJob
                          ? "Preparing…"
                          : "Burning…"
                        : isDubJob
                          ? "Dubbed Video"
                          : "Burned-in Video"}
                    </Button>
                    {exportReady && (
                      <a
                        href={exportDownloadUrl(jobId)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-500"
                      >
                        <IconDownload className="h-4 w-4" />
                        Download MP4
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              !progress && <EmptyWorkspace />
            )}
            </div>
          </div>

          {cues && !isDubJob && (
            <SlidePanel
              open={appearanceOpen}
              onToggle={() => setAppearanceOpen((v) => !v)}
              title="Appearance"
              description="Subtitle styling for preview & export"
              width={340}
            >
              <SubtitleSettingsPanel
                settings={styleSettings}
                fonts={fonts}
                onSourceChange={updateSource}
                onTargetChange={updateTarget}
                onReset={resetStyle}
                sourceLabel={sourceLabel}
                targetLabel={targetLabel}
                embedded
              />
            </SlidePanel>
          )}
        </div>
      </div>
    </div>
    </JobFormProvider>
  );
}

function EmptyWorkspace() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <div className="relative mb-6">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-[var(--panel-bg)]">
          <IconPlay className="h-9 w-9 text-zinc-600" />
        </div>
        <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[var(--app-bg)] bg-indigo-500" />
      </div>
      <h2 className="text-lg font-semibold text-zinc-200">Your workspace is empty</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
        Configure a job on the left, adjust advanced options on the right, then hit generate.
      </p>
      <div className="mt-8 grid max-w-md grid-cols-3 gap-4 text-left">
        {[
          { n: "1", t: "Add Source", d: "URL or file upload" },
          { n: "2", t: "Pick Languages", d: "Source and Target" },
          { n: "3", t: "Generate", d: "Watch Live Preview" },
        ].map((item) => (
          <div key={item.n} className="rounded-lg border border-border bg-[var(--panel-bg)] p-3">
            <span className="text-xs font-bold text-indigo-400">{item.n}</span>
            <p className="mt-1 text-xs font-medium text-zinc-300">{item.t}</p>
            <p className="mt-0.5 text-[11px] text-zinc-600">{item.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressPanel({
  progress,
  params,
  jobRepos,
}: {
  progress: ProgressEvent;
  params: CreateJobParams | null;
  jobRepos: string[];
}) {
  const pct = Math.round(progress.progress * 100);
  const isError = progress.status === "error";
  const steps = pipelineSteps(params);
  const stepIdx = steps.indexOf(progress.status);
  const workStepCount = steps.filter((s) => s !== "done").length;
  const greenness = progressGreenness(stepIdx, workStepCount, progress.status, pct);
  const barFill = progressBarFill(stepIdx, workStepCount, isError, progress.status, pct);

  return (
    <div className="mb-5 rounded-xl border border-border bg-[var(--panel-bg)] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: isError ? "#f87171" : interpolateColor(PROGRESS_INDIGO, PROGRESS_EMERALD, greenness) }}
          >
            Processing
          </p>
          <p className="mt-1 text-base font-medium text-zinc-100">
            {statusLabel(progress.status, params, jobRepos)}
          </p>
        </div>
        <span
          className={`rounded-lg px-2.5 py-1 font-mono text-sm ${isError ? "bg-zinc-800 text-zinc-300" : ""}`}
          style={
            isError
              ? undefined
              : {
                  backgroundColor: `color-mix(in srgb, ${barFill} 15%, transparent)`,
                  color: barFill,
                }
          }
        >
          {pct}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="relative h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barFill }}
        >
          {!isError && (
            <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          )}
        </div>
      </div>

      {stepIdx >= 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {steps.filter((s) => s !== "done" && s !== "error").map((s, i) => (
            <span
              key={s}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${progressPillColor(i, stepIdx, workStepCount, isError, progress.status, pct)}`}
            >
              {STATUS_LABEL[s] ?? s}
            </span>
          ))}
        </div>
      )}

      {progress.message && (
        <p className="mt-3 text-xs text-zinc-500">{progress.message}</p>
      )}
    </div>
  );
}
