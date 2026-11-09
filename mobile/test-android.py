import pathlib, subprocess, time
def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)
run('adb','install','-r','mobile/android/app/build/outputs/apk/debug/app-debug.apk')
run('adb','shell','am','start','-W','-n','com.voxora.app/.MainActivity')
for attempt in range(30):
    time.sleep(2)
    run('adb','shell','uiautomator','dump','/sdcard/voxora-window.xml')
    screen=run('adb','shell','cat','/sdcard/voxora-window.xml')
    if 'Log In' in screen or 'Welcome back' in screen:
        assert run('adb','shell','pidof','com.voxora.app').strip()
        print('Android package installed, launched and displayed the public sign-in screen. No public account was created.')
        break
else:
    print(screen)
    raise RuntimeError('Android did not display the public Voxora sign-in screen.')
