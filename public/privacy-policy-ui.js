// Render the same policy as /privacy without leaving the signed-in app.
export async function renderPrivacyPolicy({content, node}) {
  const link = node('a', 'secondary', 'Open Public Privacy Policy');
  link.href = '/privacy'; link.target = '_blank'; link.rel = 'noopener noreferrer';
  const article = node('article', 'app-privacy-policy');
  article.setAttribute('aria-label', 'Privacy Policy');
  article.setAttribute('aria-busy', 'true');
  article.textContent = 'Loading the Privacy Policy…';
  content.append(link, article);
  try {
    const response = await fetch('/privacy', {credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('Privacy Policy unavailable.');
    const document = new DOMParser().parseFromString(await response.text(), 'text/html');
    const policy = document.querySelector('article.legal-copy'), date = document.querySelector('.legal-date');
    if (!policy?.querySelector('h2')) throw Error('Privacy Policy unavailable.');
    // Copy only policy text and safe links. Scripts, frames, event attributes,
    // styles and other page markup never enter the application document.
    const allowed = new Set(['SECTION', 'H2', 'H3', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'A', 'TIME']);
    function copy(source) {
      if (source.nodeType === 3) return globalThis.document.createTextNode(source.textContent);
      if (source.nodeType !== 1 || !allowed.has(source.tagName)) return globalThis.document.createTextNode('');
      const element = node(source.tagName.toLowerCase());
      if (source.tagName === 'A') {
        const url = new URL(source.getAttribute('href') || '/privacy', location.origin + '/privacy');
        if (url.protocol === 'https:' || url.protocol === 'http:' && url.origin === location.origin) {
          element.href = url.href; element.target = '_blank'; element.rel = 'noopener noreferrer';
        }
      }
      for (const child of source.childNodes) element.append(copy(child));
      return element;
    }
    article.replaceChildren(...(date ? [copy(date)] : []), ...[...policy.children].map(copy));
  } catch {
    article.textContent = 'The Privacy Policy could not load. Check your connection and reopen this page, or use Open Public Privacy Policy above.';
  } finally { article.setAttribute('aria-busy', 'false'); }
}
