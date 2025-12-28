# Escalada Frontend (React + Vite)

Frontend UI for the Escalada real-time climbing competition system.

## Quick Start

```bash
cd Escalada/escalada-ui
npm install
npm run dev
```

## Tests

```bash
cd Escalada/escalada-ui
npm test -- --run
# E2E
npx playwright test --reporter=list
```

## Formatting & Hooks

- Frontend formatting is enforced with Prettier via Husky + lint-staged.
- On commit, staged files in `src/` are automatically formatted.

Manual format:

```bash
cd Escalada/escalada-ui
npm run format
```

Hook location:

- `.husky/pre-commit` (repo root) runs `npx lint-staged` inside `Escalada/escalada-ui`.

Backend Python files are formatted via Black/isort using `pre-commit`.
See the backend README for details.
