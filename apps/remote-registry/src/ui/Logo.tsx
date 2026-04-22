interface LogoProps {
  compact?: boolean;
}

export function Logo({ compact = false }: LogoProps) {
  return (
    <span className="wordmark" aria-label="workflow-manager">
      <span className="wordmark__prompt" aria-hidden="true">▸</span>
      <span>workflow-manager</span>
      {!compact && <span className="wordmark__path" aria-hidden="true">/registry</span>}
    </span>
  );
}
