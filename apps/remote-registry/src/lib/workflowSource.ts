function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineArray(value: string): unknown[] {
  const inner = value.trim().slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((entry) => parseScalar(entry));
}

function parseSimpleYamlFrontmatter(frontmatter: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = frontmatter.split(/\r?\n/);
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [{ indent: -1, value: root }];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine.trim()) continue;
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;
    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error("Invalid frontmatter structure: list item without array parent");
      }

      const itemContent = line.slice(2).trim();
      if (!itemContent) {
        const newItem: Record<string, unknown> = {};
        parent.push(newItem);
        stack.push({ indent, value: newItem });
        continue;
      }

      if (itemContent.includes(":")) {
        const [rawKey, ...rawRest] = itemContent.split(":");
        const key = rawKey.trim();
        const rest = rawRest.join(":").trim();
        const item: Record<string, unknown> = {};
        if (rest) {
          item[key] = rest.startsWith("[") && rest.endsWith("]") ? parseInlineArray(rest) : parseScalar(rest);
        } else {
          item[key] = {};
        }
        parent.push(item);
        stack.push({ indent, value: item });
        if (!rest) {
          stack.push({ indent: indent + 2, value: item[key] as Record<string, unknown> });
        }
      } else {
        parent.push(parseScalar(itemContent));
      }
      continue;
    }

    const [rawKey, ...rawRest] = line.split(":");
    const key = rawKey.trim();
    const rest = rawRest.join(":").trim();
    if (!key || Array.isArray(parent)) {
      throw new Error("Invalid frontmatter structure");
    }

    if (!rest) {
      const nextLine = lines[index + 1]?.trim() ?? "";
      const container: Record<string, unknown> | unknown[] = nextLine.startsWith("-") ? [] : {};
      parent[key] = container;
      stack.push({ indent, value: container });
      continue;
    }

    parent[key] = rest.startsWith("[") && rest.endsWith("]") ? parseInlineArray(rest) : parseScalar(rest);
  }

  return root;
}

function parseMarkdownDefinition(rawSource: string): WorkflowDefinitionInput {
  const trimmed = rawSource.trimStart();
  if (!trimmed.startsWith("---")) {
    throw new Error("Markdown workflow source must begin with YAML frontmatter");
  }

  const parts = trimmed.split(/^---\s*$/m);
  if (parts.length < 3) {
    throw new Error("Markdown workflow source must contain opening and closing frontmatter fences");
  }

  const frontmatter = parts[1] ?? "";
  return validateDefinition(parseSimpleYamlFrontmatter(frontmatter));
}

export interface WorkflowDefinitionInput {
  key: string;
  title: string;
  description?: string;
  objectives?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  defaultRetryPolicy?: {
    maxAttempts: number;
  };
  steps: Array<Record<string, unknown>>;
}

export interface ParsedWorkflowSource {
  definition: WorkflowDefinitionInput;
  sourceFormat: "markdown" | "json";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function validateDefinition(value: unknown): WorkflowDefinitionInput {
  const definition = asRecord(value);
  const key = typeof definition.key === "string" ? definition.key.trim() : "";
  const title = typeof definition.title === "string" ? definition.title.trim() : "";
  const steps = Array.isArray(definition.steps) ? definition.steps : [];

  if (!key || !title || !Array.isArray(definition.steps)) {
    throw new Error("Workflow source must include key, title, and steps");
  }

  return {
    ...definition,
    key,
    title,
    description: typeof definition.description === "string" ? definition.description : undefined,
    objectives: Array.isArray(definition.objectives) ? definition.objectives.filter((item): item is string => typeof item === "string") : undefined,
    inputSchema: asRecord(definition.inputSchema),
    outputSchema: asRecord(definition.outputSchema),
    defaultRetryPolicy: asRecord(definition.defaultRetryPolicy).maxAttempts
      ? { maxAttempts: Number(asRecord(definition.defaultRetryPolicy).maxAttempts) }
      : undefined,
    steps,
  } as WorkflowDefinitionInput;
}

export function detectSourceFormat(rawSource: string): "markdown" | "json" {
  const trimmed = rawSource.trim();
  return trimmed.startsWith("{") ? "json" : "markdown";
}

export function parseWorkflowSource(rawSource: string, explicitFormat?: "markdown" | "json"): ParsedWorkflowSource {
  const sourceFormat = explicitFormat ?? detectSourceFormat(rawSource);
  if (sourceFormat === "json") {
    try {
      return {
        sourceFormat,
        definition: validateDefinition(JSON.parse(rawSource)),
      };
    } catch (error) {
      throw new Error(`Invalid JSON workflow source: ${(error as Error).message}`);
    }
  }

  return {
    sourceFormat,
    definition: parseMarkdownDefinition(rawSource),
  };
}
