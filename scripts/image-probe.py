#!/usr/bin/env python3
"""Test gpt-image-2-1 endpoint.  Writes /tmp/image-probe-result.json."""
import json, requests, subprocess, time
from pathlib import Path

start = time.time()

# 1. Token
print("step=token", flush=True)
tok = subprocess.check_output(
    ["az", "account", "get-access-token", "--resource",
     "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv"],
    text=True,
).strip()
print(f"step=token_ok len={len(tok)}", flush=True)

# 2. POST
url = (
    "https://plimsoll-resource.openai.azure.com/openai/deployments/"
    "gpt-image-2-1/images/generations?api-version=2025-01-01-preview"
)
payload = {"prompt": "A small blue circle on white background", "n": 1, "size": "1024x1024"}
print("step=post", flush=True)
try:
    r = requests.post(
        url, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        json=payload, timeout=90,
    )
except Exception as e:
    Path("/tmp/image-probe-result.json").write_text(json.dumps({"ok": False, "exc": str(e)}, indent=2))
    print("step=exc", flush=True)
    exit(0)

print(f"step=status code={r.status_code} t={time.time()-start:.1f}s", flush=True)

# 3. Parse
if r.status_code == 200:
    d = r.json()
    Path("/tmp/image-probe-result.json").write_text(json.dumps(d, indent=2))
    if "data" in d and d["data"]:
        b64 = d["data"][0].get("b64_json", "")
        print(f"step=ok b64_len={len(b64)} t={time.time()-start:.1f}s", flush=True)
    else:
        print(f"step=ok_no_data keys={list(d.keys())} t={time.time()-start:.1f}s")
else:
    # Validate raw
    try:
        d = r.json()
    except:
        d = {"raw": r.text[:500]}
    Path("/tmp/image-probe-result.json").write_text(json.dumps({"ok": False, "status": r.status_code, "body": d}, indent=2))
    print(f"step=fail status={r.status_code} t={time.time()-start:.1f}s", flush=True)
