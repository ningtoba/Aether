import type { ToolDefinition } from './types.js';

/**
 * Create a function tool definition that can be registered with an agent.
 *
 * Analogous to the OpenAI Agents SDK `function_tool()` helper.
 *
 * @param name - Tool name (should be snake_case)
 * @param description - Human-readable description
 * @param parameters - JSON Schema for the tool's input parameters
 * @param handler - The async implementation function
 * @returns A ToolDefinition suitable for agent registration
 */
export function createTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  handler: (...args: unknown[]) => unknown | Promise<unknown>,
): ToolDefinition {
  return { name, description, parameters, handler };
}

/**
 * Registry for managing tool definitions associated with an agent.
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool. Throws if a tool with the same name already exists.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools.
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Remove a tool by name. Returns true if the tool existed.
   */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }
}
