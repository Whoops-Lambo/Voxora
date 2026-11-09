if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}
let installPrompt;
const installButton = document.getElementById('install-app');
window.addEventListener('beforeinstallprompt', event => {
  if (!installButton) return;
  event.preventDefault(); installPrompt = event; installButton.hidden = false;
});
if (installButton) installButton.onclick = async () => {
  if (!installPrompt) return;
  await installPrompt.prompt(); await installPrompt.userChoice;
  installPrompt = null; installButton.hidden = true;
};
