# Desktop and message notifications

Voxora 3.3.2 adds native desktop alerts, a Windows notification identity, clickable message banners, a notification test, and optional system-tray background mode.

## Enable message alerts

1. Open **User Settings → Notifications**.
2. Enable **Desktop notifications**. In a browser, allow its notification prompt. The Windows app uses its native notification service.
3. Use **Send Test Desktop Notification**. Windows Settings → System → Notifications and Focus settings can silence banners or sounds.
4. Keep **Message sounds** enabled for notification sounds. **Show message previews** is off by default; enable it to include the sender and message text.

DMs and eligible personal, role, @here and @everyone mentions use the same conversation policies. To receive ordinary server messages, choose that server under **Server Notifications**, select **All Messages**, and save. Channel overrides, mutes, blocking, Do Not Disturb and active viewing still apply. Reconnection does not replay old messages as notifications.

**In-app message notifications** displays a clickable banner when you are in another conversation or Home. Clicking a banner or desktop alert opens its message, including threaded replies. Banners can be dismissed. Notifications are cleared when signing out, switching accounts or changing relevant notification/access settings; old-account clicks cannot navigate another account.

## Keep receiving messages after closing the window

Minimizing leaves Voxora running. To close its window while continuing to receive messages, enable **Keep Voxora running when the window is closed**. Voxora stays in the system tray. Click its tray icon to return, or choose **Quit Voxora** in the tray menu to stop it completely. Background tray mode is off by default and is saved on this computer. The app must be running and connected; this does not add notifications to a fully quit Windows process.

The native **Voxora → Notifications…** menu, available by pressing Alt, also offers a test notification, a system settings link, and the background tray option. This menu remains available when the selected hosted chat service is older. Earlier hosted interfaces can keep using their existing Desktop notifications checkbox; upgrading the installer registers the Windows shortcut identity needed by the operating system.

A notification test requests an operating-system alert; Focus, notification permissions, delivery state and the desktop session determine whether it is displayed. Native notification requests are bounded during bursts and contain message references rather than arbitrary navigation URLs or renderer-supplied images.

## Deploying

Install the new Windows update for native notification support and Windows shortcut registration. Deploy the latest backend on Render for the enhanced notification settings and in-app banners, then reload clients. Publishing a desktop update does not deploy Render. The web app can use browser notifications while open and opt-in Web Push when closed; iPhone setup remains in [MOBILE.md](MOBILE.md).
