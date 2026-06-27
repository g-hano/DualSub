import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadModel,
  downloadRequiredModels,
  getModels,
  subscribeModelProgress,
} from "../api";
import type { ModelInfo, ModelProgressEvent } from "../types";

const CATEGORY_LABEL: Record<string, string> = {
  asr: "Speech recognition",
  translation: "Translation",
};

const STATUS_LABEL: Record<string, string> = {
  not_downloaded: "Not downloaded",
  downloaded: "Downloaded",
  downloading: "Downloading…",
  error: "Error",
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function ModelsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<Map<string, () => void>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getModels();
      setModels(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      unsubRef.current.forEach((unsub) => unsub());
      unsubRef.current.clear();
    }
  }, [open]);

  useEffect(() => () => {
    unsubRef.current.forEach((unsub) => unsub());
  }, []);

  const applyProgress = useCallback((event: ModelProgressEvent) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === event.model_id
          ? {
              ...m,
              status: event.status,
              progress: event.progress,
              message: event.message,
              error: event.error,
              size_on_disk: event.size_on_disk,
            }
          : m
      )
    );
  }, []);

  const watchDownload = useCallback(
    (modelId: string) => {
      unsubRef.current.get(modelId)?.();
      const unsub = subscribeModelProgress(modelId, applyProgress);
      unsubRef.current.set(modelId, unsub);
    },
    [applyProgress]
  );

  const handleDownload = async (modelId: string) => {
    setError(null);
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? { ...m, status: "downloading", progress: 0, message: "Starting…", error: null }
          : m
      )
    );
    watchDownload(modelId);
    try {
      await downloadModel(modelId);
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    }
  };

  const handleDownloadRequired = async () => {
    setError(null);
    try {
      const started = await downloadRequiredModels();
      for (const id of started) {
        watchDownload(id);
      }
      if (started.length === 0) await refresh();
      else {
        setModels((prev) =>
          prev.map((m) =>
            started.includes(m.id)
              ? { ...m, status: "downloading", progress: 0, message: "Starting…" }
              : m
          )
        );
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Re-subscribe to any in-progress downloads when modal opens
  useEffect(() => {
    if (!open) return;
    for (const m of models) {
      if (m.status === "downloading" && !unsubRef.current.has(m.id)) {
        watchDownload(m.id);
      }
    }
  }, [open, models, watchDownload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const grouped = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});

  const requiredMissing = models.some((m) => m.required && m.status !== "downloaded");
  const anyDownloading = models.some((m) => m.status === "downloading");

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="models-modal-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <h2 id="models-modal-title" className="text-xl font-bold">
              Downloaded models
            </h2>
            <p className="mt-1 text-sm text-white/50">
              Download Hugging Face models before running jobs. Progress updates live.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-3">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-40"
          >
            {loading ? "Refreshing…" : "Refresh status"}
          </button>
          {requiredMissing && (
            <button
              type="button"
              onClick={handleDownloadRequired}
              disabled={anyDownloading}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
            >
              Download required models
            </button>
          )}
        </div>

        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="max-h-[min(60vh,520px)] overflow-y-auto px-6 py-4">
          {loading && models.length === 0 ? (
            <p className="py-8 text-center text-white/40">Loading models…</p>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <section key={category} className="mb-6 last:mb-0">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
                  {CATEGORY_LABEL[category] ?? category}
                </h3>
                <ul className="space-y-3">
                  {items.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      onDownload={() => handleDownload(model.id)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  onDownload,
}: {
  model: ModelInfo;
  onDownload: () => void;
}) {
  const pct = Math.round(model.progress * 100);
  const isDownloaded = model.status === "downloaded";
  const isDownloading = model.status === "downloading";
  const isError = model.status === "error";

  return (
    <li className="rounded-xl border border-white/10 bg-ink/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">{model.label}</span>
            {model.required && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                Required
              </span>
            )}
            <StatusBadge status={model.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-white/40">{model.repo_id}</p>
          <p className="mt-1 text-sm text-white/55">{model.description}</p>
          <p className="mt-1 text-xs text-white/35">
            Cache size: {formatBytes(model.size_on_disk)}
          </p>
        </div>

        {!isDownloaded && !isDownloading && (
          <button
            type="button"
            onClick={onDownload}
            className="shrink-0 rounded-lg border border-brand/50 bg-brand/15 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/25"
          >
            Download
          </button>
        )}
      </div>

      {(isDownloading || isDownloaded) && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-white/45">
            <span>{STATUS_LABEL[model.status] ?? model.status}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isError ? "bg-red-500" : isDownloaded ? "bg-emerald-500" : "bg-brand"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {model.message && (isDownloading || isError) && (
        <p className="mt-2 truncate text-xs text-white/40" title={model.message}>
          {model.message}
        </p>
      )}

      {isError && model.error && (
        <p className="mt-2 text-xs text-red-300/80 line-clamp-3" title={model.error}>
          {model.error.split("\n")[0]}
        </p>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    not_downloaded: "bg-white/10 text-white/50",
    downloaded: "bg-emerald-500/20 text-emerald-300",
    downloading: "bg-brand/20 text-brand",
    error: "bg-red-500/20 text-red-300",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        styles[status] ?? styles.not_downloaded
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
