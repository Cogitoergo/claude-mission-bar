import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Cache, Limit, Meter, Run, Task, TaskStatus } from '../types'
import {
  CACHE_POOR,
  CONTEXT_NOTE,
  CONTEXT_SWITCH,
  activeMsOf,
  adviceOf,
  cacheHitOf,
  contextLevelOf,
  etaMsOf,
  formatDuration,
  formatPercent,
  progressOf,
  spendOf,
} from './estimate'
import type { Spend } from './estimate'
import {
  PALETTE,
  SPINNER,
  gradientCells,
  levelColor,
  logoSvg,
  meterCells,
  pendingSvg,
  progressSvg,
  pulseSvg,
  ringSvg,
} from './graphics'

const PLUGIN = 'mission-bar'
/** How often the bar re-reads the usage figures while a turn runs. */
const TICK_MS = 15_000
/** How often the terminal's animation advances while a turn runs. */
const FRAME_MS = 250
/** Task rows the bar lists before folding the rest into a count. */
const MAX_TASK_ROWS = 3

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const tasksAtom = atom({ plugin: 'mission-bar', key: 'tasks' } as const, [], {
  shape: 'tasks-1',
})
const runAtom = atom({ plugin: 'mission-bar', key: 'run' } as const, null, {
  shape: 'run-1',
})
const meterAtom = atom({ plugin: 'mission-bar', key: 'meter' } as const, null, {
  shape: 'meter-1',
})
const cacheAtom = atom({ plugin: 'mission-bar', key: 'cache' } as const, null, {
  shape: 'cache-1',
})
const isHiddenAtom = atom({ plugin: 'mission-bar', key: 'isHidden' } as const, false)
const warnedAtom = atom({ plugin: 'mission-bar', key: 'warned' } as const, 0)
const frameAtom = atom({ plugin: 'mission-bar', key: 'frame' } as const, 0)

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function statusOf(value: unknown): TaskStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
    ? value
    : null
}

/** Reads the session's usage figures: no model request, nothing spent. */
async function measure($: EngineInterface): Promise<Meter> {
  const [usage, at] = await Promise.all([$.session.usage(), $.clock.now()])
  const limitOf = (kind: string): Limit | null => {
    const found = usage.rateLimits.find(limit => limit.kind === kind)

    return found === undefined
      ? null
      : { percentUsed: found.percentUsed, resetsAt: found.resetsAt ?? null }
  }

  return {
    at,
    contextPercent: usage.context.percent ?? null,
    contextTokens: usage.context.tokens ?? null,
    contextWindow: usage.context.window,
    fiveHour: limitOf('five_hour'),
    sevenDay: limitOf('seven_day'),
    costUsd: usage.cost?.usd ?? null,
  }
}

/** A window that reset mid-run counts from zero, not from its old fill. */
function rebased(base: Limit | null, now: Limit | null): Limit | null {
  return base !== null && now !== null && now.percentUsed < base.percentUsed
    ? { percentUsed: 0, resetsAt: now.resetsAt }
    : base
}

/** Takes a fresh reading, stores it (which redraws the bar) and returns it. */
async function refresh($: EngineInterface): Promise<Meter> {
  const meter = await measure($)

  await update($, runAtom, run => {
    if (run === null || run.endMeter !== null) {
      return run
    }

    const fiveHour = rebased(run.baseline.fiveHour, meter.fiveHour)
    const sevenDay = rebased(run.baseline.sevenDay, meter.sevenDay)

    return fiveHour === run.baseline.fiveHour && sevenDay === run.baseline.sevenDay
      ? run
      : { ...run, baseline: { ...run.baseline, fiveHour, sevenDay } }
  })
  await update($, meterAtom, () => meter)

  const level = contextLevelOf(meter.contextPercent)
  const warned = await read($, warnedAtom)

  if (level !== warned) {
    await update($, warnedAtom, () => level)

    if (level === 2 && warned < 2) {
      $.ui.toast(
        `Context is ${meter.contextPercent}% full: consider a new session after this step.`,
      )
    }
  }

  return meter
}

let timer: Timer | null = null
let frameTimer: Timer | null = null
// Each start and stop takes a new number, so a start that was still waiting
// when a stop came sets no timer.
let timerRun = 0

function stopTimer(): void {
  timerRun += 1
  timer?.cancel()
  timer = null
  frameTimer?.cancel()
  frameTimer = null
}

async function startTimer($: EngineInterface): Promise<void> {
  stopTimer()

  const mine = timerRun

  timer = $.clock.every(TICK_MS, () => {
    void refresh($).catch(() => undefined)
  })

  // Only a terminal is animated by redrawing: the apps animate their own
  // vector drawings, so no frames are spent where no terminal is attached.
  const surfaces = await $.session.surfaces()

  if (mine === timerRun && surfaces.includes('terminal')) {
    frameTimer = $.clock.every(FRAME_MS, () => {
      void update($, frameAtom, frame => (frame + 1) % 1_000_000).catch(() => undefined)
    })
  }
}

/** Opens a run when none is open, and settles the books when all is done. */
async function settle($: EngineInterface, hasCompleted: boolean): Promise<void> {
  const meter = await refresh($)
  const tasks = await read($, tasksAtom)
  const { total, open } = progressOf(tasks)

  await update($, runAtom, (run): Run | null => {
    if (total === 0) {
      return null
    }

    if (run === null || (run.endMeter !== null && open > 0)) {
      return {
        startedAt: meter.at,
        activeMs: 0,
        activeAtLastDone: 0,
        turnStartedAt: meter.at,
        baseline: meter,
        endMeter: null,
      }
    }

    if (run.endMeter !== null) {
      return run
    }

    const active = activeMsOf(run, meter.at)
    const next = hasCompleted ? { ...run, activeAtLastDone: active } : run

    return open === 0
      ? { ...next, activeMs: active, turnStartedAt: null, endMeter: meter }
      : next
  })
}

export const register: Register = on => {
  // Task calls of one model step can land together: they are applied in order.
  let queue: Promise<unknown> = Promise.resolve()

  const inOrder = <T,>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work, work)
    queue = result.catch(() => undefined)

    return result
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PLUGIN,
      description: 'Show or hide the mission bar above the prompt',
    })
    await refresh($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopTimer()

    if (String(e.reason) === 'clear') {
      await update($, tasksAtom, () => [])
      await update($, runAtom, () => null)
      await update($, cacheAtom, () => null)
      await update($, warnedAtom, () => 0)
    }

    return next(e)
  })

  on('command.run', { command: PLUGIN }, async $ => {
    const isHidden = !(await read($, isHiddenAtom))
    await update($, isHiddenAtom, () => isHidden)

    return { text: isHidden ? 'Mission bar hidden.' : 'Mission bar shown.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const meter = await refresh($)
      const hasOpen = progressOf(await read($, tasksAtom)).open > 0

      await update($, runAtom, run =>
        run !== null && run.endMeter === null && hasOpen && run.turnStartedAt === null
          ? { ...run, turnStartedAt: meter.at }
          : run,
      )
      await startTimer($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      stopTimer()

      const usage = e.usage

      if (usage !== undefined) {
        const cache: Cache = {
          read: usage.cache_read_input_tokens,
          written: usage.cache_creation_input_tokens,
          fresh: usage.input_tokens,
        }
        await update($, cacheAtom, () => cache)
      }

      const meter = await refresh($)

      await update($, runAtom, run =>
        run !== null && run.turnStartedAt !== null
          ? { ...run, activeMs: activeMsOf(run, meter.at), turnStartedAt: null }
          : run,
      )
    }

    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = fieldOf(ran.result, 'task')
    const id = textOf(fieldOf(task, 'id'))

    if (id === null) {
      return ran
    }

    const subject = textOf(fieldOf(task, 'subject')) ?? textOf(fieldOf(e, 'subject'))
    const created: Task = {
      id,
      subject: subject ?? `Task ${id}`,
      status: 'pending',
      activeForm: textOf(fieldOf(e, 'activeForm')),
    }

    await inOrder(async () => {
      const run = await read($, runAtom)
      const isNewRun = run === null || run.endMeter !== null

      // A new batch starts clean: the finished one's rows are not carried on.
      await update($, tasksAtom, list => [
        ...(isNewRun ? [] : list.filter(one => one.id !== id)),
        created,
      ])
      await settle($, false)
    })

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = textOf(fieldOf(e, 'taskId'))

    if (id === null || fieldOf(ran.result, 'success') !== true) {
      return ran
    }

    const rawStatus = fieldOf(e, 'status')
    const status = statusOf(rawStatus)
    const subject = textOf(fieldOf(e, 'subject'))
    const activeForm = textOf(fieldOf(e, 'activeForm'))

    await inOrder(async () => {
      let hasCompleted = false

      await update($, tasksAtom, list => {
        if (rawStatus === 'deleted') {
          return list.filter(one => one.id !== id)
        }

        const known = list.find(one => one.id === id)
        // A task made before the mod loaded is first seen here.
        const before: Task = known ?? {
          id,
          subject: `Task ${id}`,
          status: 'pending',
          activeForm: null,
        }
        const after: Task = {
          ...before,
          subject: subject ?? before.subject,
          status: status ?? before.status,
          activeForm: activeForm ?? before.activeForm,
        }
        hasCompleted = before.status !== 'completed' && after.status === 'completed'

        return known === undefined
          ? [...list, after]
          : list.map(one => (one.id === id ? after : one))
      })
      await settle($, hasCompleted)
    })

    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const todos = fieldOf(e, 'todos')

    if (!Array.isArray(todos) || 'deny' in ran && ran.deny !== undefined) {
      return ran
    }

    const listed: Task[] = todos.flatMap((todo: unknown, index): Task[] => {
      const subject = textOf(fieldOf(todo, 'content'))
      const status = statusOf(fieldOf(todo, 'status'))

      return subject === null || status === null
        ? []
        : [
            {
              id: `todo-${index}`,
              subject,
              status,
              activeForm: textOf(fieldOf(todo, 'activeForm')),
            },
          ]
    })

    await inOrder(async () => {
      const doneBefore = progressOf(await read($, tasksAtom)).done

      await update($, tasksAtom, () => listed)
      await settle($, progressOf(listed).done > doneBefore)
    })

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHiddenAtom))) {
      return next(e)
    }

    const meter = await read($, meterAtom)

    if (meter === null) {
      return next(e)
    }

    const [tasks, run, cache] = await Promise.all([
      read($, tasksAtom),
      read($, runAtom),
      read($, cacheAtom),
    ])

    // What the bar says, the same on every surface; how it is drawn follows.
    const columns = Math.max(24, e.props.bodyColumns)
    const isNarrow = columns < 64
    const progress = progressOf(tasks)
    const hasRun = run !== null && progress.total > 0
    const isDone = hasRun && progress.open === 0
    const isLive = hasRun && !isDone && e.props.isWorking
    const fraction = progress.total === 0 ? 0 : progress.done / progress.total
    const etaMs = hasRun ? etaMsOf(run, tasks, meter.at) : null
    const elapsed = hasRun ? formatDuration(activeMsOf(run, meter.at)) : ''
    const count = `${progress.done}/${progress.total}`
    const etaText = etaMs === null ? 'ETA after first task' : `ETA ~${formatDuration(etaMs)}`
    const doneText = `✔ all done in ${elapsed}`
    const shown = [...progress.current, ...progress.pending].slice(0, MAX_TASK_ROWS)
    const hiddenOpen = progress.open - shown.length
    const advice = adviceOf(meter, cache)
    const adviceColor = advice?.level === 2 ? PALETTE.bad : PALETTE.warn

    type Gauge = { key: string; label: string; percent: number; value: string; detail: string | null; color: string }

    const spendGauge = (key: string, label: string, spend: Spend | null): Gauge[] => {
      if (spend === null) {
        return []
      }

      const parts: string[] = []

      if (hasRun) {
        parts.push(`tasks +${formatPercent(spend.spent)}%`)

        if (!isDone && spend.toGo !== null) {
          parts.push(`~+${formatPercent(spend.toGo)}% to go`)
        }
      }

      return [
        {
          key,
          label,
          percent: spend.used,
          value: `${formatPercent(spend.used)}%`,
          detail: parts.length === 0 ? null : parts.join(' · '),
          color: levelColor(spend.used, 70, 90),
        },
      ]
    }

    const gauges: Gauge[] = [
      ...spendGauge('five', '5h', spendOf(one => one.fiveHour, hasRun ? run : null, meter, etaMs)),
      ...spendGauge('week', '7d', spendOf(one => one.sevenDay, hasRun ? run : null, meter, etaMs)),
    ]
    const costNow = (run?.endMeter ?? meter).costUsd
    const costBase = run?.baseline.costUsd ?? null
    const cost =
      gauges.length === 0 && costNow !== null
        ? hasRun && costBase !== null
          ? `cost $${costNow.toFixed(2)} · tasks +$${Math.max(0, costNow - costBase).toFixed(2)}`
          : `cost $${costNow.toFixed(2)}`
        : null

    if (meter.contextPercent !== null) {
      gauges.push({
        key: 'context',
        label: 'context',
        percent: meter.contextPercent,
        value: `${meter.contextPercent}%`,
        detail: null,
        color: levelColor(meter.contextPercent, CONTEXT_NOTE, CONTEXT_SWITCH),
      })
    }

    const cacheHit = cacheHitOf(cache)

    if (cacheHit !== null) {
      gauges.push({
        key: 'cache',
        label: 'cache',
        percent: cacheHit,
        value: `${cacheHit}%`,
        detail: null,
        // The cache is the one gauge where low is the bad end.
        color: cacheHit < CACHE_POOR ? PALETTE.warn : PALETTE.good,
      })
    }

    const hide = () => update($, isHiddenAtom, () => true)

    if (e.surface === 'terminal') {
      const { Box, Button, Text } = $.ui.resolve(e)
      const frame = isLive ? await read($, frameAtom) : null
      const bar = gradientCells(fraction, isNarrow ? 12 : 24, frame)
      const spinner = SPINNER[(frame ?? 0) % SPINNER.length] ?? '▶'

      return (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={advice?.level === 2 ? PALETTE.bad : PALETTE.from}
          paddingX={1}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1}>
              <Text color={PALETTE.accent} weight="bold">
                ◆ MISSION
              </Text>
              {hasRun ? (
                <Box flexDirection="row" gap={1}>
                  <Box flexDirection="row">
                    {bar.map(cell => (
                      <Text color={cell.color}>{cell.char}</Text>
                    ))}
                  </Box>
                  <Text weight="bold">{count}</Text>
                  {isDone ? (
                    <Text color={PALETTE.good} weight="bold">
                      {doneText}
                    </Text>
                  ) : (
                    <Text color={PALETTE.info} weight="bold">
                      {etaText}
                    </Text>
                  )}
                  {isDone || isNarrow ? null : <Text dimColor>elapsed {elapsed}</Text>}
                </Box>
              ) : (
                <Text dimColor>no tasks tracked yet</Text>
              )}
            </Box>
            <Button key="hide" label="hide" plain dimColor onPress={hide} />
          </Box>

          {isDone
            ? null
            : shown.map(task =>
                task.status === 'in_progress' ? (
                  <Box flexDirection="row" gap={1}>
                    <Text color={PALETTE.accent}>{isLive ? spinner : '▶'}</Text>
                    <Text weight="bold" wrap="truncate-end">
                      {task.activeForm ?? task.subject}
                    </Text>
                  </Box>
                ) : (
                  <Box flexDirection="row" gap={1}>
                    <Text color={PALETTE.track}>○</Text>
                    <Text dimColor wrap="truncate-end">
                      {task.subject}
                    </Text>
                  </Box>
                ),
              )}
          {!isDone && hiddenOpen > 0 ? <Text dimColor>  +{hiddenOpen} more to do</Text> : null}

          <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            {gauges.map(gauge => (
              <Box flexDirection="row" gap={1}>
                <Text weight="bold">{gauge.label}</Text>
                <Box flexDirection="row">
                  {meterCells(gauge.percent, 8, gauge.color).map(cell => (
                    <Text color={cell.color}>{cell.char}</Text>
                  ))}
                </Box>
                <Text color={gauge.color} weight="bold">
                  {gauge.value}
                </Text>
                {gauge.detail === null ? null : <Text dimColor>{gauge.detail}</Text>}
              </Box>
            ))}
            {cost === null ? null : <Text>{cost}</Text>}
          </Box>

          {advice === null ? null : (
            <Text color={adviceColor} wrap="wrap">
              ⚠ {advice.text}
            </Text>
          )}
        </Box>
      )
    }

    // The graphical surfaces: vector drawings beside native text, so the
    // words follow the app's theme and the animation costs no redraws.
    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    const barWidth = Math.max(120, Math.min(280, columns * 3))

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={advice?.level === 2 ? PALETTE.bad : PALETTE.trackSoft}
        paddingX="md"
        paddingY="sm"
        gap="sm"
      >
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
            <Svg source={logoSvg(16)} alt="" width={16} height={16} />
            <Text color={PALETTE.accent} size="caption" weight="bold">
              MISSION
            </Text>
            {hasRun ? (
              <Svg
                source={progressSvg({ width: barWidth, height: 10, fraction, isAnimated: isLive })}
                alt={`${count} tasks done`}
                width={barWidth}
                height={10}
                isInteractive={isLive}
              />
            ) : null}
            {hasRun ? (
              <Text weight="bold" tabular>
                {count}
              </Text>
            ) : (
              <Text dimColor>no tasks tracked yet</Text>
            )}
            {!hasRun ? null : isDone ? (
              <Text color={PALETTE.good} size="heading" weight="semibold">
                {doneText}
              </Text>
            ) : (
              <Text color={PALETTE.info} size="heading" weight="semibold" tabular>
                {etaText}
              </Text>
            )}
            {!hasRun || isDone || isNarrow ? null : (
              <Text dimColor size="caption" tabular>
                elapsed {elapsed}
              </Text>
            )}
          </Box>
          <Button key="hide" label="hide" plain dimColor onPress={hide} />
        </Box>

        {isDone || shown.length === 0 ? null : (
          <Box flexDirection="column" gap="xs">
            {shown.map(task =>
              task.status === 'in_progress' ? (
                <Box flexDirection="row" gap="sm" alignItems="center">
                  <Svg
                    source={isLive ? pulseSvg(14, PALETTE.accent) : ringSvg(14, 100, PALETTE.accent)}
                    alt="in progress"
                    width={14}
                    height={14}
                    isInteractive={isLive}
                  />
                  <Text weight="semibold" wrap="truncate-end">
                    {task.activeForm ?? task.subject}
                  </Text>
                </Box>
              ) : (
                <Box flexDirection="row" gap="sm" alignItems="center">
                  <Svg source={pendingSvg(14)} alt="to do" width={14} height={14} />
                  <Text dimColor wrap="truncate-end">
                    {task.subject}
                  </Text>
                </Box>
              ),
            )}
            {hiddenOpen > 0 ? (
              <Text dimColor size="caption">
                +{hiddenOpen} more to do
              </Text>
            ) : null}
          </Box>
        )}

        <Box flexDirection="row" flexWrap="wrap" gap="sm">
          {gauges.map(gauge => (
            <Box
              flexDirection="row"
              gap="xs"
              alignItems="center"
              backgroundColor={PALETTE.chip}
              paddingX="sm"
            >
              <Svg
                source={ringSvg(18, gauge.percent, gauge.color)}
                alt={`${gauge.label} ${gauge.value}`}
                width={18}
                height={18}
              />
              <Text size="caption" weight="semibold">
                {gauge.label}
              </Text>
              <Text color={gauge.color} weight="bold" tabular>
                {gauge.value}
              </Text>
              {gauge.detail === null ? null : (
                <Text dimColor size="caption" tabular>
                  {gauge.detail}
                </Text>
              )}
            </Box>
          ))}
          {cost === null ? null : <Text tabular>{cost}</Text>}
        </Box>

        {advice === null ? null : (
          <Text color={adviceColor} wrap="wrap">
            ⚠ {advice.text}
          </Text>
        )}
      </Box>
    )
  })
}
