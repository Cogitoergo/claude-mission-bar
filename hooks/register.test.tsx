import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'mission-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const MINUTE = 60_000

test('progress, ETA, usage and context advice, on every surface', async ($, on) => {
  // Each hook here stands for the engine beneath the mod.
  let now = 1_000_000
  let fiveHour = 20
  let contextPercent = 40
  let created = 0

  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'mission-bar' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 80_000, window: 200_000, percent: contextPercent },
      rateLimits: [
        { kind: 'five_hour', percentUsed: fiveHour },
        { kind: 'seven_day', percentUsed: 50 },
      ],
      cost: { usd: 1 },
    },
  }))
  on('tool.call', (_, e) => {
    if (String(e.tool) === 'TaskCreate') {
      created += 1

      return { result: { task: { id: String(created), subject: `Step ${created}` } } }
    }

    return { result: { success: true, taskId: '1', updatedFields: ['status'] } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const subject of ['Step 1', 'Step 2', 'Step 3']) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: subject })
  }

  await $.tool.call({
    tool: 'TaskUpdate',
    taskId: '1',
    status: 'in_progress',
    activeForm: 'Doing step 1',
  })

  // Ten working minutes and four points of the 5-hour window per task.
  now += 10 * MINUTE
  fiveHour = 24
  contextPercent = 85
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /^1\/3$/ }))?.text).toBe('1/3')
    expect((await ui.find({ type: 'Text', text: /^ETA/ }))?.text).toBe('ETA ~20m')
    if (surface === 'terminal') {
      expect((await ui.find({ type: 'Text', text: /^24%$/ }))?.text).toBe('24%')
      expect((await ui.find({ type: 'Text', text: /to go/ }))?.text).toBe(
        'tasks +4% · ~+8% to go',
      )
    } else {
      // On the apps each gauge is one drawing, described by its alt text.
      const drawn = JSON.stringify(await ui.drawn())

      expect(drawn).toContain('5h 24% tasks +4% · ~+8% to go')
    }
    expect(await ui.find({ type: 'Text', text: /Step 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /new session/ })).toBeDefined()
    await ui.unmount()
  }

  // The apps get vector drawings; the terminal gets coloured cells.
  const app = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await app.find({ type: 'Svg' })).toBeDefined()
  await app.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await terminal.find({ type: 'Text', text: /^━$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^▰$/ })).toBeDefined()
  await terminal.unmount()

  now += 20 * MINUTE
  fiveHour = 32
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /all done/ }))?.text).toBe(
    '✔ all done in 30m',
  )
  expect((await ui.find({ type: 'Text', text: /^tasks/ }))?.text).toBe('tasks +12%')
  await ui.press({ key: 'hide' })
  await ui.unmount()
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('clock.now', () => ({ value: 1 }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, percent: 10 },
      rateLimits: [],
    },
  }))
  on('state.get', (_, e) =>
    e.key === 'tasks'
      ? { value: { value: [{ nope: true }], version: 1 } }
      : { value: { value: undefined, version: 0 } },
  )

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // No meter stored yet: the band is left to the engine, nothing thrown.
  expect(await ui.find({ type: 'Text', text: /MISSION/ })).toBeUndefined()
  await ui.unmount()
})

test('with no task list, the bar counts by prompt', async ($, on) => {
  let now = 1_000_000
  let fiveHour = 20

  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 20_000, window: 200_000, percent: 10 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: fiveHour },
        { kind: 'seven_day', percentUsed: 50 },
      ],
    },
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))

  await $.turn.start({ text: 'do it', turnId: 't1' })
  now += 2 * MINUTE
  fiveHour = 22
  await $.turn.complete({
    turnId: 't1',
    answer: 'done',
    durationMs: 2 * MINUTE,
    isAborted: false,
    reason: 'answer',
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /^last prompt took/ }))?.text).toBe(
      'last prompt took 2m',
    )
    expect(JSON.stringify(await ui.drawn())).toContain('last prompt +2% · avg +2%')
    expect((await ui.find({ type: 'Text', text: /prompts left/ }))?.text).toBe(
      '≈ 39 prompts left in 5h',
    )
    await ui.unmount()
  }
})

test('a whole-list tool such as update_plan is followed', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [] },
  }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'update_plan',
    plan: [
      { step: 'Find the project', status: 'completed' },
      { step: 'Run the tests', status: 'in_progress' },
      { step: 'Summarize', status: 'pending' },
    ],
    // Not one of this build's tools, so its name is outside the typed set.
  } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /^1\/3$/ }))?.text).toBe('1/3')
  expect(await ui.find({ type: 'Text', text: /Run the tests/ })).toBeDefined()
  await ui.unmount()

  // A later call that carries statuses alone changes the tasks already known.
  await $.tool.call({
    tool: 'update_plan',
    plan: [{ status: 'completed' }, { status: 'completed' }, { status: 'in_progress' }],
  } as never)

  const later = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await later.find({ type: 'Text', text: /^2\/3$/ }))?.text).toBe('2/3')
  await later.unmount()

  // The desktop app's `advance`: the task in progress is done, the next begins.
  await $.tool.call({ tool: 'update_plan', advance: true } as never)

  const done = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await done.find({ type: 'Text', text: /all done/ }))?.text).toMatch(/all done/)
  await done.unmount()
})

test('advance walks the plan, and wrap_up finishes the last task', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [] },
  }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'One', status: 'in_progress' },
      { content: 'Two', status: 'pending' },
      { content: 'Three', status: 'pending' },
    ],
  } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /^2\/3$/ }))?.text).toBe('2/3')
  expect(await ui.find({ type: 'Text', text: /Three/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' } as never)

  const done = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await done.find({ type: 'Text', text: /all done/ }))?.text).toMatch(/all done/)
  await done.unmount()
})
