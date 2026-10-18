export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Step = Tokens & { at: number; model: string; isAgent: boolean }

export type Usage = {
  total: Tokens
  requests: number
  byModel: Record<string, Tokens & { requests: number }>
  main: Tokens
  agents: Tokens
  steps: Step[]
}

declare module 'claude-code' {
  interface PluginState {
    'token-dashboard': { usage: Usage }
  }
}
