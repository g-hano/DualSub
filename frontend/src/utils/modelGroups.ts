import type { ModelInfo } from "../types";

export type ModelCategory = "asr" | "translation" | "tts";

export interface ModelSubgroup {
  id: string;
  label: string;
  models: ModelInfo[];
}

export interface GroupedModels {
  asr: ModelSubgroup[];
  translation: ModelSubgroup[];
  tts: ModelSubgroup[];
}

const CATEGORY_ORDER: ModelCategory[] = ["asr", "translation", "tts"];

const CATEGORY_LABEL: Record<ModelCategory, string> = {
  asr: "Speech Recognition",
  translation: "Translation",
  tts: "Text to Speech",
};

const SUBGROUP_DEFS: Record<ModelCategory, { id: string; label: string; match: (m: ModelInfo) => boolean }[]> =
  {
    asr: [
      {
        id: "qwen3-asr",
        label: "Qwen3 ASR",
        match: (m) =>
          (m.id.includes("qwen3-asr") || m.repo_id.includes("Qwen3-ASR")) &&
          !m.repo_id.includes("ForcedAligner"),
      },
      {
        id: "qwen3-aligner",
        label: "Qwen3 Forced Aligner",
        match: (m) =>
          m.id.includes("forced-aligner") || m.repo_id.includes("ForcedAligner"),
      },
      {
        id: "whisper",
        label: "Whisper",
        match: (m) => m.id.includes("whisper") || m.repo_id.toLowerCase().includes("whisper"),
      },
      {
        id: "nemotron",
        label: "Nemotron",
        match: (m) => m.id.includes("nemotron") || m.repo_id.toLowerCase().includes("nemotron"),
      },
    ],
    translation: [
      {
        id: "helsinki",
        label: "Helsinki opus-mt",
        match: (m) =>
          m.repo_id.includes("Helsinki-NLP") || m.repo_id.toLowerCase().includes("opus-mt"),
      },
      {
        id: "nllb",
        label: "NLLB",
        match: (m) => m.id.includes("nllb") || m.repo_id.toLowerCase().includes("nllb"),
      },
      {
        id: "hunyuan",
        label: "Hunyuan",
        match: (m) =>
          m.id.includes("hunyuan") ||
          m.repo_id.includes("HY-MT") ||
          m.repo_id.includes("Hy-MT"),
      },
      {
        id: "translategemma",
        label: "TranslateGemma",
        match: (m) =>
          m.id.includes("translategemma") ||
          m.repo_id.toLowerCase().includes("translategemma"),
      },
    ],
    tts: [
      {
        id: "qwen3-tokenizer",
        label: "Qwen3 Tokenizer",
        match: (m) =>
          m.id.includes("tokenizer") ||
          m.repo_id.toLowerCase().includes("tokenizer"),
      },
      {
        id: "qwen3-custom",
        label: "Qwen3 CustomVoice",
        match: (m) => m.repo_id.includes("CustomVoice"),
      },
      {
        id: "qwen3-design",
        label: "Qwen3 VoiceDesign",
        match: (m) => m.repo_id.includes("VoiceDesign"),
      },
      {
        id: "qwen3-base",
        label: "Qwen3 Voice Clone",
        match: (m) =>
          (m.repo_id.includes("-Base") || m.id.includes("-base")) &&
          !m.repo_id.toLowerCase().includes("tokenizer"),
      },
      {
        id: "voxcpm",
        label: "VoxCPM",
        match: (m) => m.id.includes("voxcpm") || m.repo_id.toLowerCase().includes("voxcpm"),
      },
      {
        id: "omnivoice",
        label: "OmniVoice",
        match: (m) => m.id.includes("omnivoice") || m.repo_id.toLowerCase().includes("omnivoice"),
      },
    ],
  };

function subgroupForModel(category: ModelCategory, model: ModelInfo): string {
  const defs = SUBGROUP_DEFS[category];
  for (const def of defs) {
    if (def.match(model)) return def.id;
  }
  return "other";
}

function buildCategoryGroups(category: ModelCategory, models: ModelInfo[]): ModelSubgroup[] {
  const bySubgroup = new Map<string, ModelInfo[]>();
  const labelById = new Map<string, string>(
    SUBGROUP_DEFS[category].map((d) => [d.id, d.label])
  );
  labelById.set("other", "Other");

  for (const model of models) {
    const sg = subgroupForModel(category, model);
    const list = bySubgroup.get(sg) ?? [];
    list.push(model);
    bySubgroup.set(sg, list);
  }

  const order = [...SUBGROUP_DEFS[category].map((d) => d.id), "other"];
  return order
    .filter((id) => (bySubgroup.get(id)?.length ?? 0) > 0)
    .map((id) => ({
      id,
      label: labelById.get(id) ?? id,
      models: bySubgroup.get(id) ?? [],
    }));
}

export function groupModels(models: ModelInfo[]): GroupedModels {
  const byCategory: Record<ModelCategory, ModelInfo[]> = {
    asr: [],
    translation: [],
    tts: [],
  };

  for (const model of models) {
    const cat = model.category as ModelCategory;
    if (CATEGORY_ORDER.includes(cat)) {
      byCategory[cat].push(model);
    }
  }

  return {
    asr: buildCategoryGroups("asr", byCategory.asr),
    translation: buildCategoryGroups("translation", byCategory.translation),
    tts: buildCategoryGroups("tts", byCategory.tts),
  };
}

export function categoryLabel(category: ModelCategory): string {
  return CATEGORY_LABEL[category];
}

export function subgroupSummary(models: ModelInfo[]): string {
  const downloaded = models.filter((m) => m.status === "downloaded").length;
  const requiredMissing = models.filter((m) => m.required && m.status !== "downloaded").length;
  if (requiredMissing > 0) {
    return `${downloaded}/${models.length} · ${requiredMissing} required`;
  }
  return `${downloaded}/${models.length} downloaded`;
}

export { CATEGORY_ORDER };
