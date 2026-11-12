import type { Cache, Limit, Meter, Run, Task } from '../types'

/** Context fill, in percent, at which the bar first mentions it. */
export const CONTEXT_NOTE = 60
/** Context fill, in percent, at which the bar recommends a new session. */
export const CONTEXT_SWITCH = 80
/** A turn reusing less of its prompt from the cache than this is flagged. */
export const CACHE_POOR = 50
/** Below this context fill a cache miss is too cheap to mention. */
export const CACHE_MIN_CONTEXT = 30

export type Progress = {
  total: number
  done: number
  open: number
  current: Task[]
  pending: Task[]
}

export function progressOf(tasks: readonly Task[]): Progress {
  const current = tasks.filter(task => task.status === 'in_progress')
  const pending = tasks.filter(task => task.status === 'pending')
  const done = tasks.length - current.length - pending.length

  return { total: tasks.length, done, open: tasks.length - done, current, pending }
}

/** Working time of the run so far: finished turns plus the running one. */
export function activeMsOf(run: Run, now: number): number {
  const running = run.turnStartedAt === null ? 0 : Math.max(0, now - run.turnStartedAt)

  return run.activeMs + running
}

/**
 * Working time left, from the pace of the tasks already completed; null until
 * one task has completed, since there is no pace to go by before that.
 */
export function etaMsOf(run: Run, tasks: readonly Task[], now: number): number | null {
  const { done, open } = progressOf(tasks)

  if (open === 0) {
    return 0
  }

  if (done === 0 || run.activeAtLastDone <= 0) {
    return null
  }

  const perTask = run.activeAtLastDone / done
  const onCurrent = Math.max(0, activeMsOf(run, now) - run.activeAtLastDone)
  // A task that has outrun the average is taken to be nearly done, not free.
  const currentLeft = Math.max(perTask - onCurrent, perTask * 0.1)

  return perTask * (open - 1) + currentLeft
}

export type Spend = {
  /** The window's fill now, in percent. */
  used: number
  /** Percentage points this run has added to the window. */
  spent: number
  /** Percentage points the open tasks are expected to add; null if unknown. */
  toGo: number | null
}

export function spendOf(
  pick: (meter: Meter) => Limit | null,
  run: Run | null,
  meter: Meter,
  etaMs: number | null,
): Spend | null {
  const now = pick(run?.endMeter ?? meter)

  if (now === null) {
    return null
  }

  const base = run === null ? null : pick(run.baseline)

  if (run === null || base === null) {
    return { used: now.percentUsed, spent: 0, toGo: null }
  }

  const spent = Math.max(0, now.percentUsed - base.percentUsed)
  const active = activeMsOf(run, meter.at)
  const toGo = etaMs === null || active <= 0 ? null : (spent / active) * etaMs

  return { used: now.percentUsed, spent, toGo }
}

/** Share of the last turn's prompt the cache served, 0 to 100; null if empty. */
export function cacheHitOf(cache: Cache | null): number | null {
  if (cache === null) {
    return null
  }

  const total = cache.read + cache.written + cache.fresh

  return total <= 0 ? null : Math.round((cache.read / total) * 100)
}

export type Advice = { level: 1 | 2; text: string }

export function contextLevelOf(percent: number | null): 0 | 1 | 2 {
  if (percent === null || percent < CONTEXT_NOTE) {
    return 0
  }

  return percent >= CONTEXT_SWITCH ? 2 : 1
}

export function adviceOf(meter: Meter, cache: Cache | null): Advice | null {
  const percent = meter.contextPercent
  const level = contextLevelOf(percent)

  if (percent !== null && level === 2) {
    return {
      level: 2,
      text: `Context ${percent}% full: finish this step, then start a new session. Every message now re-sends a large context.`,
    }
  }

  if (percent !== null && level === 1) {
    return {
      level: 1,
      text: `Context ${percent}% full: plan a new session, or /compact, at the next natural break.`,
    }
  }

  const hit = cacheHitOf(cache)

  if (hit !== null && hit < CACHE_POOR && percent !== null && percent >= CACHE_MIN_CONTEXT) {
    return {
      level: 1,
      text: `Cache reused only ${hit}% of the last turn, so most of the context was paid for again. A new session costs less than a cold resume.`,
    }
  }

  return null
}

/** `45s`, `12m`, `1h 05m`, `2d 3h`: the two largest units that matter. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** A percentage with at most one decimal: `7`, `23.5`. */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10

  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** The filled and empty runs of a bar `width` cells wide. */
export function barOf(fraction: number, width: number): { filled: string; empty: string } {
  const cells = Math.max(0, Math.min(width, Math.round(fraction * width)))

  return { filled: '█'.repeat(cells), empty: '░'.repeat(width - cells) }
}
