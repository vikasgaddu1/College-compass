# College Compass

A robotics-first comparison of 13 universities for Fall 2027 entry, with AI as supporting coursework. Official programme, catalogue, admissions, scholarship, budget and accessible Common Data Set sources were reviewed on **October 14, 2026**.

The selected schools are Carnegie Mellon, Cornell, Duke, Georgia Tech, Johns Hopkins, Maryland College Park, Michigan Ann Arbor, NC State, Northeastern, Ohio State, Purdue West Lafayette, RPI and WPI.

**Live site:** https://vikasgaddu1.github.io/College-compass/

Start with **Robotics routes**: the primary robotics degree where available, otherwise the recommended ECE/CE route, its CS alternative, actual entry restrictions, and undergraduate AI choices with prerequisites/permissions. Four schools have primary robotics degrees; Purdue’s engineering-technology option is separate. All comparison pages use the same selected-school recommendations.

The strongest integrated project route is WPI Robotics Engineering; Michigan Robotics BSE offers the broad public-university alternative; CMU Robotics BS is the research-intensive aspirational route through SCS. NC State EE Controls and Robotics is the local-value option. These are qualitative recommendations, not admission or financial guarantees.

Read [the research review](ROBOTICS_RESEARCH.md) for all 13 recommendations, official links, important corrections and unresolved source conflicts. [Data verification](DATA_VERIFICATION.md) explains historical versus current figures.

## Development

Node 20.19+ (the cloud environment uses 20.19.5) and npm:

```bash
cd college-dashboard
npm ci
npm test
npm run check
npm run dev
```

The development server defaults to port 5000. `npm run build` builds the static Vite client and local Express server; `npm start` serves the production output. GitHub Pages CI builds the static client and runs data/TypeScript validation before deployment. Root `index.html`, `404.html` and `assets/` are a generated static snapshot of the client, refreshed with this change.

## Personal data and optional sync

Notes, ratings, priorities, hidden schools and rankings stay in browser localStorage. Use the Notebook export/import controls to move notes between devices. The selected plans are CMU ED1; EA at NC State, Northeastern, Purdue, Ohio State, UMD, RPI, Michigan and WPI (EA1); Georgia Tech EA2; and RD at Cornell, Johns Hopkins and Duke.

Supabase sync and counselor sharing are optional; see [SUPABASE_SETUP.md](SUPABASE_SETUP.md). The dashboard works signed out without credentials. Do not put service-role keys or other secrets in the client.

## Data limitations

Costs retain academic year, residency and programme scope; most are 2026–27. Georgia Tech already publishes a 2027–28 estimate. Current Engineering budgets, course permissions, future seats and some scholarship dates remain unverified where sources were inaccessible. CS/company outcomes and older campus sentiment are labeled historical context and are not treated as robotics placement evidence.
