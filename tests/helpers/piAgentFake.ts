import fs from "node:fs";
import path from "node:path";

export function fakePiAgentScript(dir: string): string {
  const script = path.join(dir, "fake-pi-agent.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";\nconst inputPath = process.argv[process.argv.indexOf("--input") + 1];\nconst outputPath = process.argv[process.argv.indexOf("--output") + 1];\nconst payload = JSON.parse(fs.readFileSync(inputPath, "utf-8"));\nfs.writeFileSync(outputPath, JSON.stringify({\n  step_id: payload.input_envelope.step_context.step_id,\n  execution_status: "SUCCESS",\n  qa_routing: { action: "PROCEED", feedback_reason: "" },\n  mutated_payload: {\n    sawSkills: payload.input_envelope.priming_configuration.required_skills,\n    sawMcps: payload.input_envelope.priming_configuration.mcp_endpoints,\n    sawSystemPrompts: payload.input_envelope.priming_configuration.system_prompts,\n    sawContext: payload.input_envelope.priming_configuration.context,\n    sawModel: payload.input_envelope.priming_configuration.model,\n    sawAttempt: payload.run.attempt\n  },\n  metadata: { execution_time_ms: 1, external_intervention_required: false }\n}));\n`,
    "utf-8"
  );
  return script;
}
