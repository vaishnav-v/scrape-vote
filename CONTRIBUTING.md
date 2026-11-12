# Contributing

Contributions are welcome!

## Development Workflow

1. Fork and clone the repository.
2. Install dependencies:
   ```bash
   npm install
   npx playwright install chromium
   ```
3. Copy `.env.example` to `.env` and adjust settings if needed.
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Before opening a pull request, ensure TypeScript typechecking and build pass cleanly:
   ```bash
   npm run typecheck
   npm run build
   ```

## Guidelines

- Keep configuration in `src/config/env.ts` (`.env`) and portal-specific constants/selectors in `src/config/constants.ts`.
- Do not commit `.env`, `node_modules/`, `dist/`, `downloads/`, `captchas/`, `logs/`, or generated `combinations.json` files.
- Keep functions focused, strongly typed, and documented where behavior is non-obvious.

