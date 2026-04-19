import fs from "node:fs";
import path from "node:path";
import { parseWorkflowFile, validateWorkflow } from "../parser.js";
import type { WorkflowDefinition } from "../types.js";
import { publishRemoteWorkflow, pullRemoteWorkflow, searchRemoteWorkflows, fetchWhoAmI } from "./api.js";
import { clearRemoteConfig, saveRemoteConfig } from "./config.js";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function splitOwnerSlug(value: string): { owner: string; slug: string } {
  const [owner, slug, extra] = value.split("/");
  if (!owner || !slug || extra) {
    throw new Error("Expected workflow reference in the form <owner>/<slug>");
  }

  return { owner, slug };
}

function sourceFormatFromPath(filePath: string): "markdown" | "json" {
  return path.extname(filePath).toLowerCase() === ".json" ? "json" : "markdown";
}

function normalizeTags(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return [...new Set(raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export async function cmdAuth(args: string[]): Promise<number> {
  const subcommand = args[0];
  if (subcommand === "login") {
    const token = getFlag(args, "--token");
    if (!token) {
      console.error("Missing required flag: --token");
      return 1;
    }

    saveRemoteConfig({ token });
    try {
      const profile = await fetchWhoAmI();
      console.log(`Authenticated as ${profile.username ?? profile.userId}`);
      return 0;
    } catch (error) {
      clearRemoteConfig();
      console.error(`Auth error: ${(error as Error).message}`);
      return 1;
    }
  }

  if (subcommand === "whoami") {
    try {
      const profile = await fetchWhoAmI();
      console.log(JSON.stringify(profile, null, 2));
      return 0;
    } catch (error) {
      console.error(`Auth error: ${(error as Error).message}`);
      return 1;
    }
  }

  if (subcommand === "logout") {
    clearRemoteConfig();
    console.log("Removed local remote authentication token");
    return 0;
  }

  console.error("Usage: workflow-manager auth <login|whoami|logout>");
  return 1;
}

export async function cmdSearch(args: string[]): Promise<number> {
  try {
    const query = args.join(" ").trim();
    const result = await searchRemoteWorkflows(query);
    if (result.items.length === 0) {
      console.log("No workflows found");
      return 0;
    }

    for (const item of result.items) {
      console.log(`${item.owner}/${item.slug} - ${item.title}`);
      if (item.description) {
        console.log(`  ${item.description}`);
      }
      console.log(`  version=${item.latestVersion ?? "n/a"} visibility=${item.visibility} format=${item.sourceFormat ?? "n/a"}`);
    }
    return 0;
  } catch (error) {
    console.error(`Search error: ${(error as Error).message}`);
    return 1;
  }
}

export async function cmdPublish(filePath: string, args: string[]): Promise<number> {
  try {
    const resolvedPath = path.resolve(filePath);
    const rawSource = fs.readFileSync(resolvedPath, "utf-8");
    const workflow = parseWorkflowFile(resolvedPath);
    const errors = validateWorkflow(workflow);
    if (errors.length > 0) {
      console.error(`Invalid workflow: ${errors.join("; ")}`);
      return 1;
    }

    const slug = slugify(getFlag(args, "--slug") ?? workflow.key);
    const title = getFlag(args, "--title")?.trim() || workflow.title;
    const description = getFlag(args, "--description")?.trim() || workflow.description || null;
    const versionLabel = getFlag(args, "--version")?.trim() || `v${Date.now()}`;
    const visibility = (getFlag(args, "--visibility")?.trim().toLowerCase() ?? "private") as "public" | "private";
    const publishedState = hasFlag(args, "--draft") ? "draft" : "published";
    const tags = normalizeTags(getFlag(args, "--tag"));
    const changelog = getFlag(args, "--changelog")?.trim() || null;

    const result = await publishRemoteWorkflow({
      slug,
      title,
      description,
      visibility,
      versionLabel,
      sourceFormat: sourceFormatFromPath(resolvedPath),
      rawSource,
      definition: workflow,
      tags,
      changelog,
      publishedState,
    });

    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(`Publish error: ${(error as Error).message}`);
    return 1;
  }
}

export async function cmdPull(reference: string, args: string[]): Promise<number> {
  try {
    const { owner, slug } = splitOwnerSlug(reference);
    const version = getFlag(args, "--version");
    const pulled = await pullRemoteWorkflow(owner, slug, version);
    const outputPath =
      getFlag(args, "--output") ??
      path.resolve(`${slug}.${pulled.sourceFormat === "json" ? "json" : "md"}`);

    fs.writeFileSync(outputPath, pulled.rawSource, "utf-8");

    const validationErrors = validateWorkflow(parseWorkflowFile(outputPath));
    if (validationErrors.length > 0) {
      fs.rmSync(outputPath);
      console.error(`Pulled workflow failed local validation: ${validationErrors.join("; ")}`);
      return 1;
    }

    console.log(`Pulled ${owner}/${slug}@${pulled.version} -> ${path.resolve(outputPath)}`);
    return 0;
  } catch (error) {
    console.error(`Pull error: ${(error as Error).message}`);
    return 1;
  }
}

export async function cmdRemoteInfo(reference: string): Promise<number> {
  try {
    const { owner, slug } = splitOwnerSlug(reference);
    const pulled = await pullRemoteWorkflow(owner, slug);
    console.log(JSON.stringify(pulled, null, 2));
    return 0;
  } catch (error) {
    console.error(`Remote info error: ${(error as Error).message}`);
    return 1;
  }
}

export function pullOutputPathForTest(reference: string, output?: string, sourceFormat: "markdown" | "json" = "markdown"): string {
  const { slug } = splitOwnerSlug(reference);
  return output ?? path.resolve(`${slug}.${sourceFormat === "json" ? "json" : "md"}`);
}

export function slugifyForTest(value: string): string {
  return slugify(value);
}

export function sourceFormatFromPathForTest(filePath: string): "markdown" | "json" {
  return sourceFormatFromPath(filePath);
}
