// Page wiring for the upload section. The build itself is in patcher.js.
import { md5, checkFirmware, buildLoader, readFirmware, makeZip, PatchError } from './patcher.js';
import { readmeText } from './readme.js';
import recipe from './recipe.js';

const $ = id => document.getElementById(id);
const drop = $('drop'), input = $('file');
const zipName = `mod_pr4x1s-${recipe.version.split(' ').pop()}.zip`;
let built = null;   // {bin, md5} once a file is built

function show(fields) {
  $('result').hidden = false;
  for (const [id, text] of Object.entries(fields)) $(id).textContent = text;
}

function message(text, kind) {
  $('r-msg').textContent = text;
  $('r-msg').className = `msg ${kind}`;
}

async function handle(file) {
  built = null;
  $('r-out').hidden = true;
  show({ 'r-name': file.name, 'r-size': '', 'r-md5': '', 'r-md5-ok': '' });
  message('Reading…', '');
  try {
    const { name, data } = await readFirmware(file.name, new Uint8Array(await file.arrayBuffer()));
    show({ 'r-name': name, 'r-size': `${data.length.toLocaleString()} bytes`, 'r-md5': md5(data) });
    try {
      checkFirmware(data, recipe);
    } catch (e) {
      $('r-md5-ok').innerHTML = '<span class="bad">✗</span>';
      throw e;
    }
    $('r-md5-ok').innerHTML = `<span class="ok">✓</span> ${recipe.stockName}`;
    const out = buildLoader(data, recipe);
    built = { bin: out, md5: md5(out) };
    show({ 'o-size': `${out.length.toLocaleString()} bytes`, 'o-md5': built.md5, 'zip-name': zipName });
    $('r-out').hidden = false;
    message('Your file is ready. Tick the box to download it, then see Usage below.', 'good');
  } catch (e) {
    message(e instanceof PatchError ? e.message : `Couldn't read this file (${e.message}).`, 'error');
  }
}

function save(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('ack').addEventListener('change', () => { $('dl-zip').disabled = $('dl-bin').disabled = !$('ack').checked; });
$('dl-bin').addEventListener('click', () => { if (built) save('sp1200eefw.bin', built.bin, 'application/octet-stream'); });
$('dl-zip').addEventListener('click', () => {
  if (!built) return;
  const readme = readmeText({ recipe, outMd5: built.md5, pageUrl: location.origin + location.pathname });
  const zip = makeZip([
    { name: 'sp1200eefw.bin', data: built.bin },
    { name: 'README.txt', data: new TextEncoder().encode(readme) },
  ]);
  save(zipName, zip, 'application/zip');
});

drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
input.addEventListener('change', () => { if (input.files[0]) handle(input.files[0]); input.value = ''; });
for (const ev of ['dragenter', 'dragover'])
  drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop'])
  drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) handle(file);
});
// A file dropped outside the drop zone shouldn't navigate away from the page.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
