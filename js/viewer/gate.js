// Simple password gate for the 3D viewer only. Keeps casual visitors out; not real security.
// Only the SHA-256 hash of the (lower-cased) password is stored here.
const HASH = '916546ec0702cb24ba497d54eb90f6447378ac3800ca5ffa018f412c3d35b5f8';
const KEY = 'duncaster3dGate';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function remembered() {
  try { return localStorage.getItem(KEY) === HASH; } catch (e) { return false; }
}

export function requireUnlock() {
  if (remembered()) return Promise.resolve();
  const gate = document.getElementById('gate');
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-input');
  const err = document.getElementById('gate-error');
  gate.hidden = false;
  setTimeout(() => input.focus(), 50);
  return new Promise(resolve => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const ok = (await sha256(input.value.trim().toLowerCase())) === HASH;
      if (!ok) {
        err.textContent = 'Incorrect password';
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
        input.select();
        return;
      }
      try { localStorage.setItem(KEY, HASH); } catch (e2) { /* private mode: ask again next time */ }
      input.blur();
      gate.hidden = true;
      resolve();
    });
  });
}
