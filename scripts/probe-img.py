import requests, json
from pathlib import Path

def probe():
    import subprocess, json
    tok = subprocess.check_output(
        ["az", "account", "get-access-token", "--resource", "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv"],
        text=True
    ).strip()
    url = "https://plimsoll-resource.openai.azure.com/openai/deployments/gpt-image-2-1/images/generations?api-version=2025-01-01-preview"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        json={"prompt": "A small blue circle", "size": "1024x1024", "n": 1},
        timeout=90,
    )
    print("status:", resp.status_code)
    print("headers:", dict(resp.headers))
    try:
        data = resp.json()
        Path("/tmp/probe-img.json").write_text(json.dumps(data, indent=2))
        print("data keys:", list(data.keys()))
        if "error" in data:
            print("error:", data["error"])
        elif "data" in data:
            print("images:", len(data["data"]))
            for i, img in enumerate(data["data"][:1]):
                b64 = img.get("b64_json") or ""
                print(f"img {i} b64_len:", len(b64))
    except Exception as e:
        print("parse error:", e)
        print("raw:", resp.text[:500])

if __name__ == "__main__":
    probe()
