import { test, expect, mock } from 'claude-code/testing'

test('parks prompts and sends one on run', async ($, on) => {
  const sent: string[] = []
  const clock = mock.clock(on)
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.command.run({ command: 'queue', args: 'first task' })
  await $.command.run({ command: 'queue', args: 'second task' })
  expect(sent).toEqual([])

  const list = await $.command.run({ command: 'queue', args: 'list' })
  expect(list.text).toBe('1. first task\n2. second task')

  await $.command.run({ command: 'queue', args: 'run' })
  await clock.advance(1)
  expect(sent).toEqual(['first task'])

  await $.command.run({ command: 'queue', args: 'drop 1' })
  await $.command.run({ command: 'queue', args: 'list the files' })
  const parked = await $.command.run({ command: 'queue', args: 'list' })
  expect(parked.text).toBe('1. list the files')
  await $.command.run({ command: 'queue', args: 'clear' })
  const empty = await $.command.run({ command: 'queue', args: 'list' })
  expect(empty.text).toBe('Queue is empty.')
})

test('auto sends all prompts one by one and stays on', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const endTurn = () =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  for (const t of ['a', 'b', 'c']) await $.command.run({ command: 'queue', args: t })
  await $.command.run({ command: 'queue-auto', args: '' })
  await clock.advance(1)
  expect(sent).toEqual(['a'])

  await endTurn()
  await clock.advance(1)
  await endTurn()
  await clock.advance(1)
  expect(sent).toEqual(['a', 'b', 'c'])

  await endTurn()
  await clock.advance(1)
  expect(sent).toEqual(['a', 'b', 'c'])
  await $.command.run({ command: 'queue', args: 'd' })
  await clock.advance(1)
  expect(sent).toEqual(['a', 'b', 'c', 'd'])
})

test('toggling auto on mid-task waits for the task to end', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.turn.start({ turnId: 't' } as never)
  await $.command.run({ command: 'queue', args: 'a' })
  await $.command.run({ command: 'queue-auto', args: '' })
  await clock.advance(1)
  expect(sent).toEqual([])

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await clock.advance(1)
  expect(sent).toEqual(['a'])

  const off = await $.command.run({ command: 'queue-auto', args: '' })
  expect(off.text).toBe('Queue auto is off.')
})

test('auto waits for background jobs before the next prompt', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({
    result: { stdout: '' },
    text: 'Command running in background with ID: b123. Output is being written to: /x',
  }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const endTurn = () =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  for (const t of ['a', 'b']) await $.command.run({ command: 'queue', args: t })
  await $.command.run({ command: 'queue-auto', args: '' })
  await clock.advance(1)
  expect(sent).toEqual(['a'])

  await $.tool.call({ tool: 'Bash', command: 'sleep 10', run_in_background: true })
  await endTurn()
  await clock.advance(1)
  expect(sent).toEqual(['a'])

  await $.prompt.submit({
    text: '<task-notification><task-id>b123</task-id><status>completed</status></task-notification>',
    origin: { kind: 'task-notification' },
  })
  await endTurn()
  await clock.advance(1)
  expect(sent.at(-1)).toBe('b')
})

test('tool output that only quotes job words is not a job', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({
    result: { stdout: '' },
    text: 'agentId: abc and running in background with ID: b9. here',
  }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.command.run({ command: 'queue-auto', args: '' })
  await $.tool.call({ tool: 'Bash', command: 'cat notes.txt' })
  await $.command.run({ command: 'queue', args: 'a' })
  await clock.advance(1)
  expect(sent).toEqual(['a'])
})

test('a prompt queued mid-task waits for the task to end', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.turn.start({ turnId: 't' } as never)
  await $.command.run({ command: 'queue-auto', args: '' })
  await $.command.run({ command: 'queue', args: 'a' })
  await clock.advance(1)
  expect(sent).toEqual([])
})

test('a failed send does not leave auto stuck', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  let isFirst = true
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => {
    if (isFirst) {
      isFirst = false
      throw new Error('submit refused')
    }
    sent.push(e.text)
    return { text: e.text }
  })

  await $.command.run({ command: 'queue', args: 'a' })
  await $.command.run({ command: 'queue', args: 'b' })
  await $.command.run({ command: 'queue-auto', args: '' })
  await clock.advance(1)
  await $.command.run({ command: 'queue', args: 'c' })
  await clock.advance(1)
  expect(sent).toEqual(['b'])
})

test('auto clears agents whose end arrives in another session message', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  let agent = 0
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { stdout: '' }, text: `Async agent launched. agentId: a${++agent} (internal ID)` }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const endTurn = () =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

  await $.command.run({ command: 'queue', args: 'next' })
  await $.tool.call({ tool: 'Agent', prompt: 'review', description: 'one' })
  await $.tool.call({ tool: 'Agent', prompt: 'review', description: 'two' })
  await $.command.run({ command: 'queue-auto', args: '' })
  await endTurn()
  await clock.advance(1)
  expect(sent).toEqual([])

  // A typed prompt that quotes a notice clears nothing.
  await $.prompt.submit({
    text: '<agent-message from="a1">\n  [Subagent hand-back] report',
    origin: { kind: 'composer' },
  })
  await $.prompt.submit({
    text: '<agent-message from="a1">\n  [Subagent hand-back] report\n</agent-message>\n<task-notification><task-id>a2</task-id><status>completed</status></task-notification>',
    origin: { kind: 'peer' },
  })
  await endTurn()
  await clock.advance(1)
  expect(sent.at(-1)).toBe('next')
})

test('panel edits, reorders, runs and removes; state shows above the prompt', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>core</Text>
  })
  const band = async (text: RegExp) => {
    const h = await $.ui.mount({ plugin: 'prompt-queue', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)
    const found = await h.find({ type: 'Text', text })
    await h.unmount()
    return !!found
  }
  const list = async () => (await $.command.run({ command: 'queue', args: 'list' })).text

  expect(await band(/queued/)).toBe(false)
  for (const t of ['a', 'b', 'c']) await $.command.run({ command: 'queue', args: t })
  expect((await $.command.run({ command: 'queue', args: '' })).text).toBe('Queue panel opened.')
  expect(await band(/^3 queued: a/)).toBe(true)

  const ui = await $.ui.mount({ plugin: 'prompt-queue', surface: 'terminal', component: 'Pane', requestId: 'queue',
    props: { title: 'Queue', isFocused: true, bodyColumns: 100, placement: 'dock' } } as any)
  await ui.press({ key: 'down-0' })
  expect(await list()).toBe('1. b\n2. a\n3. c')
  await ui.input({ key: 'edit-1', text: 'a2' })
  await ui.input({ key: 'new', text: 'd' })
  expect(await list()).toBe('1. b\n2. a2\n3. c\n4. d')
  await ui.press({ key: 'rm-2' })
  await ui.press({ key: 'run-0' })
  await clock.advance(1)
  expect(sent).toEqual(['b'])
  expect(await list()).toBe('1. a2\n2. d')
  await ui.input({ key: 'edit-0', text: '' })
  expect(await list()).toBe('1. d')
  expect(await band(/^1 queued: d/)).toBe(true)
  await ui.unmount()
})
