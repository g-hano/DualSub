import { useCallback, useEffect, useState } from "react";
import type { SubtitleStyleSettings, TrackStyle } from "../types";

export type { SubtitleStyleSettings, TrackStyle };

const STORAGE_PREFIX = "subtitle-style-settings-v2";
const LEGACY_GLOBAL_KEY = "subtitle-style-settings-v2";
const LEGACY_STORAGE_KEYS = ["subtitle-style-settings", "subtitle-font-settings"] as const;

/** Previous factory defaults — still present in many browsers' localStorage. */
const LEGACY_DEFAULT_FONT_SIZE = 20;
const LEGACY_DEFAULT_BACKGROUND = 0.55;

export const DEFAULT_TRACK: TrackStyle = {
  font_family: "Arial",
  font_size: 14,
  color: "#FFFFFF",
  bold: true,
  italic: false,
  karaoke_active_color: "#FFD24A",
  karaoke_done_color: "#B9C6FF",
  background_opacity: 0.25,
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  source: { ...DEFAULT_TRACK, background_opacity: 0.25 },
  target: {
    ...DEFAULT_TRACK,
    color: "#A7F3D0",
    bold: false,
    italic: true,
    background_opacity: 0.25,
  },
};

function storageKey(jobId: string | null): string {
  return jobId ? `${STORAGE_PREFIX}-${jobId}` : `${STORAGE_PREFIX}-draft`;
}

function clampSize(n: number): number {
  return Math.min(48, Math.max(12, Math.round(n)));
}

function clampOpacity(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function isLegacyDefaultSize(size: number | undefined): boolean {
  return size === LEGACY_DEFAULT_FONT_SIZE;
}

function isLegacyDefaultBackground(opacity: number | undefined): boolean {
  return opacity !== undefined && Math.abs(opacity - LEGACY_DEFAULT_BACKGROUND) < 0.001;
}

function normalizeTrack(
  track: Partial<TrackStyle> | undefined,
  defaults: TrackStyle
): TrackStyle {
  const merged: TrackStyle = { ...defaults, ...track };
  if (isLegacyDefaultSize(track?.font_size)) merged.font_size = defaults.font_size;
  if (isLegacyDefaultBackground(track?.background_opacity)) {
    merged.background_opacity = defaults.background_opacity;
  }
  return {
    ...merged,
    font_size: clampSize(merged.font_size),
    background_opacity: clampOpacity(merged.background_opacity),
  };
}

function parseStoredSettings(raw: string): SubtitleStyleSettings | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SubtitleStyleSettings> & {
      sourceFontSize?: number;
      targetFontSize?: number;
    };
    if ("sourceFontSize" in parsed || "targetFontSize" in parsed) {
      return {
        source: normalizeTrack(
          {
            font_size: parsed.sourceFontSize,
            background_opacity: LEGACY_DEFAULT_BACKGROUND,
          },
          DEFAULT_SUBTITLE_STYLE.source
        ),
        target: normalizeTrack(
          {
            font_size: parsed.targetFontSize,
            background_opacity: LEGACY_DEFAULT_BACKGROUND,
          },
          DEFAULT_SUBTITLE_STYLE.target
        ),
      };
    }
    return {
      source: normalizeTrack(parsed.source, DEFAULT_SUBTITLE_STYLE.source),
      target: normalizeTrack(parsed.target, DEFAULT_SUBTITLE_STYLE.target),
    };
  } catch {
    return null;
  }
}

function loadSettingsForJob(jobId: string | null): SubtitleStyleSettings {
  const key = storageKey(jobId);
  const stored = localStorage.getItem(key);
  if (stored) {
    const parsed = parseStoredSettings(stored);
    if (parsed) return parsed;
  }

  if (!jobId) {
    const global = localStorage.getItem(LEGACY_GLOBAL_KEY);
    if (global) {
      const parsed = parseStoredSettings(global);
      if (parsed) return parsed;
    }
    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (!legacy) continue;
      const parsed = parseStoredSettings(legacy);
      if (parsed) {
        localStorage.removeItem(legacyKey);
        return parsed;
      }
    }
  }

  return DEFAULT_SUBTITLE_STYLE;
}

function persistSettings(jobId: string | null, settings: SubtitleStyleSettings) {
  localStorage.setItem(storageKey(jobId), JSON.stringify(settings));
}

export function useSubtitleStyleSettings(jobId: string | null = null) {
  const [settings, setSettings] = useState<SubtitleStyleSettings>(() =>
    loadSettingsForJob(jobId)
  );

  useEffect(() => {
    setSettings(loadSettingsForJob(jobId));
  }, [jobId]);

  useEffect(() => {
    persistSettings(jobId, settings);
  }, [settings, jobId]);

  const updateSource = useCallback((patch: Partial<TrackStyle>) => {
    setSettings((s) => ({
      ...s,
      source: {
        ...s.source,
        ...patch,
        font_size: patch.font_size !== undefined ? clampSize(patch.font_size) : s.source.font_size,
        background_opacity:
          patch.background_opacity !== undefined
            ? clampOpacity(patch.background_opacity)
            : s.source.background_opacity,
      },
    }));
  }, []);

  const updateTarget = useCallback((patch: Partial<TrackStyle>) => {
    setSettings((s) => ({
      ...s,
      target: {
        ...s.target,
        ...patch,
        font_size: patch.font_size !== undefined ? clampSize(patch.font_size) : s.target.font_size,
        background_opacity:
          patch.background_opacity !== undefined
            ? clampOpacity(patch.background_opacity)
            : s.target.background_opacity,
      },
    }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SUBTITLE_STYLE), []);

  const loadFromConfig = useCallback(
    (style: SubtitleStyleSettings) => {
      const next = {
        source: normalizeTrack(style.source, DEFAULT_SUBTITLE_STYLE.source),
        target: normalizeTrack(style.target, DEFAULT_SUBTITLE_STYLE.target),
      };
      setSettings(next);
      if (jobId) persistSettings(jobId, next);
    },
    [jobId]
  );

  return { settings, updateSource, updateTarget, reset, loadFromConfig };
}

/** @deprecated use useSubtitleStyleSettings */
export function useSubtitleFontSettings() {
  const { settings, updateSource, updateTarget, reset } = useSubtitleStyleSettings();
  return {
    settings: {
      sourceFontSize: settings.source.font_size,
      targetFontSize: settings.target.font_size,
    },
    setSourceFontSize: (px: number) => updateSource({ font_size: px }),
    setTargetFontSize: (px: number) => updateTarget({ font_size: px }),
    reset,
  };
}

export type SubtitleFontSettings = {
  sourceFontSize: number;
  targetFontSize: number;
};

export const DEFAULT_SUBTITLE_FONTS = {
  sourceFontSize: DEFAULT_SUBTITLE_STYLE.source.font_size,
  targetFontSize: DEFAULT_SUBTITLE_STYLE.target.font_size,
};
