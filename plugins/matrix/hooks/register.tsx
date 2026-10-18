import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isOn = atom({ plugin: 'matrix', key: 'isOn' } as const, true)

const GREEN = '#00ff41'
const DIM_GREEN = '#008f11'
const BLACK = 0x000000
const HEAD = 0xd8ffd8
const DEFAULT = 0x01000000

// Halfwidth katakana, digits and a few symbols: every one a single cell wide.
const GLYPHS: number[] = []
for (let c = 0xff66; c <= 0xff9d; c++) GLYPHS.push(c)
for (const ch of '0123456789Z:."=*+-<>|') GLYPHS.push(ch.charCodeAt(0))

const INTRO = [
  'Wake up, Neo...',
  'The Matrix has you...',
  'Follow the white rabbit.',
  'Knock, knock, Neo.',
]

const SPINNER_WORDS = [
  'Following the white rabbit',
  'Jacking in',
  'Bending the spoon',
  'Dodging bullets',
  'Downloading kung fu',
  'Decoding the Matrix',
  'Tracing the call',
  'Hacking the mainframe',
  'Searching for the Oracle',
  'Taking the red pill',
  'Rewriting the code',
  'Evading Agents',
]

const DONE_WORDS = [
  'Jacked out after',
  'Decoded in',
  'Escaped the Agents in',
  'Bent the spoon in',
  'Rebooted reality in',
  'Freed your mind in',
]

const pick = (list: string[], seed: string) => {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return list[Math.abs(hash) % list.length]!
}

const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const toBase64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

const fade = (t: number) => {
  // t: 0 at the head, 1 at the tail's end.
  const g = Math.round(255 - t * 210)
  const r = Math.round(Math.max(0, 40 - t * 60))

  return (r << 16) | (g << 8) | Math.round(Math.max(0, 65 - t * 80))
}

type Drop = { head: number; speed: number; length: number }

/** The digital rain: a grid of glyphs and one falling drop per column. */
class Rain {
  columns = 0
  rows = 0
  glyphs = new Uint32Array(0)
  drops: Drop[] = []
  frame = 0

  resize(columns: number, rows: number) {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.glyphs = Uint32Array.from({ length: columns * rows }, randomGlyph)
    this.drops = Array.from({ length: columns }, () => this.newDrop(true))
  }

  newDrop(anywhere: boolean): Drop {
    const length = 3 + Math.floor(Math.random() * Math.max(4, this.rows * 1.5))

    return {
      head: anywhere ? Math.random() * (this.rows + length) : -Math.random() * this.rows * 2,
      speed: 0.15 + Math.random() * 0.45,
      length,
    }
  }

  step() {
    this.frame += 1
    for (let c = 0; c < this.columns; c++) {
      const drop = this.drops[c]!
      drop.head += drop.speed
      if (drop.head - drop.length > this.rows) this.drops[c] = this.newDrop(false)
    }
    for (let i = 0; i < this.glyphs.length; i++) {
      if (Math.random() < 0.03) this.glyphs[i] = randomGlyph()
    }
  }

  /** The current frame as Raster cells, with an optional line of text overlaid. */
  cells(message?: string) {
    const words = new Uint32Array(this.columns * this.rows * 3)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        const i = r * this.columns + c
        const drop = this.drops[c]!
        const d = drop.head - r
        let glyph = 0x20
        let fg = DEFAULT
        if (d >= 0 && d < 1) {
          glyph = this.glyphs[i]!
          fg = HEAD
        } else if (d >= 1 && d < drop.length) {
          glyph = this.glyphs[i]!
          fg = fade(d / drop.length)
        }
        words[i * 3] = glyph
        words[i * 3 + 1] = fg
        words[i * 3 + 2] = BLACK
      }
    }
    if (message) {
      const row = Math.floor((this.rows - 1) / 2)
      const start = Math.max(0, Math.floor((this.columns - message.length) / 2) - 1)
      const padded = ` ${message} `.slice(0, this.columns)
      for (let k = 0; k < padded.length; k++) {
        const i = row * this.columns + start + k
        words[i * 3] = padded.charCodeAt(k)
        words[i * 3 + 1] = 0x00ff41
        words[i * 3 + 2] = BLACK
      }
    }

    return toBase64(new Uint8Array(words.buffer))
  }
}

/** Light markdown flattening so prose can be drawn as one green Text. */
const flatten = (text: string) =>
  text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 <$2>')

const isPlainProse = (text: string) => !/^\s*(```|~~~|\||>|\d+\.\s|[-*]\s\[)/m.test(text)

export const register: Register = on => {
  const rain = new Rain()
  let bandId: string | null = null
  let isEnabled = true
  let introStartedAt = 0
  let now = 0

  const introText = () => {
    const elapsed = now - introStartedAt
    let at = 0
    for (const line of INTRO) {
      const typing = line.length * 90
      const hold = 1400
      if (elapsed < at + typing) return line.slice(0, Math.floor((elapsed - at) / 90) + 1) + '█'
      if (elapsed < at + typing + hold) return line
      at += typing + hold
    }

    return undefined
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'matrix',
      description: 'Toggle the Matrix look (digital rain, green transcript)',
    })
    isEnabled = await read($, isOn)
    introStartedAt = now = await $.clock.now()
    if (isEnabled) $.ui.status('◉ connected to the Matrix')

    $.clock.every(70, () => {
      now += 70
      if (!isEnabled || bandId === null || rain.columns === 0) return
      rain.step()
      void $.ui.blit({ requestId: bandId, key: 'rain', cells: rain.cells(introText()) })
    })

    return next(e)
  })

  on('command.run', { command: 'matrix' }, async $ => {
    const value = await update($, isOn, was => !was)
    isEnabled = value
    $.ui.status(value ? '◉ connected to the Matrix' : undefined)
    if (value) introStartedAt = now

    return { text: value ? 'Welcome back to the Matrix.' : 'You took the blue pill. The story ends.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn)) || e.surface !== 'terminal') {
      bandId = null
      return next(e)
    }
    const { Raster } = $.ui.resolve(e)
    const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
    const rows = Math.max(1, Math.min(e.props.maxRows - 1, e.props.isWorking ? 6 : 3))
    rain.resize(columns, rows)
    bandId = e.requestId

    return <Raster key="rain" columns={columns} rows={rows} cells={rain.cells(introText())} />
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.message !== null) return next(e)

    return next({ ...e, props: { ...e.props, word: pick(SPINNER_WORDS, e.props.word) } })
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const { Text } = $.ui.resolve(e)
    const seconds = Math.max(1, Math.round(e.props.durationMs / 1000))
    const time = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`

    return (
      <Text color={DIM_GREEN}>
        ⌁ {pick(DONE_WORDS, e.props.word)} {time}
      </Text>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isExpanded || e.props.origin.kind !== 'composer') {
      return next(e)
    }
    const { Text } = $.ui.resolve(e)

    return (
      <Text color={GREEN}>
        <Text bold>neo@nebuchadnezzar</Text>
        <Text color={DIM_GREEN}>:~$ </Text>
        {e.props.text}
      </Text>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn)) || e.props.isSummary || !isPlainProse(e.props.text)) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Text color={GREEN}>{e.props.isFirstOfReply ? '▸ ' : '  '}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <Text color={GREEN}>{flatten(e.props.text.trim())}</Text>
        </Box>
      </Box>
    )
  })
}
