import { useCallback, useEffect, useState } from "react";

export interface SubtitleFontSettings {
  sourceFontSize: number;
  targetFontSize: number;
}

const STORAGE_KEY = "subtitle-font-settings";

export const DEFAULT_SUBTITLE_FONTS: SubtitleFontSettings = {
  sourceFontSize: 22,
  targetFontSize: 20,
};

function loadSettings(): SubtitleFontSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SUBTITLE_FONTS;
    const parsed = JSON.parse(raw) as Partial<SubtitleFontSettings>;
    return {
      sourceFontSize: clamp(parsed.sourceFontSize ?? DEFAULT_SUBTITLE_FONTS.sourceFontSize),
      targetFontSize: clamp(parsed.targetFontSize ?? DEFAULT_SUBTITLE_FONTS.targetFontSize),
    };
  } catch {
    return DEFAULT_SUBTITLE_FONTS;
  }
}

function clamp(n: number): number {
  return Math.min(48, Math.max(12, Math.round(n)));
}

export function useSubtitleFontSettings() {
  const [settings, setSettings] = useState<SubtitleFontSettings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setSourceFontSize = useCallback((sourceFontSize: number) => {
    setSettings((s) => ({ ...s, sourceFontSize: clamp(sourceFontSize) }));
  }, []);

  const setTargetFontSize = useCallback((targetFontSize: number) => {
    setSettings((s) => ({ ...s, targetFontSize: clamp(targetFontSize) }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SUBTITLE_FONTS), []);

  return { settings, setSourceFontSize, setTargetFontSize, reset };
}
