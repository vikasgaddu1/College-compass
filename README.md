# College Compass

An evidence-audited dashboard of 13 universities, prepared for a Fall 2027 applicant whose goal is robotics.

**Live site:** https://vikasgaddu1.github.io/College-compass/

## What it is

The school list is fixed at 13: Carnegie Mellon, Cornell, Duke, Georgia Tech, Johns Hopkins, NC State, Northeastern, Purdue, RPI, Ohio State, Maryland, Michigan and WPI.

The **Robotics routes** page is the main view. For each school it shows a dedicated BS in Robotics where one exists, the ECE route and the CS route, with the robotics track and key courses in each, how a first-year actually gets in, any robotics minor, and the recommended route. That research (October 2026) lives in `college-dashboard/client/src/data/robotics_routes.json`, with source links per route.

Interactive dashboard that lets you filter, sort, and compare the 13 schools on:

- Robotics route (BS Robotics / ECE / CS), curriculum depth, undergraduate research access, and hands-on/project ecosystem
- Financial aid, net price by family income band, and Common Data Set data
- Graduation rates and career outcomes for CS graduates
- Campus culture: Greek life, ambition, non-Greek social scene, rec facilities
- Application timeline (ED / EA / RD deadlines for the Fall 2027 cycle)
- Program-fit "why to choose" and "biggest drawback" narratives
- Personal notes, ratings, and status per school (saved in your browser)

## Data sources

- 1,430 individually logged sources: official university pages, Common Data Sets, IPEDS, first-destination outcomes reports, and official admissions calendars
- Data snapshot: July 29, 2026 (research) + August 15, 2026 (deadlines and outcomes) + October 13, 2026 (robotics routes)

## Notes storage

Notes save to `localStorage` in your browser. They are **local to this device** — use the Notebook tab's *Export JSON* / *Import JSON* buttons to move them between your laptop, phone, or school computer.

## Static site

This is a pure static SPA (Vite + React + Tailwind + Recharts). No backend, no telemetry, no accounts.
