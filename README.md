# College Compass

An evidence-audited dashboard of 25 undergraduate AI/CS programs, prepared for a Fall 2027 college applicant.

**Live site:** https://vikasgaddu1.github.io/college-compass/

## What it is

Interactive dashboard that lets you filter, sort, and compare 25 US universities on:

- AI curriculum depth, undergraduate research access, and hands-on/project ecosystem
- Financial aid, net price by family income band, and Common Data Set data
- Graduation rates and career outcomes for CS graduates
- Campus culture: Greek life, ambition, non-Greek social scene, rec facilities
- Application timeline (ED / EA / RD deadlines for the Fall 2027 cycle)
- Program-fit "why to choose" and "biggest drawback" narratives
- Personal notes, ratings, and status per school (saved in your browser)

## Data sources

- 1,430 individually logged sources: official university pages, Common Data Sets, IPEDS, first-destination outcomes reports, and official admissions calendars
- Data snapshot: July 29, 2026 (research) + August 15, 2026 (deadlines and outcomes)

## Notes storage

Notes save to `localStorage` in your browser. They are **local to this device** — use the Notebook tab's *Export JSON* / *Import JSON* buttons to move them between your laptop, phone, or school computer.

## Static site

This is a pure static SPA (Vite + React + Tailwind + Recharts). No backend, no telemetry, no accounts.
