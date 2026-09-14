const { chat, MODELS } = require("./openai");

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

const xmlrpc = require("xmlrpc");
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_PASSWORD;

const axios = require("axios");
const NEWS_API_KEY = process.env.NEWS_API_KEY;

const { pickTopic } = require("./newsSources");

// 소재 국적. econ 1(국내주식)과 econ 2(미국주식)가 서로 다른 소재를 받아야 하므로
// 워크플로가 NEWS_SOURCE로 지정한다. 지정하지 않으면 예전 그대로 미국 뉴스다 —
// 기존 동작 보존이 새 기능보다 항상 우선이다.
const NEWS_SOURCE = (process.env.NEWS_SOURCE || process.argv[2] || "us").toLowerCase();
const ORIGIN_LABEL = { kr: "국내", us: "해외" };

// GitHub Actions 러너는 UTC라 한국 시간으로 고정 (한국 00~09시 실행 시 전날 날짜 방지)
const today = new Date().toLocaleDateString("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

// DRY_RUN=1이면 글 생성·가공까지만 하고 워드프레스에 올리지 않는다 (로컬 점검용)
const DRY_RUN = process.env.DRY_RUN === "1";


async function getTrendingTopics() {
  // 소재 선택은 newsSources.js가 한다(국내=RSS / 미국=NewsAPI).
  // 여기서는 그 결과를 예전과 같은 { title, keyword } 모양으로 감싸기만 한다.
  const picked = await pickTopic(NEWS_SOURCE);
  return [
    {
      title: `오늘의 경제·재테크 이슈 : ${picked.keyword} [${today}]`,
      keyword: picked.keyword,
      origin: picked.origin,
      sourceLink: picked.link || "",
    },
  ];
}


async function generateBlogPost(topic) {
  const prompt = `
당신은 15년 경력의 경제·재테크 전문 기자이자 시장 애널리스트입니다.
아래 뉴스를 소재로, 독자가 "여기서만 얻을 수 있는" 깊이 있는 분석 기사를 작성하세요.
목표는 단순 정보 전달이 아니라, 독자가 읽고 "이건 다른 글과 다르다, 실제로 도움이 됐다"고 느끼게 만드는 것입니다.

주제: ${topic.title}
핵심 키워드: ${topic.keyword}

[반드시 지킬 핵심 원칙 — 이걸로 글의 가치가 결정됨]
- 뉴스 요약 금지. 사실 전달은 최소한으로 압축하고, 글의 대부분을 "분석·해석·시사점"에 할애할 것
- 아래 다섯 가지를 반드시 깊이 있게 녹여낼 것:
  · 왜 이 일이 일어났는가 (근본 원인과 배경 맥락)
  · 과거 유사 사례나 비교 대상 (역사적·산업적 맥락으로 깊이 더하기)
  · 누구에게 어떤 영향이 가는가 (투자자·소비자·산업 등 여러 관점)
  · 앞으로 어떻게 전개될 수 있는가 (시나리오와 전망; 추측은 추측으로 명확히 구분)
  · 그래서 독자는 무엇을 해야 하는가 (추상적 조언이 아닌, 구체적이고 실행 가능한 행동·판단 기준)
- 구체적 수치·사례·비교로 전문성을 보여줄 것. 막연한 일반론·상투구는 가치를 떨어뜨림
- 같은 뉴스를 다룬 다른 블로그·기사와 명백히 차별화될 것

[글 구성 — 순서대로]
1) 첫 줄에 한국어 제목만 단독으로 (말머리·기호 없이). 핵심 키워드 포함, 클릭을 부르되 과장·낚시 금지
2) 도입부: 2~3문장으로 핵심과 "왜 지금 중요한지"를 압축해 후킹
3) 본문: "1. 소제목" 형식의 번호 소제목 4~6개. 각 소제목 아래 6문장 이상의 밀도 높은 분석 문단
   - 사실/배경 → 근본 원인 → 다각도 영향 → 과거 비교·전망 → 투자·재테크 의미 순으로 깊이를 더할 것
4) 실전 가이드 섹션: "독자가 지금 할 수 있는 일"을 하나의 번호 소제목으로. 추상적 조언이 아니라 구체적 행동·판단 기준 제시
5) 마무리: 기자 본인의 전망과 견해를 담은 고유한 결론 ("나는 이렇게 본다")
6) 본문 관련 경제·재테크 해시태그 10개 (예: #재테크 #투자 #경제 ...)
7) 그다음 줄에 "META: " 뒤 검색 최적화된 메타 설명(150자 이내)
8) 맨 마지막 줄에 "IMAGE: " 뒤 이 글에 어울리는 사진 검색용 영어 키워드 2~3단어 (예: IMAGE: airline cabin security)

[문체·형식 규칙]
- 자연스럽고 전문적인 한국어. 노련한 애널리스트가 자기 견해를 풀어내듯 쓸 것
- "~할 수 있습니다", "~하는 것이 중요합니다", "결론적으로", "오늘날" 같은 AI 특유 표현·상투구 금지
- 사실을 지어내지 말 것. 모르면 단정하지 말고 합리적 추론으로 제시
- 이모티콘 금지
- 소제목은 새 줄에 "1. 제목" 형태로 단독 작성, 앞뒤 빈 줄 하나씩
- 소제목 아래는 번호 없는 문단, 문단 사이 한 줄 공백으로 가독성 확보
- 전체 길이 1800자 ~ 2600자 (깊이를 위해 충분히)
- 뉴스 제목이 영어면 한국어로 자연스럽게 번역해 제목에 반영
- "—", "---", "***" 같은 구분선을 단독 줄로 넣지 말 것
- 해시태그 줄에는 해시태그만 작성하고, 앞에 키워드나 다른 단어를 붙이지 말 것
- 면책·투자 유의 문구("본 글은 정보 제공 목적...", "투자 권유가 아닙니다" 등)를 절대 넣지 말 것
- 글의 맨 끝은 (마무리 결론) → (해시태그 줄) → (META 줄) → (IMAGE 줄) 순서로만 끝낼 것. 그 외 군더더기 줄 금지
  `.trim();

  return chat({
    apiKey: process.env.OPENAI_API_KEY,
    model: MODELS.blog,
    prompt,
    maxTokens: 16000,
  });
}

async function searchImage(keyword, page = 1) {
  // 이미지는 부가 요소 → 실패해도 글 발행은 계속되도록 null 반환
  // 시크릿 이름이 PEXELS/PIXELS 어느 쪽이든 인식 (오타 호환)
  const pexelsKey = process.env.PEXELS_API_KEY || process.env.PIXELS_API_KEY;
  try {
    if (!pexelsKey) {
      console.log("Pexels 키 없음 - 이미지 건너뜀");
      return null;
    }
    const response = await axios.get("https://api.pexels.com/v1/search", {
      headers: {
        Authorization: pexelsKey,
      },
      params: {
        query: keyword,
        per_page: 10,
      },
    });
    const photos = response.data.photos;
    const index = (page - 1) % (photos?.length || 1);
    const url = photos?.[index]?.src?.large || null;
    // Pexels CDN이 브라우저에 AVIF를 주는 것을 막고 JPG로 강제 (fm=jpg)
    if (!url) return null;
    const jpg = url.replace(/([?&])fm=[^&]*/g, "$1").replace(/[?&]+$/, "");
    return jpg + (jpg.includes("?") ? "&" : "?") + "fm=jpg";
  } catch (e) {
    console.log("이미지 검색 실패(건너뜀):", e.message);
    return null;
  }
}

async function insertImages(content, englishKeyword) {
  // 마크다운 헤더(# 제목)만 제거 — '#' 뒤에 공백이 있을 때만.
  // 해시태그(#재테크)는 공백 없이 붙으므로 보존된다. (외톨이 단어 방지)
  content = content.replace(/^#+\s+/gm, '');
  content = content.replace(/([^\n])((\d+)\. )/g, '$1\n\n$2');
  const lines = content.split('\n');
  const result = [];
  let imageIndex = 1;  // ← 추가

  for (const line of lines) {
  if (line.match(/^\d+\. /)) {
    result.push('<!-- wp:paragraph --><p>&nbsp;</p><!-- /wp:paragraph -->');
    result.push('<!-- wp:paragraph --><p>&nbsp;</p><!-- /wp:paragraph -->');
  }
 if (line.match(/^\d+\. /)) {
    result.push(`<!-- wp:paragraph --><p><strong>${line}</strong></p><!-- /wp:paragraph -->`);
} else {
  result.push(line);
}
  if (line.match(/^\d+\. /)) {
      const keyword = line.replace(/^\d+\. /, '').trim();
      const shortKeyword = englishKeyword.split(' ').slice(0, 3).join(' ');
      const imageUrl = await searchImage(shortKeyword, imageIndex);
      imageIndex++;
      if (imageUrl) {
    const alt = keyword.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    result.push(`\n<!-- wp:image -->\n<figure class="wp-block-image"><img src="${imageUrl}" alt="${alt}"/></figure>\n<!-- /wp:image -->\n<!-- wp:paragraph --><p>&nbsp;</p><!-- /wp:paragraph -->\n`);
      }
    }
  }
  const finalContent = result.join('\n');
  const withSpacing = finalContent.replace(
  /(#[가-힣\w]+(\s+#[가-힣\w]+)+)/,
  '<!-- wp:paragraph --><p>&nbsp;</p><!-- /wp:paragraph -->\n<!-- wp:paragraph --><p>&nbsp;</p><!-- /wp:paragraph -->\n$1'
);
return withSpacing;
}

async function main() {
  const topics = await getTrendingTopics();
  for (const topic of topics) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`[주제] ${topic.title}`);
    console.log("=".repeat(50));

    const rawPost = await generateBlogPost(topic);
    // 사진 검색어: Pexels는 영어 검색이 정확하므로 모델이 준 영어 키워드를 쓴다.
    // 없으면 미국 소재는 뉴스 제목(영어), 국내 소재는 일반 증시 키워드로 대신한다.
    const imageMatch = rawPost.match(/^\s*IMAGE:\s*(.+)$/m);
    const imageKeyword =
      (imageMatch && imageMatch[1].replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()) ||
      (topic.origin === "kr" ? "stock market finance" : topic.keyword);
    const post = rawPost.replace(/^\s*IMAGE:\s*.+$/m, '');
    const metaMatch = post.match(/META:\s*(.+)/);
    const metaDescription = metaMatch ? metaMatch[1].trim() : '';
    let cleanPost = post.replace(/META:\s*.+/, '').trim();
    // 끝부분 정리: (1) 단독 구분선(—, ---, *** 등) 줄 제거,
    // (2) 해시태그 줄 앞에 붙은 잡단어(키워드 등) 제거 → 외톨이 단어 방지,
    // (3) 과도한 빈 줄 축소
    cleanPost = cleanPost
      // 면책·투자 유의 문구 줄 제거 (내용과 무관한 작위적 군더더기)
      .replace(/^.*(?:투자 권유가 아닙니다|투자 판단과 책임은 본인|정보 제공 목적이며).*$/gm, '')
      // 단독 구분선(—, ---, *** 등) 줄 제거
      .replace(/^\s*(?:[—–]|[-=*_~]{2,})\s*$/gm, '')
      // 해시태그 줄에 같은 줄로 붙은 잡단어 제거
      .replace(/^[^\n#]*?(#[가-힣A-Za-z0-9_]+(?:\s+#[가-힣A-Za-z0-9_]+)+.*)$/gm, '$1')
      // 해시태그 블록 바로 앞의 '짧은 외톨이 단어 줄' 제거 (문장부호로 끝나지 않는 짧은 줄)
      .replace(
        /\n[ \t]*([^\n#]{1,25})[ \t]*\n\s*(?=#[가-힣A-Za-z0-9_]+(?:[ \t]+#[가-힣A-Za-z0-9_]+)+)/g,
        (m, orphan) => (/[.!?…]$|다$|요$|음$/.test(orphan.trim()) ? m : '\n\n')
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const cleanTitle = cleanPost.split('\n')[0].replace(/^#+\s*/, '').replace(/\*\*/g, '').trim(); // 141
    const postLines = cleanPost.split('\n');
    postLines[0] = `<!-- wp:heading {"level":3} --><h3>${cleanTitle}</h3><!-- /wp:heading -->`;
    const processedPost = postLines.join('\n');
    console.log(`[이미지 검색어] ${imageKeyword}`);
    const postWithImages = await insertImages(processedPost, imageKeyword);
    console.log(postWithImages);

    const koreanTitle = cleanTitle + ` [${today}]`;

    if (DRY_RUN) {
      console.log(`\n[DRY_RUN] 워드프레스 발행 생략 — 제목: ${koreanTitle}\n[META] ${metaDescription}`);
      continue;
    }

    // 워드프레스에 발행 (네이버 미러링은 로컬 BlogAuto의 econ 버티컬이 가져간다)
    await postToWordPress(koreanTitle, postWithImages, metaDescription, topic.origin);
    console.log(`워드프레스 업로드 완료! (소재: ${ORIGIN_LABEL[topic.origin] || topic.origin})`);
  }
}

// origin을 워드프레스 **카테고리**로 남긴다.
//
// 왜 카테고리인가: 네이버로 미러링하는 쪽(BlogAuto의 econ 버티컬)이 "이 원문이 국내 소재인가
// 미국 소재인가"를 알아야 국내주식/미국주식 칸을 나눠 쓸 수 있다. 제목이나 본문에 표시를 심으면
// 독자에게 보이고 재포맷 단계에서 지워야 하지만, 카테고리는 워드프레스 REST가
// `/wp/v2/posts?categories=<id>`로 서버에서 걸러주므로 원문을 더럽히지 않는다.
// terms_names는 없는 카테고리를 자동으로 만든다.
async function postToWordPress(title, content, metaDescription, origin) {
  return new Promise((resolve, reject) => {
    const client = xmlrpc.createSecureClient({
      host: "cheetahfather.wordpress.com",
      path: "/xmlrpc.php",
      port: 443,
    });

    const post = {
      post_title: title,
      post_content: content,
      post_status: "publish",
      post_excerpt: metaDescription,
      terms_names: { category: [ORIGIN_LABEL[origin] || "해외"] },
    };

    client.methodCall(
      "wp.newPost",
      [0, WP_USERNAME, WP_PASSWORD, post],
      (error, value) => {
        if (error) reject(error);
        else resolve(value);
      }
    );
  });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1; // 실패 시 워크플로가 빨간 X로 표시되도록 (조용한 실패 방지)
});
