import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { QueueItem } from '../types'

const items = atom({ plugin: 'prompt-queue', key: 'items' } as const, [], { shape: 'items-2' })
const auto = atom({ plugin: 'prompt-queue', key: 'auto' } as const, false)
// Ids of background tasks and agents the main session started and still waits on.
const waiting = atom({ plugin: 'prompt-queue', key: 'waiting' } as const, [])
// Whether a main-loop turn is running; kept in state so a reload mid-turn remembers it.
const busy = atom({ plugin: 'prompt-queue', key: 'busy' } as const, false)
// Whether a send is on its way and has not started a turn yet. Sends do not
// overlap: one sets busy before its entry leaves the queue (see send) and clears
// it only when the send failed or started no turn.
const sending = atom({ plugin: 'prompt-queue', key: 'sending' } as const, false)

const BASH_STARTED = /running in background with ID: (\S+?)\.?\s/
const AGENT_STARTED = /agentId: ([\w-]+)/
// A finished job's notice; it stays inside its own <task-notification> block.
const FINISHED = /<task-id>([^<]+)<\/task-id>(?:(?!<\/task-notification>)[\s\S])*?<status>(?!running)/g
// A subagent's final report, sent as a message from that agent.
const HANDED_BACK = /<agent-message from="([^"]+)">\s*\[Subagent hand-back\]/g
// Job notices arrive on their own or inside another session's message, never in a prompt the user typed.
const NOTICE_ORIGINS = ['task-notification', 'peer']

const PANE = 'queue'

const HELP = `/queue            open the panel: edit, reorder, run, remove
/queue <text>     park a prompt
/queue /cmd ...   park a slash command to run as if typed
/queue help       list these commands
/queue list       show parked entries
/queue run [n]    send entry n now (default 1)
/queue drop <n>   remove entry n
/queue clear      remove all entries
/queue unblock    stop waiting on background jobs
/queue-auto       toggle: run the queue after each task and its background jobs end`

// A leading slash parks a slash command rather than text for the model.
const COMMAND = /^\/(\S+)(?:\s+([\s\S]*))?$/
// What the engine reads as a command name, as its own dispatch tests it. Text
// with a leading slash that names no such command can be neither run nor sent
// as a prompt ($.prompt.submit refuses a prompt that starts with "/").
const COMMAND_NAME = /^[A-Za-z0-9_][A-Za-z0-9:_-]*$/

const parseEntry = (text: string): QueueItem => {
  const trimmed = text.trim()
  const found = trimmed.match(COMMAND)
  return found
    ? { kind: 'command', command: found[1]!, args: (found[2] ?? '').trim() }
    : { kind: 'prompt', text: trimmed }
}

// The token after the slash when the text starts with one that names no command.
const badCommand = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return undefined
  const name = trimmed.match(COMMAND)?.[1]
  if (name !== undefined && COMMAND_NAME.test(name)) return undefined
  return name === undefined ? trimmed.split(/\s+/)[0]! : `/${name}`
}

const REFUSED = (token: string) => `${token} is not a command name, and a prompt cannot start with "/".`

// Refuses text that can never be queued, saying why in a toast.
const refuse = ($: Engine, text: string) => {
  const bad = badCommand(text)
  if (bad !== undefined) $.ui.toast(REFUSED(bad))
  return bad !== undefined
}

// The line a parked entry shows as: its command as typed, or its prompt.
const textOf = (item: QueueItem) =>
  item.kind === 'prompt' ? item.text : `/${item.command}${item.args ? ` ${item.args}` : ''}`

// The first line of a prompt, cut to fit beside the other mods' counts.
const peek = (text: string) => {
  const line = text.split('\n')[0]!
  return line.length > 30 ? `${line.slice(0, 29)}…` : line
}

// The state drawn dim in the band above the prompt.
const stateText = async ($: Engine) => {
  const [list, isAuto] = await Promise.all([read($, items), read($, auto)])
  const count = list.length
  const jobs = isAuto && count ? (await read($, waiting)).length : 0
  return [count && `${count} queued: ${peek(textOf(list[0]!))}`, isAuto && 'auto', isAuto && count && jobs && `waiting on ${jobs} bg`]
    .filter(Boolean)
    .join(' · ')
}

const move = ($: Engine, i: number, by: -1 | 1) =>
  update($, items, list => {
    const j = i + by
    if (j < 0 || j >= list.length) return list
    const copy = [...list]
    ;[copy[i], copy[j]] = [list[j]!, list[i]!]
    return copy
  })

const removeAt = ($: Engine, i: number) => update($, items, list => list.filter((_, j) => j !== i))

// Empty text removes the entry.
const edit = ($: Engine, i: number, text: string) =>
  text.trim() ? update($, items, list => list.map((item, j) => (j === i ? parseEntry(text) : item))) : removeAt($, i)

// How long a command that starts no turn holds the queue. The engine raises a
// command's turn after $.command.run resolves, so sending never means "no turn"
// at that point; turn.start clears the flag instead, and only silence moves on.
const COMMAND_GRACE_MS = 250

// Counts sends, so a late check of one does not act on a later send's flags.
let sends = 0

// A hook cannot submit while it holds the turn; send once it has ended.
// `take` removes the entry from the queue, after busy is set: a reload's
// session.start that starts sending finds the queue taken, not one entry short.
// A prompt that could not be sent may go through next time; a command that
// failed (an unknown name, a command that throws) will fail again.
const send = async (
  $: Engine,
  item: QueueItem,
  take: () => Promise<unknown>,
  onPromptFail: (reason?: string) => Promise<unknown>,
) => {
  await update($, busy, () => true)
  await update($, sending, () => true)
  const gen = ++sends
  await take()
  // A failed send started no turn, so nothing else would clear the flags.
  const stop = async () => {
    await update($, busy, () => false)
    await update($, sending, () => false)
  }
  // Whatever was expected never came: the queue has nothing more to wait for.
  const moveOn = async () => {
    await stop()
    await sendIfIdle($)
  }

  $.clock.after(0, async () => {
    try {
      if (item.kind === 'prompt') {
        const out = await $.prompt.submit({ text: item.text, asUser: true })
        // A hook may refuse a prompt without throwing, answering { drop }: no
        // turn starts then, so nothing else would clear the flags.
        if ('drop' in out && gen === sends && (await read($, sending))) {
          await stop()
          await onPromptFail(out.drop)
        }
        return
      }
      await $.command.run({ command: item.command, args: item.args })
      $.clock.after(COMMAND_GRACE_MS, async () => {
        if (gen === sends && (await read($, sending))) await moveOn()
      })
    } catch {
      // A command that cannot run would block every entry behind it, so it
      // leaves the queue and the next entry goes.
      if (item.kind === 'command') {
        $.ui.toast(`Could not run "${textOf(item)}". It was removed from the queue.`)
        await moveOn()
        return
      }
      await stop()
      await onPromptFail()
    }
  })
}

// Auto sends the next entry only when no turn runs and no background job is left.
const sendIfIdle = async ($: Engine) => {
  if ((await read($, busy)) || !(await read($, auto)) || (await read($, waiting)).length) return
  const [first] = await read($, items)
  if (first === undefined) return
  await send($, first, () => update($, items, list => list.slice(1)), async reason => {
    // Keep what could not be sent, at the front, and stop trying on its own.
    await update($, items, list => [first, ...list])
    await update($, auto, () => false)
    const why = reason ? `: ${reason}` : ''
    $.ui.toast(`Queue paused: could not send "${peek(textOf(first))}"${why}. /queue-auto resumes.`)
  })
}

const enqueue = async ($: Engine, text: string) => {
  await update($, items, list => [...list, parseEntry(text)])
  await sendIfIdle($)
}

const runAt = async ($: Engine, i: number, item: QueueItem) => {
  await send($, item, () => removeAt($, i), async reason => {
    await update($, items, list => {
      const at = Math.min(i, list.length)
      return [...list.slice(0, at), item, ...list.slice(at)]
    })
    const why = reason ? `: ${reason}` : ''
    $.ui.toast(`Could not send "${peek(textOf(item))}"${why}. It stays in the queue.`)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'queue',
      description: 'Park a prompt or command to run later (list, run, drop, clear)',
      immediate: true,
    })
    await $.command.register({
      name: 'queue-auto',
      description: 'Toggle running the queue after each task and its background jobs end',
      immediate: true,
    })

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, busy, () => true)
      await update($, sending, () => false)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // Only a background Bash call or an Agent call starts a job; other output may quote the words.
    const pattern =
      e.tool === 'Bash' && e.run_in_background ? BASH_STARTED : e.tool === 'Agent' ? AGENT_STARTED : undefined
    const id = pattern && ran.text?.match(pattern)?.[1]
    if (id) await update($, waiting, ids => [...ids.filter(one => one !== id), id])

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (NOTICE_ORIGINS.includes(e.origin.kind)) {
      const ended = [...e.text.matchAll(FINISHED), ...e.text.matchAll(HANDED_BACK)].map(match => match[1])
      if (ended.length) await update($, waiting, ids => ids.filter(one => !ended.includes(one)))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined) return ended
    await update($, busy, () => false)

    // Esc turns auto off instead of starting the next prompt.
    if (e.isAborted && (await read($, auto))) {
      await update($, auto, () => false)
      $.ui.toast('Queue auto is off. /queue-auto turns it back on.')
    } else {
      await sendIfIdle($)
    }

    return ended
  })

  on('command.run', { command: 'queue-auto' }, async $ => {
    const isOn = !(await read($, auto))
    await update($, auto, () => isOn)
    if (!isOn) return { text: 'Queue auto is off.' }
    await sendIfIdle($)

    return { text: 'Queue auto is on: entries run after each task and its background jobs end.' }
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const args = e.args.trim()
    // A subcommand is matched only in its exact form, so "/queue list the files" is queued.
    const found = args.match(/^(help|list|clear|unblock)$|^(run|drop)(?:\s+(\d+))?$/)
    const word = found?.[1] ?? found?.[2]
    const arg = found?.[3] ?? ''
    if (word === 'help') return { text: HELP }

    if (args === '') {
      await $.ui.open({ id: PANE, title: 'Queue', focus: true, closeOnEscape: true })
      return { text: 'Queue panel opened.' }
    }

    const list = await read($, items)
    const n = Number(arg || '1')
    const i = Number.isInteger(n) && n >= 1 && n <= list.length ? n - 1 : -1

    if (word === 'list') {
      return { text: list.map((item, j) => `${j + 1}. ${textOf(item)}`).join('\n') || 'Queue is empty.' }
    }

    if (word === 'clear') {
      await update($, items, () => [])
      return { text: `Cleared ${list.length} prompt(s).` }
    }

    if (word === 'unblock') {
      await update($, waiting, () => [])
      await sendIfIdle($)
      return { text: 'Stopped waiting on background jobs.' }
    }

    if (word === 'drop' || word === 'run') {
      if (i < 0) return { text: `No prompt ${arg || '1'}. Queue has ${list.length}.` }
      await (word === 'run' ? runAt($, i, list[i]!) : removeAt($, i))
      return { text: `${word === 'run' ? 'Sending' : 'Dropped'}: ${textOf(list[i]!)}` }
    }

    // A leading slash that names no command cannot be run or sent, so it is
    // refused now rather than dropped by a send that cannot work.
    const bad = badCommand(args)
    if (bad) return { text: REFUSED(bad) }

    await enqueue($, args)

    return { text: `Queued #${list.length + 1}.` }
  })

  // The state goes dim in the band above the prompt, in one row with what other mods draw there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = e.props.hasSurvey ? '' : await stateText($)
    if (!text) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text dimColor>{text}   </Text>
        {await next(e)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Surfaces without a text field (vscode, mobile) add through the command.
    const Input = 'Input' in els ? els.Input : undefined
    const list = await read($, items)

    return (
      <Box flexDirection="column">
        {Input ? (
          <Input key="new" label="Add: " placeholder="Enter to queue at the end" value="" submitLabel="queue" autoFocus
            onSubmit={(v: string) => { if (v.trim() && !refuse($, v)) void enqueue($, v.trim()) }} />
        ) : (
          <Text dimColor>Add with /queue &lt;text&gt;</Text>
        )}
        <Box marginTop={1} flexDirection="column">
          {list.length === 0 && <Text dimColor>Queue is empty.</Text>}
          {list.map((item, i) => (
            <Box key={`row-${i}`} flexDirection="row">
              <Text>{i + 1}. </Text>
              {Input ? (
                <Input key={`edit-${i}`} value={textOf(item)} submitLabel="save"
                  onSubmit={(v: string) => { if (!refuse($, v)) void edit($, i, v) }} />
              ) : (
                <Text>{textOf(item)}</Text>
              )}
              <Text> </Text>
              <Button key={`up-${i}`} label="↑" plain dimColor onPress={() => move($, i, -1)} />
              <Text> </Text>
              <Button key={`down-${i}`} label="↓" plain dimColor onPress={() => move($, i, 1)} />
              <Text> </Text>
              <Button key={`run-${i}`} label="▶" plain dimColor
                onPress={() => void runAt($, i, item)} />
              <Text> </Text>
              <Button key={`rm-${i}`} label="✕" plain dimColor onPress={() => removeAt($, i)} />
            </Box>
          ))}
        </Box>
        <Text dimColor>Edit an entry and press Enter to save; empty removes it. A leading / runs as a command. ▶ sends it now.</Text>
      </Box>
    )
  })
}
