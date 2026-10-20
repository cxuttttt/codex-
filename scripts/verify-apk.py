import hashlib
import json
import pathlib
import zipfile

apk = pathlib.Path("android/app/build/outputs/apk/debug/app-debug.apk")
report = json.loads(pathlib.Path("build-report.json").read_text())
with zipfile.ZipFile(apk) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("Corrupt APK ZIP")
    names = set(archive.namelist())
    for required in ["AndroidManifest.xml", "classes.dex", "assets/game/index.html", "assets/game/licenses/LICENSE", "assets/game/mobile-build.json"]:
        if required not in names:
            raise RuntimeError("APK entry missing: " + required)
    for item in report["assets"]:
        data = archive.read("assets/game/" + item["path"])
        if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise RuntimeError("APK asset mismatch: " + item["path"])
report["apkBytes"] = apk.stat().st_size
report["apkSha256"] = hashlib.sha256(apk.read_bytes()).hexdigest()
report["allUpstreamAssetsVerifiedInsideApk"] = True
report["physicalDeviceTested"] = False
pathlib.Path("build-report.json").write_text(json.dumps(report, indent=2))
pathlib.Path("SHA256SUMS.txt").write_text(report["apkSha256"] + "  app-debug.apk\n")
print(json.dumps({key: report[key] for key in ["apkBytes", "apkSha256", "upstreamPublicFileCount", "allUpstreamAssetsVerifiedInsideApk", "physicalDeviceTested"]}, indent=2))
