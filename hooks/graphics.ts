/**
 * Colours and drawings. The palette is mid-toned on purpose: a mod cannot read
 * whether the surface is light or dark, so every colour has to hold on both.
 */
export const PALETTE = {
  accent: '#d97757',
  from: '#8b5cf6',
  mid: '#22d3ee',
  to: '#34d399',
  good: '#34d399',
  warn: '#f59e0b',
  bad: '#ef4444',
  info: '#38bdf8',
  track: '#6b7280',
  trackSoft: 'rgba(128,128,128,0.26)',
  chip: 'rgba(128,128,128,0.12)',
} as const

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
}

/** The colour `t` of the way from `a` to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const at = Math.max(0, Math.min(1, t))
  const part = (index: number): string =>
    Math.round(channel(a, index) + (channel(b, index) - channel(a, index)) * at)
      .toString(16)
      .padStart(2, '0')

  return `#${part(0)}${part(1)}${part(2)}`
}

/** The progress gradient at `t`, 0 to 1: violet, through cyan, to green. */
export function gradientAt(t: number): string {
  return t < 0.5
    ? mix(PALETTE.from, PALETTE.mid, t * 2)
    : mix(PALETTE.mid, PALETTE.to, (t - 0.5) * 2)
}

/** Green, amber or red for a fill that is fine, getting high, or too high. */
export function levelColor(percent: number, warnAt: number, badAt: number): string {
  if (percent >= badAt) {
    return PALETTE.bad
  }

  return percent >= warnAt ? PALETTE.warn : PALETTE.good
}

export type Cell = { char: string; color: string }

/**
 * A terminal progress bar, one coloured cell per column: the filled run takes
 * the gradient, and while `frame` is given a highlight sweeps across it.
 */
export function gradientCells(fraction: number, width: number, frame: number | null): Cell[] {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  const sweep = frame === null || filled === 0 ? -1 : frame % (filled + 6)

  return Array.from({ length: width }, (_, index): Cell => {
    if (index >= filled) {
      return { char: '━', color: PALETTE.track }
    }

    const base = gradientAt(width <= 1 ? 1 : index / (width - 1))
    const glow = index === sweep ? 0.7 : Math.abs(index - sweep) === 1 ? 0.35 : 0

    return { char: '━', color: glow === 0 ? base : mix(base, '#ffffff', glow) }
  })
}

/** A small terminal meter: `▰▰▰▱▱▱▱▱`. */
export function meterCells(percent: number, width: number, color: string): Cell[] {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return Array.from({ length: width }, (_, index): Cell =>
    index < filled ? { char: '▰', color } : { char: '▱', color: PALETTE.track },
  )
}

function svg(width: number, height: number, body: string): string {
  // The style keeps a sandboxed frame transparent on a dark page.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><style>:root{color-scheme:light dark}</style>${body}</svg>`
  )
}

/** The mark beside the title: a diamond in the accent colour. */
export function logoSvg(size: number): string {
  const half = size / 2
  const inset = size * 0.12

  return svg(
    size,
    size,
    `<defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#f0997a"/><stop offset="1" stop-color="${PALETTE.accent}"/>` +
      `</linearGradient></defs>` +
      `<path d="M${half} ${inset} L${size - inset} ${half} L${half} ${size - inset} L${inset} ${half} Z" fill="url(#l)"/>`,
  )
}

/**
 * The progress bar: a rounded track, a gradient fill, and while `isAnimated`
 * a soft highlight that sweeps the fill (SMIL: the surface animates it, the
 * mod redraws nothing).
 */
export function progressSvg(args: {
  width: number
  height: number
  fraction: number
  isAnimated: boolean
}): string {
  const { width, height, isAnimated } = args
  const fraction = Math.max(0, Math.min(1, args.fraction))
  const radius = height / 2
  const fill = fraction === 0 ? 0 : Math.max(height, width * fraction)
  const sweep = isAnimated && fill > 0
    ? `<rect x="${-width * 0.3}" y="0" width="${width * 0.3}" height="${height}" fill="url(#s)" clip-path="url(#c)">` +
      `<animate attributeName="x" from="${-width * 0.3}" to="${fill}" dur="1.8s" repeatCount="indefinite"/></rect>`
    : ''

  return svg(
    width,
    height,
    `<defs>` +
      `<linearGradient id="g" x1="0" y1="0" x2="${width}" y2="0" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${PALETTE.from}"/><stop offset="0.5" stop-color="${PALETTE.mid}"/>` +
      `<stop offset="1" stop-color="${PALETTE.to}"/></linearGradient>` +
      `<linearGradient id="s" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.55"/>` +
      `<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
      `<clipPath id="c"><rect width="${fill}" height="${height}" rx="${radius}"/></clipPath>` +
      `</defs>` +
      `<rect width="${width}" height="${height}" rx="${radius}" fill="${PALETTE.trackSoft}"/>` +
      `<rect width="${fill}" height="${height}" rx="${radius}" fill="url(#g)"/>` +
      sweep,
  )
}

/** A ring gauge: a faint track and an arc for `percent`, from twelve o'clock. */
export function ringSvg(size: number, percent: number, color: string): string {
  const stroke = Math.max(2, size * 0.16)
  const radius = (size - stroke) / 2
  const around = 2 * Math.PI * radius
  const arc = (Math.max(0, Math.min(100, percent)) / 100) * around
  const centre = size / 2

  return svg(
    size,
    size,
    `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="${PALETTE.trackSoft}" stroke-width="${stroke}"/>` +
      `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}" ` +
      `stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${around.toFixed(2)}" ` +
      `transform="rotate(-90 ${centre} ${centre})"/>`,
  )
}

/** The marker of the task in progress: a dot with a ring pulsing out of it. */
export function pulseSvg(size: number, color: string): string {
  const centre = size / 2

  return svg(
    size,
    size,
    `<circle cx="${centre}" cy="${centre}" r="${size * 0.22}" fill="none" stroke="${color}" stroke-width="1.5">` +
      `<animate attributeName="r" from="${size * 0.22}" to="${size * 0.48}" dur="1.4s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" from="0.9" to="0" dur="1.4s" repeatCount="indefinite"/></circle>` +
      `<circle cx="${centre}" cy="${centre}" r="${size * 0.22}" fill="${color}"/>`,
  )
}

/** The marker of a task not started: a hollow dot. */
export function pendingSvg(size: number): string {
  const centre = size / 2

  return svg(
    size,
    size,
    `<circle cx="${centre}" cy="${centre}" r="${size * 0.22}" fill="none" stroke="${PALETTE.track}" stroke-width="1.5"/>`,
  )
}
