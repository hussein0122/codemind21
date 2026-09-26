(() => {
  const mic = document.getElementById('micBtn');
  const stop = document.getElementById('voiceStopBtn');
  const panel = document.getElementById('voiceStatus');
  const status = document.getElementById('voiceStatusText');
  const rateControl = document.getElementById('voiceRate');
  if (!mic || !panel) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  let recognition = null, active = false, speaking = false;
  let voiceRate = Number(localStorage.getItem('codemind_voice_rate') || '0.92');
  if (rateControl) { rateControl.value = String(voiceRate); rateControl.addEventListener('change', () => { voiceRate = Number(rateControl.value) || 0.92; localStorage.setItem('codemind_voice_rate', String(voiceRate)); }); }
  const voiceHistory = [];
  let selectedVoice = null;
  const setStatus = text => { if (status) status.textContent = text; };
  function closePanel() { active=false; speaking=false; voiceHistory.length=0; try{recognition?.stop()}catch{} try{ synth?.cancel() }catch{} panel.classList.remove('open'); mic.classList.remove('active'); setStatus('جاهز لسماعك'); }
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = speechSynthesis.getVoices();
    return voices.find(v => /^ar-EG$/i.test(v.lang)) || voices.find(v => /^ar(-|_)/i.test(v.lang)) || null;
  }
  speechSynthesis?.addEventListener?.('voiceschanged', () => { selectedVoice = pickVoice(); });
  selectedVoice = pickVoice();

  function prepareSpeech(text) {
    return String(text)
      .replace(/```[\s\S]*?```/g, 'الكود موجود في المحادثة.')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/\n{2,}/g, '. ')
      .replace(/\s*([،؛])\s*/g, '$1 ')
      .replace(/\s*([.!؟])\s*/g, '$1 ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  function speak(text) {
    if (!synth || !text) return;
    synth.cancel();
    const clean = prepareSpeech(text);
    if (!clean) { if(active) startListening(); return; }
    const u = new SpeechSynthesisUtterance(clean);
    u.lang='ar-EG';
    u.rate=Math.min(1.15, Math.max(0.75, voiceRate));
    u.pitch=1.03;
    if(selectedVoice) u.voice=selectedVoice;
    speaking=true; setStatus('🔊 CodeMind بيرد عليك...');
    u.onend=()=>{speaking=false;if(active)startListening()};
    u.onerror=()=>{speaking=false;if(active)startListening()};
    synth.speak(u);
  }
  async function sendVoice(text) {
    setStatus('🧠 بفكر في رد مناسب...');
    try {
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,mode:'code',history:voiceHistory.slice(-20)})});
      const data=await response.json(); if(!response.ok) throw new Error(data.message||'voice_request_failed');
      const reply=String(data.reply||'').trim(); if(!reply) throw new Error('empty_reply'); voiceHistory.push({role:'user',content:text},{role:'assistant',content:reply}); if(voiceHistory.length>20) voiceHistory.splice(0,voiceHistory.length-20); speak(reply);
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