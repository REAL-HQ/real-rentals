"""Two drops stage files locally; only the explicit click starts the existing pipeline.

All backend responses and documents are synthetic. No real documents or records
are used. Run with the dev server on port 8080:
    python3 scripts/fleet-inbox-upload-staging-e2e.test.py
"""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import time

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8080")
REF = "yuyzdsnrbfhkmfzpvhwx"
BATCH_ID = "11111111-1111-4111-8111-111111111111"
NOW = int(time.time())
EXP = NOW + 86400


def b64_json(value):
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


JWT = f"{b64_json({'alg': 'HS256', 'typ': 'JWT'})}.{b64_json({'sub': '00000000-0000-0000-0000-0000000000aa', 'role': 'authenticated', 'email': 'probe@example.com', 'exp': EXP})}.sig"
SESSION = {
    "access_token": JWT,
    "token_type": "bearer",
    "expires_in": 86400,
    "expires_at": EXP,
    "refresh_token": "probe-refresh",
    "user": {
        "id": "00000000-0000-0000-0000-0000000000aa",
        "aud": "authenticated",
        "role": "authenticated",
        "email": "probe@example.com",
        "app_metadata": {},
        "user_metadata": {},
        "created_at": "2026-01-01T00:00:00Z",
    },
}

ITEMS = [
    {
        "id": f"00000000-0000-4000-8000-00000000000{index}",
        "document_id": None,
        "file_name": name,
        "status": "ready",
        "doc_class": "other",
        "warnings": [],
        "job": None,
    }
    for index, name in enumerate(["first-synthetic.pdf", "second-synthetic.pdf"], 1)
]
RESULTS = {
    "null": None,
    "list": [],
    "create": {"id": BATCH_ID},
    "register1": {"itemId": ITEMS[0]["id"], "duplicate": False, "existingFileName": None},
    "register2": {"itemId": ITEMS[1]["id"], "duplicate": False, "existingFileName": None},
    "batch": {
        "batch": {"id": BATCH_ID, "label": "Synthetic Upload", "status": "ready", "created_at": "2026-01-01T00:00:00Z", "source_channel": "fleet_inbox"},
        "items": ITEMS,
        "proposals": [],
        "transactions": [],
        "finance": [],
        "vehicles": [],
        "canFinance": True,
        "email": None,
        "queue": {"pausedReason": None, "pausedAt": None},
    },
    "notifications": {"rows": []},
    "conversations": {"conversations": [], "unread": 0},
}


def serialized_responses():
    # Reuse the app's own serializer so the harness speaks TanStack Start's wire format.
    script = """
import { toCrossJSON } from 'seroval';
const results = JSON.parse(process.argv[1]);
const out = Object.fromEntries(Object.entries(results).map(([key, result]) => [key,
  JSON.stringify(toCrossJSON({ result, context: {} }, { refs: new Map() }))
]));
console.log(JSON.stringify(out));
"""
    output = subprocess.check_output(["node", "--input-type=module", "-e", script, json.dumps(RESULTS)], cwd=Path(__file__).resolve().parents[1], text=True)
    return json.loads(output)


RESPONSES = serialized_responses()


async def main():
    creates = 0
    storage_uploads = 0
    registrations = 0
    page_errors = []

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(viewport={"width": 1280, "height": 1800})

            async def supabase_route(route):
                nonlocal storage_uploads
                url = route.request.url
                if "/auth/v1/" in url:
                    await route.fulfill(status=200, content_type="application/json", body=json.dumps(SESSION))
                elif "/storage/v1/" in url:
                    storage_uploads += 1
                    await route.fulfill(status=200, content_type="application/json", body=json.dumps({"Key": "vehicle-docs/inbox/synthetic.pdf"}))
                else:
                    body = [{"role": "admin"}] if "user_roles" in url else []
                    await route.fulfill(status=200, content_type="application/json", headers={"content-range": "0-0/0"}, body=json.dumps(body))

            await context.route(f"**://{REF}.supabase.co/**", supabase_route)
            page = await context.new_page()
            page.on("pageerror", lambda error: page_errors.append(str(error)))

            async def server_route(route):
                nonlocal creates, registrations
                ident = route.request.url.rstrip("/").split("/")[-1]
                try:
                    padded = ident + "=" * (-len(ident) % 4)
                    name = base64.urlsafe_b64decode(padded).decode(errors="ignore")
                except Exception:
                    name = ""
                key = "null"
                if "listImportBatches" in name:
                    key = "list"
                elif "createImportBatch" in name:
                    creates += 1
                    key = "create"
                elif "registerInboxFile" in name:
                    registrations += 1
                    key = "register1" if registrations == 1 else "register2"
                elif "getImportBatch" in name:
                    key = "batch"
                elif "getAdminNotifications" in name:
                    key = "notifications"
                elif "listConversations" in name:
                    key = "conversations"
                await route.fulfill(status=200, content_type="application/json", headers={"x-tss-serialized": "true"}, body=RESPONSES[key])

            await page.route("**/_serverFn/**", server_route)
            await page.goto(BASE, wait_until="domcontentloaded")
            await page.evaluate("([key, value]) => window.localStorage.setItem(key, value)", [f"sb-{REF}-auth-token", json.dumps(SESSION)])
            await page.goto(f"{BASE}/admin?tab=fleet_inbox", wait_until="domcontentloaded")
            dropzone = page.get_by_role("button", name="Browse Files. Press Enter to choose files, or drop files here.")
            await dropzone.wait_for(timeout=30000)

            async def drop(file_name):
                transfer = await page.evaluate_handle("""name => {
                    const dt = new DataTransfer();
                    dt.items.add(new File(['%PDF-1.4 synthetic'], name, { type: 'application/pdf' }));
                    return dt;
                }""", file_name)
                await dropzone.dispatch_event("drop", {"dataTransfer": transfer})

            await drop("first-synthetic.pdf")
            await page.get_by_text("1 File Ready · Not Uploaded Yet", exact=True).wait_for()
            await drop("second-synthetic.pdf")
            await page.get_by_text("2 Files Ready · Not Uploaded Yet", exact=True).wait_for()
            await page.wait_for_timeout(1000)
            assert creates == 0, "Dropping files must not create an import batch"
            assert storage_uploads == 0, "Dropping files must not reach storage"
            assert registrations == 0, "Dropping files must not register documents"

            await page.get_by_role("button", name="Upload 2 Files", exact=True).click()
            await page.get_by_text("Synthetic Upload", exact=True).wait_for(timeout=30000)
            assert creates == 1, "The explicit click creates exactly one batch"
            assert storage_uploads == 2, "The explicit click uploads both staged files"
            assert registrations == 2, "The explicit click registers both staged files"
            assert page_errors == [], page_errors
            print("PASS two drops staged locally with zero uploads; one click uploaded exactly two synthetic files.")
            await context.close()
        finally:
            await browser.close()


asyncio.run(main())
