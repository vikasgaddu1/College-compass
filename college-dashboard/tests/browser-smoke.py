import json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
repo=Path(__file__).resolve().parents[1]
paths=re.findall(r'<Route path="([^"]+)"', (repo/'client/src/App.tsx').read_text())
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=b.new_context(viewport={'width':1440,'height':1000})
 # Older saved exclusions must not narrow the new 13-school default.
 legacy_hidden=[s['slug'] for s in json.loads((repo/'client/src/data/schools.json').read_text())[:4]]
 context.add_init_script('localStorage.setItem("cc_hidden_schools_v1",'+json.dumps(json.dumps(legacy_hidden))+');')
 page=context.new_page();errors=[];failed=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('requestfailed',lambda r:failed.append({'url':r.url,'failure':r.failure}))
 result=[]
 for path in paths+['/does-not-exist']:
  print('Checking',path,flush=True)
  page.goto('http://127.0.0.1:5000/#'+path,wait_until='networkidle')
  if errors: print('ERRORS',errors,flush=True)
  expect(page.locator('#root')).not_to_be_empty()
  assert len(page.locator('#root').inner_text())>120,path
  assert page.locator('vite-error-overlay').count()==0,path
  result.append({'path':path,'headings':page.get_by_role('heading').all_text_contents()[:3]})
 assert not errors,errors
 page.goto('http://127.0.0.1:5000/#/routes',wait_until='networkidle')
 expect(page.locator('tbody tr')).to_have_count(13)
 page.get_by_role('button',name='BS in Robotics (5)',exact=True).click();expect(page.locator('tbody tr')).to_have_count(5)
 page.get_by_role('button',name='ECE route (8)',exact=True).click();expect(page.locator('tbody tr')).to_have_count(8)
 page.get_by_role('button',name='All (13)',exact=True).click()
 expect(page.get_by_text('AI course choices',exact=False).first).to_be_visible()
 expect(page.locator('tbody tr').filter(has_text='Rose-Hulman')).to_have_count(1)
 expect(page.locator('tbody tr').filter(has_text='Michigan-Dearborn')).to_have_count(1)
 expect(page.locator('tbody tr').filter(has_text='Cornell')).to_have_count(0)
 expect(page.locator('tbody tr').filter(has_text='Johns Hopkins')).to_have_count(0)
 page.get_by_title('Add a note',exact=True).first.click()
 dialog=page.get_by_role('dialog');note='Robotics audit persistence smoke'
 dialog.get_by_placeholder('What I like, what I want to check, who I talked to, links to threads I found…').fill(note)
 page.wait_for_function('Object.values(JSON.parse(localStorage.getItem("college-compass-notes.v1")||"{}")).some(n=>n.notes==="Robotics audit persistence smoke")')
 page.keyboard.press('Escape');page.reload(wait_until='networkidle');page.get_by_title('Edit your notes',exact=True).first.click()
 expect(page.get_by_role('dialog').get_by_placeholder('What I like, what I want to check, who I talked to, links to threads I found…')).to_have_value(note)
 page.keyboard.press('Escape')
 page.screenshot(path='/tmp/robotics-routes-desktop.png')
 page.goto('http://127.0.0.1:5000/#/robotics-degrees',wait_until='networkidle')
 text=page.locator('body').inner_text()
 assert '13 visible schools' in text and 'Arizona State' not in text and 'Purdue University Northwest' not in text
 page.goto('http://127.0.0.1:5000/#/timeline',wait_until='networkidle')
 text=page.locator('body').inner_text();assert '2026-11-02' in text and '2027-01-05' in text
 assert 'Applying ED1' in text and 'Applying EA2' in text
 assert len(json.loads((repo/'client/src/data/applications.json').read_text())['applications'])==13
 assert 'Round and deadline unconfirmed' in text
 assert 'Rose-Hulman' in text and 'Michigan-Dearborn' in text
 assert 'Invalid Date' not in text and 'NaN' not in text
 page.goto('http://127.0.0.1:5000/#/sequencing',wait_until='networkidle')
 expect(page).to_have_url('http://127.0.0.1:5000/#/timeline')
 expect(page.get_by_role('heading',name='Application timeline',exact=True)).to_be_visible()
 expect(page.locator('a[href="#/sequencing"]')).to_have_count(0)
 page.goto('http://127.0.0.1:5000/#/odds',wait_until='networkidle')
 expect(page.locator('tbody tr')).to_have_count(13)
 page.goto('http://127.0.0.1:5000/#/hidden',wait_until='networkidle')
 expect(page.get_by_text('partial ratings are less certain',exact=False)).to_be_visible()
 page.get_by_title('Hide this school from every view',exact=True).first.click()
 page.goto('http://127.0.0.1:5000/#/odds',wait_until='networkidle')
 expect(page.locator('tbody tr')).to_have_count(12)
 page.reload(wait_until='networkidle')
 expect(page.locator('tbody tr')).to_have_count(12)
 page.get_by_role('button',name='Restore all 1 hidden',exact=True).click()
 expect(page.locator('tbody tr')).to_have_count(13)
 page.reload(wait_until='networkidle')
 expect(page.locator('tbody tr')).to_have_count(13)
 for path in ['/why','/drawbacks','/curriculum','/cost','/scholarships','/outcomes','/checklist','/culture','/culture-signals','/visits']:
  page.goto('http://127.0.0.1:5000/#'+path,wait_until='networkidle')
  text=page.locator('body').inner_text()
  assert 'Rose-Hulman' in text and 'Michigan-Dearborn' in text,path
  assert '100% commuter' not in text and 'commuter-oriented' not in text,path
 page.goto('http://127.0.0.1:5000/#/cmu-plan',wait_until='networkidle')
 assert '360' in page.locator('body').inner_text();assert 'Stats & ML core' not in page.locator('body').inner_text()
 page.goto('http://127.0.0.1:5000/#/outcomes',wait_until='networkidle')
 page.get_by_role('button',name='Careers & grad school',exact=True).click()
 assert 'mean' in page.locator('body').inner_text().lower()
 page.goto('http://127.0.0.1:5000/#/scholarships',wait_until='networkidle')
 text=page.locator('body').inner_text();assert '150' in text and '2026-11-01' in text
 page.goto('http://127.0.0.1:5000/#/compare',wait_until='networkidle');page.screenshot(path='/tmp/robotics-compare-desktop.png')
 page.goto('http://127.0.0.1:5000/#/cost',wait_until='networkidle')
 page.get_by_role('button',name=re.compile('Getting there \\+ being there')).click()
 weather=page.get_by_role('table').filter(has=page.get_by_role('columnheader',name='City · airport',exact=True))
 for school in ['Rose-Hulman','Michigan-Dearborn']:
  row=weather.locator('tbody tr').filter(has_text=school)
  expect(row).to_have_count(1)
  for i in [2,3,4,5]: expect(row.locator('td').nth(i)).to_have_text('Unverified')
 page.goto('http://127.0.0.1:5000/#/',wait_until='networkidle');page.screenshot(path='/tmp/robotics-overview-desktop.png')
 page.set_viewport_size({'width':390,'height':844});page.goto('http://127.0.0.1:5000/#/routes',wait_until='networkidle')
 expect(page.get_by_role('heading',name='Robotics degrees with hardware, controls and AI')).to_be_visible()
 page.screenshot(path='/tmp/robotics-routes-mobile.png')
 assert not errors,errors
 unexpected=[r for r in failed if not r['url'].startswith(('https://fonts.googleapis.com/','https://fonts.gstatic.com/'))]
 assert not unexpected,unexpected
 summary={'pages_rendered':len(result),'pages':result,'interactive_checks':['robotics filters5/8/13','approved replacement roster','new colleges across comparison pages','pending rounds and dates','AI elective/access notes','note persistence','selected13degreeexplorer','timeline multiple rounds','sequencing redirects to timeline','legacy hidden preferences reset','new hide and restore persist','CMU360units','career statistic labels','scholarship deadlines/income','mobile robotics rendering'],'javascript_errors':errors,'external_font_failures':failed}
 Path('/tmp/college-compass-browser-result.json').write_text(json.dumps(summary,indent=2))
 print(json.dumps(summary))
 b.close()
