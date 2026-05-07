import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireHandle } from "./auth/RequireHandle";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { AuthConfirmPage } from "./pages/AuthConfirmPage";
import { AuthPage } from "./pages/AuthPage";
import { CheckEmailPage } from "./pages/CheckEmailPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HomePage } from "./pages/HomePage";
import { ManageWorkflowPage } from "./pages/ManageWorkflowPage";
import { OnboardHandlePage } from "./pages/OnboardHandlePage";
import { PublishWorkflowPage } from "./pages/PublishWorkflowPage";
import { ResetPasswordConfirmPage } from "./pages/ResetPasswordConfirmPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SearchPage } from "./pages/SearchPage";
import { TokensPage } from "./pages/TokensPage";
import { WorkflowDetailPage } from "./pages/WorkflowDetailPage";
import { AppShell } from "./ui/AppShell";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/workflow/:owner/:slug" element={<WorkflowDetailPage />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/auth/check-email" element={<CheckEmailPage />} />
              <Route path="/auth/confirm" element={<AuthConfirmPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/auth/reset" element={<ResetPasswordPage />} />
              <Route path="/auth/reset/confirm" element={<ResetPasswordConfirmPage />} />

              <Route element={<RequireAuth />}>
                <Route path="/onboard/handle" element={<OnboardHandlePage />} />
              </Route>

              <Route element={<RequireHandle />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/dashboard/workflows/:slug" element={<ManageWorkflowPage />} />
                <Route path="/dashboard/publish" element={<PublishWorkflowPage />} />
                <Route path="/dashboard/publish/:slug" element={<PublishWorkflowPage />} />
                <Route path="/dashboard/tokens" element={<TokensPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
