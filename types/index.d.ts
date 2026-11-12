export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  status: TaskStatus
  /** The "doing it now" wording the task list gives an in-progress task. */
  activeForm: string | null
}

/** One rate-limit window as the last API response reported it. */
export type Limit = { percentUsed: number; resetsAt: string | null }

/** One reading of the session's free usage figures. */
export type Meter = {
  at: number
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  fiveHour: Limit | null
  sevenDay: Limit | null
  costUsd: number | null
}

/** One batch of tasks, from the first task created to the last one done. */
export type Run = {
  startedAt: number
  /** Working time folded in from finished turns, in milliseconds. */
  activeMs: number
  /** Working time on the clock when a task last completed. */
  activeAtLastDone: number
  /** When the running turn began; null between turns. */
  turnStartedAt: number | null
  /** The reading the run started from: what "spent on this task" counts from. */
  baseline: Meter
  /** The reading when the last task completed; null while tasks are open. */
  endMeter: Meter | null
}

/** One prompt of the person's, from its turn's start to its end. */
export type Prompt = {
  startedAt: number
  /** The reading the turn started from. */
  baseline: Meter
  /** The reading when the turn ended; null while it runs. */
  endMeter: Meter | null
}

/** Totals over the session's finished prompts: what an average is taken from. */
export type Pace = {
  prompts: number
  /** Percentage points the prompts added to the 5-hour window, summed. */
  fiveHour: number
  /** Percentage points the prompts added to the 7-day window, summed. */
  sevenDay: number
  activeMs: number
}

/** The prompt-cache split of the last finished turn, in tokens. */
export type Cache = { read: number; written: number; fresh: number }

declare module 'claude-code' {
  interface PluginState {
    'mission-bar': {
      tasks: Shaped<Task[]>
      run: Shaped<Run | null>
      meter: Shaped<Meter | null>
      cache: Shaped<Cache | null>
      prompt: Shaped<Prompt | null>
      pace: Shaped<Pace>
      isHidden: boolean
      warned: number
      /** The terminal animation's frame counter, advanced while a turn runs. */
      frame: number
    }
  }
}
