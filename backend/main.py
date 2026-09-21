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
    "CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires DOUBLE PRECISION)",
    "CREATE TABLE IF NOT EXISTS projects(id SERIAL PRIMARY KEY, name TEXT NOT NULL, key TEXT UNIQUE NOT NULL, description TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS sprints(id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), name CITEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', UNIQUE(project_id,name))",
    "CREATE TABLE IF NOT EXISTS issues(id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL, type TEXT NOT NULL, assignee_id INTEGER REFERENCES users(id), points INTEGER NOT NULL DEFAULT 0, sprint TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS comments(id SERIAL PRIMARY KEY, issue_id INTEGER REFERENCES issues(id), user_id INTEGER REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS activity(id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), issue_id INTEGER REFERENCES issues(id), action TEXT NOT NULL, created_at TEXT NOT NULL)",
]

def initialize():
    with db() as c:
        # Prevent simultaneous Vercel cold starts from racing the first-time seed.
        c.execute('SELECT pg_advisory_xact_lock(%s)', (684251907,))
        for stmt in SCHEMA:
            c.execute(stmt)
        columns = {r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name='issues'")}
        for column in ('start_date', 'due_date'):
            if column not in columns:
                c.execute(f"ALTER TABLE issues ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        if not c.execute('SELECT id FROM users LIMIT 1').fetchone():
            secret = os.getenv('ORBIT_ADMIN_PASSWORD')
            if not secret:
                raise RuntimeError('Set ORBIT_ADMIN_PASSWORD (12+ characters) before first start.')
            if len(secret) < 12: raise RuntimeError('Admin password must have at least 12 characters')
            c.execute('INSERT INTO users(name,email,password,role) VALUES(%s,%s,%s,%s)', ('Alex Morgan',os.getenv('ORBIT_ADMIN_EMAIL','admin@orbit.local'),password_hash(secret),'admin'))
            if os.getenv('ORBIT_SEED_DEMO','0') == '1':
                for name,email in [('Jamie Chen','jamie@orbit.local'),('Sam Rivera','sam@orbit.local'),('Taylor Kim','taylor@orbit.local')]:
                    c.execute('INSERT INTO users(name,email,password,role) VALUES(%s,%s,%s,%s)',(name,email,password_hash(secrets.token_urlsafe(32)),'member'))
                c.execute('INSERT INTO projects(name,key,description) VALUES(%s,%s,%s)',('Platform redesign','ORB','A faster, more thoughtful experience for every customer.'))
                items=[('Design system foundations','Done','High','Story',2,5),('Implement workspace navigation','In review','High','Task',1,3),('Build project overview dashboard','In progress','High','Story',1,8),('Add advanced issue filters','In progress','Medium','Task',2,5),('Fix notification badge count','In progress','Urgent','Bug',3,2),('Create onboarding flow','To do','High','Story',4,8),('Keyboard shortcuts for power users','To do','Medium','Task',3,3),('Update empty state illustrations','To do','Low','Task',2,2),('Improve search relevance','In review','Medium','Story',4,5),('Audit accessibility contrast','Backlog','High','Task',2,3),('Export project data as CSV','Backlog','Low','Task',1,3),('Optimize board rendering','Done','Medium','Task',3,5)]
                for title,status,priority,kind,assignee,points in items:
                    c.execute('INSERT INTO issues(project_id,title,description,status,priority,type,assignee_id,points,sprint,created_at,updated_at) VALUES(1,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(title,'Deliver a polished, accessible implementation.\n\nAcceptance criteria\n• Works across desktop and mobile\n• Handles loading and error states\n• Reviewed by the team',status,priority,kind,assignee,points,'' if status=='Backlog' else 'Sprint 24',now(),now()))
                c.execute('INSERT INTO activity(user_id,action,created_at) VALUES(1,%s,%s)',('created the Platform redesign workspace',now()))

        c.execute("INSERT INTO sprints(project_id,name) SELECT DISTINCT project_id, trim(sprint) FROM issues WHERE trim(sprint) != '' ON CONFLICT DO NOTHING")

def ensure_initialized():
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if not _initialized:
            initialize()
            _initialized = True

def user(request: Request):
    ensure_initialized()
    token = request.cookies.get('orbit_session','')
    with db() as c:
        row=c.execute('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=%s AND s.expires>%s',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
    if not row: raise HTTPException(401,'Please sign in')
    if request.method not in ['GET','HEAD','OPTIONS'] and request.headers.get('x-orbit-request') != '1': raise HTTPException(403,'Missing request protection header')
    return dict(row)

def editor(u=Depends(user)):
    if u['role']=='viewer': raise HTTPException(403,'Viewer access is read-only')
    return u

class Login(BaseModel):
    email: str
    password: str
attempts = {}
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
        token=secrets.token_urlsafe(48)
        c.execute('DELETE FROM sessions WHERE expires<%s',(time.time(),))
        c.execute('INSERT INTO sessions VALUES(%s,%s,%s)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],time.time()+43200))
    response.set_cookie('orbit_session',token,httponly=True,samesite='strict',secure=os.getenv('ORBIT_SECURE_COOKIES')=='1',max_age=43200)
    return {'id':u['id'],'name':u['name'],'email':u['email'],'role':u['role']}
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
        return {key:[dict(r) for r in c.execute(query)] for key,query in {'sprints':'SELECT * FROM sprints ORDER BY start_date,id','projects':'SELECT * FROM projects','users':'SELECT id,name,email,role FROM users','issues':"SELECT i.*,p.key || '-' || i.id::text as key FROM issues i JOIN projects p ON p.id=i.project_id ORDER BY i.id DESC",'activity':'SELECT a.*,u.name FROM activity a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100'}.items()}
class Project(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    key:str=Field(pattern=r'^[A-Z][A-Z0-9]{1,9}$')
    description:str=Field(default='',max_length=2000)
@app.post('/api/projects',status_code=201)
def create_project(body:Project,u=Depends(editor)):
    with db() as c:
        try: row=c.execute('INSERT INTO projects(name,key,description) VALUES(%s,%s,%s) RETURNING id',(body.name,body.key,body.description)).fetchone()
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
        if not c.execute('SELECT id FROM projects WHERE id=%s',(b.project_id,)).fetchone(): raise HTTPException(404,'Project not found')
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

def validate_issue(b,c):
    for value in (b.start_date, b.due_date):
        if value:
            try:
                if date.fromisoformat(value).isoformat() != value: raise ValueError()
            except ValueError: raise HTTPException(422, 'Use a valid date in YYYY-MM-DD format')
    if bool(b.start_date) != bool(b.due_date): raise HTTPException(422, 'Set both start and due dates, or leave both empty')
    if b.start_date and b.start_date > b.due_date: raise HTTPException(422, 'Due date must be on or after start date')
    if b.status not in STATUSES or b.priority not in ['Urgent','High','Medium','Low'] or b.type not in ['Task','Bug','Story']: raise HTTPException(422,'Invalid issue options')
    if not b.title.strip(): raise HTTPException(422,'Title is required')
    if not c.execute('SELECT id FROM projects WHERE id=%s',(b.project_id,)).fetchone(): raise HTTPException(404,'Project not found')
    if b.assignee_id and not c.execute('SELECT id FROM users WHERE id=%s',(b.assignee_id,)).fetchone(): raise HTTPException(422,'Assignee not found')
def audit(c,u,i,action): c.execute('INSERT INTO activity(user_id,issue_id,action,created_at) VALUES(%s,%s,%s,%s)',(u['id'],i,action,now()))
@app.post('/api/issues',status_code=201)
def create_issue(b:Issue,u=Depends(editor)):
    with db() as c:
        validate_issue(b,c)
        data=b.model_dump(exclude={'version'})
        data.update(created_at=now(),updated_at=now())
        row=c.execute(f"INSERT INTO issues({','.join(data)}) VALUES({','.join('%s' for _ in data)}) RETURNING id",tuple(data.values())).fetchone()
        audit(c,u,row['id'],'created '+b.title)
        return {'id':row['id']}
@app.put('/api/issues/{issue_id}')
def update_issue(issue_id:int,b:Issue,u=Depends(editor)):
    with db() as c:
        validate_issue(b,c)
        old=c.execute('SELECT * FROM issues WHERE id=%s',(issue_id,)).fetchone()
        if not old: raise HTTPException(404,'Issue not found')
        if old['version']!=b.version: raise HTTPException(409,'This issue changed. Close and reopen it before editing.')
        data=b.model_dump(exclude={'version'});data.update(updated_at=now(),version=b.version+1)
        result=c.execute(f"UPDATE issues SET {','.join(k+'=%s' for k in data)} WHERE id=%s AND version=%s",(*data.values(),issue_id,b.version))
        if result.rowcount != 1: raise HTTPException(409,'This issue changed. Close and reopen it before editing.')
        audit(c,u,issue_id,('moved '+b.title+' to '+b.status) if old['status']!=b.status else 'updated '+b.title)
        return {'ok':True}
@app.get('/api/issues/{issue_id}/comments')
def comments(issue_id:int,u=Depends(user)):
    with db() as c: return [dict(r) for r in c.execute('SELECT c.*,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE issue_id=%s ORDER BY c.id',(issue_id,))]
class Comment(BaseModel):
    body:str=Field(min_length=1,max_length=10000)
@app.post('/api/issues/{issue_id}/comments',status_code=201)
def comment(issue_id:int,b:Comment,u=Depends(editor)):
    with db() as c:
        if not c.execute('SELECT id FROM issues WHERE id=%s',(issue_id,)).fetchone(): raise HTTPException(404,'Issue not found')
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
        try: c.execute('INSERT INTO users(name,email,password,role) VALUES(%s,%s,%s,%s)',(b.name,b.email.lower().strip(),password_hash(b.password),b.role))
        except psycopg.errors.UniqueViolation: raise HTTPException(409,'Email already exists')
        audit(c,u,None,'added '+b.name+' to the workspace')
    return {'ok':True}
@app.get('/api/health')
def health():
    if not DATABASE_URL:
        raise HTTPException(503, 'DATABASE_URL is not configured in Vercel')
    try:
        ensure_initialized()
        with db() as c:
            c.execute('SELECT 1')
        return {'status':'ok'}
    except HTTPException:
        raise
    except Exception as exc:
        print('Orbit database health check failed:', type(exc).__name__)
        raise HTTPException(503, 'Database connection failed. Check the Supabase Transaction pooler DATABASE_URL and redeploy.')

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'public' if (ROOT/'public').exists() else ROOT/'frontend'/'dist'
if DIST.exists(): app.mount('/',StaticFiles(directory=DIST,html=True),name='frontend')
