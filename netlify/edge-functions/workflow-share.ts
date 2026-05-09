import type { Config, Context } from "@netlify/edge-functions";

interface ProfileRow {
  id: string;
  username: string | null;
}

interface NamespaceRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
}

interface VersionRow {
  id: string;
}

interface WorkflowShareMeta {
  owner: string;
  slug: string;
  title: string;
  description: string | null;
}

const WORKFLOW_ROUTE = new URLPattern({ pathname: "/workflow/:owner/:slug" });

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildTitle(meta: WorkflowShareMeta): string {
  return `${meta.title} | ${meta.owner}/${meta.slug} | workflow-manager`;
}

function buildDescription(meta: WorkflowShareMeta): string {
  const description = meta.description?.trim();
  if (description) {
    return description;
  }

  return `Inspect and pull ${meta.owner}/${meta.slug} from the workflow-manager registry.`;
}

function buildMetaTags(meta: WorkflowShareMeta, pageUrl: string, imageUrl: string): string {
  const title = escapeHtml(buildTitle(meta));
  const description = escapeHtml(buildDescription(meta));
  const escapedUrl = escapeHtml(pageUrl);
  const escapedImageUrl = escapeHtml(imageUrl);

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${escapedUrl}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="workflow-manager registry" />`,
    `<meta property="og:url" content="${escapedUrl}" />`,
    `<meta property="og:image" content="${escapedImageUrl}" />`,
    `<meta property="og:image:type" content="image/svg+xml" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="workflow-manager registry share card" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${escapedImageUrl}" />`,
  ].join("\n    ");
}

function injectMetaTags(html: string, metaTags: string): string {
  const withoutTitle = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  const withoutDescription = withoutTitle.replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, "");
  const withoutCanonical = withoutDescription.replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "");
  const withoutSocial = withoutCanonical.replace(/<meta\s+(?:property|name)=["'](?:og:|twitter:)[^>]*>\s*/gi, "");

  return withoutSocial.replace("</head>", `    ${metaTags}\n  </head>`);
}

async function fetchSupabaseRows<T>(url: URL, apikey: string): Promise<T[]> {
  const response = await fetch(url, {
    headers: {
      apikey,
      authorization: `Bearer ${apikey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase lookup failed with ${response.status}`);
  }

  return (await response.json()) as T[];
}

async function fetchWorkflowShareMeta(owner: string, slug: string): Promise<WorkflowShareMeta | null> {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL");
  const supabasePublishableKey = Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");

  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  const profileUrl = new URL(`${supabaseUrl}/rest/v1/profiles`);
  profileUrl.searchParams.set("select", "id,username");
  profileUrl.searchParams.set("or", `(username.eq.${owner},id.eq.${owner})`);
  profileUrl.searchParams.set("limit", "1");

  const profiles = await fetchSupabaseRows<ProfileRow>(profileUrl, supabasePublishableKey);
  const profile = profiles[0];
  if (!profile) {
    return null;
  }

  const namespaceUrl = new URL(`${supabaseUrl}/rest/v1/workflow_namespaces`);
  namespaceUrl.searchParams.set("select", "id,slug,title,description");
  namespaceUrl.searchParams.set("owner_user_id", `eq.${profile.id}`);
  namespaceUrl.searchParams.set("slug", `eq.${slug}`);
  namespaceUrl.searchParams.set("visibility", "eq.public");
  namespaceUrl.searchParams.set("limit", "1");

  const namespaces = await fetchSupabaseRows<NamespaceRow>(namespaceUrl, supabasePublishableKey);
  const namespace = namespaces[0];
  if (!namespace) {
    return null;
  }

  const versionUrl = new URL(`${supabaseUrl}/rest/v1/workflow_versions`);
  versionUrl.searchParams.set("select", "id");
  versionUrl.searchParams.set("namespace_id", `eq.${namespace.id}`);
  versionUrl.searchParams.set("published_state", "eq.published");
  versionUrl.searchParams.set("limit", "1");

  const versions = await fetchSupabaseRows<VersionRow>(versionUrl, supabasePublishableKey);
  if (versions.length === 0) {
    return null;
  }

  return {
    owner: profile.username ?? owner,
    slug: namespace.slug,
    title: namespace.title,
    description: namespace.description,
  };
}

export default async function workflowShare(request: Request, context: Context): Promise<Response> {
  const match = WORKFLOW_ROUTE.exec(request.url);
  if (!match) {
    return context.next();
  }

  const owner = match.pathname.groups.owner?.toLowerCase();
  const slug = match.pathname.groups.slug?.toLowerCase();
  if (!owner || !slug) {
    return context.next();
  }

  const [response, workflowMeta] = await Promise.all([
    context.next(),
    fetchWorkflowShareMeta(owner, slug).catch((error) => {
      console.error("[workflow-share] failed to load workflow metadata", error);
      return null;
    }),
  ]);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") || !workflowMeta) {
    return response;
  }

  const requestUrl = new URL(request.url);
  const pageUrl = requestUrl.toString();
  const imageUrl = new URL("/social-card.svg", requestUrl.origin).toString();
  const html = await response.text();
  const updatedHtml = injectMetaTags(html, buildMetaTags(workflowMeta, pageUrl, imageUrl));
  const headers = new Headers(response.headers);

  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");
  headers.delete("etag");

  return new Response(updatedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const config: Config = {
  path: "/workflow/*",
};
