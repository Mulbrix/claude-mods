export type Toggle = boolean

declare module 'claude-code' {
  interface PluginState {
    matrix: { isOn: Toggle }
  }
}
