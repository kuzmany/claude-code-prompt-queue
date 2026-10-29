import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

const items = atom({ plugin: 'prompt-queue', key: 'items' } as const, [])
const auto = atom({ plugin: 'prompt-queue', key: 'auto' } as const, false)
// Ids of background tasks and agents the main session started and still waits on.
const waiting = atom({ plugin: 'prompt-queue', key: 'waiting' } as const, [])
// Whether a main-loop turn is running; kept in state so a reload mid-turn remembers it.
const busy = atom({ plugin: 'prompt-queue', key: 'busy' } as const, false)

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
/queue list       show parked prompts
/queue run [n]    send prompt n now (default 1)
/queue drop <n>   remove prompt n
/queue clear      remove all
/queue unblock    stop waiting on background jobs
/queue-auto       toggle: run the queue after each task and its background jobs end`

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
  return [count && `${count} queued: ${peek(list[0]!)}`, isAuto && 'auto', isAuto && count && jobs && `waiting on ${jobs} bg`]
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

// Empty text removes the prompt.
const edit = ($: Engine, i: number, text: string) =>
  text.trim() ? update($, items, list => list.map((t, j) => (j === i ? text.trim() : t))) : removeAt($, i)

// A hook cannot submit while it holds the turn; send once it has ended.
const send = async ($: Engine, text: string) => {
  await update($, busy, () => true)
  $.clock.after(0, async () => {
    try {
      await $.prompt.submit({ text, asUser: true })
    } catch {
      // A failed send started no turn, so nothing would clear the flag.
      await update($, busy, () => false)
    }
  })
}

// Auto sends the next prompt only when no turn runs and no background job is left.
const sendIfIdle = async ($: Engine) => {
  if ((await read($, busy)) || !(await read($, auto)) || (await read($, waiting)).length) return
  const [first] = await read($, items)
  if (first === undefined) return
  await update($, items, list => list.slice(1))
  await send($, first)
}

const enqueue = async ($: Engine, text: string) => {
  await update($, items, list => [...list, text])
  await sendIfIdle($)
}

const runAt = async ($: Engine, i: number, text: string) => {
  await removeAt($, i)
  await send($, text)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'queue',
      description: 'Park a prompt to run later (list, run, drop, clear)',
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
    if (e.agentId === undefined) await update($, busy, () => true)

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

    return { text: 'Queue auto is on: prompts run after each task and its background jobs end.' }
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
      return { text: list.map((t, j) => `${j + 1}. ${t}`).join('\n') || 'Queue is empty.' }
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
      await (word === 'run' ? runAt($, i, list[i]) : removeAt($, i))
      return { text: `${word === 'run' ? 'Sending' : 'Dropped'}: ${list[i]}` }
    }

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
            onSubmit={(v: string) => { if (v.trim()) void enqueue($, v.trim()) }} />
        ) : (
          <Text dimColor>Add with /queue &lt;text&gt;</Text>
        )}
        <Box marginTop={1} flexDirection="column">
          {list.length === 0 && <Text dimColor>Queue is empty.</Text>}
          {list.map((t, i) => (
            <Box key={`row-${i}`} flexDirection="row">
              <Text>{i + 1}. </Text>
              {Input ? (
                <Input key={`edit-${i}`} value={t} submitLabel="save" onSubmit={(v: string) => void edit($, i, v)} />
              ) : (
                <Text>{t}</Text>
              )}
              <Text> </Text>
              <Button key={`up-${i}`} label="↑" plain dimColor onPress={() => move($, i, -1)} />
              <Text> </Text>
              <Button key={`down-${i}`} label="↓" plain dimColor onPress={() => move($, i, 1)} />
              <Text> </Text>
              <Button key={`run-${i}`} label="▶" plain dimColor
                onPress={() => void runAt($, i, t)} />
              <Text> </Text>
              <Button key={`rm-${i}`} label="✕" plain dimColor onPress={() => removeAt($, i)} />
            </Box>
          ))}
        </Box>
        <Text dimColor>Edit a prompt and press Enter to save; empty removes it. ▶ sends it now.</Text>
      </Box>
    )
  })
}
