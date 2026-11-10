"use client";

import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  LogarithmicScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Tooltip, Legend);

export type Series = { label: string; color: string; x: number[]; y: number[] };

type Props = { series: Series[]; xLabel: string; yLabel: string; height?: number };

const AXIS = { color: "#94a3b8" };
const GRID = { color: "rgba(148,163,184,0.15)" };

/** Line chart of best-so-far values. Log scale when every value is positive. */
export default function ConvergenceChart({ series, xLabel, yLabel, height = 260 }: Props) {
  const positive = series.every((s) => s.y.every((v) => v > 0));
  return (
    <div style={{ height }}>
      <Line
        data={{
          datasets: series.map((s) => ({
            label: s.label,
            data: s.x.map((x, k) => ({ x, y: s.y[k] })),
            borderColor: s.color,
            backgroundColor: s.color,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.15,
          })),
        }}
        options={{
          animation: false,
          maintainAspectRatio: false,
          parsing: false,
          interaction: { mode: "nearest", axis: "x", intersect: false },
          plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
          scales: {
            x: { type: "linear", title: { display: true, text: xLabel, ...AXIS }, ticks: AXIS, grid: GRID },
            y: {
              type: positive ? "logarithmic" : "linear",
              title: { display: true, text: yLabel, ...AXIS },
              ticks: {
                ...AXIS,
                callback: (v) => {
                  const n = Number(v);
                  if (positive && !Number.isInteger(Math.log10(n))) return null; // decades only
                  return n !== 0 && (Math.abs(n) < 1e-2 || Math.abs(n) >= 1e4) ? n.toExponential(0) : n.toString();
                },
              },
              grid: GRID,
            },
          },
        }}
      />
    </div>
  );
}
