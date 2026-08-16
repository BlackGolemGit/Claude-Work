// Thin wrapper around the browser's native Web Speech API (SpeechRecognition
// for mic input, SpeechSynthesis for spoken output). No API key, no cost —
// works in Chrome/Edge; gracefully reports unsupported in browsers that
// lack it (notably Firefox, and Safari's coverage is inconsistent).

export function speechRecognitionSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function speechSynthesisSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Starts one-shot listening. Resolves with the recognized transcript.
 * Rejects with a friendly Error on failure/no-speech/permission-denied.
 */
export function listenOnce() {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error('Voice input isn\'t supported in this browser — try Chrome or Edge.'));
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let settled = false;
    recognition.onresult = (event) => {
      settled = true;
      resolve(event.results[0][0].transcript);
    };
    recognition.onerror = (event) => {
      if (settled) return;
      settled = true;
      const messages = {
        'not-allowed': 'Microphone access was denied — allow it in your browser settings to use voice input.',
        'no-speech': "Didn't catch that — try again.",
        'audio-capture': 'No microphone was found.',
      };
      reject(new Error(messages[event.error] || `Voice input error: ${event.error}`));
    };
    recognition.onend = () => {
      if (!settled) reject(new Error("Didn't catch that — try again."));
    };
    recognition.start();
  });
}

/** Speaks `text` aloud. Cancels any speech already in progress first. Resolves when done. */
export function speak(text, { rate = 1, pitch = 1 } = {}) {
  return new Promise((resolve, reject) => {
    if (!speechSynthesisSupported()) {
      reject(new Error('Voice output isn\'t supported in this browser — try Chrome or Edge.'));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(new Error(`Speech playback failed: ${e.error || 'unknown error'}`));
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}
