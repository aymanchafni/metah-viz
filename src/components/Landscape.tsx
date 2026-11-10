"use client";

import { useEffect, useMemo, useRef } from "react";

import type { Grid, Problem } from "@/lib/api";
import { normaliser, viridis } from "@/lib/colormap";

type Props = {
  problem: Problem;
  grid: Grid | null;
  dims: [number, number];
  population: number[][];
  best: number[] | null;
  trail: number[][];
};

const SIZE = 560;

/** Heatmap of the objective (log colour scale) with the current population on top. */
export default function Landscape({ problem, grid, dims, population, best, trail }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [i, j] = dims;
  const [xlo, xhi] = problem.bounds[i];
  const [ylo, yhi] = problem.bounds[j];

  // Render the heatmap once per grid into an offscreen canvas.
  const heatmap = useMemo(() => {
    if (!grid || typeof document === "undefined") return null;
    const n = grid.x.length;
    const off = document.createElement("canvas");
    off.width = n;
    off.height = n;
    const ctx = off.getContext("2d")!;
    const img = ctx.createImageData(n, n);
    const norm = normaliser(grid.z.flat());
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const [R, G, B] = viridis(norm(grid.z[r][c]));
        const k = ((n - 1 - r) * n + c) * 4; // flip vertically: y grows upwards
        img.data[k] = R;
        img.data[k + 1] = G;
        img.data[k + 2] = B;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return off;
  }, [grid]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const px = (x: number) => ((x - xlo) / (xhi - xlo)) * SIZE;
    const py = (y: number) => SIZE - ((y - ylo) / (yhi - ylo)) * SIZE;

    ctx.clearRect(0, 0, SIZE, SIZE);
    if (heatmap) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(heatmap, 0, 0, SIZE, SIZE);
    } else {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    // path followed by the best-so-far solution
    if (trail.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      trail.forEach((p, k) => (k ? ctx.lineTo(px(p[i]), py(p[j])) : ctx.moveTo(px(p[i]), py(p[j]))));
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = "rgba(15,23,42,0.9)";
    ctx.lineWidth = 1;
    for (const p of population) {
      ctx.beginPath();
      ctx.arc(px(p[i]), py(p[j]), 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (best) {
      const x = px(best[i]);
      const y = py(best[j]);
      ctx.fillStyle = "#f43f5e";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 4 : 10;
        const a = (Math.PI / 5) * k - Math.PI / 2;
        if (k) ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
        else ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }, [heatmap, population, best, trail, i, j, xlo, xhi, ylo, yhi]);

  return (
    <figure className="relative">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="w-full max-w-[560px] aspect-square rounded-lg border border-slate-700"
        aria-label={`Objective landscape over ${problem.axis_labels[i]} and ${problem.axis_labels[j]}`}
      />
      <figcaption className="mt-2 flex justify-between text-xs text-slate-400 max-w-[560px]">
        <span>
          x: {problem.axis_labels[i]} [{xlo}, {xhi}]
        </span>
        <span>
          y: {problem.axis_labels[j]} [{ylo}, {yhi}]
        </span>
      </figcaption>
    </figure>
  );
}
