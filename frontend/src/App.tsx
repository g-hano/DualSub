import { useCallback, useEffect, useRef, useState } from "react";
import {
  createJob,
  exportDownloadUrl,
  getCues,
  mediaUrl,
  requestExport,
  subscribeProgress,
} from "./api";
import JobForm from "./components/JobForm";
import ModelsModal from "./components/ModelsModal";
import Player from "./components/Player";
import type { Cue, CreateJobParams, ProgressEvent } from "./types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  downloading: "Fetching media",
  extracting: "Extracting audio",
  transcribing: "Transcribing (Qwen3-ASR)",
  segmenting: "Building cues",
  translating: "Translating (Helsinki)",
  quality_check: "Quality check (LM Studio)",
  building: "Writing subtitles",
  done: "Done",
  error: "Error",
};

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [subtitleLabels, setSubtitleLabels] = useState({
    source: "Spoken language",
    target: "Translation",
  });
  const unsubRef = useRef<(() => void) | null>(null);

  const busy =
    !!jobId && progress?.status !== "done" && progress?.status !== "error";

  const handleSubmit = useCallback(async (params: CreateJobParams) => {
    setError(null);
    setCues(null);
    setProgress(null);
    setExportReady(false);
    setSubtitleLabels({
      source: `Spoken (${params.sourceLang.toUpperCase()})`,
      target: `Translation (${params.targetLang.toUpperCase()})`,
    });
    try {
      const { job_id } = await createJob(params);
      setJobId(job_id);
      unsubRef.current?.();
      unsubRef.current = subscribeProgress(job_id, (e) => setProgress(e));
    } catch (err) {
      setError((err as Error).message);
    }
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

  const handleExport = async () => {
    if (!jobId) return;
    setExporting(true);
    setError(null);
    try {
      await requestExport(jobId);
      setExportReady(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Dual Subtitle Studio
          </h1>
          <p className="mt-2 text-white/60">
            Transcribe, translate, and watch with both languages and live word
            highlighting.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModelsOpen(true)}
          className="rounded-xl border border-white/15 bg-panel/80 px-4 py-2.5 text-sm font-medium text-white/90 shadow-lg backdrop-blur hover:border-brand/40 hover:bg-panel"
        >
          Downloaded models
        </button>
      </header>

      <ModelsModal open={modelsOpen} onClose={() => setModelsOpen(false)} />

      <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          <JobForm onSubmit={handleSubmit} busy={busy} />
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {progress && (
            <ProgressPanel progress={progress} />
          )}

          {cues && jobId ? (
            <>
              <Player
                src={mediaUrl(jobId)}
                cues={cues}
                sourceLabel={subtitleLabels.source}
                targetLabel={subtitleLabels.target}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="rounded-lg border border-white/15 bg-panel px-4 py-2 text-sm font-medium hover:bg-white/5 disabled:opacity-40"
                >
                  {exporting ? "Burning subtitles..." : "Export burned-in video"}
                </button>
                {exportReady && (
                  <a
                    href={exportDownloadUrl(jobId)}
                    className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
                  >
                    Download MP4
                  </a>
                )}
              </div>
            </>
          ) : (
            !progress && (
              <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-white/15 text-white/40">
                Submit a video to get started
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressPanel({ progress }: { progress: ProgressEvent }) {
  const pct = Math.round(progress.progress * 100);
  const isError = progress.status === "error";
  return (
    <div className="rounded-2xl border border-white/10 bg-panel/60 p-5">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">
          {STATUS_LABEL[progress.status] ?? progress.status}
        </span>
        <span className="text-white/50">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${
            isError ? "bg-red-500" : "bg-brand"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.message && (
        <p className="mt-2 text-xs text-white/50">{progress.message}</p>
      )}
    </div>
  );
}
