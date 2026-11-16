// 학생용 랭킹 API
//   GET  /api/leaderboard → { limit, levels: {1,2,3: {top,total}}, overall: {top,total} }
//        학생 = 한 번 들어온 창 + 학급 + 이름. 레벨별 랭킹은 학생별 최고 기록, 종합은 학생별 레벨 1·2·3 최고 기록의 합.
//        보이는 인원은 선생님이 정한 수(레벨별·종합 따로, 기본 10명)만큼이에요.
//        선생님이 삭제한 기록은 빠져요(그 학생의 다음 기록이 최고 기록이 돼요).
//   POST /api/leaderboard → { name, cls, sid, score, correct, level, limit } 기록 저장 후 순위 반환
import { json, getLimit, getHidden, getTops, allEntries, boards, publicRow, scoreStore, makeKey, idOf, normName, normCls, validSid, maxScore, MULT, NQ } from "../lib/common.mjs";

async function visible(limit) {
  const hidden = new Set((await getHidden()).map((h) => h.key));
  return boards((await allEntries(limit)).filter((e) => !hidden.has(e.key)));
}
function view(b, tops) {
  const levels = {};
  for (const l of [1, 2, 3]) levels[l] = { top: b.levels[l].slice(0, tops.level).map(publicRow), total: b.levels[l].length };
  return { tops, levels, overall: { top: b.overall.slice(0, tops.overall).map(publicRow), total: b.overall.length } };
}

export default async (req) => {
  const limit = await getLimit();

  if (req.method === "GET") return json({ limit, ...view(await visible(limit), await getTops()) });

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "잘못된 요청이에요." }, 400); }

    if (Number(body?.limit) !== limit) return json({ error: "게임 도중 제한시간이 바뀌었어요.", limit }, 409);

    const name = normName(body?.name);
    const cls = normCls(body?.cls);
    const sid = String(body?.sid ?? "");
    const level = Number(body?.level);
    const score = Math.round(Number(body?.score));
    const correct = Math.round(Number(body?.correct));

    if (!name) return json({ error: "이름이 비어 있어요." }, 400);
    if (!cls) return json({ error: "학급이 비어 있어요." }, 400);
    if (!validSid(sid)) return json({ error: "잘못된 요청이에요." }, 400);
    if (!MULT[level]) return json({ error: "레벨이 올바르지 않아요." }, 400);
    if (!Number.isFinite(score) || score < 0 || score > maxScore(level)) return json({ error: "점수가 올바르지 않아요." }, 400);
    if (!Number.isInteger(correct) || correct < 0 || correct > NQ) return json({ error: "맞힌 수가 올바르지 않아요." }, 400);

    const key = makeKey(limit, { score, name, level, correct, cls, sid });
    await scoreStore().set(key, "");

    const id = idOf(sid, cls, name);
    const b = await visible(limit);
    const li = b.levels[level].findIndex((e) => e.id === id);
    const oi = b.overall.findIndex((e) => e.id === id);
    return json({
      limit, ...view(b, await getTops()), level,
      rank: li + 1, isBest: b.levels[level][li]?.key === key, total: b.levels[level].length,
      overallRank: oi + 1, overallScore: b.overall[oi]?.score ?? 0, overallTotal: b.overall.length,
    });
  }

  return json({ error: "지원하지 않는 요청이에요." }, 405);
};

export const config = { path: "/api/leaderboard" };
