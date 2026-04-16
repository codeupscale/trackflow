"use client";

import { useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DemoModal({ isOpen, onClose }: DemoModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
      // Auto-play video when modal opens
      videoRef.current?.play();
    } else {
      document.body.style.overflow = "";
      // Pause and reset when closed
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md"
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

      {/* Video container — 16:9 aspect ratio */}
      <div className="relative w-[92vw] max-w-[1280px] aspect-video rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
        <video
          ref={videoRef}
          src="/trackflow-demo.mp4"
          className="w-full h-full object-cover"
          controls
          autoPlay
          playsInline
          preload="auto"
        />
      </div>

      {/* Hint */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40 text-sm">
        Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs font-mono">Esc</kbd> to close
      </div>
    </div>
  );
}
