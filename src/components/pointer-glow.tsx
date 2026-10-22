"use client";

import { useEffect } from "react";

/**
 * Red Noir pointer lighting.
 * - A soft red glow follows the mouse and lights up the background grid.
 * - Cards and buttons under the pointer get a spotlight positioned at the cursor
 *   (CSS reads --mx / --my, set here on the hovered element only).
 * Off for touch screens and when the user prefers reduced motion.
 */
export function PointerGlow() {
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduce.matches) return;

    const root = document.documentElement;
    root.dataset.glow = "on";
    let raf = 0;
    let x = 0;
    let y = 0;
    let target: Element | null = null;

    const place = (el: HTMLElement | null) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${x - r.left}px`);
      el.style.setProperty("--my", `${y - r.top}px`);
    };

    const apply = () => {
      raf = 0;
      root.style.setProperty("--cursor-x", `${x}px`);
      root.style.setProperty("--cursor-y", `${y}px`);
      root.style.setProperty("--glow-opacity", "1");
      if (target instanceof Element) {
        place(target.closest<HTMLElement>(".rn-card"));
        place(target.closest<HTMLElement>(".rn-btn, .rn-nav-link"));
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      x = e.clientX;
      y = e.clientY;
      target = e.target as Element | null;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) root.style.setProperty("--glow-opacity", "0");
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseout", onOut);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseout", onOut);
      if (raf) cancelAnimationFrame(raf);
      delete root.dataset.glow;
    };
  }, []);

  return <div aria-hidden className="rn-cursor-glow" />;
}
