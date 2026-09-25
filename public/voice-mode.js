(() => {
  const mic = document.getElementById('micBtn');
  const stop = document.getElementById('voiceStopBtn');
  const panel = document.getElementById('voiceStatus');
  const status = document.getElementById('voiceStatusText');
  if (!mic || !panel) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  let recognition = null, active = false, speaking = false;
  const setStatus = text => { if (status) status.textContent = text; };
  function closePanel() { active=false; speaking=false; try{recognition?.stop()}catch{} try{ synth?.cancel() }catch{} panel.classList.remove('open'); mic.classList.remove('active'); setStatus('جاهز لسماعك'); }
  function speak(text) {
    if (!synth || !text) return;
    synth.cancel();
    const clean = String(text).replace(/```[\s\S]*?```/g, 'الكود مرفق في المحادثة.');
    const u = new SpeechSynthesisUtterance(clean); u.lang='ar-EG'; u.rate=1; u.pitch=1; speaking=true; setStatus('🔊 CodeMind بيرد عليك...');
    u.onend=()=>{speaking=false;if(active)startListening()}; u.onerror=()=>{speaking=false;if(active)startListening()}; synth.speak(u);
  }
  async function sendVoice(text) {
    setStatus('🧠 بفكر في رد مناسب...');
    try {
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,mode:'code',history:[]})});
      const data=await response.json(); if(!response.ok) throw new Error(data.message||'voice_request_failed');
      const reply=String(data.reply||'').trim(); if(!reply) throw new Error('empty_reply'); speak(reply);
    } catch(e) { console.error('Voice request failed:',e); setStatus('حصل خطأ. جرّب تاني.'); setTimeout(()=>{if(active)startListening()},1200); }
  }
  function startListening() {
    if(!active||speaking)return;
    if(!SpeechRecognition){setStatus('المتصفح لا يدعم التعرف على الصوت.');return;}
    try{recognition?.abort()}catch{}
    recognition=new SpeechRecognition(); recognition.lang='ar-EG'; recognition.continuous=false; recognition.interimResults=false; recognition.maxAlternatives=1;
    recognition.onstart=()=>setStatus('🎙️ سامعك... اتكلم');
    recognition.onresult=e=>{const text=e.results?.[0]?.[0]?.transcript?.trim();if(text)sendVoice(text)};
    recognition.onerror=e=>{if(!active)return;if(e.error==='not-allowed')setStatus('اسمح للمتصفح باستخدام الميكروفون.');else setTimeout(()=>startListening(),500)};
    recognition.onend=()=>{if(active&&!speaking)setTimeout(()=>startListening(),250)};
    try{recognition.start()}catch{}
  }
  mic.addEventListener('click',()=>{if(active){closePanel();return} active=true;panel.classList.add('open');mic.classList.add('active');setStatus('🎙️ تجهيز الميكروفون...');startListening()});
  stop?.addEventListener('click',closePanel);
  window.addEventListener('beforeunload',()=>{try{recognition?.stop();synth?.cancel()}catch{}});
})();