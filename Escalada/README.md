# Escalada Backend (FastAPI)

Real-time climbing competition management backend using FastAPI + WebSockets.

## Quick Start

```bash
cd Escalada
poetry install
poetry run uvicorn escalada.main:app --reload --host 0.0.0.0 --port 8000
```

## Tests

```bash
cd Escalada
poetry run pytest tests -v --tb=short
```

## Formatting & Hooks

- Python formatting is enforced via pre-commit with Black and isort.
- On commit, the repository's `.husky/pre-commit` runs Black/isort for staged files under `Escalada/escalada/` and Prettier for frontend files.

Manual runs:

```bash
# Format all backend Python files (Black + isort)
cd Escalada
poetry run pre-commit run --all-files
```

Configuration files:
- `.pre-commit-config.yaml` (root)
- `.husky/pre-commit` (root)

