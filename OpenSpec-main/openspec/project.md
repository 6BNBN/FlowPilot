# OpenSpec Project Overview

A minimal CLI tool that helps developers set up OpenSpec file structures and keep AI instructions updated. The AI tools themselves handle all the change management complexity by working directly with markdown files.

## Technology Stack
- Language: TypeScript
- Runtime: Node.js (≥20.19.0, ESM modules)
- Package Manager: pnpm
- CLI Framework: Commander.js
- User Interaction: @inquirer/prompts
- Distribution: npm package

## Project Structure
```
src/
├── cli/        # CLI command implementations
├── core/       # Core OpenSpec logic (templates, structure)
└── utils/      # Shared utilities (file operations, rollback)

dist/           # Compiled output (gitignored)
```

## Conventions
- TypeScript strict mode enabled
- Async/await for all asynchronous operations
- Minimal dependencies principle
- Clear separation of CLI, core logic, and utilities
- AI-friendly code with descriptive names

## Error Handling
- Let errors bubble up to CLI level for consistent user messaging
- Use native Error types with descriptive messages
- Exit with appropriate codes: 0 (success), 1 (general error), 2 (misuse)
- No try-catch in utility functions, handle at command level

## Logging
- Use console methods directly (no logging library)
- console.log() for normal output
- console.error() for errors (outputs to stderr)
- No verbose/debug modes initially (keep it simple)

## Testing Strategy
- Manual testing via `pnpm link` during development
- Smoke tests for critical paths only (init, help commands)
- No unit tests initially - add when complexity grows
- Test commands: `pnpm test:smoke` (when added)

## Development Workflow
- Use pnpm for all package management
- Run `pnpm run build` to compile TypeScript
- Run `pnpm run dev` for development mode
- Test locally with `pnpm link`
- Follow OpenSpec's own change-driven development process