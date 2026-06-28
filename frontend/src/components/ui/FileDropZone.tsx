import { useRef, useState, type DragEvent } from "react";
import { IconUpload } from "./Icons";

export default function FileDropZone({
  accept,
  file,
  onFile,
}: {
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-all ${
        dragging
          ? "border-indigo-500/60 bg-indigo-500/5"
          : file
            ? "border-indigo-500/40 bg-indigo-500/5"
            : "border-zinc-700 bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-900/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
        <IconUpload className="h-5 w-5" />
      </span>
      {file ? (
        <>
          <p className="text-sm font-medium text-zinc-200">{file.name}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {(file.size / 1024 / 1024).toFixed(1)} MB — click to change
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-300">Drop Video or Audio Here</p>
          <p className="mt-1 text-xs text-zinc-500">or click to browse files</p>
        </>
      )}
    </div>
  );
}
