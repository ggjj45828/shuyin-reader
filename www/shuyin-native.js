/* 书隐 iOS bridge: native shell uses device-local IndexedDB by default. */
(() => {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  document.documentElement.classList.add('shuyin-ios');
  // No implicit NAS dependency; imported TXT/MD and browser-saved books remain on device.
  // Voice: use system speech as a fallback; do not claim Kokoro is embedded.
  window.ShuyinNative = {
    isNative: true,
    speak(text, options = {}) {
      if (!('speechSynthesis' in window)) return false;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text || ''));
      utterance.lang = 'zh-CN';
      utterance.rate = Math.max(.65, Math.min(1.5, Number(options.rate) || 1));
      speechSynthesis.speak(utterance);
      return true;
    },
    stopSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  };
  document.addEventListener('DOMContentLoaded', () => {
    const note = document.createElement('div');
    note.className = 'shuyin-native-hint';
    note.textContent = '本机书库 · 离线阅读';
    document.body.append(note);
    setTimeout(() => note.remove(), 3800);
  });
})();
