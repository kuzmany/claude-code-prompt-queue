# Prompt Queue for Claude Code

Queue up your next prompts while Claude is still working. Run them later, by hand or automatically one by one.

Claude Code's own queue sends your message into the running task. This mod holds prompts back until you want them.

## Install

At the Claude Code prompt:

```
/plugin install prompt-queue --marketplace kuzmany/claude-code-prompt-queue
```

Type `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install prompt-queue --marketplace kuzmany/claude-code-prompt-queue
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `kuzmany/claude-code-prompt-queue`, then **Add plugin**.

## Use

| Command | What it does |
| --- | --- |
| `/queue <text>` | Park a prompt. Works while Claude is busy. |
| `/queue list` | Show parked prompts. |
| `/queue run [n]` | Send prompt n now (default 1). |
| `/queue drop <n>` | Remove prompt n. |
| `/queue clear` | Remove all prompts. |
| `/queue-auto` | Toggle auto mode. |
| `/queue unblock` | Stop waiting on background jobs. |

**Auto mode** is off by default. When on, the next prompt starts only after the current task ends **and** every background job or agent it started has finished. Then the next, until the queue is empty. Auto stays on until you toggle it off. Pressing Esc turns it off.

The status line shows the state, for example `3 queued · auto · waiting on 1 bg`.

The queue belongs to the current session.

If auto keeps waiting on a job that already ended (for example one a subagent started), run `/queue unblock`.

## Example

```
> run the full test suite in the background
/queue fix the failing tests
/queue update the changelog
/queue-auto
```

Claude finishes the test run, then fixes the tests, then updates the changelog.

## License

MIT
