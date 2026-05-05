import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/useAuth";
import { normalizeHandleInput } from "../lib/handle";
import { getSupabaseBrowserClient } from "../lib/supabase";

interface ProfileRow {
  username: string | null;
}

interface ClaimHandleInput {
  username: string;
}

export function useProfile() {
  const { session } = useAuth();
  const supabase = getSupabaseBrowserClient();

  return useQuery({
    queryKey: ["profile", session?.user.id],
    enabled: Boolean(session?.user.id && supabase),
    async queryFn(): Promise<ProfileRow> {
      if (!session?.user.id || !supabase) {
        throw new Error("Missing active session");
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      return { username: data?.username ?? null };
    },
  });
}

export function useClaimHandle() {
  const { session } = useAuth();
  const supabase = getSupabaseBrowserClient();
  const queryClient = useQueryClient();

  return useMutation({
    async mutationFn({ username }: ClaimHandleInput): Promise<string> {
      if (!session?.user.id || !supabase) {
        throw new Error("Missing active session");
      }

      const normalized = normalizeHandleInput(username);
      const { error } = await supabase
        .from("profiles")
        .update({ username: normalized })
        .eq("id", session.user.id);

      if (error) {
        throw new Error(error.message);
      }

      return normalized;
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ["profile", session?.user.id] });
    },
  });
}

export function useCheckHandleAvailable(handle: string) {
  const { session } = useAuth();
  const supabase = getSupabaseBrowserClient();
  const normalized = normalizeHandleInput(handle);

  return useQuery({
    queryKey: ["profile", "handle-available", normalized],
    enabled: Boolean(normalized && supabase),
    async queryFn(): Promise<boolean> {
      if (!supabase) {
        throw new Error("Supabase is not configured");
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", normalized)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (!data) {
        return true;
      }

      return data.id === session?.user.id;
    },
  });
}
