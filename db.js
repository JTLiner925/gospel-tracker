// Data layer: Supabase client, cached pick lists, and the offline save queue.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const CODE_KEY = 'gt.teamCode';
const LISTS_KEY = 'gt.lists';
const QUEUE_KEY = 'gt.queue';

export function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// --- Passcode & client --------------------------------------------------------

let client = null;

function makeClient(code) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-team-code': code } },
  });
}

export const getCode = () => read(CODE_KEY, null);

export function forgetCode() {
  try { localStorage.removeItem(CODE_KEY); } catch {}
  client = null;
}

export function db() {
  if (!client && getCode()) client = makeClient(getCode());
  return client;
}

// Returns the rows, or throws the Supabase error.
export async function q(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

export async function tryCode(code) {
  const candidate = makeClient(code);
  const ok = await q(candidate.rpc('has_team_code'));
  if (ok) {
    write(CODE_KEY, code);
    client = candidate;
  }
  return ok;
}

export const checkCode = () => q(db().rpc('has_team_code'));

export async function changeCode(newCode) {
  await q(db().rpc('change_team_code', { new_code: newCode }));
  write(CODE_KEY, newCode);
  client = makeClient(newCode);
}

// --- Team members & complexes (cached for offline use) -----------------------

export async function loadLists() {
  try {
    const [team, complexes] = await Promise.all([
      q(db().from('team_members').select('*').order('name')),
      q(db().from('complexes').select('*').order('name')),
    ]);
    const lists = { team, complexes };
    write(LISTS_KEY, lists);
    return lists;
  } catch (err) {
    const cached = read(LISTS_KEY, null);
    if (cached) return cached;
    throw err;
  }
}

// --- Offline queue ------------------------------------------------------------
// Each entry is { person?, visit, followUp? } with client-made ids, so saving twice is harmless.

const listeners = new Set();
let lastError = null;
let flushing = null;

export const queue = () => read(QUEUE_KEY, []);
export const syncError = () => lastError;
export const onQueueChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn(queue().length, lastError));

export async function saveEntry(entry) {
  write(QUEUE_KEY, [...queue(), entry]);
  notify();
  await flush();
}

export function flush() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush() {
  if (!db()) return;
  while (queue().length) {
    const entry = queue()[0];
    try {
      if (entry.person) await q(db().from('people').upsert(entry.person));
      await q(db().from('visits').upsert(entry.visit));
      if (entry.followUp) await q(db().from('follow_ups').upsert(entry.followUp));
    } catch (err) {
      lastError = err.message || String(err);
      notify();
      return;
    }
    lastError = null;
    write(QUEUE_KEY, queue().slice(1));
    notify();
  }
}

// Drops the first queued entry when it keeps failing (shown in Settings).
export function discardFirst() {
  write(QUEUE_KEY, queue().slice(1));
  lastError = null;
  notify();
}
