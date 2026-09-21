import SprintPlanner from "./SprintPlanner";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Orbit,
  LayoutDashboard,
  Layers,
  Columns3,
  List,
  CalendarDays,
  ChartNoAxesCombined,
  Users,
  Settings,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Minus,
  Check,
  CheckCheck,
  Square,
  TriangleAlert,
  BookOpen,
  SlidersHorizontal,
  X,
  LogOut,
  Activity,
  MessageSquare,
  Download,
  LoaderCircle,
} from "lucide-react";
import "./style.css";
const statuses = ["Backlog", "To do", "In progress", "In review", "Done"];
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Orbit-Request": "1" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok)
    throw Error(
      typeof b.detail === "string"
        ? b.detail
        : b.detail?.code
          ? b.detail.code.replaceAll("_", " ")
          : "Please check the form fields.",
    );
  return b;
}
const initials = (n) =>
  n
    ?.split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("") || "?";
const kindIcon = (t) =>
  t === "Bug" ? (
    <TriangleAlert size={13} />
  ) : t === "Story" ? (
    <BookOpen size={13} />
  ) : (
    <Check size={13} />
  );
function Avatar({ user, small = false }) {
  return (
    <span
      title={user?.name || "Unassigned"}
      className={"avatar a" + ((user?.id || 0) % 4) + (small ? " small" : "")}
    >
      {initials(user?.name)}
    </span>
  );
}
function App() {
  const [me, setMe] = useState(null),
    [loading, setLoading] = useState(true),
    [data, setData] = useState({
      workspace: null,
      projects: [],
      issues: [],
      users: [],
      activity: [],
      sprints: [],
    }),
    [projectId, setProjectId] = useState(1),
    [view, setView] = useState("Board"),
    [search, setSearch] = useState(""),
    [assignee, setAssignee] = useState(""),
    [priority, setPriority] = useState(""),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [authMode, setAuthMode] = useState("signin"),
    [signupMembers, setSignupMembers] = useState([]);
  const refresh = async () => {
    const d = await api("/workspace");
    setData(d);
    setProjectId((p) =>
      d.projects.some((x) => x.id === p) ? p : d.projects[0]?.id,
    );
  };
  useEffect(() => {
    api("/me")
      .then(async (u) => {
        setMe(u);
        await refresh();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const run = async (fn, msg) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      if (msg) setToast(msg);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const project = data.projects.find((p) => p.id === projectId),
    projectSprints = (data.sprints || []).filter((s) => s.project_id === projectId),
    todayString = new Date().toISOString().slice(0, 10),
    activeSprint =
      projectSprints.find(
        (s) => s.start_date <= todayString && s.end_date >= todayString,
      ) || projectSprints[0],
    all = data.issues.filter((i) => i.project_id === projectId),
    issues = all.filter(
      (i) =>
        (i.title + " " + i.key).toLowerCase().includes(search.toLowerCase()) &&
        (!assignee || String(i.assignee_id) === assignee) &&
        (!priority || i.priority === priority),
    );
  const editable = me?.role !== "viewer";
  const newIssue = (status = "To do") => {
    if (project)
      setModal({
        kind: "issue",
        item: {
          project_id: projectId,
          title: "",
          description: "",
          status,
          priority: "Medium",
          type: "Task",
          assignee_id: me.id,
          points: 0,
          sprint: "",
          version: 1,
        },
      });
    else setModal({ kind: "project" });
  };
  const move = (id, status) => {
    const i = data.issues.find((i) => i.id === Number(id));
    if (i && i.status !== status)
      run(() => api("/issues/" + i.id, "PUT", { ...i, status }), "Issue moved");
  };
  if (loading)
    return (
      <div className="loading">
        <Orbit size={36} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!me)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand">
            <Orbit /> orbit<span>WORKSPACE</span>
          </div>
          <h1>
            Great work.
            <br />
            In motion.
          </h1>
          <p>
            Bring your people, projects, and priorities into one shared orbit.
          </p>
          <div className="orbital">
            <div />
            <div />
            <Orbit size={90} />
          </div>
          <small>A little more clarity. A lot more progress.</small>
        </div>
        <form
          className={"login-form" + (authMode === "signup" ? " signup-form" : "")}
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const f = new FormData(e.target);
              const payload = Object.fromEntries(f);
              if (authMode === "signup")
                payload.members = signupMembers.filter(
                  (member) => member.name || member.email || member.password,
                );
              const account = await api(
                authMode === "signup" ? "/signup" : "/login",
                "POST",
                payload,
              );
              setMe(account);
              await refresh();
              if (authMode === "signup") setView("Team");
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">
            {authMode === "signup" ? "START A NEW WORKSPACE" : "WELCOME BACK"}
          </span>
          <h2>{authMode === "signup" ? "Create your workspace" : "Welcome back"}</h2>
          <p>
            {authMode === "signup"
              ? "Set up your company and first project. You’ll be the workspace admin."
              : "Sign in to your team's workspace."}
          </p>
          {authMode === "signup" && (
            <>
              <label>
                Your name
                <input name="name" maxLength={100} placeholder="Alex Morgan" required />
              </label>
              <label>
                Company name
                <input name="company_name" maxLength={120} placeholder="Acme Studio" required />
              </label>
              <div className="auth-grid profile-onboarding">
                <label>
                  Your position
                  <input name="position" maxLength={120} placeholder="Product manager" />
                </label>
                <label>
                  Working on
                  <input name="working_on" maxLength={500} placeholder="Q4 launch" />
                </label>
              </div>
              <div className="auth-grid">
                <label>
                  First project
                  <input name="project_name" maxLength={100} placeholder="Website launch" required />
                </label>
                <label>
                  Project key
                  <input
                    name="project_key"
                    pattern="[A-Z][A-Z0-9]{1,9}"
                    maxLength={10}
                    placeholder="WEB"
                    onInput={(e) => { e.currentTarget.value = e.currentTarget.value.toUpperCase(); }}
                    required
                  />
                </label>
              </div>
              <div className="signup-team">
                <div className="signup-team-heading">
                  <div>
                    <strong>Project members</strong>
                    <small>Add the people who should start in this workspace.</small>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setSignupMembers((members) => [
                        ...members,
                        { name: "", email: "", password: "", role: "member" },
                      ])
                    }
                  >
                    <Plus size={14} /> Add member
                  </button>
                </div>
                {signupMembers.map((member, index) => (
                  <div className="signup-member" key={index}>
                    <input
                      aria-label={`Member ${index + 1} name`}
                      maxLength={100}
                      placeholder="Member name"
                      value={member.name}
                      onChange={(event) =>
                        setSignupMembers((members) =>
                          members.map((item, memberIndex) =>
                            memberIndex === index ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                      required
                    />
                    <input
                      aria-label={`Member ${index + 1} email`}
                      type="email"
                      placeholder="member@company.com"
                      value={member.email}
                      onChange={(event) =>
                        setSignupMembers((members) =>
                          members.map((item, memberIndex) =>
                            memberIndex === index ? { ...item, email: event.target.value } : item,
                          ),
                        )
                      }
                      required
                    />
                    <input
                      aria-label={`Member ${index + 1} initial password`}
                      type="password"
                      minLength={12}
                      placeholder="Initial password"
                      value={member.password}
                      onChange={(event) =>
                        setSignupMembers((members) =>
                          members.map((item, memberIndex) =>
                            memberIndex === index ? { ...item, password: event.target.value } : item,
                          ),
                        )
                      }
                      required
                    />
                    <select
                      aria-label={`Member ${index + 1} role`}
                      value={member.role}
                      onChange={(event) =>
                        setSignupMembers((members) =>
                          members.map((item, memberIndex) =>
                            memberIndex === index ? { ...item, role: event.target.value } : item,
                          ),
                        )
                      }
                    >
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove member ${index + 1}`}
                      onClick={() =>
                        setSignupMembers((members) =>
                          members.filter((_, memberIndex) => memberIndex !== index),
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <label>
            Email address
            <input
              name="email"
              type="email"
              placeholder="you@company.com"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              placeholder="Enter your password"
              minLength={12}
              required
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy
              ? authMode === "signup"
                ? "Creating workspace…"
                : "Signing in…"
              : authMode === "signup"
                ? "Create workspace"
                : "Sign in to Orbit"}
            <ArrowUpRight size={17} />
          </button>
          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setAuthMode(authMode === "signup" ? "signin" : "signup");
              setError("");
            }}
          >
            {authMode === "signup"
              ? "Already have a workspace? Sign in"
              : "New to Orbit? Create a workspace"}
          </button>
          <small>
            {authMode === "signup"
              ? "You can add more people later from Team & access."
              : "Use the credentials for your workspace account."}
          </small>
        </form>
      </div>
    );
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <Orbit size={29} /> orbit<span>TEAM SPACE</span>
        </div>
        <button className="workspace" onClick={() => setView("Projects")}>
          <span className="workspace-icon">
            {(data.workspace?.name || "O").charAt(0).toUpperCase()}
          </span>
          <div>
            {data.workspace?.name || "Orbit workspace"}
            <small>
              {data.users.length} members · {data.projects.length} projects
            </small>
          </div>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        {[
          ["Overview", LayoutDashboard],
          ["Projects", Layers],
          ["My issues", CheckCheck],
          ["Activity", Activity],
        ].map(([n, I]) => (
          <button
            key={n}
            className={"nav " + (view === n ? "active" : "")}
            onClick={() => setView(n)}
          >
            <I size={18} />
            {n}
            {n === "My issues" && (
              <span className="count">
                {
                  data.issues.filter(
                    (i) => i.assignee_id === me.id && i.status !== "Done",
                  ).length
                }
              </span>
            )}
          </button>
        ))}
        <div className="nav-label project-label">
          YOUR PROJECTS
          <button
            aria-label="Create project"
            onClick={() => setModal({ kind: "project" })}
          >
            <Plus size={15} />
          </button>
        </div>
        {data.projects.map((p) => (
          <button
            key={p.id}
            className={"nav " + (projectId === p.id ? "project-active" : "")}
            onClick={() => {
              setProjectId(p.id);
              setView("Board");
            }}
          >
            <span className="project-dot" />
            {p.name}
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="tip">
            <span className="live-dot" /> Built for momentum
            <p>
              One place for your team's
              <br />
              next big thing.
            </p>
            <button onClick={() => setView("Reports")}>
              See team progress <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className={"nav " + (view === "Team" ? "active" : "")}
            onClick={() => setView("Team")}
          >
            <Users size={18} />
            Team & access
          </button>
          <div className="profile">
            <Avatar user={me} />
            <div>
              {me.name}
              <small>{me.position || (me.role === "admin" ? "Workspace admin" : me.role)}</small>
            </div>
            <button
              title="Open sign out page"
              onClick={() => setView("Sign out")}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            Workspace <ChevronRight size={13} />
            <span>{project?.name || "Projects"}</span>
          </div>
          <div className="header-right">
            <span className="live-dot" />{" "}
            {busy
              ? "Saving changes…"
              : error
                ? "Action needs attention"
                : "All changes saved"}{" "}
            <span className="header-divider" />
            <Avatar user={me} small />
          </div>
        </header>
        <section className="page">
          <div className="breadcrumbs">
            PROJECTS <span>/</span> {project?.key || "WORKSPACE"}
          </div>
          <div className="page-title">
            <div>
              <h1>
                {["Board", "List", "Backlog", "Sprints", "Reports"].includes(
                  view,
                )
                  ? project?.name || "Your workspace"
                  : view === "Overview"
                    ? "Workspace overview"
                    : view === "Team"
                      ? "Team & access"
                      : view === "Sign out"
                        ? "Sign out"
                      : view}
              </h1>
              <p>
                {["Board", "List", "Backlog", "Sprints"].includes(view)
                  ? project?.description || "Create a project to get started."
                  : view === "Reports"
                    ? "A clear view of your team’s progress and priorities."
                    : view === "Team"
                      ? "Good work starts with great people."
                      : view === "Sign out"
                        ? "Finish your session securely."
                      : view === "Activity"
                        ? "Every update, in one shared timeline."
                        : "Bring focus to what matters. Keep your team moving forward."}
              </p>
            </div>
            {view !== "Sign out" && <div className="title-actions">
              <div className="avatar-stack">
                {data.users.slice(0, 4).map((u) => (
                  <Avatar key={u.id} user={u} small />
                ))}
              </div>
              {editable && (
                <button className="primary" onClick={() => newIssue()}>
                  <Plus size={16} /> Create issue
                </button>
              )}
            </div>}
          </div>
          {view !== "Sign out" && <div className="tabs">
            {[
              ["Board", Columns3],
              ["List", List],
              ["Backlog", Layers],
              ["Sprints", CalendarDays],
              ["Reports", ChartNoAxesCombined],
            ].map(([n, I]) => (
              <button
                key={n}
                className={view === n ? "selected" : ""}
                onClick={() => setView(n)}
              >
                <I size={16} />
                {n}
              </button>
            ))}
            <span className="project-status">
              <span className="live-dot" /> Project active
            </span>
          </div>}
          {error && (
            <div className="error dismiss">
              {error}
              <button onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "Sign out" && (
            <div className="panel signout-page">
              <span className="signout-icon"><LogOut size={28} /></span>
              <span className="eyebrow">END THIS SESSION</span>
              <h2>Ready to sign out?</h2>
              <p>You’ll need your email and password to open this workspace again.</p>
              <div className="signout-actions">
                <button className="secondary" onClick={() => setView("Overview")} disabled={busy}>
                  Stay signed in
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api("/logout", "POST");
                      setMe(null);
                      setAuthMode("signin");
                      setView("Overview");
                      setData({ workspace: null, projects: [], issues: [], users: [], activity: [], sprints: [] });
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <LogOut size={16} /> {busy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          )}
          {["Board", "List", "Backlog", "My issues"].includes(view) && (
            <>
              <div className="toolbar">
                <div className="filters">
                  <label className="search">
                    <Search size={16} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search issues…"
                    />
                  </label>
                  <select
                    aria-label="Filter by assignee"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">All assignees</option>
                    {data.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    <option value="">All priorities</option>
                    {["Urgent", "High", "Medium", "Low"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  {(search || assignee || priority) && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setSearch("");
                        setAssignee("");
                        setPriority("");
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <span className="muted">{issues.length} issues</span>
              </div>
              {view === "Board" ? (
                <>
                  <div className="sprint-banner">
                    <div>
                      <span className="sprint-icon">
                        <CalendarDays size={18} />
                      </span>
                      <strong>{activeSprint?.name || "No sprint yet"}</strong>
                      <span className="pill">
                        {activeSprint ? "Current sprint" : "Plan your first sprint"}
                      </span>
                      <span className="muted">
                        Small steps. Meaningful progress.
                      </span>
                    </div>
                    <button onClick={() => setView("Sprints")}>
                      View sprint <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="board">
                    {statuses.slice(1).map((s, idx) => (
                      <section
                        key={s}
                        className={"column col-" + idx}
                        onDragOver={(e) => {
                          if (editable) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          move(e.dataTransfer.getData("text/plain"), s);
                        }}
                      >
                        <div className="column-head">
                          <span className={"status-dot status-" + idx} />
                          <strong>{s}</strong>
                          <span className="count">
                            {issues.filter((i) => i.status === s).length}
                          </span>
                          {editable && (
                            <button
                              aria-label={"Add issue to " + s}
                              onClick={() => newIssue(s)}
                            >
                              <Plus size={16} />
                            </button>
                          )}
                        </div>
                        <div className="cards">
                          {issues
                            .filter((i) => i.status === s)
                            .map((i) => (
                              <article
                                key={i.id}
                                className="issue-card"
                                draggable={editable}
                                onDragStart={(e) =>
                                  e.dataTransfer.setData(
                                    "text/plain",
                                    String(i.id),
                                  )
                                }
                                onClick={() =>
                                  setModal({ kind: "issue", item: i })
                                }
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    setModal({ kind: "issue", item: i });
                                }}
                              >
                                <div className="card-top">
                                  <span className={"kind " + i.type}>
                                    {kindIcon(i.type)} {i.key}
                                  </span>
                                  <span className={"priority " + i.priority}>
                                    {i.priority === "High" ||
                                    i.priority === "Urgent" ? (
                                      <ArrowUp size={12} />
                                    ) : i.priority === "Low" ? (
                                      <ArrowDown size={12} />
                                    ) : (
                                      <Minus size={12} />
                                    )}{" "}
                                    {i.priority}
                                  </span>
                                </div>
                                <h3>{i.title}</h3>
                                <span className={"tag " + i.type}>
                                  {i.type === "Bug"
                                    ? "Bug fix"
                                    : i.type === "Story"
                                      ? "Feature"
                                      : "Platform"}
                                </span>
                                <div className="card-footer">
                                  <span className="points">
                                    {i.points} <span>pts</span>
                                  </span>
                                  <Avatar
                                    small
                                    user={data.users.find(
                                      (u) => u.id === i.assignee_id,
                                    )}
                                  />
                                </div>
                              </article>
                            ))}
                          {editable && (
                            <button
                              className="add-card"
                              onClick={() => newIssue(s)}
                            >
                              <Plus size={15} /> Add issue
                            </button>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                  <div className="board-footer">
                    <span>
                      <span className="live-dot" /> Your team's work, in motion
                    </span>
                    <span>Drag issues between columns to update status</span>
                  </div>
                </>
              ) : (
                <IssueTable
                  issues={issues.filter((i) =>
                    view === "Backlog"
                      ? i.status === "Backlog"
                      : view === "My issues"
                        ? i.assignee_id === me.id
                        : true,
                  )}
                  users={data.users}
                  open={(i) => setModal({ kind: "issue", item: i })}
                />
              )}
            </>
          )}
          {["Overview", "Reports"].includes(view) && (
            <>
              <div className="stats">
                {[
                  ["Total issues", all.length, "Across this project"],
                  [
                    "In progress",
                    all.filter((i) => i.status === "In progress").length,
                    "Work moving forward",
                  ],
                  [
                    "Completed",
                    all.filter((i) => i.status === "Done").length,
                    "Delivered by the team",
                  ],
                  [
                    "Completion rate",
                    (all.length
                      ? Math.round(
                          (all.filter((i) => i.status === "Done").length /
                            all.length) *
                            100,
                        )
                      : 0) + "%",
                    "Based on issue count",
                  ],
                ].map(([t, v, s]) => (
                  <div className="stat" key={t}>
                    <span>{t}</span>
                    <strong>{v}</strong>
                    <small>{s}</small>
                  </div>
                ))}
              </div>
              <div className="report-grid">
                <div className="panel">
                  <h3>Work by status</h3>
                  <p>Where your project stands right now</p>
                  {statuses.map((s, index) => (
                    <div className="bar-row" key={s}>
                      <span>{s}</span>
                      <div>
                        <i
                          style={{
                            width:
                              (all.length
                                ? (all.filter((i) => i.status === s).length /
                                    all.length) *
                                  100
                                : 0) + "%",
                            background: [
                              "#acbdbe",
                              "#7f9da4",
                              "#eb792e",
                              "#3aadae",
                              "#168a76",
                            ][index],
                          }}
                        />
                      </div>
                      <b>{all.filter((i) => i.status === s).length}</b>
                    </div>
                  ))}
                </div>
                <div className="panel">
                  <h3>Team workload</h3>
                  <p>Open issues assigned to each teammate</p>
                  {data.users.map((u) => (
                    <div className="workload" key={u.id}>
                      <Avatar user={u} small />
                      <span>{u.name}</span>
                      <b>
                        {
                          all.filter(
                            (i) =>
                              i.assignee_id === u.id && i.status !== "Done",
                          ).length
                        }
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {view === "Sprints" && (
            <SprintPlanner
              key={projectId}
              issues={all}
              sprints={(data.sprints||[]).filter(s=>s.project_id===projectId)}
              createSprint={async b=>{await api("/sprints","POST",{...b,project_id:projectId});await refresh();setToast("Sprint created");}}
              users={data.users}
              editable={editable}
              open={(i) => setModal({ kind: "issue", item: i })}
              create={(day, sprint) =>
                setModal({
                  kind: "issue",
                  item: {
                    project_id: projectId,
                    title: "",
                    description: "",
                    status: "To do",
                    priority: "Medium",
                    type: "Task",
                    assignee_id: me.id,
                    points: 0,
                    sprint: sprint || "",
                    version: 1,
                    start_date: day,
                    due_date: day,
                  },
                })
              }
            />
          )}
          {view === "Projects" && (
            <div className="project-grid">
              {data.projects.map((p) => (
                <button
                  key={p.id}
                  className="panel project-tile"
                  onClick={() => {
                    setProjectId(p.id);
                    setView("Board");
                  }}
                >
                  <span className="workspace-icon">
                    <Layers size={22} />
                  </span>
                  <h3>
                    {p.name}
                    <ArrowUpRight size={18} />
                  </h3>
                  <p>{p.description}</p>
                  <small>
                    {data.issues.filter((i) => i.project_id === p.id).length}{" "}
                    issues <span>•</span> {p.key}
                  </small>
                </button>
              ))}
              {editable && (
                <button
                  className="new-project"
                  onClick={() => setModal({ kind: "project" })}
                >
                  <Plus />
                  Create project
                </button>
              )}
            </div>
          )}
          {view === "Activity" && (
            <div className="panel activity-list">
              {data.activity.length ? (
                data.activity.map((a) => (
                  <div key={a.id}>
                    <Avatar user={data.users.find((u) => u.id === a.user_id)} />
                    <p>
                      <strong>{a.name}</strong> {a.action}
                      <small>{new Date(a.created_at).toLocaleString()}</small>
                    </p>
                  </div>
                ))
              ) : (
                <Empty />
              )}
            </div>
          )}
          {view === "Team" && (
            <div className="panel">
              <div className="profile-settings">
                <div>
                  <span className="eyebrow">YOUR PROFILE</span>
                  <h3>{me.name}</h3>
                  <p>{me.email} · {me.role}</p>
                  <p>{me.position || "Position not set"} · {me.project_name || "No primary project"}</p>
                  <p className="working-on"><strong>Working on:</strong> {me.working_on || "Not specified yet"}</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => setModal({ kind: "profile", item: { ...me } })}
                >
                  <Settings size={15} /> Edit profile
                </button>
              </div>
              <div className="section-heading">
                <div>
                  <h2>Your people</h2>
                  <p>
                    {data.users.length} members in {data.workspace?.name || "your workspace"}
                  </p>
                </div>
                {me.role === "admin" && (
                  <button
                    className="primary"
                    onClick={() => setModal({ kind: "member" })}
                  >
                    <Plus size={16} /> Add member
                  </button>
                )}
              </div>
              {data.users.map((u) => (
                <div className="member-row" key={u.id}>
                  <Avatar user={u} />
                  <div>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                    <small>{u.position || "Position not set"} · {u.project_name || "No primary project"}</small>
                    {u.working_on && <small>Working on: {u.working_on}</small>}
                  </div>
                  <span className="pill">{u.role}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      {toast && (
        <div className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <Modal
          modal={modal}
          sprints={(data.sprints||[]).filter(s=>s.project_id===modal.item?.project_id)}
          close={() => {
            setModal(null);
            setError("");
          }}
          users={data.users}
          projects={data.projects}
          editable={editable}
          busy={busy}
          error={error}
          save={async (kind, b) => {
            if (kind === "profile") {
              setBusy(true);
              setError("");
              try {
                const updated = await api("/profile", "PUT", {
                  name: b.name,
                  position: b.position || "",
                  primary_project_id: b.primary_project_id || null,
                  working_on: b.working_on || "",
                });
                setMe(updated);
                await refresh();
                setToast("Profile updated");
                setModal(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
              return;
            }
            const ok = await run(
              () =>
                api(
                  kind === "issue"
                    ? "/issues" + (b.id ? "/" + b.id : "")
                    : kind === "project"
                      ? "/projects"
                      : "/members",
                  kind === "issue" && b.id ? "PUT" : "POST",
                  b,
                ),
              kind === "issue"
                ? "Issue saved"
                : kind === "project"
                  ? "Project created"
                  : "Member added",
            );
            if (ok) setModal(null);
          }}
        />
      )}
    </div>
  );
}
function Empty() {
  return (
    <div className="empty">
      <Layers size={30} />
      <h3>Nothing here yet</h3>
      <p>Your next great piece of work starts with an issue.</p>
    </div>
  );
}
function IssueTable({ issues, users, open }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr
              key={i.id}
              onClick={() => open(i)}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && open(i)}
            >
              <td>
                <span className={"kind " + i.type}>
                  {kindIcon(i.type)} {i.key}
                </span>
                <strong>{i.title}</strong>
              </td>
              <td>
                <span className="pill">{i.status}</span>
              </td>
              <td>
                <span className={"priority " + i.priority}>{i.priority}</span>
              </td>
              <td>
                <Avatar
                  small
                  user={users.find((u) => u.id === i.assignee_id)}
                />
              </td>
              <td>{i.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!issues.length && <Empty />}
    </div>
  );
}
function Modal({ modal, close, users, projects, editable, busy, error, save, sprints=[] }) {
  const [b, setB] = useState(
      modal.item || {
        name: "",
        key: "",
        description: "",
        email: "",
        password: "",
        role: "member",
        position: "",
        primary_project_id: null,
        working_on: "",
      },
    ),
    [comments, setComments] = useState([]),
    [comment, setComment] = useState(""),
    [commentError, setCommentError] = useState(""),
    [commentBusy, setCommentBusy] = useState(false);
  useEffect(() => {
    if (b.id)
      api("/issues/" + b.id + "/comments")
        .then(setComments)
        .catch((e) => setCommentError(e.message));
    const f = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  const field = (k, v) => setB((previous) => ({ ...previous, [k]: v }));
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <span className="eyebrow">{b.key || "ORBIT WORKSPACE"}</span>
          <button aria-label="Close dialog" onClick={close}>
            <X size={21} />
          </button>
        </div>
        <h2 id="modal-title">
          {modal.kind === "issue"
            ? b.id
              ? "Issue details"
              : "Create an issue"
            : modal.kind === "project"
              ? "Create a project"
              : modal.kind === "profile"
                ? "Edit profile"
                : "Add team member"}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(modal.kind, b);
          }}
        >
          <fieldset disabled={(!editable && modal.kind !== "profile") || busy}>
            {modal.kind === "issue" ? (
              <>
                <label>
                  Title
                  <input
                    autoFocus
                    required
                    maxLength={250}
                    value={b.title}
                    onChange={(e) => field("title", e.target.value)}
                    placeholder="What needs to be done?"
                  />
                </label>
                <label>
                  Description
                  <textarea
                    rows={5}
                    value={b.description}
                    onChange={(e) => field("description", e.target.value)}
                    placeholder="Add context and acceptance criteria…"
                  />
                </label>
                <div className="form-grid">
                  {[
                    ["Status", "status", statuses],
                    [
                      "Priority",
                      "priority",
                      ["Low", "Medium", "High", "Urgent"],
                    ],
                    ["Type", "type", ["Task", "Story", "Bug"]],
                  ].map(([label, key, options]) => (
                    <label key={key}>
                      {label}
                      <select
                        value={b[key]}
                        onChange={(e) => field(key, e.target.value)}
                      >
                        {options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    Assignee
                    <select
                      value={b.assignee_id || ""}
                      onChange={(e) =>
                        field(
                          "assignee_id",
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Story points
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={b.points}
                      onChange={(e) => field("points", Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Start date
                    <input
                      type="date"
                      value={b.start_date || ""}
                      max={b.due_date || undefined}
                      onInput={(e) =>
                        field("start_date", e.currentTarget.value)
                      }
                      onChange={(e) => field("start_date", e.target.value)}
                    />
                  </label>
                  <label>
                    Due date
                    <input
                      type="date"
                      value={b.due_date || ""}
                      min={b.start_date || undefined}
                      onInput={(e) => field("due_date", e.currentTarget.value)}
                      onChange={(e) => field("due_date", e.target.value)}
                    />
                  </label>
                  <label>
                    Sprint
                    <select value={b.sprint} onChange={e=>field("sprint",e.target.value)}>
                      <option value="">No sprint</option>
                      {[...new Set([...sprints.map(s=>s.name),b.sprint].filter(Boolean))].map(name=><option key={name}>{name}</option>)}
                    </select>
                  </label>
                </div>
              </>
            ) : modal.kind === "profile" ? (
              <>
                <label>
                  Profile name
                  <input
                    autoFocus
                    required
                    maxLength={100}
                    value={b.name}
                    onChange={(e) => field("name", e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Position
                    <input
                      maxLength={120}
                      value={b.position || ""}
                      onChange={(e) => field("position", e.target.value)}
                      placeholder="Product designer"
                    />
                  </label>
                  <label>
                    Primary project
                    <select
                      value={b.primary_project_id || ""}
                      onChange={(e) => field("primary_project_id", e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">No primary project</option>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  Working on
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={b.working_on || ""}
                    onChange={(e) => field("working_on", e.target.value)}
                    placeholder="What are you focused on right now?"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Name
                  <input
                    autoFocus
                    required
                    value={b.name}
                    onChange={(e) => field("name", e.target.value)}
                  />
                </label>
                {modal.kind === "project" ? (
                  <>
                    <label>
                      Project key
                      <input
                        required
                        pattern="[A-Z][A-Z0-9]{1,9}"
                        placeholder="e.g. WEB"
                        value={b.key}
                        onChange={(e) =>
                          field("key", e.target.value.toUpperCase())
                        }
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        value={b.description}
                        onChange={(e) => field("description", e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Email
                      <input
                        required
                        type="email"
                        value={b.email}
                        onChange={(e) => field("email", e.target.value)}
                      />
                    </label>
                    <label>
                      Initial password
                      <input
                        required
                        type="password"
                        minLength={12}
                        value={b.password}
                        onChange={(e) => field("password", e.target.value)}
                      />
                    </label>
                    <label>
                      Role
                      <select
                        value={b.role}
                        onChange={(e) => field("role", e.target.value)}
                      >
                        <option value="member">
                          Member — edit projects and issues
                        </option>
                        <option value="viewer">
                          Viewer — read-only access
                        </option>
                        <option value="admin">
                          Admin — manage team access
                        </option>
                      </select>
                    </label>
                    <div className="form-grid">
                      <label>
                        Position
                        <input
                          maxLength={120}
                          value={b.position || ""}
                          onChange={(e) => field("position", e.target.value)}
                          placeholder="Engineer"
                        />
                      </label>
                      <label>
                        Primary project
                        <select
                          value={b.primary_project_id || ""}
                          onChange={(e) => field("primary_project_id", e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">No primary project</option>
                          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                      </label>
                    </div>
                    <label>
                      Working on
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={b.working_on || ""}
                        onChange={(e) => field("working_on", e.target.value)}
                        placeholder="Current focus or responsibility"
                      />
                    </label>
                  </>
                )}
              </>
            )}
          </fieldset>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            {(editable || modal.kind === "profile") && (
              <button className="primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : modal.kind === "issue"
                    ? "Save issue"
                    : modal.kind === "project"
                      ? "Create project"
                      : modal.kind === "profile"
                        ? "Save profile"
                        : "Add member"}
              </button>
            )}
          </div>
        </form>
        {b.id && (
          <div className="comments">
            <h3>
              <MessageSquare size={16} /> Discussion
            </h3>
            {comments.map((c) => (
              <div className="comment" key={c.id}>
                <strong>{c.name}</strong>
                <small>{new Date(c.created_at).toLocaleString()}</small>
                <p>{c.body}</p>
              </div>
            ))}
            {!comments.length && (
              <p className="muted">Keep the conversation close to the work.</p>
            )}
            {commentError && <div className="error">{commentError}</div>}
            {editable && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setCommentBusy(true);
                  try {
                    await api("/issues/" + b.id + "/comments", "POST", {
                      body: comment,
                    });
                    setComment("");
                    setComments(await api("/issues/" + b.id + "/comments"));
                    setCommentError("");
                  } catch (e) {
                    setCommentError(e.message);
                  } finally {
                    setCommentBusy(false);
                  }
                }}
              >
                <input
                  aria-label="Comment"
                  placeholder="Write a comment…"
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button className="secondary" disabled={commentBusy}>
                  Post
                </button>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
