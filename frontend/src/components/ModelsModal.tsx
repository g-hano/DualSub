import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadModel,
  downloadRequiredModels,
  getHfAuth,
  getModels,
  setHfToken,
  subscribeModelProgress,
} from "../api";
import type { HfAuthStatus, ModelInfo, ModelProgressEvent } from "../types";
import Alert from "./ui/Alert";
import Accordion from "./ui/Accordion";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Input from "./ui/Input";
import { IconDatabase } from "./ui/Icons";
import {
  CATEGORY_ORDER,
  categoryLabel,
  groupModels,
  subgroupSummary,
} from "../utils/modelGroups";

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
  watchModelIds = [],
}: {
  open: boolean;
  onClose: () => void;
  watchModelIds?: string[];
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
    if (open && watchModelIds.length > 0) refresh();
  }, [open, watchModelIds, refresh]);

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

  useEffect(() => {
    if (!open) return;
    for (const m of models) {
      if (m.status === "downloading" && !unsubRef.current.has(m.id)) {
        watchDownload(m.id);
      }
    }
    for (const id of watchModelIds) {
      if (!unsubRef.current.has(id)) {
        watchDownload(id);
      }
    }
  }, [open, models, watchModelIds, watchDownload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const grouped = groupModels(models);

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
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
              <IconDatabase className="h-5 w-5" />
            </span>
            <div>
              <h2 id="models-modal-title" className="text-lg font-semibold text-zinc-100">
                Model Library
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                Download HuggingFace models before running jobs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="border-b border-border px-6 py-4">
          <HfTokenSection />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          {requiredMissing && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownloadRequired}
              disabled={anyDownloading}
            >
              Download required
            </Button>
          )}
        </div>

        {error && (
          <Alert variant="error" className="mx-6 mt-4">
            {error}
          </Alert>
        )}

        <div className="max-h-[min(60vh,520px)] overflow-y-auto px-6 py-4">
          {loading && models.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">Loading models…</p>
          ) : (
            <div className="space-y-2">
              {CATEGORY_ORDER.map((category) => {
                const subgroups = grouped[category];
                if (subgroups.length === 0) return null;
                const allInCategory = subgroups.flatMap((sg) => sg.models);
                return (
                  <Accordion
                    key={category}
                    title={categoryLabel(category)}
                    description={subgroupSummary(allInCategory)}
                    icon={<IconDatabase className="h-4 w-4" />}
                    defaultOpen={false}
                    variant="ghost"
                  >
                    <div className="space-y-2">
                      {subgroups.map((subgroup) => (
                        <Accordion
                          key={subgroup.id}
                          title={subgroup.label}
                          description={subgroupSummary(subgroup.models)}
                          defaultOpen={false}
                          variant="ghost"
                          nested
                          badge={
                            subgroup.models.some((m) => m.required && m.status !== "downloaded") ? (
                              <Badge variant="warning">Required</Badge>
                            ) : undefined
                          }
                        >
                          <ul className="space-y-2">
                            {subgroup.models.map((model) => (
                              <ModelRow
                                key={model.id}
                                model={model}
                                onDownload={() => handleDownload(model.id)}
                              />
                            ))}
                          </ul>
                        </Accordion>
                      ))}
                    </div>
                  </Accordion>
                );
              })}
            </div>
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
    <li className="rounded-xl border border-border bg-[var(--panel-bg)] p-4 transition hover:border-zinc-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-100">{model.label}</span>
            {model.required && <Badge variant="warning">Required</Badge>}
            <StatusBadge status={model.status} />
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600">{model.repo_id}</p>
          <p className="mt-1.5 text-sm text-zinc-400">{model.description}</p>
          <p className="mt-1 text-xs text-zinc-600">
            {formatBytes(model.size_on_disk)} on disk
          </p>
        </div>

        {!isDownloaded && !isDownloading && (
          <Button variant="outline" size="sm" onClick={onDownload} className="shrink-0">
            Download
          </Button>
        )}
      </div>

      {(isDownloading || isDownloaded) && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>{STATUS_LABEL[model.status] ?? model.status}</span>
            <span className="font-mono">{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isError ? "bg-red-500" : isDownloaded ? "bg-emerald-600" : "bg-indigo-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {model.message && (isDownloading || isError) && (
        <p className="mt-2 truncate text-xs text-zinc-500" title={model.message}>
          {model.message}
        </p>
      )}

      {isError && model.error && (
        <p className="mt-2 text-xs text-red-400 line-clamp-3" title={model.error}>
          {model.error.split("\n")[0]}
        </p>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
    not_downloaded: "default",
    downloaded: "success",
    downloading: "info",
    error: "error",
  };
  return (
    <Badge variant={variantMap[status] ?? "default"}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function HfTokenSection() {
  const [auth, setAuth] = useState<HfAuthStatus | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAuth(await getHfAuth());
    } catch {
      setAuth({ configured: false, username: null, source: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await setHfToken(tokenInput.trim() || null);
      setAuth(status);
      setTokenInput("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      setAuth(await setHfToken(null));
      setTokenInput("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusText = auth?.configured
    ? auth.source === "env"
      ? `Using token from environment${auth.username ? ` (${auth.username})` : ""}`
      : `Logged in as ${auth.username ?? "HF user"}`
    : "Not authenticated — public models only";

  return (
    <div className="rounded-xl border border-border bg-[var(--panel-bg)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-200">HuggingFace token</p>
        <span className="text-xs text-zinc-500">{statusText}</span>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Required for gated models.{" "}
        <a
          href="https://huggingface.co/settings/tokens"
          target="_blank"
          rel="noreferrer"
          className="text-indigo-400 hover:underline"
        >
          Get a token →
        </a>
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="hf_…"
          autoComplete="off"
          className="min-w-[200px] flex-1"
        />
        <Button variant="primary" onClick={save} disabled={busy || !tokenInput.trim()}>
          Save
        </Button>
        <Button variant="outline" onClick={clear} disabled={busy || !auth?.configured}>
          Clear
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
