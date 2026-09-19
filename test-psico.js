const bcrypt=require('bcryptjs');
delete require.cache[require.resolve('./store')];
const store=require('./store');
async function t(){
 console.log('MODE',store.mode);
 for(const u of ['psicologo','psicólogo','PSICOLOGO',' Psicologo ','Psicólogo']){
   const found=await store.users.byName(u);
   console.log(`byName(${JSON.stringify(u)}) =>`, found? found.user+'/'+found.role : null);
   if(found){
     const ok=await bcrypt.compare('psicologo123', found.pass);
     console.log('  bcrypt psicologo123 =>',ok);
     const ok2=await bcrypt.compare('wrong', found.pass);
     console.log('  bcrypt wrong =>',ok2);
   }
 }
 // test login flow
 const shared=require('./src/lib/shared');
 const isHash=p=>typeof p==='string' && /^\$2[aby]\$/.test(p);
 async function login(user,pass){
   const u=await store.users.byName(user);
   if(!u) return 'no user';
   let ok=false;
   if(isHash(u.pass)) ok=await bcrypt.compare(String(pass||''), u.pass);
   else if(u.pass===String(pass||'')) ok=true;
   return ok? 'OK '+u.user : 'FAIL';
 }
 console.log('login psicologo/psicologo123 =>', await login('psicologo','psicologo123'));
 console.log('login psicólogo/psicologo123 =>', await login('psicólogo','psicologo123'));
 console.log('login psicologo/wrong =>', await login('psicologo','wrong'));
}
t().catch(e=>console.error(e));
