"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@sailo/design-system/web";
import { formatBytes } from "@sailo/core/currency";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

const MAX_FILES = 10;

export type UploadedFile = {
  name: string;
  url: string;
  sizeBytes: number | null;
  contentType: string | null;
};

/**
 * The files a digital product delivers. Uploads go to blob storage under an
 * unguessable path and buyers never see that URL — the download route streams
 * the bytes behind a per-order token.
 */
export function FileUploader({
  name = "files",
  initial = [],
  max = MAX_FILES,
}: {
  name?: string;
  initial?: UploadedFile[];
  max?: number;
}) {
  const a = useAdminT();
  const [files, setFiles] = useState<UploadedFile[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setUploading(true);

    const room = max - files.length;
    for (const file of Array.from(list).slice(0, Math.max(room, 0))) {
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", "download");
      try {
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? a.files.failed);
          continue;
        }
        setFiles((prev) => [
          ...prev,
          {
            name: json.name ?? file.name,
            url: json.url,
            sizeBytes: json.sizeBytes ?? file.size,
            contentType: json.contentType ?? file.type,
          },
        ]);
      } catch {
        setError(a.files.failedNetwork);
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      {files.map((file) => (
        <input
          key={file.url}
          type="hidden"
          name={name}
          value={JSON.stringify(file)}
        />
      ))}

      {files.length > 0 ? (
        <ul className="mb-3 divide-y divide-ink-100 rounded-xl border border-ink-200">
          {files.map((file, index) => (
            <li key={file.url} className="flex items-center gap-3 px-3 py-2.5">
              <Paperclip className="size-4 shrink-0 text-ink-400" />
              <span className="min-w-0 flex-1">
                <input
                  value={file.name}
                  maxLength={200}
                  aria-label={`Name of file ${index + 1}`}
                  onChange={(e) =>
                    setFiles((prev) =>
                      prev.map((f, i) =>
                        i === index ? { ...f, name: e.target.value } : f,
                      ),
                    )
                  }
                  className="w-full truncate bg-transparent text-sm font-medium text-ink-900 outline-none focus:underline"
                />
                <span className="block text-xs text-ink-400">
                  {file.sizeBytes ? formatBytes(file.sizeBytes) : "—"}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setFiles((prev) => prev.filter((_, i) => i !== index))
                }
                className="shrink-0 text-ink-400 hover:bg-red-50 hover:text-red-600"
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {files.length < max ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileUp className="size-4" />
          )}
          {uploading
            ? a.files.uploading
            : files.length
              ? a.files.addAnother
              : a.files.add}
        </Button>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple={max > 1}
        onChange={(e) => onFiles(e.target.files)}
        className="hidden"
      />

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <p className="mt-2 text-xs text-ink-400">
        {a.files.hint}
      </p>
    </div>
  );
}
