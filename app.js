import * as store from './db.js';
import { db, q } from './db.js';

// --- Options ------------------------------------------------------------------

const METHODS = {
  prayer: 'Care through prayer',
  testimony: '15-second testimony',
  three_circles: '3 Circles',
  jesus_story: 'Jesus Story',
  dbs: 'Discovery Bible Study',
};
const OUTCOMES = {
  conversation: 'Conversation',
  no_answer: 'No answer',
  not_interested: 'Not interested',
  come_back: 'Come back later',
  skip: 'Vacant / skip',
};
// Trainings are stored in the visit's `shared` list as "trained_<tool>", so no extra column is needed.
const TRAINED = 'trained_';
const sharedOf = (v) => (v.shared ?? []).filter((s) => !s.startsWith(TRAINED));
const trainedOf = (v) => (v.shared ?? []).filter((s) => s.startsWith(TRAINED)).map((s) => s.slice(TRAINED.length));
const methodList = (keys) => keys.map((k) => esc(METHODS[k] ?? k)).join(', ');

const LIGHTS = { green: 'Green light', yellow: 'Yellow light', red: 'Red light', believer: 'Believer' };
const RESPONSES = { accepted: 'Accepted Christ', interested: 'Interested', rejected: 'Rejected' };
const FOLLOW_KINDS = {
  visit: 'Return visit',
  prayer: 'Keep praying',
  gospel: 'Share gospel again',
  dbs: 'Start a DBS',
  church: 'Invite to church / gathering',
  baptism: 'Baptism',
  bible: 'Give a Bible',
  need: 'Meet a practical need',
};

// --- Helpers ------------------------------------------------------------------

const main = document.getElementById('main');
let lists = { team: [], complexes: [] };
let loginMessage = '';
let personForLog = null; // set by "Log another conversation" on a person page

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = main) => root.querySelector(sel);
const $$ = (sel, root = main) => [...root.querySelectorAll(sel)];
const val = (sel, root = main) => ($(sel, root)?.value ?? '').trim() || null;

const teamName = (id) => lists.team.find((t) => t.id === id)?.name ?? 'Unknown';
const complexName = (id) => lists.complexes.find((c) => c.id === id)?.name ?? '';
const PLACE_KINDS = { apartments: 'Apartment complex', neighborhood: 'Neighborhood (houses)' };
const UNIT_LABELS = { apartments: ['Building', 'Apt #'], neighborhood: ['Street', 'House #'] };
const unitLabels = (id) => UNIT_LABELS[lists.complexes.find((c) => c.id === id)?.kind] ?? UNIT_LABELS.apartments;
const isHouses = (id) => lists.complexes.find((c) => c.id === id)?.kind === 'neighborhood';
const activeTeam = () => lists.team.filter((t) => t.active);
const activeComplexes = () => lists.complexes.filter((c) => c.active);

function where(o) {
  const parts = isHouses(o.complex_id)
    ? [complexName(o.complex_id), [o.unit, o.building].filter(Boolean).join(' ')]
    : [complexName(o.complex_id), o.building && `Bldg ${o.building}`, o.unit && `#${o.unit}`];
  return parts.filter(Boolean).join(' · ');
}

// Places grouped into apartments and neighborhoods.
function placeOptions(selected, blank, onlyActive = true) {
  const places = onlyActive ? activeComplexes() : lists.complexes;
  const group = (kind, label) => {
    const items = places.filter((c) => (c.kind ?? 'apartments') === kind);
    return items.length ? `<optgroup label="${label}">${options(items, selected)}</optgroup>` : '';
  };
  return `<option value="">${esc(blank)}</option>` + group('apartments', 'Apartments') + group('neighborhood', 'Neighborhoods');
}

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const today = () => new Date().toLocaleDateString('en-CA');
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const options = (items, selected, blank) =>
  (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
  items.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('');

// Chip groups: <div class="chips" data-group="x" data-single> with <button class="chip" data-value>
function chips(group, map, selected = [], { single = false, cls = 'chips' } = {}) {
  const sel = new Set([].concat(selected ?? []));
  return `<div class="${cls}" data-group="${group}" ${single ? 'data-single' : ''}>` +
    Object.entries(map).map(([v, label]) =>
      `<button type="button" class="chip" data-value="${esc(v)}" aria-pressed="${sel.has(v)}">${esc(label)}</button>`).join('') +
    '</div>';
}
const chipValues = (group, root = main) => $$(`[data-group="${group}"] .chip[aria-pressed="true"]`, root).map((b) => b.dataset.value);
const chipValue = (group, root = main) => chipValues(group, root)[0] ?? null;

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const group = chip.closest('[data-group]');
  const on = chip.getAttribute('aria-pressed') !== 'true';
  if (group?.hasAttribute('data-single')) $$('.chip', group).forEach((c) => c.setAttribute('aria-pressed', 'false'));
  chip.setAttribute('aria-pressed', String(on));
  group?.dispatchEvent(new Event('chipchange', { bubbles: true }));
});

const lightDot = (l) => (l ? `<span class="dot ${l}" title="${esc(LIGHTS[l])}"></span>` : '');
const responseBadge = (r) => (r ? `<span class="badge">${esc(RESPONSES[r])}</span>` : '');

// --- Router -------------------------------------------------------------------

// A view can register a cleanup (stop GPS, remove the map) that runs when it's left or redrawn.
let cleanup = null;
function leave() {
  cleanup?.();
  cleanup = null;
}

const routes = {
  log: viewLog,
  followups: viewFollowUps,
  people: viewPeople,
  person: viewPerson,
  map: viewMap,
  doors: viewDoors,
  stats: viewStats,
  settings: viewSettings,
};

async function render() {
  if (!store.getCode()) return viewLogin();
  document.body.classList.remove('locked');
  leave();
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const route = routes[name] ? name : 'log';
  document.querySelectorAll('[data-nav]').forEach((a) =>
    a.classList.toggle('active', a.dataset.nav === ({ person: 'people', doors: 'map' }[route] ?? route)));
  main.innerHTML = '<p class="muted">Loading…</p>';
  window.scrollTo(0, 0);
  try {
    await routes[route](arg);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card error"><h2>Couldn't load this page</h2>
      <p>${esc(err.message || err)}</p>
      <p class="small muted">If you're offline, you can still log doors and conversations on the Log tab — they'll sync later.</p></div>`;
  }
}

function updateSyncBadge(count, error) {
  const el = document.getElementById('sync');
  el.hidden = !count;
  el.classList.toggle('warn', Boolean(error));
  el.textContent = count ? `${count} waiting to sync` : '';
}

// --- Login --------------------------------------------------------------------

function viewLogin() {
  document.body.classList.add('locked');
  main.innerHTML = `
    <div class="login">
      <h1>🐟 Gospel Tracker</h1>
      <form class="card" id="login">
        <label for="code">Team passcode</label>
        <input id="code" type="password" autocomplete="current-password" required>
        ${loginMessage ? `<p class="overdue small">${esc(loginMessage)}</p>` : ''}
        <p class="small muted">Ask your team leader for the passcode. This phone will remember it.</p>
        <button class="primary big">Enter</button>
      </form>
    </div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      if (await store.tryCode($('#code').value.trim())) {
        loginMessage = '';
        lists = await store.loadLists();
        render();
        store.flush();
      } else {
        loginMessage = 'That passcode didn\'t work.';
        viewLogin();
      }
    } catch (err) {
      loginMessage = `Couldn't reach the server: ${err.message}`;
      viewLogin();
    }
  });
}

// --- Log (door knocks + conversations) ----------------------------------------

function viewLog() {
  leave();
  // "Who's out today" and the current location are remembered for the day.
  const saved = store.read('gt.today', {});
  const day = saved.date === today() ? saved : { date: today() };
  const prefill = personForLog;
  personForLog = null;
  const loc = prefill ?? day;

  main.innerHTML = `<div id="logView">
    <h1>Log a door</h1>
    <section class="card">
      <label>Who's out fishing</label>
      <div class="multi" id="fishers">
        <button type="button" class="multi-btn" aria-expanded="false"><span id="fishersText"></span><span aria-hidden="true">▾</span></button>
        <div class="multi-panel" hidden>
          <div id="fisherChecks"></div>
          <div class="inline" style="margin-top:8px">
            <input id="newFisher" placeholder="Add someone new" autocomplete="off">
            <button type="button" id="addFisher">Add</button>
          </div>
          <button type="button" class="primary big" id="fishersDone" style="margin-top:10px">Done</button>
        </div>
      </div>
      <label for="complex">Where</label>
      <select id="complex">${placeOptions(loc.complex_id, 'Choose a complex or neighborhood…')}</select>
      <div class="row">
        <div><label for="building" id="buildingLabel">${unitLabels(loc.complex_id)[0]}</label><input id="building" value="${esc(loc.building)}" autocomplete="off"></div>
        <div><label for="unit" id="unitLabel">${unitLabels(loc.complex_id)[1]}</label><input id="unit" inputmode="text" value="${esc(prefill?.unit)}" autocomplete="off"></div>
      </div>
      <div id="unitHint"></div>
      <p class="small muted" id="gps" style="margin:10px 0 0">📍 Finding your location…</p>
    </section>

    <section class="card" id="outcomeCard">
      <h2>What happened at the door?</h2>
      <div class="outcomes">
        <button type="button" class="convo" data-outcome="conversation">💬 We had a conversation</button>
        <button type="button" data-outcome="no_answer">No answer</button>
        <button type="button" data-outcome="not_interested">Not interested</button>
        <button type="button" data-outcome="come_back">Come back later</button>
        <button type="button" data-outcome="skip">Vacant / skip</button>
      </div>
    </section>

    <form id="convo" hidden>
      <section class="card">
        <h2>Who did you talk to?</h2>
        <div id="knownPeople"></div>
        <input type="hidden" id="personId">
        <label for="pname">Name</label>
        <input id="pname" placeholder="First name, or a description" autocomplete="off">
        <label for="phone">Phone</label>
        <input id="phone" type="tel" autocomplete="off">
        <label for="household">Household / family</label>
        <input id="household" placeholder="e.g. wife Maria, 2 kids, works nights">
        <label for="prayer">Prayer request</label>
        <textarea id="prayer"></textarea>
      </section>

      <section class="card">
        <h2>What was shared?</h2>
        ${chips('shared', METHODS)}
        <label>Trained them on</label>
        ${chips('trained', METHODS)}
        <label>Light</label>
        ${chips('light', { green: 'Green', yellow: 'Yellow', red: 'Red', believer: 'Believer' }, [], { single: true, cls: 'seg four' })}
        <label>Response</label>
        ${chips('response', RESPONSES, [], { single: true, cls: 'seg' })}
        <label for="vnotes">Conversation notes</label>
        <textarea id="vnotes" placeholder="What stood out? Questions they asked?"></textarea>
      </section>

      <section class="card">
        <h2>Follow-up needed</h2>
        ${chips('kinds', FOLLOW_KINDS)}
        <div id="fuDetails" hidden>
          <div class="row">
            <div><label for="assigned">Who will follow up</label>
              <select id="assigned">${options(activeTeam(), null, 'Unassigned')}</select></div>
            <div><label for="due">By when</label><input id="due" type="date" value="${addDays(7)}"></div>
          </div>
          <label for="funotes">Follow-up notes</label>
          <textarea id="funotes"></textarea>
        </div>
      </section>

      <button class="primary big" id="saveConvo">Save conversation</button>
      <p style="text-align:center"><button type="button" class="link" id="cancelConvo">Cancel</button></p>
    </form></div>`;

  const view = $('#logView');
  const convo = $('#convo');
  let knownPeople = [];

  // Who's out fishing: dropdown with checkboxes.
  const fisherBox = $('#fishers');
  const fisherIds = () => $$('#fisherChecks input:checked').map((i) => i.value);
  function drawFishers(selected) {
    $('#fisherChecks').innerHTML = activeTeam().map((t) => `
      <label class="check"><input type="checkbox" value="${t.id}" ${selected.includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')
      || '<p class="small muted">No team members yet — add one below.</p>';
    updateFisherText();
  }
  function updateFisherText() {
    const names = fisherIds().map(teamName);
    $('#fishersText').textContent = names.length ? names.join(', ') : 'Choose who\'s out…';
    $('#fishersText').classList.toggle('muted', !names.length);
  }
  function openFishers(open) {
    $('.multi-panel', fisherBox).hidden = !open;
    $('.multi-btn', fisherBox).setAttribute('aria-expanded', String(open));
  }
  drawFishers(day.fisher_ids ?? []);
  $('.multi-btn', fisherBox).addEventListener('click', () => openFishers($('.multi-panel', fisherBox).hidden));
  $('#fishersDone').addEventListener('click', () => openFishers(false));
  $('#fisherChecks').addEventListener('change', () => { updateFisherText(); rememberDay(); });
  document.addEventListener('click', function closeFishers(e) {
    if (!document.contains(fisherBox)) return document.removeEventListener('click', closeFishers);
    if (!fisherBox.contains(e.target)) openFishers(false);
  });
  $('#addFisher').addEventListener('click', async () => {
    const name = val('#newFisher');
    if (!name) return;
    const id = crypto.randomUUID();
    try {
      await q(db().from('team_members').insert({ id, name }));
      lists = await store.loadLists();
      drawFishers([...fisherIds(), id]);
      $('#newFisher').value = '';
      rememberDay();
      toast(`${name} added to the team`);
    } catch (err) {
      toast(`Couldn't add (need signal): ${err.message}`);
    }
  });

  $('#complex').addEventListener('change', () => {
    const [b, u] = unitLabels(val('#complex'));
    $('#buildingLabel').textContent = b;
    $('#unitLabel').textContent = u;
    $('#building').value = '';
    rememberDay();
  });

  const rememberDay = () => store.write('gt.today', {
    date: today(),
    fisher_ids: fisherIds(),
    complex_id: val('#complex'),
    building: val('#building'),
  });
  $$('#complex, #building').forEach((el) => el.addEventListener('change', rememberDay));
  view.addEventListener('chipchange', (e) => {
    if (e.target.dataset.group === 'kinds') $('#fuDetails').hidden = chipValues('kinds').length === 0;
  });

  function fillPerson(p) {
    $('#personId').value = p?.id ?? '';
    $('#pname').value = p?.name ?? '';
    $('#phone').value = p?.phone ?? '';
    $('#household').value = p?.household ?? '';
    $('#prayer').value = p?.prayer_request ?? '';
    $$('#knownPeople .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === p?.id)));
  }

  // Show what we already know about this door.
  let hintTimer;
  async function lookupUnit() {
    const complex = val('#complex'), unit = val('#unit'), building = val('#building');
    const hint = $('#unitHint');
    knownPeople = [];
    $('#knownPeople').innerHTML = '';
    if (!complex || !unit || !navigator.onLine) { hint.innerHTML = ''; return; }
    try {
      let visitsQ = db().from('visits').select('visited_at, outcome, light, response')
        .eq('complex_id', complex).eq('unit', unit).order('visited_at', { ascending: false }).limit(1);
      let peopleQ = db().from('people').select('*').eq('complex_id', complex).eq('unit', unit);
      if (building) { visitsQ = visitsQ.eq('building', building); peopleQ = peopleQ.eq('building', building); }
      const [last, people] = await Promise.all([q(visitsQ), q(peopleQ)]);
      knownPeople = people;
      if ($('#personId').value && !people.some((p) => p.id === $('#personId').value)) fillPerson(null);
      const bits = [];
      if (last[0]) bits.push(`Last knocked ${fmtDate(last[0].visited_at)} — ${OUTCOMES[last[0].outcome]}${last[0].response ? ` (${RESPONSES[last[0].response]})` : ''}`);
      if (people.length) bits.push(`Known here: ${people.map((p) => `<a href="#/person/${p.id}">${esc(p.name)}</a>`).join(', ')}`);
      hint.innerHTML = bits.length ? `<div class="hint">${bits.join('<br>')}</div>` : '';
      if (people.length) {
        $('#knownPeople').innerHTML = `<p class="small muted">Talked to someone we know? Tap them:</p>
          <div class="chips" data-group="known" data-single>${people.map((p) =>
            `<button type="button" class="chip" data-value="${p.id}" aria-pressed="false">${esc(p.name)}</button>`).join('')}</div>
          <p class="small muted">…or enter a new person below.</p>`;
        const current = $('#personId').value;
        if (current) $$('#knownPeople .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === current)));
      }
    } catch { hint.innerHTML = ''; }
  }
  $$('#complex, #building, #unit').forEach((el) => el.addEventListener('input', () => {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(lookupUnit, 400);
  }));
  view.addEventListener('chipchange', (e) => {
    if (e.target.dataset.group !== 'known') return;
    const id = chipValue('known');
    fillPerson(id ? knownPeople.find((p) => p.id === id) : null);
  });

  // Keep a fresh GPS fix so each door can be shown on the map.
  let fix = null;
  if ('geolocation' in navigator) {
    const watch = navigator.geolocation.watchPosition((pos) => {
      fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy), at: Date.now() };
      $('#gps').textContent = `📍 Location on (±${fix.accuracy} m): doors will show on the map`;
    }, (err) => {
      $('#gps').textContent = err.code === 1
        ? '📍 Location is off. Allow location for this site to put doors on the map.'
        : '📍 Still looking for GPS…';
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    cleanup = () => navigator.geolocation.clearWatch(watch);
  } else {
    $('#gps').textContent = '📍 Location isn\'t available on this device.';
  }
  const coords = () => (fix && Date.now() - fix.at < 120000 ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : {});

  function baseVisit(outcome) {
    return {
      id: crypto.randomUUID(),
      visited_at: new Date().toISOString(),
      complex_id: val('#complex'),
      building: val('#building'),
      unit: val('#unit'),
      fisher_ids: fisherIds(),
      outcome,
      ...coords(),
    };
  }

  function checkWhere() {
    if (!val('#complex')) { toast('Choose the complex or neighborhood first'); $('#complex').focus(); return false; }
    if (!val('#unit')) { toast(`Enter the ${unitLabels(val('#complex'))[1].replace(' #', ' number')}`); $('#unit').focus(); return false; }
    return true;
  }

  function nextDoor() {
    $('#unit').value = '';
    $('#unitHint').innerHTML = '';
    $('#knownPeople').innerHTML = '';
    convo.hidden = true;
    $('#outcomeCard').hidden = false;
    $('#unit').focus();
  }

  $$('[data-outcome]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!checkWhere()) return;
    const outcome = btn.dataset.outcome;
    if (outcome === 'conversation') {
      $('#outcomeCard').hidden = true;
      convo.hidden = false;
      convo.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const unit = val('#unit');
    await store.saveEntry({ visit: baseVisit(outcome) });
    toast(`${unit} — ${OUTCOMES[outcome]}${navigator.onLine ? '' : ' (saved offline)'}`);
    nextDoor();
  }));

  $('#cancelConvo').addEventListener('click', () => {
    convo.hidden = true;
    $('#outcomeCard').hidden = false;
  });

  convo.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!checkWhere()) return;
    const name = val('#pname');
    if (!name) { toast('Add a name or short description'); $('#pname').focus(); return; }

    const personId = $('#personId').value || crypto.randomUUID();
    const person = {
      id: personId,
      name,
      phone: val('#phone'),
      household: val('#household'),
      prayer_request: val('#prayer'),
      complex_id: val('#complex'),
      building: val('#building'),
      unit: val('#unit'),
      updated_at: new Date().toISOString(),
    };
    const visit = {
      ...baseVisit('conversation'),
      person_id: personId,
      shared: [...chipValues('shared'), ...chipValues('trained').map((k) => TRAINED + k)],
      light: chipValue('light'),
      response: chipValue('response'),
      notes: val('#vnotes'),
    };
    const kinds = chipValues('kinds');
    const followUp = kinds.length ? {
      id: crypto.randomUUID(),
      person_id: personId,
      visit_id: visit.id,
      kinds,
      assigned_to: val('#assigned'),
      due_date: val('#due'),
      notes: val('#funotes'),
    } : null;

    $('#saveConvo').disabled = true;
    await store.saveEntry({ person, visit, followUp });
    toast(`Saved conversation with ${name}${navigator.onLine ? '' : ' (offline — will sync)'}`);
    viewLog();
  });

  if (prefill) {
    fillPerson(prefill);
    lookupUnit();
  }
}

// --- Follow-ups ---------------------------------------------------------------

async function viewFollowUps() {
  const filter = store.read('gt.fuFilter', { who: '', showDone: false });
  const rows = await q(db().from('follow_ups')
    .select('*, people(id, name, phone, complex_id, building, unit)')
    .eq('done', filter.showDone)
    .order('due_date', { ascending: !filter.showDone, nullsFirst: false })
    .limit(300));
  const shown = rows.filter((r) => !filter.who || (filter.who === 'none' ? !r.assigned_to : r.assigned_to === filter.who));

  main.innerHTML = `
    <h1>Follow-ups</h1>
    <div class="toolbar">
      <select id="who">
        <option value="">Everyone</option>
        <option value="none" ${filter.who === 'none' ? 'selected' : ''}>Unassigned</option>
        ${options(lists.team, filter.who)}
      </select>
      <select id="doneSel">
        <option value="open">Still to do</option>
        <option value="done" ${filter.showDone ? 'selected' : ''}>Completed</option>
      </select>
    </div>
    <div class="list">
      ${shown.map(followUpCard).join('') || '<p class="muted">Nothing here. 🙌</p>'}
    </div>`;

  const saveFilter = () => {
    store.write('gt.fuFilter', { who: $('#who').value, showDone: $('#doneSel').value === 'done' });
    viewFollowUps();
  };
  $('#who').addEventListener('change', saveFilter);
  $('#doneSel').addEventListener('change', saveFilter);
  bindFollowUpButtons(viewFollowUps);
}

function followUpCard(f) {
  const p = f.people ?? {};
  const overdue = !f.done && f.due_date && f.due_date < today();
  return `
    <div class="item">
      <div class="top">
        <a class="name" href="#/person/${p.id}">${esc(p.name)}</a>
        <span class="small ${overdue ? 'overdue' : 'muted'}">${f.done ? `Done ${fmtDate(f.done_at)}` : f.due_date ? `Due ${fmtDate(f.due_date + 'T12:00')}` : 'No date'}</span>
      </div>
      <div class="small muted">${esc(where(p))}${p.phone ? ` · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}</div>
      <div class="chips" style="margin-top:8px">${f.kinds.map((k) => `<span class="badge">${esc(FOLLOW_KINDS[k] ?? k)}</span>`).join('')}</div>
      ${f.notes ? `<p class="small" style="margin:8px 0 0">${esc(f.notes)}</p>` : ''}
      <div class="actions">
        <span class="small muted" style="flex:1;align-self:center">👤 ${f.assigned_to ? esc(teamName(f.assigned_to)) : 'Unassigned'}</span>
        ${f.done
          ? `<button data-undo="${f.id}">Reopen</button>`
          : `<button class="primary" data-done="${f.id}">✓ Done</button>`}
      </div>
    </div>`;
}

function bindFollowUpButtons(refresh) {
  $$('[data-done], [data-undo]').forEach((b) => b.addEventListener('click', async () => {
    const done = Boolean(b.dataset.done);
    b.disabled = true;
    try {
      await q(db().from('follow_ups')
        .update({ done, done_at: done ? new Date().toISOString() : null })
        .eq('id', b.dataset.done || b.dataset.undo));
      toast(done ? 'Marked done' : 'Reopened');
      refresh();
    } catch (err) {
      toast(`Couldn't save: ${err.message}`);
      b.disabled = false;
    }
  }));
}

// --- People -------------------------------------------------------------------

async function viewPeople() {
  const people = await q(db().from('people')
    .select('id, name, phone, complex_id, building, unit, visits(visited_at, light, response)')
    .order('name').limit(2000));
  for (const p of people) {
    p.last = (p.visits ?? []).sort((a, b) => b.visited_at.localeCompare(a.visited_at))[0];
  }

  main.innerHTML = `
    <h1>People</h1>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search name, phone, apt…">
      <select id="pcomplex">${placeOptions(null, 'All places', false)}</select>
    </div>
    <div class="list" id="plist"></div>`;

  const draw = () => {
    const term = ($('#search').value || '').toLowerCase();
    const cx = $('#pcomplex').value;
    const shown = people.filter((p) =>
      (!cx || p.complex_id === cx) &&
      (!term || [p.name, p.phone, p.unit, p.building, complexName(p.complex_id)].some((s) => (s ?? '').toLowerCase().includes(term))));
    $('#plist').innerHTML = shown.map((p) => `
      <a class="item" href="#/person/${p.id}">
        <div class="top"><span class="name">${lightDot(p.last?.light)} ${esc(p.name)}</span>${responseBadge(p.last?.response)}</div>
        <div class="small muted">${esc(where(p))}${p.last ? ` · last seen ${fmtDate(p.last.visited_at)}` : ''}</div>
      </a>`).join('') || '<p class="muted">No one yet.</p>';
  };
  $('#search').addEventListener('input', draw);
  $('#pcomplex').addEventListener('change', draw);
  draw();
}

async function viewPerson(id) {
  const [person] = await q(db().from('people').select('*').eq('id', id));
  if (!person) { main.innerHTML = '<p class="muted">Person not found.</p>'; return; }
  const [visits, followUps] = await Promise.all([
    q(db().from('visits').select('*').eq('person_id', id)),
    q(db().from('follow_ups').select('*').eq('person_id', id)),
  ]);

  const events = [
    ...visits.map((v) => ({ at: v.visited_at, html: `
      <div class="tl">
        <div class="small muted">${fmtDateTime(v.visited_at)}${v.fisher_ids.length ? ` · with ${v.fisher_ids.map(teamName).map(esc).join(', ')}` : ''}</div>
        <div><b>Conversation</b> ${lightDot(v.light)} ${responseBadge(v.response)}</div>
        ${sharedOf(v).length ? `<div class="small">Shared: ${methodList(sharedOf(v))}</div>` : ''}
        ${trainedOf(v).length ? `<div class="small">🎓 Trained on: ${methodList(trainedOf(v))}</div>` : ''}
        ${v.notes ? `<div class="small">${esc(v.notes)}</div>` : ''}
      </div>` })),
    ...followUps.map((f) => ({ at: f.done_at ?? f.created_at, html: `
      <div class="tl followup ${f.done ? 'done' : ''}">
        <div class="small muted">${fmtDate(f.done_at ?? f.created_at)} · ${f.done ? 'Follow-up done' : `Follow-up${f.due_date ? `, due ${fmtDate(f.due_date + 'T12:00')}` : ''}`}</div>
        <div><b>${f.kinds.map((k) => esc(FOLLOW_KINDS[k] ?? k)).join(', ')}</b> · ${f.assigned_to ? esc(teamName(f.assigned_to)) : 'Unassigned'}</div>
        ${f.notes ? `<div class="small">${esc(f.notes)}</div>` : ''}
        ${f.done ? '' : `<button class="link" data-done="${f.id}">Mark done</button>`}
      </div>` })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  main.innerHTML = `
    <p><a href="#/people">← People</a></p>
    <h1>${esc(person.name)}</h1>
    <p class="muted">${esc(where(person))}${person.phone ? ` · <a href="tel:${esc(person.phone)}">${esc(person.phone)}</a>` : ''}</p>

    <button class="primary big" id="logAgain">💬 Log another conversation</button>

    <section class="card" style="margin-top:14px">
      <h2>History</h2>
      <div class="timeline">${events.map((e) => e.html).join('') || '<p class="muted">No history yet.</p>'}</div>
    </section>

    <details class="card">
      <summary><b>Add a follow-up</b></summary>
      <form id="addFu">
        <label>What's needed</label>
        ${chips('newkinds', FOLLOW_KINDS)}
        <div class="row">
          <div><label for="fuwho">Who</label><select id="fuwho">${options(activeTeam(), null, 'Unassigned')}</select></div>
          <div><label for="fudue">By when</label><input id="fudue" type="date" value="${addDays(7)}"></div>
        </div>
        <label for="funote">Notes</label><textarea id="funote"></textarea>
        <button class="primary big" style="margin-top:12px">Add follow-up</button>
      </form>
    </details>

    <details class="card">
      <summary><b>Edit details</b></summary>
      <form id="editPerson">
        <label for="ename">Name</label><input id="ename" value="${esc(person.name)}" required>
        <label for="ephone">Phone</label><input id="ephone" type="tel" value="${esc(person.phone)}">
        <label for="ecomplex">Where</label><select id="ecomplex">${placeOptions(person.complex_id, '—', false)}</select>
        <div class="row">
          <div><label for="ebuilding">${unitLabels(person.complex_id)[0]}</label><input id="ebuilding" value="${esc(person.building)}"></div>
          <div><label for="eunit">${unitLabels(person.complex_id)[1]}</label><input id="eunit" value="${esc(person.unit)}"></div>
        </div>
        <label for="ehousehold">Household / family</label><input id="ehousehold" value="${esc(person.household)}">
        <label for="eprayer">Prayer request</label><textarea id="eprayer">${esc(person.prayer_request)}</textarea>
        <label for="enotes">Other notes</label><textarea id="enotes">${esc(person.notes)}</textarea>
        <button class="primary big" style="margin-top:12px">Save changes</button>
      </form>
      <button type="button" class="danger big" id="deletePerson" style="margin-top:18px">🗑 Delete ${esc(person.name)}</button>
      <p class="small muted">Removes their details, prayer request, follow-ups and conversation notes. Their door knocks stay on the map and in the stats, without their name.</p>
    </details>

    ${person.prayer_request ? `<section class="card"><h2>🙏 Prayer request</h2><p style="margin:0">${esc(person.prayer_request)}</p></section>` : ''}
    ${person.household ? `<section class="card"><h2>Household</h2><p style="margin:0">${esc(person.household)}</p></section>` : ''}`;

  bindFollowUpButtons(() => viewPerson(id));

  $('#logAgain').addEventListener('click', () => {
    personForLog = person;
    location.hash = '#/log';
  });

  $('#addFu').addEventListener('submit', async (e) => {
    e.preventDefault();
    const kinds = chipValues('newkinds');
    if (!kinds.length) { toast('Pick what kind of follow-up'); return; }
    try {
      await q(db().from('follow_ups').insert({
        person_id: id, kinds, assigned_to: val('#fuwho'), due_date: val('#fudue'), notes: val('#funote'),
      }));
      toast('Follow-up added');
      viewPerson(id);
    } catch (err) { toast(`Couldn't save: ${err.message}`); }
  });

  $('#deletePerson').addEventListener('click', async () => {
    if (!confirm(`Delete ${person.name}? This can't be undone.`)) return;
    try {
      await q(db().from('visits').update({ notes: null }).eq('person_id', id));
      await q(db().from('people').delete().eq('id', id));
      toast(`${person.name} deleted`);
      location.hash = '#/people';
    } catch (err) { toast(`Couldn't delete: ${err.message}`); }
  });

  $('#editPerson').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await q(db().from('people').update({
        name: val('#ename'), phone: val('#ephone'), complex_id: val('#ecomplex'),
        building: val('#ebuilding'), unit: val('#eunit'), household: val('#ehousehold'),
        prayer_request: val('#eprayer'), notes: val('#enotes'), updated_at: new Date().toISOString(),
      }).eq('id', id));
      toast('Saved');
      viewPerson(id);
    } catch (err) { toast(`Couldn't save: ${err.message}`); }
  });
}

// --- Door map -----------------------------------------------------------------

async function viewDoors() {
  const complexId = store.read('gt.doorsComplex', null) ?? store.read('gt.today', {}).complex_id ?? activeComplexes()[0]?.id;
  main.innerHTML = `
    <div class="viewtabs"><a href="#/map">Map</a><a href="#/doors" class="active">Door grid</a></div>
    <div class="toolbar"><select id="dcomplex">${placeOptions(complexId, 'Choose a complex or neighborhood…', false)}</select></div>
    <div id="doors"></div>`;
  $('#dcomplex').addEventListener('change', (e) => { store.write('gt.doorsComplex', e.target.value); viewDoors(); });
  if (!complexId) return;

  const visits = await q(db().from('visits')
    .select('building, unit, outcome, light, visited_at')
    .eq('complex_id', complexId).order('visited_at', { ascending: false }).limit(5000));

  // Latest visit per door, grouped by building.
  const doors = new Map();
  for (const v of visits) {
    const key = `${v.building ?? ''}|${v.unit ?? ''}`;
    if (!doors.has(key)) doors.set(key, { ...v, count: 0 });
    doors.get(key).count++;
  }
  const buildings = new Map();
  for (const d of doors.values()) {
    const b = d.building || '—';
    if (!buildings.has(b)) buildings.set(b, []);
    buildings.get(b).push(d);
  }
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const talked = [...doors.values()].filter((d) => d.outcome === 'conversation').length;

  $('#doors').innerHTML = !doors.size ? '<p class="muted">No doors logged here yet.</p>' : `
    <div class="kpis">
      <div class="kpi"><div class="v">${doors.size}</div><div class="l">Doors knocked</div></div>
      <div class="kpi"><div class="v">${talked}</div><div class="l">Doors with a conversation</div></div>
    </div>
    <div class="legend">
      <span><span class="dot green"></span>Green</span>
      <span><span class="dot yellow"></span>Yellow</span>
      <span><span class="dot red"></span>Red</span>
      <span><span class="dot believer"></span>Believer</span>
      <span><span class="swatch"></span>No answer</span>
      <span><span class="swatch" style="border:2px solid var(--red)"></span>Not interested</span>
      <span><span class="swatch" style="border:2px dashed var(--blue)"></span>Come back</span>
    </div>
    <p class="small muted">Colors show the most recent knock. Tap a door for details.</p>
    ${[...buildings.keys()].sort(natural).map((b) => `
      <section class="card">
        <h2>${isHouses(complexId) ? esc(b) : `Building ${esc(b)}`}</h2>
        <div class="units">
          ${buildings.get(b).sort((x, y) => natural(x.unit, y.unit)).map((d) => `
            <button type="button" class="unit ${d.outcome} ${d.outcome === 'conversation' ? d.light ?? 'none' : ''}"
              data-info="${esc(`#${d.unit} — ${OUTCOMES[d.outcome]} on ${fmtDate(d.visited_at)} (${d.count} knock${d.count > 1 ? 's' : ''})`)}">
              <b>${esc(d.unit)}</b>${new Date(d.visited_at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
            </button>`).join('')}
        </div>
      </section>`).join('')}`;
  $$('[data-info]').forEach((b) => b.addEventListener('click', () => toast(b.dataset.info)));
}

// --- Map ----------------------------------------------------------------------

async function loadLeaflet() {
  if (window.L?.markerClusterGroup) return;
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/';
  const css = (href) => new Promise((res) => {
    const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href, onload: res, onerror: res });
    document.head.append(l);
  });
  const js = (src) => new Promise((res, rej) => {
    const el = Object.assign(document.createElement('script'), { src, onload: res });
    el.onerror = () => rej(new Error('Couldn\'t load the map. Check your signal and try again.'));
    document.head.append(el);
  });
  await Promise.all([css(`${base}leaflet/1.9.4/leaflet.min.css`), css(`${base}leaflet.markercluster/1.5.3/MarkerCluster.min.css`)]);
  if (!window.L) await js(`${base}leaflet/1.9.4/leaflet.min.js`);
  await js(`${base}leaflet.markercluster/1.5.3/leaflet.markercluster.min.js`);
}

async function viewMap() {
  leave();
  const f = { days: 30, show: 'all', place: '', ...store.read('gt.mapFilter', {}) };
  const rangeLabel = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', 365: 'Last 12 months', 0: 'All time' };
  const showLabel = { all: 'All doors', conversation: 'Conversations only', accepted: 'Accepted Christ', followup: 'Open follow-ups', unreached: 'No answer / come back' };

  main.innerHTML = `
    <div class="viewtabs"><a href="#/map" class="active">Map</a><a href="#/doors">Door grid</a></div>
    <div class="toolbar">
      <select id="mDays">${Object.entries(rangeLabel).map(([d, l]) => `<option value="${d}" ${+d === f.days ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="mShow">${Object.entries(showLabel).map(([k, l]) => `<option value="${k}" ${k === f.show ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="mPlace">${placeOptions(f.place, 'All places', false)}</select>
    </div>
    <div id="mapSummary" class="map-summary"></div>
    <div id="map" class="map"></div>
    <div class="legend" style="margin-top:10px">
      <span><span class="pin green"></span>Green</span>
      <span><span class="pin yellow"></span>Yellow</span>
      <span><span class="pin red"></span>Red</span>
      <span><span class="pin believer"></span>Believer</span>
      <span><span class="pin none"></span>Talked, no light</span>
      <span><span class="pin green accepted">✝</span>Accepted Christ</span>
      <span><span class="pin green fu"></span>Open follow-up</span>
      <span><span class="pin no_answer"></span>No answer</span>
      <span><span class="pin come_back"></span>Come back</span>
      <span><span class="pin not_interested"></span>Not interested</span>
    </div>
    <p class="small muted" id="mapNote"></p>`;

  const saveFilter = () => {
    store.write('gt.mapFilter', { days: +$('#mDays').value, show: $('#mShow').value, place: $('#mPlace').value });
    viewMap();
  };
  $$('#mDays, #mShow, #mPlace').forEach((el) => el.addEventListener('change', saveFilter));

  const since = f.days ? new Date(Date.now() - f.days * 864e5).toISOString() : '1970-01-01';
  let visitsQ = db().from('visits')
    .select('id, visited_at, complex_id, building, unit, outcome, light, response, shared, fisher_ids, person_id, notes, lat, lng, people(name)')
    .gte('visited_at', since).order('visited_at', { ascending: false }).limit(10000);
  if (f.place) visitsQ = visitsQ.eq('complex_id', f.place);
  const [visits, openFu] = await Promise.all([
    q(visitsQ),
    q(db().from('follow_ups').select('person_id, kinds, due_date, assigned_to').eq('done', false)),
    loadLeaflet(),
  ]);
  if (!document.contains($('#map'))) return; // user moved on while loading

  const fuByPerson = new Map();
  for (const fu of openFu) if (!fuByPerson.has(fu.person_id)) fuByPerson.set(fu.person_id, fu);

  // One pin per door: color from the latest conversation, else the latest knock.
  const doors = new Map();
  for (const v of visits) {
    const key = `${v.complex_id}|${v.building ?? ''}|${v.unit ?? ''}`;
    if (!doors.has(key)) doors.set(key, { latest: v, knocks: 0, convo: null, accepted: false, pos: null });
    const d = doors.get(key);
    d.knocks++;
    if (v.outcome === 'conversation' && !d.convo) d.convo = v;
    if (v.response === 'accepted') d.accepted = true;
    if (!d.pos && v.lat != null && v.lng != null) d.pos = [v.lat, v.lng];
  }
  const all = [...doors.values()];
  for (const d of all) d.fu = d.convo?.person_id ? fuByPerson.get(d.convo.person_id) : null;
  const keep = {
    all: () => true,
    conversation: (d) => d.convo,
    accepted: (d) => d.accepted,
    followup: (d) => d.fu,
    unreached: (d) => !d.convo && ['no_answer', 'come_back'].includes(d.latest.outcome),
  }[f.show] ?? (() => true);
  const shown = all.filter(keep);
  const placed = shown.filter((d) => d.pos);

  const n = (fn) => shown.filter(fn).length;
  $('#mapSummary').innerHTML = `
    <span><b>${shown.length}</b> doors</span>
    <span><b>${n((d) => d.convo)}</b> conversations</span>
    <span><span class="dot green"></span><b>${n((d) => d.convo?.light === 'green')}</b></span>
    <span><span class="dot yellow"></span><b>${n((d) => d.convo?.light === 'yellow')}</b></span>
    <span><span class="dot red"></span><b>${n((d) => d.convo?.light === 'red')}</b></span>
    <span><span class="dot believer"></span><b>${n((d) => d.convo?.light === 'believer')}</b> believers</span>
    <span>✝ <b>${n((d) => d.accepted)}</b> accepted</span>
    <span><b>${n((d) => d.fu)}</b> follow-ups open</span>`;
  const missing = shown.length - placed.length;
  $('#mapNote').textContent = missing
    ? `${missing} door${missing > 1 ? 's' : ''} in this view ${missing > 1 ? 'have' : 'has'} no location (logged with location off), so ${missing > 1 ? 'they aren\'t' : 'it isn\'t'} on the map.`
    : '';

  const map = L.map('map', { zoomControl: true });
  cleanup = () => map.remove();
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const clusters = L.markerClusterGroup({
    maxClusterRadius: 35,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => {
      const kids = c.getAllChildMarkers();
      const saved = kids.filter((m) => m.options.accepted).length;
      return L.divIcon({
        className: 'cluster',
        html: `<span>${c.getChildCount()}${saved ? `<small>✝${saved}</small>` : ''}</span>`,
        iconSize: [38, 38],
      });
    },
  });

  for (const d of placed) {
    const talked = Boolean(d.convo);
    const cls = talked
      ? `pin ${d.convo.light ?? 'none'}${d.accepted ? ' accepted' : ''}${d.fu ? ' fu' : ''}`
      : `pin ${d.latest.outcome}`;
    const size = d.accepted ? 26 : talked ? 20 : 14;
    const icon = L.divIcon({ className: '', html: `<span class="${cls}">${d.accepted ? '✝' : ''}</span>`, iconSize: [size, size] });
    const c = d.convo;
    const popup = `
      <div class="popup">
        <b>${esc(where(d.latest))}</b>
        <div class="small">Last knock ${fmtDate(d.latest.visited_at)}: ${esc(OUTCOMES[d.latest.outcome])}${d.knocks > 1 ? ` (${d.knocks} knocks)` : ''}</div>
        ${c ? `
          <hr>
          <div>${c.people?.name ? `<a href="#/person/${c.person_id}">${esc(c.people.name)}</a>` : 'Conversation'} ${lightDot(c.light)} ${responseBadge(c.response)}</div>
          ${sharedOf(c).length ? `<div class="small">Shared: ${methodList(sharedOf(c))}</div>` : ''}
          ${trainedOf(c).length ? `<div class="small">🎓 Trained on: ${methodList(trainedOf(c))}</div>` : ''}
          ${c.fisher_ids.length ? `<div class="small">With: ${c.fisher_ids.map(teamName).map(esc).join(', ')}</div>` : ''}
          ${c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''}` : ''}
        ${d.fu ? `<div class="small fu-note">⚑ Follow-up: ${d.fu.kinds.map((k) => esc(FOLLOW_KINDS[k] ?? k)).join(', ')}${d.fu.due_date ? `, due ${fmtDate(d.fu.due_date + 'T12:00')}` : ''}${d.fu.assigned_to ? ` · ${esc(teamName(d.fu.assigned_to))}` : ''}</div>` : ''}
      </div>`;
    clusters.addLayer(L.marker(d.pos, { icon, accepted: d.accepted, zIndexOffset: talked ? 500 : 0 }).bindPopup(popup, { autoPanPaddingTopLeft: [56, 16], autoPanPaddingBottomRight: [56, 16] }));
  }
  map.addLayer(clusters);

  // Find-me button.
  const me = L.control({ position: 'topright' });
  me.onAdd = () => {
    const b = L.DomUtil.create('button', 'map-me');
    b.type = 'button';
    b.title = 'Show where I am';
    b.textContent = '◎';
    L.DomEvent.on(b, 'click', (e) => { L.DomEvent.stop(e); map.locate({ setView: true, maxZoom: 18 }); });
    return b;
  };
  me.addTo(map);
  let meDot = null;
  map.on('locationfound', (e) => {
    meDot?.remove();
    meDot = L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 3, fillColor: '#2f7fb5', fillOpacity: 1 }).addTo(map);
  });
  map.on('locationerror', () => toast('Couldn\'t get your location'));

  if (placed.length) {
    map.fitBounds(L.latLngBounds(placed.map((d) => d.pos)).pad(0.15), { maxZoom: 18 });
  } else {
    map.setView([30.2672, -97.7431], 11); // Austin until there's data
    if (!shown.length) $('#mapNote').textContent = 'No doors with a location yet. They\'ll appear here as the team logs doors with location turned on.';
  }
}

// --- Stats --------------------------------------------------------------------

async function viewStats() {
  const days = store.read('gt.statsDays', 30);
  const since = days ? new Date(Date.now() - days * 864e5).toISOString() : '1970-01-01';
  const [visits, openFu] = await Promise.all([
    q(db().from('visits').select('visited_at, outcome, shared, light, response, complex_id, fisher_ids')
      .gte('visited_at', since).limit(20000)),
    q(db().from('follow_ups').select('id, due_date').eq('done', false)),
  ]);
  const convos = visits.filter((v) => v.outcome === 'conversation');
  const count = (arr, fn) => arr.filter(fn).length;
  const gospel = count(convos, (v) => v.shared.includes('three_circles') || v.shared.includes('jesus_story'));
  const accepted = count(convos, (v) => v.response === 'accepted');
  const interested = count(convos, (v) => v.response === 'interested');
  const overdue = count(openFu, (f) => f.due_date && f.due_date < today());

  const tally = (keys, fn) => keys.map((k) => [k, fn(k)]);
  const byMethod = tally(Object.keys(METHODS), (k) => count(convos, (v) => v.shared.includes(k)));
  const byTrained = tally(Object.keys(METHODS), (k) => count(convos, (v) => v.shared.includes(TRAINED + k)));
  const trained = count(convos, (v) => trainedOf(v).length > 0);
  const byLight = tally(Object.keys(LIGHTS), (k) => count(convos, (v) => v.light === k));
  const byResponse = tally(Object.keys(RESPONSES), (k) => count(convos, (v) => v.response === k));
  const byComplex = lists.complexes.map((c) => [c.id, count(convos, (v) => v.complex_id === c.id)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const byFisher = lists.team.map((t) => [t.id, count(convos, (v) => v.fisher_ids.includes(t.id))]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);

  const bars = (rows, label, color = () => '') => {
    const max = Math.max(1, ...rows.map(([, n]) => n));
    return `<div class="bars">${rows.map(([k, n]) => `
      <div class="bar" title="${esc(label(k).replace(/<[^>]+>/g, '').trim())}: ${n}">
        <span class="label">${label(k)}</span>
        <span class="track"><span class="fill ${color(k)}" style="display:block;width:${(n / max) * 100}%"></span></span>
        <span class="num">${n}</span>
      </div>`).join('') || '<p class="muted small">No data yet.</p>'}</div>`;
  };

  const rangeLabel = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', 365: 'Last 12 months', 0: 'All time' };
  main.innerHTML = `
    <h1>Stats</h1>
    <div class="toolbar">
      <select id="range">${Object.entries(rangeLabel).map(([d, l]) => `<option value="${d}" ${+d === days ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button id="copyReport">📋 Copy report</button>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="v">${visits.length}</div><div class="l">Doors knocked</div></div>
      <div class="kpi"><div class="v">${convos.length}</div><div class="l">Conversations</div></div>
      <div class="kpi"><div class="v">${gospel}</div><div class="l">Gospel shared (3 Circles / Jesus Story)</div></div>
      <div class="kpi"><div class="v">${trained}</div><div class="l">People trained</div></div>
      <div class="kpi"><div class="v">${accepted}</div><div class="l">Accepted Christ</div></div>
      <div class="kpi"><div class="v">${interested}</div><div class="l">Interested</div></div>
      <div class="kpi"><div class="v">${openFu.length}</div><div class="l">Open follow-ups${overdue ? ` <span class="overdue">(${overdue} overdue)</span>` : ''}</div></div>
    </div>
    <section class="card"><h2>What was shared</h2>${bars(byMethod, (k) => esc(METHODS[k]))}</section>
    <section class="card"><h2>What people were trained on</h2>${bars(byTrained, (k) => esc(METHODS[k]))}</section>
    <section class="card"><h2>Light</h2>${bars(byLight, (k) => `${lightDot(k)} ${esc(LIGHTS[k])}`, (k) => k)}</section>
    <section class="card"><h2>Response</h2>${bars(byResponse, (k) => esc(RESPONSES[k]))}</section>
    <section class="card"><h2>Conversations by place</h2>${bars(byComplex, (k) => esc(complexName(k)))}</section>
    <section class="card"><h2>Conversations by team member</h2>${bars(byFisher, (k) => esc(teamName(k)))}</section>`;

  $('#range').addEventListener('change', (e) => { store.write('gt.statsDays', +e.target.value); viewStats(); });
  $('#copyReport').addEventListener('click', async () => {
    const lines = [
      `Gospel conversations — ${rangeLabel[days]}`,
      `Doors knocked: ${visits.length}`,
      `Conversations: ${convos.length}`,
      `Gospel shared: ${gospel}`,
      `People trained: ${trained}`,
      `Trained on: ${byTrained.map(([k, n]) => `${METHODS[k]} ${n}`).join(', ')}`,
      `Accepted Christ: ${accepted}`,
      `Interested: ${interested}`,
      `Lights: ${byLight.map(([k, n]) => `${k} ${n}`).join(', ')}`,
      `Shared: ${byMethod.map(([k, n]) => `${METHODS[k]} ${n}`).join(', ')}`,
      `Open follow-ups: ${openFu.length}${overdue ? ` (${overdue} overdue)` : ''}`,
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Report copied'); }
    catch { toast('Couldn\'t copy on this device'); }
  });
}

// --- Settings -----------------------------------------------------------------

async function viewSettings() {
  lists = await store.loadLists();
  const pending = store.queue();
  const listHtml = (table, rows, extra = () => '') => `
    <div class="settings-list">
      ${rows.map((r) => `
        <div class="entry ${r.active ? '' : 'inactive'}">
          <span class="n">${esc(r.name)}${extra(r)}</span>
          <button class="link" data-toggle="${table}:${r.id}:${r.active}">${r.active ? 'Hide' : 'Restore'}</button>
        </div>`).join('') || '<p class="muted small">None yet.</p>'}
    </div>`;

  main.innerHTML = `
    <h1>Settings</h1>
    <section class="card">
      <h2>Team members</h2>
      ${listHtml('team_members', lists.team)}
      <form class="inline" id="addTeam"><input id="teamName" placeholder="Name" required><button class="primary">Add</button></form>
    </section>

    <section class="card">
      <h2>Places (complexes & neighborhoods)</h2>
      ${listHtml('complexes', lists.complexes, (c) => `<br><span class="small muted">${esc(PLACE_KINDS[c.kind ?? 'apartments'])}${c.address ? ` · ${esc(c.address)}` : ''}</span>`)}
      <form id="addComplex">
        <select id="cxKind">${Object.entries(PLACE_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <input id="cxName" placeholder="Name, e.g. Oak Creek Apartments or Brentwood" required style="margin-top:8px">
        <div class="inline" style="margin-top:8px"><input id="cxAddr" placeholder="Address (optional)"><button class="primary">Add</button></div>
      </form>
      <p class="small muted">Hidden items stay in old records and stats but no longer appear in pick lists.</p>
    </section>

    <section class="card">
      <h2>Sync</h2>
      <p>${pending.length ? `${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} waiting to sync.` : 'Everything is synced. ✓'}</p>
      ${store.syncError() ? `<p class="overdue small">Last error: ${esc(store.syncError())}</p>` : ''}
      <div class="inline">
        <button id="syncNow" ${pending.length ? '' : 'disabled'}>Sync now</button>
        ${store.syncError() ? '<button id="discard">Discard stuck entry</button>' : ''}
      </div>
    </section>

    <section class="card">
      <h2>Team passcode</h2>
      <form id="changeCode">
        <label for="newCode">New passcode (8+ characters)</label>
        <input id="newCode" type="password" autocomplete="new-password" minlength="8" required>
        <p class="small muted">Everyone else will need the new passcode next time they open the app.</p>
        <button class="primary">Change passcode</button>
      </form>
      <hr style="border:none;border-top:1px solid var(--line);margin:16px 0">
      <button id="lock">🔒 Lock this phone</button>
    </section>`;

  const refresh = async () => { lists = await store.loadLists(); viewSettings(); };
  const run = async (fn, msg) => {
    try { await fn(); toast(msg); refresh(); }
    catch (err) { toast(`Couldn't save: ${err.message}`); }
  };

  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const [table, id, active] = b.dataset.toggle.split(':');
    run(() => q(db().from(table).update({ active: active !== 'true' }).eq('id', id)), 'Updated');
  }));
  $('#addTeam').addEventListener('submit', (e) => {
    e.preventDefault();
    run(() => q(db().from('team_members').insert({ name: val('#teamName') })), 'Team member added');
  });
  $('#addComplex').addEventListener('submit', (e) => {
    e.preventDefault();
    run(() => q(db().from('complexes').insert({ name: val('#cxName'), address: val('#cxAddr'), kind: $('#cxKind').value })), 'Place added');
  });
  $('#syncNow').addEventListener('click', async () => { await store.flush(); viewSettings(); });
  $('#discard')?.addEventListener('click', () => {
    if (confirm('Throw away the entry that won\'t sync? This can\'t be undone.')) { store.discardFirst(); viewSettings(); }
  });
  $('#changeCode').addEventListener('submit', (e) => {
    e.preventDefault();
    run(() => store.changeCode($('#newCode').value), 'Passcode changed');
  });
  $('#lock').addEventListener('click', () => {
    if (store.queue().length && !confirm('Some entries haven\'t synced yet and will be lost. Lock anyway?')) return;
    try { localStorage.clear(); } catch {}
    store.forgetCode();
    render();
  });
}

// --- Start --------------------------------------------------------------------

async function start() {
  store.onQueueChange(updateSyncBadge);
  updateSyncBadge(store.queue().length, null);
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => store.flush());

  if (store.getCode()) {
    if (navigator.onLine) {
      try {
        if (!(await store.checkCode())) {
          store.forgetCode();
          loginMessage = 'The team passcode was changed. Enter the new one.';
        }
      } catch {}
    }
    if (store.getCode()) {
      try { lists = await store.loadLists(); } catch {}
      store.flush();
    }
  }
  render();
}

start();
