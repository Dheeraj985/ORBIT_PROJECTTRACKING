import os, hashlib, secrets, time, threading
import psycopg
import psycopg.rows
import psycopg.errors
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime, timezone, date
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DATABASE_URL = os.getenv('DATABASE_URL')
app = FastAPI(title='Orbit Project Management', version='1.0.0')
STATUSES = ['Backlog', 'To do', 'In progress', 'In review', 'Done']
_initialized = False
_init_lock = threading.Lock()

def now(): return datetime.now(timezone.utc).isoformat()

@contextmanager
def db():
    if not DATABASE_URL:
        raise RuntimeError('Set DATABASE_URL to a postgres:// connection string before starting.')
    options = {
        'row_factory': psycopg.rows.dict_row,
        'prepare_threshold': None,
        'connect_timeout': 10,
    }
    if os.getenv('ORBIT_REQUIRE_SSL', '0') == '1':
        options['sslmode'] = 'require'
    c = psycopg.connect(DATABASE_URL, **options)
    try:
        yield c
        c.commit()
    except:
        c.rollback()
        raise
    finally: c.close()

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600000).hex()

SCHEMA = [
    "CREATE EXTENSION IF NOT EXISTS citext",
    "CREATE TABLE IF NOT EXISTS workspaces(id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, workspace_id INTEGER REFERENCES workspaces(id), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires DOUBLE PRECISION)",
    "CREATE TABLE IF NOT EXISTS projects(id SERIAL PRIMARY KEY, workspace_id INTEGER REFERENCES workspaces(id), name TEXT NOT NULL, key TEXT NOT NULL, description TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS sprints(id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), name CITEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', UNIQUE(project_id,name))",
    "CREATE TABLE IF NOT EXISTS issues(id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL, type TEXT NOT NULL, assignee_id INTEGER REFERENCES users(id), points INTEGER NOT NULL DEFAULT 0, sprint TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS comments(id SERIAL PRIMARY KEY, issue_id INTEGER REFERENCES issues(id), user_id INTEGER REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS activity(id SERIAL PRIMARY KEY, workspace_id INTEGER REFERENCES workspaces(id), user_id INTEGER REFERENCES users(id), issue_id INTEGER REFERENCES issues(id), action TEXT NOT NULL, created_at TEXT NOT NULL)",
]

def initialize():
    with db() as c:
        # Prevent simultaneous Vercel cold starts from racing the first-time seed.
        c.execute('SELECT pg_advisory_xact_lock(%s)', (684251907,))
        for stmt in SCHEMA:
            c.execute(stmt)
        issue_columns = {r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='issues'")}
        for column in ('start_date', 'due_date'):
            if column not in issue_columns:
                c.execute(f"ALTER TABLE issues ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        for table in ('users', 'projects', 'activity'):
            columns = {r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s", (table,))}
            if 'workspace_id' not in columns:
                c.execute(f"ALTER TABLE {table} ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id)")

        workspace = c.execute('SELECT id FROM workspaces ORDER BY id LIMIT 1').fetchone()
        if not workspace:
            workspace = c.execute('INSERT INTO workspaces(name,created_at) VALUES(%s,%s) RETURNING id',(os.getenv('ORBIT_COMPANY_NAME','Orbit Workspace'),now())).fetchone()
        default_workspace_id = workspace['id']
        c.execute('UPDATE users SET workspace_id=%s WHERE workspace_id IS NULL',(default_workspace_id,))
        c.execute('UPDATE projects SET workspace_id=%s WHERE workspace_id IS NULL',(default_workspace_id,))
        c.execute('UPDATE activity a SET workspace_id=COALESCE((SELECT p.workspace_id FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.id=a.issue_id),%s) WHERE a.workspace_id IS NULL',(default_workspace_id,))
        c.execute('ALTER TABLE users ALTER COLUMN workspace_id SET NOT NULL')
        c.execute('ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL')
        c.execute('ALTER TABLE activity ALTER COLUMN workspace_id SET NOT NULL')
        c.execute('ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_key_key')
        c.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workspace_key ON projects(workspace_id,key)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity(workspace_id,created_at DESC)')
        if not c.execute('SELECT id FROM users LIMIT 1').fetchone():
            secret = os.getenv('ORBIT_ADMIN_PASSWORD')
            if secret and len(secret) < 12: raise RuntimeError('Admin password must have at least 12 characters')
            if secret:
                admin = c.execute('INSERT INTO users(workspace_id,name,email,password,role) VALUES(%s,%s,%s,%s,%s) RETURNING id', (default_workspace_id,'Alex Morgan',os.getenv('ORBIT_ADMIN_EMAIL','admin@orbit.local'),password_hash(secret),'admin')).fetchone()
            if secret and os.getenv('ORBIT_SEED_DEMO','0') == '1':
                member_ids=[]
                for name,email in [('Jamie Chen','jamie@orbit.local'),('Sam Rivera','sam@orbit.local'),('Taylor Kim','taylor@orbit.local')]:
                    member_ids.append(c.execute('INSERT INTO users(workspace_id,name,email,password,role) VALUES(%s,%s,%s,%s,%s) RETURNING id',(default_workspace_id,name,email,password_hash(secrets.token_urlsafe(32)),'member')).fetchone()['id'])
                project_id=c.execute('INSERT INTO projects(workspace_id,name,key,description) VALUES(%s,%s,%s,%s) RETURNING id',(default_workspace_id,'Platform redesign','ORB','A faster, more thoughtful experience for every customer.')).fetchone()['id']
                assignees=[member_ids[0],admin['id'],member_ids[1],member_ids[2]]
                items=[('Design system foundations','Done','High','Story',2,5),('Implement workspace navigation','In review','High','Task',1,3),('Build project overview dashboard','In progress','High','Story',1,8),('Add advanced issue filters','In progress','Medium','Task',2,5),('Fix notification badge count','In progress','Urgent','Bug',3,2),('Create onboarding flow','To do','High','Story',4,8),('Keyboard shortcuts for power users','To do','Medium','Task',3,3),('Update empty state illustrations','To do','Low','Task',2,2),('Improve search relevance','In review','Medium','Story',4,5),('Audit accessibility contrast','Backlog','High','Task',2,3),('Export project data as CSV','Backlog','Low','Task',1,3),('Optimize board rendering','Done','Medium','Task',3,5)]
                for title,status,priority,kind,assignee,points in items:
                    c.execute('INSERT INTO issues(project_id,title,description,status,priority,type,assignee_id,points,sprint,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(project_id,title,'Deliver a polished, accessible implementation.\n\nAcceptance criteria\n• Works across desktop and mobile\n• Handles loading and error states\n• Reviewed by the team',status,priority,kind,assignees[assignee-1],points,'' if status=='Backlog' else 'Sprint 24',now(),now()))
                c.execute('INSERT INTO activity(workspace_id,user_id,action,created_at) VALUES(%s,%s,%s,%s)',(default_workspace_id,admin['id'],'created the Platform redesign workspace',now()))

        c.execute("INSERT INTO sprints(project_id,name) SELECT DISTINCT project_id, trim(sprint) FROM issues WHERE trim(sprint) != '' ON CONFLICT DO NOTHING")

def ensure_initialized():
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if not _initialized:
            initialize()
            _initialized = True

def database_error_code(exc):
    message = str(exc).lower()
    if 'password authentication failed' in message or 'authentication failed' in message:
        return 'authentication_failed'
    if 'tenant or user not found' in message:
        return 'pooler_tenant_not_found'
    if 'name or service not known' in message or 'nodename nor servname' in message or 'could not translate host name' in message:
        return 'dns_failed'
    if 'timeout' in message or 'timed out' in message:
        return 'connection_timeout'
    if 'network is unreachable' in message:
        return 'network_unreachable'
    if 'connection refused' in message:
        return 'connection_refused'
    if 'ssl' in message or 'certificate' in message:
        return 'ssl_failed'
    if 'permission denied' in message or 'insufficient privilege' in message:
        return 'permission_denied'
    return 'database_unavailable'

def database_diagnostic(exc, stage):
    return {
        'status': 'error',
        'stage': stage,
        'code': database_error_code(exc),
        'error_type': type(exc).__name__,
        'sqlstate': getattr(exc, 'sqlstate', None),
    }

def user(request: Request):
    ensure_initialized()
    token = request.cookies.get('orbit_session','')
    with db() as c:
        row=c.execute('SELECT u.id,u.workspace_id,u.name,u.email,u.role,w.name AS workspace_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token=%s AND s.expires>%s',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
    if not row: raise HTTPException(401,'Please sign in')
    if request.method not in ['GET','HEAD','OPTIONS'] and request.headers.get('x-orbit-request') != '1': raise HTTPException(403,'Missing request protection header')
    return dict(row)

def editor(u=Depends(user)):
    if u['role']=='viewer': raise HTTPException(403,'Viewer access is read-only')
    return u

class Login(BaseModel):
    email: str
    password: str
class SignupMember(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    email:str=Field(min_length=3,max_length=200)
    password:str=Field(min_length=12,max_length=200)
    role:str='member'
class Signup(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    email:str=Field(min_length=3,max_length=200)
    password:str=Field(min_length=12,max_length=200)
    company_name:str=Field(min_length=1,max_length=120)
    project_name:str=Field(min_length=1,max_length=100)
    project_key:str=Field(pattern=r'^[A-Z][A-Z0-9]{1,9}$')
    members:list[SignupMember]=Field(default_factory=list,max_length=20)

attempts = {}
def create_session(c,user_id,response):
    token=secrets.token_urlsafe(48)
    c.execute('DELETE FROM sessions WHERE expires<%s',(time.time(),))
    c.execute('INSERT INTO sessions VALUES(%s,%s,%s)',(hashlib.sha256(token.encode()).hexdigest(),user_id,time.time()+43200))
    response.set_cookie('orbit_session',token,httponly=True,samesite='strict',secure=os.getenv('ORBIT_SECURE_COOKIES')=='1',max_age=43200)

@app.post('/api/login')
def login(body:Login,request:Request,response:Response):
    ensure_initialized()
    ip=request.client.host
    recent=[t for t in attempts.get(ip,[]) if t>time.time()-300]
    if len(recent)>=15: raise HTTPException(429,'Too many attempts. Try again in five minutes.')
    attempts[ip]=recent+[time.time()]
    with db() as c:
        u=c.execute('SELECT * FROM users WHERE email=%s',(body.email.lower().strip(),)).fetchone()
        expected=u['password'] if u else password_hash('invalid')
        if not secrets.compare_digest(password_hash(body.password,expected.split(':')[0]),expected) or not u: raise HTTPException(401,'Email or password is incorrect')
        create_session(c,u['id'],response)
        workspace=c.execute('SELECT name FROM workspaces WHERE id=%s',(u['workspace_id'],)).fetchone()
    return {'id':u['id'],'workspace_id':u['workspace_id'],'workspace_name':workspace['name'],'name':u['name'],'email':u['email'],'role':u['role']}

@app.post('/api/signup',status_code=201)
def signup(body:Signup,request:Request,response:Response):
    ensure_initialized()
    if request.headers.get('x-orbit-request') != '1': raise HTTPException(403,'Missing request protection header')
    if not all(value.strip() for value in (body.name,body.company_name,body.project_name)):
        raise HTTPException(422,'Name, company, and project are required')
    email=body.email.lower().strip()
    if '@' not in email: raise HTTPException(422,'Use a valid email address')
    member_emails=[]
    for member in body.members:
        if not member.name.strip(): raise HTTPException(422,'Every team member needs a name')
        member_email=member.email.lower().strip()
        if '@' not in member_email: raise HTTPException(422,'Use a valid email address for every team member')
        if member.role not in ['member','viewer']: raise HTTPException(422,'Initial team members must be members or viewers')
        member_emails.append(member_email)
    if len(set([email,*member_emails])) != len(member_emails)+1:
        raise HTTPException(422,'Every workspace account needs a different email address')
    try:
        with db() as c:
            workspace=c.execute('INSERT INTO workspaces(name,created_at) VALUES(%s,%s) RETURNING id,name',(body.company_name.strip(),now())).fetchone()
            account=c.execute('INSERT INTO users(workspace_id,name,email,password,role) VALUES(%s,%s,%s,%s,%s) RETURNING id',(workspace['id'],body.name.strip(),email,password_hash(body.password),'admin')).fetchone()
            project=c.execute('INSERT INTO projects(workspace_id,name,key,description) VALUES(%s,%s,%s,%s) RETURNING id',(workspace['id'],body.project_name.strip(),body.project_key.upper(),'')).fetchone()
            for member,member_email in zip(body.members,member_emails):
                c.execute('INSERT INTO users(workspace_id,name,email,password,role) VALUES(%s,%s,%s,%s,%s)',(workspace['id'],member.name.strip(),member_email,password_hash(member.password),member.role))
            c.execute('INSERT INTO activity(workspace_id,user_id,action,created_at) VALUES(%s,%s,%s,%s)',(workspace['id'],account['id'],'created the '+body.project_name.strip()+' project',now()))
            create_session(c,account['id'],response)
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409,'An account with this email already exists')
    return {'id':account['id'],'workspace_id':workspace['id'],'workspace_name':workspace['name'],'name':body.name.strip(),'email':email,'role':'admin','project_id':project['id'],'member_count':len(body.members)+1}
@app.post('/api/logout')
def logout(request:Request,response:Response,u=Depends(user)):
    with db() as c: c.execute('DELETE FROM sessions WHERE token=%s',(hashlib.sha256(request.cookies.get('orbit_session','').encode()).hexdigest(),))
    response.delete_cookie('orbit_session')
    return {'ok':True}
@app.get('/api/me')
def me(u=Depends(user)): return u
@app.get('/api/workspace')
def workspace(u=Depends(user)):
    with db() as c:
        workspace_row=c.execute('SELECT id,name FROM workspaces WHERE id=%s',(u['workspace_id'],)).fetchone()
        sprints=[dict(r) for r in c.execute('SELECT s.* FROM sprints s JOIN projects p ON p.id=s.project_id WHERE p.workspace_id=%s ORDER BY s.start_date,s.id',(u['workspace_id'],))]
        projects=[dict(r) for r in c.execute('SELECT id,name,key,description FROM projects WHERE workspace_id=%s ORDER BY id',(u['workspace_id'],))]
        users=[dict(r) for r in c.execute('SELECT id,name,email,role FROM users WHERE workspace_id=%s ORDER BY id',(u['workspace_id'],))]
        issues=[dict(r) for r in c.execute("SELECT i.*,p.key || '-' || i.id::text as key FROM issues i JOIN projects p ON p.id=i.project_id WHERE p.workspace_id=%s ORDER BY i.id DESC",(u['workspace_id'],))]
        activity=[dict(r) for r in c.execute('SELECT a.*,member.name FROM activity a JOIN users member ON member.id=a.user_id WHERE a.workspace_id=%s ORDER BY a.id DESC LIMIT 100',(u['workspace_id'],))]
        return {'workspace':dict(workspace_row),'sprints':sprints,'projects':projects,'users':users,'issues':issues,'activity':activity}
class Project(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    key:str=Field(pattern=r'^[A-Z][A-Z0-9]{1,9}$')
    description:str=Field(default='',max_length=2000)
@app.post('/api/projects',status_code=201)
def create_project(body:Project,u=Depends(editor)):
    with db() as c:
        try: row=c.execute('INSERT INTO projects(workspace_id,name,key,description) VALUES(%s,%s,%s,%s) RETURNING id',(u['workspace_id'],body.name,body.key,body.description)).fetchone()
        except psycopg.errors.UniqueViolation: raise HTTPException(409,'Project key already exists')
        return {'id':row['id'],**body.model_dump()}
class Sprint(BaseModel):
    project_id:int
    name:str=Field(min_length=1,max_length=100)
    goal:str=Field(default='',max_length=2000)
    start_date:str
    end_date:str
@app.post('/api/sprints',status_code=201)
def create_sprint(b:Sprint,u=Depends(editor)):
    name=b.name.strip()
    if not name: raise HTTPException(422,'Sprint name is required')
    for value in (b.start_date,b.end_date):
        try:
            if date.fromisoformat(value).isoformat()!=value: raise ValueError()
        except ValueError: raise HTTPException(422,'Valid start and end dates are required')
    if b.end_date < b.start_date: raise HTTPException(422,'End date must be on or after start date')
    with db() as c:
        if not c.execute('SELECT id FROM projects WHERE id=%s AND workspace_id=%s',(b.project_id,u['workspace_id'])).fetchone(): raise HTTPException(404,'Project not found')
        try: row=c.execute('INSERT INTO sprints(project_id,name,goal,start_date,end_date) VALUES(%s,%s,%s,%s,%s) RETURNING id',(b.project_id,name,b.goal,b.start_date,b.end_date)).fetchone()
        except psycopg.errors.UniqueViolation: raise HTTPException(409,'A sprint with this name already exists in this project')
        audit(c,u,None,'created sprint '+name)
        return {'id':row['id'],**b.model_dump(),'name':name}
class Issue(BaseModel):
    project_id:int
    title:str=Field(min_length=1,max_length=250)
    description:str=Field(default='',max_length=20000)
    status:str='To do'
    priority:str='Medium'
    type:str='Task'
    assignee_id:int|None=None
    points:int=Field(default=0,ge=0,le=100)
    sprint:str=Field(default='',max_length=100)
    version:int=1
    start_date:str=Field(default='',max_length=10)
    due_date:str=Field(default='',max_length=10)

def validate_issue(b,c,u):
    for value in (b.start_date, b.due_date):
        if value:
            try:
                if date.fromisoformat(value).isoformat() != value: raise ValueError()
            except ValueError: raise HTTPException(422, 'Use a valid date in YYYY-MM-DD format')
    if bool(b.start_date) != bool(b.due_date): raise HTTPException(422, 'Set both start and due dates, or leave both empty')
    if b.start_date and b.start_date > b.due_date: raise HTTPException(422, 'Due date must be on or after start date')
    if b.status not in STATUSES or b.priority not in ['Urgent','High','Medium','Low'] or b.type not in ['Task','Bug','Story']: raise HTTPException(422,'Invalid issue options')
    if not b.title.strip(): raise HTTPException(422,'Title is required')
    if not c.execute('SELECT id FROM projects WHERE id=%s AND workspace_id=%s',(b.project_id,u['workspace_id'])).fetchone(): raise HTTPException(404,'Project not found')
    if b.assignee_id and not c.execute('SELECT id FROM users WHERE id=%s AND workspace_id=%s',(b.assignee_id,u['workspace_id'])).fetchone(): raise HTTPException(422,'Assignee not found')
    if b.sprint and not c.execute('SELECT id FROM sprints WHERE project_id=%s AND name=%s',(b.project_id,b.sprint)).fetchone(): raise HTTPException(422,'Choose a sprint from this project')
def audit(c,u,i,action): c.execute('INSERT INTO activity(workspace_id,user_id,issue_id,action,created_at) VALUES(%s,%s,%s,%s,%s)',(u['workspace_id'],u['id'],i,action,now()))
@app.post('/api/issues',status_code=201)
def create_issue(b:Issue,u=Depends(editor)):
    with db() as c:
        validate_issue(b,c,u)
        data=b.model_dump(exclude={'version'})
        data.update(created_at=now(),updated_at=now())
        row=c.execute(f"INSERT INTO issues({','.join(data)}) VALUES({','.join('%s' for _ in data)}) RETURNING id",tuple(data.values())).fetchone()
        audit(c,u,row['id'],'created '+b.title)
        return {'id':row['id']}
@app.put('/api/issues/{issue_id}')
def update_issue(issue_id:int,b:Issue,u=Depends(editor)):
    with db() as c:
        validate_issue(b,c,u)
        old=c.execute('SELECT i.* FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.id=%s AND p.workspace_id=%s',(issue_id,u['workspace_id'])).fetchone()
        if not old: raise HTTPException(404,'Issue not found')
        if old['version']!=b.version: raise HTTPException(409,'This issue changed. Close and reopen it before editing.')
        data=b.model_dump(exclude={'version'});data.update(updated_at=now(),version=b.version+1)
        result=c.execute(f"UPDATE issues SET {','.join(k+'=%s' for k in data)} WHERE id=%s AND version=%s",(*data.values(),issue_id,b.version))
        if result.rowcount != 1: raise HTTPException(409,'This issue changed. Close and reopen it before editing.')
        audit(c,u,issue_id,('moved '+b.title+' to '+b.status) if old['status']!=b.status else 'updated '+b.title)
        return {'ok':True}
@app.get('/api/issues/{issue_id}/comments')
def comments(issue_id:int,u=Depends(user)):
    with db() as c: return [dict(r) for r in c.execute('SELECT c.*,member.name FROM comments c JOIN users member ON member.id=c.user_id JOIN issues i ON i.id=c.issue_id JOIN projects p ON p.id=i.project_id WHERE c.issue_id=%s AND p.workspace_id=%s ORDER BY c.id',(issue_id,u['workspace_id']))]
class Comment(BaseModel):
    body:str=Field(min_length=1,max_length=10000)
@app.post('/api/issues/{issue_id}/comments',status_code=201)
def comment(issue_id:int,b:Comment,u=Depends(editor)):
    with db() as c:
        if not c.execute('SELECT i.id FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.id=%s AND p.workspace_id=%s',(issue_id,u['workspace_id'])).fetchone(): raise HTTPException(404,'Issue not found')
        c.execute('INSERT INTO comments(issue_id,user_id,body,created_at) VALUES(%s,%s,%s,%s)',(issue_id,u['id'],b.body,now()))
        audit(c,u,issue_id,'commented on issue #'+str(issue_id))
    return {'ok':True}
class Member(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    email:str=Field(min_length=3,max_length=200)
    password:str=Field(min_length=12,max_length=200)
    role:str='member'
@app.post('/api/members',status_code=201)
def member(b:Member,u=Depends(user)):
    if u['role']!='admin': raise HTTPException(403,'Administrator access required')
    if b.role not in ['admin','member','viewer']: raise HTTPException(422,'Invalid role')
    with db() as c:
        try: c.execute('INSERT INTO users(workspace_id,name,email,password,role) VALUES(%s,%s,%s,%s,%s)',(u['workspace_id'],b.name,b.email.lower().strip(),password_hash(b.password),b.role))
        except psycopg.errors.UniqueViolation: raise HTTPException(409,'Email already exists')
        audit(c,u,None,'added '+b.name+' to the workspace')
    return {'ok':True}

class Profile(BaseModel):
    name:str=Field(min_length=1,max_length=100)
@app.put('/api/profile')
def update_profile(b:Profile,u=Depends(user)):
    name=b.name.strip()
    if not name: raise HTTPException(422,'Profile name is required')
    with db() as c:
        c.execute('UPDATE users SET name=%s WHERE id=%s AND workspace_id=%s',(name,u['id'],u['workspace_id']))
        audit(c,u,None,'updated their profile name')
    return {**u,'name':name}
@app.get('/api/health')
def health():
    if not DATABASE_URL:
        raise HTTPException(503, 'DATABASE_URL is not configured in Vercel')
    try:
        with db() as c:
            c.execute('SELECT 1')
    except Exception as exc:
        diagnostic = database_diagnostic(exc, 'connection')
        print('Orbit database connection check failed:', diagnostic)
        raise HTTPException(503, diagnostic)
    try:
        ensure_initialized()
    except Exception as exc:
        diagnostic = database_diagnostic(exc, 'schema_initialization')
        print('Orbit database schema initialization failed:', diagnostic)
        raise HTTPException(503, diagnostic)
    return {'status':'ok'}

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'public' if (ROOT/'public').exists() else ROOT/'frontend'/'dist'
if DIST.exists(): app.mount('/',StaticFiles(directory=DIST,html=True),name='frontend')
