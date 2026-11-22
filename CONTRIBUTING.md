# Contributing to Another Dev Tool

Thank you for your interest in contributing to Another Dev Tool, a macOS app for managing the skills and agent rules on your machine.

## Code Standards

Biome lints and formats the frontend (`biome.jsonc`, on top of the Control UI preset); TypeScript runs in strict mode (`tsconfig.json`). The pre-commit hook fixes staged files and runs the tests.

### Quick Commands

- **Fix lint and formatting**: `bun run lint:fix`
- **Check lint and formatting**: `bun run lint`
- **Check types**: `bun run check-types`

### Core Principles

- **Type Safety**: Use explicit types for function parameters and return values. Prefer `unknown` over `any`.
- **Modern TypeScript**: Use arrow functions, `for...of` loops, optional chaining, and template literals.
- **Async Code**: Always `await` promises in async functions. Use `try-catch` blocks for error handling.
- **React Standards**: Use function components and hooks. Specify all dependencies in hook arrays.
- **File Organization**: Keep files under 400 lines and functions focused.

## Development Workflow

1.  **Fork the repository**: Create your own copy of the project.
2.  **Install dependencies**:
    ```bash
    bun install
    ```
3.  **Create a branch**:
    ```bash
    git checkout -b feature/your-feature-name
    ```
4.  **Develop**: Run the app:
    ```bash
    bun run dev
    ```
5.  **Verify**: Ensure your code passes the quality checks:
    ```bash
    bun run lint && bun run check-types && bun run test && bun run test:rust
    ```
6.  **Commit**: Use descriptive commit messages. Husky will run pre-commit hooks to ensure code quality.
7.  **Submit a Pull Request**: Provide a clear description of your changes and why they are needed.

## Style Guide

- Use meaningful variable names (avoid magic numbers).
- Use early returns to reduce nesting.
- Prefer simple conditionals over nested ternary operators.
- Group related code together and separate concerns.

## Testing

- Write assertions inside `it()` or `test()` blocks.
- Avoid done callbacks in async tests; use async/await instead.
- Do not include `.only` or `.skip` in committed code.

Thank you for helping make Another Dev Tool better!
