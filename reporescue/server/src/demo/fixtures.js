const BEACON_README = `# Beacon API

Beacon is a small, dependency-light event ingestion API for product analytics.
It accepts batched events over HTTP, validates them, and writes them to a
Postgres database.

## Getting started

Clone the repository and install dependencies:

~~~bash
npm install
~~~

Then start the development server:

~~~bash
npm run dev
~~~

The server listens on port 3000 by default.

## Architecture

- \`src/app.ts\` wires the HTTP layer and middleware.
- \`src/routes/events.ts\` validates and accepts event batches.
- \`src/store/postgres.ts\` persists accepted events.

## Deploying

Build the project with \`npm run build\` and run \`npm start\`.

## License

Not decided yet.

## Support

Open an issue if something looks broken.
`;
const BEACON_PACKAGE_JSON = `{
  "name": "beacon-api",
  "version": "0.8.2",
  "private": true,
  "description": "Event ingestion API for product analytics.",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.12.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.16.2",
    "typescript": "^5.5.4"
  }
}
`;
const BEACON_LOCK = `{
  "name": "beacon-api",
  "version": "0.8.2",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "beacon-api",
      "version": "0.8.2"
    }
  }
}
`;
const BEACON_ENV = `export type Env = {
  DATABASE_URL: string;
  JWT_SECRET: string;
  PORT: string;
};

export function readEnv(): Env {
  const env: Env = {
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    JWT_SECRET: process.env.JWT_SECRET ?? "",
    PORT: process.env.PORT ?? "3000",
  };

  const missing = Object.entries(env)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(\`Missing environment variables: \${missing.join(", ")}\`);
  }

  return env;
}
`;
const BEACON_APP = `import express from "express";
import { eventsRouter } from "./routes/events.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/v1/events", eventsRouter);
  return app;
}
`;
const BEACON_SERVER = `import { createApp } from "./app.js";
import { readEnv } from "./config/env.js";

const env = readEnv();
const app = createApp();

app.listen(Number(env.PORT), () => {
  console.log("beacon-api listening");
});
`;
const BEACON_EVENTS = `import { Router } from "express";
import { z } from "zod";
import { insertEvents } from "../store/postgres.js";

const eventSchema = z.object({
  name: z.string().min(1).max(120),
  occurredAt: z.string().datetime(),
  properties: z.record(z.unknown()).optional(),
});

export const eventsRouter = Router();

eventsRouter.post("/", async (req, res) => {
  const parsed = z.array(eventSchema).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_event_batch" });
    return;
  }
  await insertEvents(parsed.data);
  res.status(202).json({ accepted: parsed.data.length });
});
`;
const BEACON_STORE = `import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function insertEvents(events: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const event of events) {
      await client.query("insert into events (payload) values ($1)", [event]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
`;
const BEACON_GITIGNORE = `node_modules/
dist/
.env
*.log
`;
const BEACON_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
`;
const TIDE_README = `# Tidewatch

Tidewatch streams tide-gauge readings, normalises them and stores hourly
aggregates for coastal monitoring dashboards.

## Requirements

- Python 3.11 or newer
- Poetry 1.8+
- A Postgres 15 database

## Installation

~~~bash
git clone https://github.com/tidewatch-labs/tidewatch.git
cd tidewatch
poetry install --with dev
~~~

Copy \`.env.example\` to \`.env\` and set \`TIDE_DB_URL\`.

## Usage

~~~bash
poetry run tidewatch ingest --station hornbaek
poetry run tidewatch report --days 7
~~~

## Testing

~~~bash
poetry run pytest
~~~

Tests run against an in-memory SQLite database, so Postgres is not required
for the test suite.

## Architecture

- \`src/tidewatch/ingest.py\` fetches and normalises readings.
- \`src/tidewatch/report.py\` builds aggregates.
- \`tests/\` covers ingestion, normalisation and reporting.

## License

MIT
`;
const TIDE_PYPROJECT = `[tool.poetry]
name = "tidewatch"
version = "1.4.0"
description = "Coastal tide-gauge ingestion and aggregation"
authors = ["Tidewatch Maintainers <maintainers@tidewatch.dev>"]
license = "MIT"
readme = "README.md"

[tool.poetry.dependencies]
python = "^3.11"
click = "^8.1.7"
sqlalchemy = "^2.0.30"

[tool.poetry.group.dev.dependencies]
pytest = "^8.2.0"
ruff = "^0.5.0"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
`;
const TIDE_LOCK = `# This file is automatically @generated by Poetry 1.8.3.
[[package]]
name = "click"
version = "8.1.7"

[[package]]
name = "sqlalchemy"
version = "2.0.30"
`;
const TIDE_CONTRIBUTING = `# Contributing to Tidewatch

Thanks for helping out! Please open an issue before starting larger changes.

## Development setup

~~~bash
poetry install --with dev
poetry run pytest
~~~

## Pull requests

- Keep changes focused and covered by a test.
- Run \`poetry run ruff check .\` before pushing.
- Describe the problem and the validation you ran.
`;
const TIDE_CI = `name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
      - name: Install
        run: pip install poetry && poetry install --with dev
      - name: Tests
        run: poetry run pytest
`;
const TIDE_LICENSE = `MIT License

Copyright (c) 2026 Tidewatch Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`;
const TIDE_GITIGNORE = `__pycache__/
.venv/
.env
dist/
*.sqlite
`;
const TIDE_INGEST = `import os

from sqlalchemy import create_engine

DATABASE_URL = os.environ.get("TIDE_DB_URL", "sqlite:///tidewatch.sqlite")


def engine():
    return create_engine(DATABASE_URL)
`;
const TIDE_TEST = `from tidewatch.ingest import engine


def test_engine_is_configured():
    assert engine() is not None
`;
function meta(owner, name, overrides) {
    return {
        owner,
        name,
        fullName: `${owner}/${name}`,
        url: `https://github.com/${owner}/${name}`,
        defaultBranch: "main",
        description: null,
        topics: [],
        license: null,
        stars: 0,
        openIssues: 0,
        pushedAt: null,
        primaryLanguage: null,
        fixture: true,
        ...overrides,
    };
}
export const DEMO_FIXTURES = [
    {
        id: "beacon-api",
        label: "Beacon API (TypeScript)",
        description: "A Node/TypeScript event-ingestion API with a thin README, no CI and required environment variables that are documented nowhere.",
        headline: "Onboarding is guesswork: three required env vars, no CI, no tests.",
        fixtureNote: "Bundled fixture · deterministic · the same analysis rules run as for a live scan",
        repository: meta("beacon-labs", "beacon-api", {
            description: "Event ingestion API for product analytics.",
            topics: [],
            license: null,
            stars: 1284,
            openIssues: 37,
            pushedAt: "2026-01-18T09:12:00.000Z",
            primaryLanguage: "TypeScript",
        }),
        files: [
            { path: "README.md", content: BEACON_README },
            { path: "package.json", content: BEACON_PACKAGE_JSON },
            { path: "package-lock.json", content: BEACON_LOCK },
            { path: "tsconfig.json", content: BEACON_TSCONFIG },
            { path: ".gitignore", content: BEACON_GITIGNORE },
            { path: "src/app.ts", content: BEACON_APP },
            { path: "src/server.ts", content: BEACON_SERVER },
            { path: "src/config/env.ts", content: BEACON_ENV },
            { path: "src/routes/events.ts", content: BEACON_EVENTS },
            { path: "src/store/postgres.ts", content: BEACON_STORE },
        ],
        treeExtra: ["src", "src/config", "src/routes", "src/store"],
        limitations: [
            "Bundled demo fixture: findings reflect the fixture files only, not a live GitHub repository.",
            "No dependency installation or application execution is performed.",
        ],
        fetchedAt: "2026-02-10T12:00:00.000Z",
    },
    {
        id: "tidewatch",
        label: "Tidewatch (Python)",
        description: "A well documented Python/Poetry service with CI and contribution guidance, but a missing environment template and a README that documents a file it does not ship.",
        headline: "A healthy repository with a small, fixable onboarding inconsistency.",
        fixtureNote: "Bundled fixture · deterministic · used to show a high-scoring repository",
        repository: meta("tidewatch-labs", "tidewatch", {
            description: "Coastal tide-gauge ingestion and aggregation",
            topics: ["python", "monitoring", "data"],
            license: { spdxId: "MIT", name: "MIT License" },
            stars: 642,
            openIssues: 8,
            pushedAt: "2026-02-01T16:40:00.000Z",
            primaryLanguage: "Python",
        }),
        files: [
            { path: "README.md", content: TIDE_README },
            { path: "pyproject.toml", content: TIDE_PYPROJECT },
            { path: "poetry.lock", content: TIDE_LOCK },
            { path: "CONTRIBUTING.md", content: TIDE_CONTRIBUTING },
            { path: ".github/workflows/ci.yml", content: TIDE_CI },
            { path: "LICENSE", content: TIDE_LICENSE },
            { path: ".gitignore", content: TIDE_GITIGNORE },
            { path: "src/tidewatch/ingest.py", content: TIDE_INGEST },
            { path: "tests/test_ingest.py", content: TIDE_TEST },
        ],
        treeExtra: ["src", "src/tidewatch", "tests", ".github", ".github/workflows"],
        limitations: [
            "Bundled demo fixture: findings reflect the fixture files only, not a live GitHub repository.",
            "CI configuration is inspected statically; no workflow was executed.",
        ],
        fetchedAt: "2026-02-10T12:00:00.000Z",
    },
];
export const DEMO_REPOSITORIES = DEMO_FIXTURES.map((fixture) => ({
    id: fixture.id,
    label: fixture.label,
    repository: fixture.repository.fullName,
    description: fixture.description,
    ecosystem: fixture.repository.primaryLanguage ?? "Unknown",
    headline: fixture.headline,
    fixtureNote: fixture.fixtureNote,
}));
export function getDemoFixture(id) {
    return DEMO_FIXTURES.find((fixture) => fixture.id === id);
}
export function filesFromFixture(fixture) {
    return fixture.files.map((file) => ({
        path: file.path,
        content: file.content,
        bytes: Buffer.byteLength(file.content, "utf8"),
        truncated: false,
    }));
}
export { meta as buildRepositoryMeta };
