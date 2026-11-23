const $ = id => document.getElementById(id);
let formToken = '', receipt;
async function request(path, data) {
  const response = await fetch('/api/safety/' + path, {method: data ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000), headers: data ? {'Content-Type': 'application/json'} : {}, body: data ? JSON.stringify(data) : undefined});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'The request could not be completed. Please try again.');
  return result;
}
const errorText = error => ['TypeError', 'TimeoutError', 'SyntaxError'].includes(error.name) ? 'The connection was interrupted. Your form is still here; try again.' : error.message;
async function loadForm() {
  $('deletion-submit').disabled = true; $('deletion-reload').disabled = true;
  try {
    formToken = (await request('form')).formToken;
    $('deletion-readiness').textContent = 'Ready. No sign-in required.';
    $('deletion-submit').disabled = false;
  } catch (error) { formToken = ''; $('deletion-error').textContent = errorText(error); $('deletion-readiness').textContent = 'Request submission is temporarily unavailable.'; }
  finally { $('deletion-reload').disabled = false; }
}
$('deletion-reload').onclick = () => { $('deletion-error').textContent = ''; loadForm(); };
$('deletion-form').onsubmit = async event => {
  event.preventDefault(); if (!formToken) return;
  $('deletion-submit').disabled = true; $('deletion-error').textContent = '';
  const account = $('deletion-account').value.trim();
  const details = '[ACCOUNT DELETION REQUEST]\nRequested action: permanently delete my Voxora account and associated personal data.\nAccount identifier: ' + account + '\nContact email (optional, unverified): ' + ($('deletion-email').value.trim() || 'Not provided') + '\nAdditional information: ' + ($('deletion-details').value.trim() || 'None') + '\nOwnership must be verified by staff before any deletion.';
  try {
    receipt = await request('reports', {formToken, subject: account, category: 'account-deletion', context: 'Account deletion request', details, links: [], confirm: $('deletion-confirm').checked, website: $('deletion-website').value});
    $('receipt-reference').value = $('lookup-reference').value = receipt.reference;
    $('receipt-key').value = $('lookup-key').value = receipt.receiptKey;
    $('deletion-form').reset(); $('deletion-form').hidden = true; $('deletion-receipt').hidden = false; $('deletion-receipt').focus(); formToken = '';
  } catch (error) { $('deletion-error').textContent = errorText(error); if (error.message.includes('expired')) await loadForm(); }
  finally { $('deletion-submit').disabled = !formToken; }
};
const receiptText = () => 'Voxora account deletion request\nReference: ' + receipt.reference + '\nPrivate receipt key: ' + receipt.receiptKey + '\n\nYour account has not been deleted by submitting this form. Keep this receipt private. Check the limited review status at ' + location.origin + '/account-deletion#check-request\n';
$('receipt-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(receiptText()); $('receipt-copy-status').textContent = 'Receipt copied. Keep it private.'; }
  catch { $('receipt-key').select(); $('receipt-copy-status').textContent = 'Copy the reference and selected key, or download the receipt.'; }
};
$('receipt-download').onclick = () => { const url = URL.createObjectURL(new Blob([receiptText()], {type: 'text/plain;charset=utf-8'})), a = document.createElement('a'); a.href = url; a.download = receipt.reference + '-deletion-receipt.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); };
$('deletion-lookup').onsubmit = async event => {
  event.preventDefault(); $('lookup-submit').disabled = true; $('lookup-error').textContent = ''; $('lookup-result').hidden = true;
  try {
    const result = await request('receipt', {reference: $('lookup-reference').value.trim().toUpperCase(), receiptKey: $('lookup-key').value.trim()});
    const labels = {open: 'Received — awaiting review', reviewing: 'Under review', resolved: 'Review completed', dismissed: 'Request closed'};
    const title = document.createElement('strong'), note = document.createElement('p'); title.textContent = labels[result.status] || 'Received';
    note.textContent = 'Updated ' + new Date(result.updatedAt).toLocaleString() + '. This status alone does not confirm deletion. Staff must verify ownership before processing.';
    $('lookup-result').replaceChildren(title, note); $('lookup-result').hidden = false;
  } catch (error) { $('lookup-error').textContent = errorText(error); }
  finally { $('lookup-submit').disabled = false; }
};
loadForm();
