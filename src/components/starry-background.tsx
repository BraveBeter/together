"use client";

import { useEffect, useRef } from "react";
import { isMapActive, MAP_ACTIVITY_EVENT } from "@/lib/map-activity";

type Star = { x: number; y: number; radius: number; alpha: number; phase: number; speed: number; warm: boolean };

// A repeatable sky stays in place across hydration, navigation and resizing.
function randomSource() {
  let seed = 1019;
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function StarryBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const sky = document.createElement("canvas");
    const skyContext = sky.getContext("2d");
    if (!skyContext) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let ratio = 1;
    let stars: Star[] = [];
    let frame = 0;
    let lastFrame = 0;
    let elapsed = 0;

    function drawSky() {
      if (!skyContext) return;
      const random = randomSource();
      const scale = Math.min(width / 1100, 1.3);
      skyContext.clearRect(0, 0, width, height);

      // Soft overlapping clouds form an irregular ribbon rather than a bright panel.
      for (let i = 0; i < 32; i++) {
        const t = i / 31;
        const x = width * (t * 1.3 - 0.15);
        const y = height * (0.94 - t * 0.9 + Math.sin(t * 8) * 0.045);
        const radius = (90 + random() * 100) * Math.max(scale, 0.7);
        const glow = skyContext.createRadialGradient(0, 0, 0, 0, 0, radius);
        const warm = i > 11 && i < 22;
        glow.addColorStop(0, warm ? "rgba(163, 135, 157, .045)" : "rgba(111, 135, 191, .045)");
        glow.addColorStop(0.4, "rgba(112, 115, 162, .025)");
        glow.addColorStop(1, "rgba(95, 109, 154, 0)");
        skyContext.save();
        skyContext.translate(x, y);
        skyContext.rotate(-0.45);
        skyContext.scale(1.5, 0.65);
        skyContext.fillStyle = glow;
        skyContext.fillRect(-radius, -radius, radius * 2, radius * 2);
        skyContext.restore();
      }

      // The fine galactic dust is painted only on resize, not every animation frame.
      const dustCount = Math.min(2500, Math.round(width * height / 480));
      for (let i = 0; i < dustCount; i++) {
        const t = random();
        const spread = (random() + random() + random() - 1.5);
        const x = width * (t * 1.3 - 0.15);
        const y = height * (0.94 - t * 0.9 + Math.sin(t * 8) * 0.045) + spread * Math.min(height * 0.19, 170);
        const size = 0.25 + random() * 0.65;
        skyContext.fillStyle = `rgba(194, 199, 220, ${0.045 + random() * 0.15})`;
        skyContext.beginPath();
        skyContext.arc(x, y, size, 0, Math.PI * 2);
        skyContext.fill();
      }

      const count = Math.min(200, Math.max(65, Math.round(width * height / 6500)));
      stars = Array.from({ length: count }, () => ({
        x: random() * width,
        y: random() * height,
        radius: 0.45 + random() ** 3 * 1.05,
        alpha: 0.16 + random() * 0.32,
        phase: random() * Math.PI * 2,
        speed: 0.22 + random() * 0.35,
        warm: random() > 0.74,
      }));
    }

    function paint() {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      context.drawImage(sky, 0, 0, width, height);
      const time = motion.matches ? 0 : elapsed;

      for (const star of stars) {
        const drift = motion.matches ? 0 : Math.sin(time * 0.035 + star.phase) * 5;
        const shimmer = 0.7 + Math.sin(time * star.speed + star.phase) * 0.3;
        const x = star.x + drift;
        const y = star.y + drift * 0.55;
        context.fillStyle = star.warm
          ? `rgba(243, 220, 197, ${star.alpha * shimmer})`
          : `rgba(218, 228, 247, ${star.alpha * shimmer})`;
        context.beginPath();
        context.arc(x, y, star.radius, 0, Math.PI * 2);
        context.fill();

        if (star.radius > 1.25) {
          context.strokeStyle = `rgba(221, 227, 243, ${star.alpha * shimmer * 0.22})`;
          context.lineWidth = 0.6;
          context.beginPath();
          context.moveTo(x - 3.4, y);
          context.lineTo(x + 3.4, y);
          context.moveTo(x, y - 3.4);
          context.lineTo(x, y + 3.4);
          context.stroke();
        }
      }

      // One short, quiet shooting star every 28 seconds; none in reduced motion.
      const cycle = (time + 20) % 28;
      if (!motion.matches && cycle < 1.8) {
        const progress = cycle / 1.8;
        const alternate = Math.floor((time + 20) / 28) % 2;
        const x = width * (alternate ? 0.32 : 0.75) - progress * 180;
        const y = height * (alternate ? 0.16 : 0.27) + progress * 95;
        const alpha = Math.sin(progress * Math.PI) * 0.34;
        const tail = context.createLinearGradient(x, y, x + 80, y - 42);
        tail.addColorStop(0, `rgba(239, 226, 219, ${alpha})`);
        tail.addColorStop(1, "rgba(203, 211, 240, 0)");
        context.strokeStyle = tail;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 80, y - 42);
        context.stroke();
      }
    }

    function animate(now: number) {
      // Ambient motion needs only 24 fps; cap pixel density separately for mobile.
      if (now - lastFrame >= 1000 / 24) {
        elapsed += lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
        lastFrame = now;
        paint();
      }
      frame = requestAnimationFrame(animate);
    }

    function updateMotion() {
      cancelAnimationFrame(frame);
      lastFrame = 0;
      const paused = motion.matches || document.hidden || isMapActive();
      canvas!.dataset.motion = paused ? "still" : "animated";
      paint();
      if (!paused) frame = requestAnimationFrame(animate);
    }

    function resize() {
      if (!canvas || !context || !skyContext) return;
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.round(bounds.width);
      const nextHeight = Math.round(bounds.height);
      const nextRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight && ratio === nextRatio)) return;
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      for (const surface of [canvas, sky]) {
        surface.width = Math.round(width * ratio);
        surface.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      skyContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawSky();
      paint();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    updateMotion();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateMotion);
    window.addEventListener("resize", resize);
    window.addEventListener(MAP_ACTIVITY_EVENT, updateMotion);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateMotion);
      window.removeEventListener("resize", resize);
      window.removeEventListener(MAP_ACTIVITY_EVENT, updateMotion);
    };
  }, []);

  return <div className="starry-background" aria-hidden="true"><canvas ref={canvasRef} /></div>;
}
