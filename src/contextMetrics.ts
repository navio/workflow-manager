export interface SkillMetric {
  name: string;
  chars: number;
}

export interface ContextMetrics {
  totalChars: number;
  sections: {
    systemPrompts: number;
    skills: SkillMetric[];
    globalState: number;
    previousOutput: number;
    context: number;
    objective: number;
  };
}

export interface ContextMetricsBuilder {
  addSystemPrompts(text: string): void;
  addSkill(name: string, content: string): void;
  addGlobalState(text: string): void;
  addPreviousOutput(text: string): void;
  addContext(text: string): void;
  addObjective(text: string): void;
  build(): ContextMetrics;
}

export function createContextMetricsBuilder(): ContextMetricsBuilder {
  const skills: SkillMetric[] = [];
  let systemPromptsChars = 0;
  let globalStateChars = 0;
  let previousOutputChars = 0;
  let contextChars = 0;
  let objectiveChars = 0;

  return {
    addSystemPrompts(text) {
      systemPromptsChars += text.length;
    },
    addSkill(name, content) {
      skills.push({ name, chars: content.length });
    },
    addGlobalState(text) {
      globalStateChars += text.length;
    },
    addPreviousOutput(text) {
      previousOutputChars += text.length;
    },
    addContext(text) {
      contextChars += text.length;
    },
    addObjective(text) {
      objectiveChars += text.length;
    },
    build() {
      const skillsChars = skills.reduce((sum, skill) => sum + skill.chars, 0);
      const totalChars =
        systemPromptsChars + skillsChars + globalStateChars + previousOutputChars + contextChars + objectiveChars;
      return {
        totalChars,
        sections: {
          systemPrompts: systemPromptsChars,
          skills,
          globalState: globalStateChars,
          previousOutput: previousOutputChars,
          context: contextChars,
          objective: objectiveChars,
        },
      };
    },
  };
}
