
    try{var s=JSON.parse(localStorage.getItem('te_session')||'null');if(s&&s.token)document.documentElement.classList.add('has-session');}catch(e){}
    // Fallback: esconde loader após 10s (cold start Render)
    setTimeout(function(){
      var el=document.getElementById('initialLoader');
      if(el && el.parentNode){
        el.style.opacity='0';
        setTimeout(function(){ el.remove(); },300);
      }
    },10000);
  