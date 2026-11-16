import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { IconButton } from "./ui";

export function CopyButton({
  text,
  title = "Copy",
  className,
}: {
  text: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable in odd setups; ignore.
    }
  };

  return (
    <IconButton
      title={copied ? "Copied" : title}
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
    >
      {copied ? (
        <Check size={12} className="text-accent" />
      ) : (
        <Copy size={12} />
      )}
    </IconButton>
  );
}
