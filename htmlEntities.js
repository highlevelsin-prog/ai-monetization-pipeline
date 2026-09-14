// HTML 엔티티(&amp; &#8230; &nbsp; &hellip; 등)를 일반 텍스트로 디코딩
const NAMED = { nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", hellip: "…", mdash: "—", ndash: "–", middot: "·", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

function decodeOnce(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() === "amp" ? m : NAMED[name.toLowerCase()] ?? m))
    .replace(/&amp;/g, "&"); // &amp;는 이중 디코딩 방지 위해 마지막에
}

function decodeEntities(s) {
  return decodeOnce(s);
}

// 티스토리 RSS처럼 두 번 인코딩된 값(&amp;hellip;)까지 풀어낸다
function decodeDeep(s) {
  let prev = String(s);
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

module.exports = { decodeEntities, decodeDeep };
