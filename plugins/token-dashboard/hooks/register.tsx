import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { Step, Tokens, Usage } from '../types'

const PANE = 'token-dashboard'
const MAX_STEPS = 500
const SPARK = '▁▂▃▄▅▆▇█'

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const empty = (): Usage => ({
  total: zero(),
  requests: 0,
  byModel: {},
  main: zero(),
  agents: zero(),
  steps: [],
})

const usage = atom({ plugin: 'token-dashboard', key: 'usage' } as const, empty())

const add = <T extends Tokens>(a: T, b: Tokens): T => ({
  ...a,
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

const fromApi = (u: TurnUsage): Tokens => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

const sum = (t: Tokens) => t.input + t.output + t.cacheRead + t.cacheWrite

export const record = (prev: Usage, step: Step): Usage => {
  const model = prev.byModel[step.model] ?? { ...zero(), requests: 0 }
  return {
    total: add(prev.total, step),
    requests: prev.requests + 1,
    byModel: { ...prev.byModel, [step.model]: { ...add(model, step), requests: model.requests + 1 } },
    main: step.isAgent ? prev.main : add(prev.main, step),
    agents: step.isAgent ? add(prev.agents, step) : prev.agents,
    steps: [...prev.steps, step].slice(-MAX_STEPS),
  }
}

export const fmt = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`
}

export const bar = (pct: number, width: number): string => {
  const w = Math.max(4, width)
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w)
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

export const sparkline = (values: number[]): string => {
  const max = Math.max(1, ...values)
  return values.map(v => SPARK[Math.min(SPARK.length - 1, Math.floor((v / max) * (SPARK.length - 1)))]).join('')
}

const pctColor = (pct: number) => (pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success')

const shortModel = (id: string) => id.replace(/^claude-/, '').replace(/-\d{8}$/, '')

const LIMIT_LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'Spend' }

const resetsIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  return mins >= 60 * 24
    ? `resets in ${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
    : `resets in ${Math.floor(mins / 60)}h ${mins % 60}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Open the token usage dashboard',
    })

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tokens', focus: true })

    return { text: 'Token dashboard opened.' }
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (result.usage) {
      const u = result.usage
      const step: Step = { ...fromApi(u), at: await $.clock.now(), model: u.model, isAgent: e.agentId !== undefined }
      await update($, usage, prev => record(prev, step))
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const u = await read($, usage)
    const session = await $.session.usage()
    const now = await $.clock.now()
    const cols = Math.max(30, e.props.bodyColumns)
    const barWidth = Math.min(40, cols - 22)

    const ctx = session.context
    const inputSide = u.total.input + u.total.cacheRead + u.total.cacheWrite
    const hitRate = inputSide === 0 ? 0 : Math.round((u.total.cacheRead / inputSide) * 100)
    const spark = sparkline(u.steps.slice(-Math.max(8, cols - 4)).map(sum))
    const models = Object.entries(u.byModel).sort((a, b) => sum(b[1]) - sum(a[1]))

    const row = (label: string, value: string, color?: string) => (
      <Box>
        <Box width={12}><Text dimColor>{label}</Text></Box>
        <Text color={color} bold>{value}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="claude">Token usage</Text>
          <Text bold color="success">{session.cost ? `$${session.cost.usd.toFixed(2)}` : ''}</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          {row('Total', `${fmt(sum(u.total))}  over ${u.requests} request${u.requests === 1 ? '' : 's'}`)}
          {row('Input', fmt(u.total.input))}
          {row('Output', fmt(u.total.output))}
          {row('Cache read', fmt(u.total.cacheRead))}
          {row('Cache write', fmt(u.total.cacheWrite))}
          {row('Cache hit', `${hitRate}%`, hitRate >= 70 ? 'success' : hitRate >= 40 ? 'warning' : 'error')}
          {u.agents.output + u.agents.input > 0 &&
            row('Subagents', `${fmt(sum(u.agents))}  (main ${fmt(sum(u.main))})`)}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Limits</Text>
          <Box>
            <Box width={12}><Text dimColor>Context</Text></Box>
            {ctx.percent === undefined ? (
              <Text dimColor>no response yet · {fmt(ctx.window)} window</Text>
            ) : (
              <Text>
                <Text color={pctColor(ctx.percent)}>{bar(ctx.percent, barWidth)}</Text> {ctx.percent}%{' '}
                <Text dimColor>{fmt(ctx.tokens ?? 0)}/{fmt(ctx.window)}</Text>
              </Text>
            )}
          </Box>
          {session.rateLimits.map(rl => (
            <Box>
              <Box width={12}><Text dimColor>{LIMIT_LABELS[rl.kind] ?? rl.kind}</Text></Box>
              <Text>
                <Text color={pctColor(rl.percentUsed)}>{bar(rl.percentUsed, barWidth)}</Text> {rl.percentUsed}%{' '}
                <Text dimColor>{resetsIn(rl.resetsAt, now)}</Text>
              </Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Per request <Text dimColor>(last {Math.min(u.steps.length, cols - 4)})</Text></Text>
          {u.steps.length === 0 ? <Text dimColor>No requests yet.</Text> : <Text color="claude">{spark}</Text>}
          {u.steps.length > 0 && (
            <Text dimColor>
              last {fmt(sum(u.steps[u.steps.length - 1] ?? zero()))} · peak {fmt(Math.max(...u.steps.map(sum)))} · avg{' '}
              {fmt(Math.round(sum(u.total) / Math.max(1, u.requests)))}
            </Text>
          )}
        </Box>

        {models.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>By model</Text>
            {models.map(([id, m]) => (
              <Box>
                <Box width={Math.min(24, cols - 30)}><Text>{shortModel(id)}</Text></Box>
                <Text dimColor>
                  in {fmt(m.input + m.cacheRead + m.cacheWrite).padStart(6)}  out {fmt(m.output).padStart(6)}  ×{m.requests}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={1}>
          <Button hotkey="r" plain dimColor onPress={async () => { await update($, usage, () => empty()) }}>
            Reset counters
          </Button>
        </Box>
      </Box>
    )
  })
}
