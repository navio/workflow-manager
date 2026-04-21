import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "./Button";

interface CodeBlockProps {
  children: string;
  prompt?: boolean;
  label?: string;
  copyable?: boolean;
  wrap?: boolean;
  className?: string;
}

export function CodeBlock({
  children,
  prompt = false,
  label,
  copyable = true,
  wrap = true,
  className = "",
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — silently fail
    }
  }

  const cls = ["code", wrap && "code--wrap", className].filter(Boolean).join(" ");

  return (
    <pre className={cls}>
      {label && !copyable && <span className="code__label">{label}</span>}
      {copyable && (
        <IconButton
          label={copied ? "Copied" : "Copy to clipboard"}
          onClick={handleCopy}
          className="code-copy"
          variant="subtle"
        >
          {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
        </IconButton>
      )}
      {prompt && <span className="code__prompt">$ </span>}
      {children}
    </pre>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="code--inline">{children}</code>;
}
