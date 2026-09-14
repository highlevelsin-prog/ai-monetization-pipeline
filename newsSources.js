// 뉴스 소재 공급 모듈. 국내(RSS)와 미국(NewsAPI)을 같은 모양으로 내놓는다.
//
// 왜 두 갈래인가: 네이버 블로그의 econ 1 슬롯은 '국내주식', econ 2는 '미국주식' 카테고리로 나간다.
// 카테고리를 소재 없이 나누면 국내주식 칸에 미국 뉴스를 넣게 되므로, 소재부터 나눈다.
//
// 왜 국내는 RSS인가: 2026-08-27 실측에서 NewsAPI `country=kr&category=business`가
// **totalResults 0**을 돌려줬다. 에러가 아니라 빈 응답이라 재시도로 풀리지 않는다.
// 같은 호출의 country=us는 55건 정상이므로 미국 쪽은 NewsAPI를 그대로 쓴다.
//
// 왜 '경제'가 아니라 '증권' 피드인가: 연합뉴스 경제 피드에는 '횡성한우 대표브랜드 대상',
// '창원 단감 중국시장 공략' 같은 기사가 함께 온다. 국내주식 카테고리에 넣을 수 없는 소재다.
// 한국경제 finance 피드는 SK 데이터센터·컴투스 급등·코스피 지수처럼 전부 증시·상장사다.
const axios = require("axios");

// 정치 기사는 어느 소스에서 오든 뺀다. 수익화 블로그에서 다룰 소재가 아니고
// 네이버 주제(비즈니스·경제)와도 어긋난다. (기존 blogGenerator의 필터와 같은 기준)
const POLITICS = /정치|대통령|국회|선거|여당|야당|후보|장관 후보|탄핵|trump|election|politic/i;

// 국내 RSS 후보. 위에서부터 시도하고 처음 성공한 것을 쓴다.
// finance(증권)가 1순위이고, 죽었을 때만 넓은 피드로 내려간다.
const KR_FEEDS = [
  ["한국경제 증권", "https://www.hankyung.com/feed/finance"],
  ["한국경제 경제", "https://www.hankyung.com/feed/economy"],
  ["연합뉴스 경제", "https://www.yna.co.kr/rss/economy.xml"],
];

// 한글 음절 비율. 조선비즈처럼 같은 기사를 일본어·한국어 두 벌로 내보내는 피드가 있어,
// 폴백을 넓힐 때 한국어가 아닌 제목이 섞여 들어오는 것을 막는다.
function hangulRatio(s) {
  const t = String(s || "").replace(/\s/g, "");
  if (!t.length) return 0;
  return (t.match(/[가-힣]/g) || []).length / t.length;
}

// RSS <item>에서 제목과 링크만 뽑는다. 파서를 새로 들이지 않는다 —
// 이 파이프라인은 기사 본문을 쓰지 않고 헤드라인만 소재로 삼기 때문에 이것으로 충분하다.
function parseRssItems(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const block = m[0];
    const t = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const l = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const title = t ? t[1].trim() : "";
    if (title) items.push({ title, link: l ? l[1].trim() : "" });
  }
  return items;
}

async function fetchFeed(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    responseType: "text",
    transformResponse: [(d) => d],
    // 기본 UA로는 403을 주는 매체가 있다(매일경제·연합뉴스 마켓 피드에서 실제로 겪었다).
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  return parseRssItems(res.data);
}

// 국내 증권 뉴스에서 소재 하나를 고른다.
async function pickKoreanTopic() {
  let items = [];
  let usedFeed = null;
  for (const [name, url] of KR_FEEDS) {
    try {
      const got = await fetchFeed(url);
      if (got.length) {
        items = got;
        usedFeed = name;
        break;
      }
      console.log(`[news:kr] ${name} - 기사 0건, 다음 후보로`);
    } catch (e) {
      console.log(`[news:kr] ${name} 실패(${e.message}), 다음 후보로`);
    }
  }
  if (!items.length) {
    // 소재가 없으면 회차를 건너뛴다. 억지로 미국 뉴스를 국내 슬롯에 넣지 않는다 —
    // 그러면 국내주식 카테고리에 미국 기사가 들어가 카테고리 자체가 무의미해진다.
    throw new Error("국내 뉴스 소스를 하나도 읽지 못했습니다 (RSS 후보 전부 실패)");
  }

  const candidates = items.filter(
    (a) => !POLITICS.test(a.title) && hangulRatio(a.title) > 0.3 && a.title.length >= 10
  );
  if (!candidates.length) throw new Error(`${usedFeed}에서 적합한 국내 경제 뉴스를 찾지 못했습니다.`);

  console.log(`[news:kr] ${usedFeed} - 후보 ${candidates.length}/${items.length}건`);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 미국 비즈니스 뉴스. 기존 getTrendingTopics의 동작을 그대로 옮긴 것이다.
async function pickUsTopic() {
  const res = await axios.get("https://newsapi.org/v2/top-headlines", {
    params: {
      country: "us",
      category: "business",
      pageSize: 20,
      apiKey: process.env.NEWS_API_KEY,
    },
  });
  const candidates = (res.data.articles || []).filter((a) => a.title && !POLITICS.test(a.title));
  if (!candidates.length) throw new Error("적합한 미국 경제 뉴스를 찾지 못했습니다.");
  console.log(`[news:us] NewsAPI - 후보 ${candidates.length}/${(res.data.articles || []).length}건`);
  const a = candidates[Math.floor(Math.random() * candidates.length)];
  // NewsAPI 제목 끝에는 " - 매체명"이 붙는다. 키워드로 쓸 때는 뗀다.
  return { title: a.title.replace(/ - [^-]+$/, ""), link: a.url };
}

// 반환: { origin, keyword, link } - origin은 워드프레스 카테고리와 네이버 카테고리를 가르는 값이다.
async function pickTopic(source) {
  if (source === "kr") {
    const a = await pickKoreanTopic();
    return { origin: "kr", keyword: a.title, link: a.link };
  }
  const a = await pickUsTopic();
  return { origin: "us", keyword: a.title, link: a.link };
}

// 단독 실행: 소재만 골라 보여준다. 발행하지 않는다.
//   node newsSources.js kr
//   node newsSources.js us      (NEWS_API_KEY 필요)
//
// blogGenerator.js는 require만 해도 main()이 돌아 **실제로 발행된다.** 소재 경로만 확인할 때는
// 반드시 이 파일을 쓸 것.
if (require.main === module) {
  const source = (process.argv[2] || "kr").toLowerCase();
  pickTopic(source)
    .then((t) => {
      console.log("\n소재 국적 :", t.origin);
      console.log("키워드    :", t.keyword);
      console.log("원문 링크 :", t.link || "(없음)");
      console.log("\n워드프레스 카테고리로는 \"" + (t.origin === "kr" ? "국내" : "해외") + "\"가 붙습니다.");
    })
    .catch((e) => {
      console.error("실패:", e.message);
      process.exit(1);
    });
}

module.exports = { pickTopic, parseRssItems, hangulRatio, POLITICS, KR_FEEDS };
