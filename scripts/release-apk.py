import hashlib
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

report = json.loads(pathlib.Path('deliverables/build-report.json').read_text())
version = json.loads(pathlib.Path('package.json').read_text())['version']
data = pathlib.Path('deliverables/Tidewater.apk').read_bytes()
digest = hashlib.sha256(data).hexdigest()
assert report['version'] == version
assert report['apkSignatureVerified'] and report['allUpstreamAssetsVerifiedInsideApk']
assert report['apkSha256'] == digest and report['apkBytes'] == len(data)
repo = os.environ['GITHUB_REPOSITORY']
tag = 'tidewater-android-verification-' + version
base = 'https://api.github.com/repos/' + repo
headers = {
    'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'Tidewater-APK-Delivery',
}

def api(url, payload=None, method=None, binary=False):
    body = payload if binary else json.dumps(payload).encode() if payload is not None else None
    h = dict(headers)
    if body is not None:
        h['Content-Type'] = 'application/vnd.android.package-archive' if binary else 'application/json'
    request = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)

try:
    release = api(base + '/releases/tags/' + tag)
except urllib.error.HTTPError as error:
    if error.code != 404:
        raise
    release = api(base + '/releases', {
        'tag_name': tag,
        'target_commitish': os.environ['GITHUB_SHA'],
        'name': 'Tidewater Android ' + version + ' — mobile GPU binding fix',
        'body': 'Fixes unused module resources incorrectly consuming per-stage texture bindings. '
                'The original failure is reproduced and the fixed complete game is tested with an actual WebGPU device '
                'limited to 16 sampled textures per shader stage. Original scene assets and gameplay are preserved. '
                'The portable water profile simplifies reflection and refraction for the mobile texture budget. '
                'The APK also passes Android 16 emulator installation and native launch checks. '
                'The emulator WebView GPU and the user phone GPU differ; physical-device performance remains unverified.\n\n'
                'Commit: ' + os.environ['GITHUB_SHA'] + '\nSHA256: ' + digest,
        'draft': False,
        'prerelease': True,
        'generate_release_notes': False,
    }, method='POST')

asset = next((item for item in release.get('assets', []) if item['name'] == 'Tidewater.apk'), None)
if asset is None:
    upload = release['upload_url'].split('{', 1)[0]
    assert urllib.parse.urlparse(upload).hostname == 'uploads.github.com'
    asset = api(upload + '?name=Tidewater.apk', data, method='POST', binary=True)
assert asset['size'] == len(data) and asset['state'] == 'uploaded'
assert asset.get('digest', 'sha256:' + digest) == 'sha256:' + digest
print(json.dumps({'url': asset['browser_download_url'], 'bytes': len(data), 'sha256': digest}, indent=2))
