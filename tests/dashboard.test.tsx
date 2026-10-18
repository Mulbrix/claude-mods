import { expect, mock, test } from 'claude-code/testing'

import { bar, fmt, sparkline } from '../hooks/register'

const PANE = { component: 'Pane', requestId: 'token-dashboard' } as const

test('formats counts and bars', () => {
  expect(fmt(950)).toBe('950')
  expect(fmt(12_345)).toBe('12k')
  expect(fmt(1_500_000)).toBe('1.50M')
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(sparkline([0, 10])).toBe('▁█')
})

test('a model response shows up in the dashboard', async ($, on) => {
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'hi',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 500,
      },
    }
  })
  mock.clock(on, { now: 1_000 })
  on('session.usage', async () => ({
    value: {
    startedAt: 0,
    context: { tokens: 9700, window: 200_000, percent: 5 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42 }],
    cost: { usd: 0.37 },
    },
  }))

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of stream) void _
  await stream.result

  const ui = await $.ui.mount({
    plugin: 'token-dashboard',
    surface: 'terminal',
    ...PANE,
    props: { title: 'Tokens', isFocused: false, bodyColumns: 80, placement: 'dock' },
  } as never)
  expect(await ui.find({ type: 'Text', text: /\$0\.37/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /10k\s+over 1 request$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'opus-5-5' })).toBeDefined()

  await ui.press({ key: 'Reset counters' })
  expect(await ui.find({ type: 'Text', text: 'No requests yet.' })).toBeDefined()
  await ui.unmount()
})
