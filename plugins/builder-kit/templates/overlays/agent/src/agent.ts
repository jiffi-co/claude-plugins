// {{PROJECT_NAME}}: agent entrypoint (OpenClaw-style, scaffolded by builder-kit).
//
// This is a typed, provider-agnostic tool-call loop with four clearly marked
// extension points. It runs the shape of a real agent (system prompt -> model
// -> tool calls -> tool results -> loop -> final answer) but ships WITHOUT a
// model wired on purpose: an unwired agent fails loudly rather than pretending
// to work. Wire a model, register your tools, and go.
//
// Extension points (search for "EXTENSION POINT"):
//   1. SYSTEM_PROMPT: the agent's role, limits, and how it should use tools.
//   2. defaultTools: register the tools the agent may call.
//   3. ModelClient: plug in your LLM provider (this is the only stub).
//   4. tool-scope guard: refuse out-of-scope tools, add approvals, and
//      sanitise tool output before it re-enters the transcript.
//
// Runtime: Node (>= 23.6 runs this .ts file directly; see agent-notes.md for
// older Node and the tsx fallback). Python is also a valid agent runtime in the
// builder-kit workflow; this starter is TypeScript.

import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface Message {
  role: Role
  content: string
  // Set on `tool` messages so the model can match a result to the call it made.
  toolCallId?: string
  name?: string
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

// A tool the agent may call. The handler returns a string that is fed back to
// the model as a `tool` message. Keep handlers deterministic where you can:
// it makes them far easier to eval (see evals/).
export interface ToolSpec {
  name: string
  description: string
  // JSON-schema-shaped description of the input, handed to the model so it
  // knows how to call the tool. Not validated here; validate in the handler.
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>) => Promise<string> | string
}

// The model's reply is EITHER a final answer OR one or more tool calls.
export type ModelReply =
  | { type: 'final'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] }

// EXTENSION POINT 3: the LLM client. Implement this with your provider and pass
// it as `config.model`. It must turn the running transcript plus the tool specs
// into a ModelReply.
export interface ModelClient {
  next(messages: Message[], tools: ToolSpec[]): Promise<ModelReply>
}

export interface AgentConfig {
  systemPrompt: string
  tools: ToolSpec[]
  model: ModelClient
  // Hard ceiling on loop iterations, so a misbehaving model cannot spin forever.
  maxSteps?: number
}

// ---------------------------------------------------------------------------
// Example tools (real and deterministic, so the smoke eval can check them)
// ---------------------------------------------------------------------------

const getTime: ToolSpec = {
  name: 'get_time',
  description: 'Return the current date and time as an ISO-8601 string.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: () => new Date().toISOString(),
}

const add: ToolSpec = {
  name: 'add',
  description: 'Add two numbers and return their sum.',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
    additionalProperties: false,
  },
  handler: (input) => {
    const a = Number(input.a)
    const b = Number(input.b)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error('add: "a" and "b" must both be numbers')
    }
    return String(a + b)
  },
}

// EXTENSION POINT 2: register the tools your agent may call. Everything here is
// an allowlist. A tool the model names that is not in this list is refused (see
// the loop below), never silently run.
export const defaultTools: ToolSpec[] = [getTime, add]

// ---------------------------------------------------------------------------
// The stub model (EXTENSION POINT 3)
// ---------------------------------------------------------------------------

// Distinct error type so callers (and `npm start`) can tell "you have not wired
// a model yet" apart from a genuine runtime failure.
export class StubModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StubModelError'
  }
}

// Replace this with a real client, e.g. the Anthropic or OpenAI SDK. This stub
// throws so an unwired agent can never masquerade as a working one.
export const stubModel: ModelClient = {
  async next(): Promise<ModelReply> {
    throw new StubModelError(
      'No model client wired. Implement ModelClient (EXTENSION POINT 3 in ' +
        'src/agent.ts) with your LLM provider and pass it as config.model. ' +
        'See agent-notes.md.',
    )
  },
}

// ---------------------------------------------------------------------------
// The tool-call loop
// ---------------------------------------------------------------------------

// EXTENSION POINT 1: the system prompt. Set the agent's role, its limits, and
// how it should use the tools.
export const SYSTEM_PROMPT = [
  'You are {{PROJECT_NAME}}, an assistant that uses the registered tools when they help.',
  'Only call tools that are registered. If a tool is not available, say so plainly rather than guessing.',
  'Never fabricate tool output. Prefer a short, direct answer.',
].join('\n')

export function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    systemPrompt: overrides.systemPrompt ?? SYSTEM_PROMPT,
    tools: overrides.tools ?? defaultTools,
    model: overrides.model ?? stubModel,
    maxSteps: overrides.maxSteps ?? 8,
  }
}

// Run the agent over one input and return its final answer. Exported so the
// eval harness (see evals/) can drive it once a real model is wired.
export async function runAgent(input: string, config: AgentConfig): Promise<string> {
  const maxSteps = config.maxSteps ?? 8

  // Deny-by-default tool scope: only registered tools can run.
  const registry = new Map<string, ToolSpec>()
  for (const t of config.tools) registry.set(t.name, t)

  const messages: Message[] = [
    { role: 'system', content: config.systemPrompt },
    { role: 'user', content: input },
  ]

  for (let step = 0; step < maxSteps; step++) {
    const reply = await config.model.next(messages, config.tools)

    if (reply.type === 'final') return reply.text

    // reply.type is 'tool_calls': dispatch each call, append each result.
    for (const call of reply.calls) {
      const tool = registry.get(call.name)

      // EXTENSION POINT 4: guard rails. An unregistered tool is refused here
      // rather than trusted. This is also where you would add human approval
      // for destructive tools, or sanitise a tool's output before it re-enters
      // the transcript (a prompt-injection defence: tool output is untrusted
      // input, not instructions).
      if (!tool) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: `error: tool "${call.name}" is not registered and was refused`,
        })
        continue
      }

      let result: string
      try {
        result = await tool.handler(call.input)
      } catch (err) {
        result = `error: ${(err as Error).message}`
      }
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result })
    }
  }

  throw new Error(`runAgent: hit maxSteps (${maxSteps}) without a final answer`)
}

// ---------------------------------------------------------------------------
// Direct run (npm start)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(' ') || 'What time is it right now?'
  try {
    const answer = await runAgent(input, createAgent())
    console.log(answer)
  } catch (err) {
    if (err instanceof StubModelError) {
      console.error(`\n${err.message}\n`)
      process.exitCode = 1
      return
    }
    throw err
  }
}

// Run main only when this file is executed directly, not when it is imported
// (the eval harness imports runAgent without triggering a run).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
