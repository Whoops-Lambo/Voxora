const $=id=>document.getElementById(id);
let formToken='',receipt=null;
const statuses={open:['Received','Your report is waiting for staff review.'],reviewing:['Under review','A staff reviewer is looking at your report.'],resolved:['Resolved','Staff marked this report resolved. Account actions and review notes remain private.'],dismissed:['Closed','Staff closed this report. Account actions and review notes remain private.']};
async function request(path,data){
  const response=await fetch('/api/safety/'+path,{method:data===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  let result;try{result=await response.json();}catch{throw Error('The Safety Center is unavailable. Please reload the form or try again later.');}
  if(!response.ok){const error=Error(result.error||'The request could not be completed.');error.status=response.status;error.retryAfter=result.retryAfter;throw error;}return result;
}
function errorText(error){return (error.name==='TimeoutError'||error.name==='TypeError'?'The connection was interrupted. Your form is still here; try again.':error.message)+(error.retryAfter?' Try again in about '+Math.ceil(error.retryAfter/60)+' minute(s).':'');}
async function loadForm(){
  $('report-submit').disabled=true;$('report-reload').disabled=true;$('report-readiness').textContent='Preparing the reporting form…';
  try{const data=await request('form');formToken=data.formToken;$('report-readiness').textContent='Ready. No sign-in, name or email required.';$('report-submit').disabled=false;}
  catch(error){formToken='';$('report-readiness').textContent='Reporting is temporarily unavailable.';$('report-error').textContent=errorText(error);}
  finally{$('report-reload').disabled=false;}
}
$('report-reload').onclick=()=>{ $('report-error').textContent='';loadForm();};
$('safety-report-form').onsubmit=async event=>{
  event.preventDefault();if(!formToken)return;const send=$('report-submit');send.disabled=true;send.textContent='Sending report…';$('report-error').textContent='';
  try{
    const links=$('report-links').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(links.length>5)throw Error('Include no more than five evidence links.');
    receipt=await request('reports',{formToken,subject:$('report-subject').value,category:$('report-category').value,context:$('report-context').value,details:$('report-details').value,links,confirm:$('report-confirm').checked,website:$('report-website').value});
    $('receipt-reference').value=receipt.reference;$('receipt-key').value=receipt.receiptKey;$('lookup-reference').value=receipt.reference;$('lookup-key').value=receipt.receiptKey;
    $('safety-report-form').reset();$('safety-report-form').hidden=true;$('report-receipt').hidden=false;$('report-receipt').focus();formToken='';
  }catch(error){$('report-error').textContent=errorText(error);if(error.message.includes('expired'))await loadForm();}
  finally{send.textContent='Send anonymous report';send.disabled=!formToken;}
};
function receiptText(){return 'Voxora Safety Center receipt\nReference: '+receipt.reference+'\nPrivate key: '+receipt.receiptKey+'\n\nKeep this key private. Use it at '+location.origin+'/safety#check-report to check the limited review status.\n';}
$('receipt-copy').onclick=async()=>{try{await navigator.clipboard.writeText(receiptText());$('receipt-copy-status').textContent='Receipt copied. Keep it somewhere private.';}catch{$('receipt-key').focus();$('receipt-key').select();$('receipt-copy-status').textContent='Copy the reference and selected private key, or download the receipt.';}};
$('receipt-download').onclick=()=>{const url=URL.createObjectURL(new Blob([receiptText()],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=receipt.reference+'-receipt.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
$('report-another').onclick=()=>{$('report-receipt').hidden=true;$('safety-report-form').hidden=false;$('report-error').textContent='';$('receipt-copy-status').textContent='';loadForm();$('report-subject').focus();};
$('receipt-lookup-form').onsubmit=async event=>{
  event.preventDefault();$('lookup-error').textContent='';$('lookup-result').hidden=true;$('lookup-submit').disabled=true;
  try{
    const data=await request('receipt',{reference:$('lookup-reference').value.trim().toUpperCase(),receiptKey:$('lookup-key').value.trim()}),[label,description]=statuses[data.status]||['Received','Your report is waiting for staff review.'];
    const title=document.createElement('strong'),note=document.createElement('p'),time=document.createElement('p');title.textContent=label;note.textContent=description;time.textContent=data.reference+' · Updated '+new Date(data.updatedAt).toLocaleString();$('lookup-result').replaceChildren(title,note,time);$('lookup-result').hidden=false;
  }catch(error){$('lookup-error').textContent=errorText(error);}
  finally{$('lookup-submit').disabled=false;}
};
loadForm();
