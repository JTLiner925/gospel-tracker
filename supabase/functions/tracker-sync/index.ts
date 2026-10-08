// Gospel Tracker <-> Notion sync.
// Copies the app's data into the GOSPEL TRACKER hub in Notion, and applies what is edited in
// Notion (passcodes, groups, team, places, people, follow-ups) back to the app.
//
// Runs every few minutes from a database schedule, and on demand from the app's Settings.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   NOTION_TOKEN   the Internal Integration Secret (the same one the other apps use)
// Supabase supplies SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY by itself.
//
// Written as plain JavaScript (no type annotations) so the same file can be tested in a browser.

const env = (k) => (globalThis.Deno ? Deno.env.get(k) : globalThis.__ENV?.[k]) ?? "";

const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const TOKEN = env("NOTION_TOKEN");
const SB_URL = env("SUPABASE_URL");
const SB_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SB_ANON = env("SUPABASE_ANON_KEY");
const TZ = "America/Chicago";

// Database IDs under the GOSPEL TRACKER page. Not secret.
const DB = {
  groups: "fd366fa1f70241c0bf26f83295607558",
  team: "365e0bf8320f4b3590e477e83dcf0727",
  places: "5e2ccc643088445e9755c065a8a0b1c5",
  people: "739c2c352746434fa42d3e9d37bbe68c",
  visits: "3fd1353c48494aaf80092c8ad9d30174",
  followups: "491faa4aa9e54d10be63dff3383ef498",
  passcodes: "5c0a0ee874d94bd888b303628101378b",
};

// Stop starting new work after this long, so one run always finishes inside the time limit.
// Whatever is left is picked up by the next run.
const RUN_MS = Number(env("SYNC_RUN_MS")) || 100000;
const LOCK_MS = 4 * 60 * 1000;
const VISIT_BATCH = 300;

const APP_ORIGIN = "https://jtliner925.github.io";
const cors = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "content-type, x-team-code, x-admin-code, x-sync-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dash = (id) => String(id ?? "").replace(/-/g, "");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const localDate = (iso) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso)) : "");
const stamp = () =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date());

// ---------- Notion ----------

async function notion(path, method = "GET", body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(NOTION + path, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * Number(res.headers.get("Retry-After") || attempt + 1));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Notion error", res.status, path, JSON.stringify(data));
      const hint = res.status === 404
        ? " Notion can't see this database. Connect the integration to the GOSPEL TRACKER page."
        : res.status === 401 ? " The NOTION_TOKEN secret is missing or wrong." : "";
      throw new HttpError(502, `Notion: ${data?.message ?? res.status}.${hint}`);
    }
    return data;
  }
}

async function queryAll(db) {
  const out = [];
  let cursor;
  do {
    const page = await notion(`/databases/${db}/query`, "POST", {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...page.results.filter((p) => !p.archived && !p.in_trash));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

// Long text is split into pieces because Notion caps each piece at 2,000 characters.
function rich(s) {
  s = String(s ?? "");
  const out = [];
  for (let i = 0; i < s.length && out.length < 100; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}
const plain = (rt) => (rt ?? []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");

// ---------- Supabase (service role: full access, never leaves the server) ----------

async function sb(path, method = "GET", body, extra = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("Supabase error", res.status, path, text);
    let message = text;
    try { message = JSON.parse(text).message ?? text; } catch { /* keep the raw text */ }
    throw new HttpError(502, `Database: ${message}. Has the Notion sync database update been run?`);
  }
  return text ? JSON.parse(text) : null;
}

// The API returns at most 1,000 rows at a time.
async function sbAll(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await sb(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const rpc = (fn, args = {}) => sb(`rpc/${fn}`, "POST", args);

const saveSync = (kind, app_id, page_id, snapshot) =>
  sb("notion_sync", "POST", { kind, app_id, page_id, snapshot }, { Prefer: "resolution=merge-duplicates" });

// ---------- Field definitions ----------
// Every record is turned into the same plain shape (text as "", lists sorted, links as app ids)
// whether it came from the app or from Notion, so the two can be compared field by field.
//
// mode "both": edits on either side are carried over.  mode "app": the app is the only source.

const LIGHTS = { green: "Green", yellow: "Yellow", red: "Red", believer: "Believer" };
const RESPONSES = { accepted: "Accepted Christ", interested: "Interested", rejected: "Rejected" };
const OUTCOMES = {
  conversation: "Conversation",
  no_answer: "No answer",
  not_interested: "Not interested",
  come_back: "Come back later",
  skip: "Vacant / skip",
};
const METHODS = {
  prayer: "Care through prayer",
  testimony: "15-second testimony",
  three_circles: "3 Circles",
  jesus_story: "Jesus Story",
  dbs: "Discovery Bible Study",
};
const FOLLOW_KINDS = {
  visit: "Return visit",
  prayer: "Keep praying",
  gospel: "Share gospel again",
  dbs: "Start a DBS",
  church: "Invite to church / gathering",
  baptism: "Baptism",
  bible: "Give a Bible",
  need: "Meet a practical need",
};
const PLACE_KINDS = { apartments: "Apartment complex", neighborhood: "Neighborhood (houses)" };

const f = (key, prop, type, opts = {}) => ({ key, prop, type, mode: "both", ...opts });
const invert = (labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [v, k]));

// Notion page -> plain value. Returns undefined when a link points at a row the app doesn't know yet.
function readField(fd, page, ctx) {
  const p = page.properties[fd.prop];
  switch (fd.type) {
    case "title": return plain(p?.title).trim();
    case "text": return plain(p?.rich_text).trim();
    case "check": return Boolean(p?.checkbox);
    case "phone": return p?.phone_number ?? "";
    case "num": return p?.number ?? null;
    case "date": return (p?.date?.start ?? "").slice(0, fd.time ? 25 : 10);
    case "select": return invert(fd.labels)[p?.select?.name] ?? "";
    case "multi": return (p?.multi_select ?? []).map((o) => invert(fd.labels)[o.name]).filter(Boolean).sort();
    case "rel": {
      const ids = (p?.relation ?? []).map((r) => ctx.appOf[fd.rel]?.get(dash(r.id)));
      if (ids.some((id) => !id)) return undefined;
      return fd.single ? ids[0] ?? "" : ids.sort();
    }
  }
}

// Plain value -> Notion property. Returns undefined when a link target has no Notion row yet.
function writeField(fd, value, ctx) {
  switch (fd.type) {
    case "title": return { title: rich(value) };
    case "text": return { rich_text: rich(value) };
    case "check": return { checkbox: Boolean(value) };
    case "phone": return { phone_number: value || null };
    case "num": return { number: value ?? null };
    case "date": return { date: value ? { start: value } : null };
    case "select": return { select: value ? { name: fd.labels[value] } : null };
    case "multi": return { multi_select: (value ?? []).map((v) => ({ name: fd.labels[v] })).filter((o) => o.name) };
    case "rel": {
      const ids = (fd.single ? (value ? [value] : []) : value ?? []).filter((id) => ctx.exists[fd.rel]?.has(id));
      const pages = ids.map((id) => ctx.pageOf[fd.rel]?.get(id));
      if (pages.some((id) => !id)) return undefined;
      return { relation: pages.map((id) => ({ id })) };
    }
  }
}

const readPage = (K, page, ctx) => Object.fromEntries(K.fields.map((fd) => [fd.key, readField(fd, page, ctx)]));
const appId = (page) => plain(page.properties["App ID"]?.rich_text).trim();
const nul = (v) => (v === "" || v === undefined ? null : v);
const pick = (obj, map) => {
  const out = {};
  for (const [key, col] of Object.entries(map)) if (key in obj) out[col] = nul(obj[key]);
  return out;
};

const KINDS = {
  groups: {
    db: DB.groups, table: "groups", notionWins: true, create: true,
    fields: [f("name", "Name", "title"), f("hidden", "Hidden", "check")],
    load: () => sbAll("groups?select=*&order=created_at"),
    appRead: (r) => ({ name: r.name ?? "", hidden: !r.active }),
    toCols: (c) => ({ ...pick(c, { name: "name" }), ...("hidden" in c ? { active: !c.hidden } : {}) }),
  },

  team: {
    db: DB.team, table: "team_members", notionWins: true, create: true,
    fields: [
      f("name", "Name", "title"),
      f("group_ids", "Groups", "rel", { rel: "groups" }),
      f("hidden", "Hidden", "check"),
    ],
    async load() {
      const [rows, pins] = await Promise.all([sbAll("team_members?select=*&order=created_at"), rpc("sync_pin_members")]);
      const hasPin = new Set(pins);
      return rows.map((r) => ({ ...r, has_pin: hasPin.has(r.id) }));
    },
    appRead: (r) => ({ name: r.name ?? "", group_ids: [...(r.group_ids ?? [])].sort(), hidden: !r.active }),
    toCols: (c) => ({
      ...pick(c, { name: "name" }),
      ...("group_ids" in c ? { group_ids: c.group_ids } : {}),
      ...("hidden" in c ? { active: !c.hidden } : {}),
    }),
    // 6-digit passcodes: typed into "New Passcode", or cleared by unticking "Has Passcode".
    async special(row, page, snap, toNotion, next) {
      let hasPin = Boolean(row.has_pin);
      const typed = plain(page.properties["New Passcode"]?.rich_text).trim();
      const ticked = Boolean(page.properties["Has Passcode"]?.checkbox);
      if (typed && !typed.startsWith("⚠")) {
        if (/^[0-9]{6}$/.test(typed)) {
          await rpc("sync_set_pin", { p_member: row.id, p_pin: typed });
          hasPin = true;
          toNotion["New Passcode"] = { rich_text: [] };
        } else {
          toNotion["New Passcode"] = { rich_text: rich("⚠️ Not saved: a passcode must be exactly 6 digits") };
        }
      } else if (snap.has_pin === true && !ticked && hasPin) {
        await rpc("sync_set_pin", { p_member: row.id, p_pin: null });
        hasPin = false;
      }
      if (ticked !== hasPin) toNotion["Has Passcode"] = { checkbox: hasPin };
      next.has_pin = hasPin;
    },
  },

  places: {
    db: DB.places, table: "complexes", notionWins: true, create: true,
    fields: [
      f("name", "Name", "title"),
      f("kind", "Kind", "select", { labels: PLACE_KINDS }),
      f("address", "Address", "text"),
      f("group_ids", "Groups", "rel", { rel: "groups" }),
      f("hidden", "Hidden", "check"),
    ],
    load: () => sbAll("complexes?select=*&order=created_at"),
    appRead: (r) => ({
      name: r.name ?? "", kind: r.kind ?? "apartments", address: r.address ?? "",
      group_ids: [...(r.group_ids ?? [])].sort(), hidden: !r.active,
    }),
    toCols: (c) => ({
      ...pick(c, { name: "name", address: "address" }),
      ...("kind" in c ? { kind: c.kind || "apartments" } : {}),
      ...("group_ids" in c ? { group_ids: c.group_ids } : {}),
      ...("hidden" in c ? { active: !c.hidden } : {}),
    }),
  },

  people: {
    db: DB.people, table: "people", notionWins: false, create: true,
    fields: [
      f("name", "Name", "title"),
      f("phone", "Phone", "phone"),
      f("complex_id", "Place", "rel", { rel: "places", single: true }),
      f("building", "Building / Street", "text"),
      f("unit", "Apt / House #", "text"),
      f("household", "Household", "text"),
      f("prayer_request", "Prayer Request", "text"),
      f("notes", "Notes", "text"),
      f("latest_light", "Latest Light", "select", { labels: LIGHTS, mode: "app" }),
      f("latest_response", "Latest Response", "select", { labels: RESPONSES, mode: "app" }),
      f("last_seen", "Last Seen", "date", { mode: "app" }),
    ],
    async load(ctx) {
      const [rows, convos] = await Promise.all([
        sbAll("people?select=*&order=created_at"),
        sbAll("visits?select=person_id,visited_at,light,response&outcome=eq.conversation&person_id=not.is.null&order=visited_at.desc"),
      ]);
      const latest = new Map();
      for (const v of convos) if (!latest.has(v.person_id)) latest.set(v.person_id, v);
      ctx.personName = new Map(rows.map((r) => [r.id, r.name]));
      return rows.map((r) => ({ ...r, latest: latest.get(r.id) }));
    },
    appRead: (r) => ({
      name: r.name ?? "", phone: r.phone ?? "", complex_id: r.complex_id ?? "",
      building: r.building ?? "", unit: r.unit ?? "", household: r.household ?? "",
      prayer_request: r.prayer_request ?? "", notes: r.notes ?? "",
      latest_light: r.latest?.light ?? "", latest_response: r.latest?.response ?? "",
      last_seen: localDate(r.latest?.visited_at),
    }),
    toCols: (c) => ({
      ...pick(c, {
        name: "name", phone: "phone", complex_id: "complex_id", building: "building", unit: "unit",
        household: "household", prayer_request: "prayer_request", notes: "notes",
      }),
      updated_at: new Date().toISOString(),
    }),
  },

  followups: {
    db: DB.followups, table: "follow_ups", notionWins: false, create: true,
    fields: [
      f("title", "Follow-up", "title", { mode: "app" }),
      f("person_id", "Person", "rel", { rel: "people", single: true, mode: "app" }),
      f("kinds", "Needed", "multi", { labels: FOLLOW_KINDS }),
      f("assigned_to", "Assigned To", "rel", { rel: "team", single: true }),
      f("due_date", "Due", "date"),
      f("notes", "Notes", "text"),
      f("done", "Done", "check"),
      f("done_on", "Done On", "date", { mode: "app" }),
    ],
    load: () => sbAll("follow_ups?select=*&order=created_at"),
    appRead: (r, ctx) => ({
      title: `${ctx.personName?.get(r.person_id) ?? "Someone"}: ${(r.kinds ?? []).map((k) => FOLLOW_KINDS[k] ?? k).join(", ") || "Follow up"}`,
      person_id: r.person_id ?? "", kinds: [...(r.kinds ?? [])].filter((k) => FOLLOW_KINDS[k]).sort(),
      assigned_to: r.assigned_to ?? "", due_date: r.due_date ?? "", notes: r.notes ?? "",
      done: Boolean(r.done), done_on: localDate(r.done_at),
    }),
    canCreate: (n) => Boolean(n.person_id),
    toCols: (c) => ({
      ...pick(c, { person_id: "person_id", assigned_to: "assigned_to", due_date: "due_date", notes: "notes" }),
      ...("kinds" in c ? { kinds: c.kinds } : {}),
      ...("done" in c ? { done: c.done, done_at: c.done ? new Date().toISOString() : null } : {}),
    }),
  },
};

// ---------- One kind of record, both directions ----------

async function syncKind(kind, ctx) {
  const K = KINDS[kind];
  const [appRows, pages, syncRows] = await Promise.all([
    K.load(ctx),
    queryAll(K.db),
    sbAll(`notion_sync?kind=eq.${kind}&select=app_id,page_id,snapshot`),
  ]);
  const A = new Map(appRows.map((r) => [r.id, r]));
  const S = new Map(syncRows.map((s) => [s.app_id, s]));
  const pageIds = new Set(pages.map((p) => dash(p.id)));
  const titleKey = K.fields[0].key;

  // Match Notion rows to app rows by App ID. A row with no App ID was added in Notion.
  // A second row carrying the same App ID is a duplicate made in Notion, so it counts as new too.
  const byApp = new Map();
  const added = [];
  for (const p of pages) {
    const id = appId(p);
    const known = S.get(id);
    const isCopy = id && (byApp.has(id) || (known && dash(known.page_id) !== dash(p.id) && pageIds.has(dash(known.page_id))));
    if (!id || isCopy) added.push(p);
    else byApp.set(id, p);
  }

  const pageOf = (ctx.pageOf[kind] = new Map());
  const appOf = (ctx.appOf[kind] = new Map());
  ctx.exists[kind] = new Set(A.keys());
  const link = (id, page) => { pageOf.set(id, page.id); appOf.set(dash(page.id), id); };
  for (const [id, p] of byApp) if (A.has(id)) link(id, p);

  // 1. Rows added in Notion become new records in the app.
  for (const page of K.create ? added : []) {
    if (ctx.out()) return false;
    const n = readPage(K, page, ctx);
    if (!n[titleKey] && kind !== "followups") continue; // still blank
    if (Object.values(n).some((v) => v === undefined)) continue; // links not ready; try next run
    if (K.canCreate && !K.canCreate(n)) continue;
    const id = crypto.randomUUID();
    const editable = Object.fromEntries(K.fields.filter((fd) => fd.mode === "both" || fd.key === "person_id").map((fd) => [fd.key, n[fd.key]]));
    const [row] = await sb(K.table, "POST", { id, ...K.toCols(editable) }, { Prefer: "return=representation" });
    await notion(`/pages/${page.id}`, "PATCH", { properties: { "App ID": { rich_text: rich(id) } } });
    await saveSync(kind, id, page.id, editable);
    A.set(id, row);
    ctx.exists[kind].add(id);
    link(id, page);
    // Hand it to step 2 as well, so the rest of its Notion row is filled in on this same run.
    byApp.set(id, page);
    S.set(id, { app_id: id, page_id: page.id, snapshot: editable });
    appRows.push(row);
    ctx.count.pulled++;
  }

  // 2. Every app record: create its Notion row, or carry changes across field by field.
  for (const row of appRows) {
    if (ctx.out()) return false;
    const a = K.appRead(row, ctx);
    const known = S.get(row.id);
    const page = byApp.get(row.id);

    if (!page) {
      const props = { "App ID": { rich_text: rich(row.id) } };
      const snapshot = {};
      for (const fd of K.fields) {
        const prop = writeField(fd, a[fd.key], ctx);
        if (prop === undefined) continue;
        props[fd.prop] = prop;
        snapshot[fd.key] = a[fd.key];
      }
      if (K.special && row.has_pin) { props["Has Passcode"] = { checkbox: true }; snapshot.has_pin = true; }
      const created = await notion("/pages", "POST", { parent: { database_id: K.db }, properties: props });
      await saveSync(kind, row.id, created.id, snapshot);
      link(row.id, created);
      ctx.count.pushed++;
      continue;
    }

    const n = readPage(K, page, ctx);
    const snap = known?.snapshot ?? {};
    const next = { ...snap };
    const toApp = {};
    const toNotion = {};
    for (const fd of K.fields) {
      const av = a[fd.key], nv = n[fd.key], sv = snap[fd.key];
      if (nv === undefined) continue;
      if (eq(av, nv)) { next[fd.key] = av; continue; }
      const notionChanged = sv !== undefined && !eq(nv, sv);
      const appChanged = sv === undefined || !eq(av, sv);
      if (fd.mode === "both" && notionChanged && (!appChanged || K.notionWins)) {
        if (fd.key === titleKey && !nv) continue; // never blank out a name
        toApp[fd.key] = nv;
        next[fd.key] = nv;
      } else {
        const prop = writeField(fd, av, ctx);
        if (prop === undefined) continue;
        toNotion[fd.prop] = prop;
        next[fd.key] = av;
      }
    }
    if (K.special) await K.special(row, page, snap, toNotion, next);

    if (Object.keys(toApp).length) {
      await sb(`${K.table}?id=eq.${row.id}`, "PATCH", K.toCols(toApp));
      ctx.count.pulled++;
    }
    if (Object.keys(toNotion).length) {
      await notion(`/pages/${page.id}`, "PATCH", { properties: toNotion });
      ctx.count.pushed++;
    }
    if (!known || !eq(next, snap) || dash(known.page_id) !== dash(page.id)) await saveSync(kind, row.id, page.id, next);
  }

  // 3. Records deleted in the app: remove their Notion rows.
  // Skipped if the app suddenly reports nothing at all, which is more likely a fault than a real wipe.
  const gone = syncRows.filter((s) => !A.has(s.app_id));
  if (appRows.length || gone.length <= 5) {
    for (const s of gone) {
      if (ctx.out()) return false;
      if (pageIds.has(dash(s.page_id))) await notion(`/pages/${s.page_id}`, "PATCH", { archived: true });
      await sb(`notion_sync?kind=eq.${kind}&app_id=eq.${s.app_id}`, "DELETE");
      ctx.count.pushed++;
    }
  }
  return true;
}

// ---------- Door Log: app -> Notion only ----------

const VISIT_FIELDS = [
  f("date", "Date", "date", { time: true }),
  f("outcome", "Outcome", "select", { labels: OUTCOMES }),
  f("light", "Light", "select", { labels: LIGHTS }),
  f("response", "Response", "select", { labels: RESPONSES }),
  f("shared", "Shared", "multi", { labels: METHODS }),
  f("trained", "Trained On", "multi", { labels: METHODS }),
  f("fisher_ids", "Fishers", "rel", { rel: "team" }),
  f("complex_id", "Place", "rel", { rel: "places", single: true }),
  f("person_id", "Person", "rel", { rel: "people", single: true }),
  f("building", "Building / Street", "text"),
  f("unit", "Apt / House #", "text"),
  f("notes", "Notes", "text"),
  f("lat", "Latitude", "num"),
  f("lng", "Longitude", "num"),
];

async function syncVisits(ctx) {
  const rows = await rpc("sync_pending_visits", { p_limit: VISIT_BATCH });
  const placeName = new Map(ctx.places.map((p) => [p.id, p.name]));
  for (const v of rows) {
    if (ctx.out()) return false;
    const shared = v.shared ?? [];
    const who = ctx.personName?.get(v.person_id) ?? OUTCOMES[v.outcome] ?? "Door";
    const whereAt = [placeName.get(v.complex_id), v.unit && `#${v.unit}`].filter(Boolean).join(" ");
    const a = {
      date: v.visited_at, outcome: v.outcome, light: v.light ?? "", response: v.response ?? "",
      shared: shared.filter((s) => METHODS[s]),
      trained: shared.filter((s) => s.startsWith("trained_")).map((s) => s.slice(8)).filter((s) => METHODS[s]),
      fisher_ids: v.fisher_ids ?? [], complex_id: v.complex_id ?? "", person_id: v.person_id ?? "",
      building: v.building ?? "", unit: v.unit ?? "", notes: v.notes ?? "", lat: v.lat, lng: v.lng,
    };
    const props = {
      "Door": { title: rich([who, whereAt].filter(Boolean).join(" · ")) },
      "App ID": { rich_text: rich(v.id) },
    };
    for (const fd of VISIT_FIELDS) {
      const prop = writeField(fd, a[fd.key], ctx);
      if (prop !== undefined) props[fd.prop] = prop;
    }
    let pageId = v._page;
    if (pageId) await notion(`/pages/${pageId}`, "PATCH", { properties: props });
    else pageId = (await notion("/pages", "POST", { parent: { database_id: DB.visits }, properties: props })).id;
    await saveSync("visits", v.id, pageId, { hash: v._hash });
    ctx.count.pushed++;
  }
  return rows.length < VISIT_BATCH;
}

// ---------- Passcodes typed into Notion, and the status line ----------

async function syncPasscodes(ctx) {
  const pages = await queryAll(DB.passcodes);
  for (const page of pages) {
    const which = appId(page);
    if (which === "sync") { ctx.statusPage = page.id; continue; }
    if (which !== "team" && which !== "admin") continue;
    const typed = plain(page.properties["New Passcode"]?.rich_text).trim();
    if (!typed) continue;
    const props = { "New Passcode": { rich_text: [] } };
    if (typed.length < 8) {
      props["Result"] = { rich_text: rich(`⚠️ Not changed on ${stamp()}: a passcode needs 8 or more characters.`) };
    } else {
      await rpc("sync_set_code", { p_which: which, p_code: typed });
      props["Result"] = { rich_text: rich(`Changed on ${stamp()}.`) };
      props["Last Changed"] = { date: { start: localDate(new Date().toISOString()) } };
      ctx.count.pulled++;
    }
    await notion(`/pages/${page.id}`, "PATCH", { properties: props });
  }
}

// ---------- The whole run ----------

async function runSync() {
  const started = Date.now();
  const ctx = {
    pageOf: {}, appOf: {}, exists: {},
    count: { pushed: 0, pulled: 0 },
    out: () => Date.now() - started > RUN_MS,
  };
  let finished = true;
  let problem = "";
  try {
    await syncPasscodes(ctx);
    // Order matters: later kinds link to earlier ones. If one doesn't finish, stop there so a
    // half-built set of links is never mistaken for an edit.
    for (const kind of ["groups", "team", "places", "people", "followups"]) {
      if (!(await syncKind(kind, ctx))) { finished = false; break; }
      if (kind === "places") ctx.places = await sbAll("complexes?select=id,name");
    }
    if (finished) finished = await syncVisits(ctx);
  } catch (err) {
    console.error(err);
    problem = err?.message ?? String(err);
  }

  const { pushed, pulled } = ctx.count;
  const message = problem
    ? `⚠️ ${stamp()}: ${problem}`
    : `Last synced ${stamp()}. ${pushed} sent to Notion, ${pulled} brought into the app.${finished ? "" : " More to copy; the next run carries on."}`;
  if (ctx.statusPage) {
    await notion(`/pages/${ctx.statusPage}`, "PATCH", {
      properties: { "Result": { rich_text: rich(message) }, "Last Changed": { date: { start: localDate(new Date().toISOString()) } } },
    }).catch((err) => console.error("status line", err));
  }
  return { ok: !problem, finished, pushed, pulled, message };
}

// ---------- Who may start a run ----------

async function allowed(req) {
  const key = req.headers.get("x-sync-key");
  if (key) {
    const [row] = await sb("app_secret?id=eq.1&select=sync_key");
    return Boolean(row?.sync_key) && row.sync_key === key;
  }
  // From the app: the team passcode and the admin passcode, checked by the database itself.
  const team = req.headers.get("x-team-code"), admin = req.headers.get("x-admin-code");
  if (!team || !admin) return false;
  const res = await fetch(`${SB_URL}/rest/v1/rpc/has_admin_code`, {
    method: "POST",
    headers: {
      apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, "Content-Type": "application/json",
      "x-team-code": team, "x-admin-code": admin,
    },
    body: "{}",
  });
  return res.ok && (await res.json()) === true;
}

// Only one run at a time. A run that died leaves its lock, which expires after a few minutes.
async function lock() {
  const stale = encodeURIComponent(new Date(Date.now() - LOCK_MS).toISOString());
  const rows = await sb(`app_secret?id=eq.1&or=(sync_lock.is.null,sync_lock.lt.${stale})&select=id`, "PATCH",
    { sync_lock: new Date().toISOString() }, { Prefer: "return=representation" });
  return rows.length > 0;
}
const unlock = () => sb("app_secret?id=eq.1", "PATCH", { sync_lock: null });

async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Use POST.");
    if (!TOKEN) throw new HttpError(500, "The NOTION_TOKEN secret is not set.");
    if (!(await allowed(req))) throw new HttpError(401, "Not allowed.");
    if (!(await lock())) return json({ ok: true, busy: true, message: "A sync is already running. Try again in a minute." });
    try {
      return json(await runSync());
    } finally {
      await unlock().catch((err) => console.error("unlock", err));
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, message: err?.message ?? "Something went wrong." }, err?.status ?? 500);
  }
}

if (globalThis.Deno) Deno.serve(handler);
else globalThis.__trackerSync = { handler, runSync };
