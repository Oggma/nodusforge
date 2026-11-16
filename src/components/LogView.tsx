import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  Search,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useAppStore } from "../store/useAppStore";
import { cn } from "../lib/format";
import { CopyButton } from "./CopyButton";
import { IconButton } from "./ui";

const EMPTY_LINES: string[] = [];

export function LogView({ appId }: { appId: string }) {
  const lines = useAppStore((state) => state.logs[appId] ?? EMPTY_LINES);
  const ensureLogs = useAppStore((state) => state.ensureLogs);
  const clearLogs = useAppStore((state) => state.clearLogs);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const writtenRef = useRef(0);
  const followRef = useRef(true);
  const writingRef = useRef(false);

  const [follow, setFollow] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [termEpoch, setTermEpoch] = useState(0);

  useEffect(() => {
    void ensureLogs(appId);
  }, [appId, ensureLogs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    writtenRef.current = 0;

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 10000,
      fontFamily:
        '"JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace',
      theme: {
        background: "#0b0f14",
        foreground: "#d7e1ec",
        cursor: "#0b0f14",
        cursorAccent: "#0b0f14",
        selectionBackground: "#2a4a3c",
        black: "#1f2937",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#d1d5db",
        brightBlack: "#4b5563",
        brightRed: "#fca5a5",
        brightGreen: "#6ee7b7",
        brightYellow: "#fcd34d",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f3f4f6",
      },
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());

    term.open(container);
    fit.fit();

    const onScroll = term.onScroll(() => {
      if (writingRef.current) return;
      const buffer = term.buffer.active;
      const gap = buffer.baseY - buffer.viewportY;
      const atBottom = gap <= 3;
      if (atBottom !== followRef.current) {
        followRef.current = atBottom;
        setFollow(atBottom);
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // The terminal may be between mounts; safe to ignore.
      }
    });
    observer.observe(container);

    termRef.current = term;
    searchRef.current = search;
    setTermEpoch((value) => value + 1);

    return () => {
      observer.disconnect();
      onScroll.dispose();
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
    };
  }, [appId]);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (lines.length < writtenRef.current) {
      term.reset();
      writtenRef.current = 0;
    }

    if (lines.length > writtenRef.current) {
      const chunk = lines.slice(writtenRef.current).join("\r\n");
      writingRef.current = true;
      term.write(`${chunk}\r\n`, () => {
        writingRef.current = false;
        if (followRef.current) {
          term.scrollToBottom();
        }
      });
      writtenRef.current = lines.length;
    }

    if (followRef.current) {
      term.scrollToBottom();
    }
  }, [lines, termEpoch]);

  useEffect(() => {
    if (!searchOpen || !query) return;
    const timer = window.setTimeout(() => {
      searchRef.current?.findNext(query, {
        incremental: true,
        caseSensitive: false,
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query, searchOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => {
          document.getElementById(`log-search-${appId}`)?.focus();
        }, 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [appId]);

  const jumpToBottom = () => {
    setFollow(true);
    termRef.current?.scrollToBottom();
  };

  const download = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${appId}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line-soft bg-panel/50 px-2.5 py-1.5">
        <button
          onClick={() => setFollow((value) => !value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
            follow
              ? "bg-accent/10 text-accent"
              : "text-muted hover:bg-panel-2 hover:text-ink",
          )}
          title="Follow new output"
        >
          <ArrowDownToLine size={12} />
          Follow
        </button>

        <span className="mx-1 h-4 w-px bg-line" />

        <IconButton
          title="Search logs (Ctrl+F)"
          onClick={() => {
            setSearchOpen((open) => !open);
            window.setTimeout(() => {
              if (!searchOpen) {
                document.getElementById(`log-search-${appId}`)?.focus();
              }
            }, 0);
          }}
        >
          <Search size={13} />
        </IconButton>

        {searchOpen && (
          <div className="flex items-center gap-1">
            <input
              id={`log-search-${appId}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) {
                    searchRef.current?.findPrevious(query);
                  } else {
                    searchRef.current?.findNext(query);
                  }
                }
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  setQuery("");
                }
              }}
              placeholder="Find in logs"
              className="h-7 w-44 rounded-md border border-line bg-canvas px-2 text-[11.5px] outline-none placeholder:text-muted/50 focus:border-accent/40"
            />
            <IconButton
              title="Previous match"
              disabled={!query}
              onClick={() => searchRef.current?.findPrevious(query)}
            >
              <ChevronUp size={13} />
            </IconButton>
            <IconButton
              title="Next match"
              disabled={!query}
              onClick={() => searchRef.current?.findNext(query)}
            >
              <ChevronDown size={13} />
            </IconButton>
            <IconButton
              title="Close search"
              onClick={() => {
                setSearchOpen(false);
                setQuery("");
              }}
            >
              <X size={12} />
            </IconButton>
          </div>
        )}

        <span className="mx-1 h-4 w-px bg-line" />

        <IconButton
          title="Clear log buffer"
          onClick={() => void clearLogs(appId)}
        >
          <Eraser size={13} />
        </IconButton>
        <CopyButton text={lines.join("\n")} title="Copy all logs" />
        <IconButton
          title="Download logs"
          disabled={lines.length === 0}
          onClick={download}
        >
          <Download size={13} />
        </IconButton>

        <div className="ml-auto flex items-center gap-2 pr-1 font-mono text-[10px] text-muted/70">
          {lines.length.toLocaleString()} lines
          {!follow && (
            <button
              onClick={jumpToBottom}
              className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent"
            >
              jump to latest ↓
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-canvas" ref={containerRef} />
    </div>
  );
}
