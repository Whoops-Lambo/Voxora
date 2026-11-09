import json, os, pathlib, re, subprocess
def run(*args):
    return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT)
devices=json.loads(run('xcrun','simctl','list','devices','available','-j'))['devices']
phone=next(d for group in devices.values() for d in group if d.get('isAvailable') and d['name'].startswith('iPhone'))
device=phone['udid']
assert re.fullmatch(r'[A-Fa-f0-9-]{36}',device)
if phone['state']!='Booted':run('xcrun','simctl','boot',device)
run('xcrun','simctl','bootstatus',device,'-b')
app=str(pathlib.Path(os.environ['RUNNER_TEMP'])/'voxora-ios-simulator/Build/Products/Release-iphonesimulator/App.app')
run('xcrun','simctl','install',device,app)
output=run('xcrun','simctl','launch','--terminate-running-process',device,'com.voxora.app')
assert re.search(r'com\.voxora\.app: \d+',output),output
print('Native iOS app compiled, installed and launched on an iPhone simulator. Physical-device installation still requires user signing.')
