import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteJob, listJobs } from "../api";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import { IconChevron, IconDub, IconSubtitles } from "./ui/Icons";
import type { JobListItem, JobStatus } from "../types";

const SIDEBAR_WIDTH = 240;
const STORAGE_KEY = "polyvoice-projects-sidebar-open";

function readSidebarOpen(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

function statusVariant(status: JobStatus): "success" | "error" | "warning" | "info" | "default" {
  if (status === "done") return "success";
  if (status === "error") return "error";
  if (status === "pending") return "default";
  return "info";
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ProjectSidebar({
  activeJobId,
  onSelectProject,
  onNewProject,
  refreshToken,
}: {
  activeJobId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  refreshToken?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(readSidebarOpen);
  const [projects, setProjects] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const projectStatusLabel = (status: JobStatus): string => {
    if (status === "done") return t("status.done");
    if (status === "error") return t("status.error");
    if (status === "pending") return t("status.pending");
    return t("projects.running");
  };

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    listJobs()
      .then(setProjects)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshToken]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm(t("projects.deleteConfirm"))) return;
    setDeletingId(id);
    try {
      await deleteJob(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeJobId === id) onNewProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="relative shrink-0">
      {!open && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label={t("projects.show")}
          title={t("projects.show")}
          className="flex w-full items-center gap-2 border-b border-border bg-[#070709] px-4 py-2.5 text-left text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200 xl:hidden"
        >
          <IconChevron className="h-4 w-4 rotate-90" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {t("projects.title")}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? t("projects.hide") : t("projects.show")}
        title={open ? t("projects.hide") : t("projects.show")}
        className="absolute top-6 z-30 hidden h-10 w-7 items-center justify-center rounded-r-lg border border-border bg-[var(--panel-bg)] text-zinc-400 shadow-md transition-all duration-300 ease-in-out hover:bg-zinc-800 hover:text-zinc-200 xl:flex"
        style={{ left: open ? SIDEBAR_WIDTH : 0 }}
      >
        <IconChevron
          className={`h-4 w-4 transition-transform duration-300 ${open ? "-rotate-90" : "rotate-90"}`}
        />
      </button>

      <aside
        className={`flex shrink-0 flex-col overflow-hidden bg-[#070709] transition-[width,max-height] duration-300 ease-in-out ${
          open
            ? "w-full border-b border-border sm:w-56 lg:max-h-[calc(100vh-3.5rem)] xl:w-60 xl:border-b-0 xl:border-r"
            : "w-0 max-h-0 border-0 xl:max-h-[calc(100vh-3.5rem)]"
        }`}
        style={{ width: open ? undefined : 0 }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ width: SIDEBAR_WIDTH }}
        >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {t("projects.title")}
          </h2>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={t("projects.hide")}
            title={t("projects.hide")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden"
          >
            <IconChevron className="h-4 w-4 -rotate-90" />
          </button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full justify-center"
          onClick={onNewProject}
        >
          {t("projects.newProject")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading && (
          <p className="px-2 py-3 text-center text-xs text-zinc-500">{t("projects.loading")}</p>
        )}
        {error && (
          <p className="px-2 py-2 text-xs text-red-400">{error}</p>
        )}
        {!loading && !error && projects.length === 0 && (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-zinc-600">
            {t("projects.empty")}
          </p>
        )}
        <ul className="space-y-1">
          {projects.map((project) => {
            const active = activeJobId === project.id;
            return (
              <li key={project.id}>
                <div
                  className={`group flex items-stretch rounded-lg transition ${
                    active
                      ? "bg-indigo-500/15 ring-1 ring-indigo-500/40"
                      : "hover:bg-zinc-800/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectProject(project.id)}
                    className="min-w-0 flex-1 px-3 py-2.5 text-left"
                  >
                    <span
                      className={`block truncate text-sm font-medium ${
                        active ? "text-indigo-100" : "text-zinc-200"
                      }`}
                      title={project.label}
                    >
                      {project.label}
                    </span>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant={statusVariant(project.status)}>
                        {projectStatusLabel(project.status)}
                      </Badge>
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
                        {project.mode === "dub" ? (
                          <IconDub className="h-3 w-3" />
                        ) : (
                          <IconSubtitles className="h-3 w-3" />
                        )}
                        {project.mode === "dub" ? t("projects.dub") : t("projects.subtitle")}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-zinc-600">
                      {formatDate(project.created_at)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, project.id)}
                    disabled={deletingId === project.id}
                    className="shrink-0 self-start rounded px-2 py-2 text-sm text-zinc-600 opacity-0 transition hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
                    title={t("projects.deleteTitle")}
                  >
                    {deletingId === project.id ? "…" : "×"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
        </div>
      </aside>
    </div>
  );
}
