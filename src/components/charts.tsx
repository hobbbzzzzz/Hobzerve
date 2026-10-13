"use client";

import { useId, useState, type ReactNode } from "react";
import clsx from "clsx";

// Small, dependency-free SVG charts following the data-viz method: one axis per chart, thin marks with 4px rounded
// data-ends, hairline recessive grid, legend for ≥2 series plus direct end labels, hover tooltips on every mark, and a
// table view so nothing depends on color or hover alone. Palette slots validated (light): #2a78d6, #eb6834.

export const SERIES = ["#2a78d6", "#eb6834"] as const;
const GRID = "#e9edf5";
const TEXT_SOFT = "#5b677a";

export interface Point {
  label: string;
  value: number | null;
}

export interface Series {
  name: string;
  points: Point[];
}

function niceMax(max: number, fixed?: number): number {
  if (fixed != null) return fixed;
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function ChartCard({
  title,
  subtitle,
  table,
  legend,
  children,
}: {
  title: string;
  subtitle?: string;
  table: { headers: string[]; rows: Array<Array<string>> };
  legend?: Array<{ name: string; color: string }>;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <figcaption>
          <p className="text-sm font-semibold">{title}</p>
          {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
        </figcaption>
        <button type="button" onClick={() => setAsTable((x) => !x)} className="shrink-0 text-xs font-medium text-primary-strong hover:underline" aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>
      {legend && legend.length > 1 && !asTable && (
        <ul className="flex flex-wrap gap-3 text-xs text-ink-soft">
          {legend.map((l) => (
            <li key={l.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: l.color }} aria-hidden />
              {l.name}
            </li>
          ))}
        </ul>
      )}
      {asTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-soft">
              {table.headers.map((h, i) => (
                <th key={h} className={clsx("pb-1 font-medium", i > 0 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {table.rows.map((r) => (
              <tr key={r[0]} className="border-t border-line">
                {r.map((c, i) => (
                  <td key={i} className={clsx("py-1.5", i > 0 && "text-right")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </figure>
  );
}

const W = 320;
const H = 160;
const PAD = { l: 34, r: 12, t: 10, b: 22 };

/** Single-series column chart. */
export function ColumnChart({ points, format, ariaLabel }: { points: Point[]; format: (v: number) => string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const band = iw / Math.max(1, points.length);
  const bw = Math.min(24, band * 0.55);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize={9} fill={TEXT_SOFT}>
              {format(max * f)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = PAD.l + band * i + band / 2;
          const v = p.value ?? 0;
          const top = y(v);
          const h = PAD.t + ih - top;
          const r = Math.min(4, h, bw / 2);
          return (
            <g key={p.label}>
              {h > 0 && (
                <path
                  d={`M${cx - bw / 2},${PAD.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${PAD.t + ih} Z`}
                  fill={SERIES[0]}
                  opacity={hover == null || hover === i ? 1 : 0.55}
                />
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={9} fill={TEXT_SOFT}>
                {p.label}
              </text>
              <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip x={(PAD.l + band * hover + band / 2) / W} title={points[hover]!.label} rows={[{ name: "", value: points[hover]!.value == null ? "—" : format(points[hover]!.value!) }]} />
      )}
    </div>
  );
}

/** Multi-series line chart on one shared axis (e.g. two percentages). */
export function LineChart({ series, format, ariaLabel, fixedMax }: { series: Series[]; format: (v: number) => string; ariaLabel: string; fixedMax?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value ?? 0))), fixedMax);
  const iw = W - PAD.l - PAD.r - 34;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (labels.length <= 1 ? iw / 2 : (iw * i) / (labels.length - 1));
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize={9} fill={TEXT_SOFT}>
              {format(max * f)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={l} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill={TEXT_SOFT}>
            {l}
          </text>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="#c9d1e0" strokeWidth={1} />}
        {series.map((s, si) => {
          // Gaps where a month has no value (nothing eligible) instead of drawing through zero.
          const segs: string[] = [];
          let cur = "";
          s.points.forEach((p, i) => {
            if (p.value == null) {
              if (cur) segs.push(cur);
              cur = "";
            } else cur += `${cur ? "L" : "M"}${x(i)},${y(p.value)} `;
          });
          if (cur) segs.push(cur);
          const lastIdx = s.points.reduce((acc, p, i) => (p.value != null ? i : acc), -1);
          return (
            <g key={s.name} aria-hidden>
              {segs.map((d, k) => (
                <path key={`${id}-${si}-${k}`} d={d} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {s.points.map((p, i) =>
                p.value == null ? null : (
                  <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} fill={SERIES[si]} stroke="#ffffff" strokeWidth={2} />
                ),
              )}
              {lastIdx >= 0 && (
                <text x={x(lastIdx) + 8} y={y(s.points[lastIdx]!.value!) + 3 + (si === 1 ? 9 : 0)} fontSize={9} fill={TEXT_SOFT}>
                  {format(s.points[lastIdx]!.value!)}
                </text>
              )}
            </g>
          );
        })}
        {labels.map((l, i) => (
          <rect
            key={`hit-${l}`}
            x={x(i) - (labels.length > 1 ? iw / (labels.length - 1) / 2 : iw / 2)}
            y={PAD.t}
            width={labels.length > 1 ? iw / (labels.length - 1) : iw}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover != null && (
        <Tooltip
          x={x(hover) / W}
          title={labels[hover]!}
          rows={series.map((s, si) => ({ name: s.name, color: SERIES[si], value: s.points[hover]!.value == null ? "—" : format(s.points[hover]!.value!) }))}
        />
      )}
    </div>
  );
}

function Tooltip({ x, title, rows }: { x: number; title: string; rows: Array<{ name: string; value: string; color?: string }> }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-xs shadow-[var(--shadow-lift)]"
      style={{ left: `${Math.min(80, Math.max(5, x * 100))}%`, transform: "translateX(-50%)" }}
      role="status"
    >
      <p className="font-semibold">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="tabular flex items-center gap-1.5 text-ink-soft">
          {r.color && <span className="inline-block size-2 rounded-full" style={{ background: r.color }} aria-hidden />}
          {r.name && <span>{r.name}:</span>}
          <span className="font-medium text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
