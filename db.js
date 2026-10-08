// Data layer: Supabase client, cached pick lists, and the offline save queue.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const CODE_KEY = 'gt.teamCode';
const ADMIN_KEY = 'gt.adminCode';
const ADMIN_STATE_KEY = 'gt.adminState';
const VERSION_KEY = 'gt.dbVersion';
const ME_KEY = 'gt.me';
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

function makeClient(code, adminCode = read(ADMIN_KEY, null)) {
  const headers = { 'x-team-code': code };
  if (adminCode) headers['x-admin-code'] = adminCode;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
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

// --- Admin --------------------------------------------------------------------
// 'yes'    this phone has entered the admin passcode
// 'no'     it hasn't
// 'legacy' the database hasn't had the groups/admin update yet, so nothing is locked

export const adminState = () => read(ADMIN_STATE_KEY, 'no');
export const isAdmin = () => adminState() !== 'no';
export const adminIsPlaceholder = () => read(ADMIN_KEY, null) === 'CHANGE-ME-admin-passcode';

const missing = (err) => ['PGRST202', 'PGRST205', '42883', '42P01'].includes(err?.code);

export async function refreshAdmin() {
  let state;
  try {
    state = (await q(db().rpc('has_admin_code'))) ? 'yes' : 'no';
  } catch (err) {
    if (!missing(err)) throw err;
    state = 'legacy';
  }
  if (state === 'no' && read(ADMIN_KEY, null)) forgetAdmin(); // admin passcode was changed
  write(ADMIN_STATE_KEY, state);

  // Which database update has been run: 0 none, 1 groups + admin, 2 sign-up + groups on places.
  let version = state === 'legacy' ? 0 : 1;
  if (version) {
    try { version = await q(db().rpc('app_version')); } catch (err) { if (!missing(err)) throw err; }
  }
  write(VERSION_KEY, version);
  return state;
}

export const dbVersion = () => read(VERSION_KEY, 0);

// --- Who is using this phone --------------------------------------------------
// Each person signs up or signs in once per phone with their own 6-digit passcode.

export const me = () => read(ME_KEY, null);

export function forgetMe() {
  try { localStorage.removeItem(ME_KEY); } catch {}
}

export async function signUp(name, pin, groupIds) {
  const id = await q(db().rpc('sign_up', { p_name: name, p_pin: pin, p_groups: groupIds }));
  write(ME_KEY, id);
  return id;
}

export async function signIn(name, pin) {
  const id = await q(db().rpc('sign_in', { p_name: name, p_pin: pin }));
  write(ME_KEY, id);
  return id;
}

export const resetPin = (memberId) => q(db().rpc('reset_pin', { p_member: memberId }));

export async function tryAdmin(adminCode) {
  const candidate = makeClient(getCode(), adminCode);
  const ok = await q(candidate.rpc('has_admin_code'));
  if (ok) {
    write(ADMIN_KEY, adminCode);
    write(ADMIN_STATE_KEY, 'yes');
    client = candidate;
  }
  return ok;
}

export function forgetAdmin() {
  try { localStorage.removeItem(ADMIN_KEY); } catch {}
  write(ADMIN_STATE_KEY, 'no');
  client = null;
}

export async function changeAdminCode(newCode) {
  await q(db().rpc('change_admin_code', { new_code: newCode }));
  write(ADMIN_KEY, newCode);
  client = null;
}

export async function changeCode(newCode) {
  await q(db().rpc('change_team_code', { new_code: newCode }));
  write(CODE_KEY, newCode);
  client = makeClient(newCode);
}

// --- Team members, groups & complexes (cached for offline use) ----------------

export async function loadLists() {
  try {
    const [team, complexes, groups] = await Promise.all([
      q(db().from('team_members').select('*').order('name')),
      q(db().from('complexes').select('*').order('name')),
      // No groups table until the groups/admin database update has been run.
      q(db().from('groups').select('*').order('name')).catch((err) => { if (missing(err)) return []; throw err; }),
    ]);
    const lists = { team, complexes, groups };
    write(LISTS_KEY, lists);
    return lists;
  } catch (err) {
    const cached = read(LISTS_KEY, null);
    if (cached) return { groups: [], ...cached };
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
