// The assistant: a chat with an OpenAI model that answers from Canopus' own data through tools.

/**
 * An item of a Responses API conversation: a user/assistant message, a function call the model made,
 * a function result, or the model's (encrypted) reasoning. Kept as received and sent back as is.
 */
export type ResponseItem =
  | { type?: 'message'; role: 'user' | 'assistant' | 'developer'; content: string | { type: string; text?: string }[]; id?: string; status?: string }
  | { type: 'function_call'; call_id: string; name: string; namespace?: string; arguments: string; id?: string; status?: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'reasoning'; id?: string; summary?: unknown[]; encrypted_content?: string }

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type AssistantAuth = 'chatgpt' | 'apikey'

export interface AssistantSettings {
  /** Model id / slug; empty = the first the account offers */
  model: string
  /** Who pays: the user's ChatGPT plan or their API key */
  auth: AssistantAuth
}

export interface AssistantAccount {
  /** Signed in with ChatGPT; `plan` = allowed to use the ChatGPT plan */
  chatgpt: { email?: string; plan: boolean } | null
  apiKey: boolean
}

export interface AssistantTurn {
  output: ResponseItem[]
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
}
