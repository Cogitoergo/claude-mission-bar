/**
 * Colours and drawings. The palette is mid-toned on purpose: a mod cannot read
 * whether the surface is light or dark, so every colour has to hold on both.
 */
export const PALETTE = {
  accent: '#d97757',
  from: '#8b5cf6',
  mid: '#22d3ee',
  to: '#10b981',
  good: '#10b981',
  warn: '#f59e0b',
  bad: '#ef4444',
  info: '#38bdf8',
  track: '#6b7280',
  trackSoft: 'rgba(128,128,128,0.26)',
  chip: 'rgba(128,128,128,0.13)',
  chipEdge: 'rgba(128,128,128,0.22)',
  label: '#7c8496',
  detail: '#8b90a0',
  hull: '#e9ebf3',
  hullEdge: '#9aa0b4',
  flame: '#fbbf24',
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

function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const FONT = 'font-family="system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="12"'

/** A width to give a run of text; `textLength` then holds the font to it. */
function widthOf(text: string, isBold: boolean): number {
  return Math.ceil(text.length * (isBold ? 7.1 : 6.3))
}

/**
 * One gauge as a pill: a ring, the label, the value and an optional detail,
 * all in one drawing so its shape and spacing do not depend on the app.
 */
export function chipSvg(args: {
  label: string
  value: string
  detail: string | null
  percent: number
  color: string
}): { source: string; width: number; height: number } {
  const height = 26
  const ring = 16
  let x = 9
  const ringX = x

  x += ring + 7

  const label = { x, width: widthOf(args.label, true) }

  x += label.width + 6

  const value = { x, width: widthOf(args.value, true) }

  x += value.width

  const detail = args.detail === null ? null : { x: x + 8, width: widthOf(args.detail, false) }

  x = detail === null ? x : detail.x + detail.width

  const width = x + 12
  const stroke = 2.6
  const radius = (ring - stroke) / 2
  const around = 2 * Math.PI * radius
  const arc = (Math.max(0, Math.min(100, args.percent)) / 100) * around
  const cx = ringX + ring / 2
  const cy = height / 2
  const text = (at: { x: number; width: number }, words: string, fill: string, weight: number) =>
    `<text x="${at.x}" y="${cy + 4.2}" ${FONT} font-weight="${weight}" fill="${fill}" ` +
    `textLength="${at.width}" lengthAdjust="spacingAndGlyphs">${escaped(words)}</text>`

  return {
    width,
    height,
    source: svg(
      width,
      height,
      `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${(height - 1) / 2}" ` +
        `fill="${PALETTE.chip}" stroke="${PALETTE.chipEdge}"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${PALETTE.trackSoft}" stroke-width="${stroke}"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${args.color}" stroke-width="${stroke}" ` +
        `stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${around.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>` +
        text(label, args.label, PALETTE.label, 600) +
        text(value, args.value, args.color, 700) +
        (detail === null || args.detail === null ? '' : text(detail, args.detail, PALETTE.detail, 400)),
    ),
  }
}

export type MascotMood = 'flying' | 'parked' | 'landed'

/**
 * The mascot: a small rocket. Flying, its flame flickers and stars streak
 * past; parked, it bobs slowly; landed, it wears a green tick.
 */
export function mascotSvg(mood: MascotMood, size: number): string {
  const flame =
    mood === 'flying'
      ? `<path fill="${PALETTE.flame}" d="M15.4 24 Q18 34 20.6 24 Z">` +
        `<animate attributeName="d" dur="0.32s" repeatCount="indefinite" ` +
        `values="M15.4 24 Q18 34 20.6 24 Z;M15.4 24 Q18 28.5 20.6 24 Z;M15.4 24 Q18 34 20.6 24 Z"/></path>` +
        `<path fill="${PALETTE.bad}" d="M16.6 24 Q18 29 19.4 24 Z">` +
        `<animate attributeName="d" dur="0.26s" repeatCount="indefinite" ` +
        `values="M16.6 24 Q18 29 19.4 24 Z;M16.6 24 Q18 26 19.4 24 Z;M16.6 24 Q18 29 19.4 24 Z"/></path>`
      : ''
  const star = (x: number, y: number, begin: string): string =>
    `<circle cx="${x}" cy="${y}" r="1" fill="${PALETTE.hullEdge}" opacity="0">` +
    `<animate attributeName="opacity" values="0;1;0" dur="1.1s" begin="${begin}" repeatCount="indefinite"/>` +
    `<animateTransform attributeName="transform" type="translate" from="0 0" to="-9 9" dur="1.1s" begin="${begin}" repeatCount="indefinite"/></circle>`
  const stars =
    mood === 'flying' ? star(30, 6, '0s') + star(22, 3, '0.4s') + star(33, 15, '0.75s') : ''
  const bob =
    mood === 'landed'
      ? ''
      : `<animateTransform attributeName="transform" type="translate" dur="${mood === 'flying' ? '0.9s' : '3.2s'}" ` +
        `repeatCount="indefinite" values="0 0;0 -1.4;0 0"/>`
  const tick =
    mood === 'landed'
      ? `<circle cx="28" cy="28" r="6.5" fill="${PALETTE.good}"/>` +
        `<path d="M24.8 28.2 L27.2 30.6 L31.4 25.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
      : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">` +
    `<style>:root{color-scheme:light dark}</style>${stars}<g>${bob}` +
    `<g transform="rotate(45 18 18)">${flame}` +
    `<path d="M14 20 L9.6 26.4 L14.4 24.6 Z" fill="${PALETTE.accent}"/>` +
    `<path d="M22 20 L26.4 26.4 L21.6 24.6 Z" fill="${PALETTE.accent}"/>` +
    `<path d="M18 4.5 C23.2 9.6 24.2 17 22 24 L14 24 C11.8 17 12.8 9.6 18 4.5 Z" fill="${PALETTE.hull}" stroke="${PALETTE.hullEdge}" stroke-width="0.8"/>` +
    `<path d="M18 4.5 C20.6 7 22.1 9.8 22.9 12.6 L13.1 12.6 C13.9 9.8 15.4 7 18 4.5 Z" fill="${PALETTE.accent}"/>` +
    `<circle cx="18" cy="17" r="2.5" fill="${PALETTE.info}" stroke="#fff" stroke-width="0.8"/>` +
    `</g></g>${tick}</svg>`
  )
}
