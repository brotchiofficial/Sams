import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, onSnapshot, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== Remplir ta config =====
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ===== Helpers UI =====
const $ = (id)=>document.getElementById(id);
const showBlock = (el,v=true)=>{ if(el) el.style.display=v?'block':'none' };
const fmtDate = (ts)=> ts? new Date(ts).toLocaleString():'—';
const msToHM = (ms)=>{ const t=Math.floor(ms/60000),h=Math.floor(t/60),m=t%60; return `${h}h${String(m).padStart(2,'0')}`; };
const setFsBanner = (on)=> showBlock($('fsUnavailable'), !!on);
window.addEventListener('online', ()=>setFsBanner(false));
window.addEventListener('offline', ()=>setFsBanner(true));

// ===== Auth UI =====
$('pseudoBtn')?.addEventListener('click', ()=>{
  const p = ($('pseudoInput').value||'').trim().toLowerCase();
  if(!p){ $('message').textContent='Saisis un pseudo.'; return; }
  showBlock($('passwordArea'), true);
  $('message').textContent='';
});
$('changePseudoBtn')?.addEventListener('click', ()=> showBlock($('passwordArea'), false));
$('passwordBtn')?.addEventListener('click', async ()=>{
  const p = ($('pseudoInput').value||'').trim().toLowerCase();
  const pwd = $('passwordInput').value;
  if(!p || !pwd){ $('message').textContent='Pseudo + mot de passe requis.'; return; }
  const email = `${p}@monjeu.local`;
  try{
    const methods = await fetchSignInMethodsForEmail(auth, email);
    if(methods.length===0){
      const cred = await createUserWithEmailAndPassword(auth, email, pwd);
      await setDoc(doc(db,'usersByUid', cred.user.uid), { pseudo:p, role:'NEW' });
      await setDoc(doc(db,'users', p), { pseudo:p, role:'NEW' });
    }else{
      await signInWithEmailAndPassword(auth, email, pwd);
    }
  }catch(e){
    console.error(e);
    $('message').textContent = e.code==='auth/invalid-credential' ? 'Mot de passe incorrect.' : (e.message||e.code);
  }
});

// ===== Auth state =====
const ctx = { me:null, mePseudo:null, meRole:'NEW', unsub:{} };
function unsubscribeAll(){ for(const k in ctx.unsub){ try{ctx.unsub[k]()}catch{} } ctx.unsub = {}; }

onAuthStateChanged(auth, async (user)=>{
  unsubscribeAll();
  ctx.me = user;
  if(!user){
    showBlock($('pseudoBox'), true);
    showBlock($('serviceBox'), false);
    showBlock($('adminBox'), false);
    return;
  }
  try{
    const udoc = await getDoc(doc(db,'usersByUid', user.uid));
    if(udoc.exists()){
      ctx.mePseudo = udoc.data().pseudo;
      ctx.meRole   = udoc.data().role || 'NEW';
    }else{
      const guess=(user.email||'').split('@')[0];
      ctx.mePseudo=guess; ctx.meRole='NEW';
      await setDoc(doc(db,'usersByUid', user.uid), { pseudo:guess, role:'NEW' });
      await setDoc(doc(db,'users', guess), { pseudo:guess, role:'NEW' });
    }
  }catch(e){ console.error(e); setFsBanner(true); }

  postLoginSetup();
});

function postLoginSetup(){
  showBlock($('pseudoBox'), false);
  showBlock($('serviceBox'), true);
  $('welcome').textContent = `Bienvenue ${ctx.mePseudo}`;

  // Liste users
  ctx.unsub.users = onSnapshot(collection(db,'users'), (snap)=>{
    const list = $('playersList'); list.innerHTML='';
    const arr = snap.docs.map(d=>d.id).sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
    if(!arr.length){ list.innerHTML = '<div style=\"opacity:.7\">Aucun joueur</div>'; return; }
    arr.forEach(p=>{ const div=document.createElement('div'); div.className='player'; div.textContent=p; list.appendChild(div); });
  });

  // Mon service
  ctx.unsub.service = onSnapshot(doc(db,'services', ctx.mePseudo), (snap)=>{
    const sv = snap.data()||{ status:'out', startAt:null, totalMs:0, sessions:[] };
    const inService = sv.status==='in' && sv.startAt;
    if(inService){
      const started = sv.startAt?.toMillis? sv.startAt.toMillis(): Date.parse(sv.startAt||0);
      const cur = Math.max(0, Date.now()-started);
      $('timer').textContent = msToHM(cur);
    }else{
      $('timer').textContent = '0h00';
    }
    // boutons
    $('startBtn').disabled = inService;
    $('endBtn').disabled   = !inService;
  });

  // Patients (liste)
  const qPatients = query(collection(db,'patients'), orderBy('createdAt','desc'), limit(200));
  ctx.unsub.patients = onSnapshot(qPatients, (snap)=>{
    const q = ($('patientSearch')?.value||'').trim().toLowerCase();
    const rows = [];
    snap.forEach(d=>{
      const p=d.data();
      const name=(p.nom||'—')+' '+(p.prenom||'');
      if(q && !name.toLowerCase().includes(q)) return;
      rows.push(`<div class='patient-row'>${name}</div>`);
    });
    $('patientList').innerHTML = rows.join('');
  });
}

// Start/End service
$('startBtn')?.addEventListener('click', async ()=>{
  try{ await setDoc(doc(db,'services', ctx.mePseudo), { status:'in', startAt: serverTimestamp() }, { merge:true }); await addLog('service:start'); }
  catch(e){ $('status').textContent='Impossible de démarrer.'; }
});
$('endBtn')?.addEventListener('click', async ()=>{
  try{
    const ref = doc(db,'services', ctx.mePseudo);
    const snap = await getDoc(ref);
    const sv = snap.data()||{};
    const started = sv.startAt?.toMillis? sv.startAt.toMillis(): Date.parse(sv.startAt||0);
    const dur = started? (Date.now()-started):0;
    await updateDoc(ref, { status:'out', startAt:null, totalMs:(sv.totalMs||0)+dur, sessions:(sv.sessions||[]).concat([{startAt:sv.startAt||serverTimestamp(), endAt:serverTimestamp()}]) });
    await addLog('service:end');
  }catch(e){ $('status').textContent='Erreur fin de service.'; }
});
$('homeBtn')?.addEventListener('click', async ()=>{ await signOut(auth); });

// Admin gate (x5 logo)
document.addEventListener('DOMContentLoaded', ()=>{
  let clickCount=0, firstAt=0;
  $('siteLogo')?.addEventListener('click', ()=>{
    const now=Date.now();
    if(now-firstAt>10000){ clickCount=0; firstAt=now; }
    clickCount++;
    if(clickCount>=5){ clickCount=0; openAdminGate(); }
  });
});
function openAdminGate(){ $('adminPwd').value=''; $('adminGateMsg').textContent=''; $('adminGateModal').style.display='flex'; }
$('adminGateCancel')?.addEventListener('click', ()=> $('adminGateModal').style.display='none');
$('adminGateOk')?.addEventListener('click', async ()=>{
  try{
    const pwd = $('adminPwd').value;
    await signInWithEmailAndPassword(auth, 'admin@monjeu.local', pwd);
    const u = auth.currentUser;
    await setDoc(doc(db,'usersByUid', u.uid), { pseudo:'admin', role:'ADMIN' }, { merge:true });
    await setDoc(doc(db,'users', 'admin'), { pseudo:'admin', role:'ADMIN' }, { merge:true });
    $('adminGateModal').style.display='none';
    openAdmin();
  }catch(e){ $('adminGateMsg').textContent='Mot de passe admin incorrect.'; }
});
function openAdmin(){
  showBlock($('serviceBox'), false);
  showBlock($('adminBox'), true);
  if(ctx.unsub.allUsers) ctx.unsub.allUsers();
  ctx.unsub.allUsers = onSnapshot(collection(db,'users'), (snap)=>{
    const rows = [];
    snap.forEach(d=> rows.push(`<tr><td>${d.id}</td><td>${(d.data().role||'NEW')}</td></tr>`));
    document.querySelector('#adminTable tbody').innerHTML = rows.join('');
  });
}

// Logs
async function addLog(action, extra={}){
  try{ await addDoc(collection(db,'logs'), { at: serverTimestamp(), action, byPseudo: ctx.mePseudo, ...extra }); }catch(e){}
}
