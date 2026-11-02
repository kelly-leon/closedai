"use client";

import { useEffect, useState } from "react";
import { chatSound, SOUND_DEFAULT_ON } from "../lib/sound";

const STORAGE_KEY = "closedai-sound";

export function soundFeatureEnabled() {
  return process.env.NEXT_PUBLIC_SOUND !== "off";
}

export function SoundToggle() {
  const [enabled, setEnabled] = useState(SOUND_DEFAULT_ON);

  useEffect(() => {
    if (!soundFeatureEnabled()) return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const next = saved === null ? SOUND_DEFAULT_ON : saved === "true";
    setEnabled(next);
    chatSound.setEnabled(next);
    const onVisibility = () => {
      if (document.hidden) chatSound.stop(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (!soundFeatureEnabled()) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        window.localStorage.setItem(STORAGE_KEY, String(next));
        chatSound.setEnabled(next);
        if (next) void chatSound.gesture();
      }}
      aria-label={enabled ? "Mute chat sounds" : "Enable chat sounds"}
      aria-pressed={enabled}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#a9b3c7] hover:bg-white/10"
    >
      {enabled ? "♪" : "♩"}
    </button>
  );
}
