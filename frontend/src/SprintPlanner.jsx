import React, { useState } from "react";
import {
  CalendarDays,
  GanttChart,
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarClock,
  ArrowUpRight,
} from "lucide-react";
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (s) => new Date(s + "T12:00:00");
const label = (s) =>
  dateOf(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const tone = (i) =>
  i.status === "Done"
    ? "done"
    : i.status === "In progress"
      ? "progress"
      : "planned";
export default function SprintPlanner({
  issues,
  sprints = [],
  users,
  editable,
  open,
  create,
  createSprint,
}) {
  const [mode, setMode] = useState("Calendar"),
    [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12),
    ),
    [sprint, setSprint] = useState(""),
    [selected, setSelected] = useState(null),
    [showSprintForm, setShowSprintForm] = useState(false),
    [savingSprint, setSavingSprint] = useState(false),
    [sprintError, setSprintError] = useState(""),
    [sprintDraft, setSprintDraft] = useState(() => {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 13);
      return { name: "", goal: "", start_date: iso(start), end_date: iso(end) };
    });
  const today = iso(new Date()),
    year = month.getFullYear(),
    m = month.getMonth(),
    total = new Date(year, m + 1, 0).getDate();
  const first = iso(month),
    last = iso(new Date(year, m + 1, 0, 12)),
    offset = (month.getDay() + 6) % 7;
  const days = Array.from(
    { length: Math.ceil((offset + total) / 7) * 7 },
    (_, n) => new Date(year, m, n - offset + 1, 12),
  );
  const names = [
    ...new Set([
      ...sprints.map((item) => item.name),
      ...issues.map((i) => i.sprint).filter(Boolean),
    ]),
  ].sort();
  const filtered = issues.filter((i) => !sprint || i.sprint === sprint);
  const scheduled = filtered.filter((i) => i.start_date && i.due_date);
  const unscheduled = filtered.filter((i) => !i.start_date || !i.due_date);
  const visible = scheduled.filter(
    (i) => i.start_date <= last && i.due_date >= first,
  );
  const onDay = (day) =>
    scheduled.filter((i) => i.start_date <= day && i.due_date >= day);
  const groups = [...new Set(visible.map((i) => i.sprint || "No sprint"))];
  const shift = (n) => {
    setMonth(new Date(year, m + n, 1, 12));
    setSelected(null);
  };
  return (
    <section className="planner">
      <div className="planner-heading">
        <div>
          <span className="eyebrow">MAKE ROOM FOR GREAT WORK</span>
          <h2>Sprint calendar</h2>
          <p>Plan the days. See the bigger picture.</p>
        </div>
        <div className="planner-heading-actions">
          {editable && (
            <button
              className="secondary"
              onClick={() => {
                setShowSprintForm(!showSprintForm);
                setSprintError("");
              }}
            >
              <Plus size={15} /> Create sprint
            </button>
          )}
          <div className="planner-switch" aria-label="Schedule view">
            {[
              ["Calendar", CalendarDays],
              ["Timeline", GanttChart],
            ].map(([name, Icon]) => (
              <button
                key={name}
                aria-pressed={mode === name}
                className={mode === name ? "chosen" : ""}
                onClick={() => {
                  setMode(name);
                  setSelected(null);
                }}
              >
                <Icon size={16} />
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
      {showSprintForm && (
        <form
          className="sprint-create"
          onSubmit={async (event) => {
            event.preventDefault();
            setSavingSprint(true);
            setSprintError("");
            try {
              await createSprint(sprintDraft);
              setSprint(sprintDraft.name.trim());
              setSprintDraft((previous) => ({ ...previous, name: "", goal: "" }));
              setShowSprintForm(false);
            } catch (error) {
              setSprintError(error.message);
            } finally {
              setSavingSprint(false);
            }
          }}
        >
          <label>
            Sprint name
            <input
              required
              maxLength={100}
              value={sprintDraft.name}
              onChange={(event) => setSprintDraft({ ...sprintDraft, name: event.target.value })}
              placeholder="Sprint 1"
            />
          </label>
          <label>
            Goal
            <input
              maxLength={2000}
              value={sprintDraft.goal}
              onChange={(event) => setSprintDraft({ ...sprintDraft, goal: event.target.value })}
              placeholder="What should the team achieve?"
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              required
              value={sprintDraft.start_date}
              max={sprintDraft.end_date}
              onChange={(event) => setSprintDraft({ ...sprintDraft, start_date: event.target.value })}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              required
              value={sprintDraft.end_date}
              min={sprintDraft.start_date}
              onChange={(event) => setSprintDraft({ ...sprintDraft, end_date: event.target.value })}
            />
          </label>
          <button className="primary" disabled={savingSprint}>
            {savingSprint ? "Creating…" : "Create sprint"}
          </button>
          {sprintError && <div className="error">{sprintError}</div>}
        </form>
      )}
      <div className="planner-tools">
        <div className="month-controls">
          <button aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft size={17} />
          </button>
          <h3>
            {month.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </h3>
          <button aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight size={17} />
          </button>
          <button
            className="today-button"
            onClick={() => {
              setMonth(
                new Date(
                  new Date().getFullYear(),
                  new Date().getMonth(),
                  1,
                  12,
                ),
              );
              setSelected(today);
            }}
          >
            Today
          </button>
        </div>
        <div className="sprint-tools">
          <select
            aria-label="Filter by sprint"
            value={sprint}
            onChange={(e) => {
              setSprint(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">All sprints</option>
            {names.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {editable && sprint && (
            <button className="primary" onClick={() => create("", sprint)}>
              <Plus size={14} /> Issue in {sprint}
            </button>
          )}
        </div>
      </div>
      <div className="planner-summary">
        <span>
          <i className="legend-dot planned" />
          Planned
        </span>
        <span>
          <i className="legend-dot progress" />
          In progress
        </span>
        <span>
          <i className="legend-dot done" />
          Done
        </span>
        <span className="schedule-total">
          {visible.length} scheduled this month · {unscheduled.length} without
          dates
        </span>
      </div>
      {mode === "Calendar" ? (
        <div className="calendar-scroll">
          <div className="month-grid">
            <div className="week-labels">
              {dayNames.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="calendar-days">
              {days.map((d) => {
                const day = iso(d),
                  events = onDay(day),
                  outside = d.getMonth() !== m;
                return (
                  <div
                    key={day}
                    className={
                      "calendar-cell" +
                      (outside ? " outside" : "") +
                      (day === today ? " current-day" : "") +
                      (selected === day ? " selected-day" : "")
                    }
                  >
                    <div className="day-heading">
                      <button
                        aria-label={"Show schedule for " + day}
                        onClick={() =>
                          setSelected(selected === day ? null : day)
                        }
                        className="day-number"
                      >
                        {d.getDate()}
                      </button>
                      {editable && (
                        <button
                          aria-label={"Add issue on " + day}
                          className="day-add"
                          onClick={() => create(day, sprint)}
                        >
                          <Plus size={13} />
                        </button>
                      )}
                    </div>
                    <div className="day-events">
                      {events.slice(0, 3).map((i) => (
                        <button
                          key={i.id}
                          className={"calendar-event " + tone(i)}
                          title={`${i.key}: ${i.title} · ${label(i.start_date)} – ${label(i.due_date)}`}
                          onClick={() => open(i)}
                        >
                          <span className="event-key">{i.key}</span>
                          <span>{i.title}</span>
                        </button>
                      ))}
                      {events.length > 3 && (
                        <button
                          className="more-events"
                          onClick={() => setSelected(day)}
                        >
                          +{events.length - 3} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="timeline-scroll">
          <div
            className="timeline"
            style={{
              minWidth: Math.max(1000, total * 32 + 255),
              "--days": total,
            }}
          >
            <div className="timeline-heading">
              <div>SPRINT / ISSUE</div>
              <div className="timeline-dates">
                {Array.from({ length: total }, (_, n) => {
                  const d = new Date(year, m, n + 1, 12);
                  return (
                    <span
                      key={n}
                      className={
                        (iso(d) === today ? "timeline-today " : "") +
                        ([0, 6].includes(d.getDay()) ? "weekend" : "")
                      }
                    >
                      <small>
                        {d.toLocaleDateString(undefined, { weekday: "narrow" })}
                      </small>
                      {n + 1}
                    </span>
                  );
                })}
              </div>
            </div>
            {groups.map((group) => (
              <React.Fragment key={group}>
                <div className="timeline-group">
                  <CalendarDays size={14} />
                  {group}
                  <span>
                    {
                      visible.filter((i) => (i.sprint || "No sprint") === group)
                        .length
                    }{" "}
                    issues
                  </span>
                </div>
                {visible
                  .filter((i) => (i.sprint || "No sprint") === group)
                  .map((i) => {
                    const start =
                        i.start_date < first
                          ? 1
                          : dateOf(i.start_date).getDate(),
                      end =
                        i.due_date > last
                          ? total
                          : dateOf(i.due_date).getDate();
                    return (
                      <div className="timeline-row" key={i.id}>
                        <button
                          className="timeline-issue"
                          title={i.title}
                          onClick={() => open(i)}
                        >
                          <small>{i.key}</small>
                          <span>{i.title}</span>
                        </button>
                        <div className="timeline-track">
                          {Array.from({ length: total }, (_, n) => (
                            <span
                              key={n}
                              style={{ gridColumn: n + 1 }}
                              className={
                                "track-cell " +
                                (iso(new Date(year, m, n + 1, 12)) === today
                                  ? "track-today"
                                  : "")
                              }
                            />
                          ))}
                          <button
                            className={"timeline-bar " + tone(i)}
                            style={{ gridColumn: `${start} / ${end + 1}` }}
                            onClick={() => open(i)}
                            aria-label={`${i.key}: ${i.title}, ${label(i.start_date)} to ${label(i.due_date)}`}
                            title={`${i.title} · ${label(i.start_date)} – ${label(i.due_date)}`}
                          >
                            <span>{i.title}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </React.Fragment>
            ))}
            {!visible.length && (
              <div className="timeline-empty">
                <CalendarClock size={25} />
                <h3>No scheduled work this month</h3>
                <p>
                  Add start and due dates to an issue below, or browse to
                  another month.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      {selected && mode === "Calendar" && (
        <div className="day-agenda">
          <div className="section-heading">
            <h3>
              {dateOf(selected).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h3>
            {editable && (
              <button
                className="secondary"
                onClick={() => create(selected, sprint)}
              >
                <Plus size={14} />
                Schedule issue
              </button>
            )}
          </div>
          {onDay(selected).length ? (
            onDay(selected).map((i) => (
              <button
                className="agenda-issue"
                key={i.id}
                onClick={() => open(i)}
              >
                <span className={"legend-dot " + tone(i)} />
                <small>{i.key}</small>
                <strong>{i.title}</strong>
                <span>{i.status}</span>
                <ArrowUpRight size={15} />
              </button>
            ))
          ) : (
            <p className="muted">No work scheduled for this day.</p>
          )}
        </div>
      )}
      <div className="unscheduled">
        <div className="section-heading">
          <div>
            <h3>
              <CalendarClock size={17} />
              Ready to schedule{" "}
              <span className="count">{unscheduled.length}</span>
            </h3>
            <p>
              {editable
                ? "Open an issue to add its start and due dates."
                : "These issues do not have scheduled dates yet."}
            </p>
          </div>
        </div>
        {unscheduled.length ? (
          <div className="unscheduled-grid">
            {unscheduled.map((i) => (
              <button
                className="unscheduled-card"
                key={i.id}
                onClick={() => open(i)}
              >
                <span>
                  <small>{i.key}</small>
                  <span className="pill">{i.sprint || "No sprint"}</span>
                </span>
                <strong>{i.title}</strong>
                <span className="unscheduled-bottom">
                  {users.find((u) => u.id === i.assignee_id)?.name ||
                    "Unassigned"}
                  <span>
                    {editable ? "Set dates" : "View issue"}{" "}
                    <ArrowUpRight size={12} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">All issues have dates. Your plan is ready.</p>
        )}
      </div>
    </section>
  );
}
