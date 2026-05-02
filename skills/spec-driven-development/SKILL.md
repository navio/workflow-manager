# Spec-Driven Development

Write a structured specification before writing any code. The spec is the shared source of truth between you and the engineer - it defines what we're building, why, and how we'll know it's done.

## When to apply

Use spec-driven development when starting projects, handling ambiguous requirements, making architectural decisions, or tackling changes requiring 30+ minutes of work. Skip it for single-line fixes or unambiguous, self-contained changes.

## Six-section spec format

Every spec must cover these six sections in this order:

1. **Objective** - One paragraph: what we are building, why, and the success criteria. Surface assumptions explicitly.
2. **Commands** - The exact CLI / API surface. Flags, exit codes, examples.
3. **Project Structure** - File layout with one-line responsibilities per file.
4. **Code Style** - Language version, modules, error handling pattern, no-classes / no-comments rules, max function length.
5. **Testing Strategy** - Unit vs integration, what gets mocked vs real, coverage gates, naming conventions.
6. **Boundaries** - In scope, out of scope, and any non-negotiable constraints.

## Practices

- List assumptions before writing spec content. If they are wrong, the spec is wrong.
- Reframe vague requirements as measurable success criteria.
- Treat specs as living documents - update when decisions change.
- Reference the spec from pull requests so the audit trail is visible.

## Output rules

- Plain markdown only. No preamble.
- Every spec must contain all six sections, even if a section is "N/A".
- Code style and testing strategy must include concrete rules, not vague aspirations.

15 minutes of specification prevents hours of rework.
