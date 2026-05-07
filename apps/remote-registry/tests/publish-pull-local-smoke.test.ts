import { describe, expect, it } from "bun:test";
import { createClient } from "@supabase/supabase-js";

type MailpitMessage = {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
};

type MailpitMessageList = {
  messages: MailpitMessage[];
};

type MailpitMessageDetail = {
  Text: string;
};

const RUN_LOCAL_PUBLISH_SMOKE = process.env.REMOTE_REGISTRY_LOCAL_PUBLISH_SMOKE === "1";
const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const LOCAL_SUPABASE_PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

function getTestEmail(): string {
  return `publish-smoke+${Date.now()}@example.com`;
}

function getHandleSuffix(): string {
  return Date.now().toString().slice(-8);
}

function extractFirstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s)]+/);
  if (!match) {
    throw new Error("No URL found in Mailpit message body.");
  }

  return match[0].replaceAll("&amp;", "&");
}

function parseTokenHash(url: string): { tokenHash: string | null; type: string | null } {
  const parsed = new URL(url);
  return {
    tokenHash: parsed.searchParams.get("token_hash"),
    type: parsed.searchParams.get("type"),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url} (${response.status})`);
  }
  return (await response.json()) as T;
}

async function waitForMailpitMessage(
  email: string,
  subjectMatcher: RegExp,
  createdAfterMs: number,
  timeoutMs = 30_000
): Promise<MailpitMessageDetail> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const listing = await fetchJson<MailpitMessageList>(`${MAILPIT_URL}/api/v1/messages`);

    const match = listing.messages.find((message) => {
      const deliveredToEmail = message.To.some((recipient) => recipient.Address === email);
      const subjectMatches = subjectMatcher.test(message.Subject);
      const isRecent = Date.parse(message.Created) >= createdAfterMs;
      return deliveredToEmail && subjectMatches && isRecent;
    });

    if (match) {
      return fetchJson<MailpitMessageDetail>(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for email ${subjectMatcher} to ${email}`);
}

async function callFunction<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/${path}`, {
    ...init,
    headers: {
      apikey: LOCAL_SUPABASE_PUBLISHABLE_KEY,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json()) as T;
  return { status: response.status, payload };
}

const suite = RUN_LOCAL_PUBLISH_SMOKE ? describe : describe.skip;

suite("local publish/pull smoke", () => {
  it(
    "claims handle then publishes and retrieves workflow via owner slug",
    async () => {
      const email = getTestEmail();
      const password = "TestPass123!";

      const supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      const signUpStartedAt = Date.now();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: "http://127.0.0.1:5173/auth/confirm",
        },
      });
      expect(signUpError).toBeNull();

      const confirmMessage = await waitForMailpitMessage(email, /confirm/i, signUpStartedAt);
      const confirmLink = extractFirstUrl(confirmMessage.Text);
      const confirmToken = parseTokenHash(confirmLink);

      if (confirmToken.tokenHash && confirmToken.type === "signup") {
        const verify = await supabase.auth.verifyOtp({
          token_hash: confirmToken.tokenHash,
          type: "signup",
        });
        expect(verify.error).toBeNull();
      } else {
        const response = await fetch(confirmLink, { redirect: "manual" });
        expect(response.status).toBeGreaterThanOrEqual(300);
        expect(response.status).toBeLessThan(400);
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      expect(signInError).toBeNull();
      expect(signInData.session).toBeTruthy();

      const accessToken = signInData.session!.access_token;
      const userId = signInData.session!.user.id;
      const handle = `creator-${getHandleSuffix()}`;
      const workflowSlug = `workflow-${getHandleSuffix()}`;

      const claim = await supabase.from("profiles").update({ username: handle }).eq("id", userId);
      expect(claim.error).toBeNull();

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .single();
      expect(profileError).toBeNull();
      expect(profile?.username).toBe(handle);

      const publishBody = {
        slug: workflowSlug,
        title: "Smoke Workflow",
        description: "Publish/Pull smoke test",
        visibility: "public",
        versionLabel: "v1",
        sourceFormat: "json",
        rawSource: JSON.stringify(
          {
            key: "smoke_workflow",
            title: "Smoke Workflow",
            steps: [
              {
                key: "first_step",
                kind: "task",
                taskSpec: {
                  adapterKey: "mock",
                  payload: {
                    mockResult: "ok",
                  },
                },
              },
            ],
          },
          null,
          2
        ),
        definition: {
          key: "smoke_workflow",
          title: "Smoke Workflow",
          steps: [
            {
              key: "first_step",
              kind: "task",
              taskSpec: {
                adapterKey: "mock",
                payload: {
                  mockResult: "ok",
                },
              },
            },
          ],
        },
        tags: ["smoke", "local"],
        changelog: "Initial smoke publish",
        publishedState: "published",
      };

      const publishResult = await callFunction<Record<string, unknown>>("publish-workflow", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(publishBody),
      });
      expect(publishResult.status).toBe(201);
      expect(publishResult.payload.slug).toBe(workflowSlug);

      const searchResult = await callFunction<{ items?: Array<{ owner?: string; slug?: string }> }>(
        `search-workflows?q=${workflowSlug}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      expect(searchResult.status).toBe(200);
      const foundItem = searchResult.payload.items?.find((item) => item.slug === workflowSlug);
      expect(foundItem).toBeTruthy();
      expect(foundItem?.owner).toBe(handle);

      const pullByHandle = await callFunction<Record<string, unknown>>(
        `pull-workflow?owner=${handle}&slug=${workflowSlug}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      expect(pullByHandle.status).toBe(200);
      expect(pullByHandle.payload.owner).toBe(handle);
      expect(pullByHandle.payload.slug).toBe(workflowSlug);

      const pullByUserId = await callFunction<Record<string, unknown>>(
        `pull-workflow?owner=${userId}&slug=${workflowSlug}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      expect(pullByUserId.status).toBe(200);
      expect(pullByUserId.payload.slug).toBe(workflowSlug);
    },
    60_000
  );
});
