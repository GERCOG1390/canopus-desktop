// The assistant: a chat with an OpenAI model that answers from Canopus' own data through tools.

/** A message in OpenAI chat-completions format. */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AssistantSettings {
  /** OpenAI model id; empty = pick one from the account's models */
  model: string
}

export interface CompletionResult {
  message: Extract<ChatMessage, { role: 'assistant' }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}
