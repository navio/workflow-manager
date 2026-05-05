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

const RUN_LOCAL_AUTH_SMOKE = process.env.REMOTE_REGISTRY_LOCAL_AUTH_SMOKE === "1";
const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const LOCAL_SUPABASE_PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

function getTestEmail(): string {
  return `auth-smoke+${Date.now()}@example.com`;
}

function extractFirstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s)]+/);
  if (!match) {
    throw new Error("No URL found in Mailpit message body.");
  }

  const normalized = match[0].replaceAll("&amp;", "&");
  if (normalized.includes("/verify?")) {
    return normalized.replace("/verify?", "/auth/v1/verify?");
  }

  return normalized;
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

const suite = RUN_LOCAL_AUTH_SMOKE ? describe : describe.skip;

suite("local Supabase auth smoke", () => {
  it(
    "signs up, confirms via email link, signs in, and emits password reset email",
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
        const confirmOtp = await supabase.auth.verifyOtp({
          token_hash: confirmToken.tokenHash,
          type: "signup",
        });
        expect(confirmOtp.error).toBeNull();
      } else {
        const confirmResponse = await fetch(confirmLink, { redirect: "manual" });
        expect(confirmResponse.status).toBeGreaterThanOrEqual(300);
        expect(confirmResponse.status).toBeLessThan(400);
      }

      const { error: signInError, data: signInData } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      expect(signInError).toBeNull();
      expect(signInData.session).toBeTruthy();

      const resetStartedAt = Date.now();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "http://127.0.0.1:5173/auth/reset/confirm",
      });
      expect(resetError).toBeNull();

      const resetMessage = await waitForMailpitMessage(email, /reset/i, resetStartedAt);
      const resetLink = extractFirstUrl(resetMessage.Text);
      const resetToken = parseTokenHash(resetLink);
      if (resetToken.tokenHash && resetToken.type === "recovery") {
        const resetOtp = await supabase.auth.verifyOtp({
          token_hash: resetToken.tokenHash,
          type: "recovery",
        });
        expect(resetOtp.error).toBeNull();
      } else {
        const resetResponse = await fetch(resetLink, { redirect: "manual" });
        expect(resetResponse.status).toBeGreaterThanOrEqual(300);
        expect(resetResponse.status).toBeLessThan(400);
      }
    },
    45_000
  );
});
