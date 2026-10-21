import json
import pathlib
import subprocess
import time

out = pathlib.Path('install-diagnostics')
out.mkdir(exist_ok=True)
package = 'dev.sencao.tidewater.verification'
result = {}

def command(args):
    p = subprocess.run(args, capture_output=True, text=True, timeout=120)
    print('$ ' + ' '.join(args), flush=True)
    print(p.stdout + p.stderr, flush=True)
    assert p.returncode == 0, 'Command failed: ' + ' '.join(args)
    return p.stdout + p.stderr

try:
    result['android'] = command(['adb', 'shell', 'getprop', 'ro.build.version.release']).strip()
    command(['adb', 'shell', 'wm', 'size', '720x1280'])
    command(['adb', 'shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed'])
    command(['adb', 'logcat', '-c'])
    result['install'] = command(['adb', 'install', '-r', 'deliverables/Tidewater.apk'])
    assert 'Success' in result['install']
    result['launch'] = command(['adb', 'shell', 'am', 'start', '-W', '-n', package + '/dev.sencao.tidewater.MainActivity'])
    assert 'Status: ok' in result['launch']
    time.sleep(10)
    result['pid'] = command(['adb', 'shell', 'pidof', package]).strip()
    assert result['pid']
    result['crashLog'] = command(['adb', 'logcat', '-d', '-b', 'crash'])
    assert not result['crashLog'].strip()
    result['note'] = 'Installation and native launch only; full game rendering is tested separately with the 16-texture WebGPU regression test.'
finally:
    shot = subprocess.run(['adb', 'exec-out', 'screencap', '-p'], capture_output=True, timeout=30)
    if shot.returncode == 0:
        (out / 'screen.png').write_bytes(shot.stdout)
    (out / 'installation.json').write_text(json.dumps(result, indent=2))
    print('INSTALL_RESULT_JSON ' + json.dumps(result), flush=True)
