import { useEffect, useRef, useState } from "react";
import Alert from "./ui/Alert";
import Accordion from "./ui/Accordion";
import Input, { FileInput, Textarea } from "./ui/Input";
import Select from "./ui/Select";
import SegmentedControl from "./ui/SegmentedControl";
import { IconDub, IconGlobe, IconMic, IconQualityCheck, IconSettings } from "./ui/Icons";
import {
  CUSTOM_WHISPER_VALUE,
  LLM_PROVIDER_PRESETS,
  TTS_BACKEND_LABELS,
  TRANSLATION_BACKENDS,
  useJobForm,
} from "../hooks/useJobForm";
import type { AsrModelOption, LlmProvider, TtsBackend } from "../types";

export function AdvancedSettingsToolbar() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Advanced settings"
        className={`group relative flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          open
            ? "border border-indigo-500/50 bg-indigo-500/20 text-indigo-300 ring-2 ring-indigo-500/40"
            : "border border-indigo-500/35 bg-zinc-900/80 text-zinc-400 hover:border-indigo-500/55 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
      >
        <IconSettings className="h-4 w-4" />
      </button>

      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-50 max-w-[220px] whitespace-normal rounded-md border border-border bg-zinc-900 px-2.5 py-1.5 text-xs leading-snug text-zinc-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      >
        Voice & dubbing, ASR, translation & quality control
      </div>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-40 w-[min(400px,calc(100vw-2.5rem))] max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-border bg-[var(--panel-bg)] p-3 shadow-xl">
          <AdvancedSettingsFields />
        </div>
      )}
    </div>
  );
}

function AdvancedSettingsFields() {
  const f = useJobForm();

  return (
    <div className="space-y-2">
      {f.jobMode === "dub" && (
        <Accordion
          title="Voice & dubbing"
          description="TTS Engine, Voice Cloning, Background Audio"
          icon={<IconDub className="h-4 w-4" />}
          defaultOpen={false}
          variant="ghost"
        >
          <VoiceDubbingFields />
        </Accordion>
      )}

      <Accordion
        title="ASR"
        description="Speech Recognition Engine and Models"
        icon={<IconMic className="h-4 w-4" />}
        defaultOpen={false}
        variant="ghost"
      >
        <AsrFields />
      </Accordion>

      <Accordion
        title="Translation"
        description="Translation Engine, Models, and Batch Size"
        icon={<IconGlobe className="h-4 w-4" />}
        defaultOpen={false}
        variant="ghost"
      >
        <TranslationFields />
      </Accordion>

      <Accordion
        title="Quality control"
        description="Back-translate review with a Local LLM"
        icon={<IconQualityCheck className="h-4 w-4" />}
        defaultOpen={false}
        variant="ghost"
      >
        <QualityControlFields />
      </Accordion>
    </div>
  );
}

function VoiceDubbingFields() {
  const f = useJobForm();

  return (
    <div className="space-y-4">
      {f.isVoiceDesign && (
        <Alert variant="warning">
          VoiceDesign can vary between lines. For more consistent dubbing, use CustomVoice or voice
          clone instead.
        </Alert>
      )}
      <Select
        label="TTS engine"
        value={f.ttsBackend}
        onChange={(e) => f.handleTtsBackendChange(e.target.value as TtsBackend)}
      >
        {(Object.keys(TTS_BACKEND_LABELS) as TtsBackend[]).map((id) => (
          <option key={id} value={id}>
            {TTS_BACKEND_LABELS[id]}
          </option>
        ))}
      </Select>

      {f.ttsBackend === "qwen" && f.ttsMeta && (
        <RepoSelect
          label="Qwen3-TTS model"
          value={f.ttsModel}
          onChange={f.handleTtsModelChange}
          options={f.ttsMeta.qwen_models}
        />
      )}

      {f.showCloneUi && !f.isVoiceClone && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-400">Voice source</p>
          <SegmentedControl
            value={f.voiceMode}
            onChange={f.setVoiceMode}
            options={[
              { value: "clone_video" as const, label: "From video" },
              { value: "clone_upload" as const, label: "Upload ref" },
              ...(f.backendInfo?.supports_preset
                ? [{ value: "preset" as const, label: "Preset" }]
                : []),
            ]}
          />
        </div>
      )}

      {f.isVoiceClone && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-400">Voice source</p>
          <SegmentedControl
            value={f.voiceMode}
            onChange={f.setVoiceMode}
            options={[
              { value: "clone_video" as const, label: "From video" },
              { value: "clone_upload" as const, label: "Upload ref" },
            ]}
          />
        </div>
      )}

      {f.showPresetUi && f.presetVoices.length > 0 && f.voiceMode === "preset" && (
        <Select label="Preset voice" value={f.voiceId} onChange={(e) => f.setVoiceId(e.target.value)}>
          {f.presetVoices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
      )}

      {f.isVoiceDesign && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-400">Voice description (required)</p>
          <Textarea
            value={f.voiceDesignInstruct}
            onChange={(e) => f.setVoiceDesignInstruct(e.target.value)}
            rows={3}
            placeholder="Describe the target voice in natural language…"
          />
        </div>
      )}

      {f.ttsBackend === "qwen" && f.qwenKind === "custom_voice" && f.voiceMode === "preset" && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-400">Style instruct (optional)</p>
          <Input
            value={f.voiceInstruct}
            onChange={(e) => f.setVoiceInstruct(e.target.value)}
            placeholder="e.g. speak cheerfully"
          />
        </div>
      )}

      {f.ttsBackend === "voxcpm" && f.voiceMode === "preset" && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-400">
            Voice design description (optional)
          </p>
          <Input
            value={f.voiceDesignInstruct}
            onChange={(e) => f.setVoiceDesignInstruct(e.target.value)}
            placeholder="e.g. A young woman, gentle and sweet voice"
          />
        </div>
      )}

      {f.voiceMode === "clone_upload" && (
        <>
          <div>
            <p className="mb-1.5 text-sm font-medium text-zinc-400">Reference audio</p>
            <FileInput
              type="file"
              accept="audio/*"
              onChange={(e) => f.setRefAudioFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {!f.voiceCloneXVectorOnly && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-zinc-400">Reference transcript (required)</p>
              <Textarea
                value={f.refText}
                onChange={(e) => f.setRefText(e.target.value)}
                rows={2}
                placeholder="Exact words spoken in the reference clip"
              />
            </div>
          )}
        </>
      )}

      {f.voiceMode === "clone_video" &&
        (f.isVoiceClone ||
          f.ttsBackend === "omnivoice" ||
          f.ttsBackend === "higgs" ||
          f.ttsBackend === "voxcpm") && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-zinc-400">
              Reference transcript override (optional)
            </p>
            <Textarea
              value={f.refText}
              onChange={(e) => f.setRefText(e.target.value)}
              rows={2}
              placeholder="Leave empty to auto-detect from ASR"
            />
          </div>
        )}

      {f.isVoiceClone && (
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={f.voiceCloneXVectorOnly}
            onChange={(e) => f.setVoiceCloneXVectorOnly(e.target.checked)}
            className="h-4 w-4 accent-zinc-400"
          />
          <span className="text-sm text-zinc-300">
            x_vector_only Mode (no ref transcript; lower clone quality)
          </span>
        </label>
      )}

      {f.ttsBackend === "higgs" && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-400">Higgs TTS Server URL</p>
          <Input value={f.higgsServerUrl} onChange={(e) => f.setHiggsServerUrl(e.target.value)} />
          <p className="mt-1 text-xs text-zinc-500">
            Run SGLang-Omni or vLLM-Omni locally. Research/non-commercial license.
          </p>
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={f.keepBackground}
          onChange={(e) => f.setKeepBackground(e.target.checked)}
          className="h-4 w-4 rounded accent-indigo-500"
        />
        <span className="text-sm text-zinc-300">Keep background music (Demucs separation)</span>
      </label>

      {f.keepBackground && (
        <label className="block">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-zinc-400">Background audio level</span>
            <span className="font-mono text-zinc-500">{Math.round(f.backgroundMixLevel * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(f.backgroundMixLevel * 100)}
            onChange={(e) => f.setBackgroundMixLevel(Number(e.target.value) / 100)}
            className="subtitle-font-slider w-full"
          />
        </label>
      )}
    </div>
  );
}

function AsrFields() {
  const f = useJobForm();

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-400">ASR Engine</p>
        <SegmentedControl
          value={f.asrEngine}
          onChange={f.setAsrEngine}
          options={[
            { value: "qwen" as const, label: "Qwen3" },
            { value: "whisper" as const, label: "Whisper" },
            { value: "nemotron" as const, label: "Nemotron" },
          ]}
        />
      </div>

      {f.asrEngine === "qwen" && (
        <div className="grid grid-cols-1 gap-4">
          <RepoSelect label="ASR model" value={f.asrModel} onChange={f.setAsrModel} options={f.asrModels} />
          <RepoSelect
            label="Forced Aligner"
            value={f.forcedAlignerModel}
            onChange={f.setForcedAlignerModel}
            options={f.alignerModels}
          />
        </div>
      )}

      {f.asrEngine === "whisper" && (
        <div className="space-y-3">
          <Select
            label="Whisper Model"
            value={f.whisperPreset}
            onChange={(e) => f.setWhisperPreset(e.target.value)}
          >
            {f.whisperModels.map((opt) => (
              <option key={opt.repo_id} value={opt.repo_id}>
                {opt.label}
              </option>
            ))}
            <option value={CUSTOM_WHISPER_VALUE}>Custom HF model…</option>
          </Select>
          {f.whisperPreset === CUSTOM_WHISPER_VALUE && (
            <Input
              value={f.whisperCustom}
              onChange={(e) => f.setWhisperCustom(e.target.value)}
              placeholder="e.g. openai/whisper-large-v3-turbo"
            />
          )}
        </div>
      )}

      {f.asrEngine === "nemotron" && (
        <div className="space-y-3">
          <RepoSelect
            label="Nemotron Model"
            value={f.nemotronModel}
            onChange={f.setNemotronModel}
            options={f.nemotronModels}
          />
          {f.nemotronInfo?.tier === "adaptation" && (
            <p className="text-xs text-amber-500/80">
              This language is adaptation-ready in Nemotron — accuracy may be lower unless
              fine-tuned on in-domain data.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TranslationFields() {
  const f = useJobForm();

  return (
    <div className="space-y-4">
      <Select
        label="Translation Engine"
        value={f.translatorBackend}
        onChange={(e) => f.setTranslatorBackend(e.target.value)}
      >
        {TRANSLATION_BACKENDS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </Select>

      {f.translatorBackend === "nllb" && (
        <RepoSelect label="NLLB Model" value={f.nllbModel} onChange={f.setNllbModel} options={f.nllbModels} />
      )}

      {f.translatorBackend === "hunyuan" && (
        <RepoSelect
          label="Hunyuan Model"
          value={f.hunyuanModel}
          onChange={f.setHunyuanModel}
          options={f.hunyuanModels}
        />
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-400">Translation Batch Size</p>
        <Input
          type="number"
          min={1}
          max={128}
          value={f.translateBatchSize}
          onChange={(e) =>
            f.setTranslateBatchSize(Math.min(128, Math.max(1, Number(e.target.value) || 1)))
          }
        />
      </div>
    </div>
  );
}

function QualityControlFields() {
  const f = useJobForm();

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={f.qcEnabled}
          onChange={(e) => f.setQcEnabled(e.target.checked)}
          className="h-4 w-4 rounded accent-indigo-500"
        />
        <span className="text-sm font-medium text-zinc-200">
          Enable Quality Control (Back-translate + Local LLM)
        </span>
      </label>
      {f.qcEnabled && (
        <div className="space-y-3">
          <Select
            label="LLM Provider"
            value={f.llmProvider}
            onChange={(e) => f.handleLlmProviderChange(e.target.value as LlmProvider)}
          >
            {(Object.keys(LLM_PROVIDER_PRESETS) as LlmProvider[]).map((id) => (
              <option key={id} value={id}>
                {LLM_PROVIDER_PRESETS[id].label}
              </option>
            ))}
          </Select>
          <Input
            value={f.llmBaseUrl}
            onChange={(e) => f.setLlmBaseUrl(e.target.value)}
            placeholder={`${LLM_PROVIDER_PRESETS[f.llmProvider].label} base URL`}
          />
          <Input
            value={f.llmModel}
            onChange={(e) => f.setLlmModel(e.target.value)}
            placeholder="Model name"
          />
        </div>
      )}
    </div>
  );
}

function RepoSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: AsrModelOption[];
}) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => (
        <option key={opt.repo_id} value={opt.repo_id}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
}
