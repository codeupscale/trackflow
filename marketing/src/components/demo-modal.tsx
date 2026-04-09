"use client";

import { useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DemoModal({ isOpen, onClose }: DemoModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-[110] size-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        aria-label="Close demo"
      >
        <X className="size-5" />
      </button>

      {/* Demo iframe container — 16:9 aspect ratio */}
      <div className="relative w-[95vw] max-w-[1920px] aspect-video rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
        <iframe
          src="/demo/index.html"
          className="w-full h-full border-0"
          title="TrackFlow Product Demo"
          allow="autoplay"
        />
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 text-white/60 text-sm">
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs font-mono">Space</kbd>
          Pause/Resume
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs font-mono">&larr; &rarr;</kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs font-mono">Esc</kbd>
          Close
        </span>
      </div>
    </div>
  );
}
