// 두 함수(leaderboard, teacher)가 함께 쓰는 저장소·설정 도우미
import { getStore } from "@netlify/blobs";

export const DEFAULT_LIMIT = 15;
export const TMIN = 5;
export const TMAX = 60;
export const NQ = 12;
export const MULT = { 1: 1, 2: 1.5, 3: 2 }; // 레벨별 점수 배율
export const maxScore = (level) => Math.round(NQ * 250 * MULT[level]); // 문제당 최대 (100 + 100 + 50) × 배율
export const STUDENT_TOP = 10; // 학생 화면에 보일 인원 기본값 (선생님 페이지에서 레벨별·종합 따로 바꿀 수 있어요)
export const TOP_MIN = 1, TOP_MAX = 100;
export const validTop = (v) => { const n = Number(v); return Number.isInteger(n) && n >= TOP_MIN && n <= TOP_MAX ? n : null; };

export const scoreStore = () => getStore({ name: "integral-speed", consistency: "strong" });
const settingsStore = () => getStore({ name: "integral-speed-settings", consistency: "strong" });

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const validLimit = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= TMIN && n <= TMAX ? n : null;
};

async function getSettings() {
  return (await settingsStore().get("settings", { type: "json" })) || {};
}
async function saveSettings(patch) {
  const s = await getSettings();
  await settingsStore().setJSON("settings", { ...s, ...patch, updatedAt: Date.now() });
}

export async function getLimit() {
  return validLimit((await getSettings()).limit) ?? DEFAULT_LIMIT;
}
export async function setLimit(limit) {
  await saveSettings({ limit });
}

// 학생 화면에 보일 랭킹 인원 { level, overall }
export async function getTops() {
  const s = await getSettings();
  return { level: validTop(s.topLevel) ?? STUDENT_TOP, overall: validTop(s.topOverall) ?? STUDENT_TOP };
}
export async function setTops({ level, overall }) {
  await saveSettings({ topLevel: level, topOverall: overall });
}

// 선생님이 삭제한 기록 목록 [{ key, at }]. 기록은 지우지 않고 숨기기만 해서 언제든 복구할 수 있어요.
export async function getHidden() {
  const h = (await getSettings()).hidden;
  return Array.isArray(h) ? h : [];
}
export async function setHidden(list) {
  await saveSettings({ hidden: list });
}

// 학생 한 명 = 한 번 들어온 창(sid) + 학급 + 이름.
// 같은 창에서 다시 도전하면 같은 학생이라 최고 기록만 남고, 창을 닫았다 다시 들어오면 새 학생으로 따로 기록돼요.
const clean = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().replace(/\s+/g, " ");
export const normName = (s) => clean(s).slice(0, 12);
export const normCls = (s) => clean(s).slice(0, 10);
export const validSid = (s) => /^[0-9a-z]{8,24}$/.test(String(s ?? ""));
export const idOf = (sid, cls, name) => `${sid}|${cls}|${name}`;

// 기록 키 형식: t제한시간/점수~시각~이름(base64url)~레벨~맞힌수~학급(base64url)~창번호~난수
export const prefixOf = (limit) => `t${limit}/`;
const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s) => { try { return Buffer.from(s || "", "base64url").toString("utf8"); } catch { return ""; } };
export const makeKey = (limit, { score, name, level, correct, cls, sid }) =>
  prefixOf(limit) + [score, Date.now(), b64(name), level, correct, b64(cls), sid, Math.random().toString(36).slice(2, 8)].join("~");

function parse(key) {
  const [s, t, n, l, c, u, w] = key.slice(key.indexOf("/") + 1).split("~");
  const score = Number(s), ts = Number(t), level = Number(l), correct = Number(c);
  const name = unb64(n), cls = unb64(u), sid = w || key;
  if (!Number.isFinite(score) || !Number.isFinite(ts) || !name || !MULT[level]) return null;
  return { key, id: idOf(sid, cls, name), name, cls, score, ts, level, correct: Number.isFinite(correct) ? correct : null };
}

// 모든 기록 (점수 높은 순, 같으면 먼저 세운 기록이 위)
export async function allEntries(limit) {
  const { blobs } = await scoreStore().list({ prefix: prefixOf(limit) });
  return blobs.map((b) => parse(b.key)).filter(Boolean).sort((a, b) => b.score - a.score || a.ts - b.ts);
}

// 학생(창+학급+이름)별 최고 기록만 남기기
export function bestPerId(entries) {
  const seen = new Set(), out = [];
  for (const e of entries) { if (seen.has(e.id)) continue; seen.add(e.id); out.push(e); }
  return out;
}

// 레벨별 랭킹(학생별 최고 기록)과 종합 랭킹(학생별 레벨 1·2·3 최고 기록의 합)
export function boards(entries) {
  const levels = {};
  for (const l of [1, 2, 3]) levels[l] = bestPerId(entries.filter((e) => e.level === l));
  const sums = new Map();
  for (const l of [1, 2, 3]) for (const e of levels[l]) {
    const r = sums.get(e.id) || { id: e.id, name: e.name, cls: e.cls, score: 0, by: { 1: 0, 2: 0, 3: 0 }, ts: 0 };
    r.score += e.score; r.by[l] = e.score; r.ts = Math.max(r.ts, e.ts);
    sums.set(e.id, r);
  }
  const overall = [...sums.values()].sort((a, b) => b.score - a.score || a.ts - b.ts);
  return { levels, overall };
}

export const publicRow = ({ name, cls, score, level, by }) => ({ name, cls, score, level, by });
