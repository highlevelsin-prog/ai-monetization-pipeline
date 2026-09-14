// 지금까지 미러링된 모든 글에 대해 쇼츠 대본 일괄 생성 (이미 있는 건 건너뜀)
const fs = require("fs");
const path = require("path");
const { generateShorts, SHORTS_DIR } = require("./shorts");
const { getPost } = require("./wpPosts");

async function main() {
  const mirrored = JSON.parse(fs.readFileSync(path.join(__dirname, "mirrored.json"), "utf8"));
  const existing = fs.existsSync(SHORTS_DIR) ? fs.readdirSync(SHORTS_DIR) : [];
  const haveId = new Set(existing.map((f) => (f.match(/^(\d+)_/) || [])[1]).filter(Boolean));

  let done = 0, skip = 0, fail = 0;
  for (const id of mirrored) {
    if (haveId.has(String(id))) { skip++; continue; }
    try {
      const p = await getPost(id);
      if (!p) { console.log(`id=${id} 글 없음 - 건너뜀`); fail++; continue; }
      console.log(`[생성] id=${id} ${p.post_title.slice(0, 35)}`);
      await generateShorts({ id: String(id), title: p.post_title, contentHtml: p.post_content, url: p.post_link });
      done++;
    } catch (e) { console.log(`id=${id} 오류:`, e.message); fail++; }
  }
  console.log(`
=== 완료 === 생성:${done} / 이미있음:${skip} / 없음·실패:${fail}`);
}
main().catch((e) => console.log("오류:", e.message));
