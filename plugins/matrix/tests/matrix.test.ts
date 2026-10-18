import { expect, test } from 'claude-code/testing'

const RUN = {
  command: 'matrix',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const band = (isWorking: boolean) =>
  ({
    plugin: 'matrix',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking,
      maxRows: 12,
      bodyColumns: 60,
      scroll: { offset: 0, bodyRows: 12 },
      view: {},
    },
  }) as const

test('the band rains on the terminal, taller while working', async $ => {
  const idle = await $.ui.mount(band(false))
  const idleRain = await idle.find({ key: 'rain' })
  expect(idleRain).toBeDefined()
  await idle.unmount()

  const busy = await $.ui.mount(band(true))
  expect(await busy.find({ key: 'rain' })).toBeDefined()
  await busy.unmount()
})

test('the user prompt reads as a shell line', async $ => {
  const ui = await $.ui.mount({
    plugin: 'matrix',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'hello', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(await ui.find({ type: 'Text', text: /neo@nebuchadnezzar/ })).toBeDefined()
  await ui.unmount()
})

test('/matrix toggles the look off and on', async $ => {
  const off = await $.command.run(RUN)
  expect(JSON.stringify(off)).toContain('blue pill')
  const on = await $.command.run(RUN)
  expect(JSON.stringify(on)).toContain('Welcome back')
})
