import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function DashboardPage() {
  const { loading, session } = useAuth();

  const cliSnippet = useMemo(() => {
    if (!session?.access_token) {
      return "workflow-manager auth login --token <create-a-cli-token-in-the-dashboard>";
    }

    return "Create a CLI token in the Tokens tab, then run: workflow-manager auth login --token <token>";
  }, [session]);

  if (loading) {
    return <section className="panel">Checking session...</section>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <section className="stack page-grid">
      <div className="panel">
        <p className="eyebrow">Authenticated session</p>
        <h2>Dashboard</h2>
        <p>Use this dashboard to mint CLI tokens, publish workflows, and track analytics once the next feature slices land.</p>
      </div>
      <div className="panel">
        <h3>CLI handoff</h3>
        <code>{cliSnippet}</code>
      </div>
    </section>
  );
}
