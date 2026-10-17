#!/usr/bin/env python3
"""
College Compass — browser end-to-end test of the REAL production web build.

Drives the whole product flow on an iPhone 13 viewport (Chromium, light mode):

  Welcome → "Continue with ChatGPT" → authorize (mocked) → callback.html → token exchange (mocked)
  → ID-token RS256 verification against a mocked JWKS → "You're using your ChatGPT plan" sheet
  → all 17 onboarding questions answered through the UI → planner agent → parallel research agents
  (3 colleges per call, ≤4 calls in flight) → on-device ranking / odds → list → detail → Ask chat
  → reload (persistence + still signed in).

OpenAI is mocked at the network layer (Playwright `context.route`) in the wire formats the app
implements from OpenAI's docs:
  - https://auth.openai.com/api/accounts/authorize      (302 back to redirect_uri with code + state)
  - https://auth.openai.com/api/accounts/oauth/token    (PKCE S256 checked; RS256-signed id_token)
  - https://auth.openai.com/.well-known/jwks.json       (public JWK of a key generated per run)
  - https://api.openai.com/v1/models                    (ChatGPT-plan `models[]` shape)
  - https://api.openai.com/v1/responses                 (SSE: function calls for planner/researcher,
                                                         output_text deltas for chat)
Every request to any other host is aborted and fails the test.

Usage (normally via `npm run e2e`, which builds and serves the app first):
  python3 e2e/full-flow.py
Environment:
  E2E_BASE_URL        default http://localhost:4173/College-compass/app/
  E2E_CLIENT_ID       default oaiapp_e2e_test (must match VITE_CC_CHATGPT_CLIENT_ID of the build)
  E2E_OUT             screenshot directory (default e2e/screenshots next to this file)
  E2E_RESEARCH_DELAY  seconds each research response is held back (default 1.5)
  E2E_HEADED=1        show the browser
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import secrets
import sys
import time
import traceback
import urllib.parse
from pathlib import Path

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
except ImportError:  # pragma: no cover
    sys.exit("The e2e test needs `cryptography`: pip install --break-system-packages cryptography")
try:
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None  # schema validation of mock tool arguments is skipped with a warning

from playwright.async_api import Page, Request, Route, async_playwright, expect

HERE = Path(__file__).resolve().parent
BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:4173/College-compass/app/")
ORIGIN = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(BASE_URL))
CLIENT_ID = os.environ.get("E2E_CLIENT_ID", "oaiapp_e2e_test")
OUT = Path(os.environ.get("E2E_OUT", HERE / "screenshots"))
RESEARCH_DELAY = float(os.environ.get("E2E_RESEARCH_DELAY", "1.5"))
HEADED = os.environ.get("E2E_HEADED") == "1"

ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
SCOPES = {"openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"}
FORBIDDEN_BODY_KEYS = {"temperature", "max_output_tokens", "metadata", "user", "previous_response_id", "truncation", "top_p"}
ALLOWED_HOSTS = {urllib.parse.urlsplit(BASE_URL).netloc, "auth.openai.com", "api.openai.com"}
CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept",
    "access-control-expose-headers": "x-request-id",
    "access-control-max-age": "600",
}

ACCOUNT = {"sub": "user-e2e-0001", "name": "Avery Student", "email": "avery.e2e@example.com"}
WANTED = "University of North Carolina at Chapel Hill"
QUESTION = "Which of these should I apply Early Action to for pediatric nursing?"
CHAT_REPLY = (
    "For pediatric nursing, apply Early Action to UNC Chapel Hill (Oct 15) and to your in-state likely schools "
    "like UNC Wilmington and App State. Check each nursing program's progression rules before you commit."
)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def int_b64(n: int) -> str:
    return b64url(n.to_bytes((n.bit_length() + 7) // 8, "big"))


# ───────────────────────────── research fixtures (approximate, test-only figures) ─────────────────────────────

def college(name, short, city, state, ownership, locale, url, lat, lon, size, admit, sat, act, test_policy,
            tuition, coa, avg_net, grad, ret, earn, nursing_share, cds, plans, nursing, scholarships=(),
            religious=False, confidence="high", notes=()):
    """Builds one `submit_college_research` entry with every property the strict schema requires."""
    t_in, t_out = tuition
    nbi_f = (0.45, 0.6, 0.8, 1.05, 1.35)
    host = urllib.parse.urlsplit(url).netloc
    return {
        "name": name, "short": short, "city": city, "state": state, "ownership": ownership, "locale": locale,
        "url": url, "lat": lat, "lon": lon, "undergrad_size": size, "admit_rate": admit,
        "sat_25": sat[0] if sat else None, "sat_75": sat[1] if sat else None,
        "act_25": act[0] if act else None, "act_75": act[1] if act else None,
        "test_policy": test_policy, "tuition_in_state": t_in, "tuition_out_of_state": t_out,
        "cost_of_attendance": coa, "avg_net_price": avg_net,
        "net_price_by_income": dict(zip(["0_30k", "30_48k", "48_75k", "75_110k", "110k_plus"],
                                        [int(round(avg_net * f, -2)) for f in nbi_f])),
        "grad_rate_6yr": grad, "retention_rate": ret, "median_earnings_10yr": earn,
        "program_share": [{"major": "nursing", "share": nursing_share}],
        "hbcu": False, "women_only": False, "religious": religious,
        "cds": {
            "cds_year": "2025-2026", "offers_ed": cds.get("ed") is not None, "offers_ea": cds.get("ea") is not None,
            "ed_admit_rate": cds.get("ed"), "ea_admit_rate": cds.get("ea"), "rd_admit_rate": cds.get("rd"),
            "in_state_admit_rate": cds.get("in"), "out_of_state_admit_rate": cds.get("out"),
            "avg_gpa": cds.get("gpa"), "gated_majors": ["nursing"] if nursing.get("gated") else [],
            "notes": cds.get("notes"), "source_url": f"https://{host}/common-data-set-2025-2026.pdf",
        },
        "application": {
            "cycle": "Fall 2027 entry",
            "plans": [{"plan": p, "deadline": d, "notes": n} for p, d, n in plans],
            "test_policy_note": {"required": "Scores required for Fall 2027.", "optional": "Test optional for Fall 2027; scores considered if sent."}.get(test_policy),
            "essays_note": "Common App essay plus short-answer supplements.",
            "fee": "$75 (waivers available)",
        },
        "programs": [
            {"major": "nursing", "offered": True, "degree": nursing["degree"], "how_to_enter": nursing["entry"], "notes": nursing.get("notes")},
            {"major": "public_health", "offered": True, "degree": "B.S. in Public Health", "how_to_enter": "Declare after the first year.", "notes": None},
        ],
        "scholarships": [{"name": s[0], "amount": s[1], "note": s[2]} for s in scholarships],
        "sources": [
            {"title": "Common Data Set 2025-2026", "url": f"https://{host}/common-data-set-2025-2026.pdf"},
            {"title": "Admissions: first-year deadlines", "url": f"https://{host}/admissions/first-year"},
            {"title": "College Scorecard", "url": "https://collegescorecard.ed.gov/"},
        ],
        "data_year": "2025-26 CDS", "data_confidence": confidence,
        "data_notes": list(notes) or ["Fall 2027 deadlines are based on last cycle — confirm on the admissions site."],
    }


DIRECT = "Direct admission to the BSN as a first-year."
UPPER = "Admitted as pre-nursing; competitive application to the upper-division BSN after year two."
FIXTURES = [
    college("University of North Carolina at Chapel Hill", "UNC Chapel Hill", "Chapel Hill", "NC", "public", "town",
            "https://www.unc.edu", 35.9049, -79.0469, 20210, 0.15, (1370, 1520), (30, 34), "required",
            (9018, 39338), 54800, 11500, 0.91, 0.96, 66000, 0.03,
            {"ea": 0.19, "rd": 0.12, "in": 0.43, "out": 0.08, "gpa": 4.39, "notes": "In-state applicants are admitted at about five times the out-of-state rate."},
            [("EA", "2026-10-15", "Non-binding"), ("RD", "2027-01-15", None)],
            {"degree": "B.S. in Nursing (BSN)", "entry": UPPER + " A small Assured Admission pathway exists.", "notes": "Pediatric clinicals at UNC Children's Hospital.", "gated": True},
            [("Morehead-Cain Scholarship", "Full cost of attendance", "Competitive; nominated through the EA application.")]),
    college("University of Virginia", "UVA", "Charlottesville", "VA", "public", "suburb", "https://www.virginia.edu",
            38.0336, -78.508, 17800, 0.17, (1400, 1530), (32, 35), "optional", (22000, 60000), 78000, 17000,
            0.95, 0.97, 77000, 0.03, {"ed": 0.28, "ea": 0.16, "rd": 0.14, "in": 0.25, "out": 0.14, "gpa": 4.3},
            [("ED", "2026-11-01", "Binding"), ("EA", "2026-11-01", None), ("RD", "2027-01-05", None)],
            {"degree": "B.S. in Nursing", "entry": DIRECT}),
    college("Emory University", "Emory", "Atlanta", "GA", "private_nonprofit", "suburb", "https://www.emory.edu",
            33.7925, -84.3239, 7300, 0.11, (1440, 1540), (32, 34), "optional", (64000, 64000), 88000, 24000,
            0.91, 0.95, 72000, 0.05, {"ed": 0.29, "rd": 0.08, "gpa": 3.9},
            [("ED", "2026-11-01", "Binding"), ("ED2", "2027-01-01", "Binding"), ("RD", "2027-01-01", None)],
            {"degree": "B.S. in Nursing (Nell Hodgson Woodruff School of Nursing)", "entry": DIRECT},
            [("Emory Scholars Program", "Partial to full tuition", "Competitive; separate scholarship application.")],
            religious=True),
    college("Villanova University", "Villanova", "Villanova", "PA", "private_nonprofit", "suburb", "https://www.villanova.edu",
            40.0377, -75.3426, 7000, 0.23, (1390, 1490), (32, 34), "optional", (66000, 66000), 89000, 32000,
            0.91, 0.95, 85000, 0.09, {"ed": 0.45, "ea": 0.25, "rd": 0.15, "gpa": 3.95},
            [("ED", "2026-11-01", "Binding"), ("EA", "2026-11-01", None), ("RD", "2027-01-15", None)],
            {"degree": "B.S. in Nursing (Fitzpatrick College of Nursing)", "entry": DIRECT}, religious=True),
    college("Clemson University", "Clemson", "Clemson", "SC", "public", "town", "https://www.clemson.edu",
            34.6834, -82.8374, 23400, 0.43, (1250, 1410), (27, 32), "optional", (15600, 40500), 58000, 22000,
            0.85, 0.93, 62000, 0.04, {"ea": 0.45, "in": 0.53, "out": 0.37, "gpa": 4.4},
            [("EA", "2026-12-01", None), ("RD", "2027-05-01", None)],
            {"degree": "B.S. in Nursing", "entry": DIRECT + " Very competitive.", "gated": True}),
    college("University of South Carolina", "South Carolina", "Columbia", "SC", "public", "city", "https://sc.edu",
            33.9938, -81.0299, 28500, 0.61, (1200, 1380), (26, 31), "optional", (12700, 34900), 52000, 20000,
            0.79, 0.90, 55000, 0.06, {"ea": 0.63, "in": 0.68, "out": 0.58, "gpa": 4.1},
            [("EA", "2026-10-15", None), ("RD", "2027-01-15", None)],
            {"degree": "B.S. in Nursing", "entry": UPPER, "gated": True},
            [("Out-of-State Academic Scholarship", "$5,000–$15,000/yr", "Automatic consideration with the EA application.")]),
    college("Virginia Commonwealth University", "VCU", "Richmond", "VA", "public", "city", "https://www.vcu.edu",
            37.5485, -77.4527, 21700, 0.91, (1060, 1260), None, "optional", (16000, 38000), 54000, 18000,
            0.70, 0.85, 50000, 0.05, {"ea": 0.92},
            [("EA", "2026-11-01", None), ("RD", "2027-01-15", None)],
            {"degree": "B.S. in Nursing", "entry": DIRECT + " Separate nursing application."}),
    college("James Madison University", "JMU", "Harrisonburg", "VA", "public", "town", "https://www.jmu.edu",
            38.4351, -78.8698, 21500, 0.77, (1150, 1310), (24, 29), "optional", (13800, 31700), 50000, 19000,
            0.83, 0.89, 56000, 0.05, {"ea": 0.80},
            [("EA", "2026-11-01", None), ("RD", "2027-01-15", None)],
            {"degree": "B.S. in Nursing", "entry": UPPER, "gated": True}),
    college("University of North Carolina Wilmington", "UNC Wilmington", "Wilmington", "NC", "public", "city",
            "https://uncw.edu", 34.2261, -77.8722, 15900, 0.70, (1170, 1300), (23, 28), "optional", (7200, 21500),
            41000, 14000, 0.74, 0.86, 50000, 0.07, {"ea": 0.72, "in": 0.74, "out": 0.62},
            [("EA", "2026-11-01", None), ("RD", "2027-02-01", None)],
            {"degree": "B.S. in Nursing", "entry": UPPER, "gated": True}),
    college("University of North Carolina at Greensboro", "UNC Greensboro", "Greensboro", "NC", "public", "city",
            "https://www.uncg.edu", 36.0689, -79.8102, 15000, 0.90, (1030, 1200), (19, 25), "optional", (7400, 22500),
            39000, 9000, 0.57, 0.75, 42000, 0.08, {"in": 0.91, "out": 0.85},
            [("Priority", "2026-12-01", None), ("RD", "2027-03-01", None)],
            {"degree": "B.S. in Nursing", "entry": UPPER, "gated": True}, confidence="medium"),
    college("University of Pittsburgh", "Pitt", "Pittsburgh", "PA", "public", "city", "https://www.pitt.edu",
            40.4444, -79.9608, 20000, 0.49, (1260, 1440), (28, 33), "optional", (20600, 37600), 55000, 22000,
            0.84, 0.93, 61000, 0.07, {"gpa": 4.1},
            [("Rolling", None, "Apply by Jan 15 for priority scholarship consideration")],
            {"degree": "B.S. in Nursing", "entry": DIRECT + " Guaranteed progression with good standing."}),
    college("Appalachian State University", "App State", "Boone", "NC", "public", "town", "https://www.appstate.edu",
            36.2142, -81.6795, 19000, 0.89, (1080, 1250), (21, 26), "optional", (7900, 23600), 37000, 13500,
            0.72, 0.82, 45000, 0.03, {"ea": 0.90},
            [("EA", "2026-11-15", None), ("RD", "2027-03-15", None)],
            {"degree": "B.S. in Nursing", "entry": UPPER, "gated": True}),
    college("East Carolina University", "ECU", "Greenville", "NC", "public", "city", "https://www.ecu.edu",
            35.6066, -77.3664, 22000, 0.89, (1050, 1200), (19, 24), "optional", (7200, 23500), 38000, 13000,
            0.65, 0.82, 46000, 0.07, {},
            [("Priority", "2026-11-01", None), ("RD", "2027-03-15", None)],
            {"degree": "B.S. in Nursing", "entry": UPPER, "gated": True}, confidence="medium"),
    college("University of North Carolina at Charlotte", "UNC Charlotte", "Charlotte", "NC", "public", "city",
            "https://www.charlotte.edu", 35.3071, -80.7352, 25000, 0.80, (1110, 1270), (21, 26), "optional",
            (7000, 21000), 38000, 12500, 0.63, 0.82, 47000, 0.04, {},
            [("EA", "2026-11-01", None), ("RD", "2027-03-01", None)],
            {"degree": "B.S. in Nursing", "entry": UPPER, "gated": True}),
]
FIXTURE_BY_NAME = {c["name"].lower(): c for c in FIXTURES}
PLANNED = [  # (fixture index, expected tier, why) — the planner never repeats the student's own pick
    (1, "high_reach", "Direct-admit BSN at a top public with strong pediatric clinical placements."),
    (2, "high_reach", "Direct-admit nursing school with Children's Healthcare of Atlanta clinicals."),
    (3, "reach", "Highly ranked direct-admit BSN; EA available without a binding commitment."),
    (4, "target", "Direct-admit BSN at a large public in a college town."),
    (5, "target", "Large BSN program; automatic merit can bring out-of-state cost near budget."),
    (10, "target", "Direct-admit nursing with guaranteed progression; rolling admission."),
    (7, "likely", "Strong nursing program in a college town, solid four-year graduation rate."),
    (8, "likely", "In-state coastal campus with a well-regarded BSN."),
    (6, "safety", "Direct-admit BSN in Richmond with a major academic medical center."),
    (11, "safety", "In-state value with a mountain college-town setting."),
    (12, "safety", "In-state; home of a large BSN program and a children's hospital affiliate."),
    (9, "safety", "Affordable in-state option with a large nursing school."),
]


# ───────────────────────────── mock OpenAI ─────────────────────────────

class MockOpenAI:
    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = "e2e-" + secrets.token_hex(4)
        pub = self.key.public_key().public_numbers()
        self.jwk = {"kty": "RSA", "use": "sig", "alg": "RS256", "kid": self.kid, "n": int_b64(pub.n), "e": int_b64(pub.e)}
        self.access_token = "e2e-access-" + secrets.token_hex(16)
        self.refresh_token = "e2e-refresh-" + secrets.token_hex(16)
        self.authorize: dict[str, str] | None = None
        self.token_calls = 0
        self.jwks_calls = 0
        self.models_calls = 0
        self.preflights = 0
        self.planner_calls: list[dict] = []
        self.research_calls: list[dict] = []
        self.chat_calls: list[dict] = []
        self.failures: list[str] = []
        self.unexpected: list[str] = []
        self.t0 = time.monotonic()
        self.seq = 0

    # helpers
    def fail(self, msg: str) -> None:
        self.failures.append(msg)
        raise AssertionError(msg)

    def check(self, cond: bool, msg: str) -> None:
        if not cond:
            self.fail(msg)

    def guard(self, fn):
        async def handler(route: Route, request: Request) -> None:
            if request.method == "OPTIONS":  # CORS preflight (if the browser sends it to the network layer)
                self.preflights += 1
                await route.fulfill(status=204, headers=CORS, body="")
                return
            try:
                await fn(route, request)
            except Exception as e:  # noqa: BLE001
                if not isinstance(e, AssertionError) or str(e) not in self.failures:
                    self.failures.append(f"{fn.__name__}: {e!r}")
                try:
                    await route.fulfill(status=418, headers={**CORS, "content-type": "application/json"},
                                        body=json.dumps({"error": {"message": f"e2e mock assertion: {e}", "code": "e2e_assertion"}}))
                except Exception:  # noqa: BLE001
                    pass
        handler.__name__ = fn.__name__
        return handler

    def id_token(self, nonce: str) -> str:
        now = int(time.time())
        header = {"alg": "RS256", "typ": "JWT", "kid": self.kid}
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "sub": ACCOUNT["sub"], "email": ACCOUNT["email"], "email_verified": True,
                  "name": ACCOUNT["name"], "nonce": nonce, "iat": now, "exp": now + 3600, "auth_time": now}
        signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(claims).encode())}"
        sig = self.key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())
        return f"{signing_input}.{b64url(sig)}"

    # ── auth.openai.com ──
    async def authorize_route(self, route: Route, request: Request) -> None:
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(request.url).query))
        self.check(q.get("response_type") == "code", f"authorize response_type={q.get('response_type')}")
        self.check(q.get("client_id") == CLIENT_ID, f"authorize client_id={q.get('client_id')}")
        self.check(set(q.get("scope", "").split()) == SCOPES, f"authorize scope={q.get('scope')}")
        self.check(q.get("resource") == RESOURCE, f"authorize resource={q.get('resource')}")
        self.check(q.get("code_challenge_method") == "S256", "authorize code_challenge_method")
        self.check(bool(re.fullmatch(r"[A-Za-z0-9_-]{43}", q.get("code_challenge", ""))), "authorize code_challenge format")
        self.check(q.get("redirect_uri") == BASE_URL + "callback.html", f"authorize redirect_uri={q.get('redirect_uri')}")
        for k in ("state", "nonce"):
            self.check(len(q.get(k, "")) >= 22, f"authorize {k} missing/short")
        self.check(not q["state"].endswith(".n"), "web sign-in must not use the native state suffix")
        self.authorize = q
        loc = q["redirect_uri"] + "?" + urllib.parse.urlencode({"code": "e2e-code", "state": q["state"]})
        await route.fulfill(status=302, headers={"location": loc, "cache-control": "no-store"}, body="")

    async def token_route(self, route: Route, request: Request) -> None:
        self.token_calls += 1
        self.check(request.method == "POST", "token endpoint must be POST")
        self.check("application/x-www-form-urlencoded" in (request.headers.get("content-type") or ""), "token content-type")
        f = dict(urllib.parse.parse_qsl(request.post_data or ""))
        a = self.authorize
        self.check(a is not None, "token request before authorize")
        self.check(f.get("grant_type") == "authorization_code", f"grant_type={f.get('grant_type')}")
        self.check(f.get("code") == "e2e-code", f"code={f.get('code')}")
        self.check(f.get("client_id") == CLIENT_ID, f"token client_id={f.get('client_id')}")
        self.check(f.get("redirect_uri") == a["redirect_uri"], "token redirect_uri differs from authorize")
        verifier = f.get("code_verifier", "")
        self.check(43 <= len(verifier) <= 128, "code_verifier length")
        self.check(b64url(hashlib.sha256(verifier.encode()).digest()) == a["code_challenge"], "PKCE: S256(code_verifier) != code_challenge")
        self.check(f.get("resource") in (None, RESOURCE), f"token resource={f.get('resource')}")
        self.check(self.token_calls == 1, "authorization code exchanged more than once")
        body = {"access_token": self.access_token, "refresh_token": self.refresh_token, "id_token": self.id_token(a["nonce"]),
                "expires_in": 3600, "token_type": "Bearer",
                "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"}
        await route.fulfill(status=200, headers={**CORS, "content-type": "application/json", "cache-control": "no-store"}, body=json.dumps(body))

    async def jwks_route(self, route: Route, request: Request) -> None:
        self.jwks_calls += 1
        await route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body=json.dumps({"keys": [self.jwk]}))

    # ── api.openai.com ──
    async def bearer(self, request: Request) -> None:
        h = await request.all_headers()
        self.check(h.get("authorization") == f"Bearer {self.access_token}", f"Authorization header={h.get('authorization')!r}")

    async def models_route(self, route: Route, request: Request) -> None:
        self.models_calls += 1
        await self.bearer(request)
        body = {"models": [{"slug": "gpt-e2e", "display_name": "GPT E2E", "visibility": "list"},
                           {"slug": "gpt-hidden", "display_name": "Hidden", "visibility": "hide"}]}
        await route.fulfill(status=200, headers={**CORS, "content-type": "application/json"}, body=json.dumps(body))

    async def responses_route(self, route: Route, request: Request) -> None:
        t_start = time.monotonic()
        self.check(request.method == "POST", "responses must be POST")
        await self.bearer(request)
        body = json.loads(request.post_data or "{}")
        self.check(body.get("store") is False, "store must be false")
        self.check(body.get("stream") is True, "stream must be true")
        self.check(body.get("model") == "gpt-e2e", f"model={body.get('model')} (expected the first listed model)")
        bad = FORBIDDEN_BODY_KEYS & set(body)
        self.check(not bad, f"forbidden request fields: {sorted(bad)}")
        self.check(isinstance(body.get("instructions"), str) and body["instructions"], "instructions missing")
        self.check(all(m.get("role") in ("user", "assistant") for m in body.get("input", [])), "input roles must be user/assistant")
        fns: list[dict] = []
        namespace = None
        for t in body.get("tools", []):
            if t.get("type") == "namespace":
                namespace = t.get("name")
                fns += [x for x in t.get("tools", []) if x.get("type") == "function"]
            elif t.get("type") == "function":
                fns.append(t)
            else:
                self.check(t.get("type") == "web_search", f"unexpected tool type {t.get('type')}")
        names = {f["name"] for f in fns}
        user_text = next((m["content"] for m in reversed(body.get("input", [])) if m["role"] == "user"), "")

        if "propose_colleges" in names:
            self.check(namespace == "college_compass", "ChatGPT-plan function tools must be namespaced")
            self.check(body.get("tool_choice") == "required", f"planner tool_choice={body.get('tool_choice')}")
            self.check(WANTED in user_text, "planner input should list the student's own pick")
            m = re.search(r"Propose exactly (\d+) additional", user_text)
            self.check(bool(m) and int(m.group(1)) == 11, "planner should be asked to top 1 pick up to the default 12")
            args = {"candidates": [{"name": FIXTURES[i]["name"], "state": FIXTURES[i]["state"], "why": why, "expected_tier": tier} for i, tier, why in PLANNED[: int(m.group(1)) if m else len(PLANNED)]]}
            self.validate(fns, "propose_colleges", args)
            self.planner_calls.append({"start": t_start - self.t0, "count": len(args["candidates"])})
            await self.send(route, function_call_events("propose_colleges", namespace, args, body["model"], self))
            return

        if "submit_college_research" in names:
            self.check(namespace == "college_compass", "ChatGPT-plan function tools must be namespaced")
            self.check(body.get("tool_choice") == "required", f"research tool_choice={body.get('tool_choice')}")
            requested = re.findall(r"^\d+\. (.+?)(?: \(([A-Z]{2})\))?$", user_text.split("\n\n")[0], re.M)
            self.check(1 <= len(requested) <= 3, f"research call carried {len(requested)} colleges (max 3)")
            majors = re.findall(r"(\w+) = ", re.search(r"Major areas[^\n]*", user_text).group(0))
            self.check(majors == ["nursing", "public_health"], f"researcher majors={majors}")
            self.check("pediatrics" in user_text, "researcher input should carry the free-text interest")
            out = []
            for name, st in requested:
                fx = FIXTURE_BY_NAME.get(name.lower())
                self.check(fx is not None, f"no fixture for requested college {name!r}")
                self.check(not st or st == fx["state"], f"state mismatch for {name}: {st}")
                out.append(json.loads(json.dumps(fx)))
            args = {"colleges": out}
            self.validate(fns, "submit_college_research", args)
            rec = {"names": [n for n, _ in requested], "start": t_start - self.t0}
            self.research_calls.append(rec)
            await asyncio.sleep(RESEARCH_DELAY)  # hold the response so parallelism is observable
            await self.send(route, function_call_events("submit_college_research", namespace, args, body["model"], self))
            rec["end"] = time.monotonic() - self.t0
            return

        # Ask tab: plain chat, no tools
        self.check(not fns, f"chat call should not send function tools, got {sorted(names)}")
        self.check(user_text == QUESTION, f"chat question={user_text!r}")
        self.check("UNC Chapel Hill" in body["instructions"], "chat instructions should summarize the student's list")
        self.chat_calls.append({"start": t_start - self.t0})
        await self.send(route, text_events(CHAT_REPLY, body["model"], self))

    def validate(self, fns: list[dict], name: str, args: dict) -> None:
        schema = next(f["parameters"] for f in fns if f["name"] == name)
        if jsonschema is None:
            print("WARN: jsonschema not installed; mock arguments not validated against the app's tool schema")
            return
        try:
            jsonschema.Draft202012Validator(schema).validate(args)
        except jsonschema.ValidationError as e:
            self.fail(f"mock {name} arguments don't match the app's strict schema: {e.message} at {list(e.absolute_path)}")

    async def send(self, route: Route, events: list[dict]) -> None:
        body = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
        await route.fulfill(status=200, headers={**CORS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache",
                                                 "x-request-id": "req_e2e_" + secrets.token_hex(6)}, body=body)

    async def catch_all(self, route: Route, request: Request) -> None:
        host = urllib.parse.urlsplit(request.url).netloc
        if request.url.startswith(("data:", "blob:")) or host == urllib.parse.urlsplit(BASE_URL).netloc:
            await route.continue_()
            return
        self.unexpected.append(f"{request.method} {request.url}")
        await route.abort("blockedbyclient")


def _resp(model: str, status: str, output: list, mock: MockOpenAI) -> dict:
    mock.seq += 1
    return {"id": f"resp_e2e_{mock.seq}", "object": "response", "created_at": int(time.time()), "status": status,
            "model": model, "output": output, "store": False,
            "usage": {"input_tokens": 900, "output_tokens": 400, "total_tokens": 1300} if status == "completed" else None}


def _number(events: list[dict]) -> list[dict]:
    for i, e in enumerate(events):
        e["sequence_number"] = i
    return events


def function_call_events(name: str, namespace: str | None, args: dict, model: str, mock: MockOpenAI) -> list[dict]:
    arguments = json.dumps(args)
    item_id, call_id = "fc_" + secrets.token_hex(6), "call_" + secrets.token_hex(6)
    base = {"type": "function_call", "id": item_id, "call_id": call_id, "name": name, **({"namespace": namespace} if namespace else {})}
    added = {**base, "arguments": "", "status": "in_progress"}
    done = {**base, "arguments": arguments, "status": "completed"}
    resp = _resp(model, "in_progress", [], mock)
    events = [{"type": "response.created", "response": resp}, {"type": "response.in_progress", "response": resp},
              {"type": "response.output_item.added", "output_index": 0, "item": added}]
    step = max(1, len(arguments) // 7)
    for i in range(0, len(arguments), step):
        events.append({"type": "response.function_call_arguments.delta", "item_id": item_id, "output_index": 0, "delta": arguments[i:i + step]})
    events += [
        {"type": "response.function_call_arguments.done", "item_id": item_id, "output_index": 0, "name": name, "arguments": arguments},
        {"type": "response.output_item.done", "output_index": 0, "item": done},
        {"type": "response.completed", "response": {**_resp(model, "completed", [done], mock), "id": resp["id"]}},
    ]
    return _number(events)


def text_events(text: str, model: str, mock: MockOpenAI) -> list[dict]:
    item_id = "msg_" + secrets.token_hex(6)
    part0 = {"type": "output_text", "text": "", "annotations": []}
    resp = _resp(model, "in_progress", [], mock)
    events = [{"type": "response.created", "response": resp}, {"type": "response.in_progress", "response": resp},
              {"type": "response.output_item.added", "output_index": 0, "item": {"type": "message", "id": item_id, "role": "assistant", "status": "in_progress", "content": []}},
              {"type": "response.content_part.added", "item_id": item_id, "output_index": 0, "content_index": 0, "part": part0}]
    for w in re.findall(r"\S+\s*", text):
        events.append({"type": "response.output_text.delta", "item_id": item_id, "output_index": 0, "content_index": 0, "delta": w})
    part = {"type": "output_text", "text": text, "annotations": []}
    msg = {"type": "message", "id": item_id, "role": "assistant", "status": "completed", "content": [part]}
    events += [
        {"type": "response.output_text.done", "item_id": item_id, "output_index": 0, "content_index": 0, "text": text},
        {"type": "response.content_part.done", "item_id": item_id, "output_index": 0, "content_index": 0, "part": part},
        {"type": "response.output_item.done", "output_index": 0, "item": msg},
        {"type": "response.completed", "response": {**_resp(model, "completed", [msg], mock), "id": resp["id"]}},
    ]
    return _number(events)


# ───────────────────────────── flow ─────────────────────────────

class Flow:
    def __init__(self, page: Page, mock: MockOpenAI) -> None:
        self.page = page
        self.mock = mock
        self.shots: list[str] = []
        self.n = 0

    async def shot(self, name: str) -> None:
        self.n += 1
        path = OUT / f"{self.n:02d}-{name}.png"
        await self.page.screenshot(path=str(path))
        self.shots.append(str(path))

    def ok(self) -> None:
        if self.mock.failures:
            raise AssertionError("mock assertion(s) failed:\n  " + "\n  ".join(self.mock.failures))

    async def step(self, n: int, title: str) -> None:
        await expect(self.page.locator("h1.cc-nav-title")).to_have_text(f"{n} of 17")
        await expect(self.page.get_by_role("heading", name=title)).to_be_visible()

    async def cont(self) -> None:
        await self.page.get_by_role("button", name="Continue", exact=True).click()

    async def radio(self, label: str) -> None:
        r = self.page.get_by_role("radio", name=re.compile("^" + re.escape(label)))
        await r.click()
        await expect(r).to_have_attribute("aria-checked", "true")

    async def run(self) -> None:
        page = self.page

        # 1) Welcome → Continue with ChatGPT → authorize → callback.html → token → JWKS
        await page.goto(BASE_URL)
        await expect(page.get_by_role("heading", name="College Compass")).to_be_visible()
        await self.shot("welcome")
        # Sign in with the production service worker in control (a returning visitor): it must not
        # replace the OAuth redirect page (callback.html) with the cached SPA shell.
        await page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=15_000)
        await page.get_by_role("button", name="Continue with ChatGPT").click()
        sheet = page.get_by_role("dialog", name="You're using your ChatGPT plan")
        await expect(sheet).to_be_visible(timeout=15_000)
        self.ok()
        assert "#/onboarding/1" in page.url, page.url
        stored = await page.evaluate("JSON.parse(localStorage.getItem('cc2:chatgpt'))")
        assert stored["claims"]["sub"] == ACCOUNT["sub"] and stored["claims"]["name"] == ACCOUNT["name"], stored["claims"]
        assert stored["claims"]["signature_verified"] is True, "ID token RS256 signature was not verified against the JWKS"
        assert "id_token" not in stored and stored["client_id"] == CLIENT_ID and "chatgpt.tokens.use.direct" in stored["scope"]
        assert await page.evaluate("localStorage.getItem('cc2:oauth_pending')") is None, "pending sign-in not cleared"
        await self.shot("plan-sheet")
        await sheet.get_by_role("button", name="Got it").click()
        await expect(sheet).to_be_hidden()

        # 2) Onboarding — answer every question through the UI
        await self.step(1, "Where's home?")
        await page.get_by_role("button", name="Choose a state").click()
        states = page.get_by_role("dialog", name="Home state")
        await states.get_by_role("textbox", name="Search states").fill("north")
        await states.get_by_role("button", name=re.compile(r"^North Carolina")).click()
        await expect(states).to_be_hidden()
        await expect(page.get_by_role("button", name="North Carolina")).to_be_visible()
        await page.get_by_label("Your first name (optional)").fill("Avery")
        await self.shot("onboarding-home")
        await self.cont()

        await self.step(2, "When do you graduate high school?")
        await self.radio("Class of 2027")
        await self.cont()

        await self.step(3, "What's your GPA?")
        await page.get_by_label("Unweighted GPA").fill("3.8")
        await page.get_by_label("Weighted GPA (optional)").fill("4.35")
        await self.cont()

        await self.step(4, "Test scores?")
        await page.get_by_label("SAT total").fill("1420")
        await self.cont()

        await self.step(5, "How demanding is your course load?")
        await self.radio("Very demanding")
        await self.cont()

        await self.step(6, "Outside of class, what best describes you?")
        await self.radio("Leader at school")
        await self.cont()

        await self.step(7, "What do you want to study?")
        await page.get_by_role("button", name="Nursing", exact=True).click()
        await page.get_by_role("button", name="Public health", exact=True).click()
        await expect(page.get_by_role("button", name="Remove Nursing")).to_be_visible()
        await expect(page.get_by_role("button", name="Remove Public health")).to_be_visible()
        await self.shot("onboarding-majors")
        await self.cont()

        await self.step(8, "Anything more specific?")
        await page.get_by_role("textbox", name="Interests").fill("pediatrics")
        await page.get_by_role("button", name="Add", exact=True).click()
        await expect(page.get_by_role("button", name="Remove pediatrics")).to_be_visible()
        await self.cont()

        await self.step(9, "What can your family pay per year?")
        await page.get_by_label("Budget per year").fill("30000")
        await self.radio("$75k – $110k")
        await self.cont()

        await self.step(10, "Where would you like to be?")
        for r in ("South Atlantic", "Mid-Atlantic"):
            cb = page.get_by_role("checkbox", name=re.compile("^" + re.escape(r)))
            await cb.click()
            await expect(cb).to_have_attribute("aria-checked", "true")
        await self.cont()

        await self.step(11, "How big a school?")
        await self.radio("Large")
        await self.cont()

        await self.step(12, "What kind of place?")
        await self.radio("Suburb")
        await self.cont()

        await self.step(13, "Public or private?")
        await self.radio("Either")
        await self.cont()

        await self.step(14, "How early would you apply?")
        await self.radio("Early Action only")
        await self.cont()

        await self.step(15, "Would you be the first in your family to finish college?")
        await page.get_by_role("radio", name="No", exact=True).click()
        await expect(page.get_by_role("radio", name="No", exact=True)).to_have_attribute("aria-checked", "true")
        await self.cont()

        await self.step(16, "What matters most?")
        for label, key, want in (("Affordability", "End", "5"), ("Good chance of getting in", "ArrowRight", "4"), ("Location & campus feel", "ArrowLeft", "1")):
            s = page.get_by_role("slider", name=label)
            await s.focus()
            await s.press(key)
            await expect(s).to_have_value(want)
        await self.shot("onboarding-priorities")
        await self.cont()

        await self.step(17, "Colleges you already like?")
        box = page.get_by_role("textbox", name="College name")
        await box.fill(WANTED)
        await box.press("Enter")
        await expect(page.get_by_role("button", name=f"Remove {WANTED}")).to_be_visible()
        await self.shot("onboarding-wanted")

        profile = await page.evaluate("JSON.parse(localStorage.getItem('cc2:profile'))")
        expect_profile = {"home_state": "NC", "name": "Avery", "grad_year": 2027, "gpa_unweighted": 3.8, "gpa_weighted": 4.35, "sat": 1420,
                          "rigor": "very", "activities_strength": "school_leader", "majors": ["nursing", "public_health"],
                          "interests_text": "pediatrics", "budget_per_year": 30000, "income_band": "75_110k",
                          "regions": ["south_atlantic", "mid_atlantic"], "size": "large", "setting": "suburb", "ownership": "any",
                          "plan": "ea_only", "first_gen": False, "wanted_colleges": [WANTED]}
        diff = {k: (profile.get(k), v) for k, v in expect_profile.items() if profile.get(k) != v}
        assert not diff, f"profile answers not saved as entered: {diff}"
        assert profile["priorities"] == {"academics_fit": 4, "affordability": 5, "outcomes": 3, "odds": 4, "location": 1}, profile["priorities"]
        await page.get_by_role("button", name="Find my colleges").click()

        # 3) Research — planner, then parallel agents
        await expect(page.get_by_text("Agent 4", exact=True)).to_be_visible(timeout=20_000)
        await self.shot("research-in-progress")
        await expect(page.get_by_text("Research complete")).to_be_visible(timeout=60_000)
        self.ok()
        total = 1 + min(len(PLANNED), 11)  # default research size is 12 (1 wanted + 11 planned)
        await expect(page.get_by_text(f"{total} of {total} colleges researched.")).to_be_visible()
        await expect(page.get_by_text(f"{total} colleges picked")).to_be_visible()
        await expect(page.get_by_text("Couldn't research")).to_have_count(0)
        lanes = page.locator("[data-lane]", has=page.get_by_text(re.compile(r"^Agent \d+$")))
        await expect(lanes).to_have_count(-(-total // 2))  # one lane per batch of 2
        await self.shot("research-complete")
        await page.get_by_role("button", name="See my list").click()

        # 4) List — tiers, odds bands, the student's own pick
        await expect(page.get_by_role("heading", name="Your list", level=2)).to_be_visible()
        cards = page.locator("article.cc-card")
        await expect(cards).to_have_count(total)
        tiers = ["High reach", "Reach", "Target", "Likely", "Safety"]
        present = [t for t in tiers if await page.locator(f'section[aria-label="{t}"]').count()]
        assert len(present) >= 3, f"expected at least 3 tier sections, got {present}"
        odds_re = re.compile(r"\d+–\d+%")
        texts = await cards.all_inner_texts()
        missing = [t.splitlines()[0] for t in texts if not odds_re.search(t)]
        assert not missing, f"cards without an odds band: {missing}"
        unc_card = page.get_by_role("button", name=re.compile("^" + re.escape(WANTED) + ", "))
        await expect(unc_card).to_be_visible()
        unc_label = await unc_card.get_attribute("aria-label")
        await self.shot("list")
        self.list_summary = {"tiers": present, "unc": unc_label}

        # 5) Detail — "You vs. them", odds factors, plans
        await unc_card.click()
        await expect(page.get_by_role("heading", name=WANTED, level=2)).to_be_visible()
        await expect(page.get_by_text("You vs. them")).to_be_visible()
        odds_group = page.locator("section", has=page.locator("h3", has_text="Why these odds"))
        factors = odds_group.locator(".cc-row-static")
        assert await factors.count() >= 2, "odds factor breakdown did not render"
        factor_text = await factors.all_inner_texts()
        await expect(page.get_by_text(re.compile(r"Plans & deadlines · Fall 2027 entry"))).to_be_visible()
        await expect(page.get_by_text("B.S. in Nursing (BSN)", exact=True)).to_be_visible()
        await self.shot("detail-top")
        await page.get_by_text("You vs. them").scroll_into_view_if_needed()
        await self.shot("detail-you-vs-them")
        self.detail_factors = factor_text
        await page.get_by_role("button", name="Back").click()
        await expect(page.get_by_role("heading", name="Your list", level=2)).to_be_visible()

        # 6) Ask — streamed reply
        await page.get_by_role("button", name="Ask", exact=True).click()
        await page.get_by_role("textbox", name="Message").fill(QUESTION)
        await page.get_by_role("button", name="Send").click()
        await expect(page.locator(".cc-bubble-ai")).to_have_text(CHAT_REPLY, timeout=15_000)
        await expect(page.locator(".cc-bubble-user")).to_have_text(QUESTION)
        self.ok()
        await self.shot("ask")

        # 7) Reload — list and chat persist, still signed in
        await page.reload()
        await expect(page.locator(".cc-bubble-ai")).to_have_text(CHAT_REPLY)
        await page.get_by_role("button", name="List", exact=True).click()
        await expect(page.locator("article.cc-card")).to_have_count(total)
        await expect(page.get_by_role("dialog", name="You're using your ChatGPT plan")).to_have_count(0)
        await self.shot("list-after-reload")
        await page.get_by_role("button", name="Settings", exact=True).click()
        await expect(page.get_by_text(ACCOUNT["name"])).to_be_visible()
        await expect(page.get_by_text(ACCOUNT["email"])).to_be_visible()
        await self.shot("settings-signed-in")
        await page.goto(BASE_URL)  # the start page sends a signed-in, onboarded user straight to the list
        await expect(page.get_by_role("heading", name="Your list", level=2)).to_be_visible()
        assert "#/list" in page.url, page.url
        self.ok()


def concurrency(calls: list[dict]) -> int:
    ev = sorted([(c["start"], 1) for c in calls] + [(c["end"], -1) for c in calls], key=lambda x: (x[0], x[1]))
    cur = peak = 0
    for _, d in ev:
        cur += d
        peak = max(peak, cur)
    return peak


async def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    mock = MockOpenAI()
    page_errors: list[str] = []
    console_errors: list[str] = []
    flow: Flow | None = None
    status = 1
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not HEADED)
        device = {k: v for k, v in p.devices["iPhone 13"].items() if k != "default_browser_type"}
        context = await browser.new_context(**device, color_scheme="light", locale="en-US", timezone_id="America/New_York")
        # Later routes take precedence: the catch-all only sees what no mock handles.
        await context.route("**/*", mock.catch_all)
        await context.route(re.compile(r"^https://auth\.openai\.com/api/accounts/authorize(\?.*)?$"), mock.guard(mock.authorize_route))
        await context.route(re.compile(r"^https://auth\.openai\.com/api/accounts/oauth/token$"), mock.guard(mock.token_route))
        await context.route(re.compile(r"^https://auth\.openai\.com/\.well-known/jwks\.json$"), mock.guard(mock.jwks_route))
        await context.route(re.compile(r"^https://api\.openai\.com/v1/models$"), mock.guard(mock.models_route))
        await context.route(re.compile(r"^https://api\.openai\.com/v1/responses$"), mock.guard(mock.responses_route))
        page = await context.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        flow = Flow(page, mock)
        try:
            await flow.run()
            assert not page_errors, f"page errors: {page_errors}"
            assert not mock.unexpected, f"requests to unexpected hosts/paths: {mock.unexpected}"
            assert not mock.failures, f"mock assertions: {mock.failures}"
            # Auth
            assert mock.token_calls == 1 and mock.jwks_calls >= 1 and mock.models_calls >= 1, (mock.token_calls, mock.jwks_calls, mock.models_calls)
            # Agents
            rc = mock.research_calls
            assert len(mock.planner_calls) == 1, f"planner calls: {len(mock.planner_calls)}"
            assert all("end" in c for c in rc), "a research call never finished"
            researched = [n for c in rc for n in c["names"]]
            expected = [WANTED] + [FIXTURES[i]["name"] for i, _, _ in PLANNED[:11]]
            assert sorted(researched) == sorted(expected), f"researched {researched}"
            assert all(len(c["names"]) <= 3 for c in rc), "a research call carried more than 3 colleges"
            overlaps = sum(1 for i, a in enumerate(rc) for b in rc[i + 1:] if a["start"] < b["end"] and b["start"] < a["end"])
            peak = concurrency(rc)
            assert overlaps >= 1, "research calls never overlapped"
            assert 2 <= peak <= 8, f"peak research calls in flight = {peak} (expected 2–8)"
            assert planner_before_research(mock), "research started before the planner finished"
            assert len(mock.chat_calls) == 1
            status = 0
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            try:
                await page.screenshot(path=str(OUT / "zz-failure.png"))
                print(f"failure screenshot: {OUT / 'zz-failure.png'}")
            except Exception:  # noqa: BLE001
                pass
        finally:
            report(mock, flow, page_errors, console_errors, status)
            await context.close()
            await browser.close()
    return status


def planner_before_research(mock: MockOpenAI) -> bool:
    return bool(mock.planner_calls) and all(c["start"] >= mock.planner_calls[0]["start"] for c in mock.research_calls)


def report(mock: MockOpenAI, flow: Flow | None, page_errors: list[str], console_errors: list[str], status: int) -> None:
    rc = sorted(mock.research_calls, key=lambda c: c["start"])
    print("\n── College Compass e2e ─────────────────────────────────────────────")
    print(f"auth: token exchanges={mock.token_calls} jwks fetches={mock.jwks_calls} models fetches={mock.models_calls} "
          f"CORS preflights seen={mock.preflights}")
    print(f"planner calls={len(mock.planner_calls)} research calls={len(rc)} chat calls={len(mock.chat_calls)}")
    if rc:
        t0 = rc[0]["start"]
        for i, c in enumerate(rc):
            end = f"{c['end'] - t0:5.2f}s" if "end" in c else "  ?  "
            print(f"  research #{i + 1}: {c['start'] - t0:5.2f}s → {end}  ({len(c['names'])}) {', '.join(c['names'])}")
        if all("end" in c for c in rc):
            print(f"  peak in flight={concurrency(rc)}  wall={max(c['end'] for c in rc) - t0:.2f}s  "
                  f"(serial would be ≥{len(rc) * RESEARCH_DELAY:.1f}s)")
    if flow and getattr(flow, "list_summary", None):
        print(f"list: tiers={flow.list_summary['tiers']}  student's pick → {flow.list_summary['unc']}")
    if flow and getattr(flow, "detail_factors", None):
        print("detail odds factors: " + " | ".join(f.strip() for f in flow.detail_factors))
    if mock.failures:
        print("mock failures:\n  " + "\n  ".join(mock.failures))
    if mock.unexpected:
        print("unexpected requests:\n  " + "\n  ".join(mock.unexpected))
    if page_errors:
        print("page errors:\n  " + "\n  ".join(page_errors))
    if console_errors:
        print("console errors (informational):\n  " + "\n  ".join(console_errors[:20]))
    if flow:
        print("screenshots:\n  " + "\n  ".join(flow.shots))
    print("RESULT: " + ("PASS" if status == 0 else "FAIL"))


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
