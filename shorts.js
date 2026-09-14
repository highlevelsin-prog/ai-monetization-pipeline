// 유튜브 쇼츠 대본 생성 모듈
// 기사 내용을 읽고 브루(Vrew)용 60초 쇼츠 대본을 만들어 프로젝트의 쇼츠대본 폴더에 저장한다.
const fs = require("fs");
const path = require("path");
const { chat, MODELS } = require("./openai");

// 저장 폴더: 프로젝트 폴더 안의 쇼츠대본 (2026-07-24 변경: 바탕화면 -> 프로젝트 폴더)
const SHORTS_DIR = path.join(__dirname, "쇼츠대본");

// OpenAI 키: 로컬 설정 파일(.shorts-config.json의 openaiKey) 또는 환경변수
function getApiKey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, ".shorts-config.json"), "utf8"));
    return cfg.openaiKey || process.env.OPENAI_API_KEY;
  } catch {
    return process.env.OPENAI_API_KEY;
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

// 대본 형식 검사 — 기계적으로 셀 수 있는 규칙(분량·문장 수·문장 길이·추가 출력 항목)만 본다.
// 반환: 위반 내용 목록 (비어 있으면 통과)
function checkScript(script) {
  const [bodyPart] = script.split(/^={5,}\s*$/m);
  const lines = bodyPart.split("\n").map((l) => l.trim()).filter(Boolean);
  const total = lines.reduce((n, l) => n + l.length, 0); // 공백 포함, 줄바꿈 제외
  const problems = [];
  if (total < 300 || total > 330) problems.push(`본문이 ${total}자 (300~330자여야 함)`);
  if (lines.length < 18 || lines.length > 22) problems.push(`문장이 ${lines.length}개 (18~22개여야 함)`);
  const badLen = lines.filter((l) => l.length < 12 || l.length > 18);
  // 문장 길이는 1~2개 정도 벗어나는 건 허용 (전체 분량·문장 수가 더 중요)
  if (badLen.length > 2) problems.push(`12~18자를 벗어난 문장 ${badLen.length}개: ${badLen.slice(0, 3).map((l) => `"${l}"(${l.length}자)`).join(", ")}`);
  for (const section of ["[숫자 장면]", "[유튜브 제목]", "[유튜브 태그]"]) {
    if (!script.includes(section)) problems.push(`${section} 항목 누락`);
  }
  return problems;
}

// 쇼츠 대본 생성 + 저장. 실패해도 미러링은 계속되도록 throw 안 함.
async function generateShorts({ id, title, contentHtml, url }) {
  const key = getApiKey();
  if (!key) {
    console.log("OpenAI 키 없음(.shorts-config.json) — 쇼츠 대본 생략");
    return;
  }
  try {
    const articleText = contentHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    const prompt = `${url ? url + "의 " : ""}아래 블로그 글을 읽고, 유튜브 쇼츠 대본을 만들어줘.
본문은 브루(Vrew) '텍스트로 비디오 만들기'에 바로 붙여넣을 수 있어야 해.

[글 제목] ${title}
[글 내용]
${articleText}

[출력 형식 규칙 - 반드시 지킬 것]
1. 본문은 총 300~330자(공백 포함)로 쓴다.
2. 문장은 18~22개. 한 문장은 12~18자. 한 문장을 한 줄에 쓰고 줄바꿈으로 구분한다.
3. 모든 문장에 눈으로 볼 수 있는 구체 명사를 1개 이상 넣는다.
   (사람, 사물, 장소, 기업명, 제품명, 기계, 서류)
4. 구체 명사 없이 추상어만 있는 문장은 쓰지 않는다.
   금지 예: "여기 핵심이 있습니다" / "결국 신뢰가 비즈니스가 됩니다"
   대체 예: "서버 한 대 값이 3억입니다" / "켈로그가 6억 달러를 냈습니다"
5. 연결용 문장("그런데 말이죠", "왜 그럴까요")은 넣지 않는다.
6. 숫자는 문장 맨 앞에 둔다. 예: "67%의 CTO가 그렇게 답했어요"
7. 첫 문장은 숫자 또는 기업명으로 시작한다.
8. 마지막 2문장은 한국 시청자가 당장 할 행동으로 닫는다.
9. 어투는 '~요 / ~습니다'를 유지한다.
10. 본문 문장에는 번호·기호·빈 줄을 붙이지 않는다.
11. 숫자·기업명·통계는 [글 내용]에 나온 사실만 쓴다. 위 예시 문장의 숫자와 기업(67% CTO, 켈로그 6억 달러, 서버 3억)은 형식 예시일 뿐이니 절대 가져오지 않는다.

[본문 뒤에 추가 출력]
[숫자 장면] 숫자가 들어간 문장 번호 2~3개
[유튜브 제목] 3안
[유튜브 태그] 10개

아래 형식 그대로 출력해줘 (다른 설명·머리말 없이, 꺾쇠괄호 없이):

본문 문장 1
본문 문장 2
(18~22줄)

==============================
[숫자 장면]
문장 번호 2~3개를 쉼표로 (예: 1, 7, 15)

[유튜브 제목]
1. 제목 1안
2. 제목 2안
3. 제목 3안

[유튜브 태그]
#태그1 #태그2 #태그3 #태그4 #태그5 #태그6 #태그7 #태그8 #태그9 #태그10`;

    // 규칙(분량·문장 수)을 어기면 어긴 내용을 알려주고 최대 2번 다시 쓰게 한다.
    // 끝까지 못 맞추면 가장 마지막 결과를 저장하고 로그에 남긴다.
    let script = "";
    let problems = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const fix = problems.length
        ? `\n\n[이전 출력의 규칙 위반 — 반드시 고쳐서 처음부터 다시 출력]\n- ${problems.join("\n- ")}`
        : "";
      // 일시적 API 오류는 chat()이 재시도한다. 글자 수를 세야 하므로 추론은 medium.
      script = (
        await chat({ apiKey: key, model: MODELS.shorts, prompt: prompt + fix, maxTokens: 16000, reasoningEffort: "medium" })
      ).trim()
        // 템플릿의 자리표시 꺾쇠괄호를 그대로 옮겨 쓰는 경우가 있어 줄 단위로 벗긴다
        .replace(/^<\s*(.*?)\s*>$/gm, "$1");
      problems = checkScript(script);
      if (!problems.length) break;
      console.log(`쇼츠 규칙 위반(${attempt + 1}차): ${problems.join(" / ")}`);
    }
    if (problems.length) console.log("⚠️ 쇼츠 규칙을 완전히 맞추지 못한 채 저장합니다:", problems.join(" / "));

    if (!fs.existsSync(SHORTS_DIR)) fs.mkdirSync(SHORTS_DIR, { recursive: true });
    const file = path.join(SHORTS_DIR, `${id}_${sanitize(title)}.txt`);
    fs.writeFileSync(file, script, "utf8");
    console.log("📝 쇼츠 대본 저장:", file);
  } catch (e) {
    console.log("쇼츠 대본 생성 실패(건너뜀):", e.message);
  }
}

module.exports = { generateShorts, shortsExists, SHORTS_DIR };
