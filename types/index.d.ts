export type QueueItems = string[]

declare module 'claude-code' {
  interface PluginState {
    'prompt-queue': { items: QueueItems; auto: boolean; waiting: string[]; busy: boolean }
  }
}
