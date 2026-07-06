if(sessionStorage.getItem('login_auth_token')) window.location.href='/chat';
document.addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin();});

function togglePw(){
  const inp=document.getElementById('password');
  const eye=document.getElementById('pw-eye');
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  eye.className=show?'ti ti-eye-off':'ti ti-eye';
}

function setLoading(on){
  const btn=document.getElementById('loginBtn');
  const icon=document.getElementById('btn-icon');
  const text=document.getElementById('btn-text');
  if(on){
    btn.classList.add('loading');
    icon.className='spinner';
    text.textContent='Giriş yapılıyor...';
  } else {
    btn.classList.remove('loading');
    icon.className='ti ti-arrow-right';
    text.textContent='Giriş Yap';
  }
}

function setSuccess(){
  const btn=document.getElementById('loginBtn');
  const icon=document.getElementById('btn-icon');
  const text=document.getElementById('btn-text');
  btn.classList.add('success');
  icon.className='ti ti-check';
  text.textContent='Giriş yapıldı';
}

function showError(msg){
  const box=document.getElementById('alertBox');
  document.getElementById('alertText').textContent=msg;
  box.classList.add('show');
  document.getElementById('email').classList.add('error');
  document.getElementById('password').classList.add('error');
  setTimeout(()=>{
    document.getElementById('email').classList.remove('error');
    document.getElementById('password').classList.remove('error');
  },2000);
}

function hideError(){
  document.getElementById('alertBox').classList.remove('show');
}

async function handleLogin(){
  const email=document.getElementById('email').value.trim().toLowerCase();
  const password=document.getElementById('password').value;
  hideError();
  if(!email||!password) return showError('E-posta ve şifre zorunlu.');
  setLoading(true);
  try{
    const res=await fetch('/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data?.error||'Giriş başarısız.');
    sessionStorage.setItem('login_auth_token',data.token);
    sessionStorage.setItem('onboarding_complete',data.onboarding_complete);

    if (data.tenant_id) {
      sessionStorage.setItem('login_tenant_id', data.tenant_id);
    } else {
      // decode from JWT payload (no library needed)
      try {
        const payload = JSON.parse(atob(data.token.split('.')[1]));
        sessionStorage.setItem('login_tenant_id', payload.tenant_id || payload.tenantId || '');
      } catch(e) {}
    }

    setSuccess();
    const bar=document.getElementById('top-bar');
    bar.style.width='100%';
    setTimeout(()=>{
      if(!data.onboarding_complete){
        window.location.replace('/auth/onboarding.html');
      } else {
        window.location.replace('/chat');
      }
    },700);
  } catch(err){
    showError(err.message);
    setLoading(false);
    document.getElementById('password').value='';
    document.getElementById('password').focus();
  }
}

window.addEventListener('load',()=>{
  const bar=document.getElementById('top-bar');
  bar.style.width='60%';
  setTimeout(()=>{bar.style.opacity='0';bar.style.transition='opacity .3s ease';},800);
});