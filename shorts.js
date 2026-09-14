// 유튜브 쇼츠 대본 생성 모듈
// 기사 내용을 읽고 브루(Vrew)용 60초 쇼츠 대본을 만들어 프로젝트의 쇼츠대본 폴더에 저장한다.
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

// 저장 폴더: 프로젝트 폴더 안의 쇼츠대본 (2026-07-24 변경: 바탕화면 -> 프로젝트 폴더)
const SHORTS_DIR = path.join(__dirname, "쇼츠대본");

// Anthropic 키: 로컬 설정 파일(.shorts-config.json) 또는 환경변수
function getApiKey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, ".shorts-config.json"), "utf8"));
    return cfg.anthropicKey || process.env.ANTHROPIC_API_KEY;
  } catch {
    return process.env.ANTHROPIC_API_KEY;
  }
}

// 파일명에 못 쓰는 문자 제거
function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").slice(0, 50).trim() || "untitled";
}

// 해당 글(id)의 쇼츠 대본 파일이 이미 있는지 확인
function shortsExists(id) {
  try {
    if (!fs.existsSync(SHORTS_DIR)) return false;
    return fs.readdirSync(SHORTS_DIR).some((f) => f.startsWith(String(id) + "_"));
  } catch {
    return false;
  }
}

// 쇼츠 대본 생성 + 저장. 실패해도 미러링은 계속되도록 throw 안 함.
async function generateShorts({ id, title, contentHtml, url }) {
  const key = getApiKey();
  if (!key) {
    console.log("Anthropic 키 없음(.shorts-config.json) — 쇼츠 대본 생략");
    return;
  }
  try {
    const articleText = contentHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    const prompt = `${url ? url + "의 " : ""}아래 블로그 글을 읽고, 유튜브 쇼츠용 자료를 만들어줘.

[글 제목] ${title}
[글 내용]
${articleText}

(1) 60초 쇼츠 대본 — 브루(Vrew) '텍스트로 비디오 만들기'에 바로 붙여넣을 것
- 구어체, 친근한 톤
- 첫 문장은 3초 안에 주목 끄는 후킹 멘트
- 한 문단(빈 줄로 구분) = 한 장면, 문단당 1~2문장 이내로 짧게
- 전체 350~450자 내외 (60초 내레이션 기준)
- 어려운 용어는 풀어서 설명
- 마지막은 질문이나 한 줄 정리로 마무리

(2) 유튜브 업로드용 제목 — 클릭을 부르는 제목 1개 (40자 이내, 과장·낚시 금지)
(3) 유튜브 태그 — 본문 관련 해시태그 10개 (#로 시작, 공백 구분)

아래 형식 그대로 출력해줘 (다른 설명·머리말 없이):

<쇼츠 대본 본문>

==============================
[유튜브 제목]
<제목>

[유튜브 태그]
<#태그1 #태그2 ...>`;

    const client = new Anthropic({ apiKey: key });
    // 일시적 API 오류에 대비해 2회 재시도
    let res;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        res = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        console.log(`쇼츠 API 재시도(${attempt}):`, e.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    const script = res.content[0].text.trim();

    if (!fs.existsSync(SHORTS_DIR)) fs.mkdirSync(SHORTS_DIR, { recursive: true });
    const file = path.join(SHORTS_DIR, `${id}_${sanitize(title)}.txt`);
    fs.writeFileSync(file, script, "utf8");
    console.log("📝 쇼츠 대본 저장:", file);
  } catch (e) {
    console.log("쇼츠 대본 생성 실패(건너뜀):", e.message);
  }
}

module.exports = { generateShorts, shortsExists, SHORTS_DIR };
