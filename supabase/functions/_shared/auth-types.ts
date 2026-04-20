export type AuthMethod = "anonymous" | "jwt" | "cli_token";

export interface AuthContext {
  method: AuthMethod;
  userId: string | null;
  scopes: string[];
  tokenId?: string;
}
