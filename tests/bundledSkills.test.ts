import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUNDLED_SKILLS } from "../src/generated/bundledSkills.ts";
import type { BundledSkillFile } from "../src/generated/bundledSkills.ts";
import {
  listPackagedSkills,
  listPackagedSkillsFromBundle,
  listPackagedSkillsFromDisk,
  materializeSkillFiles,
  parseSkillDescription,
} from "../src/index.ts";

const REGENERATE_HINT = "Run `bun run generate:skills` and commit the result.";

function readSkillsFromDisk(root: string): Record<string, BundledSkillFile[]> {
  const result: Record<string, BundledSkillFile[]> = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const fileNames = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((file) => file.isFile())
      .map((file) => file.name)
      .sort();
    result[entry.name] = fileNames.map((name) => ({
      name,
      content: fs.readFileSync(path.join(dir, name), "utf-8"),
    }));
  }
  return result;
}

describe("src/generated/bundledSkills.ts — sync with skills/", () => {
  const skillsRoot = path.resolve(import.meta.dir, "..", "skills");
  const onDisk = readSkillsFromDisk(skillsRoot);

  it("embeds exactly the same skill names as skills/", () => {
    const diskNames = Object.keys(onDisk).sort();
    const bundledNames = Object.keys(BUNDLED_SKILLS).sort();
    expect(bundledNames, `Bundled skill names are out of sync with skills/. ${REGENERATE_HINT}`).toEqual(diskNames);
  });

  for (const name of Object.keys(onDisk).sort()) {
    it(`embeds the same files and contents as skills/${name}`, () => {
      const diskFiles = onDisk[name];
      const bundledFiles = BUNDLED_SKILLS[name];
      expect(bundledFiles, `Bundled skill "${name}" is missing. ${REGENERATE_HINT}`).toBeDefined();
      expect(
        bundledFiles.map((file) => file.name),
        `File set for bundled skill "${name}" is out of sync with skills/${name}. ${REGENERATE_HINT}`
      ).toEqual(diskFiles.map((file) => file.name));
      for (const diskFile of diskFiles) {
        const bundledFile = bundledFiles.find((file) => file.name === diskFile.name);
        expect(
          bundledFile?.content,
          `Content for ${name}/${diskFile.name} is out of sync with disk. ${REGENERATE_HINT}`
        ).toBe(diskFile.content);
      }
    });
  }

  it("is deterministic: skill and file names are sorted", () => {
    expect(Object.keys(BUNDLED_SKILLS)).toEqual([...Object.keys(BUNDLED_SKILLS)].sort());
    for (const files of Object.values(BUNDLED_SKILLS)) {
      const names = files.map((file) => file.name);
      expect(names).toEqual([...names].sort());
    }
  });
});

describe("listPackagedSkills — on-disk vs. bundled fallback", () => {
  it("prefers the on-disk skills/ directory when present", () => {
    const skillsRoot = path.resolve(import.meta.dir, "..", "skills");
    const skills = listPackagedSkills(skillsRoot);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.source.kind).toBe("disk");
    }
  });

  it("falls back to BUNDLED_SKILLS when the on-disk directory does not exist", () => {
    const nonexistentDir = path.join(os.tmpdir(), "wm-bundled-skills-test-does-not-exist");
    expect(fs.existsSync(nonexistentDir)).toBe(false);

    const skills = listPackagedSkills(nonexistentDir);
    expect(skills.length).toBe(Object.keys(BUNDLED_SKILLS).length);
    for (const skill of skills) {
      expect(skill.source.kind).toBe("bundled");
    }
  });

  it("falls back to BUNDLED_SKILLS when the on-disk directory is empty", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-bundled-skills-empty-"));
    try {
      const skills = listPackagedSkills(emptyDir);
      expect(skills.length).toBe(Object.keys(BUNDLED_SKILLS).length);
      for (const skill of skills) {
        expect(skill.source.kind).toBe("bundled");
      }
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("returns an empty list from listPackagedSkillsFromDisk for a nonexistent dir", () => {
    const nonexistentDir = path.join(os.tmpdir(), "wm-bundled-skills-test-does-not-exist-2");
    expect(listPackagedSkillsFromDisk(nonexistentDir)).toEqual([]);
  });
});

describe("listPackagedSkillsFromBundle — description parsing from embedded content", () => {
  it("parses the frontmatter description for every bundled skill that declares one", () => {
    const skills = listPackagedSkillsFromBundle(BUNDLED_SKILLS);
    expect(skills.length).toBe(Object.keys(BUNDLED_SKILLS).length);

    const workflowManagerCli = skills.find((skill) => skill.name === "workflow-manager-cli");
    expect(workflowManagerCli).toBeDefined();
    expect(workflowManagerCli?.description.length).toBeGreaterThan(0);
    expect(workflowManagerCli?.description.includes("\n")).toBe(false);
  });

  it("names are sorted", () => {
    const skills = listPackagedSkillsFromBundle(BUNDLED_SKILLS);
    expect(skills.map((skill) => skill.name)).toEqual(
      skills
        .map((skill) => skill.name)
        .slice()
        .sort()
    );
  });

  it("skips entries with no SKILL.md file", () => {
    const skills = listPackagedSkillsFromBundle({
      "no-skill-file": [{ name: "README.md", content: "not a skill" }],
    });
    expect(skills).toEqual([]);
  });
});

describe("parseSkillDescription", () => {
  it("extracts and normalizes a multi-line frontmatter description", () => {
    const content = "---\nname: x\ndescription: >\n  Line one\n  line two.\n---\n\nBody.";
    expect(parseSkillDescription(content)).toBe("Line one line two.");
  });

  it("returns an empty string when there is no description", () => {
    expect(parseSkillDescription("# No frontmatter here")).toBe("");
  });
});

describe("materializeSkillFiles — embedded source", () => {
  it("writes every embedded file except README.md", () => {
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-materialize-"));
    try {
      const skill = {
        name: "example",
        description: "",
        source: {
          kind: "bundled" as const,
          files: [
            { name: "SKILL.md", content: "# Example skill" },
            { name: "README.md", content: "not installed" },
            { name: "helper.py", content: "print('hi')" },
          ],
        },
      };

      materializeSkillFiles(skill, destDir);

      expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf-8")).toBe("# Example skill");
      expect(fs.readFileSync(path.join(destDir, "helper.py"), "utf-8")).toBe("print('hi')");
      expect(fs.existsSync(path.join(destDir, "README.md"))).toBe(false);
    } finally {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
  });
});
