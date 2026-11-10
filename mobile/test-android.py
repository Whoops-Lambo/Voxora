import pathlib, subprocess, time
def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)
try:
    run('adb','install','-r','mobile/android/app/build/outputs/apk/debug/app-debug.apk')
except subprocess.CalledProcessError as error:
    print('::error title=Android install failed::'+str(error.output).replace('\n','%0A'))
    raise
run('adb','shell','am','start','-W','-n','com.voxora.app/.MainActivity')
for attempt in range(30):
    time.sleep(2)
    try:
        run('adb','shell','uiautomator','dump','/sdcard/voxora-window.xml')
        screen=run('adb','shell','cat','/sdcard/voxora-window.xml')
    except subprocess.CalledProcessError as error:
        screen=str(error.output)
        continue
    if 'Log In' in screen or 'Welcome back' in screen:
        assert run('adb','shell','pidof','com.voxora.app').strip()
        print('Android package installed, launched and displayed the public sign-in screen. No public account was created.')
        break
else:
    pathlib.Path('mobile-builds').mkdir(exist_ok=True)
    pathlib.Path('mobile-builds/android-screen.xml').write_text(screen)
    screenshot=subprocess.check_output(['adb','exec-out','screencap','-p'])
    pathlib.Path('mobile-builds/android-failure.png').write_bytes(screenshot)
    try: logs=run('adb','logcat','-d','-t','1000')
    except Exception as error: logs=str(error)
    relevant='\n'.join(line for line in logs.splitlines() if any(word in line.lower() for word in ['capacitor','chromium','androidruntime','voxora','webview']))
    pathlib.Path('mobile-builds/android-failure.txt').write_text(relevant)
    print('::error title=Android native smoke::'+('Sign-in did not become accessible. '+screen[-5000:]+' '+relevant[-4000:]).replace('%','%25').replace('\r','%0D').replace('\n','%0A'))
    raise RuntimeError('Android did not display the public Voxora sign-in screen.')
