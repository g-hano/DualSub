import { useTranslation } from "react-i18next";
import Button from "./ui/Button";
import FileDropZone from "./ui/FileDropZone";
import FormSection from "./ui/FormSection";
import ModeCard from "./ui/ModeCard";
import { IconArrowRight, IconDub, IconLink, IconPlay, IconSubtitles, IconUpload } from "./ui/Icons";
import Input from "./ui/Input";
import Select from "./ui/Select";
import SegmentedControl from "./ui/SegmentedControl";
import { useJobForm } from "../hooks/useJobForm";

export default function JobForm() {
  const { t } = useTranslation();
  const f = useJobForm();

  return (
    <form onSubmit={f.submit} className="space-y-6">
      <div className="flex gap-3">
        <ModeCard
          selected={f.jobMode === "subtitle"}
          onClick={() => f.setJobMode("subtitle")}
          icon={<IconSubtitles className="h-5 w-5" />}
          title={t("jobForm.subtitles")}
          description={t("jobForm.subtitlesDesc")}
        />
        <ModeCard
          selected={f.jobMode === "dub"}
          onClick={() => f.setJobMode("dub")}
          icon={<IconDub className="h-5 w-5" />}
          title={t("jobForm.dubbing")}
          description={t("jobForm.dubbingDesc")}
        />
      </div>

      <FormSection step={1} title={t("jobForm.mediaSource")} description={t("jobForm.mediaSourceDesc")}>
        <SegmentedControl
          value={f.mode}
          onChange={f.setMode}
          size="sm"
          options={[
            { value: "url" as const, label: t("common.url"), icon: <IconLink className="h-3.5 w-3.5" /> },
            { value: "file" as const, label: t("common.upload"), icon: <IconUpload className="h-3.5 w-3.5" /> },
          ]}
        />
        <div className="mt-3">
          {f.mode === "url" ? (
            <Input
              type="url"
              value={f.sourceUrl}
              onChange={(e) => f.setSourceUrl(e.target.value)}
              placeholder={t("jobForm.urlPlaceholder")}
            />
          ) : (
            <FileDropZone accept="video/*,audio/*" file={f.file} onFile={f.setFile} />
          )}
        </div>
      </FormSection>

      <FormSection step={2} title={t("jobForm.languages")} description={t("jobForm.languagesDesc")}>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select label={t("common.from")} value={f.sourceLang} onChange={(e) => f.setSourceLang(e.target.value)}>
              {f.sortedLanguages.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <span className="mb-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500">
            <IconArrowRight className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <Select label={t("common.to")} value={f.targetLang} onChange={(e) => f.setTargetLang(e.target.value)}>
              {f.sortedLanguages.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </FormSection>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={!f.canSubmit || f.busy}
        className="w-full"
        icon={<IconPlay className="h-4 w-4" />}
      >
        {f.busy
          ? t("jobForm.processing")
          : f.jobMode === "dub"
            ? t("jobForm.generateDub")
            : t("jobForm.generateSubtitles")}
      </Button>
    </form>
  );
}
