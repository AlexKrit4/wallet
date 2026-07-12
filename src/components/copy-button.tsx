"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="btn btn-ghost"
      type="button"
      style={{ marginBottom: "0.75rem" }}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Скопировано" : "Копировать адрес"}
    </button>
  );
}
