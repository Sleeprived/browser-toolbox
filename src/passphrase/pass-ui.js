import { generatePassphrase, generatorEntropyBits } from './generate.js';
import { estimateStrength, scoreToPercent } from './strength.js';
import { EFF_WORDLIST } from '../../assets/data/eff_wordlist.js';

const wordsRange = document.getElementById('words');
const wordsVal = document.getElementById('words-val');
const sepSel = document.getElementById('sep');
const capChk = document.getElementById('cap');
const digitChk = document.getElementById('digit');
const genBtn = document.getElementById('gen');
const copyBtn = document.getElementById('copy');
const outField = document.getElementById('out');
const entropyEl = document.getElementById('entropy');
const copiedMsg = document.getElementById('copied');

const pwInput = document.getElementById('pw');
const meterBar = document.getElementById('meter-bar');
const strengthEl = document.getElementById('strength');
const revealBtn = document.getElementById('reveal');

function currentOpts() {
  return {
    words: Number(wordsRange.value),
    separator: sepSel.value,
    capitalize: capChk.checked,
    appendDigit: digitChk.checked,
  };
}

function generate() {
  const opts = currentOpts();
  outField.value = generatePassphrase(opts, EFF_WORDLIST);
  const bits = generatorEntropyBits(opts, EFF_WORDLIST.length);
  entropyEl.textContent = `Entropy: ~${bits} bits (${opts.words} words from ${EFF_WORDLIST.length})`;
  copiedMsg.classList.add('hidden');
}

wordsRange.addEventListener('input', () => {
  wordsVal.textContent = wordsRange.value;
  generate();
});
sepSel.addEventListener('change', generate);
capChk.addEventListener('change', generate);
digitChk.addEventListener('change', generate);
genBtn.addEventListener('click', generate);

copyBtn.addEventListener('click', async () => {
  if (!outField.value) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(outField.value);
    ok = true;
  } catch {
    outField.select();
    try { ok = !!(document.execCommand && document.execCommand('copy')); } catch { ok = false; }
  }
  copiedMsg.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl+C to copy';
  copiedMsg.classList.remove('hidden');
});

revealBtn.addEventListener('click', () => {
  const showing = pwInput.type === 'text';
  pwInput.type = showing ? 'password' : 'text';
  revealBtn.textContent = showing ? 'Show' : 'Hide';
  revealBtn.setAttribute('aria-pressed', String(!showing));
});

const STRENGTH_COLORS = {
  '—': 'var(--text-dim)',
  'Very weak': 'var(--danger)',
  Weak: 'var(--danger)',
  Fair: 'var(--warn)',
  Strong: 'var(--good)',
  'Very strong': 'var(--good)',
};

function updateStrength() {
  const pw = pwInput.value;
  const r = estimateStrength(pw);
  const pct = pw.length === 0 ? 0 : scoreToPercent(r.score);
  meterBar.style.width = pct + '%';
  meterBar.style.background = STRENGTH_COLORS[r.label] || 'var(--text-dim)';
  meterBar.setAttribute('aria-valuenow', String(pct));
  meterBar.setAttribute('aria-valuetext', pw.length === 0 ? 'no password entered' : `${r.label}, about ${r.bits} bits`);
  if (pw.length === 0) {
    strengthEl.textContent = ' ';
  } else {
    const extra = r.suggestions.length ? ` — weak spots: ${r.suggestions.join(', ')}` : '';
    strengthEl.textContent = `${r.label} · ~${r.bits} bits${extra}`;
  }
}

pwInput.addEventListener('input', updateStrength);

generate();
updateStrength();
