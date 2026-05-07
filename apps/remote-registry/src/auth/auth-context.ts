import { createContext } from "react";
import type { EmailOtpType, Session } from "@supabase/supabase-js";

export interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  confirmEmail: (tokenHash: string, type: EmailOtpType) => Promise<void>;
  exchangeOAuthCode: (code: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
