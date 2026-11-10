/** A parked prompt: plain text, or a slash command run as if typed. */
export type QueueItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'command'; command: string; args: string }

export type QueueItems = QueueItem[]

declare module 'claude-code' {
  interface PluginState {
    'prompt-queue': {
      items: Shaped<QueueItems>
      auto: boolean
      initialized: boolean
      waiting: string[]
      busy: boolean
      sending: boolean
    }
  }
}
