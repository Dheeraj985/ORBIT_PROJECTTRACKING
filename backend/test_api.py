import os,unittest,psycopg
TEST_DATABASE_URL=os.environ.setdefault('DATABASE_URL','postgresql://postgres:postgres@127.0.0.1:5432/orbit_test')
os.environ['ORBIT_ADMIN_PASSWORD']='test-password-1234'
os.environ['ORBIT_SEED_DEMO']='1'

# (re)create a scratch database so each run starts from a clean schema
_admin_url=TEST_DATABASE_URL.rsplit('/',1)[0]+'/postgres'
_dbname=TEST_DATABASE_URL.rsplit('/',1)[1]
with psycopg.connect(_admin_url, autocommit=True) as _c:
    _c.execute(f'DROP DATABASE IF EXISTS "{_dbname}"')
    _c.execute(f'CREATE DATABASE "{_dbname}"')

from fastapi.testclient import TestClient
from main import app

class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=TestClient(app);cls.client.__enter__()
    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None)
        with psycopg.connect(_admin_url, autocommit=True) as _c:
            _c.execute(f'DROP DATABASE IF EXISTS "{_dbname}"')
    def setUp(self):
        self.client.cookies.clear()
        r=self.client.post('/api/login',json={'email':'admin@orbit.local','password':'test-password-1234'})
        self.assertEqual(r.status_code,200)
        self.headers={'X-Orbit-Request':'1'}
    def test_authentication(self):
        self.client.cookies.clear()
        self.assertEqual(self.client.get('/api/workspace').status_code,401)
        self.assertEqual(self.client.post('/api/login',json={'email':'admin@orbit.local','password':'bad'}).status_code,401)
    def test_issue_lifecycle_and_conflict(self):
        issue={'project_id':1,'title':'Integration test','description':'Round trip','status':'To do','priority':'High','type':'Task','points':3,'version':1}
        r=self.client.post('/api/issues',json=issue,headers=self.headers)
        self.assertEqual(r.status_code,201);issue_id=r.json()['id']
        issue['status']='Done'
        self.assertEqual(self.client.put(f'/api/issues/{issue_id}',json=issue,headers=self.headers).status_code,200)
        self.assertEqual(self.client.put(f'/api/issues/{issue_id}',json=issue,headers=self.headers).status_code,409)
        self.assertEqual(self.client.post(f'/api/issues/{issue_id}/comments',json={'body':'Verified'},headers=self.headers).status_code,201)
        self.assertEqual(self.client.get(f'/api/issues/{issue_id}/comments').json()[0]['body'],'Verified')
        saved=next(x for x in self.client.get('/api/workspace').json()['issues'] if x['id']==issue_id)
        self.assertEqual(saved['status'],'Done');self.assertEqual(saved['version'],2)
    def test_viewer_and_csrf(self):
        self.assertEqual(self.client.post('/api/projects',json={'name':'X','key':'XX'}).status_code,403)
        self.assertEqual(self.client.post('/api/members',headers=self.headers,json={'name':'Viewer','email':'viewer@test.local','password':'viewer-password-123','role':'viewer'}).status_code,201)
        self.client.cookies.clear()
        self.client.post('/api/login',json={'email':'viewer@test.local','password':'viewer-password-123'})
        self.assertEqual(self.client.get('/api/workspace').status_code,200)
        self.assertEqual(self.client.post('/api/projects',json={'name':'X','key':'XX'},headers=self.headers).status_code,403)
        self.assertEqual(self.client.post('/api/members',json={'name':'Other','email':'other@test.local','password':'other-password-123'},headers=self.headers).status_code,403)
    def test_validation(self):
        self.assertEqual(self.client.post('/api/issues',headers=self.headers,json={'project_id':1,'title':'x','status':'invalid'}).status_code,422)
        self.assertEqual(self.client.post('/api/issues',headers=self.headers,json={'project_id':999,'title':'x'}).status_code,404)
    def test_schedule_dates(self):
        body={'project_id':1,'title':'Scheduled work','start_date':'2026-09-16','due_date':'2026-09-20'}
        response=self.client.post('/api/issues',headers=self.headers,json=body)
        self.assertEqual(response.status_code,201)
        issue_id=response.json()['id']
        issue=next(x for x in self.client.get('/api/workspace').json()['issues'] if x['id']==issue_id)
        self.assertEqual(issue['start_date'],'2026-09-16')
        self.assertEqual(issue['due_date'],'2026-09-20')
        for start,end in [('2026-09-21','2026-09-20'),('2026-02-30','2026-03-01'),('2026-09-16','')]:
            self.assertEqual(self.client.put(f'/api/issues/{issue_id}',headers=self.headers,json={**issue,'start_date':start,'due_date':end}).status_code,422)
        self.assertEqual(self.client.put(f'/api/issues/{issue_id}',headers=self.headers,json={**issue,'start_date':'','due_date':''}).status_code,200)
    def test_signup_workspace_profile_sprint_and_isolation(self):
        self.client.cookies.clear()
        signup={
            'name':'Workspace Owner','email':'owner@acme.test','password':'owner-password-123',
            'company_name':'Acme Studio','project_name':'Website Launch','project_key':'WEB',
            'members':[{'name':'Jordan Lee','email':'jordan@acme.test','password':'member-password-123','role':'member'}],
        }
        response=self.client.post('/api/signup',headers=self.headers,json=signup)
        self.assertEqual(response.status_code,201)
        project_id=response.json()['project_id']
        workspace=self.client.get('/api/workspace').json()
        self.assertEqual(workspace['workspace']['name'],'Acme Studio')
        self.assertEqual([p['name'] for p in workspace['projects']],['Website Launch'])
        self.assertEqual({u['email'] for u in workspace['users']},{'owner@acme.test','jordan@acme.test'})
        member_id=next(u['id'] for u in workspace['users'] if u['email']=='jordan@acme.test')
        updated=self.client.put('/api/profile',headers=self.headers,json={'name':'Renamed Owner'})
        self.assertEqual(updated.status_code,200)
        self.assertEqual(updated.json()['name'],'Renamed Owner')
        sprint={'project_id':project_id,'name':'Launch Sprint','goal':'Ship the first release','start_date':'2026-09-21','end_date':'2026-10-04'}
        self.assertEqual(self.client.post('/api/sprints',headers=self.headers,json=sprint).status_code,201)
        issue={'project_id':project_id,'title':'Prepare launch','sprint':'Launch Sprint','assignee_id':member_id}
        self.assertEqual(self.client.post('/api/issues',headers=self.headers,json=issue).status_code,201)
        workspace=self.client.get('/api/workspace').json()
        self.assertEqual(workspace['sprints'][0]['name'],'Launch Sprint')
        self.assertEqual(workspace['issues'][0]['assignee_id'],member_id)

        self.client.cookies.clear()
        self.assertEqual(self.client.post('/api/login',json={'email':'admin@orbit.local','password':'test-password-1234'}).status_code,200)
        original=self.client.get('/api/workspace').json()
        self.assertNotIn(project_id,{p['id'] for p in original['projects']})
        self.assertEqual(self.client.post('/api/issues',headers=self.headers,json={'project_id':project_id,'title':'Cross tenant'}).status_code,404)
    def test_logout(self):
        self.assertEqual(self.client.post('/api/logout',headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/api/me').status_code,401)
if __name__=='__main__':unittest.main()
