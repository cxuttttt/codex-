import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import zipfile

apk = pathlib.Path("android/app/build/outputs/apk/debug/app-debug.apk")
report = json.loads(pathlib.Path("build-report.json").read_text())
sdk = pathlib.Path(os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"])
tools = sdk / "build-tools" / "35.0.0"
signature = subprocess.run([str(tools / "apksigner"), "verify", "--verbose", "--print-certs", str(apk)], check=True, capture_output=True, text=True)
badging = subprocess.run([str(tools / "aapt"), "dump", "badging", str(apk)], check=True, capture_output=True, text=True).stdout
if "android.permission.INTERNET" in badging:
    raise RuntimeError("Unexpected network permission in merged APK manifest")
if "sdkVersion:'31'" not in badging:
    raise RuntimeError("Unexpected minimum Android API")
with zipfile.ZipFile(apk) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("Corrupt APK ZIP")
    names = set(archive.namelist())
    for required in ["AndroidManifest.xml", "classes.dex", "assets/game/index.html", "assets/game/licenses/LICENSE", "assets/game/licenses/LICENSE-mobile.txt", "assets/game/mobile-build.json"]:
        if required not in names:
            raise RuntimeError("APK entry missing: " + required)
    for item in report["assets"]:
        data = archive.read("assets/game/" + item["path"])
        if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise RuntimeError("APK asset mismatch: " + item["path"])
report["apkBytes"] = apk.stat().st_size
report["apkSha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
report["apkSignatureVerified"] = True
report["androidBadging"] = badging.splitlines()[:12]
report["allUpstreamAssetsVerifiedInsideApk"] = True
report["physicalDeviceTested"] = False
out = pathlib.Path("deliverables")
out.mkdir(exist_ok=True)
shutil.copy2(apk, out / "Tidewater.apk")
(out / "build-report.json").write_text(json.dumps(report, indent=2))
(out / "SHA256SUMS.txt").write_text(report["apkSha256"] + "  Tidewater.apk\n")
pathlib.Path("build-report.json").write_text(json.dumps(report, indent=2))
print(signature.stdout)
print(json.dumps({key: report[key] for key in ["apkBytes", "apkSha256", "apkSignatureVerified", "upstreamPublicFileCount", "allUpstreamAssetsVerifiedInsideApk", "physicalDeviceTested"]}, indent=2))
