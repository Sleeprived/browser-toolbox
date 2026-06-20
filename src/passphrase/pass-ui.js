import { generatePassphrase, generatorEntropyBits } from './generate.js';
import { estimateStrength } from './strength.js';
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
  try {
    await navigator.clipboard.writeText(outField.value);
  } catch {
    outField.select();
    document.execCommand && document.execCommand('copy');
  }
  copiedMsg.classList.remove('hidden');
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
  const pct = Math.max(0, Math.min(100, (r.bits / 100) * 100));
  meterBar.style.width = pct + '%';
  meterBar.style.background = STRENGTH_COLORS[r.label] || 'var(--text-dim)';
  if (pw.length === 0) {
    strengthEl.textContent = ' ';
  } else {
    const extra = r.penalties.length ? ` — weak spots: ${r.penalties.join(', ')}` : '';
    strengthEl.textContent = `${r.label} · ~${r.bits} bits${extra}`;
  }
}

pwInput.addEventListener('input', updateStrength);

generate();
updateStrength();
