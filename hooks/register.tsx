import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Cache, Limit, Meter, Pace, Prompt, Run, Task, TaskStatus } from '../types'
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
  gainOf,
  progressOf,
  promptSpendOf,
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
const promptAtom = atom({ plugin: 'mission-bar', key: 'prompt' } as const, null, {
  shape: 'prompt-1',
})
const NO_PACE: Pace = { prompts: 0, fiveHour: 0, sevenDay: 0, activeMs: 0 }
const paceAtom = atom({ plugin: 'mission-bar', key: 'pace' } as const, NO_PACE, {
  shape: 'pace-1',
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
  if (typeof value !== 'string') {
    return null
  }

  // Builds and apps spell the three states differently.
  const word = value.toLowerCase().replace(/[\s-]+/g, '_')

  if (['pending', 'todo', 'not_started', 'open', 'queued'].includes(word)) {
    return 'pending'
  }

  if (['in_progress', 'active', 'running', 'doing', 'started'].includes(word)) {
    return 'in_progress'
  }

  return ['completed', 'complete', 'done', 'finished'].includes(word) ? 'completed' : null
}

const LIST_FIELDS = ['todos', 'plan', 'steps', 'tasks', 'items']
const TEXT_FIELDS = ['content', 'subject', 'step', 'title', 'text', 'name', 'description']

/**
 * The whole task list, when a tool call carries one: `TodoWrite`'s `todos`,
 * `update_plan`'s `plan`, or any such list of entries with a status.
 */
function listOf(input: unknown): Task[] | null {
  for (const field of LIST_FIELDS) {
    const entries = fieldOf(input, field)

    if (!Array.isArray(entries)) {
      continue
    }

    const listed = entries.flatMap((entry: unknown, index): Task[] => {
      const status = statusOf(fieldOf(entry, 'status'))
      const subject = TEXT_FIELDS.map(name => textOf(fieldOf(entry, name))).find(
        text => text !== null,
      )

      return status === null || subject === undefined || subject === null
        ? []
        : [
            {
              id: `item-${index}`,
              subject,
              status,
              activeForm: textOf(fieldOf(entry, 'activeForm')),
            },
          ]
    })

    if (listed.length > 0 || entries.length === 0) {
      return listed
    }
  }

  return null
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

/** Tool names seen since the mod loaded, with counts: for `/mission-bar debug`. */
const seenTools = new Map<string, number>()
const MAX_SEEN_TOOLS = 40

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
      description: 'Show or hide the mission bar; "debug" prints diagnostics',
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
      await update($, promptAtom, () => null)
      await update($, paceAtom, () => NO_PACE)
      await update($, warnedAtom, () => 0)
    }

    return next(e)
  })

  on('command.run', { command: PLUGIN }, async ($, e) => {
    if (e.args.trim() === 'debug') {
      const [version, surfaces, tasks, run, meter] = await Promise.all([
        $.session.version(),
        $.session.surfaces(),
        read($, tasksAtom),
        read($, runAtom),
        read($, meterAtom),
      ])
      const tools = [...seenTools].map(([tool, count]) => `${tool} x${count}`)

      return {
        text: [
          'mission-bar diagnostics',
          `Claude Code: ${version.version}`,
          `surfaces: ${surfaces.join(', ') || 'none'}`,
          `tasks tracked: ${tasks.length} (${tasks.map(task => task.status).join(', ') || 'none'})`,
          `run: ${run === null ? 'none' : run.endMeter === null ? 'open' : 'finished'}`,
          `usage windows: ${meter?.fiveHour ? '5h' : 'no 5h'}, ${meter?.sevenDay ? '7d' : 'no 7d'}`,
          `tools seen since load: ${tools.join(', ') || 'none'}`,
        ].join('\n'),
      }
    }

    const isHidden = !(await read($, isHiddenAtom))
    await update($, isHiddenAtom, () => isHidden)

    return { text: isHidden ? 'Mission bar hidden.' : 'Mission bar shown.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const meter = await refresh($)
      const hasOpen = progressOf(await read($, tasksAtom)).open > 0
      const prompt: Prompt = { startedAt: meter.at, baseline: meter, endMeter: null }

      await update($, promptAtom, () => prompt)

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

      const prompt = await read($, promptAtom)

      if (prompt !== null && prompt.endMeter === null) {
        await update($, promptAtom, () => ({ ...prompt, endMeter: meter }))
        await update($, paceAtom, pace => ({
          prompts: pace.prompts + 1,
          fiveHour: pace.fiveHour + (gainOf(one => one.fiveHour, prompt.baseline, meter) ?? 0),
          sevenDay: pace.sevenDay + (gainOf(one => one.sevenDay, prompt.baseline, meter) ?? 0),
          activeMs: pace.activeMs + Math.max(0, meter.at - prompt.startedAt),
        }))
      }

      await update($, runAtom, run =>
        run !== null && run.turnStartedAt !== null
          ? { ...run, activeMs: activeMsOf(run, meter.at), turnStartedAt: null }
          : run,
      )
    }

    return next(e)
  })

  // One hook sees every tool call, lets it run untouched, and records the
  // ones that change the task list. Names are matched loosely, so a build
  // that spells its task tools differently is still followed.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const name = String(e.tool)
    const base = name.split('__').pop() ?? name

    seenTools.set(name, (seenTools.get(name) ?? 0) + 1)

    if (seenTools.size > MAX_SEEN_TOOLS) {
      const oldest = seenTools.keys().next().value

      if (oldest !== undefined) {
        seenTools.delete(oldest)
      }
    }

    const hasFailed =
      ('deny' in ran && ran.deny !== undefined) ||
      fieldOf(ran, 'isError') === true ||
      fieldOf(ran.result, 'success') === false
    const isTaskish = /task|todo|plan/i.test(base)
    const listed = isTaskish || fieldOf(e, 'todos') !== undefined ? listOf(e) : null

    if (hasFailed || !(isTaskish || listed !== null)) {
      return ran
    }

    if (listed !== null) {
      await inOrder(async () => {
        const doneBefore = progressOf(await read($, tasksAtom)).done

        await update($, tasksAtom, () => listed)
        await settle($, progressOf(listed).done > doneBefore)
      })

      return ran
    }

    const resultText = textOf(fieldOf(ran, 'text')) ?? textOf(ran.result) ?? ''

    if (/create/i.test(base)) {
      const task = fieldOf(ran.result, 'task')
      const subject =
        textOf(fieldOf(task, 'subject')) ??
        textOf(fieldOf(e, 'subject')) ??
        textOf(fieldOf(e, 'content'))
      const activeForm = textOf(fieldOf(e, 'activeForm'))

      await inOrder(async () => {
        const run = await read($, runAtom)
        const isNewRun = run === null || run.endMeter !== null

        await update($, tasksAtom, list => {
          const kept = isNewRun ? [] : list
          // The id comes from the result; failing that from its text
          // ("Task #3 created"); failing that it is the next number.
          const id =
            textOf(fieldOf(task, 'id')) ??
            textOf(fieldOf(ran.result, 'id')) ??
            /#(\d+)/.exec(resultText)?.[1] ??
            String(kept.reduce((most, one) => Math.max(most, Number(one.id) || 0), 0) + 1)
          const created: Task = {
            id,
            subject: subject ?? `Task ${id}`,
            status: 'pending',
            activeForm,
          }

          // A new batch starts clean: the finished one's rows are not carried on.
          return [...kept.filter(one => one.id !== id), created]
        })
        await settle($, false)
      })

      return ran
    }

    if (/update/i.test(base)) {
      const id =
        textOf(fieldOf(e, 'taskId')) ?? textOf(fieldOf(e, 'task_id')) ?? textOf(fieldOf(e, 'id'))

      if (id === null) {
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
    }

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

    const [tasks, run, cache, prompt, pace] = await Promise.all([
      read($, tasksAtom),
      read($, runAtom),
      read($, cacheAtom),
      read($, promptAtom),
      read($, paceAtom),
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

    // With no task list, a prompt is the unit: what this one cost, what one
    // costs on average, and how many more the 5-hour window has room for.
    const fivePrompt = promptSpendOf(one => one.fiveHour, pace.fiveHour, prompt, pace, meter)
    const weekPrompt = promptSpendOf(one => one.sevenDay, pace.sevenDay, prompt, pace, meter)
    const promptMs =
      prompt === null ? null : Math.max(0, (prompt.endMeter ?? meter).at - prompt.startedAt)
    const idleText =
      prompt === null || promptMs === null
        ? 'waiting for the first prompt'
        : prompt.endMeter === null
          ? `working ${formatDuration(promptMs)}`
          : `last prompt took ${formatDuration(promptMs)}`
    const leftText =
      fivePrompt.left === null ? null : `≈ ${fivePrompt.left} prompts left in 5h`

    const spendGauge = (
      key: string,
      label: string,
      spend: Spend | null,
      perPrompt: typeof fivePrompt,
    ): Gauge[] => {
      if (spend === null) {
        return []
      }

      const parts: string[] = []

      if (!hasRun) {
        if (perPrompt.prompt !== null) {
          parts.push(
            `${perPrompt.isRunning ? 'this' : 'last'} prompt +${formatPercent(perPrompt.prompt)}%`,
          )
        }

        if (perPrompt.average !== null) {
          parts.push(`avg +${formatPercent(perPrompt.average)}%`)
        }
      }

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
      ...spendGauge('five', '5h', spendOf(one => one.fiveHour, hasRun ? run : null, meter, etaMs), fivePrompt),
      ...spendGauge('week', '7d', spendOf(one => one.sevenDay, hasRun ? run : null, meter, etaMs), weekPrompt),
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
                <Box flexDirection="row" gap={1}>
                  <Text weight="bold">{idleText}</Text>
                  {leftText === null ? null : <Text color={PALETTE.info}>{leftText}</Text>}
                </Box>
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
              <Text weight="semibold">{idleText}</Text>
            )}
            {hasRun || leftText === null ? null : (
              <Text color={PALETTE.info} weight="semibold" tabular>
                {leftText}
              </Text>
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
