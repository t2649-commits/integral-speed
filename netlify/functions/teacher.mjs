// 선생님용 API: POST /api/teacher
//   { password, action: "check" }               → 비밀번호 확인, 현재 제한시간 반환
//   { password, action: "setLimit", limit }     → 제한시간 변경 (5~60초)
//   { password, action: "setTops", level, overall } → 학생 화면에 보일 랭킹 인원 (레벨별, 종합 따로 1~100명)
//   { password, action: "list" }                → 현재 제한시간의 모든 기록(잘리지 않음)과 삭제된 기록 목록
//   { password, action: "hide", key }           → 기록 하나 삭제: 저장된 기록은 남기고 모든 랭킹에서 숨김
//   { password, action: "unhide", key }         → 삭제한 기록 복구
//   { password, action: "reset" }               → 모든 랭킹 기록과 삭제 목록을 완전히 지움
// 비밀번호는 넷리파이 환경 변수 TEACHER_PASSWORD 에 저장해요. 코드에는 들어 있지 않아요.
import { createHash, timingSafeEqual } from "node:crypto";
import { json, getLimit, setLimit, validLimit, getTops, setTops, validTop, TOP_MIN, TOP_MAX, allEntries, scoreStore, getHidden, setHidden, TMIN, TMAX } from "../lib/common.mjs";

const readSecret = () => globalThis.Netlify?.env?.get?.("TEACHER_PASSWORD") ?? process.env.TEACHER_PASSWORD ?? "";
const digest = (s) => createHash("sha256").update(String(s)).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listPayload() {
  const limit = await getLimit();
  const all = await allEntries(limit);
  return {
    ok: true, limit,
    records: all.map(({ key, id, name, cls, score, level, correct, ts }) => ({ key, id, name, cls, score, level, correct, ts })),
    hidden: await getHidden(),
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "지원하지 않는 요청이에요." }, 405);

  const secret = readSecret();
  if (!secret) return json({ error: "넷리파이에 TEACHER_PASSWORD 환경 변수가 아직 없어요. 등록한 뒤 다시 배포해 주세요." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "잘못된 요청이에요." }, 400); }

  if (!timingSafeEqual(digest(body?.password ?? ""), digest(secret))) {
    await sleep(800);
    return json({ error: "비밀번호가 맞지 않아요." }, 401);
  }

  const action = body?.action;

  if (action === "check") return json({ ok: true, limit: await getLimit(), tops: await getTops() });

  if (action === "setTops") {
    const level = validTop(body?.level), overall = validTop(body?.overall);
    if (!level || !overall) return json({ error: `인원은 ${TOP_MIN}명에서 ${TOP_MAX}명 사이의 정수여야 해요.` }, 400);
    await setTops({ level, overall });
    return json({ ok: true, tops: { level, overall } });
  }

  if (action === "setLimit") {
    const limit = validLimit(body?.limit);
    if (!limit) return json({ error: `제한시간은 ${TMIN}초에서 ${TMAX}초 사이의 정수여야 해요.` }, 400);
    await setLimit(limit);
    return json({ ok: true, limit });
  }

  if (action === "list") return json(await listPayload());

  if (action === "hide" || action === "unhide") {
    const key = String(body?.key ?? "");
    if (!/^t\d+\//.test(key)) return json({ error: "기록 정보가 올바르지 않아요." }, 400);
    let hidden = (await getHidden()).filter((h) => h.key !== key);
    if (action === "hide") hidden.push({ key, at: Date.now() });
    await setHidden(hidden);
    return json(await listPayload());
  }

  if (action === "reset") {
    const store = scoreStore();
    const { blobs } = await store.list();
    for (const b of blobs) await store.delete(b.key);
    await setHidden([]);
    return json({ ok: true, deleted: blobs.length, limit: await getLimit() });
  }

  return json({ error: "알 수 없는 요청이에요." }, 400);
};

export const config = { path: "/api/teacher" };
