"use client";

export function SpaceBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#02040d]">
      <div className="absolute inset-0 space-gradient" />
      <div className="absolute inset-0 space-stars-small" />
      <div className="absolute inset-0 space-stars-medium" />
      <div className="absolute inset-0 space-stars-bright" />
      <div className="content-shade absolute inset-0" />
      <div className="earth-haze" />
      <div className="earth-horizon" />
    </div>
  );
}
