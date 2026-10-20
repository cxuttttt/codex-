import hashlib
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

EXPECTED_SHA256 = "10d699d70ec9771b79ce86e3237bb0f7bc4f856b561485c7dc7829c854a186eb"
EXPECTED_BYTES = 53313977
TAG = "tidewater-android-verification-0.1.0"
repo = os.environ["GITHUB_REPOSITORY"]
token = os.environ["GITHUB_TOKEN"]
apk = pathlib.Path("deliverables/Tidewater.apk")
data = apk.read_bytes()
if len(data) != EXPECTED_BYTES or hashlib.sha256(data).hexdigest() != EXPECTED_SHA256:
    raise RuntimeError("Downloaded APK differs from the previously verified build.")
base = "https://api.github.com/repos/" + repo
headers = {
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    "User-Agent": "Tidewater-APK-Delivery"
}

def api(url, payload=None, method=None, binary=False):
    body = payload if binary else (json.dumps(payload).encode() if payload is not None else None)
    h = dict(headers)
    if body is not None:
        h["Content-Type"] = "application/vnd.android.package-archive" if binary else "application/json"
    request = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)

try:
    release = api(base + "/releases/tags/" + TAG)
except urllib.error.HTTPError as error:
    if error.code != 404:
        raise
    release = api(base + "/releases", {
        "tag_name": TAG,
        "target_commitish": os.environ["GITHUB_SHA"],
        "name": "Tidewater Android Verification 0.1.0",
        "body": "Android verification APK built from commit 494e9bbdcc90945ed2e7a7d4c07589a2b4664a92. "
                "Includes complete original scene assets, offline loading and touch controls. "
                "Requires Android 12+ and a WebGPU-capable Android System WebView. "
                "APK signature, all 136 original public assets, mobile input regression checks and Android lint passed. "
                "Physical-device GPU compatibility and performance remain untested.\n\n"
                "SHA256: " + EXPECTED_SHA256,
        "draft": False,
        "prerelease": True,
        "generate_release_notes": False
    }, method="POST")

asset = next((item for item in release.get("assets", []) if item["name"] == "Tidewater.apk"), None)
if asset is None:
    upload = release["upload_url"].split("{", 1)[0]
    if urllib.parse.urlparse(upload).hostname != "uploads.github.com":
        raise RuntimeError("Unexpected upload host.")
    asset = api(upload + "?name=Tidewater.apk", data, method="POST", binary=True)
if asset["size"] != EXPECTED_BYTES or asset.get("state") != "uploaded":
    raise RuntimeError("Unexpected release asset size or state.")
if asset.get("digest") and asset["digest"] != "sha256:" + EXPECTED_SHA256:
    raise RuntimeError("Release asset digest mismatch.")
result = {"browser_download_url": asset["browser_download_url"], "apkBytes": asset["size"], "sha256": EXPECTED_SHA256}
print(json.dumps(result, indent=2))
