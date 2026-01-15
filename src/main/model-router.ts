import { codexManager } from './codex';
import { claudeManager, ClaudeManager, CLAUDE_MODELS } from './claude';

export type Provider = 'codex' | 'claude';

export interface ModelInfo {
  id: string;
  provider: Provider;
  cliModel: string;
  displayName: string;
  owned_by: string;
}

// Codex (OpenAI) models
const CODEX_MODELS: Record<string, { displayName: string }> = {
  'gpt-5.2-codex': { displayName: 'GPT-5.2 Codex' },
  'gpt-5.1-codex': { displayName: 'GPT-5.1 Codex' },
  'gpt-5.2': { displayName: 'GPT-5.2' },
  'gpt-5.1': { displayName: 'GPT-5.1' },
  'gpt-5': { displayName: 'GPT-5' },
  'gpt-4.1': { displayName: 'GPT-4.1' },
  'gpt-4.1-mini': { displayName: 'GPT-4.1 Mini' },
  'gpt-4o': { displayName: 'GPT-4o' },
  'gpt-4o-mini': { displayName: 'GPT-4o Mini' },
  'o3': { displayName: 'O3' },
  'o3-mini': { displayName: 'O3 Mini' },
  'o4-mini': { displayName: 'O4 Mini' },
  'o1': { displayName: 'O1' },
  'o1-mini': { displayName: 'O1 Mini' },
};

/**
 * Determine which provider to use based on model name
 */
export function getProvider(model: string): Provider {
  // Claude models
  if (ClaudeManager.isClaudeModel(model)) {
    return 'claude';
  }
  // Default to codex for all other models
  return 'codex';
}

/**
 * Get model information
 */
export function getModelInfo(model: string): ModelInfo {
  const provider = getProvider(model);

  if (provider === 'claude') {
    const claudeInfo = CLAUDE_MODELS[model];
    return {
      id: model,
      provider: 'claude',
      cliModel: claudeInfo?.cliModel || 'sonnet',
      displayName: claudeInfo?.displayName || model,
      owned_by: 'anthropic',
    };
  }

  // Codex
  const codexInfo = CODEX_MODELS[model];
  return {
    id: model,
    provider: 'codex',
    cliModel: model,
    displayName: codexInfo?.displayName || model,
    owned_by: 'openai',
  };
}

/**
 * Run prompt through the appropriate provider
 */
export async function runPrompt(
  prompt: string,
  model: string,
  timeout: number = 120000
): Promise<{ output: string; provider: Provider }> {
  const provider = getProvider(model);

  if (provider === 'claude') {
    const response = await claudeManager.runPrompt(prompt, model, timeout);
    return {
      output: response.result,
      provider: 'claude',
    };
  }

  // Codex
  const output = await codexManager.runCommand(['-m', model, '-p', prompt], timeout);
  return {
    output,
    provider: 'codex',
  };
}

/**
 * Run with conversation history through the appropriate provider
 */
export async function runWithHistory(
  history: Array<{ role: string; content: string }>,
  model: string,
  timeout: number = 120000
): Promise<{ output: string; provider: Provider }> {
  const provider = getProvider(model);
  console.log(`[ModelRouter] runWithHistory - model: ${model}, provider: ${provider}, history length: ${history.length}`);

  if (provider === 'claude') {
    console.log(`[ModelRouter] Calling claudeManager.runWithHistory...`);
    const response = await claudeManager.runWithHistory(history, model, timeout);
    console.log(`[ModelRouter] Claude returned ${response.result?.length || 0} chars`);
    return {
      output: response.result,
      provider: 'claude',
    };
  }

  // Codex - format history as prompt
  console.log(`[ModelRouter] Calling codexManager.runCommand...`);
  const prompt = history.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  const output = await codexManager.runCommand(['-m', model, '-p', prompt], timeout);
  console.log(`[ModelRouter] Codex returned ${output?.length || 0} chars`);
  return {
    output,
    provider: 'codex',
  };
}

/**
 * Get all available models from both providers
 */
export function getAllModels(): ModelInfo[] {
  const models: ModelInfo[] = [];

  // Add Codex models
  for (const [id, info] of Object.entries(CODEX_MODELS)) {
    models.push({
      id,
      provider: 'codex',
      cliModel: id,
      displayName: info.displayName,
      owned_by: 'openai',
    });
  }

  // Add Claude models (only full names, not aliases)
  for (const [id, info] of Object.entries(CLAUDE_MODELS)) {
    if (id.startsWith('claude-')) {
      models.push({
        id,
        provider: 'claude',
        cliModel: info.cliModel,
        displayName: info.displayName,
        owned_by: 'anthropic',
      });
    }
  }

  return models;
}

/**
 * Get models grouped by provider
 */
export function getModelsByProvider(): { codex: ModelInfo[]; claude: ModelInfo[] } {
  const all = getAllModels();
  return {
    codex: all.filter(m => m.provider === 'codex'),
    claude: all.filter(m => m.provider === 'claude'),
  };
}

/**
 * Run with streaming through the appropriate provider
 */
export function runWithHistoryStream(
  history: Array<{ role: string; content: string }>,
  model: string,
  onData: (chunk: string) => void,
  onEnd: (fullOutput: string) => void,
  onError: (error: Error) => void
): { processId: string; provider: Provider } {
  const provider = getProvider(model);

  // Format history as prompt
  const formattedHistory = history.map(msg => {
    const roleLabel = msg.role === 'user' ? 'Human' : 'Assistant';
    return `${roleLabel}: ${msg.content}`;
  }).join('\n\n');

  const prompt = provider === 'claude'
    ? `Here is a conversation history. Please continue as the Assistant:\n\n${formattedHistory}\n\nAssistant:`
    : history.map(msg => `${msg.role}: ${msg.content}`).join('\n');

  if (provider === 'claude') {
    const processId = claudeManager.spawnInteractive(
      prompt,
      model,
      onData,
      onEnd,
      onError
    );
    return { processId, provider: 'claude' };
  }

  // Codex
  const processId = codexManager.spawnInteractive(
    prompt,
    model,
    onData,
    onEnd,
    onError
  );
  return { processId, provider: 'codex' };
}
