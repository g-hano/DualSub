import { useCallback, useEffect, useState } from "react";
import type { SubtitleStyleSettings, TrackStyle } from "../types";

export type { SubtitleStyleSettings, TrackStyle };

const STORAGE_KEY = "subtitle-style-settings";

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

function clampSize(n: number): number {
  return Math.min(48, Math.max(12, Math.round(n)));
}

function clampOpacity(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function loadSettings(): SubtitleStyleSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SUBTITLE_STYLE;
    const parsed = JSON.parse(raw) as Partial<SubtitleStyleSettings>;
    return {
      source: { ...DEFAULT_SUBTITLE_STYLE.source, ...parsed.source },
      target: { ...DEFAULT_SUBTITLE_STYLE.target, ...parsed.target },
    };
  } catch {
    return DEFAULT_SUBTITLE_STYLE;
  }
}

export function useSubtitleStyleSettings() {
  const [settings, setSettings] = useState<SubtitleStyleSettings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

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

  return { settings, updateSource, updateTarget, reset };
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
