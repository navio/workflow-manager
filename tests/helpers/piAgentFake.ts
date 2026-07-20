import fs from "node:fs";
import path from "node:path";

/**
 * A child that never writes an output envelope and outlives any reasonable
 * test timeout on its own. Records receipt of SIGTERM to `sentinelPath`
 * before exiting so tests can confirm WFM actually terminated it (as
 * opposed to the child exiting on its own or being killed externally).
 */
export function hangingPiAgentScript(dir: string): { script: string; sentinelPath: string } {
  const sentinelPath = path.join(dir, "received-sigterm.txt");
  const script = path.join(dir, "hanging-pi-agent.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";\nprocess.on("SIGTERM", () => {\n  fs.writeFileSync(${JSON.stringify(sentinelPath)}, "SIGTERM");\n  process.exit(143);\n});\nsetInterval(() => {}, 1000);\n`,
    "utf-8"
  );
  return { script, sentinelPath };
}

export function fakePiAgentScript(dir: string): string {
  const script = path.join(dir, "fake-pi-agent.mjs");
  fs.writeFileSync(
    script,
    `import fs from "node:fs";\nconst inputPath = process.env.WFM_PI_INPUT_FILE;\nconst outputPath = process.env.WFM_PI_OUTPUT_FILE;\nconst payload = JSON.parse(fs.readFileSync(inputPath, "utf-8"));\nfs.writeFileSync(outputPath, JSON.stringify({\n  step_id: payload.input_envelope.step_context.step_id,\n  execution_status: "SUCCESS",\n  qa_routing: { action: "PROCEED", feedback_reason: "" },\n  mutated_payload: {\n    sawSkills: payload.input_envelope.priming_configuration.required_skills,\n    sawMcps: payload.input_envelope.priming_configuration.mcp_endpoints,\n    sawSystemPrompts: payload.input_envelope.priming_configuration.system_prompts,\n    sawContext: payload.input_envelope.priming_configuration.context,\n    sawModel: payload.input_envelope.priming_configuration.model,\n    sawAttempt: payload.run.attempt,\n    sawArgs: process.argv.slice(2)\n  },\n  metadata: { execution_time_ms: 1, external_intervention_required: false }\n}));\n`,
    "utf-8"
  );
  return script;
}
