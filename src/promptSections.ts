function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const previousOutputTextKeys = ["output", "storyMarkdown", "chapterMarkdown", "stdout"] as const;

export function previousOutputTextSections(value: unknown): string[] {
  const record = asRecord(value);
  const sections: string[] = [];

  for (const key of previousOutputTextKeys) {
    const text = record[key];
    if (typeof text === "string" && text.trim()) {
      sections.push(text);
    }
  }

  if (sections.length > 0) {
    return sections;
  }

  for (const [key, value] of Object.entries(record)) {
    if (["stepKey", "attempt", "adapter", "command", "exitStatus", "mockResult"].includes(key)) continue;
    if (typeof value === "string" && value.trim()) {
      sections.push(`${key}: ${value}`);
    }
  }

  return sections;
}
