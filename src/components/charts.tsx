"use client";

import { useId, useState, type ReactNode } from "react";
import clsx from "clsx";

// Small, dependency-free SVG charts following the data-viz method: one axis per chart, thin marks with 4px rounded
// data-ends, hairline recessive grid, legend for ≥2 series plus direct end labels, hover tooltips on every mark, and a
// table view so nothing depends on color or hover alone. Palette slots 1–2 of the validated reference palette, with
// separate light and dark steps defined as theme tokens in globals.css (--color-series-*, --color-chart-*).

export const SERIES = ["var(--color-series-1)", "var(--color-series-2)"] as const;
const GRID = "var(--color-chart-grid)";
const TEXT_SOFT = "var(--color-chart-text)";
const CURSOR = "var(--color-chart-cursor)";
const SURFACE = "var(--color-surface)";

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
          {asTable ? "Show Chart" : "Show Table"}
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

/** Single-series column chart. Optional per-column reference marks (e.g. a prorated weekly target) in the same unit. */
export function ColumnChart({
  points,
  format,
  ariaLabel,
  reference,
  width = W,
}: {
  points: Point[];
  format: (v: number) => string;
  ariaLabel: string;
  reference?: { name: string; values: Array<number | null> };
  /** viewBox width: wider for full-width cards so text keeps its size. */
  width?: number;
}) {
  const W = width;
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const max = niceMax(Math.max(0, ...points.map((p) => p.value ?? 0), ...(reference?.values ?? []).map((v) => v ?? 0)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const band = iw / Math.max(1, points.length);
  const bw = Math.min(24, band * 0.55);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <defs>
          {/* One hue, deeper at the base: the gradient keeps the series identity. */}
          <linearGradient id={`col-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: SERIES[0], stopOpacity: 0.7 }} />
            <stop offset="1" style={{ stopColor: SERIES[0], stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} style={{ stroke: GRID }} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize={9} style={{ fill: TEXT_SOFT }}>
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
          const ref = reference?.values[i];
          return (
            <g key={p.label}>
              {h > 0 && (
                <path
                  d={`M${cx - bw / 2},${PAD.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${PAD.t + ih} Z`}
                  fill={`url(#col-${gid})`}
                  opacity={hover == null || hover === i ? 1 : 0.55}
                />
              )}
              {ref != null && (
                <line x1={cx - bw / 2 - 4} x2={cx + bw / 2 + 4} y1={y(ref)} y2={y(ref)} style={{ stroke: "var(--color-ink)" }} strokeWidth={2} strokeDasharray="3 2" strokeLinecap="round" />
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={9} style={{ fill: TEXT_SOFT }}>
                {p.label}
              </text>
              <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip
          x={(PAD.l + band * hover + band / 2) / W}
          title={points[hover]!.label}
          rows={[
            { name: reference ? "Value" : "", color: reference ? SERIES[0] : undefined, value: points[hover]!.value == null ? "—" : format(points[hover]!.value!) },
            ...(reference ? [{ name: reference.name, value: reference.values[hover] == null ? "—" : format(reference.values[hover]!) }] : []),
          ]}
        />
      )}
    </div>
  );
}

/** Horizontal bars for a ranked breakdown (categories, work types). Value labels sit at the end of each bar. */
export function BarList({ rows, format, ariaLabel }: { rows: Array<{ label: string; value: number }>; format: (v: number) => string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2.5" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-xs" onMouseEnter={() => setHover(i)}>
          <span className="truncate text-ink-soft" title={r.label}>
            {r.label}
          </span>
          <span className="h-2.5 rounded-full bg-surface-alt">
            <span
              className="block h-full rounded-full transition-opacity"
              style={{
                width: `${max > 0 ? Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100) : 0}%`,
                backgroundImage: `linear-gradient(90deg, color-mix(in oklab, ${SERIES[0]} 65%, transparent), ${SERIES[0]})`,
                opacity: hover == null || hover === i ? 1 : 0.55,
              }}
            />
          </span>
          <span className="tabular font-medium text-ink">{format(r.value)}</span>
        </div>
      ))}
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
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(max * f)} y2={y(max * f)} style={{ stroke: GRID }} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize={9} style={{ fill: TEXT_SOFT }}>
              {format(max * f)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={l} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} style={{ fill: TEXT_SOFT }}>
            {l}
          </text>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} style={{ stroke: CURSOR }} strokeWidth={1} />}
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
                <path key={`${id}-${si}-${k}`} d={d} fill="none" style={{ stroke: SERIES[si] }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {s.points.map((p, i) =>
                p.value == null ? null : (
                  <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} style={{ fill: SERIES[si], stroke: SURFACE }} strokeWidth={2} />
                ),
              )}
              {lastIdx >= 0 && (
                <text x={x(lastIdx) + 8} y={y(s.points[lastIdx]!.value!) + 3 + (si === 1 ? 9 : 0)} fontSize={9} style={{ fill: TEXT_SOFT }}>
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
