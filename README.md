# Orbit

A working Jira-style project workspace built with Python/FastAPI, React, and PostgreSQL. Includes self-service company signup, isolated workspaces, initial team onboarding, editable profiles with position, primary project and current focus, a sign-out confirmation page, project and sprint creation, Kanban drag and drop, searchable issue tables, story points, assignees, priorities, comments, team workload reports, a key-free local daily summary that learns from completed workspace data, a prioritized daily work report, workspace activity, and administrator/member/viewer roles.

## Deploy with GitHub, Vercel, and Supabase

This repository is ready for a single Vercel project: Vercel serves the compiled React frontend from its CDN and runs FastAPI as a Python Function. Supabase provides PostgreSQL.

### 1. Create the Supabase database

1. Create a Supabase project on the free plan and save its database password.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it once.
3. Open **Connect**, select **Transaction pooler**, and copy the connection string using port `6543`.
4. Replace the password placeholder with the URL-encoded database password. Keep `sslmode=require` in the URL.

Do not put the database URL, database password, or Orbit administrator password in GitHub.

### 2. Push to GitHub

Create a repository from this directory and push the source. The generated `public/` directory, dependencies, local environments, and Vercel metadata are ignored.

### 3. Create the Vercel project

1. In Vercel, import the GitHub repository and keep the repository root as the project root.
2. Do not select a frontend-only preset or override the build command. `pyproject.toml` declares the FastAPI entrypoint and the production frontend build.
3. In **Settings → Environment Variables**, add these values for Production, Preview, and Development:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase Transaction pooler URL on port `6543` |
   | `ORBIT_ADMIN_EMAIL` | Optional bootstrap administrator email |
   | `ORBIT_ADMIN_PASSWORD` | Optional bootstrap password of at least 12 characters |
   | `ORBIT_SEED_DEMO` | `1` to create sample data, otherwise `0` |
   | `ORBIT_SECURE_COOKIES` | `1` |
   | `ORBIT_REQUIRE_SSL` | `1` |

4. Deploy. Open `/api/health` on the assigned Vercel domain and confirm it returns `{"status":"ok"}`.
5. Open the root URL and create a workspace, or sign in with the optional bootstrap administrator credentials.

The administrator variables are optional and are used only when the database has no users. Without them, the first account is created through the signup form. Changing them later does not reset an existing administrator password. Choose the Vercel Function region nearest the Supabase project to reduce database latency.

## Run locally

Requires Python 3.11+, Node.js 20.19+, and a running PostgreSQL server (14+).

```sh
createdb orbit   # or: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/orbit'
export ORBIT_ADMIN_PASSWORD='choose-a-unique-password-at-least-12-characters'
export ORBIT_ADMIN_EMAIL='admin@orbit.local'
# Optional sample project and teammates, on first initialization only:
export ORBIT_SEED_DEMO=1
uvicorn main:app --host 127.0.0.1 --port 8017
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173 and use the administrator credentials configured above. Demo teammates have random inaccessible passwords; add real team members through Team & access. Never share a demo database with a production deployment.

## Single-server build

```sh
cd frontend
npm ci
npm run build
cd ../backend
# Set the administrator environment variables as above for first start.
uvicorn main:app --host 127.0.0.1 --port 8017
```

The Python service serves the compiled React app at http://localhost:8017. API documentation is at `/docs`. `DATABASE_URL` must be a `postgresql://` connection string. Database contents persist across restarts. Administrator environment settings only initialize an empty database; they do not reset an existing password.

## Verification

```sh
cd backend
pip install httpx
python3 -m unittest test_api -v
cd ../frontend
npm run build
```

Integration tests cover signup, workspace isolation, full profile editing, sprint creation, issue assignment, unauthenticated access, login/logout, issue persistence, stale-edit conflicts, comments, viewer permissions, request protection, and validation.

## Access model

- Admin: create a company workspace and first project, manage team accounts, and create/edit projects, sprints, issues, and comments.
- Member: create/edit projects, issues, and comments.
- Viewer: read-only access to the entire workspace.

Each account belongs to one isolated company workspace. New signups create an administrator, company, first project, and any initial members in one transaction. All members inside that workspace can see all of its projects; project-level permissions are not implemented. Passwords use salted PBKDF2-SHA256 with 600,000 iterations. Sessions use opaque random tokens, store token hashes in the database, expire after 12 hours, and use HttpOnly/SameSite cookies. Writes require a custom request header. Issue versions prevent silently overwriting stale edits. Database queries use bound values.

## Enterprise rollout boundary

This is a runnable application foundation, not a certified enterprise SaaS or complete Jira replacement. Before a large public rollout, configure TLS through a reverse proxy and set `ORBIT_SECURE_COOKIES=1`; restrict origins and trusted hosts; keep regular backups and run schema migrations deliberately as the app evolves; use a shared rate limiter; add email verification, invitations, SSO/MFA, password reset and account deactivation, project-level permissions, retention policy, monitoring, and security review. The built-in login limiter is process-local and intended for a single-process local deployment.

Sprint planning includes stored sprint names, goals, start/end dates, a monthly calendar, and a Gantt-style timeline. Issues can be created inside a sprint and assigned to workspace members. Set both start and due dates on an issue to schedule it; undated issues appear in Ready to schedule. Month navigation, sprint filters, day agendas, and date-cell issue creation are available. Existing databases gain the required workspace and date columns automatically at startup. Capacity planning, start/complete transitions, velocity history, and burndown are not implemented. Reports reflect current persisted issue counts. Activity is a workspace history, not an immutable compliance audit trail. Attachments, notifications, external integrations, and automated delivery pipelines are not included.

## Container deployment

A multi-stage Dockerfile and Compose configuration are included, with a `db` service (PostgreSQL 16) and an `orbit` service that connects to it via `DATABASE_URL`. The container runs as an unprivileged user; Postgres data lives in a named volume.

```sh
export POSTGRES_PASSWORD='choose-a-unique-password'
export ORBIT_ADMIN_PASSWORD='choose-a-unique-password-at-least-12-characters'
docker compose up --build -d
```

Open http://localhost:8017. The port binds to loopback by default. Put a TLS reverse proxy in front of it for network access and apply the enterprise rollout controls above. Stop the local development server before starting the container on the same port.
