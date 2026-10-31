const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { token: localStorage.getItem('pw_token') || '', user: null, stores: [], users: [], docs: [], modalSubmit: null };
const categories = ['INVOICE','DAILY_REPORT','EXPENSE','BILL_RECEIPT','SALES_REPORT','OTHER'];
const statusLabels = { DRAFT:'Draft', SUBMITTED:'Awaiting review', APPROVED:'Approved', REJECTED:'Rejected', CORRECTION_REQUESTED:'Correction requested', ARCHIVED:'Archived' };
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const money = (v,c='INR') => v == null || v === '' ? '—' : new Intl.NumberFormat('en-IN',{style:'currency',currency:c,maximumFractionDigits:2}).format(v);
const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isAdmin = () => state.user?.role === 'SUPER_ADMIN';
async function api(url, options={}) {
  const headers = {...(options.headers||{})};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (!(options.body instanceof FormData) && options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
  const res = await fetch(url,{...options,headers});
  if (res.status === 401) { logout(false); throw new Error('Your session expired. Please sign in again.'); }
  if (!res.ok) { let msg='Something went wrong'; try { msg=(await res.json()).error || msg; } catch {} throw new Error(msg); }
  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res;
}
function toast(message, bad=false) { const el=$('#toast'); el.textContent=message; el.className=`toast show${bad?' toast-error':''}`; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.className='toast',3200); }
function showLogin() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
function showApp() { $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }
function logout(notify=true) { state.token=''; state.user=null; localStorage.removeItem('pw_token'); showLogin(); if(notify) toast('You have signed out.'); }
function statusPill(status) { return `<span class="status status-${String(status).toLowerCase()}">${esc(statusLabels[status]||status)}</span>`; }
function nav(page) {
  if (!isAdmin() && ['stores','users','approvals'].includes(page)) page='overview';
  $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`));
  $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  $('#crumb').textContent=({overview:'Overview',documents:'Documents',stores:'Stores',users:'Users & managers',approvals:'Approvals',reports:'Reports'})[page]||'Overview';
  $('#sidebar').classList.remove('open');
  if(page==='overview') loadOverview();
  if(page==='documents') loadDocuments();
  if(page==='stores') loadStores();
  if(page==='users') loadUsers();
  if(page==='approvals') loadApprovals();
}
function setRoleUI() {
  $$('[data-admin],.admin-only').forEach(el=>el.classList.toggle('hidden',!isAdmin()));
  $('#userName').textContent=state.user.name;
  $('#userRole').textContent=isAdmin()?'Super Admin':'Store Manager';
  $('#userAvatar').textContent=(state.user.name||'U').trim().charAt(0).toUpperCase();
  $('#welcomeTitle').textContent=`Good ${new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}, ${state.user.name.split(' ')[0]}`;
  $('#todayLabel').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}
async function enterApp(user) {
  state.user=user; setRoleUI(); showApp();
  try { state.stores=await api('/api/stores'); } catch(e) { toast(e.message,true); }
  populateStoreFilters(); nav('overview');
}
async function login(email,password) {
  const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
  state.token=result.token; localStorage.setItem('pw_token',state.token); await enterApp(result.user);
}
async function loadOverview() {
  try {
    const [docs,stores]=await Promise.all([api('/api/documents'),api('/api/stores')]); state.docs=docs; state.stores=stores;
    $('#statTotal').textContent=docs.length; $('#statPending').textContent=docs.filter(d=>d.status==='SUBMITTED').length;
    $('#statApproved').textContent=docs.filter(d=>d.status==='APPROVED').length;
    $('#statAttention').textContent=docs.filter(d=>['REJECTED','CORRECTION_REQUESTED'].includes(d.status)).length;
    $('#recentRows').innerHTML=docs.slice(0,6).map(d=>`<tr><td><div class="doc-name">${esc(d.title)}</div><div class="muted tiny">${esc(d.referenceNumber||d.originalName||'No reference')}</div></td><td>${esc(d.store?.name||'—')}</td><td>${esc(d.category.replaceAll('_',' '))}</td><td>${fmtDate(d.documentDate)}</td><td>${statusPill(d.status)}</td><td><button class="row-action" data-file="${d.id}" ${!d.storedName?'disabled':''}>↧</button></td></tr>`).join('');
    $('#recentEmpty').classList.toggle('hidden',docs.length>0);
  } catch(e) { toast(e.message,true); }
}
function populateStoreFilters() { const opts=state.stores.map(s=>`<option value="${s.id}">${esc(s.name)} · ${esc(s.code)}</option>`).join(''); ['#filterStore'].forEach(sel=>{ if($(sel)) $(sel).innerHTML='<option value="">All stores</option>'+opts; }); }
async function loadDocuments() {
  try {
    const params=new URLSearchParams(); if($('#filterStatus').value) params.set('status',$('#filterStatus').value); if($('#filterCategory').value) params.set('category',$('#filterCategory').value); if($('#filterStore')?.value) params.set('storeId',$('#filterStore').value);
    const docs=await api('/api/documents?'+params.toString()); state.docs=docs;
    const q=$('#docSearch').value.toLowerCase(); const filtered=docs.filter(d=>[d.title,d.referenceNumber,d.store?.name].some(v=>(v||'').toLowerCase().includes(q)));
    $('#documentRows').innerHTML=filtered.map(d=>`<tr><td><div class="doc-name">${esc(d.title)}</div><div class="muted tiny">${esc(d.originalName||'No file attached')}</div></td><td>${esc(d.store?.name||'—')}</td><td>${esc(d.category.replaceAll('_',' '))}</td><td>${fmtDate(d.documentDate)}</td><td>${esc(d.financialYear||'—')}</td><td>${money(d.amount,d.currency)}</td><td>${statusPill(d.status)}</td><td><div class="action-group">${d.storedName?`<button class="row-action" title="Download" data-file="${d.id}">↓</button>`:''}${['DRAFT','CORRECTION_REQUESTED'].includes(d.status)?`<button class="row-action" title="Submit for review" data-submit="${d.id}">↑</button>`:''}</div></td></tr>`).join('');
    $('#documentsEmpty').classList.toggle('hidden',filtered.length>0);
  } catch(e) { toast(e.message,true); }
}
async function loadStores() {
  try {
    state.stores = await api('/api/stores');
    const active = state.stores.filter(s => s.active).length;
    const inactive = state.stores.length - active;
    $('#storeCountTotal').textContent = state.stores.length;
    $('#storeCountActive').textContent = active;
    $('#storeCountInactive').textContent = inactive;
    renderStores();
    populateStoreFilters();
  } catch (e) { toast(e.message, true); }
}
function renderStores() {
  const query = ($('#storeSearch')?.value || '').trim().toLowerCase();
  const status = $('#storeStatusFilter')?.value || '';
  const rows = state.stores.filter(s => {
    const matchesQuery = [s.name, s.code, s.city, s.address].some(v => String(v || '').toLowerCase().includes(query));
    const matchesStatus = !status || (status === 'ACTIVE' ? s.active : !s.active);
    return matchesQuery && matchesStatus;
  });
  $('#storeRows').innerHTML = rows.map(s => `<tr>
    <td><div class="doc-name">${esc(s.name)}</div><div class="muted tiny">${esc(s.address || 'No address added')}</div></td>
    <td><strong>${esc(s.code)}</strong></td>
    <td>${esc(s.city || '—')}</td>
    <td><span class="store-count">${s._count?.managers ?? 0}</span></td>
    <td><span class="store-count">${s._count?.documents ?? 0}</span></td>
    <td><span class="status ${s.active ? 'status-approved' : 'status-archived'}">${s.active ? 'Active' : 'Inactive'}</span></td>
    <td><div class="action-group">
      <button class="row-action" title="Edit store" data-store-edit="${s.id}">✎</button>
      <button class="row-action" title="${s.active ? 'Deactivate' : 'Activate'} store" data-store-toggle="${s.id}" data-next-active="${!s.active}">${s.active ? '⏸' : '▶'}</button>
    </div></td>
  </tr>`).join('');
  $('#storesEmpty').classList.toggle('hidden', rows.length > 0);
  $('#storesEmpty').textContent = state.stores.length ? 'No stores match your search.' : 'No stores have been added yet.';
}

async function loadUsers() { try { state.users=await api('/api/users'); $('#userRows').innerHTML=state.users.map(u=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${u.role==='SUPER_ADMIN'?'Super Admin':'Store Manager'}</td><td>${esc(u.store?.name||'—')}</td><td><span class="status ${u.active?'status-approved':'status-archived'}">${u.active?'Active':'Inactive'}</span></td></tr>`).join(''); $('#usersEmpty').classList.toggle('hidden',state.users.length>0); } catch(e){toast(e.message,true);} }
async function loadApprovals() { try { const docs=await api('/api/documents?status=SUBMITTED'); $('#approvalRows').innerHTML=docs.map(d=>`<tr><td><strong>${esc(d.title)}</strong><div class="muted tiny">${esc(d.category.replaceAll('_',' '))}</div></td><td>${esc(d.store?.name||'—')}</td><td>${esc(d.uploadedBy?.name||'—')}</td><td>${fmtDate(d.createdAt)}</td><td><div class="action-group"><button class="btn btn-small btn-approve" data-review="APPROVED:${d.id}">Approve</button><button class="btn btn-small btn-reject" data-review="REJECTED:${d.id}">Reject</button><button class="btn btn-small btn-secondary" data-review="CORRECTION_REQUESTED:${d.id}">Return</button></div></td></tr>`).join(''); $('#approvalsEmpty').classList.toggle('hidden',docs.length>0); } catch(e){toast(e.message,true);} }
function openModal(title,fields,onSubmit,submitText='Save') {
  $('#modalTitle').textContent=title; $('#modalSubmit').textContent=submitText; $('#modalError').textContent='';
  $('#modalFields').innerHTML=fields; state.modalSubmit=onSubmit; $('#modalBackdrop').classList.remove('hidden');
}
function closeModal(){ $('#modalBackdrop').classList.add('hidden'); $('#modalForm').reset(); state.modalSubmit=null; }
function field(label,name,type='text',required=true,extra=''){ return `<label>${label}<input name="${name}" type="${type}" ${required?'required':''} ${extra}></label>`; }
function selectField(label,name,options,required=true){return `<label>${label}<select name="${name}" ${required?'required':''}>${options}</select></label>`;}
function uploadModal(){
  const storeOptions=state.stores.map(s=>`<option value="${s.id}">${esc(s.name)} (${esc(s.code)})</option>`).join('');
  const storeField=isAdmin()?selectField('Store','storeId','<option value="">Select a store</option>'+storeOptions):'';
  openModal('Upload a document',`${storeField}${field('Document title','title')}${selectField('Category','category','<option value="">Select category</option>'+categories.map(c=>`<option value="${c}">${c.replaceAll('_',' ')}</option>`).join(''))}${field('Document date','documentDate','date',false)}${field('Financial year','financialYear','text',false,'placeholder="e.g. 2026-27"')}${field('Reference number','referenceNumber','text',false)}${field('Amount (INR)','amount','number',false,'min="0" step="0.01"')}${field('Attach file','file','file',false,'accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"')}${`<label>Notes<textarea name="notes" rows="3" placeholder="Optional notes"></textarea></label>`}` , async form=>{
    const fd=new FormData(); for(const [k,v] of form.entries()) if(k!=='file' && v!=='') fd.append(k,v); const file=form.get('file'); if(file&&file.size) fd.append('file',file);
    await api('/api/documents',{method:'POST',body:fd}); closeModal(); toast('Document uploaded as a draft.'); await loadDocuments();
  },'Upload document');
}
function addStoreModal() {
  openModal('Add a store', `${field('Store name','name')}${field('Store code','code','text',true,'placeholder="e.g. HYD001"')}${field('City','city','text',false)}${field('Address','address','text',false)}`, async f => {
    const data = Object.fromEntries(f.entries());
    data.code = String(data.code || '').trim().toUpperCase();
    await api('/api/stores', { method: 'POST', body: JSON.stringify(data) });
    closeModal(); toast('Store created successfully.'); await loadStores();
  }, 'Add store');
}
function editStoreModal(id) {
  const store = state.stores.find(s => s.id === id);
  if (!store) return;
  openModal('Edit store details', `${field('Store name','name')}${field('Store code','code')}${field('City','city','text',false)}${field('Address','address','text',false)}`, async f => {
    const data = Object.fromEntries(f.entries());
    data.code = String(data.code || '').trim().toUpperCase();
    await api(`/api/stores/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
    closeModal(); toast('Store details updated.'); await loadStores();
  }, 'Save changes');
  const form = $('#modalForm');
  for (const key of ['name','code','city','address']) {
    const input = form.elements.namedItem(key);
    if (input) input.value = store[key] || '';
  }
}
async function toggleStoreStatus(id, active) {
  const store = state.stores.find(s => s.id === id);
  if (!store) return;
  const action = active ? 'activate' : 'deactivate';
  if (!confirm(`Are you sure you want to ${action} ${store.name}?`)) return;
  try {
    await api(`/api/stores/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    toast(`Store ${active ? 'activated' : 'deactivated'}.`);
    await loadStores();
  } catch (e) { toast(e.message, true); }
}
function addUserModal(){const opts=state.stores.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');openModal('Create user account',`${field('Full name','name')}${field('Email address','email','email')}${field('Temporary password (min. 10 characters)','password','password')}${selectField('Role','role','<option value="STORE_MANAGER">Store Manager</option><option value="SUPER_ADMIN">Super Admin</option>')}${selectField('Assigned store','storeId','<option value="">Select store</option>'+opts,false)}<p class="field-hint">Store Managers must be assigned to a store. Share temporary passwords securely.</p>`,async f=>{const d=Object.fromEntries(f.entries());if(d.role==='SUPER_ADMIN') delete d.storeId;await api('/api/users',{method:'POST',body:JSON.stringify(d)});closeModal();toast('User account created.');loadUsers();});}
async function downloadFile(id){try{const res=await fetch(`/api/documents/${id}/file`,{headers:{Authorization:`Bearer ${state.token}`}});if(!res.ok)throw new Error((await res.json()).error||'Download failed');const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='paper-work-document';a.click();URL.revokeObjectURL(url);}catch(e){toast(e.message,true);}}
async function submitDoc(id){try{await api(`/api/documents/${id}/submit`,{method:'POST',body:'{}'});toast('Document submitted for review.');loadDocuments();}catch(e){toast(e.message,true);}}
async function reviewDoc(decision,id){let comment='';if(decision!=='APPROVED'){comment=prompt(decision==='REJECTED'?'Reason for rejection:':'What needs correction?')||'';if(!comment.trim())return;}try{await api(`/api/documents/${id}/review`,{method:'POST',body:JSON.stringify({decision,comment})});toast(`Document ${decision.toLowerCase().replace('_',' ')}.`);loadApprovals();}catch(e){toast(e.message,true);}}
async function downloadReport(){try{const params=new URLSearchParams();if($('#reportYear').value)params.set('financialYear',$('#reportYear').value);if($('#reportCategory').value)params.set('category',$('#reportCategory').value);if(isAdmin()&&$('#includePending').checked)params.set('includePending','true');const res=await fetch('/api/exports/documents.xlsx?'+params,{headers:{Authorization:`Bearer ${state.token}`}});if(!res.ok)throw new Error((await res.json()).error||'Export failed');const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`paper-work-${new Date().toISOString().slice(0,10)}.xlsx`;a.click();URL.revokeObjectURL(url);toast('Excel report downloaded.');}catch(e){toast(e.message,true);}}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const data=new FormData(e.currentTarget);const btn=e.currentTarget.querySelector('button');btn.disabled=true;btn.textContent='Signing in…';$('#loginError').textContent='';try{await login(data.get('email'),data.get('password'));}catch(err){$('#loginError').textContent=err.message;}finally{btn.disabled=false;btn.innerHTML='Sign in <span>→</span>';}});
$('#logoutBtn').addEventListener('click',()=>logout());
$$('.nav-item').forEach(n=>n.addEventListener('click',()=>nav(n.dataset.page)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.go)));
$('#showUpload').addEventListener('click',uploadModal);$('#quickUpload').addEventListener('click',uploadModal);$('#addStoreBtn').addEventListener('click',addStoreModal);$('#addUserBtn').addEventListener('click',addUserModal);
$('#closeModal').addEventListener('click',closeModal);$('#cancelModal').addEventListener('click',closeModal);$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal();});
$('#modalForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.modalSubmit)return;const btn=$('#modalSubmit');btn.disabled=true;btn.textContent='Saving…';$('#modalError').textContent='';try{await state.modalSubmit(new FormData(e.currentTarget));}catch(err){$('#modalError').textContent=err.message;}finally{btn.disabled=false;btn.textContent='Save';}});
['#filterStatus','#filterCategory','#filterStore'].forEach(s=>$(s)?.addEventListener('change',loadDocuments));$('#docSearch').addEventListener('input',()=>{clearTimeout(loadDocuments.timer);loadDocuments.timer=setTimeout(loadDocuments,250);});
$('#downloadReport').addEventListener('click',downloadReport);$('#openSidebar').addEventListener('click',()=>$('#sidebar').classList.add('open'));$('#closeSidebar').addEventListener('click',()=>$('#sidebar').classList.remove('open'));
document.addEventListener('click',e=>{
  const file=e.target.closest('[data-file]'); if(file) downloadFile(file.dataset.file);
  const submit=e.target.closest('[data-submit]'); if(submit) submitDoc(submit.dataset.submit);
  const review=e.target.closest('[data-review]'); if(review){const [decision,id]=review.dataset.review.split(':');reviewDoc(decision,id);}
  const editStore=e.target.closest('[data-store-edit]'); if(editStore) editStoreModal(editStore.dataset.storeEdit);
  const toggleStore=e.target.closest('[data-store-toggle]'); if(toggleStore) toggleStoreStatus(toggleStore.dataset.storeToggle, toggleStore.dataset.nextActive === 'true');
});
$('#storeSearch')?.addEventListener('input', renderStores);
$('#storeStatusFilter')?.addEventListener('change', renderStores);
(async()=>{if(state.token){try{const me=await api('/api/auth/me');await enterApp(me.user||me);}catch{showLogin();}}else showLogin();})();
