// 워드프레스 글 조회 모듈 (로컬 미러링·쇼츠·백필 공용)
//
// 2026-09-14부터 워드프레스 글이 비공개(private)로 발행되므로 공개 REST로는 보이지 않는다.
// .wp-config.json(username/password)이 있으면 XML-RPC로 공개+비공개 글을 모두 읽고,
// 없으면 예전처럼 공개 REST로 읽는다(공개 글만 보임).
const axios = require("axios");
const xmlrpc = require("xmlrpc");
const fs = require("fs");
const path = require("path");
const { decodeEntities } = require("./htmlEntities");

const WP_SITE = "cheetahfather.wordpress.com";

function readWpConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, ".wp-config.json"), "utf8"));
    return cfg.username && cfg.password ? cfg : null;
  } catch {
    return null;
  }
}

// XML-RPC는 렌더링 전 원문을 준다. blogGenerator가 만든 원문은 HTML 블록과
// 일반 텍스트 줄이 섞여 있어, 워드프레스가 화면에 보여줄 때처럼 텍스트 줄을 <p>로 감싼다
// (안 하면 티스토리 에디터에서 문단이 한 덩어리로 붙는다).
function autop(raw) {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.join("<br>\n")}</p>`);
    para = [];
  };
  for (const line of String(raw).replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t) flush();
    else if (/^<(?:!--|\/?(?:p|h[1-6]|figure|div|ul|ol|li|table|blockquote|pre|hr|img)\b)/i.test(t)) {
      flush();
      out.push(t);
    } else para.push(t);
  }
  flush();
  return out.join("\n");
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const client = xmlrpc.createSecureClient({ host: WP_SITE, path: "/xmlrpc.php", port: 443 });
    client.methodCall(method, params, (err, value) => (err ? reject(err) : resolve(value)));
  });
}

function fromRpc(p) {
  return {
    post_id: String(p.post_id),
    post_title: decodeEntities(p.post_title),
    post_content: autop(p.post_content),
    post_link: p.link,
    post_status: p.post_status,
  };
}

function fromRest(p) {
  return {
    post_id: String(p.id),
    post_title: decodeEntities(p.title.rendered),
    post_content: p.content.rendered,
    post_link: p.link,
    post_status: p.status || "publish",
  };
}

// 최신 글 num개 (최신순). 발행/비공개 글만 — 임시글·휴지통은 제외.
async function getRecentPosts(num) {
  const cfg = readWpConfig();
  if (!cfg) {
    const res = await axios.get(`https://public-api.wordpress.com/wp/v2/sites/${WP_SITE}/posts`, {
      params: { per_page: num },
      timeout: 30000,
    });
    return res.data.map(fromRest);
  }
  // 임시글 등이 섞여도 num개를 채우도록 넉넉히 받아서 거른다
  const posts = await rpc("wp.getPosts", [
    0, cfg.username, cfg.password,
    { post_type: "post", number: num * 2, orderby: "date", order: "DESC" },
    ["post_id", "post_title", "post_content", "link", "post_status", "post_date"],
  ]);
  return posts
    .filter((p) => p.post_status === "publish" || p.post_status === "private")
    .slice(0, num)
    .map(fromRpc);
}

// 글 1개 (없으면 null)
async function getPost(id) {
  const cfg = readWpConfig();
  if (!cfg) {
    const res = await axios.get(`https://public-api.wordpress.com/wp/v2/sites/${WP_SITE}/posts/${id}`, {
      validateStatus: () => true,
      timeout: 30000,
    });
    return res.status === 200 ? fromRest(res.data) : null;
  }
  try {
    return fromRpc(await rpc("wp.getPost", [0, cfg.username, cfg.password, Number(id)]));
  } catch {
    return null;
  }
}

module.exports = { getRecentPosts, getPost, autop, readWpConfig };
